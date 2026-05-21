use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
    time::Instant,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Url};

use crate::{
    backend::{
        app_icons, config, default_folder_browser, event_log, file_history, fs_ops,
        image_thumbnails, open_with, tree, watcher::WatcherManager,
    },
    dto::{
        AppConfigDto, ColumnWidthsDto, DefaultFolderBrowserStatusDto, DirectoryStateDto,
        FileOperationCommandResultDto, FileOperationHistoryDto, FileOperationKindDto, InitStateDto,
        LogEventDto, MoveConflictActionDto, MovePreviewDto, OpResultDto, PathMappingDto,
        PathOperationResultDto, SortPreferenceDto, TreeNodeDto,
    },
};

#[derive(Default)]
pub struct ClipboardState {
    pub paths: Mutex<Vec<String>>,
}

#[derive(Default)]
pub struct ConfigState {
    pub value: Mutex<AppConfigDto>,
}

#[derive(Default)]
pub struct FsWatcherState {
    pub manager: Mutex<WatcherManager>,
}

#[derive(Default)]
pub struct OpenPathState {
    pub value: Mutex<PendingOpenPathState>,
}

pub struct OperationHistoryState {
    pub value: Mutex<FileOperationHistoryDto>,
    pub running: Mutex<bool>,
    pub paths: file_history::HistoryPaths,
}

impl Default for OperationHistoryState {
    fn default() -> Self {
        Self {
            value: Mutex::new(FileOperationHistoryDto::default()),
            running: Mutex::new(false),
            paths: file_history::HistoryPaths::default(),
        }
    }
}

#[derive(Default)]
pub struct PendingOpenPathState {
    pub pending_open_path: Option<String>,
    pub ui_initialized: bool,
}

fn lock<'a, T>(mutex: &'a Mutex<T>) -> Result<std::sync::MutexGuard<'a, T>, String> {
    mutex.lock().map_err(|_| "State lock poisoned".to_string())
}

fn duration_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn command_event(
    command: &str,
    status: &str,
    paths: Vec<String>,
    target_dir: Option<String>,
    target_path: Option<String>,
    duration_ms: Option<u64>,
    error: Option<String>,
    details: Option<Value>,
    result: Option<Value>,
) {
    event_log::log_backend_event(LogEventDto {
        component: Some("commands".to_string()),
        event_type: "command".to_string(),
        command: Some(command.to_string()),
        paths,
        target_path,
        target_dir,
        status: Some(status.to_string()),
        duration_ms,
        error,
        details,
        result,
    });
}

fn run_logged_command<T, F, S>(
    command: &str,
    paths: Vec<String>,
    target_dir: Option<String>,
    target_path: Option<String>,
    details: Option<Value>,
    run: F,
    summarize: S,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
    S: FnOnce(&T) -> Option<Value>,
{
    command_event(
        command,
        "started",
        paths.clone(),
        target_dir.clone(),
        target_path.clone(),
        None,
        None,
        details.clone(),
        None,
    );

    let started = Instant::now();
    let result = run();
    let elapsed = Some(duration_ms(started));

    match &result {
        Ok(value) => command_event(
            command,
            "success",
            paths,
            target_dir,
            target_path,
            elapsed,
            None,
            details,
            summarize(value),
        ),
        Err(error) => command_event(
            command,
            "failure",
            paths,
            target_dir,
            target_path,
            elapsed,
            Some(error.clone()),
            details,
            None,
        ),
    }

    result
}

fn op_result_summary(result: &OpResultDto) -> Value {
    json!({
        "success_paths": result.success_paths.clone(),
        "failed_paths": result.failed_paths.clone(),
        "message": result.message.clone(),
        "mapping_count": result.mappings.len(),
        "undo_count": result.history.as_ref().map(|history| history.undo_stack.len()),
        "redo_count": result.history.as_ref().map(|history| history.redo_stack.len()),
        "timeline_count": result.history.as_ref().map(|history| history.timeline.len()),
    })
}

fn move_preview_summary(result: &MovePreviewDto) -> Value {
    json!({
        "conflict_count": result.conflicts.len(),
    })
}

fn path_result_summary(result: &PathOperationResultDto) -> Value {
    json!({
        "path": result.path.clone(),
        "message": result.message.clone(),
        "undo_count": result.history.undo_stack.len(),
        "redo_count": result.history.redo_stack.len(),
        "timeline_count": result.history.timeline.len(),
    })
}

fn history_result_summary(result: &FileOperationCommandResultDto) -> Value {
    json!({
        "message": result.message.clone(),
        "affected_paths": result.affected_paths.clone(),
        "undo_count": result.history.undo_stack.len(),
        "redo_count": result.history.redo_stack.len(),
        "timeline_count": result.history.timeline.len(),
    })
}

struct OperationRunGuard<'a> {
    running: MutexGuard<'a, bool>,
}

