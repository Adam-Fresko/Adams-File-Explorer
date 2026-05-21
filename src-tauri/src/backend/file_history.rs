use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    backend::fs_ops,
    dto::{
        FileOperationCommandResultDto, FileOperationDto, FileOperationHistoryDto,
        FileOperationKindDto, FileOperationTimelineActionDto, FileOperationTimelineEntryDto,
        PathMappingDto,
    },
};

const HISTORY_FILE_NAME: &str = "file_operation_history.json";
const HISTORY_DIR: &str = "adams_file_explorer";
const STAGING_DIR: &str = "undo_staging";
const MAX_HISTORY_ITEMS: usize = 100;
const MAX_STAGING_AGE: Duration = Duration::from_secs(60 * 60 * 24 * 30);

#[derive(Debug, Clone)]
pub struct HistoryPaths {
    pub history_file_path: PathBuf,
    pub staging_dir_path: PathBuf,
}

impl Default for HistoryPaths {
    fn default() -> Self {
        let base = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(HISTORY_DIR);

        Self {
            history_file_path: base.join(HISTORY_FILE_NAME),
            staging_dir_path: base.join(STAGING_DIR),
        }
    }
}

pub fn load_or_init(paths: &HistoryPaths) -> Result<FileOperationHistoryDto, String> {
    let mut history = if paths.history_file_path.exists() {
        let raw = fs::read_to_string(&paths.history_file_path)
            .map_err(|err| format!("Failed to read operation history: {err}"))?;
        serde_json::from_str::<FileOperationHistoryDto>(&raw)
            .map_err(|err| format!("Failed to parse operation history: {err}"))?
    } else {
        FileOperationHistoryDto::default()
    };

    let changed = cleanup_on_start(&mut history, paths)?;
    if changed {
        save_history(paths, &history)?;
    }

    sync_flags(&mut history);
    Ok(history)
}

pub fn save_history(paths: &HistoryPaths, history: &FileOperationHistoryDto) -> Result<(), String> {
    if let Some(parent) = paths.history_file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create operation history dir: {err}"))?;
    }

    let mut history = history.clone();
    sync_flags(&mut history);

    let raw = serde_json::to_string_pretty(&history)
        .map_err(|err| format!("Failed to serialize operation history: {err}"))?;
    fs::write(&paths.history_file_path, raw)
        .map_err(|err| format!("Failed to write operation history: {err}"))
}

pub fn record_operation(
    history: &mut FileOperationHistoryDto,
    paths: &HistoryPaths,
    kind: FileOperationKindDto,
    mappings: Vec<PathMappingDto>,
    target_dir: Option<String>,
) -> Result<FileOperationHistoryDto, String> {
    if mappings.is_empty() {
        return Ok(history.clone());
    }

    clean_operations_staging(&history.redo_stack)?;
    history.redo_stack.clear();

    let created_unix_ms = timestamp_unix_ms();
    let operation = FileOperationDto {
        id: operation_id(history),
        label: operation_label(&kind, &mappings),
        created_unix_ms,
        item_count: mappings.len(),
        paths: operation_paths(&mappings),
        target_dir,
        kind,
        mappings,
    };

    history.timeline.push(timeline_entry_for(
        &operation,
        FileOperationTimelineActionDto::Performed,
        Some(created_unix_ms),
        operation.paths.first().cloned(),
    ));
    history.undo_stack.push(operation);
    trim_history(history)?;
    sync_flags(history);
    save_history(paths, history)?;
    Ok(history.clone())
}

pub fn undo_last(
    history: &mut FileOperationHistoryDto,
    paths: &HistoryPaths,
) -> Result<FileOperationCommandResultDto, String> {
    let mut operation = history
        .undo_stack
        .last()
        .cloned()
        .ok_or_else(|| "Nothing to undo".to_string())?;

    let affected_paths = undo_operation(&mut operation, paths)?;
    history.undo_stack.pop();
    let message = format!("Undid {}", operation.label.to_lowercase());
    history.timeline.push(timeline_entry_for(
        &operation,
        FileOperationTimelineActionDto::Undone,
        None,
        affected_paths
            .first()
            .cloned()
            .or_else(|| operation.target_dir.clone())
            .or_else(|| operation.paths.first().cloned()),
    ));
    history.redo_stack.push(operation);
    trim_history(history)?;
    sync_flags(history);
    save_history(paths, history)?;

    Ok(FileOperationCommandResultDto {
        history: history.clone(),
        message,
        affected_paths,
    })
}

