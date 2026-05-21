import { parentDirectoryOf } from "../../lib/pathUtils";
import type { TreeNodeDto } from "../../lib/types";

export type ExplorerTreeRow = {
  id: string;
  node: TreeNodeDto;
  depth: number;
  parentPath: string | null;
  index: number;
  isExpanded: boolean;
  pathIds: string[];
};

export type TreeDropTargetSource =
  | "folder_row"
  | "file_row_parent"
  | "current_folder";

export type DropRejectReason =
  | "missing_target"
  | "not_folder"
  | "no_parent_folder"
  | "target_is_source"
  | "target_inside_source"
  | "already_in_target"
  | "empty_drag"
  | "cancelled";

export type RawTreeDropTarget = {
  component: "TreeRow" | "TreeView";
  id: string;
  targetDir: string;
  targetIsDir: boolean;
  targetPath: string;
  targetSource: TreeDropTargetSource;
};

export type ResolvedTreeDropTarget =
  | {
      allowed: true;
      component: "TreeRow" | "TreeView";
      id: string;
      targetDir: string;
      targetPath: string;
      targetSource: TreeDropTargetSource;
      highlightPath: string | null;
    }
  | {
      allowed: false;
      component: "TreeRow" | "TreeView";
      id: string | null;
      targetDir: string | null;
      targetPath: string | null;
      targetSource: TreeDropTargetSource | null;
      highlightPath: string | null;
      reason: DropRejectReason;
    };