impl Drop for OperationRunGuard<'_> {
    fn drop(&mut self) {
        *self.running = false;
    }
}

fn begin_history_operation(
    history_state: &OperationHistoryState,
) -> Result<OperationRunGuard<'_>, String> {
    let mut running = lock(&history_state.running)?;
    if *running {
        return Err("Undo or redo is already running".to_string());
    }

    *running = true;
    Ok(OperationRunGuard { running })
}

fn record_history_operation(
    history_state: &OperationHistoryState,
    kind: FileOperationKindDto,
    mappings: Vec<PathMappingDto>,
    target_dir: Option<String>,
) -> Result<FileOperationHistoryDto, String> {
    let mut history = lock(&history_state.value)?;
    file_history::record_operation(
        &mut history,
        &history_state.paths,
        kind,
        mappings,
        target_dir,
    )
}

fn default_folder_browser_summary(status: &DefaultFolderBrowserStatusDto) -> Value {
    json!({
        "is_default": status.is_default,
        "can_set": status.can_set,
        "message": status.message.clone(),
    })
}

fn preferred_start_dir(cfg: &AppConfigDto) -> String {
    if let Some(saved) = cfg.last_directory.clone() {
        if let Ok(path) = config::normalize_directory(&saved) {
            return path;
        }
    }

    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/"))
        .to_string_lossy()
        .to_string()
}

fn write_config(state: &ConfigState) -> Result<(), String> {
    let config = lock(&state.value)?.clone();
    config::save_config(&config)
}

fn show_hidden_for_dir(cfg: &AppConfigDto, path: &str) -> bool {
    cfg.show_hidden_by_dir.get(path).copied().unwrap_or(false)
}

fn refresh_current_tree(path: &str, show_hidden: bool) -> Result<Vec<TreeNodeDto>, String> {
    tree::list_children_with_hidden(path, show_hidden)
}

fn update_watcher(
    app: AppHandle,
    watcher_state: &FsWatcherState,
    path: &str,
) -> Result<(), String> {
    lock(&watcher_state.manager)?.watch_current_dir(app, path)
}

fn first_valid_directory_from_urls(urls: Vec<Url>) -> Option<String> {
    urls.into_iter().find_map(|url| {
        if url.scheme() != "file" {
            return None;
        }

        let file_path = url.to_file_path().ok()?;
        let candidate = file_path.to_string_lossy().to_string();
        config::normalize_directory(&candidate).ok()
    })
}

