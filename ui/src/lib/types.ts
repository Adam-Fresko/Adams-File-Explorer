export type SortColumn = "name" | "modified" | "size" | "kind";

export type SortDirection = "asc" | "desc";

export interface SortPreferenceDto {
  column: SortColumn;
  direction: SortDirection;
}

export interface ColumnWidthsDto {
  name: number;
  modified: number;
  size: number;
  kind: number;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidthsDto = {
  name: 420,
  modified: 240,
  size: 110,
  kind: 170
};

export const MIN_COLUMN_WIDTHS: ColumnWidthsDto = {
  name: 240,
  modified: 170,
  size: 80,
  kind: 110
};

export interface TreeNodeDto {
  path: string;
  name: string;
  is_dir: boolean;
  has_children: boolean;
  modified_unix_ms?: number | null;
  size_bytes?: number | null;
  kind_label: string;
  children?: TreeNodeDto[] | null;
}

export interface InitStateDto {
  current_dir: string;
  favorites: string[];
  favorites_collapsed: boolean;
  tree: TreeNodeDto[];
  show_hidden: boolean;
  open_with_map: Record<string, string>;
  sort_preference?: SortPreferenceDto | null;
  column_widths: ColumnWidthsDto;
  file_operation_history: FileOperationHistoryDto;
}

export interface DirectoryStateDto {
  current_dir: string;
  tree: TreeNodeDto[];
  show_hidden: boolean;
}

export interface OpResultDto {
  success_paths: string[];
  failed_paths: string[];
  message: string;
  mappings: PathMappingDto[];
  history?: FileOperationHistoryDto | null;
}

export interface MovePreviewDto {
  conflicts: MoveConflictDto[];
}

export interface MoveConflictDto {
  source_path: string;
  target_path: string;
  source_is_dir: boolean;
  target_is_dir: boolean;
  same_kind: boolean;
}

export type MoveConflictActionDto = "keep_both" | "replace";

export interface PathMappingDto {
  source_path: string;
  target_path: string;
  staged_path?: string | null;
}

export interface PathOperationResultDto {
  path: string;
  message: string;
  history: FileOperationHistoryDto;
}

export type FileOperationKindDto = "rename" | "move" | "paste" | "create_folder";

export type FileOperationTimelineActionDto = "performed" | "undone" | "redone";

export interface FileOperationDto {
  id: string;
  kind: FileOperationKindDto;
  label: string;
  created_unix_ms: number;
  item_count: number;
  paths: string[];
  target_dir?: string | null;
  mappings: PathMappingDto[];
}

export interface FileOperationTimelineEntryDto {
  id: string;
  operation_id: string;
  action: FileOperationTimelineActionDto;
  kind: FileOperationKindDto;
  label: string;
  created_unix_ms: number;
  item_count: number;
  path?: string | null;
  target_dir?: string | null;
}

export interface FileOperationHistoryDto {
  undo_stack: FileOperationDto[];
  redo_stack: FileOperationDto[];
  timeline: FileOperationTimelineEntryDto[];
  can_undo: boolean;
  can_redo: boolean;
}

export interface FileOperationCommandResultDto {
  history: FileOperationHistoryDto;
  message: string;
  affected_paths: string[];
}

export interface DefaultFolderBrowserStatusDto {
  is_default: boolean;
  folder_handler?: string | null;
  directory_handler?: string | null;
  can_set: boolean;
  message?: string | null;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface LogEventDto {
  component?: string | null;
  event_type: string;
  command?: string | null;
  paths?: string[];
  target_path?: string | null;
  target_dir?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  details?: JsonValue;
  result?: JsonValue;
}
