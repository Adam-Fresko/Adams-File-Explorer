use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::Output;

pub fn file_extension(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
}

pub fn extension_aliases(extension: &str) -> Vec<String> {
    let normalized = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();

    match normalized.as_str() {
        "jpg" => vec!["jpg".to_string(), "jpeg".to_string()],
        "jpeg" => vec!["jpeg".to_string(), "jpg".to_string()],
        "tif" => vec!["tif".to_string(), "tiff".to_string()],
        "tiff" => vec!["tiff".to_string(), "tif".to_string()],
        "heic" => vec!["heic".to_string(), "heif".to_string()],
        "heif" => vec!["heif".to_string(), "heic".to_string()],
        "" => Vec::new(),
        _ => vec![normalized],
    }
}

pub fn mapped_app_for_extension(
    open_with_map: &HashMap<String, String>,
    extension: &str,
) -> Option<String> {
    extension_aliases(extension)
        .into_iter()
        .find_map(|alias| open_with_map.get(&alias).cloned())
}

pub fn set_mapped_app_for_extension(
    open_with_map: &mut HashMap<String, String>,
    extension: &str,
    app_path: String,
) {
    for alias in extension_aliases(extension) {
        open_with_map.insert(alias, app_path.clone());
    }
}

pub fn choose_application_script() -> &'static str {
    r#"try
  set chosenApp to choose application with prompt "Choose app for file" as alias
  return POSIX path of chosenApp
on error number -128
  return ""
end try"#
}

fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn open_file_with_app_script(app_path: &str, file_path: &str) -> String {
    let app = escape_applescript_string(app_path);
    let file = escape_applescript_string(file_path);
    format!("tell application \"{app}\"\n  activate\n  open POSIX file \"{file}\"\nend tell")
}

pub fn command_failure_message(prefix: &str, output: &Output) -> String {
    let code = output
        .status
        .code()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "No error details".to_string()
    };

    format!("{prefix} (exit code {code}): {details}")
}

pub fn picker_failure_message(output: &Output) -> String {
    command_failure_message("App picker failed", output)
}

