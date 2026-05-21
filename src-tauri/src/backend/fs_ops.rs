use std::{
    fs,
    path::{Path, PathBuf},
};

use arboard::Clipboard;

use crate::dto::{MoveConflictDto, MovePreviewDto, OpResultDto, PathMappingDto};

fn is_child_of(source: &Path, target_dir: &Path) -> bool {
    let source = match fs::canonicalize(source) {
        Ok(path) => path,
        Err(_) => return false,
    };
    let target_dir = match fs::canonicalize(target_dir) {
        Ok(path) => path,
        Err(_) => return false,
    };

    target_dir.starts_with(source)
}

fn make_target_path(source: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    let mut candidate = make_natural_target_path(source, target_dir)?;
    if !candidate.exists() {
        return Ok(candidate);
    }

    let stem = source
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("copy")
        .to_string();
    let ext = source.extension().and_then(|v| v.to_str()).unwrap_or("");

    for idx in 1..=500 {
        let name = if ext.is_empty() {
            format!("{stem} ({idx})")
        } else {
            format!("{stem} ({idx}).{ext}")
        };

        candidate = target_dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Too many duplicate files".to_string())
}

fn make_natural_target_path(source: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    let Some(name) = source.file_name() else {
        return Err("Path has no file name".to_string());
    };

    Ok(target_dir.join(name))
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn is_same_parent(source: &Path, target_dir: &Path) -> bool {
    let Some(parent) = source.parent() else {
        return false;
    };

    paths_equal(parent, target_dir)
}

fn copy_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_file() {
        fs::copy(source, target).map_err(|err| format!("Copy failed: {err}"))?;
        return Ok(());
    }

    if source.is_dir() {
        fs::create_dir_all(target).map_err(|err| format!("Create dir failed: {err}"))?;
        for item in fs::read_dir(source).map_err(|err| format!("Read dir failed: {err}"))? {
            let item = item.map_err(|err| format!("Read item failed: {err}"))?;
            let source_child = item.path();
            let target_child = target.join(item.file_name());
            copy_recursively(&source_child, &target_child)?;
        }
        return Ok(());
    }

    Err("Source does not exist".to_string())
}

fn remove_path(path: &Path) -> Result<(), String> {
    if path.is_dir() && !path.is_symlink() {
        fs::remove_dir_all(path).map_err(|err| format!("Remove dir failed: {err}"))?;
        return Ok(());
    }

    fs::remove_file(path).map_err(|err| format!("Remove file failed: {err}"))
}

pub fn move_path_exact(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }

    if target.exists() {
        return Err("Target already exists".to_string());
    }

    let parent = target
        .parent()
        .ok_or_else(|| "Target has no parent folder".to_string())?;
    if !parent.exists() {
        return Err("Target parent does not exist".to_string());
    }

    match fs::rename(source, target) {
        Ok(_) => Ok(()),
        Err(_) => {
            copy_recursively(source, target)?;
            if let Err(error) = remove_path(source) {
                let _ = remove_path(target);
                return Err(error);
            }
            Ok(())
        }
    }
}

fn validate_item_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name cannot be empty".to_string());
    }

    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators".to_string());
    }

    Ok(())
}

pub fn write_clipboard(paths: &[String]) -> Result<(), String> {
    let joined = paths.join("\n");
    let mut clipboard = Clipboard::new().map_err(|err| format!("Clipboard unavailable: {err}"))?;
    clipboard
        .set_text(joined)
        .map_err(|err| format!("Clipboard write failed: {err}"))
}

pub fn read_clipboard_paths() -> Vec<String> {
    let mut clipboard = match Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(_) => return Vec::new(),
    };

    match clipboard.get_text() {
        Ok(text) => text
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with('/'))
            .map(ToOwned::to_owned)
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub fn copy_into(paths: &[String], target_dir: &str) -> OpResultDto {
    let target = Path::new(target_dir);
    let mut success_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut mappings = Vec::new();

    for path in paths {
        let source = Path::new(path);
        if source.is_dir() && is_child_of(source, target) {
            failed_paths.push(path.clone());
            continue;
        }

        let target_path = match make_target_path(source, target) {
            Ok(path) => path,
            Err(_) => {
                failed_paths.push(path.clone());
                continue;
            }
        };

        if copy_recursively(source, &target_path).is_ok() {
            let target_path = target_path.to_string_lossy().to_string();
            success_paths.push(target_path.clone());
            mappings.push(PathMappingDto {
                source_path: path.clone(),
                target_path,
                staged_path: None,
            });
        } else {
            failed_paths.push(path.clone());
        }
    }

    let message = format!(
        "Copied {} item(s), failed {}",
        success_paths.len(),
        failed_paths.len()
    );

    OpResultDto {
        success_paths,
        failed_paths,
        message,
        mappings,
        history: None,
    }
}

