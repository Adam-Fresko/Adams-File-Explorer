use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitStateDto {
    pub current_dir: String,
    pub favorites: Vec<String>,
    pub favorites_collapsed: bool,
    pub tree: Vec<TreeNodeDto>,
    pub show_hidden: bool,
    pub open_with_map: HashMap<String, String>,
    pub sort_preference: Option<SortPreferenceDto>,
    pub column_widths: ColumnWidthsDto,
    pub file_operation_history: FileOperationHistoryDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryStateDto {
    pub current_dir: String,
    pub tree: Vec<TreeNodeDto>,
    pub show_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNodeDto {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub has_children: bool,
    pub modified_unix_ms: Option<i64>,
    pub size_bytes: Option<u64>,
    pub kind_label: String,
    pub children: Option<Vec<TreeNodeDto>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpResultDto {
    pub success_paths: Vec<String>,
    pub failed_paths: Vec<String>,
    pub message: String,
    #[serde(default)]
    pub mappings: Vec<PathMappingDto>,
    pub history: Option<FileOperationHistoryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovePreviewDto {
    pub conflicts: Vec<MoveConflictDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveConflictDto {
    pub source_path: String,
    pub target_path: String,
    pub source_is_dir: bool,
    pub target_is_dir: bool,
    pub same_kind: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MoveConflictActionDto {
    KeepBoth,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathMappingDto {
    pub source_path: String,
    pub target_path: String,
    #[serde(default)]
    pub staged_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathOperationResultDto {
    pub path: String,
    pub message: String,
    pub history: FileOperationHistoryDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOperationCommandResultDto {
    pub history: FileOperationHistoryDto,
    pub message: String,
    pub affected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileOperationKindDto {
    Rename,
    Move,
    Paste,
    CreateFolder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileOperationTimelineActionDto {
    Performed,
    Undone,
    Redone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOperationDto {
    pub id: String,
    pub kind: FileOperationKindDto,
    pub label: String,
    pub created_unix_ms: u64,
    pub item_count: usize,
    pub paths: Vec<String>,
    pub target_dir: Option<String>,
    #[serde(default)]
    pub mappings: Vec<PathMappingDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOperationTimelineEntryDto {
    pub id: String,
    pub operation_id: String,
    pub action: FileOperationTimelineActionDto,
    pub kind: FileOperationKindDto,
    pub label: String,
    pub created_unix_ms: u64,
    pub item_count: usize,
    pub path: Option<String>,
    pub target_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileOperationHistoryDto {
    #[serde(default)]
    pub undo_stack: Vec<FileOperationDto>,
    #[serde(default)]
    pub redo_stack: Vec<FileOperationDto>,
    #[serde(default)]
    pub timeline: Vec<FileOperationTimelineEntryDto>,
    #[serde(default)]
    pub can_undo: bool,
    #[serde(default)]
    pub can_redo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultFolderBrowserStatusDto {
    pub is_default: bool,
    pub folder_handler: Option<String>,
    pub directory_handler: Option<String>,
    pub can_set: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LogEventDto {
    pub component: Option<String>,
    pub event_type: String,
    pub command: Option<String>,
    #[serde(default)]
    pub paths: Vec<String>,
    pub target_path: Option<String>,
    pub target_dir: Option<String>,
    pub status: Option<String>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    pub details: Option<Value>,
    pub result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortColumnDto {
    Name,
    Modified,
    Size,
    Kind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirectionDto {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortPreferenceDto {
    pub column: SortColumnDto,
    pub direction: SortDirectionDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnWidthsDto {
    pub name: u32,
    pub modified: u32,
    pub size: u32,
    pub kind: u32,
}

impl Default for ColumnWidthsDto {
    fn default() -> Self {
        Self {
            name: 420,
            modified: 240,
            size: 110,
            kind: 170,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfigDto {
    pub favorites: Vec<String>,
    #[serde(default)]
    pub favorites_collapsed: bool,
    pub last_directory: Option<String>,
    pub open_with_map: HashMap<String, String>,
    pub sort_preference: Option<SortPreferenceDto>,
    #[serde(default)]
    pub column_widths: ColumnWidthsDto,
    #[serde(default)]
    pub show_hidden_by_dir: HashMap<String, bool>,
}
