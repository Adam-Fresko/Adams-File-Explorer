import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardPasteIcon,
  CopyIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HeartPlusIcon,
  PencilIcon,
  TerminalIcon,
  Trash2Icon
} from "lucide-react";

import { FileIcon } from "./FileIcon";
import { Button } from "./ui/button";
import {
  ContextMenu as ShadcnContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from "./ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "./ui/empty";
import { Input } from "./ui/input";
import { api } from "../lib/api";
import { logUiEvent } from "../lib/eventLog";
import { formatModified, formatSize } from "../lib/formatters";
import { openWithValueForExtension } from "../lib/openWithAliases";
import { parentDirectoryOf } from "../lib/pathUtils";
import type {
  SortColumn,
  SortDirection,
  SortPreferenceDto,
  TreeNodeDto
} from "../lib/types";
import { useExplorerStore, type NameDialogSubmitResult } from "../store/useExplorerStore";
import {
  flattenVisibleRows,
  getNodesByPaths,
  getTopLevelDraggedPaths,
  isValidMoveTarget,
  treeDropTargetData,
  type DropRejectReason,
  type ExplorerTreeRow,
  type RawTreeDropTarget
} from "./tree-dnd/treeData";
import { useTreeDragDrop, type TreeDragState } from "./tree-dnd/useTreeDragDrop";

type RowProps = {
  drag: ReturnType<typeof useTreeDragDrop>;
  gridStyle: CSSProperties;
  row: ExplorerTreeRow;
  setRowElement: (path: string, element: HTMLDivElement | null) => void;
};

const sortColumns: Array<{ column: SortColumn; label: string }> = [
  { column: "name", label: "Name" },
  { column: "modified", label: "Date Modified" },
  { column: "size", label: "Size" },
  { column: "kind", label: "Kind" }
];

const IMAGE_THUMBNAIL_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "heic",
  "heif",
  "tif",
  "tiff",
  "bmp"
]);

const imageThumbnailCache = new Map<string, string | null>();
const imageThumbnailRequests = new Map<string, Promise<string | null>>();

const extensionOfPath = (path: string): string | null => {
  const file = path.split("/").pop();
  if (!file || !file.includes(".")) {
    return null;
  }
  const extension = file.split(".").pop();
  return extension ? extension.toLowerCase() : null;
};

const fileNameOfPath = (path: string): string => {
  const normalized = path.replace(/[/\\]+$/, "");
  return normalized.split(/[/\\]/).pop() || path;
};

const kindText = (node: TreeNodeDto): string =>
  node.kind_label || (node.is_dir ? "Folder" : "File");

const thumbnailRequestKeyFor = (node: TreeNodeDto, extension: string | null): string | null => {
  if (node.is_dir || !extension || !IMAGE_THUMBNAIL_EXTENSIONS.has(extension)) {
    return null;
  }

  return [node.path, node.size_bytes ?? "", node.modified_unix_ms ?? ""].join("|");
};

function useImageThumbnail(node: TreeNodeDto, extension: string | null): string | null {
  const requestKey = thumbnailRequestKeyFor(node, extension);
  const [thumbnailState, setThumbnailState] = useState<{
    requestKey: string | null;
    dataUrl: string | null;
  }>({ requestKey: null, dataUrl: null });

  useEffect(() => {
    if (!requestKey) {
      setThumbnailState((current) =>
        current.requestKey === null && current.dataUrl === null
          ? current
          : { requestKey: null, dataUrl: null }
      );
      return;
    }

    if (imageThumbnailCache.has(requestKey)) {
      const dataUrl = imageThumbnailCache.get(requestKey) ?? null;
      setThumbnailState((current) =>
        current.requestKey === requestKey && current.dataUrl === dataUrl
          ? current
          : { requestKey, dataUrl }
      );
      return;
    }

    let isActive = true;
    setThumbnailState((current) =>
      current.requestKey === requestKey && current.dataUrl === null
        ? current
        : { requestKey, dataUrl: null }
    );

    let request = imageThumbnailRequests.get(requestKey);
    if (!request) {
      request = api
        .getImageThumbnail(node.path)
        .then((dataUrl) => dataUrl ?? null)
        .catch(() => null)
        .then((dataUrl) => {
          imageThumbnailCache.set(requestKey, dataUrl);
          return dataUrl;
        })
        .finally(() => {
          imageThumbnailRequests.delete(requestKey);
        });
      imageThumbnailRequests.set(requestKey, request);
    }

    request.then((dataUrl) => {
      if (isActive) {
        setThumbnailState({ requestKey, dataUrl });
      }
    });

    return () => {
      isActive = false;
    };
  }, [node.path, requestKey]);

  return thumbnailState.requestKey === requestKey ? thumbnailState.dataUrl : null;
}

const compareText = (a: string, b: string, direction: SortDirection): number => {
  const result = a.toLowerCase().localeCompare(b.toLowerCase());
  return direction === "asc" ? result : -result;
};

