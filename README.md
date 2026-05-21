# Adam's File Explorer

Desktop file explorer for macOS built with Tauri + React + Rust.

## Stack

- Tauri v2 (desktop shell)
- React + TypeScript + Tailwind (UI)
- Rust (all file operations + macOS actions)

## Requirements

- Node.js 20+
- pnpm 10+
- Rust toolchain
- Xcode Command Line Tools (for app bundle build)

## Install

```bash
pnpm install
```

## Run

```bash
pnpm tauri dev
```

UI-only development server:

```bash
pnpm dev
```

## Test / Validate

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm --dir ui build
```

## Codex skill

This repo includes a reusable Codex skill at `skills/feature-list-manager`.
Skills in a repo are not auto-loaded by Codex. To install it locally:

```bash
mkdir -p ~/.codex/skills/feature-list-manager
cp -R skills/feature-list-manager/. ~/.codex/skills/feature-list-manager/
```

Use it in Codex with:

```text
$feature-list-manager
```

## Build `.app`

```bash
pnpm tauri build
```

Bundle output:

```text
src-tauri/target/release/bundle/macos/Adam's File Explorer.app
```

## Install `.app` in Applications

After build, copy it manually:

```bash
rm -rf "/Applications/Adam's File Explorer.app"
cp -R "src-tauri/target/release/bundle/macos/Adam's File Explorer.app" "/Applications/"
```

One-command setup (build + copy + set default folder handler):

```bash
pnpm setup:macos-default-explorer
```

## Set as default folder browser (macOS)

Open the installed app from Applications and use the top bar control:

```text
Set as default
```

This sets the app as the default handler for folders/directories only.

Fallback command-line setup:

Install `duti` first:

```bash
brew install duti
```

Run setup:

```bash
pnpm setup:macos-default-explorer
```

This command will:

- build the app
- copy it to `/Applications/Adam's File Explorer.app`
- register it in LaunchServices
- set your user-level folder handler for `public.folder` and `public.directory`

## Roll back to Finder

Use the in-app `Reset` button, or run:

```bash
pnpm reset:macos-default-explorer
```

## Notes

- Default handler is set per-user (not system-wide for all users).
- `duti` is only required for the fallback scripts and is not auto-installed.
- Scope is folders/directories only (`public.folder`, `public.directory`).
- Volumes and regular file types are not changed.

## Main features

- Favorites list on the left
- Editable path bar on top
- File/folder tree in center (hidden files shown)
- Copy / Paste / Move to Trash
- Drag and drop move inside app
- Keyboard shortcuts:
  - Cmd+C
  - Cmd+V
  - Delete
  - Cmd+Backspace
- Right-click context menu with "Open Terminal Here"
- Open-with app mapping by file extension
- In-app default folder browser setting for macOS
- Auto refresh on file system changes (watcher events)

## Config

Config is saved in:

```text
~/Library/Application Support/adams_file_explorer/explorer_config.json
```

It stores:

- favorites
- last opened directory
- open-with mapping by extension

On first run after the rename, the app copies old settings from
`~/Library/Application Support/file_explorer/explorer_config.json` if the new config does not exist.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
