import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { executeLuaScript, runScriptWorker, scriptLimits } from './LuaScript.js';
import { toScriptValue, scriptValueToRaw } from './ScriptValues.js';
import { cellToValue, evaluateFormula } from './FormulaFunctions.js';
import { compileConfig } from './LuaConfig.js';

// An implementation of the runner's access interface, not a live workbook mutation API.
// The accepted SheetManager draft/publish seam will own production staging and transactions.
function fixture() {
	const data = [
		[['9007199254740993.125', '=0.1+0.2', ''], ['=FALSE', '="=not a formula"', '#REF!']],
		[['old', '', ''], ['', '', '']],
	];
	return {
		data,
		sheets: [{ name: 'Inputs', rows: 2, cols: 3 }, { name: 'Report', rows: 2, cols: 3 }], activeSheet: 0,
		selection: { sheet: 0, r0: 0, c0: 0, r1: 1, c1: 2 },
		read(range, computed) {
			return data[range.sheet].slice(range.r0, range.r1 + 1).map((row, r) => row.slice(range.c0, range.c1 + 1).map((raw, c) => {
				if (!computed) return raw;
				const value = raw.startsWith('=') ? evaluateFormula(raw, r + range.r0, c + range.c0, {}) : cellToValue(raw);
				return toScriptValue(value, raw === '');
			}));
		},
		write(range, matrix) {
			matrix.forEach((row, r) => row.forEach((raw, c) => { data[range.sheet][range.r0 + r][range.c0 + c] = raw; }));
		},
	};
}

test('Lua copies asymmetric raw rectangles and exact computed values through the public access interface', () => {
	const access = fixture();
	const result = executeLuaScript(`
local inputs = df.active_sheet()
assert(#df.sheets() == 2 and inputs.name == 'Inputs')
local selected = df.selection()
assert(selected.rows == 2 and selected.cols == 3 and selected.address == 'A0:C1')
df.sheet('Report'):range('A0:C1'):write_values(selected:read_values())
local exact = df.sheet('Report'):range('A0'):read_values()[1][1]
df.log(exact.decimal)
df.log(('done'):upper())
`, access);
	assert.deepEqual(result.logs, ['9007199254740993.125', 'DONE']);
	assert.deepEqual(access.data[1], [
		['9007199254740993.125', '0.3', ''],
		['=FALSE', '="=not a formula"', '="#REF!"'],
	]);
	assert.equal(evaluateFormula(access.data[1][1][1], 1, 1, {}), '=not a formula');
	assert.equal(evaluateFormula(access.data[1][1][2], 1, 2, {}), '#REF!');
	assert.equal(evaluateFormula(access.data[1][1][0], 1, 0, {}), false);

	executeLuaScript(`df.sheet('Report'):range('B0:C1'):write_raw(df.sheet('Inputs'):range('A0:B1'):read_raw())`, access);
	assert.deepEqual(access.data[1], [
		['9007199254740993.125', '9007199254740993.125', '=0.1+0.2'],
		['=FALSE', '=FALSE', '="=not a formula"'],
	]);
});

test('malformed or lossy write payloads reject the whole matrix before the access provider sees it', () => {
	for (const expression of [
		'{{"a", "b", "c"}, {"d", "e"}}',
		'{{"a", "b", "c"}, {"d", "e", 0.1}}',
		'{{"a", "b", "c"}, {"d", "e", "f"}, extra = {}}',
		'{{"a", "b", "c"}, {[1]="d", [3]="f"}}',
	]) {
		const access = fixture(), before = structuredClone(access.data);
		assert.throws(() => executeLuaScript(`df.sheet('Report'):range('A0:C1'):write_raw(${expression})`, access));
		assert.deepEqual(access.data, before);
	}
	for (const cell of ['0.1', '{kind="number",decimal=0.1}', '{kind="number",decimal="NaN"}',
		'{kind="number",decimal="1e9999999999999999"}', '{kind="number",decimal="1e-9999999999999999"}',
		'{kind="boolean",value=0}', '{kind="error"}', '{kind="chart"}', '{kind="blank",extra="x"}']) {
		const access = fixture();
		assert.throws(() => executeLuaScript(`df.sheet('Report'):range('A0'):write_values({{${cell}}})`, access));
		assert.equal(access.data[1][0][0], 'old');
	}
});

test('ranges use zero-based bounded coordinates and reference resolution stays host-owned', () => {
	const access = fixture();
	for (const address of ['A2', 'D0', 'B1:A0', 'A-1', 'A0:C2', 'A0;B0', 'A9007199254740993', '[+1]{+1}']) {
		assert.throws(() => executeLuaScript(`df.sheet('Inputs'):range('${address}'):read_raw()`, access));
	}
	assert.throws(() => executeLuaScript(`df.sheet('Missing')`, access), /Unknown sheet/);
	assert.throws(() => executeLuaScript(`df.named('sales.amount')`, access), /resolution is unavailable/);
	access.resolve = name => {
		assert.equal(name, 'sales.amount');
		return { sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 };
	};
	assert.deepEqual(executeLuaScript(`df.log(df.named('sales.amount'):read_values()[1][1].decimal)`, access).logs, ['9007199254740993.125']);
	access.selection = null;
	assert.throws(() => executeLuaScript('df.selection()', access), /No sheet selection/);
});

