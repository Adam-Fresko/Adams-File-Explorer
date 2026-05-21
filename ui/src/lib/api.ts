import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  ColumnWidthsDto,
  DefaultFolderBrowserStatusDto,
  DirectoryStateDto,
  FileOperationCommandResultDto,
  FileOperationHistoryDto,
  InitStateDto,
  MoveConflictActionDto,
  MovePreviewDto,
  OpResultDto,
  PathOperationResultDto,
  SortPreferenceDto,
  TreeNodeDto
} from "./types";

export const api = {
  initState: () => invoke<InitStateDto>("cmd_init_state"),
  listChildren: (path: string) => invoke<TreeNodeDto[]>("cmd_list_children", { path }),
  changeDirectory: (path: string) =>
    invoke<DirectoryStateDto>("cmd_change_directory", { path }),
  addFavorite: (path: string) => invoke<string[]>("cmd_add_favorite", { path }),
  removeFavorite: (path: string) => invoke<string[]>("cmd_remove_favorite", { path }),
  copyToClipboard: (paths: string[]) => invoke<void>("cmd_copy_to_clipboard", { paths }),
  copyPathsAsText: (paths: string[]) => invoke<void>("cmd_copy_paths_as_text", { paths }),
  pasteInto: (targetDir: string) =>
    invoke<OpResultDto>("cmd_paste_into", { targetDir }),
  previewMoveItems: (paths: string[], targetDir: string) =>
    invoke<MovePreviewDto>("cmd_preview_move_items", { paths, targetDir }),
  moveItems: (paths: string[], targetDir: string, conflictAction: MoveConflictActionDto) =>
    invoke<OpResultDto>("cmd_move_items", { paths, targetDir, conflictAction }),
  renameItem: (path: string, newName: string) =>
    invoke<PathOperationResultDto>("cmd_rename_item", { path, newName }),
  createDirectory: (parentDir: string, name: string) =>
    invoke<PathOperationResultDto>("cmd_create_folder", { parentDir, name }),
  deleteToTrash: (paths: string[]) => invoke<OpResultDto>("cmd_delete_to_trash", { paths }),
  getFileOperationHistory: () =>
    invoke<FileOperationHistoryDto>("cmd_get_file_operation_history"),
  undoFileOperation: () =>
    invoke<FileOperationCommandResultDto>("cmd_undo_file_operation"),
  redoFileOperation: () =>
    invoke<FileOperationCommandResultDto>("cmd_redo_file_operation"),
  openTerminalHere: (path: string) => invoke<void>("cmd_open_terminal_here", { path }),
  openFile: (path: string) => invoke<void>("cmd_open_file", { path }),
  chooseOpenWith: (path: string) => invoke<string | null>("cmd_choose_open_with", { path }),
  setOpenWith: (extension: string, appPath: string) =>
    invoke<void>("cmd_set_open_with", { extension, appPath }),
  setSortPreference: (sortPreference: SortPreferenceDto) =>
    invoke<void>("cmd_set_sort_preference", { sortPreference }),
  setColumnWidths: (columnWidths: ColumnWidthsDto) =>
    invoke<void>("cmd_set_column_widths", { columnWidths }),
  setFavoritesCollapsed: (collapsed: boolean) =>
    invoke<void>("cmd_set_favorites_collapsed", { collapsed }),
  setShowHidden: (path: string, showHidden: boolean, expanded: string[]) =>
    invoke<DirectoryStateDto>("cmd_set_show_hidden", { path, showHidden, expanded }),
  getOpenWithIconMap: () =>
    invoke<Record<string, string>>("cmd_get_open_with_icon_map"),
  getImageThumbnail: (path: string) =>
    invoke<string | null>("cmd_get_image_thumbnail", { path }),
  getLogFilePath: () => invoke<string>("cmd_get_log_file_path"),
  refreshTree: (root: string, expanded: string[]) =>
    invoke<TreeNodeDto[]>("cmd_refresh_tree", { root, expanded }),
  getDefaultFolderBrowserStatus: () =>
    invoke<DefaultFolderBrowserStatusDto>("cmd_get_default_folder_browser_status"),
  setDefaultFolderBrowser: () =>
    invoke<DefaultFolderBrowserStatusDto>("cmd_set_default_folder_browser"),
  resetDefaultFolderBrowser: () =>
    invoke<DefaultFolderBrowserStatusDto>("cmd_reset_default_folder_browser"),
  onOpenPath: (handler: (path: string) => void) =>
    listen<string>("app:open-path", (event) => {
      if (typeof event.payload === "string") {
        handler(event.payload);
      }
    }),
  onFsChanged: (handler: (path: string) => void) =>
    listen<string>("fs:changed", (event) => {
      if (typeof event.payload === "string") {
        handler(event.payload);
      }
    })
};

export const loadOrInit = api.initState;
export const loadChildren = api.listChildren;

export type { UnlistenFn };
