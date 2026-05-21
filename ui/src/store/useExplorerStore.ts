import { create } from "zustand";

import { api } from "../lib/api";
import { logUiEvent } from "../lib/eventLog";
import { openWithValueForExtension, withOpenWithValueForAliases } from "../lib/openWithAliases";
import { parentDirectoryOf } from "../lib/pathUtils";
import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTHS,
  type ColumnWidthsDto,
  type DefaultFolderBrowserStatusDto,
  type FileOperationCommandResultDto,
  type FileOperationHistoryDto,
  type MoveConflictActionDto,
  type MoveConflictDto,
  type SortColumn,
  type SortDirection,
  type SortPreferenceDto,
  type TreeNodeDto
} from "../lib/types";

type ChangeDirectoryOptions = {
  addToHistory?: boolean;
  focusPathAfterLoad?: string;
};

export type NameDialogSubmitResult =
  | { ok: true }
  | { ok: false; error: string };

export type PendingMoveConflict = {
  paths: string[];
  targetDir: string;
  conflicts: MoveConflictDto[];
};

type ExplorerState = {
  currentDir: string;
  pathInput: string;
  favorites: string[];
  favoritesCollapsed: boolean;
  tree: TreeNodeDto[];
  historyPaths: string[];
  historyIndex: number;
  selectedPaths: string[];
  focusedPath: string | null;
  expandedPaths: string[];
  statusText: string;
  errorText: string;
  openWithMap: Record<string, string>;
  openWithIconMap: Record<string, string>;
  defaultFolderBrowserStatus: DefaultFolderBrowserStatusDto | null;
  sortPreference: SortPreferenceDto | null;
  columnWidths: ColumnWidthsDto;
  showHidden: boolean;
  draggingPaths: string[];
  renameTargetPath: string | null;
  createDirectoryParentPath: string | null;
  pendingMoveConflict: PendingMoveConflict | null;
  fileOperationHistory: FileOperationHistoryDto;
  isUndoRedoRunning: boolean;
  isHistoryPanelOpen: boolean;
  init: () => Promise<void>;
  setPathInput: (value: string) => void;
  changeDirectory: (path: string, options?: ChangeDirectoryOptions) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;
  addFavorite: (path: string) => Promise<void>;
  removeFavorite: (path: string) => Promise<void>;
  setFavoritesCollapsed: (collapsed: boolean) => Promise<void>;
  toggleExpand: (path: string) => Promise<void>;
  selectPath: (path: string, multi: boolean) => void;
  clearSelection: () => void;
  copySelection: () => Promise<void>;
  copySelectedPathsAsText: () => Promise<void>;
  pasteIntoCurrent: () => Promise<void>;
  startMoveDrop: (paths: string[], targetDir: string) => Promise<void>;
  moveItems: (
    paths: string[],
    targetDir: string,
    conflictAction: MoveConflictActionDto
  ) => Promise<void>;
  confirmMoveConflict: (conflictAction: MoveConflictActionDto) => Promise<void>;
  cancelMoveConflict: () => void;
  renameItem: (path: string, newName: string) => Promise<NameDialogSubmitResult>;
  requestRename: (path: string) => void;
  requestRenameForSelection: () => void;
  closeRenameDialog: () => void;
  getCreateDirectoryParent: () => string | null;
  createDirectory: (parentDir: string, name: string) => Promise<NameDialogSubmitResult>;
  requestCreateDirectory: (parentDir: string) => void;
  closeCreateDirectoryDialog: () => void;
  loadFileOperationHistory: () => Promise<void>;
  undoFileOperation: () => Promise<void>;
  redoFileOperation: () => Promise<void>;
  setHistoryPanelOpen: (open: boolean) => void;
  deleteSelection: () => Promise<void>;
  openTerminalHere: (path: string) => Promise<void>;
  openPath: (path: string, isDir: boolean) => Promise<void>;
  sortByColumn: (column: SortColumn) => Promise<void>;
  setColumnWidth: (column: SortColumn, width: number) => void;
  saveColumnWidths: (columnWidths?: ColumnWidthsDto) => Promise<void>;
  setShowHidden: (showHidden: boolean) => Promise<void>;
  refreshOpenWithIcons: () => Promise<void>;
  refreshDefaultFolderBrowserStatus: () => Promise<void>;
  setDefaultFolderBrowser: () => Promise<void>;
  resetDefaultFolderBrowser: () => Promise<void>;
  refreshTree: () => Promise<void>;
  setDraggingPaths: (paths: string[]) => void;
  clearFocusedPath: () => void;
};