pub fn redo_last(
    history: &mut FileOperationHistoryDto,
    paths: &HistoryPaths,
) -> Result<FileOperationCommandResultDto, String> {
    let mut operation = history
        .redo_stack
        .last()
        .cloned()
        .ok_or_else(|| "Nothing to redo".to_string())?;

    let affected_paths = redo_operation(&mut operation)?;
    history.redo_stack.pop();
    let message = format!("Redid {}", operation.label.to_lowercase());
    history.timeline.push(timeline_entry_for(
        &operation,
        FileOperationTimelineActionDto::Redone,
        None,
        affected_paths
            .first()
            .cloned()
            .or_else(|| operation.target_dir.clone())
            .or_else(|| operation.paths.first().cloned()),
    ));
    history.undo_stack.push(operation);
    trim_history(history)?;
    sync_flags(history);
    save_history(paths, history)?;

    Ok(FileOperationCommandResultDto {
        history: history.clone(),
        message,
        affected_paths,
    })
}

fn undo_operation(
    operation: &mut FileOperationDto,
    paths: &HistoryPaths,
) -> Result<Vec<String>, String> {
    match operation.kind {
        FileOperationKindDto::Rename | FileOperationKindDto::Move => {
            let moves = operation
                .mappings
                .iter()
                .rev()
                .map(|mapping| {
                    (
                        PathBuf::from(&mapping.target_path),
                        PathBuf::from(&mapping.source_path),
                    )
                })
                .collect::<Vec<_>>();
            perform_moves(&moves)?;
            Ok(operation
                .mappings
                .iter()
                .map(|mapping| mapping.source_path.clone())
                .collect())
        }
        FileOperationKindDto::Paste | FileOperationKindDto::CreateFolder => {
            let operation_id = operation.id.clone();
            let mut moves = Vec::new();
            for (index, mapping) in operation.mappings.iter_mut().enumerate() {
                let staged = staged_path_for(paths, &operation_id, index, &mapping.target_path)?;
                mapping.staged_path = Some(staged.to_string_lossy().to_string());
                moves.push((PathBuf::from(&mapping.target_path), staged));
            }

            perform_moves(&moves)?;
            Ok(Vec::new())
        }
    }
}

fn redo_operation(operation: &mut FileOperationDto) -> Result<Vec<String>, String> {
    match operation.kind {
        FileOperationKindDto::Rename | FileOperationKindDto::Move => {
            let moves = operation
                .mappings
                .iter()
                .map(|mapping| {
                    (
                        PathBuf::from(&mapping.source_path),
                        PathBuf::from(&mapping.target_path),
                    )
                })
                .collect::<Vec<_>>();
            perform_moves(&moves)?;
            Ok(operation
                .mappings
                .iter()
                .map(|mapping| mapping.target_path.clone())
                .collect())
        }
        FileOperationKindDto::Paste | FileOperationKindDto::CreateFolder => {
            let staging_parents = operation
                .mappings
                .iter()
                .filter_map(|mapping| mapping.staged_path.as_ref())
                .filter_map(|path| Path::new(path).parent().map(Path::to_path_buf))
                .collect::<Vec<_>>();
            let moves = operation
                .mappings
                .iter()
                .map(|mapping| {
                    let staged = mapping
                        .staged_path
                        .as_ref()
                        .ok_or_else(|| "Missing staged path".to_string())?;
                    Ok((PathBuf::from(staged), PathBuf::from(&mapping.target_path)))
                })
                .collect::<Result<Vec<_>, String>>()?;

            perform_moves(&moves)?;
            for mapping in &mut operation.mappings {
                mapping.staged_path = None;
            }
            for parent in staging_parents {
                let _ = fs::remove_dir(parent);
            }
            Ok(operation
                .mappings
                .iter()
                .map(|mapping| mapping.target_path.clone())
                .collect())
        }
    }
}

fn perform_moves(moves: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    for (source, target) in moves {
        if !source.exists() {
            return Err(format!("Source does not exist: {}", source.display()));
        }

        if target.exists() {
            return Err(format!("Target already exists: {}", target.display()));
        }

        let parent = target
            .parent()
            .ok_or_else(|| format!("Target has no parent: {}", target.display()))?;
        if !parent.exists() {
            return Err(format!(
                "Target parent does not exist: {}",
                parent.display()
            ));
        }
    }

    let mut completed: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (source, target) in moves {
        if let Err(error) = fs_ops::move_path_exact(source, target) {
            for (rollback_source, rollback_target) in completed.iter().rev() {
                let _ = fs_ops::move_path_exact(rollback_target, rollback_source);
            }
            return Err(error);
        }
        completed.push((source.clone(), target.clone()));
    }

    Ok(())
}