export const normalizePathForCompare = (path: string): string => {
  let normalized = path;
  while (normalized.length > 1 && /[/\\]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

export function flattenVisibleRows(
  nodes: TreeNodeDto[],
  expandedPaths: Iterable<string>,
  currentDir: string | null
): ExplorerTreeRow[] {
  const expandedSet = new Set(expandedPaths);
  const rows: ExplorerTreeRow[] = [];

  function walk(
    list: TreeNodeDto[],
    depth: number,
    parentPath: string | null,
    pathIds: string[]
  ) {
    for (const node of list) {
      const nextPathIds = [...pathIds, node.path];
      const row: ExplorerTreeRow = {
        id: node.path,
        node,
        depth,
        parentPath,
        index: rows.length,
        isExpanded: node.is_dir && expandedSet.has(node.path),
        pathIds: nextPathIds
      };

      rows.push(row);

      if (row.isExpanded && node.children?.length) {
        walk(node.children, depth + 1, node.path, nextPathIds);
      }
    }
  }

  walk(nodes, 0, currentDir, currentDir ? [currentDir] : []);
  return rows;
}

export function findTreeItem(
  nodes: TreeNodeDto[],
  path: string,
  currentDir: string | null = null
): { node: TreeNodeDto; parentPath: string | null; pathIds: string[] } | null {
  function walk(
    list: TreeNodeDto[],
    parentPath: string | null,
    pathIds: string[]
  ): { node: TreeNodeDto; parentPath: string | null; pathIds: string[] } | null {
    for (const node of list) {
      const nextPathIds = [...pathIds, node.path];

      if (node.path === path) {
        return { node, parentPath, pathIds: nextPathIds };
      }

      if (node.children?.length) {
        const match = walk(node.children, node.path, nextPathIds);
        if (match) {
          return match;
        }
      }
    }

    return null;
  }

  return walk(nodes, currentDir, currentDir ? [currentDir] : []);
}

export function getNodesByPaths(
  nodes: TreeNodeDto[],
  paths: Iterable<string>,
  currentDir: string | null = null
): TreeNodeDto[] {
  const results: TreeNodeDto[] = [];

  for (const path of paths) {
    const item = findTreeItem(nodes, path, currentDir);
    if (item) {
      results.push(item.node);
    }
  }

  return results;
}

export function getTopLevelDraggedPaths(
  nodes: TreeNodeDto[],
  draggedPaths: Iterable<string>,
  currentDir: string | null = null
): string[] {
  const draggedSet = new Set(draggedPaths);
  const topLevelPaths: string[] = [];

  for (const path of draggedSet) {
    const item = findTreeItem(nodes, path, currentDir);
    if (!item) {
      continue;
    }

    const hasDraggedAncestor = item.pathIds
      .slice(0, -1)
      .some((pathId) => draggedSet.has(pathId));

    if (!hasDraggedAncestor) {
      topLevelPaths.push(path);
    }
  }

  return topLevelPaths;
}

export function moveTargetRejectReason(
  paths: string[],
  targetPath: string,
  targetIsDir: boolean
): DropRejectReason | null {
  if (!paths.length) {
    return "empty_drag";
  }

  if (!targetIsDir) {
    return "not_folder";
  }

  const normalizedTarget = normalizePathForCompare(targetPath);

  for (const path of paths) {
    const normalizedPath = normalizePathForCompare(path);
    if (normalizedPath === normalizedTarget) {
      return "target_is_source";
    }

    if (normalizedTarget.startsWith(`${normalizedPath}/`)) {
      return "target_inside_source";
    }

    const parentDir = parentDirectoryOf(normalizedPath);
    if (parentDir && normalizePathForCompare(parentDir) === normalizedTarget) {
      return "already_in_target";
    }
  }

  return null;
}

export function resolveDropTarget(
  nodes: TreeNodeDto[],
  currentDir: string | null,
  draggedPaths: Iterable<string>,
  target: RawTreeDropTarget | null
): ResolvedTreeDropTarget {
  const topLevelDraggedPaths = getTopLevelDraggedPaths(nodes, draggedPaths, currentDir);

  if (!topLevelDraggedPaths.length) {
    return {
      allowed: false,
      component: target?.component ?? "TreeView",
      id: target?.id ?? null,
      targetDir: target?.targetDir ?? null,
      targetPath: target?.targetPath ?? null,
      targetSource: target?.targetSource ?? null,
      highlightPath: null,
      reason: "empty_drag"
    };
  }

  if (!target) {
    return {
      allowed: false,
      component: "TreeView",
      id: null,
      targetDir: null,
      targetPath: null,
      targetSource: null,
      highlightPath: null,
      reason: "missing_target"
    };
  }

  if (!target.targetIsDir) {
    return {
      allowed: false,
      component: target.component,
      id: target.id,
      targetDir: target.targetDir,
      targetPath: target.targetPath,
      targetSource: target.targetSource,
      highlightPath: target.targetPath,
      reason: "not_folder"
    };
  }

  const rejectReason = moveTargetRejectReason(
    topLevelDraggedPaths,
    target.targetDir,
    target.targetIsDir
  );
  const highlightPath =
    target.targetDir === currentDir ? null : target.targetDir || target.targetPath;

  if (rejectReason) {
    return {
      allowed: false,
      component: target.component,
      id: target.id,
      targetDir: target.targetDir,
      targetPath: target.targetPath,
      targetSource: target.targetSource,
      highlightPath,
      reason: rejectReason
    };
  }

  return {
    allowed: true,
    component: target.component,
    id: target.id,
    targetDir: target.targetDir,
    targetPath: target.targetPath,
    targetSource: target.targetSource,
    highlightPath
  };
}

export const isValidMoveTarget = (paths: string[], targetPath: string): boolean =>
  moveTargetRejectReason(paths, targetPath, true) === null;

export const treeDropTargetData = (target: RawTreeDropTarget) => ({
  "data-tree-drop-target": "true",
  "data-tree-drop-target-component": target.component,
  "data-tree-drop-target-id": target.id,
  "data-tree-drop-target-dir": target.targetDir,
  "data-tree-drop-target-is-dir": String(target.targetIsDir),
  "data-tree-drop-target-path": target.targetPath,
  "data-tree-drop-target-source": target.targetSource
});

export function rawDropTargetFromElement(element: Element | null): RawTreeDropTarget | null {
  const target = element?.closest<HTMLElement>("[data-tree-drop-target='true']");
  if (!target) {
    return null;
  }

  const id = target.dataset.treeDropTargetId;
  const targetDir = target.dataset.treeDropTargetDir;
  const targetPath = target.dataset.treeDropTargetPath;
  const targetSource = target.dataset.treeDropTargetSource as
    | TreeDropTargetSource
    | undefined;
  const component =
    target.dataset.treeDropTargetComponent === "TreeRow" ? "TreeRow" : "TreeView";

  if (!id || !targetDir || !targetPath || !targetSource) {
    return null;
  }

  return {
    component,
    id,
    targetDir,
    targetIsDir: target.dataset.treeDropTargetIsDir === "true",
    targetPath,
    targetSource
  };
}
