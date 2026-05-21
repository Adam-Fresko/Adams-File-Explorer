import { useEffect } from "react";

import { FavoritesPanel } from "./components/FavoritesPanel";
import { OperationHistorySheet } from "./components/OperationHistorySheet";
import { PathBar } from "./components/PathBar";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { StatusBar } from "./components/StatusBar";
import { TooltipProvider } from "./components/ui/tooltip";
import { TreeView } from "./components/TreeView";
import { api } from "./lib/api";
import { logUiEvent } from "./lib/eventLog";
import { useExplorerStore } from "./store/useExplorerStore";

const isEditableTarget = (target: EventTarget | null) => {
  if (!target) {
    return false;
  }

  if (target instanceof HTMLInputElement) {
    return !target.disabled;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return !target.disabled;
  }

  return target instanceof HTMLElement && target.isContentEditable;
};

const hasTextSelection = (target: EventTarget | null) => {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = target;
    return selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd;
  }

  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
};

export default function App() {
  const changeDirectory = useExplorerStore((state) => state.changeDirectory);
  const init = useExplorerStore((state) => state.init);
  const copySelection = useExplorerStore((state) => state.copySelection);
  const copySelectedPathsAsText = useExplorerStore((state) => state.copySelectedPathsAsText);
  const pasteIntoCurrent = useExplorerStore((state) => state.pasteIntoCurrent);
  const deleteSelection = useExplorerStore((state) => state.deleteSelection);
  const requestRenameForSelection = useExplorerStore((state) => state.requestRenameForSelection);
  const getCreateDirectoryParent = useExplorerStore(
    (state) => state.getCreateDirectoryParent
  );
  const requestCreateDirectory = useExplorerStore((state) => state.requestCreateDirectory);
  const undoFileOperation = useExplorerStore((state) => state.undoFileOperation);
  const redoFileOperation = useExplorerStore((state) => state.redoFileOperation);
  const refreshTree = useExplorerStore((state) => state.refreshTree);
  const currentDir = useExplorerStore((state) => state.currentDir);
  const favoritesCollapsed = useExplorerStore((state) => state.favoritesCollapsed);
  const setFavoritesCollapsed = useExplorerStore((state) => state.setFavoritesCollapsed);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    api
      .onOpenPath((path) => {
        logUiEvent({
          component: "App",
          event_type: "open_path_event_received",
          paths: [path],
          target_dir: path
        });
        void changeDirectory(path);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      if (unlisten) {
        void unlisten();
      }
    };
  }, [changeDirectory]);

  useEffect(() => {
    logUiEvent({
      component: "App",
      event_type: "app_init_requested"
    });
    void init();
  }, [init]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    api
      .onFsChanged((path) => {
        logUiEvent({
          component: "App",
          event_type: "fs_change_refresh_scheduled",
          paths: [path]
        });
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          void refreshTree();
        }, 180);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (unlisten) {
        void unlisten();
      }
    };
  }, [refreshTree]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        const targetDir = getCreateDirectoryParent();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          paths: targetDir ? [targetDir] : [],
          target_dir: targetDir,
          details: {
            action: "new_folder",
            key: "CmdOrCtrl+Shift+N",
            target_source:
              targetDir && targetDir !== currentDir ? "selected_folder" : "current_directory"
          }
        });
        requestCreateDirectory(targetDir ?? "");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "redo_file_operation", key: "CmdOrCtrl+Shift+Z" }
        });
        void redoFileOperation();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "redo_file_operation", key: "CmdOrCtrl+Y" }
        });
        void redoFileOperation();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "undo_file_operation", key: "CmdOrCtrl+Z" }
        });
        void undoFileOperation();
        return;
      }

      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.shiftKey &&
        event.key === "F6"
      ) {
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "rename_selection", key: "Shift+F6" }
        });
        requestRenameForSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "c") {
        if (hasTextSelection(event.target)) {
          return;
        }
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "copy_selected_paths_as_text", key: "CmdOrCtrl+Shift+C" }
        });
        void copySelectedPathsAsText();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        if (hasTextSelection(event.target)) {
          return;
        }
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "copy_selection", key: "CmdOrCtrl+C" }
        });
        void copySelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "paste_into_current", key: "CmdOrCtrl+V" }
        });
        void pasteIntoCurrent();
        return;
      }

      if (event.key === "Delete" || ((event.metaKey || event.ctrlKey) && event.key === "Backspace")) {
        event.preventDefault();
        logUiEvent({
          component: "App",
          event_type: "keyboard_shortcut",
          details: { action: "delete_selection", key: event.key }
        });
        void deleteSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    copySelection,
    copySelectedPathsAsText,
    currentDir,
    pasteIntoCurrent,
    deleteSelection,
    getCreateDirectoryParent,
    redoFileOperation,
    requestCreateDirectory,
    requestRenameForSelection,
    undoFileOperation
  ]);

  return (
    <TooltipProvider>
      <SidebarProvider
        open={!favoritesCollapsed}
        onOpenChange={(open) => {
          logUiEvent({
            component: "App",
            event_type: "favorites_sidebar_toggle",
            details: { open }
          });
          void setFavoritesCollapsed(!open);
        }}
        className="h-screen min-h-0 overflow-hidden bg-background text-foreground"
      >
        <FavoritesPanel />
        <SidebarInset className="h-screen min-h-0 overflow-hidden">
          <PathBar />
          <TreeView />
          <StatusBar />
          <OperationHistorySheet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