const extensionOf = (path: string): string | null => {
  const file = path.split("/").pop();
  if (!file || !file.includes(".")) {
    return null;
  }
  const ext = file.split(".").pop();
  return ext ? ext.toLowerCase() : null;
};

const patchNodeChildren = (
  nodes: TreeNodeDto[],
  nodePath: string,
  children: TreeNodeDto[]
): TreeNodeDto[] =>
  nodes.map((node) => {
    if (node.path === nodePath) {
      return { ...node, children };
    }

    if (node.children?.length) {
      return {
        ...node,
        children: patchNodeChildren(node.children, nodePath, children)
      };
    }

    return node;
  });

const findNodeByPath = (nodes: TreeNodeDto[], path: string): TreeNodeDto | null => {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    if (node.children?.length) {
      const child = findNodeByPath(node.children, path);
      if (child) {
        return child;
      }
    }
  }

  return null;
};

const includesTopLevelPath = (nodes: TreeNodeDto[], path: string): boolean =>
  nodes.some((node) => node.path === path);

const replacePathPrefix = (path: string, oldPrefix: string, newPrefix: string): string => {
  if (path === oldPrefix) {
    return newPrefix;
  }

  if (path.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`;
  }

  if (path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`;
  }

  return path;
};

const defaultSortDirections: Record<SortColumn, SortDirection> = {
  name: "asc",
  modified: "desc",
  size: "desc",
  kind: "asc"
};

const clampColumnWidth = (column: SortColumn, width: number): number => {
  const fallback = DEFAULT_COLUMN_WIDTHS[column];
  const value = Number.isFinite(width) ? width : fallback;
  return Math.max(MIN_COLUMN_WIDTHS[column], Math.round(value));
};

const clampColumnWidths = (widths: ColumnWidthsDto): ColumnWidthsDto => ({
  name: clampColumnWidth("name", widths.name),
  modified: clampColumnWidth("modified", widths.modified),
  size: clampColumnWidth("size", widths.size),
  kind: clampColumnWidth("kind", widths.kind)
});

const nextSortPreference = (
  current: SortPreferenceDto | null,
  column: SortColumn
): SortPreferenceDto => {
  if (current?.column !== column) {
    return {
      column,
      direction: defaultSortDirections[column]
    };
  }

  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc"
  };
};

const emptyFileOperationHistory = (): FileOperationHistoryDto => ({
  undo_stack: [],
  redo_stack: [],
  timeline: [],
  can_undo: false,
  can_redo: false
});

