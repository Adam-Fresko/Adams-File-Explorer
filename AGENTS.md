# Repository Guidelines

## Project Structure & Module Organization
This repo is a desktop file explorer built with Tauri.

- `ui/`: React + TypeScript frontend (components, store, API helpers, styles).
- `src-tauri/`: Rust backend and Tauri app setup.
- `src-tauri/src/backend/`: file system logic (`fs_ops.rs`, `tree.rs`, `watcher.rs`, `open_with.rs`).
- `src-tauri/src/commands.rs`: Tauri command handlers used by the UI.
- `src-tauri/icons/`: app icons and bundle assets.

Keep UI state in `ui/src/store/useExplorerStore.ts`, and keep command/API DTO changes synced between `ui/src/lib/types.ts` and `src-tauri/src/dto.rs`.

## Feature Documentation
- Keep `features.md` as the project feature inventory.
- When adding, changing, or removing a feature, use the `feature-list-manager` skill to update the matching entry in `features.md`.
- The repo copy of the skill lives at `skills/feature-list-manager`.
- Before editing `features.md`, inspect the current code, recent diffs, and existing feature entries so the doc matches the real implementation.
- Keep one canonical entry per feature, update requirements/status/paths, and avoid adding duplicate side notes.
- For feature work, mention in the final response whether `features.md` was updated or why no feature doc change was needed.

## Build, Test, and Development Commands
Run from repo root unless noted.

- `pnpm install`: install workspace dependencies.
- `pnpm dev`: run UI only in the browser with Vite, usually at `http://127.0.0.1:1420/`.
- `pnpm tauri dev`: run full desktop app (UI + Rust backend).
- `pnpm build`: type-check and build UI bundle.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run Rust unit tests.
- `pnpm tauri build`: build macOS app bundle.

## Coding Style & Naming Conventions
- TypeScript/React: 2-space indentation, `strict` TypeScript, `PascalCase` for components, `camelCase` for variables/functions, hooks start with `use`.
- Rust: use default `rustfmt` style, `snake_case` for modules/functions, and keep Tauri commands prefixed with `cmd_`.
- Keep functions focused and small; move shared UI logic to `ui/src/lib/` or store helpers.

## Testing Guidelines
- Rust tests live next to code in `#[cfg(test)] mod tests` (see backend files for examples).
- Test names should describe behavior, e.g. `copy_into_rejects_copying_dir_into_own_child`.
- There is no UI test suite yet; for UI changes, include manual checks in PR notes.
- Before opening a PR, run:
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `pnpm build`

## Commit & Pull Request Guidelines
- Current history uses short plain-English commit messages. Keep commits short and specific (example: `Add drag and drop move for tree rows`).
- One logical change per commit when possible.
- PRs should include:
  - what changed and why,
  - how you tested (commands + quick results),
  - screenshot/GIF for visible UI updates.

## Security & Configuration Tips
- Do not commit local logs or machine-specific files.
- App config is stored at `~/Library/Application Support/adams_file_explorer/explorer_config.json`; treat it as local data.
- Be careful with file path and delete/move logic in Rust backend changes.

## Debug Logging
- The app writes local debug events to `~/Library/Application Support/adams_file_explorer/explorer_events.jsonl`.
- The log is JSONL and is meant for AI/debug sessions to read when diagnosing behavior.
- Do not commit log files or copied log content unless explicitly requested.
- Every new feature must use the logger for meaningful user actions, backend commands, errors, and important state changes.
- UI logs should record what the user tried. Backend logs should record what actually happened.
- Include useful context like component name, event type, paths, target path or directory, result, and error text.
- Do not log file contents, thumbnails, image data URLs, huge trees, or repeated noisy events like every mouse move.
