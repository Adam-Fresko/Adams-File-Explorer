import { FormEvent, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  HistoryIcon,
  Redo2Icon,
  TerminalIcon,
  Undo2Icon
} from "lucide-react";

import { DefaultFolderBrowserControl } from "./DefaultFolderBrowserControl";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { logUiEvent } from "../lib/eventLog";
import { parentDirectoryOf } from "../lib/pathUtils";
import { useExplorerStore } from "../store/useExplorerStore";

type ToolbarButtonProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ToolbarButton({ label, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PathBar() {
  const currentDir = useExplorerStore((state) => state.currentDir);
  const pathInput = useExplorerStore((state) => state.pathInput);
  const historyIndex = useExplorerStore((state) => state.historyIndex);
  const historyLength = useExplorerStore((state) => state.historyPaths.length);
  const showHidden = useExplorerStore((state) => state.showHidden);
  const fileOperationHistory = useExplorerStore((state) => state.fileOperationHistory);
  const isUndoRedoRunning = useExplorerStore((state) => state.isUndoRedoRunning);
  const setPathInput = useExplorerStore((state) => state.setPathInput);
  const changeDirectory = useExplorerStore((state) => state.changeDirectory);
  const goBack = useExplorerStore((state) => state.goBack);
  const goForward = useExplorerStore((state) => state.goForward);
  const goUp = useExplorerStore((state) => state.goUp);
  const openTerminalHere = useExplorerStore((state) => state.openTerminalHere);
  const getCreateDirectoryParent = useExplorerStore(
    (state) => state.getCreateDirectoryParent
  );
  const requestCreateDirectory = useExplorerStore((state) => state.requestCreateDirectory);
  const undoFileOperation = useExplorerStore((state) => state.undoFileOperation);
  const redoFileOperation = useExplorerStore((state) => state.redoFileOperation);
  const setHistoryPanelOpen = useExplorerStore((state) => state.setHistoryPanelOpen);
  const setShowHidden = useExplorerStore((state) => state.setShowHidden);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyLength - 1;
  const canGoUp = !!parentDirectoryOf(currentDir);
  const canOpenTerminal = !!currentDir;
  const canCreateDirectory = !!currentDir;
  const canUndo = fileOperationHistory.can_undo && !isUndoRedoRunning;
  const canRedo = fileOperationHistory.can_redo && !isUndoRedoRunning;
  const canToggleHidden = !!currentDir;
  const hiddenFilesTooltipText = !canToggleHidden
    ? "Open a folder to change hidden files"
    : showHidden
      ? "Showing hidden files"
      : "Hiding hidden files";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!pathInput.trim()) {
      return;
    }
    logUiEvent({
      component: "PathBar",
      event_type: "path_submit",
      paths: [pathInput.trim()],
      target_dir: pathInput.trim()
    });
    await changeDirectory(pathInput.trim());
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex shrink-0 flex-col gap-2 border-b bg-background/95 px-3 py-2 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton
          label="Open Terminal Here"
          disabled={!canOpenTerminal}
          onClick={() => {
            logUiEvent({
              component: "PathBar",
              event_type: "open_terminal_clicked",
              paths: [currentDir],
              target_dir: currentDir
            });
            void openTerminalHere(currentDir);
          }}
        >
          <TerminalIcon />
        </ToolbarButton>

        <ToolbarButton
          label="New Folder"
          disabled={!canCreateDirectory}
          onClick={() => {
            const targetDir = getCreateDirectoryParent();
            logUiEvent({
              component: "PathBar",
              event_type: "new_folder_clicked",
              paths: targetDir ? [targetDir] : [],
              target_dir: targetDir,
              details: {
                target_source:
                  targetDir && targetDir !== currentDir ? "selected_folder" : "current_directory"
              }
            });
            requestCreateDirectory(targetDir ?? "");
          }}
        >
          <FolderPlusIcon />
        </ToolbarButton>

        <ToolbarButton
          label="Undo"
          disabled={!canUndo}
          onClick={() => {
            logUiEvent({
              component: "PathBar",
              event_type: "undo_clicked"
            });
            void undoFileOperation();
          }}
        >
          <Undo2Icon />
        </ToolbarButton>

        <ToolbarButton
          label="Redo"
          disabled={!canRedo}
          onClick={() => {
            logUiEvent({
              component: "PathBar",
              event_type: "redo_clicked"
            });
            void redoFileOperation();
          }}
        >
          <Redo2Icon />
        </ToolbarButton>

        <ToolbarButton
          label="History"
          onClick={() => {
            logUiEvent({
              component: "PathBar",
              event_type: "history_clicked"
            });
            setHistoryPanelOpen(true);
          }}
        >
          <HistoryIcon />
        </ToolbarButton>

        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex h-9 items-center gap-2 rounded-lg border bg-muted/35 px-2.5"
              title={hiddenFilesTooltipText}
            >
              {showHidden ? (
                <EyeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <EyeOffIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <label htmlFor="show-hidden" className="text-sm font-medium">
                Hidden files
              </label>
              <Switch
                id="show-hidden"
                checked={showHidden}
                disabled={!canToggleHidden}
                onCheckedChange={(checked) => {
                  logUiEvent({
                    component: "PathBar",
                    event_type: "show_hidden_toggle",
                    paths: [currentDir],
                    target_dir: currentDir,
                    details: { checked }
                  });
                  void setShowHidden(checked);
                }}
                aria-label="Show hidden files"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>{hiddenFilesTooltipText}</TooltipContent>
        </Tooltip>

        <DefaultFolderBrowserControl />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <ButtonGroup>
          <ToolbarButton
            label="Back"
            disabled={!canGoBack}
            onClick={() => {
              logUiEvent({
                component: "PathBar",
                event_type: "history_back_clicked",
                paths: [currentDir],
                target_dir: currentDir
              });
              void goBack();
            }}
          >
            <ArrowLeftIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Forward"
            disabled={!canGoForward}
            onClick={() => {
              logUiEvent({
                component: "PathBar",
                event_type: "history_forward_clicked",
                paths: [currentDir],
                target_dir: currentDir
              });
              void goForward();
            }}
          >
            <ArrowRightIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Up one directory"
            disabled={!canGoUp}
            onClick={() => {
              const targetDir = parentDirectoryOf(currentDir);
              logUiEvent({
                component: "PathBar",
                event_type: "go_up_clicked",
                paths: [currentDir],
                target_dir: targetDir ?? currentDir
              });
              void goUp();
            }}
          >
            <ArrowUpIcon />
          </ToolbarButton>
        </ButtonGroup>

        <label className="sr-only" htmlFor="path-input">
          Path
        </label>
        <Input
          id="path-input"
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          className="h-9 min-w-0 flex-1 font-mono"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </form>
  );
}
