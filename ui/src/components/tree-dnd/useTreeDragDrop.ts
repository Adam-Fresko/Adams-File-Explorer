import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { TreeNodeDto } from "../../lib/types";
import {
  type DropRejectReason,
  type ExplorerTreeRow,
  type RawTreeDropTarget,
  type ResolvedTreeDropTarget,
  rawDropTargetFromElement,
  resolveDropTarget
} from "./treeData";

type Point = {
  x: number;
  y: number;
};

type DragOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TargetStatus = "none" | "valid" | "invalid";

export type TreeDragState = {
  mode: "idle" | "pointer" | "keyboard" | "snapback";
  draggedPaths: string[];
  activeTargetId: string | null;
  target: ResolvedTreeDropTarget | null;
  targetStatus: TargetStatus;
  reason: DropRejectReason | null;
  pointer: Point | null;
  origin: DragOrigin | null;
  isReturning: boolean;
};

type PendingPointerDrag = {
  rowPath: string;
  draggedPaths: string[];
  startX: number;
  startY: number;
  origin: DragOrigin;
  hasStarted: boolean;
};

type TreeDropEvent = {
  draggedPaths: string[];
  target: Extract<ResolvedTreeDropTarget, { allowed: true }>;
};

type TreeRejectEvent = {
  draggedPaths: string[];
  target: ResolvedTreeDropTarget | null;
  reason: DropRejectReason;
};

type UseTreeDragDropOptions = {
  nodes: TreeNodeDto[];
  rows: ExplorerTreeRow[];
  currentDir: string | null;
  expandedPaths: string[];
  containerRef: RefObject<HTMLElement | null>;
  getDraggedPaths: (rowPath: string) => string[];
  onDragStart: (event: { draggedPaths: string[]; startPath: string }) => void;
  onDrop: (event: TreeDropEvent) => void;
  onReject: (event: TreeRejectEvent) => void;
  onCancel: (event: { draggedPaths: string[] }) => void;
  onAutoExpand: (folderPath: string) => void;
  onFocusTarget: (rowPath: string) => void;
};

const DRAG_START_DISTANCE = 5;
const AUTO_EXPAND_DELAY = 650;
const SNAP_BACK_DURATION = 220;

function createIdleDragState(): TreeDragState {
  return {
    mode: "idle",
    draggedPaths: [],
    activeTargetId: null,
    target: null,
    targetStatus: "none",
    reason: null,
    pointer: null,
    origin: null,
    isReturning: false
  };
}

function getElementRect(element: HTMLElement): DragOrigin {
  const rect = element.getBoundingClientRect();

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
}