const selectionForHistoryResult = (
  result: FileOperationCommandResultDto
): { selectedPaths: string[]; focusedPath: string | null } => ({
  selectedPaths: result.affected_paths,
  focusedPath: result.affected_paths[0] ?? null
});

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  currentDir: "",
  pathInput: "",
  favorites: [],
  favoritesCollapsed: false,
  tree: [],
  historyPaths: [],
  historyIndex: -1,
  selectedPaths: [],
  focusedPath: null,
  expandedPaths: [],
  statusText: "Starting...",
  errorText: "",
  openWithMap: {},
  openWithIconMap: {},
  defaultFolderBrowserStatus: null,
  sortPreference: null,
  columnWidths: DEFAULT_COLUMN_WIDTHS,
  showHidden: false,
  draggingPaths: [],
  renameTargetPath: null,
  createDirectoryParentPath: null,
  pendingMoveConflict: null,
  fileOperationHistory: emptyFileOperationHistory(),
  isUndoRedoRunning: false,
  isHistoryPanelOpen: false,

  init: async () => {
    try {
      const data = await api.initState();
      set({
        currentDir: data.current_dir,
        pathInput: data.current_dir,
        favorites: data.favorites,
        favoritesCollapsed: data.favorites_collapsed ?? false,
        tree: data.tree,
        historyPaths: [data.current_dir],
        historyIndex: 0,
        openWithMap: data.open_with_map,
        sortPreference: data.sort_preference ?? null,
        columnWidths: clampColumnWidths(data.column_widths ?? DEFAULT_COLUMN_WIDTHS),
        showHidden: data.show_hidden,
        fileOperationHistory: data.file_operation_history ?? emptyFileOperationHistory(),
        statusText: "Ready",
        errorText: ""
      });
      await Promise.all([
        get().refreshOpenWithIcons(),
        get().refreshDefaultFolderBrowserStatus()
      ]);
    } catch (error) {
      set({
        statusText: "Error",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  setPathInput: (value) => {
    set({ pathInput: value });
  },

  changeDirectory: async (path, options) => {
    const addToHistory = options?.addToHistory ?? true;
    const focusPathAfterLoad = options?.focusPathAfterLoad;

    try {
      const data = await api.changeDirectory(path);
      set((state) => {
        let historyPaths = state.historyPaths;
        let historyIndex = state.historyIndex;

        if (addToHistory) {
          if (!historyPaths.length) {
            historyPaths = [data.current_dir];
            historyIndex = 0;
          } else if (historyPaths[historyIndex] !== data.current_dir) {
            historyPaths = [...historyPaths.slice(0, historyIndex + 1), data.current_dir];
            historyIndex = historyPaths.length - 1;
          }
        } else if (!historyPaths.length) {
          historyPaths = [data.current_dir];
          historyIndex = 0;
        }

        const loadedFocusPath =
          focusPathAfterLoad && includesTopLevelPath(data.tree, focusPathAfterLoad)
            ? focusPathAfterLoad
            : null;

        return {
          currentDir: data.current_dir,
          pathInput: data.current_dir,
          tree: data.tree,
          showHidden: data.show_hidden,
          historyPaths,
          historyIndex,
          selectedPaths: loadedFocusPath ? [loadedFocusPath] : [],
          focusedPath: loadedFocusPath,
          expandedPaths: [],
          statusText: `Opened ${data.current_dir}`,
          errorText: ""
        };
      });
    } catch (error) {
      set({
        statusText: "Path error",
        errorText: error instanceof Error ? error.message : String(error),
        focusedPath: null
      });
    }
  },

  goBack: async () => {
    const { currentDir, historyPaths, historyIndex, changeDirectory } = get();
    if (historyIndex > 0 && historyPaths.length) {
      const targetIndex = historyIndex - 1;
      const targetPath = historyPaths[targetIndex];
      if (!targetPath) {
        return;
      }

      await changeDirectory(targetPath, { addToHistory: false });
      if (get().currentDir === targetPath) {
        set({ historyIndex: targetIndex });
      }
      return;
    }

    const parentPath = parentDirectoryOf(currentDir);
    if (!parentPath || parentPath === currentDir) {
      return;
    }

    await changeDirectory(parentPath, { addToHistory: false });
    if (get().currentDir === parentPath) {
      set((state) => {
        if (state.historyPaths[0] === parentPath) {
          return { historyIndex: 0 };
        }

        return {
          historyPaths: [parentPath, ...state.historyPaths],
          historyIndex: 0
        };
      });
    }
  },

  goForward: async () => {
    const { historyPaths, historyIndex, changeDirectory } = get();
    if (historyIndex < 0 || historyIndex >= historyPaths.length - 1) {
      return;
    }

    const targetIndex = historyIndex + 1;
    const targetPath = historyPaths[targetIndex];
    if (!targetPath) {
      return;
    }

    await changeDirectory(targetPath, { addToHistory: false });
    if (get().currentDir === targetPath) {
      set({ historyIndex: targetIndex });
    }
  },

  goUp: async () => {
    const currentDir = get().currentDir;
    const parentPath = parentDirectoryOf(currentDir);
    if (!parentPath || parentPath === currentDir) {
      return;
    }

    await get().changeDirectory(parentPath, { focusPathAfterLoad: currentDir });
  },

  addFavorite: async (path) => {
    try {
      const favorites = await api.addFavorite(path);
      set({ favorites, statusText: "Favorite added", errorText: "" });
    } catch (error) {
      set({
        statusText: "Error",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  removeFavorite: async (path) => {
    try {
      const favorites = await api.removeFavorite(path);
      set({ favorites, statusText: "Favorite removed", errorText: "" });
    } catch (error) {
      set({
        statusText: "Error",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  setFavoritesCollapsed: async (collapsed) => {
    const previousCollapsed = get().favoritesCollapsed;
    set({ favoritesCollapsed: collapsed });

    try {
      await api.setFavoritesCollapsed(collapsed);
      set({ errorText: "" });
    } catch (error) {
      set({
        favoritesCollapsed: previousCollapsed,
        statusText: "Sidebar setting not saved",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  toggleExpand: async (path) => {
    const expandedPaths = get().expandedPaths;
    const isExpanded = expandedPaths.includes(path);

    if (isExpanded) {
      set({ expandedPaths: expandedPaths.filter((item) => item !== path) });
      return;
    }

    try {
      const children = await api.listChildren(path);
      set({
        expandedPaths: [...expandedPaths, path],
        tree: patchNodeChildren(get().tree, path, children),
        errorText: ""
      });
    } catch (error) {
      set({
        statusText: "Error",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  selectPath: (path, multi) => {
    const selected = get().selectedPaths;
    if (!multi) {
      set({ selectedPaths: [path] });
      return;
    }

    if (selected.includes(path)) {
      set({ selectedPaths: selected.filter((item) => item !== path) });
      return;
    }

    set({ selectedPaths: [...selected, path] });
  },

  clearSelection: () => {
    set({ selectedPaths: [] });
  },

  copySelection: async () => {
    const selected = get().selectedPaths;
    if (!selected.length) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "copy_selection_skipped",
        status: "nothing_selected"
      });
      set({ statusText: "Nothing selected" });
      return;
    }

    try {
      await api.copyToClipboard(selected);
      set({ statusText: `Copied ${selected.length} item(s)`, errorText: "" });
    } catch (error) {
      set({
        statusText: "Error",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  copySelectedPathsAsText: async () => {
    const selected = get().selectedPaths;
    if (!selected.length) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "copy_paths_as_text_skipped",
        status: "nothing_selected"
      });
      set({ statusText: "Nothing selected" });
      return;
    }

    try {
      await api.copyPathsAsText(selected);
      set({
        statusText: selected.length === 1 ? "Path copied" : `${selected.length} paths copied`,
        errorText: ""
      });
    } catch (error) {
      set({
        statusText: "Copy path failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  pasteIntoCurrent: async () => {
    const targetDir = get().currentDir;
    if (!targetDir) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "paste_skipped",
        status: "missing_current_dir"
      });
      return;
    }

    try {
      const result = await api.pasteInto(targetDir);
      await get().refreshTree();
      set({
        fileOperationHistory: result.history ?? get().fileOperationHistory,
        selectedPaths: result.success_paths,
        focusedPath: result.success_paths[0] ?? null,
        statusText: result.message,
        errorText: ""
      });
    } catch (error) {
      set({
        statusText: "Paste failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  startMoveDrop: async (paths, targetDir) => {
    try {
      const preview = await api.previewMoveItems(paths, targetDir);
      if (preview.conflicts.length > 0) {
        logUiEvent({
          component: "ExplorerStore",
          event_type: "move_conflict_dialog_opened",
          paths,
          target_dir: targetDir,
          details: {
            conflict_count: preview.conflicts.length,
            can_replace_all: preview.conflicts.every((conflict) => conflict.same_kind)
          }
        });
        set({
          pendingMoveConflict: { paths, targetDir, conflicts: preview.conflicts },
          statusText: "Choose how to handle name conflicts",
          errorText: ""
        });
        return;
      }

      await get().moveItems(paths, targetDir, "keep_both");
    } catch (error) {
      set({
        statusText: "Move failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  moveItems: async (paths, targetDir, conflictAction) => {
    try {
      const result = await api.moveItems(paths, targetDir, conflictAction);
      await get().refreshTree();
      set({
        pendingMoveConflict: null,
        fileOperationHistory: result.history ?? get().fileOperationHistory,
        selectedPaths: result.success_paths,
        focusedPath: result.success_paths[0] ?? null,
        statusText: result.message,
        errorText: ""
      });
    } catch (error) {
      set({
        statusText: "Move failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  confirmMoveConflict: async (conflictAction) => {
    const pending = get().pendingMoveConflict;
    if (!pending) {
      return;
    }

    if (
      conflictAction === "replace" &&
      pending.conflicts.some((conflict) => !conflict.same_kind)
    ) {
      set({
        statusText: "Replace unavailable",
        errorText: "Replace only works when the existing item is the same kind."
      });
      return;
    }

    logUiEvent({
      component: "ExplorerStore",
      event_type: "move_conflict_choice",
      paths: pending.paths,
      target_dir: pending.targetDir,
      status: conflictAction,
      details: { conflict_count: pending.conflicts.length }
    });
    await get().moveItems(pending.paths, pending.targetDir, conflictAction);
  },

  cancelMoveConflict: () => {
    const pending = get().pendingMoveConflict;
    if (pending) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "move_conflict_cancelled",
        paths: pending.paths,
        target_dir: pending.targetDir,
        details: { conflict_count: pending.conflicts.length }
      });
    }
    set({
      pendingMoveConflict: null,
      statusText: "Move cancelled",
      errorText: ""
    });
  },

  renameItem: async (path, newName) => {
    try {
      const result = await api.renameItem(path, newName);
      const newPath = result.path;
      const expandedPaths = get().expandedPaths.map((item) =>
        replacePathPrefix(item, path, newPath)
      );

      set({ expandedPaths });
      await get().refreshTree();
      set({
        selectedPaths: [newPath],
        focusedPath: newPath,
        fileOperationHistory: result.history,
        renameTargetPath: null,
        statusText: result.message,
        errorText: ""
      });
      return { ok: true };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      set({
        statusText: "Rename failed",
        errorText
      });
      return { ok: false, error: errorText };
    }
  },

  requestRename: (path) => {
    set({ renameTargetPath: path, errorText: "" });
  },

  requestRenameForSelection: () => {
    const selected = get().selectedPaths;

    if (selected.length === 0) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "rename_request_skipped",
        status: "nothing_selected"
      });
      set({ statusText: "Select one item to rename", errorText: "" });
      return;
    }

    if (selected.length > 1) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "rename_request_skipped",
        paths: selected,
        status: "too_many_selected",
        details: { selected_count: selected.length }
      });
      set({ statusText: "Select only one item to rename", errorText: "" });
      return;
    }

    const path = selected[0];
    if (!path || !findNodeByPath(get().tree, path)) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "rename_request_skipped",
        paths: path ? [path] : [],
        status: "selected_item_missing"
      });
      set({ statusText: "Selected item is not available", errorText: "" });
      return;
    }

    get().requestRename(path);
  },

  closeRenameDialog: () => {
    set({ renameTargetPath: null });
  },

  getCreateDirectoryParent: () => {
    const { currentDir, selectedPaths, tree } = get();

    if (selectedPaths.length === 1) {
      const selectedNode = findNodeByPath(tree, selectedPaths[0]);
      if (selectedNode?.is_dir) {
        return selectedNode.path;
      }
    }

    return currentDir || null;
  },

  createDirectory: async (parentDir, name) => {
    try {
      const result = await api.createDirectory(parentDir, name);
      const newPath = result.path;
      const { currentDir, expandedPaths } = get();
      const nextExpandedPaths =
        parentDir !== currentDir && !expandedPaths.includes(parentDir)
          ? [...expandedPaths, parentDir]
          : expandedPaths;

      if (nextExpandedPaths !== expandedPaths) {
        set({ expandedPaths: nextExpandedPaths });
      }

      await get().refreshTree();
      set({
        selectedPaths: [newPath],
        focusedPath: newPath,
        fileOperationHistory: result.history,
        createDirectoryParentPath: null,
        statusText: result.message,
        errorText: ""
      });
      return { ok: true };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      set({
        statusText: "Create folder failed",
        errorText
      });
      return { ok: false, error: errorText };
    }
  },

  requestCreateDirectory: (parentDir) => {
    if (!parentDir) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "create_directory_request_skipped",
        status: "missing_current_dir"
      });
      set({ statusText: "Open a folder to create a new folder", errorText: "" });
      return;
    }

    set({ createDirectoryParentPath: parentDir, errorText: "" });
  },

  closeCreateDirectoryDialog: () => {
    set({ createDirectoryParentPath: null });
  },

  loadFileOperationHistory: async () => {
    try {
      const fileOperationHistory = await api.getFileOperationHistory();
      set({ fileOperationHistory, errorText: "" });
    } catch (error) {
      set({
        statusText: "History load failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  undoFileOperation: async () => {
    if (get().isUndoRedoRunning) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "undo_skipped",
        status: "operation_running"
      });
      return;
    }

    set({ isUndoRedoRunning: true });
    try {
      const result = await api.undoFileOperation();
      await get().refreshTree();
      set({
        fileOperationHistory: result.history,
        ...selectionForHistoryResult(result),
        statusText: result.message,
        errorText: ""
      });
    } catch (error) {
      set({
        statusText: "Undo failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    } finally {
      set({ isUndoRedoRunning: false });
    }
  },

  redoFileOperation: async () => {
    if (get().isUndoRedoRunning) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "redo_skipped",
        status: "operation_running"
      });
      return;
    }

    set({ isUndoRedoRunning: true });
    try {
      const result = await api.redoFileOperation();
      await get().refreshTree();
      set({
        fileOperationHistory: result.history,
        ...selectionForHistoryResult(result),
        statusText: result.message,
        errorText: ""
      });
    } catch (error) {
      set({
        statusText: "Redo failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    } finally {
      set({ isUndoRedoRunning: false });
    }
  },

  setHistoryPanelOpen: (isHistoryPanelOpen) => {
    set({ isHistoryPanelOpen });
  },

  deleteSelection: async () => {
    const selected = get().selectedPaths;
    if (!selected.length) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "delete_selection_skipped",
        status: "nothing_selected"
      });
      set({ statusText: "Nothing selected" });
      return;
    }

    try {
      const result = await api.deleteToTrash(selected);
      await get().refreshTree();
      set({ selectedPaths: [], statusText: result.message, errorText: "" });
    } catch (error) {
      set({
        statusText: "Delete failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  openTerminalHere: async (path) => {
    try {
      await api.openTerminalHere(path);
      set({ statusText: "Terminal opened", errorText: "" });
    } catch (error) {
      set({
        statusText: "Terminal open failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  openPath: async (path, isDir) => {
    if (isDir) {
      await get().changeDirectory(path);
      return;
    }

    const ext = extensionOf(path);
    const currentMap = get().openWithMap;
    const mappedAppPath = openWithValueForExtension(currentMap, ext);
    let pickerFailed = false;
    let pickerErrorText = "";

    if (ext && !mappedAppPath) {
      try {
        const appPath = await api.chooseOpenWith(path);
        if (!appPath) {
          set({ statusText: "Open canceled", errorText: "" });
          return;
        }

        await api.setOpenWith(ext, appPath);
        set({ openWithMap: withOpenWithValueForAliases(get().openWithMap, ext, appPath) });
        await get().refreshOpenWithIcons();
      } catch (error) {
        pickerFailed = true;
        pickerErrorText = error instanceof Error ? error.message : String(error);
        set({
          statusText: "Picker failed, opening with default app",
          errorText: pickerErrorText
        });
      }
    }

    try {
      await api.openFile(path);
      set({
        statusText: pickerFailed ? "File opened with default app" : "File opened",
        errorText: pickerFailed ? pickerErrorText : ""
      });
    } catch (error) {
      set({
        statusText: "Open failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  sortByColumn: async (column) => {
    const sortPreference = nextSortPreference(get().sortPreference, column);
    set({ sortPreference });

    try {
      await api.setSortPreference(sortPreference);
      set({ errorText: "" });
    } catch (error) {
      set({
        statusText: "Sort not saved",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  setColumnWidth: (column, width) => {
    set((state) => ({
      columnWidths: clampColumnWidths({
        ...state.columnWidths,
        [column]: width
      })
    }));
  },

  saveColumnWidths: async (columnWidths) => {
    const nextColumnWidths = clampColumnWidths(columnWidths ?? get().columnWidths);
    set({ columnWidths: nextColumnWidths });

    try {
      await api.setColumnWidths(nextColumnWidths);
      set({ errorText: "" });
    } catch (error) {
      set({
        statusText: "Column widths not saved",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  setShowHidden: async (showHidden) => {
    const { currentDir, expandedPaths } = get();
    if (!currentDir) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "show_hidden_skipped",
        status: "missing_current_dir",
        details: { show_hidden: showHidden }
      });
      return;
    }

    const previousShowHidden = get().showHidden;
    set({
      showHidden,
      statusText: showHidden ? "Showing hidden files" : "Hiding hidden files"
    });

    try {
      const data = await api.setShowHidden(currentDir, showHidden, expandedPaths);
      set({
        currentDir: data.current_dir,
        pathInput: data.current_dir,
        tree: data.tree,
        showHidden: data.show_hidden,
        selectedPaths: [],
        focusedPath: null,
        statusText: data.show_hidden ? "Showing hidden files" : "Hiding hidden files",
        errorText: ""
      });
    } catch (error) {
      set({
        showHidden: previousShowHidden,
        statusText: "Hidden setting not saved",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  refreshOpenWithIcons: async () => {
    try {
      const iconMap = await api.getOpenWithIconMap();
      set({ openWithIconMap: iconMap });
    } catch {
      set({ openWithIconMap: {} });
    }
  },

  refreshDefaultFolderBrowserStatus: async () => {
    try {
      const defaultFolderBrowserStatus = await api.getDefaultFolderBrowserStatus();
      set((state) => ({
        defaultFolderBrowserStatus,
        statusText:
          !defaultFolderBrowserStatus.can_set &&
          !defaultFolderBrowserStatus.is_default &&
          defaultFolderBrowserStatus.message
            ? "Default folder browser unavailable"
            : state.statusText,
        errorText:
          !defaultFolderBrowserStatus.can_set &&
          !defaultFolderBrowserStatus.is_default &&
          defaultFolderBrowserStatus.message
            ? defaultFolderBrowserStatus.message
            : state.errorText
      }));
    } catch (error) {
      set({
        statusText: "Default folder browser check failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  setDefaultFolderBrowser: async () => {
    try {
      const defaultFolderBrowserStatus = await api.setDefaultFolderBrowser();
      set({
        defaultFolderBrowserStatus,
        statusText: defaultFolderBrowserStatus.is_default
          ? "Default folder browser set"
          : "Default folder browser not set",
        errorText: defaultFolderBrowserStatus.message ?? ""
      });
    } catch (error) {
      set({
        statusText: "Default folder browser failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  resetDefaultFolderBrowser: async () => {
    try {
      const defaultFolderBrowserStatus = await api.resetDefaultFolderBrowser();
      set({
        defaultFolderBrowserStatus,
        statusText: "Default folder browser reset",
        errorText: defaultFolderBrowserStatus.message ?? ""
      });
    } catch (error) {
      set({
        statusText: "Default folder browser reset failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  refreshTree: async () => {
    const { currentDir, expandedPaths } = get();
    if (!currentDir) {
      logUiEvent({
        component: "ExplorerStore",
        event_type: "refresh_tree_skipped",
        status: "missing_current_dir"
      });
      return;
    }

    try {
      const tree = await api.refreshTree(currentDir, expandedPaths);
      set({ tree, errorText: "" });
    } catch (error) {
      set({
        statusText: "Refresh failed",
        errorText: error instanceof Error ? error.message : String(error)
      });
    }
  },

  setDraggingPaths: (draggingPaths) => {
    set({ draggingPaths });
  },

  clearFocusedPath: () => {
    set({ focusedPath: null });
  }
}));
