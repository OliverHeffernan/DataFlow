import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the public installer with real archives and file moves. Only the Mac
// platform tools and release downloads are substituted; no network is required.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dataflow-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const home = join(root, 'home with spaces');
  const app = join(home, 'Applications', 'Dataflow.app');
  mkdirSync(bin);
  mkdirSync(home);
  const mock = (name, source) => writeFileSync(join(bin, name), source, { mode: 0o755 });
  mock('uname', '#!/bin/bash\nif [[ "$1" == -s ]]; then echo "${TEST_OS:-Darwin}"; else echo "${TEST_ARCH:-arm64}"; fi\n');
  mock('sysctl', '#!/bin/bash\necho "${TEST_TRANSLATED:-0}"\n');
  mock('ps', '#!/bin/bash\necho "${TEST_RUNNING:-}"\n');
  mock('codesign', '#!/bin/bash\nexit "${TEST_BAD_SIGNATURE:-0}"\n');
  mock('plutil', `#!/usr/bin/env node
    const fs = require('node:fs');
    let value = JSON.parse(fs.readFileSync(process.argv.at(-1)));
    for (const key of process.argv[3].split('.')) value = value?.[key];
    if (typeof value !== 'string') process.exit(1);
    process.stdout.write(value);
  `);
  mock('curl', `#!/usr/bin/env node
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const url = args.find(arg => arg.startsWith('https://'));
    const out = args[args.indexOf('-o') + 1];
    if (process.env.TEST_DOWNLOAD_FAIL && !url.endsWith('latest.json')) process.exit(22);
    const input = url.endsWith('latest.json') ? 'manifest.json' : url.includes('aarch64') ? 'aarch64.tar.gz' : 'x86_64.tar.gz';
    fs.copyFileSync(process.env.TEST_ROOT + '/' + input, out);
  `);
  mock('mv', '#!/bin/bash\nif [[ "${TEST_MOVE_FAIL:-}" == 1 && "$1" == */unpacked/Dataflow.app ]]; then exit 1; fi\nexec /bin/mv "$@"\n');

  const manifest = { version: '0.9.3', platforms: {} };
  for (const arch of ['aarch64', 'x86_64']) {
    const source = join(root, arch);
    mkdirSync(join(source, 'Dataflow.app', 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(source, 'Dataflow.app', 'Contents', 'MacOS', 'app'), arch);
    const tar = spawnSync('tar', ['-czf', join(root, `${arch}.tar.gz`), '-C', source, 'Dataflow.app']);
    assert.equal(tar.status, 0);
    manifest.platforms[`darwin-${arch}`] = {
      url: `https://github.com/OliverHeffernan/DataFlow/releases/download/v0.9.3/Dataflow_0.9.3_${arch}.app.tar.gz`,
    };
  }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  return {
    root, app, manifest,
    previous() {
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, 'original'), 'keep me');
    },
    run(env = {}) {
      return spawnSync('bash', [resolve('install.sh')], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TEST_ROOT: root, ...env },
        encoding: 'utf8',
      });
    },
  };
}

test('installer selects Apple Silicon, Intel, and Rosetta builds and replaces an existing app', async t => {
  for (const [machine, translated, expected] of [['arm64', '0', 'aarch64'], ['x86_64', '0', 'x86_64'], ['x86_64', '1', 'aarch64']]) {
    await t.test(`${machine}, Rosetta=${translated}`, t => {
      const f = fixture(t);
      if (machine !== 'arm64') f.previous();
      const result = f.run({ TEST_ARCH: machine, TEST_TRANSLATED: translated });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(f.app, 'Contents', 'MacOS', 'app'), 'utf8'), expected);
      assert.match(result.stdout, /Installed Dataflow 0\.9\.3/);
      assert.deepEqual(readdirSync(join(f.app, '..')), ['Dataflow.app']);
    });
  }
});

test('failed download, failed signature, or failed replacement preserves the old app', async t => {
  for (const failure of ['TEST_DOWNLOAD_FAIL', 'TEST_BAD_SIGNATURE', 'TEST_MOVE_FAIL']) {
    await t.test(failure, t => {
      const f = fixture(t);
      f.previous();
      assert.notEqual(f.run({ [failure]: '1' }).status, 0);
      assert.equal(readFileSync(join(f.app, 'original'), 'utf8'), 'keep me');
      assert.deepEqual(readdirSync(join(f.app, '..')), ['Dataflow.app']);
    });
  }
});

test('installer refuses an unsupported platform or a running app', t => {
  const f = fixture(t);
  f.previous();
  assert.match(f.run({ TEST_OS: 'Linux' }).stderr, /macOS only/);
  assert.match(f.run({ TEST_ARCH: 'ppc' }).stderr, /Unsupported Mac architecture/);
  assert.match(f.run({ TEST_RUNNING: `${f.app}/Contents/MacOS/app` }).stderr, /Quit Dataflow/);
  assert.equal(readFileSync(join(f.app, 'original'), 'utf8'), 'keep me');
});

test('installer rejects a missing platform or a download outside this repository', t => {
  const f = fixture(t);
  f.previous();
  delete f.manifest.platforms['darwin-aarch64'];
  writeFileSync(join(f.root, 'manifest.json'), JSON.stringify(f.manifest));
  assert.match(f.run().stderr, /does not contain a build/);
  f.manifest.platforms['darwin-aarch64'] = { url: 'https://example.com/Dataflow.app.tar.gz' };
  writeFileSync(join(f.root, 'manifest.json'), JSON.stringify(f.manifest));
  assert.match(f.run().stderr, /not a Dataflow release archive/);
  assert.equal(readFileSync(join(f.app, 'original'), 'utf8'), 'keep me');
});

test('installer rejects an archive containing files outside the app bundle', t => {
  const f = fixture(t);
  f.previous();
  writeFileSync(join(f.root, 'unexpected.txt'), 'not an app');
  const tar = spawnSync('tar', ['-czf', join(f.root, 'aarch64.tar.gz'), '-C', f.root, 'unexpected.txt']);
  assert.equal(tar.status, 0);
  assert.match(f.run().stderr, /unexpected paths/);
  assert.equal(readFileSync(join(f.app, 'original'), 'utf8'), 'keep me');
});
