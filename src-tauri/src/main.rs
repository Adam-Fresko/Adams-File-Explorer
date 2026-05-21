mod backend;
mod commands;
mod dto;

#[cfg(target_os = "macos")]
use tauri::RunEvent;

use commands::{ClipboardState, ConfigState, FsWatcherState, OpenPathState, OperationHistoryState};

fn main() {
    let builder = tauri::Builder::default()
        .manage(ClipboardState::default())
        .manage(ConfigState::default())
        .manage(FsWatcherState::default())
        .manage(OpenPathState::default())
        .manage(OperationHistoryState::default())
        .invoke_handler(tauri::generate_handler![
            commands::cmd_log_event,
            commands::cmd_get_log_file_path,
            commands::cmd_init_state,
            commands::cmd_list_children,
            commands::cmd_change_directory,
            commands::cmd_add_favorite,
            commands::cmd_remove_favorite,
            commands::cmd_copy_to_clipboard,
            commands::cmd_copy_paths_as_text,
            commands::cmd_paste_into,
            commands::cmd_preview_move_items,
            commands::cmd_move_items,
            commands::cmd_rename_item,
            commands::cmd_create_folder,
            commands::cmd_create_directory,
            commands::cmd_delete_to_trash,
            commands::cmd_get_file_operation_history,
            commands::cmd_undo_file_operation,
            commands::cmd_redo_file_operation,
            commands::cmd_open_terminal_here,
            commands::cmd_open_file,
            commands::cmd_choose_open_with,
            commands::cmd_set_open_with,
            commands::cmd_set_sort_preference,
            commands::cmd_set_column_widths,
            commands::cmd_set_favorites_collapsed,
            commands::cmd_set_show_hidden,
            commands::cmd_get_open_with_icon_map,
            commands::cmd_get_image_thumbnail,
            commands::cmd_refresh_tree,
            commands::cmd_get_default_folder_browser_status,
            commands::cmd_set_default_folder_browser,
            commands::cmd_reset_default_folder_browser,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri app");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            commands::handle_opened_urls(app_handle, urls);
        }
    });
}