pub fn move_into(paths: &[String], target_dir: &str) -> OpResultDto {
    let target = Path::new(target_dir);
    let mut success_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut mappings = Vec::new();

    for path in paths {
        let source = Path::new(path);
        if !source.exists() || !target.is_dir() || is_same_parent(source, target) {
            failed_paths.push(path.clone());
            continue;
        }

        if source.is_dir() && is_child_of(source, target) {
            failed_paths.push(path.clone());
            continue;
        }

        let target_path = match make_target_path(source, target) {
            Ok(path) => path,
            Err(_) => {
                failed_paths.push(path.clone());
                continue;
            }
        };

        match fs::rename(source, &target_path) {
            Ok(_) => {
                let target_path = target_path.to_string_lossy().to_string();
                success_paths.push(target_path.clone());
                mappings.push(PathMappingDto {
                    source_path: path.clone(),
                    target_path,
                    staged_path: None,
                });
            }
            Err(_) => {
                if copy_recursively(source, &target_path).is_ok() && trash::delete(path).is_ok() {
                    let target_path = target_path.to_string_lossy().to_string();
                    success_paths.push(target_path.clone());
                    mappings.push(PathMappingDto {
                        source_path: path.clone(),
                        target_path,
                        staged_path: None,
                    });
                } else {
                    failed_paths.push(path.clone());
                }
            }
        }
    }

    let message = format!(
        "Moved {} item(s), failed {}",
        success_paths.len(),
        failed_paths.len()
    );

    OpResultDto {
        success_paths,
        failed_paths,
        message,
        mappings,
        history: None,
    }
}

pub fn preview_move_into(paths: &[String], target_dir: &str) -> Result<MovePreviewDto, String> {
    let target = Path::new(target_dir);
    if !target.is_dir() {
        return Err("Target path is not a folder".to_string());
    }

    let mut conflicts = Vec::new();
    for path in paths {
        let source = Path::new(path);
        if !source.exists() {
            continue;
        }

        let target_path = make_natural_target_path(source, target)?;
        if !target_path.exists() {
            continue;
        }

        let source_is_dir = source.is_dir();
        let target_is_dir = target_path.is_dir();
        conflicts.push(MoveConflictDto {
            source_path: path.clone(),
            target_path: target_path.to_string_lossy().to_string(),
            source_is_dir,
            target_is_dir,
            same_kind: source_is_dir == target_is_dir,
        });
    }

    Ok(MovePreviewDto { conflicts })
}

pub fn move_into_replacing(paths: &[String], target_dir: &str) -> Result<OpResultDto, String> {
    let target = Path::new(target_dir);
    if !target.is_dir() {
        return Err("Target path is not a folder".to_string());
    }

    let mut planned_moves = Vec::new();
    for path in paths {
        let source = Path::new(path);
        if !source.exists() {
            return Err(format!("Source does not exist: {path}"));
        }

        if is_same_parent(source, target) {
            return Err("Item is already in the target folder".to_string());
        }

        if source.is_dir() && is_child_of(source, target) {
            return Err("Cannot move a folder into itself or its child".to_string());
        }

        let target_path = make_natural_target_path(source, target)?;
        if target_path.exists() && source.is_dir() != target_path.is_dir() {
            return Err("Replace requires the same item kind".to_string());
        }

        planned_moves.push((PathBuf::from(source), target_path));
    }

    let mut success_paths = Vec::new();
    let mut mappings = Vec::new();
    for (source, target_path) in planned_moves {
        if target_path.exists() {
            trash::delete(&target_path).map_err(|err| format!("Replace failed: {err}"))?;
        }

        move_path_exact(&source, &target_path)?;
        let source_path = source.to_string_lossy().to_string();
        let target_path = target_path.to_string_lossy().to_string();
        success_paths.push(target_path.clone());
        mappings.push(PathMappingDto {
            source_path,
            target_path,
            staged_path: None,
        });
    }

    let message = format!("Moved {} item(s), failed 0", success_paths.len());
    Ok(OpResultDto {
        success_paths,
        failed_paths: Vec::new(),
        message,
        mappings,
        history: None,
    })
}