fn read_plist_value(info_plist: &Path, key: &str) -> Option<String> {
    if let Ok(output) = Command::new("plutil")
        .arg("-extract")
        .arg(key)
        .arg("raw")
        .arg("-o")
        .arg("-")
        .arg(info_plist)
        .output()
    {
        if output.status.success() {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    let output = Command::new("defaults")
        .arg("read")
        .arg(info_plist)
        .arg(key)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

pub fn jetbrains_open_invocation(app_path: &str, file_path: &str) -> Option<(String, Vec<String>)> {
    let bundle_root = PathBuf::from(app_path.trim_end_matches('/'));
    if bundle_root.extension().and_then(|ext| ext.to_str()) != Some("app") {
        return None;
    }

    let info_plist = bundle_root.join("Contents/Info.plist");
    if !info_plist.is_file() {
        return None;
    }

    let bundle_id = read_plist_value(&info_plist, "CFBundleIdentifier")?;
    if !bundle_id.starts_with("com.jetbrains.") {
        return None;
    }

    let executable_name = read_plist_value(&info_plist, "CFBundleExecutable")?;
    let executable_path = bundle_root.join("Contents/MacOS").join(executable_name);
    if !executable_path.is_file() {
        return None;
    }

    Some((
        executable_path.to_string_lossy().to_string(),
        vec!["--line".to_string(), "1".to_string(), file_path.to_string()],
    ))
}

#[cfg(test)]
mod tests {
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;

    use super::{
        choose_application_script, command_failure_message, extension_aliases,
        jetbrains_open_invocation, mapped_app_for_extension, open_file_with_app_script,
        picker_failure_message, set_mapped_app_for_extension,
    };

    use std::collections::HashMap;

    #[test]
    fn choose_application_script_is_valid_shape() {
        let script = choose_application_script();
        assert!(script.contains("choose application"));
        assert!(!script.contains("default location"));
    }

    #[test]
    fn extension_aliases_groups_close_image_extensions() {
        assert_eq!(extension_aliases("jpg"), vec!["jpg", "jpeg"]);
        assert_eq!(extension_aliases(".JPEG"), vec!["jpeg", "jpg"]);
        assert_eq!(extension_aliases("tif"), vec!["tif", "tiff"]);
        assert_eq!(extension_aliases("heif"), vec!["heif", "heic"]);
        assert_eq!(extension_aliases("png"), vec!["png"]);
    }

    #[test]
    fn mapped_app_for_extension_uses_aliases() {
        let mut map = HashMap::new();
        map.insert(
            "jpeg".to_string(),
            "/System/Applications/Preview.app".to_string(),
        );

        assert_eq!(
            mapped_app_for_extension(&map, "jpg"),
            Some("/System/Applications/Preview.app".to_string())
        );
        assert!(mapped_app_for_extension(&map, "png").is_none());
    }

    #[test]
    fn set_mapped_app_for_extension_saves_aliases() {
        let mut map = HashMap::new();
        set_mapped_app_for_extension(
            &mut map,
            "jpg",
            "/System/Applications/Preview.app".to_string(),
        );

        assert_eq!(
            map.get("jpg"),
            Some(&"/System/Applications/Preview.app".to_string())
        );
        assert_eq!(
            map.get("jpeg"),
            Some(&"/System/Applications/Preview.app".to_string())
        );
        assert!(!map.contains_key("png"));
    }

    #[test]
    fn picker_failure_message_uses_stderr_first() {
        let output = std::process::Output {
            status: ExitStatus::from_raw(256),
            stdout: b"stdout details".to_vec(),
            stderr: b"stderr details".to_vec(),
        };

        let message = picker_failure_message(&output);
        assert!(message.contains("exit code 1"));
        assert!(message.contains("stderr details"));
        assert!(!message.contains("stdout details"));
    }

    #[test]
    fn picker_failure_message_falls_back_to_stdout() {
        let output = std::process::Output {
            status: ExitStatus::from_raw(512),
            stdout: b"stdout details".to_vec(),
            stderr: Vec::new(),
        };

        let message = picker_failure_message(&output);
        assert!(message.contains("exit code 2"));
        assert!(message.contains("stdout details"));
    }

    #[test]
    fn open_file_script_contains_app_and_file() {
        let script =
            open_file_with_app_script("/Applications/WebStorm.app", "/tmp/example \"a\".json");
        assert!(script.contains("tell application \"/Applications/WebStorm.app\""));
        assert!(script.contains("open POSIX file \"/tmp/example \\\"a\\\".json\""));
    }

    #[test]
    fn command_failure_message_includes_prefix_code_and_details() {
        let output = std::process::Output {
            status: ExitStatus::from_raw(768),
            stdout: Vec::new(),
            stderr: b"broken".to_vec(),
        };

        let message = command_failure_message("Open failed", &output);
        assert!(message.contains("Open failed"));
        assert!(message.contains("exit code 3"));
        assert!(message.contains("broken"));
    }

    #[test]
    fn jetbrains_invocation_rejects_non_app_path() {
        let invocation = jetbrains_open_invocation("/tmp/not-an-app", "/tmp/a.json");
        assert!(invocation.is_none());
    }

    #[test]
    fn jetbrains_invocation_uses_line_without_temp_project() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_open_with_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let app_root = base.join("TestJetBrains.app");
        let plist_path = app_root.join("Contents/Info.plist");
        let executable_path = app_root.join("Contents/MacOS/test-jetbrains");

        std::fs::create_dir_all(
            executable_path
                .parent()
                .expect("executable parent should exist"),
        )
        .expect("create executable dir");

        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.jetbrains.test</string>
    <key>CFBundleExecutable</key>
    <string>test-jetbrains</string>
</dict>
</plist>"#;
        std::fs::write(&plist_path, plist).expect("write plist");
        std::fs::write(&executable_path, b"#!/bin/sh\n").expect("write executable");

        let invocation =
            jetbrains_open_invocation(app_root.to_string_lossy().as_ref(), "/tmp/example.ts")
                .expect("should produce invocation");

        assert_eq!(invocation.1[0], "--line");
        assert!(!invocation.1.iter().any(|arg| arg == "--temp-project"));

        let _ = std::fs::remove_dir_all(base);
    }
}