fn cleanup_on_start(
    history: &mut FileOperationHistoryDto,
    paths: &HistoryPaths,
) -> Result<bool, String> {
    let mut changed = false;
    let mut kept_redo = Vec::new();

    for operation in history.redo_stack.drain(..) {
        if redo_entry_is_valid(&operation) {
            kept_redo.push(operation);
        } else {
            clean_operation_staging(&operation)?;
            changed = true;
        }
    }

    history.redo_stack = kept_redo;
    cleanup_stray_staging(paths, history)?;
    sync_flags(history);
    Ok(changed)
}

fn redo_entry_is_valid(operation: &FileOperationDto) -> bool {
    if !matches!(
        operation.kind,
        FileOperationKindDto::Paste | FileOperationKindDto::CreateFolder
    ) {
        return true;
    }

    operation.mappings.iter().all(|mapping| {
        mapping
            .staged_path
            .as_ref()
            .map(|path| {
                let path = Path::new(path);
                path.exists() && !staged_path_is_old(path)
            })
            .unwrap_or(false)
    })
}

fn staged_path_is_old(path: &Path) -> bool {
    let age_path = path.parent().unwrap_or(path);
    fs::metadata(age_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .map(|age| age > MAX_STAGING_AGE)
        .unwrap_or(false)
}

fn cleanup_stray_staging(
    paths: &HistoryPaths,
    history: &FileOperationHistoryDto,
) -> Result<(), String> {
    if !paths.staging_dir_path.exists() {
        return Ok(());
    }

    let referenced = referenced_staging_roots(history);
    for entry in fs::read_dir(&paths.staging_dir_path)
        .map_err(|err| format!("Failed to read operation staging dir: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Failed to read staged item: {err}"))?;
        let path = entry.path();
        if !referenced.contains(&path) {
            remove_path_best_effort(&path);
        }
    }

    Ok(())
}

fn referenced_staging_roots(history: &FileOperationHistoryDto) -> HashSet<PathBuf> {
    history
        .redo_stack
        .iter()
        .flat_map(|operation| operation.mappings.iter())
        .filter_map(|mapping| mapping.staged_path.as_ref())
        .filter_map(|path| Path::new(path).parent().map(Path::to_path_buf))
        .collect()
}

fn trim_history(history: &mut FileOperationHistoryDto) -> Result<(), String> {
    if history.undo_stack.len() > MAX_HISTORY_ITEMS {
        let remove_count = history.undo_stack.len() - MAX_HISTORY_ITEMS;
        let removed = history
            .undo_stack
            .drain(0..remove_count)
            .collect::<Vec<_>>();
        clean_operations_staging(&removed)?;
    }

    if history.redo_stack.len() > MAX_HISTORY_ITEMS {
        let remove_count = history.redo_stack.len() - MAX_HISTORY_ITEMS;
        let removed = history
            .redo_stack
            .drain(0..remove_count)
            .collect::<Vec<_>>();
        clean_operations_staging(&removed)?;
    }

    if history.timeline.len() > MAX_HISTORY_ITEMS {
        let remove_count = history.timeline.len() - MAX_HISTORY_ITEMS;
        history.timeline.drain(0..remove_count);
    }

    Ok(())
}

fn clean_operations_staging(operations: &[FileOperationDto]) -> Result<(), String> {
    for operation in operations {
        clean_operation_staging(operation)?;
    }

    Ok(())
}

fn clean_operation_staging(operation: &FileOperationDto) -> Result<(), String> {
    for mapping in &operation.mappings {
        if let Some(staged_path) = &mapping.staged_path {
            let path = Path::new(staged_path);
            if path.exists() {
                remove_path_best_effort(path);
            }
        }
    }
    clean_empty_staging_parent(operation);
    Ok(())
}

