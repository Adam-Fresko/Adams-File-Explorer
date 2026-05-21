use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::dto::AppConfigDto;

const CONFIG_NAME: &str = "explorer_config.json";
const CONFIG_DIR: &str = "adams_file_explorer";
const LEGACY_CONFIG_DIR: &str = "file_explorer";

fn config_path_for(dir_name: &str) -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(dir_name).join(CONFIG_NAME)
}

pub fn config_path() -> PathBuf {
    config_path_for(CONFIG_DIR)
}

fn legacy_config_path() -> PathBuf {
    config_path_for(LEGACY_CONFIG_DIR)
}

fn migrate_legacy_config_if_needed(current: &Path, legacy: &Path) -> Result<(), String> {
    if current.exists() || !legacy.exists() {
        return Ok(());
    }

    if let Some(parent) = current.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Failed to create config dir: {err}"))?;
    }

    fs::copy(legacy, current)
        .map(|_| ())
        .map_err(|err| format!("Failed to migrate config: {err}"))
}

pub fn load_config() -> Result<AppConfigDto, String> {
    let path = config_path();
    migrate_legacy_config_if_needed(&path, &legacy_config_path())?;

    if !path.exists() {
        return Ok(AppConfigDto::default());
    }

    let raw = fs::read_to_string(&path).map_err(|err| format!("Failed to read config: {err}"))?;
    serde_json::from_str::<AppConfigDto>(&raw)
        .map_err(|err| format!("Failed to parse config {}: {err}", path.display()))
}

pub fn save_config(config: &AppConfigDto) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Failed to create config dir: {err}"))?;
    }

    let raw = serde_json::to_string_pretty(config)
        .map_err(|err| format!("Failed to serialize config: {err}"))?;

    fs::write(path, raw).map_err(|err| format!("Failed to write config: {err}"))
}

pub fn normalize_directory(path: &str) -> Result<String, String> {
    let path = Path::new(path);
    let canonical = fs::canonicalize(path).map_err(|err| format!("Invalid directory: {err}"))?;

    if !canonical.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "adams_file_explorer_config_{name}_{}",
            std::process::id()
        ))
    }

    #[test]
    fn migrate_legacy_config_copies_when_current_is_missing() {
        let base = test_dir("copy_missing");
        let _ = fs::remove_dir_all(&base);

        let legacy = base.join("legacy").join(CONFIG_NAME);
        let current = base.join("current").join(CONFIG_NAME);
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(
            &legacy,
            r#"{"favorites":[],"last_directory":"/tmp","open_with_map":{}}"#,
        )
        .unwrap();

        migrate_legacy_config_if_needed(&current, &legacy).unwrap();

        assert_eq!(
            fs::read_to_string(&current).unwrap(),
            fs::read_to_string(&legacy).unwrap()
        );
        assert!(legacy.exists());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn migrate_legacy_config_keeps_existing_current_config() {
        let base = test_dir("keep_current");
        let _ = fs::remove_dir_all(&base);

        let legacy = base.join("legacy").join(CONFIG_NAME);
        let current = base.join("current").join(CONFIG_NAME);
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::create_dir_all(current.parent().unwrap()).unwrap();
        fs::write(&legacy, "legacy").unwrap();
        fs::write(&current, "current").unwrap();

        migrate_legacy_config_if_needed(&current, &legacy).unwrap();

        assert_eq!(fs::read_to_string(&current).unwrap(), "current");
        assert_eq!(fs::read_to_string(&legacy).unwrap(), "legacy");

        let _ = fs::remove_dir_all(&base);
    }
}