const compareOptionalNumber = (
  a: number | null | undefined,
  b: number | null | undefined,
  direction: SortDirection
): number => {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;

  if (aMissing || bMissing) {
    if (aMissing && bMissing) {
      return 0;
    }

    return aMissing ? 1 : -1;
  }

  const result = a - b;
  return direction === "asc" ? result : -result;
};

const compareNodes = (
  a: TreeNodeDto,
  b: TreeNodeDto,
  sortPreference: SortPreferenceDto
): number => {
  if (a.is_dir !== b.is_dir) {
    return a.is_dir ? -1 : 1;
  }

  let result = 0;

  if (sortPreference.column === "name") {
    result = compareText(a.name, b.name, sortPreference.direction);
  } else if (sortPreference.column === "modified") {
    result = compareOptionalNumber(
      a.modified_unix_ms,
      b.modified_unix_ms,
      sortPreference.direction
    );
  } else if (sortPreference.column === "size") {
    result = compareOptionalNumber(a.size_bytes, b.size_bytes, sortPreference.direction);
  } else {
    result = compareText(kindText(a), kindText(b), sortPreference.direction);
  }

  if (result !== 0) {
    return result;
  }

  const nameResult = compareText(a.name, b.name, "asc");
  return nameResult !== 0 ? nameResult : a.path.localeCompare(b.path);
};

const sortTree = (
  nodes: TreeNodeDto[],
  sortPreference: SortPreferenceDto | null
): TreeNodeDto[] => {
  if (!sortPreference) {
    return nodes;
  }

  return [...nodes]
    .sort((a, b) => compareNodes(a, b, sortPreference))
    .map((node) =>
      node.children?.length
        ? { ...node, children: sortTree(node.children, sortPreference) }
        : node
    );
};

const findTreeNodeByPath = (nodes: TreeNodeDto[], path: string): TreeNodeDto | null => {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    if (node.children?.length) {
      const child = findTreeNodeByPath(node.children, path);
      if (child) {
        return child;
      }
    }
  }

  return null;
};

const renameSelectionRangeFor = (node: TreeNodeDto): { start: number; end: number } => {
  if (node.is_dir) {
    return { start: node.name.length, end: node.name.length };
  }

  const lastDotIndex = node.name.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === node.name.length - 1) {
    return { start: 0, end: node.name.length };
  }

  return { start: 0, end: lastDotIndex };
};

type NameDialogProps = {
  open: boolean;
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  initialName: string;
  selectionRange: { start: number; end: number } | null;
  onSubmitName: (name: string) => Promise<NameDialogSubmitResult>;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
};

type SortHeaderProps = {
  column: SortColumn;
  label: string;
  canResize: boolean;
  onResizeStart: (column: SortColumn, event: ReactPointerEvent<HTMLButtonElement>) => void;
};