test('script and config VMs remain separate and scripts have no external or dynamic execution authority', () => {
	assert.throws(() => compileConfig('df.sheet("Inputs")'));
	const access = fixture();
	const result = executeLuaScript(`
for _, name in ipairs({'io','os','package','require','js','debug','coroutine','load','loadfile','dofile','print','collectgarbage','pcall','xpcall','getmetatable','setmetatable','vim','fetch','window','document','invoke'}) do
  assert(_G[name] == nil, name)
end
for _, name in ipairs({'rep','format','dump','pack','unpack','gsub','gmatch','find','match'}) do
  assert(string[name] == nil and ('text')[name] == nil, name)
end
assert(df.command == nil and df.save == nil)
df.log('isolated')
`, access);
	assert.deepEqual(result.logs, ['isolated']);
	assert.throws(() => executeLuaScript('\x1bLua\x53\0', access), /binary chunk/);
	assert.throws(() => executeLuaScript('df.log(', access), /workbook.lua/);
	assert.throws(() => executeLuaScript('secret = true; error("stopped")', access), /stopped/);
	assert.deepEqual(executeLuaScript('assert(secret == nil)', access).logs, []);
});

test('source, instruction, call, cell, byte and diagnostic quotas fail explicitly', () => {
	const access = fixture();
	assert.throws(() => executeLuaScript('--' + 'é'.repeat(65536), access), /128 KiB/);
	assert.throws(() => executeLuaScript('while true do end', access), /instruction limit/);
	assert.throws(() => executeLuaScript('for i=1,1001 do df.active_sheet() end', access), /call limit/);
	assert.throws(() => executeLuaScript('for i=1,101 do df.log("x") end', access), /diagnostic limit/);
	assert.throws(() => executeLuaScript('local s="é"; for i=1,13 do s=s..s end; df.log(s)', access), /string limit/);
	assert.throws(() => executeLuaScript('local s="x"; for i=1,15 do s=s..s end; df.selection():write_raw({{s,s,s},{s,s,s}})', access), /string limit/);

	const large = { sheets: [{ name: 'Large', rows: 501, cols: 200 }], activeSheet: 0 };
	assert.throws(() => executeLuaScript('df.active_sheet():range("A0:GR500"):read_raw()', large), /cell transfer limit/);
	const payload = fixture(); payload.data[0][0][0] = 'x'.repeat(scriptLimits.cellBytes);
	assert.throws(() => executeLuaScript('local r=df.active_sheet():range("A0"); for i=1,512 do r:read_raw() end', payload), /transfer limit/);
});

test('exact value serialization preserves types and declines unsupported computed values', () => {
	const decimal = evaluateFormula('=9007199254740993.125+0.2', 0, 0, {});
	assert.deepEqual(toScriptValue(decimal), { kind: 'number', decimal: '9007199254740993.325' });
	assert.equal(scriptValueToRaw(toScriptValue(decimal)), '9007199254740993.325');
	assert.deepEqual(toScriptValue(''), { kind: 'text', text: '' });
	assert.deepEqual(toScriptValue('', true), { kind: 'blank' });
	assert.deepEqual(toScriptValue({ kind: 'chart' }), { kind: 'chart' });
	for (const value of [Infinity, evaluateFormula('=sqrt(-1)', 0, 0, {}), [[1, 2]]]) {
		assert.equal(toScriptValue(value).kind, 'unsupported');
		assert.throws(() => scriptValueToRaw(toScriptValue(value)), /Cannot write computed/);
	}
});

// Real worker threads with a browser-shaped message interface exercise execution lifetime.
function worker(code) {
	const thread = new Worker(new URL(`data:text/javascript,${encodeURIComponent(`import { parentPort } from 'node:worker_threads'; ${code}`)}`));
	const browser = {
		postMessage: value => thread.postMessage(value),
		terminate: () => thread.terminate(),
	};
	thread.on('message', data => browser.onmessage?.({ data }));
	thread.on('error', error => browser.onerror?.(error));
	thread.on('messageerror', error => browser.onmessageerror?.(error));
	return browser;
}

test('real workers return Lua results/errors and cannot settle a run twice', async () => {
	const runner = new URL('./LuaScript.js', import.meta.url).href;
	const code = `import { executeLuaScript } from ${JSON.stringify(runner)};
parentPort.on('message', source => {
  try { parentPort.postMessage({result: executeLuaScript(source, {})}); }
  catch (error) { parentPort.postMessage({error: error.message}); }
  parentPort.postMessage({result: 'late'});
});`;
	assert.deepEqual(await runScriptWorker(worker(code), 'df.log("worker")'), { logs: ['worker'] });
	await assert.rejects(runScriptWorker(worker(code), 'while true do end'), /instruction limit/);
	await assert.rejects(runScriptWorker(worker(`parentPort.on('message', () => { throw new Error('crashed'); });`), {}), /crashed/);
	await assert.rejects(runScriptWorker(worker(`parentPort.on('message', () => parentPort.postMessage({unexpected:true}));`), {}), /Invalid script worker response/);
});

test('cancellation and watchdog terminate real stuck workers without a successful result', async () => {
	const controller = new AbortController();
	const pending = runScriptWorker(worker(`parentPort.on('message', () => { while (true) {} });`), {}, controller.signal);
	setTimeout(() => controller.abort(), 50);
	await assert.rejects(pending, { name: 'AbortError' });
	await assert.rejects(runScriptWorker(worker(`parentPort.on('message', () => { while (true) {} });`), {}), /execution timed out/);
	const aborted = new AbortController(); aborted.abort();
	await assert.rejects(runScriptWorker(worker(''), {}, aborted.signal), { name: 'AbortError' });
});
