# Feature List

## Contributor Tooling

### Feature List Manager Skill
- Summary: The repo includes a reusable Codex skill for keeping `features.md` accurate as features change.
- Solves: Lets open-source users install the same feature-documentation workflow used by this project.
- Requirements:
  - The skill is stored under `skills/feature-list-manager` with its required `SKILL.md`.
  - The skill includes `agents/openai.yaml` metadata with the `Adams Feature List Manager` display name and the default prompt.
  - README instructions explain that repo skills are not auto-loaded and must be copied into `~/.codex/skills/feature-list-manager`.
  - `AGENTS.md` points future agents to the repo copy of the skill.
- Status: done
- Links/Paths:
  - `skills/feature-list-manager/SKILL.md`
  - `skills/feature-list-manager/agents/openai.yaml`
  - `README.md`
  - `AGENTS.md`

## File Tree

### Rename Files And Folders
- Summary: Users can rename one file or folder from the tree with a dialog opened by the row context menu or `Shift+F6`.
- Solves: Makes basic file management possible without leaving the app or using Finder.
- Requirements:
  - Right-clicking a tree row shows a `Rename` menu item with a pencil icon and `Shift+F6` shortcut hint.
  - `Shift+F6` opens rename only when exactly one item is selected; no selection or many selections show a status message.
  - Both triggers use the same rename dialog flow and apply the same input focus and text selection behavior.
  - File names with extensions select only the name before the extension, `.gitignore` and files without extensions select the whole name, and folders place the caret at the end.
  - The dialog uses the app's normal dialog, input, and button styles with title `Rename`, description text, `Name` label, close `X`, `Cancel`, and `Rename`.
  - Pressing Enter confirms rename, while Escape, `Cancel`, or close `X` closes the dialog.
  - Rename stays in the same parent folder and rejects empty names, path separators, unchanged names, missing items, and duplicate target paths.
  - Rename failures keep the dialog open, show the error below the name input, focus the input again, and clear the inline error when the name changes.
  - After success, the tree refreshes, the renamed path is selected and focused, and expanded folder paths are updated to the new path.
- Status: done
- Links/Paths:
  - `ui/src/components/TreeView.tsx`
  - `ui/src/store/useExplorerStore.ts`
  - `ui/src/App.tsx`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/backend/fs_ops.rs`

### Create Folders
- Summary: Users can create a new folder from the toolbar, tree context menu, or `Cmd/Ctrl+Shift+N`.
- Solves: Lets users add folders without leaving the file explorer.
- Requirements:
  - The header shows a `New Folder` icon button directly after `Open Terminal Here`.
  - The toolbar button and `Cmd/Ctrl+Shift+N` create inside the selected folder when exactly one folder is selected; otherwise they create inside the current directory.
  - Tree row context menus show `New Folder`; folders create inside that folder, and files create inside the current directory.
  - The button is disabled until a current directory is open.
  - Every entry point opens the shared name dialog before creating anything, with title `New Folder`, `Name` label, default name `New Folder`, `Cancel`, and `Create`.
  - Pressing Enter confirms creation, while Escape, `Cancel`, or close `X` closes the dialog.
  - Folder creation rejects empty names, path separators, missing parent folders, non-folder parent paths, and duplicate target paths.
  - Creation failures keep the dialog open, show the error below the name input, focus the input again, and clear the inline error when the name changes.
  - After success, the tree refreshes, the parent folder expands when needed, and the created folder is selected and focused.
  - UI and backend logs record the button click, dialog events, command result, target directory, created path, and errors.
- Status: done
- Links/Paths:
  - `ui/src/components/PathBar.tsx`
  - `ui/src/components/TreeView.tsx`
  - `ui/src/store/useExplorerStore.ts`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/backend/fs_ops.rs`