fn queue_or_emit_open_path(app: &AppHandle, path: String) {
    let open_state = app.state::<OpenPathState>();
    let should_emit = match lock(&open_state.value) {
        Ok(mut state) => {
            if state.ui_initialized {
                true
            } else {
                state.pending_open_path = Some(path.clone());
                false
            }
        }
        Err(err) => {
            event_log::log_backend_event(LogEventDto {
                component: Some("commands".to_string()),
                event_type: "open_path_state_lock_failed".to_string(),
                paths: vec![path.clone()],
                error: Some(err.clone()),
                ..Default::default()
            });
            eprintln!("Failed to lock open-path state: {err}");
            false
        }
    };

    if !should_emit {
        event_log::log_backend_event(LogEventDto {
            component: Some("commands".to_string()),
            event_type: "open_path_queued".to_string(),
            paths: vec![path],
            status: Some("queued".to_string()),
            ..Default::default()
        });
        return;
    }

    if app.emit("app:open-path", path.clone()).is_err() {
        event_log::log_backend_event(LogEventDto {
            component: Some("commands".to_string()),
            event_type: "open_path_emit_failed".to_string(),
            paths: vec![path.clone()],
            status: Some("queued".to_string()),
            ..Default::default()
        });
        if let Ok(mut state) = lock(&open_state.value) {
            state.pending_open_path = Some(path);
        }
    } else {
        event_log::log_backend_event(LogEventDto {
            component: Some("commands".to_string()),
            event_type: "open_path_emitted".to_string(),
            paths: vec![path],
            status: Some("success".to_string()),
            ..Default::default()
        });
    }
}

pub fn handle_opened_urls(app: &AppHandle, urls: Vec<Url>) {
    if let Some(path) = first_valid_directory_from_urls(urls) {
        event_log::log_backend_event(LogEventDto {
            component: Some("commands".to_string()),
            event_type: "opened_urls_received".to_string(),
            paths: vec![path.clone()],
            ..Default::default()
        });
        queue_or_emit_open_path(app, path);
    }
}

#[tauri::command]
pub fn cmd_log_event(event: LogEventDto) -> Result<(), String> {
    event_log::log_frontend_event(event);
    Ok(())
}

#[tauri::command]
pub fn cmd_get_log_file_path() -> Result<String, String> {
    run_logged_command(
        "cmd_get_log_file_path",
        Vec::new(),
        None,
        None,
        None,
        || Ok(event_log::log_file_path().to_string_lossy().to_string()),
        |path| Some(json!({ "log_file_path": path.clone() })),
    )
}

#[tauri::command]
pub fn cmd_init_state(
    app: AppHandle,
    config_state: State<ConfigState>,
    watcher_state: State<FsWatcherState>,
    open_state: State<OpenPathState>,
    operation_history_state: State<OperationHistoryState>,
) -> Result<InitStateDto, String> {
    run_logged_command(
        "cmd_init_state",
        Vec::new(),
        None,
        None,
        None,
        || {
            let loaded = config::load_config()?;
            let file_operation_history =
                file_history::load_or_init(&operation_history_state.paths)?;
            {
                let mut cfg = lock(&config_state.value)?;
                *cfg = loaded;
            }
            {
                let mut history = lock(&operation_history_state.value)?;
                *history = file_operation_history.clone();
            }

            let mut cfg = lock(&config_state.value)?;
            let current_dir = {
                let mut state = lock(&open_state.value)?;
                state.ui_initialized = true;

                state
                    .pending_open_path
                    .take()
                    .and_then(|path| config::normalize_directory(&path).ok())
                    .unwrap_or_else(|| preferred_start_dir(&cfg))
            };
            cfg.last_directory = Some(current_dir.clone());
            config::save_config(&cfg)?;

            update_watcher(app, &watcher_state, &current_dir)?;
            let show_hidden = show_hidden_for_dir(&cfg, &current_dir);

            Ok(InitStateDto {
                current_dir: current_dir.clone(),
                favorites: cfg.favorites.clone(),
                favorites_collapsed: cfg.favorites_collapsed,
                tree: refresh_current_tree(&current_dir, show_hidden)?,
                show_hidden,
                open_with_map: cfg.open_with_map.clone(),
                sort_preference: cfg.sort_preference.clone(),
                column_widths: cfg.column_widths.clone(),
                file_operation_history,
            })
        },
        |data| {
            Some(json!({
                "current_dir": data.current_dir.clone(),
                "favorite_count": data.favorites.len(),
                "root_count": data.tree.len(),
                "show_hidden": data.show_hidden,
            }))
        },
    )
}