function SortHeader({ column, label, canResize, onResizeStart }: SortHeaderProps) {
  const sortPreference = useExplorerStore((state) => state.sortPreference);
  const sortByColumn = useExplorerStore((state) => state.sortByColumn);
  const isActive = sortPreference?.column === column;

  return (
    <div className="relative flex min-w-0 items-center pr-3">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => {
          logUiEvent({
            component: "TreeView",
            event_type: "sort_column_clicked",
            details: { column }
          });
          void sortByColumn(column);
        }}
        className="h-6 min-w-0 flex-1 justify-start px-1 text-left text-xs font-semibold uppercase text-muted-foreground hover:text-foreground"
        aria-label={`Sort by ${label}`}
      >
        <span className="truncate">{label}</span>
        <span
          className={`ml-auto flex size-3 items-center justify-center ${
            isActive ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
        >
          {sortPreference?.direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
        </span>
      </Button>
      {canResize ? (
        <button
          type="button"
          aria-label={`Resize ${label} column`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => onResizeStart(column, event)}
          className="group absolute right-0 top-[-8px] flex h-[calc(100%+16px)] w-4 cursor-col-resize touch-none items-center justify-center border-0 bg-transparent p-0 outline-none"
        >
          <span className="h-full w-px bg-border transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
        </button>
      ) : null}
    </div>
  );
}

function NameDialog({
  open,
  title,
  description,
  label,
  submitLabel,
  initialName,
  selectionRange,
  onSubmitName,
  onCancel,
  onOpenChange
}: NameDialogProps) {
  const [name, setName] = useState("");
  const [inlineError, setInlineError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectOnFocusRef = useRef(false);

  const selectInputRange = useCallback(() => {
    if (!selectionRange) {
      return;
    }

    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.setSelectionRange(selectionRange.start, selectionRange.end);
  }, [selectionRange]);

  const focusInputAndSelectRange = useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    selectOnFocusRef.current = true;
    input.focus();
    selectInputRange();
    window.requestAnimationFrame(() => {
      selectInputRange();
    });
  }, [selectInputRange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(initialName);
    setInlineError("");
    setIsSubmitting(false);
  }, [initialName, open]);

  useLayoutEffect(() => {
    if (!open || name !== initialName) {
      return;
    }

    focusInputAndSelectRange();
  }, [focusInputAndSelectRange, initialName, name, open]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSubmitName(name);
      if (result.ok) {
        setInlineError("");
        return;
      }

      setInlineError(result.error);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusInputAndSelectRange();
        }}
      >
        <form className="grid gap-5" onSubmit={onSubmit}>
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription className="text-base leading-7">
              {description}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor={inputId} className="text-sm font-medium text-foreground">
              {label}
            </label>
            <Input
              id={inputId}
              ref={inputRef}
              value={name}
              disabled={isSubmitting}
              aria-invalid={inlineError ? true : undefined}
              aria-describedby={inlineError ? errorId : undefined}
              onChange={(event) => {
                setName(event.target.value);
                if (inlineError) {
                  setInlineError("");
                }
              }}
              onFocus={() => {
                if (!selectOnFocusRef.current) {
                  return;
                }

                selectOnFocusRef.current = false;
                window.requestAnimationFrame(selectInputRange);
              }}
              className="h-11 text-base"
            />
            {inlineError ? (
              <p id={errorId} role="alert" className="m-0 text-sm font-medium text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                onCancel();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog() {
  const tree = useExplorerStore((state) => state.tree);
  const renameTargetPath = useExplorerStore((state) => state.renameTargetPath);
  const renameItem = useExplorerStore((state) => state.renameItem);
  const closeRenameDialog = useExplorerStore((state) => state.closeRenameDialog);

  const targetNode = useMemo(
    () => (renameTargetPath ? findTreeNodeByPath(tree, renameTargetPath) : null),
    [renameTargetPath, tree]
  );
  const selectionRange = targetNode ? renameSelectionRangeFor(targetNode) : null;

  useEffect(() => {
    if (!renameTargetPath || !targetNode) {
      return;
    }

    logUiEvent({
      component: "RenameDialog",
      event_type: "rename_dialog_opened",
      paths: [targetNode.path],
      details: { current_name: targetNode.name }
    });
  }, [renameTargetPath, targetNode]);

  useEffect(() => {
    if (renameTargetPath && !targetNode) {
      closeRenameDialog();
    }
  }, [closeRenameDialog, renameTargetPath, targetNode]);

  const closeDialog = useCallback(() => {
    if (targetNode) {
      logUiEvent({
        component: "RenameDialog",
        event_type: "rename_dialog_closed",
        paths: [targetNode.path],
        details: { current_name: targetNode.name }
      });
    }
    closeRenameDialog();
  }, [closeRenameDialog, targetNode]);

  const cancelDialog = useCallback(() => {
    if (targetNode) {
      logUiEvent({
        component: "RenameDialog",
        event_type: "rename_cancel_clicked",
        paths: [targetNode.path],
        details: { current_name: targetNode.name }
      });
    }
    closeRenameDialog();
  }, [closeRenameDialog, targetNode]);

  if (!targetNode) {
    return null;
  }

  return (
    <NameDialog
      open={!!renameTargetPath}
      title="Rename"
      description={`Enter a new name for '${targetNode.name}'.`}
      label="Name"
      submitLabel="Rename"
      initialName={targetNode.name}
      selectionRange={selectionRange}
      onSubmitName={async (name) => {
        logUiEvent({
          component: "RenameDialog",
          event_type: "rename_submitted",
          paths: [targetNode.path],
          details: {
            current_name: targetNode.name,
            new_name: name
          }
        });
        return renameItem(targetNode.path, name);
      }}
      onCancel={cancelDialog}
      onOpenChange={(open) => {
        if (!open) {
          closeDialog();
        }
      }}
    />
  );
}

function CreateDirectoryDialog() {
  const createDirectoryParentPath = useExplorerStore(
    (state) => state.createDirectoryParentPath
  );
  const createDirectory = useExplorerStore((state) => state.createDirectory);
  const closeCreateDirectoryDialog = useExplorerStore(
    (state) => state.closeCreateDirectoryDialog
  );
  const defaultName = "New Folder";

  useEffect(() => {
    if (!createDirectoryParentPath) {
      return;
    }

    logUiEvent({
      component: "CreateDirectoryDialog",
      event_type: "create_directory_dialog_opened",
      target_dir: createDirectoryParentPath,
      details: { default_name: defaultName }
    });
  }, [createDirectoryParentPath]);

  const closeDialog = useCallback(() => {
    if (createDirectoryParentPath) {
      logUiEvent({
        component: "CreateDirectoryDialog",
        event_type: "create_directory_dialog_closed",
        target_dir: createDirectoryParentPath
      });
    }
    closeCreateDirectoryDialog();
  }, [closeCreateDirectoryDialog, createDirectoryParentPath]);

  const cancelDialog = useCallback(() => {
    if (createDirectoryParentPath) {
      logUiEvent({
        component: "CreateDirectoryDialog",
        event_type: "create_directory_cancel_clicked",
        target_dir: createDirectoryParentPath
      });
    }
    closeCreateDirectoryDialog();
  }, [closeCreateDirectoryDialog, createDirectoryParentPath]);

  return (
    <NameDialog
      open={!!createDirectoryParentPath}
      title="New Folder"
      description="Enter a name for the new folder."
      label="Name"
      submitLabel="Create"
      initialName={defaultName}
      selectionRange={{ start: 0, end: defaultName.length }}
      onSubmitName={async (name) => {
        if (!createDirectoryParentPath) {
          return { ok: false, error: "Open a folder to create a new folder" };
        }

        logUiEvent({
          component: "CreateDirectoryDialog",
          event_type: "create_directory_submitted",
          target_dir: createDirectoryParentPath,
          details: { name }
        });
        return createDirectory(createDirectoryParentPath, name);
      }}
      onCancel={cancelDialog}
      onOpenChange={(open) => {
        if (!open) {
          closeDialog();
        }
      }}
    />
  );
}

type DragGhostProps = {
  currentDir: string;
  dragState: TreeDragState;
  tree: TreeNodeDto[];
};

function DragGhost({ currentDir, dragState, tree }: DragGhostProps) {
  if (dragState.mode === "idle" || !dragState.origin) {
    return null;
  }

  const draggedItems = getNodesByPaths(tree, dragState.draggedPaths, currentDir);
  const firstItem = draggedItems[0];
  const firstPath = dragState.draggedPaths[0] ?? "";
  const isReturning = dragState.mode === "snapback" && dragState.isReturning;
  const style: CSSProperties = {
    left: isReturning
      ? dragState.origin.left
      : (dragState.pointer?.x ?? dragState.origin.left) + 14,
    top: isReturning
      ? dragState.origin.top
      : (dragState.pointer?.y ?? dragState.origin.top) + 14,
    width: Math.min(dragState.origin.width, 320)
  };

  return (
    <div
      aria-hidden="true"
      className={`fixed z-50 grid min-h-9 max-w-80 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-xl transition-[left,top,opacity] duration-200 pointer-events-none ${
        isReturning ? "opacity-70" : "opacity-95"
      }`}
      style={style}
    >
      <FileIcon
        isDir={firstItem?.is_dir ?? false}
        kindLabel={firstItem ? kindText(firstItem) : "File"}
      />
      <span className="truncate">{firstItem?.name ?? fileNameOfPath(firstPath)}</span>
      {dragState.draggedPaths.length > 1 ? (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
          {dragState.draggedPaths.length}
        </span>
      ) : null}
    </div>
  );
}

function MoveConflictDialog() {
  const pendingMoveConflict = useExplorerStore((state) => state.pendingMoveConflict);
  const confirmMoveConflict = useExplorerStore((state) => state.confirmMoveConflict);
  const cancelMoveConflict = useExplorerStore((state) => state.cancelMoveConflict);
  const conflicts = pendingMoveConflict?.conflicts ?? [];
  const canReplace = conflicts.every((conflict) => conflict.same_kind);
  const visibleConflicts = conflicts.slice(0, 4);
  const hiddenCount = Math.max(0, conflicts.length - visibleConflicts.length);

  return (
    <Dialog
      open={!!pendingMoveConflict}
      onOpenChange={(open) => {
        if (!open) {
          cancelMoveConflict();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Name conflict</DialogTitle>
          <DialogDescription>
            Some items already exist in {fileNameOfPath(pendingMoveConflict?.targetDir ?? "")}.
            Replace cannot be undone here. Replaced items go to Trash.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          {visibleConflicts.map((conflict) => (
            <div key={`${conflict.source_path}->${conflict.target_path}`} className="min-w-0">
              <div className="truncate font-medium">{fileNameOfPath(conflict.target_path)}</div>
              <div className="text-xs text-muted-foreground">
                {conflict.same_kind ? "Can replace" : "Replace needs the same item kind"}
              </div>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <div className="text-xs text-muted-foreground">+{hiddenCount} more</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancelMoveConflict}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void confirmMoveConflict("keep_both");
            }}
          >
            Keep Both
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canReplace}
            onClick={() => {
              void confirmMoveConflict("replace");
            }}
          >
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreeRow({ drag, gridStyle, row, setRowElement }: RowProps) {
  const node = row.node;
  const depth = row.depth;
  const selectedPaths = useExplorerStore((state) => state.selectedPaths);
  const focusedPath = useExplorerStore((state) => state.focusedPath);
  const openWithIconMap = useExplorerStore((state) => state.openWithIconMap);
  const currentDir = useExplorerStore((state) => state.currentDir);
  const selectPath = useExplorerStore((state) => state.selectPath);
  const toggleExpand = useExplorerStore((state) => state.toggleExpand);
  const openPath = useExplorerStore((state) => state.openPath);
  const copySelection = useExplorerStore((state) => state.copySelection);
  const pasteIntoCurrent = useExplorerStore((state) => state.pasteIntoCurrent);
  const deleteSelection = useExplorerStore((state) => state.deleteSelection);
  const openTerminalHere = useExplorerStore((state) => state.openTerminalHere);
  const addFavorite = useExplorerStore((state) => state.addFavorite);
  const requestRename = useExplorerStore((state) => state.requestRename);
  const requestCreateDirectory = useExplorerStore((state) => state.requestCreateDirectory);
  const clearFocusedPath = useExplorerStore((state) => state.clearFocusedPath);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pendingRenamePathRef = useRef<string | null>(null);
  const pendingCreateDirectoryPathRef = useRef<string | null>(null);

  const isSelected = selectedPaths.includes(node.path);
  const isExpanded = row.isExpanded;
  const fileRowTargetDir = node.is_dir
    ? node.path
    : (row.parentPath ?? parentDirectoryOf(node.path) ?? currentDir);
  const dropTarget: RawTreeDropTarget = {
    component: "TreeRow",
    id: node.path,
    targetDir: fileRowTargetDir,
    targetIsDir: true,
    targetPath: node.path,
    targetSource: node.is_dir ? "folder_row" : "file_row_parent"
  };
  const isDropTarget = drag.dragState.target?.highlightPath === node.path;
  const isValidTarget = isDropTarget && drag.dragState.targetStatus === "valid";
  const isInvalidTarget = isDropTarget && drag.dragState.targetStatus === "invalid";
  const isDraggingSource = drag.dragState.draggedPaths.includes(node.path);
  const isActiveFileParentTarget =
    drag.dragState.activeTargetId === node.path &&
    drag.dragState.target?.targetSource === "file_row_parent";
  const dropHint =
    isActiveFileParentTarget
      ? `Drop into ${fileNameOfPath(dropTarget.targetDir)}`
      : null;
  const extension = node.is_dir ? null : extensionOfPath(node.path);
  const appIconDataUrl = openWithValueForExtension(openWithIconMap, extension);
  const thumbnailDataUrl = useImageThumbnail(node, extension);

  const rowStyle: CSSProperties = {
    paddingLeft: `${depth * 16 + 8}px`
  };

  const assignRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element;
      setRowElement(node.path, element);
    },
    [node.path, setRowElement]
  );

  useEffect(() => {
    if (focusedPath !== node.path) {
      return;
    }

    rowRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    rowRef.current?.focus();
    clearFocusedPath();
  }, [clearFocusedPath, focusedPath, node.path]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (drag.consumeSuppressedClick() || drag.dragState.mode !== "idle") {
      event.preventDefault();
      return;
    }

    logUiEvent({
      component: "TreeRow",
      event_type: "row_selected",
      paths: [node.path],
      details: {
        is_dir: node.is_dir,
        multi: event.metaKey || event.ctrlKey || event.shiftKey
      }
    });
    selectPath(node.path, event.metaKey || event.ctrlKey || event.shiftKey);
  };

  const onDoubleClick = () => {
    if (drag.dragState.mode !== "idle") {
      return;
    }

    logUiEvent({
      component: "TreeRow",
      event_type: "row_opened",
      paths: [node.path],
      target_dir: node.is_dir ? node.path : undefined,
      details: { is_dir: node.is_dir }
    });
    void openPath(node.path, node.is_dir);
  };

  const onContextMenu = () => {
    logUiEvent({
      component: "TreeRow",
      event_type: "context_menu_opened",
      paths: [node.path],
      details: { is_dir: node.is_dir }
    });
    selectPath(node.path, false);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-tree-toggle]")) {
      return;
    }

    if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !isSelected) {
      selectPath(node.path, false);
    }

    drag.startPointerDrag(event, node.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (drag.dragState.mode === "keyboard") {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        drag.moveKeyboardTarget(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        drag.moveKeyboardTarget(-1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        drag.dropKeyboardDrag();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        drag.cancelDrag();
      }

      return;
    }

    if (
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      if (!isSelected) {
        selectPath(node.path, false);
      }
      drag.startKeyboardDrag(node.path, rowRef.current);
    }
  };

  return (
    <>
      <ShadcnContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={assignRowRef}
            role="button"
            tabIndex={0}
            {...treeDropTargetData(dropTarget)}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            style={gridStyle}
            title={node.is_dir ? undefined : node.name}
            className={`grid min-h-8 cursor-default select-none items-center rounded-md px-2 py-1 text-sm outline-none transition-colors touch-none focus-visible:ring-3 focus-visible:ring-ring/40 ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted/70 focus-visible:bg-muted/70"
            } ${isDraggingSource ? "opacity-50" : ""} ${
              isValidTarget ? "bg-primary/10 text-foreground ring-2 ring-primary/70" : ""
            } ${
              isInvalidTarget ? "bg-destructive/10 text-foreground ring-2 ring-destructive/70" : ""
            }`}
          >
            <div className="flex min-w-0 items-center gap-2" style={rowStyle}>
              {node.is_dir ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    logUiEvent({
                      component: "TreeRow",
                      event_type: isExpanded ? "folder_collapse_clicked" : "folder_expand_clicked",
                      paths: [node.path],
                      target_dir: node.path
                    });
                    void toggleExpand(node.path);
                  }}
                  className={`shrink-0 ${
                    isSelected
                      ? "text-primary-foreground/90 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                  aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                  data-tree-toggle
                >
                  {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </Button>
              ) : (
                <span className="inline-block size-6 shrink-0" />
              )}
              <FileIcon
                isDir={node.is_dir}
                kindLabel={node.kind_label}
                appIconDataUrl={appIconDataUrl}
                thumbnailDataUrl={thumbnailDataUrl ?? undefined}
              />
              <span className="truncate">{node.name}</span>
            </div>
            <span
              className={`truncate text-xs ${
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
              }`}
            >
              {formatModified(node.modified_unix_ms)}
            </span>
            <span
              className={`truncate text-xs ${
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
              }`}
            >
              {formatSize(node.size_bytes)}
            </span>
            <span
              className={`truncate text-xs ${
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
              }`}
            >
              {(dropHint ?? node.kind_label) || (node.is_dir ? "Folder" : "File")}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onCloseAutoFocus={(event) => {
            const pendingRenamePath = pendingRenamePathRef.current;
            const pendingCreateDirectoryPath = pendingCreateDirectoryPathRef.current;
            if (pendingRenamePath) {
              pendingRenamePathRef.current = null;
              event.preventDefault();
              window.setTimeout(() => requestRename(pendingRenamePath), 0);
              return;
            }

            if (pendingCreateDirectoryPath) {
              pendingCreateDirectoryPathRef.current = null;
              event.preventDefault();
              window.setTimeout(() => requestCreateDirectory(pendingCreateDirectoryPath), 0);
            }
          }}
        >
          <ContextMenuItem
            onSelect={() => {
              logUiEvent({
                component: "TreeRow",
                event_type: "context_open_selected",
                paths: [node.path],
                target_dir: node.is_dir ? node.path : undefined,
                details: { is_dir: node.is_dir }
              });
              void openPath(node.path, node.is_dir);
            }}
          >
            <FolderOpenIcon />
            Open
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              logUiEvent({
                component: "TreeRow",
                event_type: "context_rename_selected",
                paths: [node.path]
              });
              pendingRenamePathRef.current = node.path;
            }}
          >
            <PencilIcon />
            Rename
            <ContextMenuShortcut>Shift+F6</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const targetDir = node.is_dir ? node.path : currentDir;
              logUiEvent({
                component: "TreeRow",
                event_type: "context_new_folder_selected",
                paths: [targetDir],
                target_dir: targetDir,
                details: { target_is_row_dir: node.is_dir }
              });
              pendingCreateDirectoryPathRef.current = targetDir;
            }}
          >
            <FolderPlusIcon />
            New Folder
            <ContextMenuShortcut>Cmd+Shift+N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              logUiEvent({
                component: "TreeRow",
                event_type: "context_copy_selected",
                paths: selectedPaths.length ? selectedPaths : [node.path],
                details: { selected_count: selectedPaths.length }
              });
              void copySelection();
            }}
          >
            <CopyIcon />
            Copy
            <ContextMenuShortcut>Cmd+C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              logUiEvent({
                component: "TreeRow",
                event_type: "context_paste_selected",
                target_dir: currentDir
              });
              void pasteIntoCurrent();
            }}
          >
            <ClipboardPasteIcon />
            Paste here
            <ContextMenuShortcut>Cmd+V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              logUiEvent({
                component: "TreeRow",
                event_type: "context_delete_selected",
                paths: selectedPaths.length ? selectedPaths : [node.path],
                details: { selected_count: selectedPaths.length }
              });
              void deleteSelection();
            }}
          >
            <Trash2Icon />
            Move to Trash (1)
          </ContextMenuItem>
          {node.is_dir ? (
            <ContextMenuItem
              onSelect={() => {
                logUiEvent({
                  component: "TreeRow",
                  event_type: "context_open_terminal_selected",
                  paths: [node.path],
                  target_dir: node.path
                });
                void openTerminalHere(node.path);
              }}
            >
              <TerminalIcon />
              Open Terminal Here
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem
            onSelect={() => {
              const favoritePath = node.is_dir ? node.path : currentDir;
              logUiEvent({
                component: "TreeRow",
                event_type: "context_add_favorite_selected",
                paths: [favoritePath],
                target_dir: favoritePath
              });
              void addFavorite(node.is_dir ? node.path : currentDir);
            }}
          >
            <HeartPlusIcon />
            Add to Favorites
          </ContextMenuItem>
        </ContextMenuContent>
      </ShadcnContextMenu>

    </>
  );
}

