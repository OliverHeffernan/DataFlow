#!/bin/bash
# Install the latest published macOS build without Node, Rust, Homebrew, or sudo.
set -euo pipefail

fail() { printf 'Dataflow: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin ]] || fail 'This installer currently supports macOS only.'
case "$(uname -m)" in
  arm64) arch=aarch64 ;;
  x86_64)
    # A shell running under Rosetta still needs the Apple Silicon build.
    if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then
      arch=aarch64
    else
      arch=x86_64
    fi
    ;;
  *) fail 'Unsupported Mac architecture.' ;;
esac

install_dir="$HOME/Applications"
destination="$install_dir/Dataflow.app"
[[ ! -L "$destination" ]] || fail "$destination is a symlink; remove it before installing."
# Match the installation's executable path, not another app with the same name.
# shellcheck disable=SC2009
if ps -axo comm= | grep -F "$destination/Contents/MacOS/" >/dev/null; then
  fail 'Quit Dataflow before running the installer.'
fi
mkdir -p "$install_dir"
work="$(mktemp -d "$install_dir/.dataflow-install.XXXXXX")"
cleanup() {
  status=$?
  if [[ -e "$work/previous.app" && ! -e "$destination" ]]; then
    if ! mv "$work/previous.app" "$destination"; then
      printf 'Could not restore the previous app. Recover it from %s/previous.app\n' "$work" >&2
      exit 1
    fi
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

release_base='https://github.com/OliverHeffernan/DataFlow/releases'
printf 'Finding the latest Dataflow release for %s…\n' "$arch"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 60 \
  "$release_base/latest/download/latest.json" -o "$work/latest.json" ||
  fail 'No release could be downloaded. Check your connection and whether the first release has been published.'

# plutil ships with macOS; no external JSON parser is needed.
version="$(plutil -extract version raw -o - "$work/latest.json")" || fail 'Invalid release metadata.'
url="$(plutil -extract "platforms.darwin-$arch.url" raw -o - "$work/latest.json")" ||
  fail 'The latest release does not contain a build for this Mac.'
[[ "$url" == "$release_base/download/"* && "$url" == *.app.tar.gz ]] ||
  fail 'The download URL is not a Dataflow release archive.'

printf 'Downloading Dataflow %s…\n' "$version"
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 600 "$url" -o "$work/app.tar.gz"
mkdir "$work/unpacked"
tar -tzf "$work/app.tar.gz" > "$work/contents.txt"
if ! awk '
  $0 !~ /^Dataflow\.app(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 }
  END { exit bad }
' "$work/contents.txt"; then
  fail 'The archive contains unexpected paths.'
fi
tar -xzf "$work/app.tar.gz" -C "$work/unpacked"
bundle="$work/unpacked/Dataflow.app"
[[ -d "$bundle/Contents/MacOS" ]] || fail 'The download does not contain Dataflow.app.'
codesign --verify --deep --strict "$bundle" || fail 'The downloaded app failed its code-signature check.'

# Stage and validate before touching an existing installation. Roll back a failed move.
if [[ -e "$destination" ]]; then
  mv "$destination" "$work/previous.app"
fi
mv "$bundle" "$destination"
printf '\nInstalled Dataflow %s at %s\n' "$version" "$destination"
printf 'Open it in Finder, or run: open "%s"\n' "$destination"
printf 'If macOS blocks the first launch, use System Settings → Privacy & Security → Open Anyway.\n'
printf 'For future updates, choose Dataflow → Check for Updates… in the menu bar.\n'
