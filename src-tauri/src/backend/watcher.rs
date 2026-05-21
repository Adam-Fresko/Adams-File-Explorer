use std::sync::mpsc;

use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::{backend::event_log, dto::LogEventDto};

#[derive(Default)]
pub struct WatcherManager {
    watcher: Option<RecommendedWatcher>,
}

impl WatcherManager {
    pub fn watch_current_dir(&mut self, app: AppHandle, path: &str) -> Result<(), String> {
        self.watcher.take();

        let watch_path = std::path::PathBuf::from(path);
        let watch_path_text = watch_path.to_string_lossy().to_string();
        let (tx, rx) = mpsc::channel::<String>();

        let mut watcher = recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                if let Some(first_path) = event.paths.first() {
                    let _ = tx.send(first_path.to_string_lossy().to_string());
                }
            }
        })
        .map_err(|err| format!("Watcher init failed: {err}"))?;

        watcher
            .watch(&watch_path, RecursiveMode::NonRecursive)
            .map_err(|err| format!("Watcher start failed: {err}"))?;

        event_log::log_backend_event(LogEventDto {
            component: Some("WatcherManager".to_string()),
            event_type: "watcher_started".to_string(),
            paths: vec![watch_path_text],
            status: Some("success".to_string()),
            ..Default::default()
        });

        tauri::async_runtime::spawn(async move {
            while let Ok(changed_path) = rx.recv() {
                event_log::log_backend_event(LogEventDto {
                    component: Some("WatcherManager".to_string()),
                    event_type: "fs_changed".to_string(),
                    paths: vec![changed_path.clone()],
                    ..Default::default()
                });
                let _ = app.emit("fs:changed", changed_path);
            }
        });

        self.watcher = Some(watcher);
        Ok(())
    }
}