#[tauri::command]
pub fn cmd_list_children(
    path: String,
    config_state: State<ConfigState>,
) -> Result<Vec<TreeNodeDto>, String> {
    run_logged_command(
        "cmd_list_children",
        vec![path.clone()],
        Some(path.clone()),
        None,
        None,
        || {
            let show_hidden = {
                let cfg = lock(&config_state.value)?;
                show_hidden_for_dir(&cfg, &path)
            };
            tree::list_children_with_hidden(&path, show_hidden)
        },
        |children| Some(json!({ "child_count": children.len() })),
    )
}

#[tauri::command]
pub fn cmd_change_directory(
    app: AppHandle,
    path: String,
    config_state: State<ConfigState>,
    watcher_state: State<FsWatcherState>,
) -> Result<DirectoryStateDto, String> {
    run_logged_command(
        "cmd_change_directory",
        vec![path.clone()],
        Some(path.clone()),
        None,
        None,
        || {
            let dir = config::normalize_directory(&path)?;

            let show_hidden = {
                let mut cfg = lock(&config_state.value)?;
                cfg.last_directory = Some(dir.clone());
                show_hidden_for_dir(&cfg, &dir)
            };
            write_config(&config_state)?;
            update_watcher(app, &watcher_state, &dir)?;

            Ok(DirectoryStateDto {
                current_dir: dir.clone(),
                tree: refresh_current_tree(&dir, show_hidden)?,
                show_hidden,
            })
        },
        |data| {
            Some(json!({
                "current_dir": data.current_dir.clone(),
                "root_count": data.tree.len(),
                "show_hidden": data.show_hidden,
            }))
        },
    )
}

#[tauri::command]
pub fn cmd_add_favorite(
    path: String,
    config_state: State<ConfigState>,
) -> Result<Vec<String>, String> {
    run_logged_command(
        "cmd_add_favorite",
        vec![path.clone()],
        Some(path.clone()),
        None,
        None,
        || {
            let normalized = config::normalize_directory(&path)?;
            {
                let mut cfg = lock(&config_state.value)?;
                if !cfg.favorites.contains(&normalized) {
                    cfg.favorites.push(normalized.clone());
                }
            }
            write_config(&config_state)?;
            Ok(lock(&config_state.value)?.favorites.clone())
        },
        |favorites| Some(json!({ "favorite_count": favorites.len() })),
    )
}

#[tauri::command]
pub fn cmd_remove_favorite(
    path: String,
    config_state: State<ConfigState>,
) -> Result<Vec<String>, String> {
    run_logged_command(
        "cmd_remove_favorite",
        vec![path.clone()],
        Some(path.clone()),
        None,
        None,
        || {
            {
                let mut cfg = lock(&config_state.value)?;
                cfg.favorites.retain(|item| item != &path);
            }
            write_config(&config_state)?;
            Ok(lock(&config_state.value)?.favorites.clone())
        },
        |favorites| Some(json!({ "favorite_count": favorites.len() })),
    )
}