export function TreeView() {
  const tree = useExplorerStore((state) => state.tree);
  const currentDir = useExplorerStore((state) => state.currentDir);
  const expandedPaths = useExplorerStore((state) => state.expandedPaths);
  const sortPreference = useExplorerStore((state) => state.sortPreference);
  const columnWidths = useExplorerStore((state) => state.columnWidths);
  const startMoveDrop = useExplorerStore((state) => state.startMoveDrop);
  const setDraggingPaths = useExplorerStore((state) => state.setDraggingPaths);
  const toggleExpand = useExplorerStore((state) => state.toggleExpand);
  const setColumnWidth = useExplorerStore((state) => state.setColumnWidth);
  const saveColumnWidths = useExplorerStore((state) => state.saveColumnWidths);
  const treeContainerRef = useRef<HTMLElement | null>(null);
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const resizeStateRef = useRef<{
    column: SortColumn;
    startX: number;
    startWidth: number;
  } | null>(null);
  const previousBodyCursorRef = useRef("");
  const previousBodyUserSelectRef = useRef("");
  const sortedTree = useMemo(() => sortTree(tree, sortPreference), [tree, sortPreference]);
  const visibleRows = useMemo(
    () => flattenVisibleRows(sortedTree, expandedPaths, currentDir || null),
    [currentDir, expandedPaths, sortedTree]
  );
  const gridTemplateColumns = useMemo(
    () =>
      `${columnWidths.name}px ${columnWidths.modified}px ${columnWidths.size}px ${columnWidths.kind}px`,
    [columnWidths]
  );
  const totalColumnWidth =
    columnWidths.name + columnWidths.modified + columnWidths.size + columnWidths.kind;
  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns }),
    [gridTemplateColumns]
  );
  const listStyle = useMemo<CSSProperties>(
    () => ({ minWidth: `${totalColumnWidth + 32}px` }),
    [totalColumnWidth]
  );
  const currentDirDropTarget: RawTreeDropTarget | null = currentDir
    ? {
        component: "TreeView",
        id: `current:${currentDir}`,
        targetDir: currentDir,
        targetIsDir: true,
        targetPath: currentDir,
        targetSource: "current_folder"
      }
    : null;

  const setRowElement = useCallback((path: string, element: HTMLDivElement | null) => {
    if (element) {
      rowElementsRef.current.set(path, element);
      return;
    }

    rowElementsRef.current.delete(path);
  }, []);

  const focusRow = useCallback((path: string) => {
    window.requestAnimationFrame(() => {
      rowElementsRef.current.get(path)?.focus();
    });
  }, []);

  const getDraggedPaths = useCallback((rowPath: string) => {
    const selectedPaths = useExplorerStore.getState().selectedPaths;
    return selectedPaths.includes(rowPath) ? selectedPaths : [rowPath];
  }, []);

  const onDragStart = useCallback(
    ({ draggedPaths, startPath }: { draggedPaths: string[]; startPath: string }) => {
      logUiEvent({
        component: "TreeRow",
        event_type: "drag_started",
        paths: draggedPaths,
        details: {
          start_path: startPath,
          item_count: draggedPaths.length
        }
      });
      setDraggingPaths(draggedPaths);
    },
    [setDraggingPaths]
  );

  const onDrop = useCallback(
    ({
      draggedPaths,
      target
    }: {
      draggedPaths: string[];
      target: Extract<NonNullable<TreeDragState["target"]>, { allowed: true }>;
    }) => {
      const topLevelDraggedPaths = getTopLevelDraggedPaths(
        sortedTree,
        draggedPaths,
        currentDir || null
      );

      logUiEvent({
        component: target.component,
        event_type: "drop_attempted",
        paths: topLevelDraggedPaths,
        target_dir: target.targetDir,
        details: {
          item_count: topLevelDraggedPaths.length,
          target_source: target.targetSource
        }
      });
      void startMoveDrop(topLevelDraggedPaths, target.targetDir);
      setDraggingPaths([]);
    },
    [currentDir, setDraggingPaths, sortedTree, startMoveDrop]
  );

  const onReject = useCallback(
    ({
      draggedPaths,
      reason,
      target
    }: {
      draggedPaths: string[];
      reason: DropRejectReason;
      target: TreeDragState["target"];
    }) => {
      const eventType =
        reason === "missing_target" ? "drag_ended_without_drop" : "drop_rejected";
      logUiEvent({
        component: target?.component ?? "TreeView",
        event_type: eventType,
        paths: draggedPaths,
        target_dir: target?.targetDir ?? undefined,
        target_path: target?.targetPath ?? undefined,
        status: reason,
        details: {
          item_count: draggedPaths.length,
          target_source: target?.targetSource ?? null
        }
      });
      setDraggingPaths([]);
    },
    [setDraggingPaths]
  );

  const onCancel = useCallback(
    ({ draggedPaths }: { draggedPaths: string[] }) => {
      logUiEvent({
        component: "TreeView",
        event_type: "drag_cancelled",
        paths: draggedPaths,
        details: { item_count: draggedPaths.length }
      });
      setDraggingPaths([]);
    },
    [setDraggingPaths]
  );

  const onAutoExpand = useCallback(
    (folderPath: string) => {
      logUiEvent({
        component: "TreeRow",
        event_type: "drag_hover_expand",
        paths: useExplorerStore.getState().draggingPaths,
        target_dir: folderPath
      });
      void toggleExpand(folderPath);
    },
    [toggleExpand]
  );

  const drag = useTreeDragDrop({
    nodes: sortedTree,
    rows: visibleRows,
    currentDir: currentDir || null,
    expandedPaths,
    containerRef: treeContainerRef,
    getDraggedPaths,
    onDragStart,
    onDrop,
    onReject,
    onCancel,
    onAutoExpand,
    onFocusTarget: focusRow
  });

  const isActiveDrag = drag.dragState.mode !== "idle" && drag.dragState.mode !== "snapback";
  const isCurrentDirDropTarget =
    !!currentDir &&
    drag.dragState.target?.targetDir === currentDir &&
    !drag.dragState.target?.highlightPath;
  const isCurrentDirValidTarget =
    isCurrentDirDropTarget && drag.dragState.targetStatus === "valid";
  const isCurrentDirInvalidTarget =
    isCurrentDirDropTarget && drag.dragState.targetStatus === "invalid";

  useEffect(() => {
    const applyResize = (clientX: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      setColumnWidth(
        resizeState.column,
        resizeState.startWidth + clientX - resizeState.startX
      );
    };

    const finishResize = (clientX: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      applyResize(clientX);
      const nextWidth =
        resizeState.startWidth + clientX - resizeState.startX;
      resizeStateRef.current = null;
      document.body.style.cursor = previousBodyCursorRef.current;
      document.body.style.userSelect = previousBodyUserSelectRef.current;
      logUiEvent({
        component: "TreeView",
        event_type: "column_resize_finished",
        details: {
          column: resizeState.column,
          start_width: resizeState.startWidth,
          next_width: nextWidth
        }
      });
      void saveColumnWidths();
    };

    const onPointerMove = (event: PointerEvent) => {
      applyResize(event.clientX);
    };

    const onPointerEnd = (event: PointerEvent) => {
      finishResize(event.clientX);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);

      if (resizeStateRef.current) {
        resizeStateRef.current = null;
        document.body.style.cursor = previousBodyCursorRef.current;
        document.body.style.userSelect = previousBodyUserSelectRef.current;
      }
    };
  }, [saveColumnWidths, setColumnWidth]);

  const onResizeStart = (
    column: SortColumn,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    previousBodyCursorRef.current = document.body.style.cursor;
    previousBodyUserSelectRef.current = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    resizeStateRef.current = {
      column,
      startX: event.clientX,
      startWidth: useExplorerStore.getState().columnWidths[column]
    };
    logUiEvent({
      component: "TreeView",
      event_type: "column_resize_started",
      details: {
        column,
        start_width: resizeStateRef.current.startWidth
      }
    });
  };

  return (
    <>
      <section
        ref={treeContainerRef}
        {...(currentDirDropTarget ? treeDropTargetData(currentDirDropTarget) : {})}
        className={`min-h-0 flex-1 overflow-auto bg-background pb-3 transition-colors ${
          isCurrentDirValidTarget
            ? "bg-primary/5 ring-2 ring-inset ring-primary/60"
            : isCurrentDirInvalidTarget
              ? "bg-destructive/5 ring-2 ring-inset ring-destructive/60"
              : isActiveDrag && currentDir && isValidMoveTarget(drag.dragState.draggedPaths, currentDir)
              ? "bg-muted/20"
              : ""
        }`}
      >
        {sortedTree.length ? (
          <div style={listStyle}>
            <div
              style={gridStyle}
              className="sticky top-0 z-10 grid border-b bg-background/95 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground backdrop-blur"
            >
              {sortColumns.map(({ column, label }, index) => (
                <SortHeader
                  key={column}
                  column={column}
                  label={label}
                  canResize={index < sortColumns.length - 1}
                  onResizeStart={onResizeStart}
                />
              ))}
            </div>
            <div className="px-2 pt-1.5">
              {visibleRows.map((row) => (
                <TreeRow
                  key={row.id}
                  drag={drag}
                  gridStyle={gridStyle}
                  row={row}
                  setRowElement={setRowElement}
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            <Empty className="h-full border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderOpenIcon />
                </EmptyMedia>
                <EmptyTitle>Folder is empty</EmptyTitle>
                <EmptyDescription>No files in this folder.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </>
        )}
      </section>
      <RenameDialog />
      <CreateDirectoryDialog />
      <MoveConflictDialog />
      <DragGhost currentDir={currentDir} dragState={drag.dragState} tree={sortedTree} />
    </>
  );
}