fn clean_empty_staging_parent(operation: &FileOperationDto) {
    for mapping in &operation.mappings {
        if let Some(staged_path) = &mapping.staged_path {
            if let Some(parent) = Path::new(staged_path).parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }
}

fn remove_path_best_effort(path: &Path) {
    if path.is_dir() && !path.is_symlink() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

fn staged_path_for(
    paths: &HistoryPaths,
    operation_id: &str,
    index: usize,
    target_path: &str,
) -> Result<PathBuf, String> {
    let name = Path::new(target_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    let safe_name = name.replace('/', "_").replace('\\', "_");
    let parent = paths.staging_dir_path.join(operation_id);
    fs::create_dir_all(&parent).map_err(|err| format!("Failed to create staging dir: {err}"))?;
    Ok(parent.join(format!("{index}-{safe_name}")))
}

fn operation_id(history: &FileOperationHistoryDto) -> String {
    format!(
        "{}-{}-{}",
        timestamp_unix_ms(),
        std::process::id(),
        history.undo_stack.len() + history.redo_stack.len() + history.timeline.len()
    )
}

fn sync_flags(history: &mut FileOperationHistoryDto) {
    history.can_undo = !history.undo_stack.is_empty();
    history.can_redo = !history.redo_stack.is_empty();
}

fn timeline_entry_for(
    operation: &FileOperationDto,
    action: FileOperationTimelineActionDto,
    created_unix_ms: Option<u64>,
    path: Option<String>,
) -> FileOperationTimelineEntryDto {
    let created_unix_ms = created_unix_ms.unwrap_or_else(timestamp_unix_ms);
    FileOperationTimelineEntryDto {
        id: format!(
            "{}-{}-{}",
            operation.id,
            timeline_action_name(&action),
            created_unix_ms
        ),
        operation_id: operation.id.clone(),
        label: timeline_label(&operation.kind, &action, operation.item_count),
        action,
        kind: operation.kind.clone(),
        created_unix_ms,
        item_count: operation.item_count,
        path,
        target_dir: operation.target_dir.clone(),
    }
}

fn timeline_action_name(action: &FileOperationTimelineActionDto) -> &'static str {
    match action {
        FileOperationTimelineActionDto::Performed => "performed",
        FileOperationTimelineActionDto::Undone => "undone",
        FileOperationTimelineActionDto::Redone => "redone",
    }
}

fn timeline_label(
    kind: &FileOperationKindDto,
    action: &FileOperationTimelineActionDto,
    count: usize,
) -> String {
    let noun = match kind {
        FileOperationKindDto::Rename => "rename",
        FileOperationKindDto::Move => "move",
        FileOperationKindDto::Paste => "paste",
        FileOperationKindDto::CreateFolder => "folder creation",
    };

    match action {
        FileOperationTimelineActionDto::Performed => performed_timeline_label(kind, count),
        FileOperationTimelineActionDto::Undone => format!("Undid {noun}"),
        FileOperationTimelineActionDto::Redone => format!("Redid {noun}"),
    }
}

fn performed_timeline_label(kind: &FileOperationKindDto, count: usize) -> String {
    match kind {
        FileOperationKindDto::Rename => "Renamed file".to_string(),
        FileOperationKindDto::Move => {
            if count == 1 {
                "Moved file".to_string()
            } else {
                format!("Moved {count} items")
            }
        }
        FileOperationKindDto::Paste => {
            if count == 1 {
                "Pasted file".to_string()
            } else {
                format!("Pasted {count} items")
            }
        }
        FileOperationKindDto::CreateFolder => "Created folder".to_string(),
    }
}

fn operation_label(kind: &FileOperationKindDto, mappings: &[PathMappingDto]) -> String {
    let count = mappings.len();
    match kind {
        FileOperationKindDto::Rename => {
            let Some(mapping) = mappings.first() else {
                return "Rename item".to_string();
            };
            format!(
                "Rename {} to {}",
                file_name_for(&mapping.source_path),
                file_name_for(&mapping.target_path)
            )
        }
        FileOperationKindDto::Move => format!("Move {count} item(s)"),
        FileOperationKindDto::Paste => format!("Paste {count} item(s)"),
        FileOperationKindDto::CreateFolder => {
            let name = mappings
                .first()
                .map(|mapping| file_name_for(&mapping.target_path))
                .unwrap_or_else(|| "folder".to_string());
            format!("Create folder {name}")
        }
    }
}

fn operation_paths(mappings: &[PathMappingDto]) -> Vec<String> {
    mappings
        .iter()
        .map(|mapping| mapping.target_path.clone())
        .collect()
}

fn file_name_for(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn timestamp_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_paths(name: &str) -> HistoryPaths {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_history_{name}_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");

        HistoryPaths {
            history_file_path: base.join("history.json"),
            staging_dir_path: base.join("staging"),
        }
    }

    fn mapping(source: &Path, target: &Path) -> PathMappingDto {
        PathMappingDto {
            source_path: source.to_string_lossy().to_string(),
            target_path: target.to_string_lossy().to_string(),
            staged_path: None,
        }
    }

    #[test]
    fn undo_and_redo_rename() {
        let paths = test_paths("rename");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::write(base.join("old.txt"), "hello").expect("write old");

        let mut history = FileOperationHistoryDto::default();
        fs_ops::move_path_exact(&base.join("old.txt"), &base.join("new.txt")).expect("rename file");
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Rename,
            vec![mapping(&base.join("old.txt"), &base.join("new.txt"))],
            None,
        )
        .expect("record");

        undo_last(&mut history, &paths).expect("undo");
        assert!(base.join("old.txt").exists());
        assert!(!base.join("new.txt").exists());
        assert_eq!(history.undo_stack.len(), 0);
        assert_eq!(history.redo_stack.len(), 1);
        assert_eq!(history.timeline.len(), 2);
        assert_eq!(history.timeline[0].label, "Renamed file");
        assert_eq!(history.timeline[1].label, "Undid rename");
        assert!(!history.can_undo);
        assert!(history.can_redo);

        redo_last(&mut history, &paths).expect("redo");
        assert!(!base.join("old.txt").exists());
        assert!(base.join("new.txt").exists());
        assert_eq!(history.undo_stack.len(), 1);
        assert_eq!(history.redo_stack.len(), 0);
        assert_eq!(history.timeline[2].label, "Redid rename");
        assert!(history.can_undo);
        assert!(!history.can_redo);
    }

    #[test]
    fn undo_and_redo_move() {
        let paths = test_paths("move");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("a.txt"), "hello").expect("write file");

        let mut history = FileOperationHistoryDto::default();
        fs_ops::move_path_exact(&base.join("a.txt"), &base.join("target/a.txt"))
            .expect("move file");
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Move,
            vec![mapping(&base.join("a.txt"), &base.join("target/a.txt"))],
            Some(base.join("target").to_string_lossy().to_string()),
        )
        .expect("record");

        undo_last(&mut history, &paths).expect("undo");
        assert!(base.join("a.txt").exists());
        redo_last(&mut history, &paths).expect("redo");
        assert!(base.join("target/a.txt").exists());
    }

    #[test]
    fn undo_and_redo_paste_uses_staging() {
        let paths = test_paths("paste");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::write(base.join("created.txt"), "hello").expect("write pasted");

        let mut history = FileOperationHistoryDto::default();
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Paste,
            vec![mapping(&base.join("source.txt"), &base.join("created.txt"))],
            Some(base.to_string_lossy().to_string()),
        )
        .expect("record");

        undo_last(&mut history, &paths).expect("undo");
        assert!(!base.join("created.txt").exists());
        let staged = history.redo_stack[0].mappings[0]
            .staged_path
            .clone()
            .expect("staged path");
        assert!(Path::new(&staged).exists());

        let mut loaded = load_or_init(&paths).expect("load persisted");
        redo_last(&mut loaded, &paths).expect("redo");
        assert!(base.join("created.txt").exists());
        assert_eq!(loaded.redo_stack.len(), 0);
    }

    #[test]
    fn failed_undo_keeps_history_unchanged() {
        let paths = test_paths("conflict");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::write(base.join("new.txt"), "hello").expect("write new");
        fs::write(base.join("old.txt"), "conflict").expect("write conflict");

        let mut history = FileOperationHistoryDto::default();
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Rename,
            vec![mapping(&base.join("old.txt"), &base.join("new.txt"))],
            None,
        )
        .expect("record");

        let result = undo_last(&mut history, &paths);

        assert!(result.is_err());
        assert_eq!(history.undo_stack.len(), 1);
        assert_eq!(history.redo_stack.len(), 0);
        assert!(base.join("new.txt").exists());
    }

    #[test]
    fn failed_redo_keeps_history_unchanged() {
        let paths = test_paths("redo_conflict");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::write(base.join("old.txt"), "hello").expect("write old");

        let mut history = FileOperationHistoryDto::default();
        fs_ops::move_path_exact(&base.join("old.txt"), &base.join("new.txt")).expect("rename file");
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Rename,
            vec![mapping(&base.join("old.txt"), &base.join("new.txt"))],
            None,
        )
        .expect("record");
        undo_last(&mut history, &paths).expect("undo");
        fs::write(base.join("new.txt"), "conflict").expect("write conflict");

        let result = redo_last(&mut history, &paths);

        assert!(result.is_err());
        assert_eq!(history.undo_stack.len(), 0);
        assert_eq!(history.redo_stack.len(), 1);
        assert!(base.join("old.txt").exists());
        assert_eq!(
            fs::read_to_string(base.join("new.txt")).expect("read new"),
            "conflict"
        );
    }

    #[test]
    fn new_operation_clears_redo_but_keeps_timeline() {
        let paths = test_paths("redo_clear");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::write(base.join("old.txt"), "old").expect("write old");
        fs::write(base.join("another.txt"), "another").expect("write another");

        let mut history = FileOperationHistoryDto::default();
        fs_ops::move_path_exact(&base.join("old.txt"), &base.join("new.txt")).expect("rename file");
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Rename,
            vec![mapping(&base.join("old.txt"), &base.join("new.txt"))],
            None,
        )
        .expect("record rename");
        undo_last(&mut history, &paths).expect("undo rename");

        fs_ops::move_path_exact(&base.join("another.txt"), &base.join("moved.txt"))
            .expect("move another");
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Move,
            vec![mapping(&base.join("another.txt"), &base.join("moved.txt"))],
            None,
        )
        .expect("record move");

        assert_eq!(history.undo_stack.len(), 1);
        assert_eq!(history.redo_stack.len(), 0);
        assert_eq!(
            history
                .timeline
                .iter()
                .map(|entry| entry.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Renamed file", "Undid rename", "Moved file"]
        );
    }

    #[test]
    fn failed_undo_for_missing_source_keeps_history_unchanged() {
        let paths = test_paths("missing_source");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::write(base.join("old.txt"), "hello").expect("write old");

        let mut history = FileOperationHistoryDto::default();
        fs_ops::move_path_exact(&base.join("old.txt"), &base.join("new.txt")).expect("rename file");
        record_operation(
            &mut history,
            &paths,
            FileOperationKindDto::Rename,
            vec![mapping(&base.join("old.txt"), &base.join("new.txt"))],
            None,
        )
        .expect("record");
        fs::remove_file(base.join("new.txt")).expect("remove source");

        let result = undo_last(&mut history, &paths);

        assert!(result.is_err());
        assert_eq!(history.undo_stack.len(), 1);
        assert_eq!(history.redo_stack.len(), 0);
        assert_eq!(history.timeline.len(), 1);
    }

    #[test]
    fn cleanup_on_start_removes_stray_staging() {
        let paths = test_paths("cleanup");
        let base = paths.history_file_path.parent().unwrap().join("files");
        fs::create_dir_all(&base).expect("create files");
        fs::create_dir_all(paths.staging_dir_path.join("stray")).expect("create stray");
        fs::write(paths.staging_dir_path.join("stray/item.txt"), "old").expect("write stray");

        let referenced_dir = paths.staging_dir_path.join("keep");
        fs::create_dir_all(&referenced_dir).expect("create keep");
        fs::write(referenced_dir.join("item.txt"), "keep").expect("write keep");

        let mut history = FileOperationHistoryDto {
            undo_stack: Vec::new(),
            redo_stack: vec![FileOperationDto {
                id: "keep".to_string(),
                kind: FileOperationKindDto::Paste,
                label: "Paste 1 item(s)".to_string(),
                created_unix_ms: 1,
                item_count: 1,
                paths: vec![base.join("item.txt").to_string_lossy().to_string()],
                target_dir: Some(base.to_string_lossy().to_string()),
                mappings: vec![PathMappingDto {
                    source_path: base.join("source.txt").to_string_lossy().to_string(),
                    target_path: base.join("item.txt").to_string_lossy().to_string(),
                    staged_path: Some(
                        referenced_dir
                            .join("item.txt")
                            .to_string_lossy()
                            .to_string(),
                    ),
                }],
            }],
            ..Default::default()
        };
        save_history(&paths, &history).expect("save");

        history = load_or_init(&paths).expect("load");

        assert_eq!(history.redo_stack.len(), 1);
        assert!(!paths.staging_dir_path.join("stray").exists());
        assert!(referenced_dir.join("item.txt").exists());
    }
}