#[tauri::command]
pub fn cmd_copy_to_clipboard(
    paths: Vec<String>,
    clipboard_state: State<ClipboardState>,
) -> Result<(), String> {
    run_logged_command(
        "cmd_copy_to_clipboard",
        paths.clone(),
        None,
        None,
        Some(json!({ "item_count": paths.len() })),
        || {
            {
                let mut clip = lock(&clipboard_state.paths)?;
                *clip = paths.clone();
            }

            fs_ops::write_clipboard(&paths)
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_copy_paths_as_text(paths: Vec<String>) -> Result<(), String> {
    run_logged_command(
        "cmd_copy_paths_as_text",
        paths.clone(),
        None,
        None,
        Some(json!({ "item_count": paths.len() })),
        || fs_ops::write_clipboard(&paths),
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_paste_into(
    target_dir: String,
    clipboard_state: State<ClipboardState>,
    operation_history_state: State<OperationHistoryState>,
) -> Result<OpResultDto, String> {
    run_logged_command(
        "cmd_paste_into",
        Vec::new(),
        Some(target_dir.clone()),
        None,
        None,
        || {
            let normalized = config::normalize_directory(&target_dir)?;

            let paths = {
                let clip = lock(&clipboard_state.paths)?;
                if clip.is_empty() {
                    fs_ops::read_clipboard_paths()
                } else {
                    clip.clone()
                }
            };

            if paths.is_empty() {
                return Ok(OpResultDto {
                    success_paths: Vec::new(),
                    failed_paths: Vec::new(),
                    message: "Clipboard is empty".to_string(),
                    mappings: Vec::new(),
                    history: None,
                });
            }

            let mut result = fs_ops::copy_into(&paths, &normalized);
            if !result.mappings.is_empty() {
                result.history = Some(record_history_operation(
                    &operation_history_state,
                    FileOperationKindDto::Paste,
                    result.mappings.clone(),
                    Some(normalized),
                )?);
            }
            Ok(result)
        },
        |result| Some(op_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_preview_move_items(
    paths: Vec<String>,
    target_dir: String,
) -> Result<MovePreviewDto, String> {
    run_logged_command(
        "cmd_preview_move_items",
        paths.clone(),
        Some(target_dir.clone()),
        None,
        Some(json!({ "item_count": paths.len() })),
        || {
            let normalized = config::normalize_directory(&target_dir)?;
            fs_ops::preview_move_into(&paths, &normalized)
        },
        |result| Some(move_preview_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_move_items(
    paths: Vec<String>,
    target_dir: String,
    conflict_action: MoveConflictActionDto,
    operation_history_state: State<OperationHistoryState>,
) -> Result<OpResultDto, String> {
    run_logged_command(
        "cmd_move_items",
        paths.clone(),
        Some(target_dir.clone()),
        None,
        Some(json!({
            "item_count": paths.len(),
            "conflict_action": conflict_action.clone(),
        })),
        || {
            let normalized = config::normalize_directory(&target_dir)?;
            let mut result = match conflict_action {
                MoveConflictActionDto::KeepBoth => fs_ops::move_into(&paths, &normalized),
                MoveConflictActionDto::Replace => fs_ops::move_into_replacing(&paths, &normalized)?,
            };
            if !result.mappings.is_empty() && conflict_action == MoveConflictActionDto::KeepBoth {
                result.history = Some(record_history_operation(
                    &operation_history_state,
                    FileOperationKindDto::Move,
                    result.mappings.clone(),
                    Some(normalized),
                )?);
            }
            Ok(result)
        },
        |result| Some(op_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_rename_item(
    path: String,
    new_name: String,
    operation_history_state: State<OperationHistoryState>,
) -> Result<PathOperationResultDto, String> {
    run_logged_command(
        "cmd_rename_item",
        vec![path.clone()],
        None,
        None,
        Some(json!({ "new_name": new_name.clone() })),
        || {
            let new_path = fs_ops::rename_item(&path, &new_name)?;
            let history = record_history_operation(
                &operation_history_state,
                FileOperationKindDto::Rename,
                vec![PathMappingDto {
                    source_path: path.clone(),
                    target_path: new_path.clone(),
                    staged_path: None,
                }],
                None,
            )?;
            Ok(PathOperationResultDto {
                path: new_path,
                message: "Renamed item".to_string(),
                history,
            })
        },
        |result| Some(path_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_create_folder(
    parent_dir: String,
    name: String,
    operation_history_state: State<OperationHistoryState>,
) -> Result<PathOperationResultDto, String> {
    run_logged_command(
        "cmd_create_folder",
        Vec::new(),
        Some(parent_dir.clone()),
        None,
        Some(json!({ "name": name.clone() })),
        || {
            let new_path = fs_ops::create_directory(&parent_dir, &name)?;
            let history = lock(&operation_history_state.value)?.clone();
            Ok(PathOperationResultDto {
                path: new_path,
                message: "Created folder".to_string(),
                history,
            })
        },
        |result| Some(path_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_create_directory(
    parent_dir: String,
    name: String,
    operation_history_state: State<OperationHistoryState>,
) -> Result<PathOperationResultDto, String> {
    cmd_create_folder(parent_dir, name, operation_history_state)
}

#[tauri::command]
pub fn cmd_delete_to_trash(paths: Vec<String>) -> Result<OpResultDto, String> {
    run_logged_command(
        "cmd_delete_to_trash",
        paths.clone(),
        None,
        None,
        Some(json!({ "item_count": paths.len() })),
        || Ok(fs_ops::delete_to_trash(&paths)),
        |result| Some(op_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_get_file_operation_history(
    operation_history_state: State<OperationHistoryState>,
) -> Result<FileOperationHistoryDto, String> {
    run_logged_command(
        "cmd_get_file_operation_history",
        Vec::new(),
        None,
        None,
        None,
        || Ok(lock(&operation_history_state.value)?.clone()),
        |history| {
            Some(json!({
                "undo_count": history.undo_stack.len(),
                "redo_count": history.redo_stack.len(),
                "timeline_count": history.timeline.len(),
            }))
        },
    )
}

#[tauri::command]
pub fn cmd_undo_file_operation(
    operation_history_state: State<OperationHistoryState>,
) -> Result<FileOperationCommandResultDto, String> {
    run_logged_command(
        "cmd_undo_file_operation",
        Vec::new(),
        None,
        None,
        None,
        || {
            let _guard = begin_history_operation(&operation_history_state)?;
            let mut history = lock(&operation_history_state.value)?;
            file_history::undo_last(&mut history, &operation_history_state.paths)
        },
        |result| Some(history_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_redo_file_operation(
    operation_history_state: State<OperationHistoryState>,
) -> Result<FileOperationCommandResultDto, String> {
    run_logged_command(
        "cmd_redo_file_operation",
        Vec::new(),
        None,
        None,
        None,
        || {
            let _guard = begin_history_operation(&operation_history_state)?;
            let mut history = lock(&operation_history_state.value)?;
            file_history::redo_last(&mut history, &operation_history_state.paths)
        },
        |result| Some(history_result_summary(result)),
    )
}

#[tauri::command]
pub fn cmd_open_terminal_here(path: String) -> Result<(), String> {
    run_logged_command(
        "cmd_open_terminal_here",
        vec![path.clone()],
        Some(path.clone()),
        None,
        None,
        || {
            let dir = config::normalize_directory(&path)?;
            std::process::Command::new("open")
                .arg("-a")
                .arg("Terminal")
                .arg(&dir)
                .status()
                .map_err(|err| format!("Failed to open Terminal: {err}"))?;

            Ok(())
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_open_file(path: String, config_state: State<ConfigState>) -> Result<(), String> {
    run_logged_command(
        "cmd_open_file",
        vec![path.clone()],
        None,
        None,
        Some(json!({ "extension": open_with::file_extension(&path) })),
        || {
            let extension = open_with::file_extension(&path);
            let mapped = extension.as_ref().and_then(|ext| {
                lock(&config_state.value)
                    .ok()
                    .and_then(|cfg| open_with::mapped_app_for_extension(&cfg.open_with_map, ext))
            });

            if let Some(app_path) = mapped {
                let mut failures: Vec<String> = Vec::new();

                let output = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(open_with::open_file_with_app_script(&app_path, &path))
                    .output()
                    .map_err(|err| format!("Failed to open file with selected app: {err}"))?;

                if output.status.success() {
                    return Ok(());
                }

                failures.push(open_with::command_failure_message(
                    "AppleScript open failed",
                    &output,
                ));

                if let Some((program, args)) =
                    open_with::jetbrains_open_invocation(&app_path, &path)
                {
                    let output = std::process::Command::new(program)
                        .args(args)
                        .output()
                        .map_err(|err| format!("Failed to run JetBrains launcher: {err}"))?;

                    if output.status.success() {
                        return Ok(());
                    }

                    failures.push(open_with::command_failure_message(
                        "JetBrains launcher failed",
                        &output,
                    ));
                }

                // Fallback to `open -a` for apps that reject scripting.
                let output = std::process::Command::new("open")
                    .arg("-a")
                    .arg(&app_path)
                    .arg(&path)
                    .output()
                    .map_err(|err| format!("Failed to open file with selected app: {err}"))?;

                if output.status.success() {
                    return Ok(());
                }

                failures.push(open_with::command_failure_message(
                    "open -a failed",
                    &output,
                ));

                return Err(format!(
                    "Failed to open file with selected app. {}",
                    failures.join(" | ")
                ));
            }

            std::process::Command::new("open")
                .arg(path)
                .status()
                .map_err(|err| format!("Failed to open file: {err}"))?;

            Ok(())
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_choose_open_with(path: String) -> Result<Option<String>, String> {
    run_logged_command(
        "cmd_choose_open_with",
        vec![path],
        None,
        None,
        None,
        || {
            let output = std::process::Command::new("osascript")
                .arg("-e")
                .arg(open_with::choose_application_script())
                .output()
                .map_err(|err| format!("Failed to open app picker: {err}"))?;

            if !output.status.success() {
                return Err(open_with::picker_failure_message(&output));
            }

            let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if selected.is_empty() {
                Ok(None)
            } else {
                Ok(Some(selected))
            }
        },
        |selected| Some(json!({ "selected_app": selected.clone() })),
    )
}

#[tauri::command]
pub fn cmd_set_open_with(
    extension: String,
    app_path: String,
    config_state: State<ConfigState>,
) -> Result<(), String> {
    run_logged_command(
        "cmd_set_open_with",
        vec![app_path.clone()],
        None,
        Some(app_path.clone()),
        Some(json!({ "extension": extension.clone() })),
        || {
            {
                let mut cfg = lock(&config_state.value)?;
                open_with::set_mapped_app_for_extension(
                    &mut cfg.open_with_map,
                    &extension,
                    app_path,
                );
            }
            write_config(&config_state)
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_set_sort_preference(
    sort_preference: SortPreferenceDto,
    config_state: State<ConfigState>,
) -> Result<(), String> {
    run_logged_command(
        "cmd_set_sort_preference",
        Vec::new(),
        None,
        None,
        Some(json!({ "sort_preference": sort_preference.clone() })),
        || {
            {
                let mut cfg = lock(&config_state.value)?;
                cfg.sort_preference = Some(sort_preference);
            }
            write_config(&config_state)
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_set_column_widths(
    column_widths: ColumnWidthsDto,
    config_state: State<ConfigState>,
) -> Result<(), String> {
    run_logged_command(
        "cmd_set_column_widths",
        Vec::new(),
        None,
        None,
        Some(json!({ "column_widths": column_widths.clone() })),
        || {
            {
                let mut cfg = lock(&config_state.value)?;
                cfg.column_widths = column_widths;
            }
            write_config(&config_state)
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_set_favorites_collapsed(
    collapsed: bool,
    config_state: State<ConfigState>,
) -> Result<(), String> {
    run_logged_command(
        "cmd_set_favorites_collapsed",
        Vec::new(),
        None,
        None,
        Some(json!({ "collapsed": collapsed })),
        || {
            {
                let mut cfg = lock(&config_state.value)?;
                cfg.favorites_collapsed = collapsed;
            }
            write_config(&config_state)
        },
        |_| None,
    )
}

#[tauri::command]
pub fn cmd_set_show_hidden(
    path: String,
    show_hidden: bool,
    expanded: Vec<String>,
    config_state: State<ConfigState>,
) -> Result<DirectoryStateDto, String> {
    run_logged_command(
        "cmd_set_show_hidden",
        vec![path.clone()],
        Some(path.clone()),
        None,
        Some(json!({
            "show_hidden": show_hidden,
            "expanded_count": expanded.len(),
        })),
        || {
            let dir = config::normalize_directory(&path)?;
            let show_hidden_by_dir = {
                let mut cfg = lock(&config_state.value)?;
                cfg.show_hidden_by_dir.insert(dir.clone(), show_hidden);
                cfg.show_hidden_by_dir.clone()
            };

            write_config(&config_state)?;

            Ok(DirectoryStateDto {
                current_dir: dir.clone(),
                tree: tree::refresh_tree_with_hidden_by_dir(&dir, &expanded, &show_hidden_by_dir)?,
                show_hidden,
            })
        },
        |data| {
            Some(json!({
                "current_dir": data.current_dir.clone(),
                "root_count": data.tree.len(),
                "show_hidden": data.show_hidden,
            }))
        },
    )
}

#[tauri::command]
pub fn cmd_get_open_with_icon_map(
    config_state: State<ConfigState>,
) -> Result<HashMap<String, String>, String> {
    run_logged_command(
        "cmd_get_open_with_icon_map",
        Vec::new(),
        None,
        None,
        None,
        || {
            let open_with_map = lock(&config_state.value)?.open_with_map.clone();
            Ok(app_icons::open_with_icon_data_urls(&open_with_map))
        },
        |icon_map| Some(json!({ "icon_count": icon_map.len() })),
    )
}

#[tauri::command]
pub fn cmd_get_image_thumbnail(path: String) -> Result<Option<String>, String> {
    run_logged_command(
        "cmd_get_image_thumbnail",
        vec![path.clone()],
        None,
        None,
        None,
        || Ok(image_thumbnails::thumbnail_data_url(&path)),
        |thumbnail| Some(json!({ "has_thumbnail": thumbnail.is_some() })),
    )
}

#[tauri::command]
pub fn cmd_get_default_folder_browser_status(
    app: AppHandle,
) -> Result<DefaultFolderBrowserStatusDto, String> {
    run_logged_command(
        "cmd_get_default_folder_browser_status",
        Vec::new(),
        None,
        None,
        None,
        || Ok(default_folder_browser::status(&app.config().identifier)),
        |status| Some(default_folder_browser_summary(status)),
    )
}

#[tauri::command]
pub fn cmd_set_default_folder_browser(
    app: AppHandle,
) -> Result<DefaultFolderBrowserStatusDto, String> {
    run_logged_command(
        "cmd_set_default_folder_browser",
        Vec::new(),
        None,
        None,
        None,
        || default_folder_browser::set_default(&app.config().identifier),
        |status| Some(default_folder_browser_summary(status)),
    )
}

#[tauri::command]
pub fn cmd_reset_default_folder_browser(
    app: AppHandle,
) -> Result<DefaultFolderBrowserStatusDto, String> {
    run_logged_command(
        "cmd_reset_default_folder_browser",
        Vec::new(),
        None,
        None,
        None,
        || default_folder_browser::reset_default(&app.config().identifier),
        |status| Some(default_folder_browser_summary(status)),
    )
}

#[tauri::command]
pub fn cmd_refresh_tree(
    root: String,
    expanded: Vec<String>,
    config_state: State<ConfigState>,
) -> Result<Vec<TreeNodeDto>, String> {
    run_logged_command(
        "cmd_refresh_tree",
        vec![root.clone()],
        Some(root.clone()),
        None,
        Some(json!({ "expanded_count": expanded.len() })),
        || {
            let show_hidden_by_dir = lock(&config_state.value)?.show_hidden_by_dir.clone();
            tree::refresh_tree_with_hidden_by_dir(&root, &expanded, &show_hidden_by_dir)
        },
        |tree| Some(json!({ "root_count": tree.len() })),
    )
}
