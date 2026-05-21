#!/usr/bin/env bash
set -euo pipefail

FINDER_BUNDLE_ID="com.apple.finder"
LS_PREFS="$HOME/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure"

print_handler_blocks() {
  echo "LaunchServices blocks for folder handlers:"
  /usr/bin/defaults read "$LS_PREFS" LSHandlers 2>/dev/null | /usr/bin/grep -A8 -E 'public.folder|public.directory' || true
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only works on macOS."
  exit 1
fi

if ! command -v duti >/dev/null 2>&1; then
  echo "Missing dependency: duti"
  echo "Install it first: brew install duti"
  exit 1
fi

echo "Resetting folder handlers back to Finder..."
duti -s "$FINDER_BUNDLE_ID" public.folder all
duti -s "$FINDER_BUNDLE_ID" public.directory all

echo "Reset complete."
print_handler_blocks