export function useTreeDragDrop({
  nodes,
  rows,
  currentDir,
  expandedPaths,
  containerRef,
  getDraggedPaths,
  onDragStart,
  onDrop,
  onReject,
  onCancel,
  onAutoExpand,
  onFocusTarget
}: UseTreeDragDropOptions) {
  const [dragState, setDragState] = useState<TreeDragState>(createIdleDragState);

  const dragStateRef = useRef(dragState);
  const nodesRef = useRef(nodes);
  const rowsRef = useRef(rows);
  const currentDirRef = useRef(currentDir);
  const expandedPathsRef = useRef(expandedPaths);
  const containerRefRef = useRef(containerRef);
  const getDraggedPathsRef = useRef(getDraggedPaths);
  const onDragStartRef = useRef(onDragStart);
  const onDropRef = useRef(onDrop);
  const onRejectRef = useRef(onReject);
  const onCancelRef = useRef(onCancel);
  const onAutoExpandRef = useRef(onAutoExpand);
  const onFocusTargetRef = useRef(onFocusTarget);
  const pendingPointerRef = useRef<PendingPointerDrag | null>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const autoExpandTargetRef = useRef<string | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const snapBackTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    nodesRef.current = nodes;
    rowsRef.current = rows;
    currentDirRef.current = currentDir;
    expandedPathsRef.current = expandedPaths;
    containerRefRef.current = containerRef;
    getDraggedPathsRef.current = getDraggedPaths;
    onDragStartRef.current = onDragStart;
    onDropRef.current = onDrop;
    onRejectRef.current = onReject;
    onCancelRef.current = onCancel;
    onAutoExpandRef.current = onAutoExpand;
    onFocusTargetRef.current = onFocusTarget;
  }, [
    nodes,
    rows,
    currentDir,
    expandedPaths,
    containerRef,
    getDraggedPaths,
    onDragStart,
    onDrop,
    onReject,
    onCancel,
    onAutoExpand,
    onFocusTarget
  ]);

  const setDrag = useCallback(
    (nextOrUpdater: TreeDragState | ((current: TreeDragState) => TreeDragState)) => {
      const next =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(dragStateRef.current)
          : nextOrUpdater;

      dragStateRef.current = next;
      setDragState(next);
    },
    []
  );

  const clearAutoExpand = useCallback(() => {
    if (autoExpandTimerRef.current) {
      window.clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }

    autoExpandTargetRef.current = null;
  }, []);

  const stopAutoScroll = useCallback(() => {
    autoScrollSpeedRef.current = 0;

    if (autoScrollTimerRef.current) {
      window.clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) {
      return;
    }

    autoScrollTimerRef.current = window.setInterval(() => {
      const speed = autoScrollSpeedRef.current;
      const container = containerRefRef.current.current;

      if (!speed || !container) {
        return;
      }

      container.scrollTop += speed;
    }, 16);
  }, []);

  const updateAutoScroll = useCallback((clientY: number) => {
    const container = containerRefRef.current.current;

    if (!container) {
      autoScrollSpeedRef.current = 0;
      return;
    }

    const rect = container.getBoundingClientRect();
    const edgeSize = 52;
    const maxSpeed = 18;

    if (clientY < rect.top + edgeSize) {
      const strength = (rect.top + edgeSize - clientY) / edgeSize;
      autoScrollSpeedRef.current = -Math.ceil(strength * maxSpeed);
      return;
    }

    if (clientY > rect.bottom - edgeSize) {
      const strength = (clientY - (rect.bottom - edgeSize)) / edgeSize;
      autoScrollSpeedRef.current = Math.ceil(strength * maxSpeed);
      return;
    }

    autoScrollSpeedRef.current = 0;
  }, []);

  const getRawTargetAtPoint = useCallback((clientX: number, clientY: number) => {
    if (clientX === 0 && clientY === 0) {
      return null;
    }

    return rawDropTargetFromElement(document.elementFromPoint(clientX, clientY));
  }, []);

  const rowTargetForPath = useCallback((rowPath: string): RawTreeDropTarget | null => {
    const row = rowsRef.current.find((item) => item.id === rowPath);
    if (!row) {
      return null;
    }

    const targetDir = row.node.is_dir
      ? row.node.path
      : (row.parentPath ?? currentDirRef.current ?? row.node.path);

    return {
      component: "TreeRow",
      id: row.node.path,
      targetDir,
      targetIsDir: true,
      targetPath: row.node.path,
      targetSource: row.node.is_dir ? "folder_row" : "file_row_parent"
    };
  }, []);

  const getTargetState = useCallback(
    (rawTarget: RawTreeDropTarget | null, draggedPaths: string[]) => {
      const target = resolveDropTarget(
        nodesRef.current,
        currentDirRef.current,
        draggedPaths,
        rawTarget
      );

      return {
        activeTargetId: rawTarget?.id ?? null,
        target,
        targetStatus: target.allowed ? ("valid" as const) : ("invalid" as const),
        reason: target.allowed ? null : target.reason
      };
    },
    []
  );

  const scheduleAutoExpand = useCallback(
    (target: ResolvedTreeDropTarget | null, draggedPaths: string[]) => {
      if (!target?.allowed || !target.highlightPath) {
        clearAutoExpand();
        return;
      }

      const highlightPath = target.highlightPath;

      if (autoExpandTargetRef.current === highlightPath) {
        return;
      }

      clearAutoExpand();

      const row = rowsRef.current.find((item) => item.id === highlightPath);
      if (
        !row ||
        !row.node.is_dir ||
        expandedPathsRef.current.includes(row.node.path) ||
        !resolveDropTarget(nodesRef.current, currentDirRef.current, draggedPaths, {
          component: "TreeRow",
          id: row.node.path,
          targetDir: row.node.path,
          targetIsDir: true,
          targetPath: row.node.path,
          targetSource: "folder_row"
        }).allowed
      ) {
        return;
      }

      autoExpandTargetRef.current = highlightPath;
      autoExpandTimerRef.current = window.setTimeout(() => {
        onAutoExpandRef.current(highlightPath);
        clearAutoExpand();
      }, AUTO_EXPAND_DELAY);
    },
    [clearAutoExpand]
  );

  const clearDrag = useCallback(() => {
    clearAutoExpand();
    stopAutoScroll();
    setDrag(createIdleDragState());
  }, [clearAutoExpand, setDrag, stopAutoScroll]);

  const snapBack = useCallback(
    (current: TreeDragState, reason: DropRejectReason) => {
      clearAutoExpand();
      stopAutoScroll();

      if (snapBackTimerRef.current) {
        window.clearTimeout(snapBackTimerRef.current);
      }

      setDrag({
        ...current,
        mode: "snapback",
        targetStatus: reason === "cancelled" ? "none" : "invalid",
        reason,
        isReturning: false
      });

      window.requestAnimationFrame(() => {
        setDrag((latest) =>
          latest.mode === "snapback" ? { ...latest, isReturning: true } : latest
        );
      });

      snapBackTimerRef.current = window.setTimeout(() => {
        setDrag(createIdleDragState());
        snapBackTimerRef.current = null;
      }, SNAP_BACK_DURATION);
    },
    [clearAutoExpand, setDrag, stopAutoScroll]
  );

  const finishCurrentDrag = useCallback(() => {
    const current = dragStateRef.current;

    if (current.mode !== "pointer" && current.mode !== "keyboard") {
      return;
    }

    const target = current.target;
    if (target?.allowed) {
      onDropRef.current({
        draggedPaths: current.draggedPaths,
        target
      });
      clearDrag();
      return;
    }

    const reason = target?.allowed === false ? target.reason : "missing_target";
    onRejectRef.current({
      draggedPaths: current.draggedPaths,
      target,
      reason
    });
    snapBack(current, reason);
  }, [clearDrag, snapBack]);

  const handleWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      const pending = pendingPointerRef.current;

      if (pending && !pending.hasStarted) {
        const distance = Math.hypot(
          event.clientX - pending.startX,
          event.clientY - pending.startY
        );

        if (distance < DRAG_START_DISTANCE) {
          return;
        }

        pending.hasStarted = true;
        const rawTarget = getRawTargetAtPoint(event.clientX, event.clientY);
        const target = getTargetState(rawTarget, pending.draggedPaths);

        setDrag({
          mode: "pointer",
          draggedPaths: pending.draggedPaths,
          pointer: { x: event.clientX, y: event.clientY },
          origin: pending.origin,
          isReturning: false,
          ...target
        });

        onDragStartRef.current({
          draggedPaths: pending.draggedPaths,
          startPath: pending.rowPath
        });
        startAutoScroll();
      }

      const current = dragStateRef.current;

      if (current.mode !== "pointer") {
        return;
      }

      event.preventDefault();

      const rawTarget = getRawTargetAtPoint(event.clientX, event.clientY);
      const target = getTargetState(rawTarget, current.draggedPaths);

      setDrag({
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
        ...target
      });

      scheduleAutoExpand(target.target, current.draggedPaths);
      updateAutoScroll(event.clientY);
    },
    [
      getRawTargetAtPoint,
      getTargetState,
      scheduleAutoExpand,
      setDrag,
      startAutoScroll,
      updateAutoScroll
    ]
  );

  const handleWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      const pending = pendingPointerRef.current;
      pendingPointerRef.current = null;
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);

      if (pending && !pending.hasStarted) {
        return;
      }

      const current = dragStateRef.current;

      if (current.mode !== "pointer") {
        return;
      }

      event.preventDefault();
      suppressNextClickRef.current = true;

      const rawTarget = getRawTargetAtPoint(event.clientX, event.clientY);
      const target = getTargetState(rawTarget, current.draggedPaths);
      setDrag({
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
        ...target
      });
      dragStateRef.current = {
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
        ...target
      };
      finishCurrentDrag();
    },
    [finishCurrentDrag, getRawTargetAtPoint, getTargetState, handleWindowPointerMove, setDrag]
  );

  const startPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, rowPath: string) => {
      if (event.button !== 0 || event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tree-toggle]")) {
        return;
      }

      pendingPointerRef.current = {
        rowPath,
        draggedPaths: getDraggedPathsRef.current(rowPath),
        startX: event.clientX,
        startY: event.clientY,
        origin: getElementRect(event.currentTarget),
        hasStarted: false
      };

      window.addEventListener("pointermove", handleWindowPointerMove);
      window.addEventListener("pointerup", handleWindowPointerUp);
    },
    [handleWindowPointerMove, handleWindowPointerUp]
  );

  const startKeyboardDrag = useCallback(
    (rowPath: string, rowElement: HTMLElement | null) => {
      const draggedPaths = getDraggedPathsRef.current(rowPath);
      const rawTarget = rowTargetForPath(rowPath);
      const target = getTargetState(rawTarget, draggedPaths);
      const origin = rowElement
        ? getElementRect(rowElement)
        : { left: 0, top: 0, width: 280, height: 36 };

      setDrag({
        mode: "keyboard",
        draggedPaths,
        pointer: { x: origin.left + 16, y: origin.top + 16 },
        origin,
        isReturning: false,
        ...target
      });
      onDragStartRef.current({ draggedPaths, startPath: rowPath });
    },
    [getTargetState, rowTargetForPath, setDrag]
  );

  const moveKeyboardTarget = useCallback(
    (direction: 1 | -1) => {
      const current = dragStateRef.current;

      if (current.mode !== "keyboard") {
        return;
      }

      const rowIndex = rowsRef.current.findIndex(
        (row) => row.id === current.activeTargetId
      );
      const nextIndex = Math.min(
        Math.max((rowIndex === -1 ? 0 : rowIndex) + direction, 0),
        rowsRef.current.length - 1
      );
      const nextRow = rowsRef.current[nextIndex];

      if (!nextRow) {
        return;
      }

      const rawTarget = rowTargetForPath(nextRow.id);
      const target = getTargetState(rawTarget, current.draggedPaths);
      onFocusTargetRef.current(nextRow.id);
      scheduleAutoExpand(target.target, current.draggedPaths);
      setDrag({ ...current, ...target });
    },
    [getTargetState, rowTargetForPath, scheduleAutoExpand, setDrag]
  );

  const cancelDrag = useCallback(() => {
    const current = dragStateRef.current;

    if (current.mode !== "pointer" && current.mode !== "keyboard") {
      return;
    }

    pendingPointerRef.current = null;
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    onCancelRef.current({ draggedPaths: current.draggedPaths });
    snapBack(current, "cancelled");
  }, [handleWindowPointerMove, handleWindowPointerUp, snapBack]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressNextClickRef.current) {
      return false;
    }

    suppressNextClickRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        cancelDrag();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      clearAutoExpand();
      stopAutoScroll();

      if (snapBackTimerRef.current) {
        window.clearTimeout(snapBackTimerRef.current);
      }
    };
  }, [
    cancelDrag,
    clearAutoExpand,
    handleWindowPointerMove,
    handleWindowPointerUp,
    stopAutoScroll
  ]);

  return {
    dragState,
    startPointerDrag,
    startKeyboardDrag,
    moveKeyboardTarget,
    dropKeyboardDrag: finishCurrentDrag,
    cancelDrag,
    consumeSuppressedClick
  };
}
