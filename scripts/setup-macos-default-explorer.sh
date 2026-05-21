#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Adam's File Explorer.app"
APP_BUNDLE_ID="com.adamfresko.adamsfileexplorer"
BUILD_APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
INSTALL_APP_PATH="/Applications/$APP_NAME"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
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

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Missing dependency: pnpm"
  exit 1
fi

cd "$ROOT_DIR"

echo "Building app bundle..."
pnpm tauri build

if [[ ! -d "$BUILD_APP_PATH" ]]; then
  echo "Build did not produce app bundle at: $BUILD_APP_PATH"
  exit 1
fi

echo "Installing app to /Applications..."
rm -rf "$INSTALL_APP_PATH"
cp -R "$BUILD_APP_PATH" "/Applications/"

echo "Refreshing LaunchServices registration..."
"$LSREGISTER" -f "$INSTALL_APP_PATH"

echo "Setting default folder handlers to $APP_BUNDLE_ID..."
duti -s "$APP_BUNDLE_ID" public.folder all
duti -s "$APP_BUNDLE_ID" public.directory all

echo "Setup complete."
print_handler_blocks