pub fn rename_item(path: &str, new_name: &str) -> Result<String, String> {
    validate_item_name(new_name)?;

    let source = Path::new(path);
    if !source.exists() {
        return Err("Item does not exist".to_string());
    }

    let current_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Path has no file name".to_string())?;

    if current_name == new_name {
        return Err("Name is unchanged".to_string());
    }

    let parent = source
        .parent()
        .ok_or_else(|| "Path has no parent folder".to_string())?;
    let target = parent.join(new_name);

    if target.exists() {
        return Err("An item with that name already exists".to_string());
    }

    fs::rename(source, &target).map_err(|err| format!("Rename failed: {err}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn create_directory(parent_dir: &str, name: &str) -> Result<String, String> {
    validate_item_name(name)?;

    let parent = Path::new(parent_dir);
    if !parent.exists() {
        return Err("Parent folder does not exist".to_string());
    }

    if !parent.is_dir() {
        return Err("Parent path is not a folder".to_string());
    }

    let target = parent.join(name);
    if target.exists() {
        return Err("An item with that name already exists".to_string());
    }

    fs::create_dir(&target).map_err(|err| format!("Create folder failed: {err}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn delete_to_trash(paths: &[String]) -> OpResultDto {
    let mut success_paths = Vec::new();
    let mut failed_paths = Vec::new();

    for path in paths {
        match trash::delete(path) {
            Ok(_) => success_paths.push(path.clone()),
            Err(_) => failed_paths.push(path.clone()),
        }
    }

    let message = format!(
        "Deleted {} item(s), failed {}",
        success_paths.len(),
        failed_paths.len()
    );

    OpResultDto {
        success_paths,
        failed_paths,
        message,
        mappings: Vec::new(),
        history: None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        copy_into, create_directory, move_into, move_into_replacing, move_path_exact,
        preview_move_into, rename_item,
    };

    #[test]
    fn copy_into_success_and_failure() {
        let base =
            std::env::temp_dir().join(format!("adams_file_explorer_copy_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("a.txt"), "hello").expect("write a");

        let ok = copy_into(
            &[base.join("a.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        );
        assert_eq!(ok.failed_paths.len(), 0);
        assert_eq!(ok.mappings.len(), 1);

        let fail = copy_into(
            &[base.join("missing.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        );
        assert_eq!(fail.success_paths.len(), 0);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_success_and_failure() {
        let base =
            std::env::temp_dir().join(format!("adams_file_explorer_move_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("a.txt"), "hello").expect("write a");

        let ok = move_into(
            &[base.join("a.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        );
        assert_eq!(ok.failed_paths.len(), 0);
        assert_eq!(ok.mappings.len(), 1);

        let fail = move_into(
            &[base.join("missing.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        );
        assert_eq!(fail.success_paths.len(), 0);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_keep_both_creates_numbered_target() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_keep_both_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source")).expect("create source");
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("source/a.txt"), "source").expect("write source");
        fs::write(base.join("target/a.txt"), "target").expect("write target");

        let result = move_into(
            &[base.join("source/a.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        );

        assert_eq!(result.failed_paths.len(), 0);
        assert_eq!(
            result.success_paths,
            vec![base.join("target/a (1).txt").to_string_lossy()]
        );
        assert_eq!(
            fs::read_to_string(base.join("target/a.txt")).expect("read original"),
            "target"
        );
        assert_eq!(
            fs::read_to_string(base.join("target/a (1).txt")).expect("read moved"),
            "source"
        );
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn preview_move_into_reports_conflicts() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_preview_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source")).expect("create source");
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("source/a.txt"), "source").expect("write source");
        fs::write(base.join("target/a.txt"), "target").expect("write target");

        let result = preview_move_into(
            &[base.join("source/a.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        )
        .expect("preview move");

        assert_eq!(result.conflicts.len(), 1);
        assert!(result.conflicts[0].same_kind);
        assert!(!result.conflicts[0].source_is_dir);
        assert!(!result.conflicts[0].target_is_dir);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_replacing_replaces_same_kind_file() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_replace_file_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source")).expect("create source");
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("source/a.txt"), "source").expect("write source");
        fs::write(base.join("target/a.txt"), "target").expect("write target");

        let result = move_into_replacing(
            &[base.join("source/a.txt").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        )
        .expect("replace file");

        assert_eq!(result.failed_paths.len(), 0);
        assert_eq!(result.mappings.len(), 1);
        assert!(result.history.is_none());
        assert!(!base.join("source/a.txt").exists());
        assert_eq!(
            fs::read_to_string(base.join("target/a.txt")).expect("read replaced"),
            "source"
        );
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_replacing_replaces_same_kind_folder() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_replace_folder_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source/folder")).expect("create source folder");
        fs::create_dir_all(base.join("target/folder")).expect("create target folder");
        fs::write(base.join("source/folder/source.txt"), "source").expect("write source");
        fs::write(base.join("target/folder/target.txt"), "target").expect("write target");

        let result = move_into_replacing(
            &[base.join("source/folder").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        )
        .expect("replace folder");

        assert_eq!(result.failed_paths.len(), 0);
        assert_eq!(result.mappings.len(), 1);
        assert!(!base.join("source/folder").exists());
        assert!(base.join("target/folder/source.txt").exists());
        assert!(!base.join("target/folder/target.txt").exists());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_replacing_rejects_mixed_kind_conflict() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_replace_mixed_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source/folder")).expect("create source folder");
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("target/folder"), "target file").expect("write target");

        let result = move_into_replacing(
            &[base.join("source/folder").to_string_lossy().to_string()],
            base.join("target").to_string_lossy().as_ref(),
        );

        assert!(result.is_err());
        assert!(base.join("source/folder").is_dir());
        assert_eq!(
            fs::read_to_string(base.join("target/folder")).expect("read target"),
            "target file"
        );
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_replacing_prechecks_before_changing_files() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_replace_all_or_nothing_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source/folder")).expect("create source folder");
        fs::create_dir_all(base.join("target")).expect("create target");
        fs::write(base.join("source/a.txt"), "source").expect("write source");
        fs::write(base.join("target/a.txt"), "target").expect("write target");
        fs::write(base.join("target/folder"), "target file").expect("write mixed target");

        let result = move_into_replacing(
            &[
                base.join("source/a.txt").to_string_lossy().to_string(),
                base.join("source/folder").to_string_lossy().to_string(),
            ],
            base.join("target").to_string_lossy().as_ref(),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(base.join("source/a.txt")).expect("read source"),
            "source"
        );
        assert_eq!(
            fs::read_to_string(base.join("target/a.txt")).expect("read target"),
            "target"
        );
        assert!(base.join("source/folder").is_dir());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn copy_into_rejects_copying_dir_into_own_child() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_copy_loop_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source/child")).expect("create source tree");

        let result = copy_into(
            &[base.join("source").to_string_lossy().to_string()],
            base.join("source/child").to_string_lossy().as_ref(),
        );

        assert_eq!(result.success_paths.len(), 0);
        assert_eq!(result.failed_paths.len(), 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_into_rejects_moving_dir_into_own_child() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_loop_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("source/child")).expect("create source tree");

        let result = move_into(
            &[base.join("source").to_string_lossy().to_string()],
            base.join("source/child").to_string_lossy().as_ref(),
        );

        assert_eq!(result.success_paths.len(), 0);
        assert_eq!(result.failed_paths.len(), 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn rename_item_success() {
        let base =
            std::env::temp_dir().join(format!("adams_file_explorer_rename_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");
        fs::write(base.join("old.txt"), "hello").expect("write file");

        let new_path = rename_item(base.join("old.txt").to_string_lossy().as_ref(), "new.txt")
            .expect("rename item");

        assert_eq!(new_path, base.join("new.txt").to_string_lossy().to_string());
        assert!(base.join("new.txt").exists());
        assert!(!base.join("old.txt").exists());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn rename_item_rejects_invalid_names() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_rename_invalid_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");
        fs::write(base.join("old.txt"), "hello").expect("write file");

        let path = base.join("old.txt").to_string_lossy().to_string();

        assert!(rename_item(&path, "").is_err());
        assert!(rename_item(&path, "child/name.txt").is_err());
        assert!(rename_item(&path, "child\\name.txt").is_err());
        assert!(rename_item(&path, "old.txt").is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn rename_item_rejects_duplicate_target() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_rename_duplicate_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");
        fs::write(base.join("old.txt"), "hello").expect("write old");
        fs::write(base.join("new.txt"), "existing").expect("write new");

        let result = rename_item(base.join("old.txt").to_string_lossy().as_ref(), "new.txt");

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(base.join("new.txt")).expect("read new"),
            "existing"
        );
        assert!(base.join("old.txt").exists());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn create_directory_success() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_create_dir_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");

        let new_path = create_directory(base.to_string_lossy().as_ref(), "New Folder")
            .expect("create directory");

        assert_eq!(
            new_path,
            base.join("New Folder").to_string_lossy().to_string()
        );
        assert!(base.join("New Folder").is_dir());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn create_directory_rejects_invalid_names() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_create_dir_invalid_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");

        let parent = base.to_string_lossy().to_string();

        assert!(create_directory(&parent, "").is_err());
        assert!(create_directory(&parent, "child/name").is_err());
        assert!(create_directory(&parent, "child\\name").is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn create_directory_rejects_duplicate_target() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_create_dir_duplicate_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("Existing")).expect("create existing");

        let result = create_directory(base.to_string_lossy().as_ref(), "Existing");

        assert!(result.is_err());
        assert!(base.join("Existing").is_dir());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn move_path_exact_rejects_existing_target() {
        let base = std::env::temp_dir().join(format!(
            "adams_file_explorer_move_exact_existing_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");
        fs::write(base.join("source.txt"), "source").expect("write source");
        fs::write(base.join("target.txt"), "target").expect("write target");

        let result = move_path_exact(&base.join("source.txt"), &base.join("target.txt"));

        assert!(result.is_err());
        assert!(base.join("source.txt").exists());
        assert_eq!(
            fs::read_to_string(base.join("target.txt")).expect("read target"),
            "target"
        );
        let _ = fs::remove_dir_all(base);
    }
}
