# macOS installation and updates

## Install

After the first release has been published, run:

```sh
curl -fsSL https://raw.githubusercontent.com/OliverHeffernan/DataFlow/main/install.sh | bash
```

The script detects Intel, Apple Silicon, and Rosetta; downloads the matching app from the latest public GitHub release; checks its Apple code signature; and installs it in `~/Applications/Dataflow.app`. No Node, Rust, Homebrew, or administrator access is needed. It stages the new app before replacing an existing installation, restores the old app if replacement fails, and leaves preferences and spreadsheets alone. Quit Dataflow before rerunning the installer. You can inspect [the script](../install.sh) before running it.

Open `~/Applications/Dataflow.app` in Finder. Builds currently use an **ad-hoc Apple signature**, not a Developer ID certificate or Apple notarization. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway**. Neither the installer nor the app disables Gatekeeper or removes quarantine attributes. If your Mac requires notarized applications, these builds will not satisfy that policy.

Older manually installed copies in `/Applications` are not replaced by this installer. Open the new copy in `~/Applications` and remove any obsolete copy yourself to avoid launching the wrong version.

## Update from the app

Choose **Dataflow → Check for Updates…** in the native macOS menu bar. The app reports when it is up to date or when the check fails. If an update is available, it shows the current and new versions and asks before downloading. After download/signature verification, a modified workbook gets **Save / Keep recovery / Discard changes / Cancel** before installation and restart. Keep recovery must finish successfully; failed/cancelled saves or recovery writes keep the editor open without installing. Input stays locked during installation and unlocks if installation fails. The disabled menu item shows progress; only one update operation can run at a time.

Updates are downloaded over HTTPS and verified with Tauri's updater signing key before installation. This cryptographic signature is separate from Apple's code signing. Previously compiled builds without the updater must be replaced once using the installer. Development builds have no public key configured and explain that updates require a published build.

## One-time maintainer setup

Generate a signing key **on your own machine**, using the project's dependencies. The generator prompts for a password; keep the private key and its password in a password manager or another secure backup. Do not commit either, paste them into a chat, or rotate the key between releases: existing installations trust its matching public key.

```sh
npm ci
mkdir -p ~/.tauri
npm run tauri -- signer generate -w ~/.tauri/dataflow.key
```

In this repository's **Settings → Secrets and variables → Actions**, add:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `TAURI_UPDATER_PUBLIC_KEY` | Entire contents of `~/.tauri/dataflow.key.pub` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Entire contents of `~/.tauri/dataflow.key` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password chosen during generation; omit if deliberately generated without one |

Alternatively, the GitHub CLI reads the files directly without printing their contents:

```sh
gh variable set TAURI_UPDATER_PUBLIC_KEY --repo OliverHeffernan/DataFlow < ~/.tauri/dataflow.key.pub
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo OliverHeffernan/DataFlow < ~/.tauri/dataflow.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo OliverHeffernan/DataFlow
```

The last command prompts for the password. GitHub supplies `GITHUB_TOKEN` automatically. The workflow requests `contents: write` for its release jobs; repository or organization policies must allow that permission and GitHub-hosted macOS runners.

## Publishing

Every **push to `main`** starts `.github/workflows/release.yml`. Local commits do not trigger GitHub Actions. You can also use **Actions → Release Dataflow → Run workflow** after setup. Publication happens automatically after the workflow succeeds; no release tag or manual version bump is needed.

1. Run the JavaScript and installer tests, check the signing configuration, and create a draft release.
2. Build and sign Apple Silicon and Intel apps on a macOS runner. The builds upload sequentially because Tauri's action merges both architectures into a shared `latest.json`.
3. Check that both updater entries and signatures exist, then publish the draft and mark it latest. A failed build leaves the draft hidden; existing users keep receiving the previous complete release. A rerun of an older workflow cannot replace a newer published release.

Release versions are `0.<workflow run number>.<run attempt>` (for example, `0.12.1`, then `0.13.1`; rerunning the latter uses `0.13.2`). Keep this workflow's run counter/history when continuing this version scheme. CI overrides the build version and public key without committing generated version changes or secrets. Local unsigned builds remain available with `npm run tauri build` and cannot self-update.

The first successful release makes the install command usable. Until then the script reports that no release could be downloaded. Check the Actions run for missing keys, an incorrect key password, or native build failures. This setup publishes macOS only; Windows and Linux distribution are not configured.

## Verification

Run `npm test` to check the existing application behavior and installer contracts. The installer tests use real archives and file replacement in disposable directories, with Mac platform tools and GitHub downloads substituted. They cover Intel/Apple Silicon/Rosetta, paths with spaces, download and signature failures, rollback, running-app rejection, and invalid release metadata. They do not replace testing Apple's signature verification or installation on a real Mac.

Run `npm run build` and `cargo check --locked --manifest-path src-tauri/Cargo.toml` to check the frontend and native backend. The updater uses Rust APIs, so it needs no frontend updater or process permissions. Validate the first two published releases on a Mac to confirm actual installation, signature verification, and restart across versions. No published installation or updater check can succeed before the signing configuration and first release exist.
