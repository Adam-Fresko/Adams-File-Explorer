use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

use crate::dto::LogEventDto;

const LOG_FILE_NAME: &str = "explorer_events.jsonl";
const LOG_DIR: &str = "adams_file_explorer";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const ROTATED_LOGS: usize = 3;
const MAX_STRING_CHARS: usize = 4096;
const MAX_ARRAY_ITEMS: usize = 50;
const MAX_OBJECT_FIELDS: usize = 50;
const MAX_VALUE_DEPTH: usize = 5;

static SESSION_ID: OnceLock<String> = OnceLock::new();
static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn log_file_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(LOG_DIR)
        .join(LOG_FILE_NAME)
}

pub fn log_frontend_event(event: LogEventDto) {
    let _ = write_event("frontend", event);
}

pub fn log_backend_event(event: LogEventDto) {
    let _ = write_event("backend", event);
}

fn write_event(source: &str, event: LogEventDto) -> Result<(), String> {
    if event.event_type.trim().is_empty() {
        return Ok(());
    }

    let _guard = LOG_WRITE_LOCK
        .lock()
        .map_err(|_| "Log write lock poisoned".to_string())?;

    let path = log_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Failed to create log dir: {err}"))?;
    }

    rotate_if_needed(&path)?;

    let line = serde_json::to_string(&event_line(source, event))
        .map_err(|err| format!("Failed to serialize log event: {err}"))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| format!("Failed to open log file: {err}"))?;
    writeln!(file, "{line}").map_err(|err| format!("Failed to write log file: {err}"))
}

fn event_line(source: &str, event: LogEventDto) -> Value {
    let mut line = Map::new();
    line.insert("timestamp_unix_ms".to_string(), json!(timestamp_unix_ms()));
    line.insert("session_id".to_string(), json!(session_id()));
    line.insert("source".to_string(), json!(source));
    line.insert("event_type".to_string(), json!(event.event_type));

    insert_string(&mut line, "component", event.component);
    insert_string(&mut line, "command", event.command);
    insert_string(&mut line, "target_path", event.target_path);
    insert_string(&mut line, "target_dir", event.target_dir);
    insert_string(&mut line, "status", event.status);
    insert_string(&mut line, "error", event.error);

    if !event.paths.is_empty() {
        line.insert("paths".to_string(), json!(trim_strings(event.paths)));
    }

    if let Some(duration_ms) = event.duration_ms {
        line.insert("duration_ms".to_string(), json!(duration_ms));
    }

    if let Some(details) = event.details {
        line.insert("details".to_string(), sanitize_value(details, 0));
    }

    if let Some(result) = event.result {
        line.insert("result".to_string(), sanitize_value(result, 0));
    }

    Value::Object(line)
}

fn insert_string(line: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        if !value.is_empty() {
            line.insert(key.to_string(), json!(trim_string(value)));
        }
    }
}

fn timestamp_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn session_id() -> &'static str {
    SESSION_ID.get_or_init(|| {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or(0)
        )
    })
}

fn trim_strings(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .take(MAX_ARRAY_ITEMS)
        .map(trim_string)
        .collect()
}

fn trim_string(value: String) -> String {
    if value.chars().count() <= MAX_STRING_CHARS {
        return value;
    }

    let mut trimmed: String = value.chars().take(MAX_STRING_CHARS).collect();
    trimmed.push_str("...[truncated]");
    trimmed
}

fn sanitize_value(value: Value, depth: usize) -> Value {
    if depth >= MAX_VALUE_DEPTH {
        return json!("[truncated]");
    }

    match value {
        Value::String(value) => Value::String(trim_string(value)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .take(MAX_ARRAY_ITEMS)
                .map(|value| sanitize_value(value, depth + 1))
                .collect(),
        ),
        Value::Object(values) => {
            let mut object = Map::new();
            let mut was_truncated = false;

            for (index, (key, value)) in values.into_iter().enumerate() {
                if index >= MAX_OBJECT_FIELDS {
                    was_truncated = true;
                    break;
                }

                object.insert(trim_string(key), sanitize_value(value, depth + 1));
            }

            if was_truncated {
                object.insert("_truncated".to_string(), Value::Bool(true));
            }

            Value::Object(object)
        }
        other => other,
    }
}

fn rotate_if_needed(path: &Path) -> Result<(), String> {
    if fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        < MAX_LOG_BYTES
    {
        return Ok(());
    }

    let oldest = rotated_path(path, ROTATED_LOGS);
    if oldest.exists() {
        fs::remove_file(&oldest).map_err(|err| format!("Failed to remove old log: {err}"))?;
    }

    for index in (1..=ROTATED_LOGS).rev() {
        let from = if index == 1 {
            path.to_path_buf()
        } else {
            rotated_path(path, index - 1)
        };
        let to = rotated_path(path, index);

        if from.exists() {
            fs::rename(&from, &to).map_err(|err| format!("Failed to rotate log: {err}"))?;
        }
    }

    Ok(())
}

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| LOG_FILE_NAME.into());
    path.with_file_name(format!("{file_name}.{index}"))
}