### Drag And Drop Move
- Summary: Users can move one or more selected files or folders by dragging them inside the tree.
- Solves: Makes moving files and folders feel direct without needing copy, paste, or a separate dialog.
- Requirements:
  - Dragging a selected row moves the full current selection; dragging an unselected row moves only that row.
  - Folder rows, file rows inside expanded folders, and current-folder empty space accept valid internal drops.
  - Dropping onto a file row targets that file's parent folder, so users can drop into expanded folders without hitting only the folder header.
  - Expanded empty folders do not render a blank child drop area; the folder row itself stays the drop target.
  - Dragging uses a custom pointer engine with a floating ghost, source-row fade, multi-item count badge, auto-scroll, and snap-back when a drop is rejected or cancelled.
  - Pressing Enter on a focused row starts keyboard drag, Arrow Up/Down moves the target, Enter drops, and Escape cancels.
  - Hovering over a collapsed valid folder target expands it so users can drop deeper in the tree.
  - Dropping folders into themselves or their own children, and dropping items into their current parent folder are rejected.
  - Name conflicts open one batch dialog with `Replace`, `Keep Both`, and `Cancel`.
  - `Keep Both` creates numbered names and records undo history.
  - `Replace` is allowed only for same-kind conflicts, sends replaced items to Trash, and is not undoable in the app.
  - Successful drops refresh the tree, select the moved items, and record undo history when the chosen move mode supports it.
  - UI and backend logs record drag starts, hover expands, drop attempts, conflict choices, rejected drops with reason, move command results, and drags that ended without a drop.
- Status: done
- Links/Paths:
  - `ui/src/components/TreeView.tsx`
  - `ui/src/components/tree-dnd/useTreeDragDrop.ts`
  - `ui/src/components/tree-dnd/treeData.ts`
  - `ui/src/store/useExplorerStore.ts`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/dto.rs`
  - `src-tauri/src/backend/fs_ops.rs`

### Favorite Folders
- Summary: Users can save folders in the Favorites sidebar, reopen them quickly, and keep that list between app launches.
- Solves: Makes often-used folders easy to reach without typing paths or browsing from the root each time.
- Requirements:
  - The Favorites sidebar lists saved folder paths and keeps the full path available in the row title and tooltip.
  - Long favorite paths trim from the left so the folder name and right side of the path stay visible.
  - Users can add the current folder, open a favorite, and remove a favorite from the sidebar.
  - Favorites and the sidebar collapsed state are saved in the app config.
- Status: done
- Links/Paths:
  - `ui/src/components/FavoritesPanel.tsx`
  - `ui/src/index.css`
  - `ui/src/store/useExplorerStore.ts`
  - `src-tauri/src/backend/config.rs`
  - `src-tauri/src/commands.rs`

### Undo And Redo File Actions
- Summary: Users can undo and redo rename, move, and paste actions from shortcuts, toolbar buttons, or the history panel.
- Solves: Gives users a way to recover common file changes without manually moving or renaming files back.
- Requirements:
  - `Cmd/Ctrl+Z` undoes the latest tracked file action, while `Cmd/Ctrl+Shift+Z` and `Cmd/Ctrl+Y` redo it.
  - Toolbar buttons show Undo, Redo, and History; Undo and Redo are disabled when no matching action is available or another undo/redo is running.
  - The History panel shows one read-only `Recent file actions` timeline with newest actions first, including undo and redo events.
  - History is saved between app restarts in local app data and is capped at 100 undo, 100 redo, and 100 timeline entries.
  - Paste undo moves created items into an app staging folder so redo can restore them after restart.
  - Starting a new tracked action clears redo history, cleans staged files from cleared redo actions, and keeps old timeline events visible.
  - Failed undo/redo attempts keep history unchanged and show an error.
  - Create Folder is not undoable in this feature.
  - Move to Trash is not undoable in this feature because macOS Trash restore is not reliable through the current backend library.
- Status: done
- Links/Paths:
  - `ui/src/components/OperationHistorySheet.tsx`
  - `ui/src/components/PathBar.tsx`
  - `ui/src/store/useExplorerStore.ts`
  - `ui/src/App.tsx`
  - `src-tauri/src/backend/file_history.rs`
  - `src-tauri/src/commands.rs`
