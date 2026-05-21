use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use crate::dto::TreeNodeDto;

type Item = (PathBuf, String, bool, Option<i64>, Option<u64>, String);

fn entry_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn modified_unix_ms(metadata: &fs::Metadata) -> Option<i64> {
    let modified = metadata.modified().ok()?;
    match modified.duration_since(UNIX_EPOCH) {
        Ok(duration) => Some(duration.as_millis().min(i64::MAX as u128) as i64),
        Err(error) => {
            let ms = error.duration().as_millis().min(i64::MAX as u128) as i64;
            Some(-ms)
        }
    }
}

fn kind_label(path: &Path, is_dir: bool) -> String {
    if is_dir {
        return "Folder".to_string();
    }

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::trim)
        .filter(|ext| !ext.is_empty());

    if let Some(ext) = extension {
        return format!("{} File", ext.to_uppercase());
    }

    "File".to_string()
}

fn is_always_visible_dot_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".gitignore"
            | ".editorconfig"
            | ".npmrc"
            | ".prettierignore"
            | ".eslintignore"
            | ".nvmrc"
            | ".node-version"
            | ".rustfmt.toml"
            | ".cargo"
            | ".vscode"
            | ".idea"
    ) || name.starts_with(".env")
        || name.starts_with(".yarnrc")
        || name.starts_with(".prettierrc")
        || name.starts_with(".eslintrc")
}

fn should_hide_dot_name(name: &str, show_hidden: bool) -> bool {
    !show_hidden
        && name.starts_with('.')
        && name != "."
        && name != ".."
        && !is_always_visible_dot_name(name)
}

fn show_hidden_for_path(show_hidden_by_dir: &HashMap<String, bool>, path: &str) -> bool {
    show_hidden_by_dir.get(path).copied().unwrap_or(false)
}

pub fn list_children_with_hidden(
    path: &str,
    show_hidden: bool,
) -> Result<Vec<TreeNodeDto>, String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err("Directory does not exist".to_string());
    }
    if !target.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut items: Vec<Item> = fs::read_dir(target)
        .map_err(|err| format!("Failed to read directory: {err}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = entry_name(&path);
            if should_hide_dot_name(&name, show_hidden) {
                return None;
            }

            let is_dir = entry
                .file_type()
                .map(|kind| kind.is_dir())
                .unwrap_or_else(|_| path.is_dir());
            let metadata = entry.metadata().ok();

            let modified_unix_ms = metadata.as_ref().and_then(modified_unix_ms);
            let size_bytes = if is_dir {
                None
            } else {
                metadata.as_ref().map(fs::Metadata::len)
            };

            Some((
                path.clone(),
                name,
                is_dir,
                modified_unix_ms,
                size_bytes,
                kind_label(&path, is_dir),
            ))
        })
        .collect();

    items.sort_by(|(_, a_name, a_is_dir, ..), (_, b_name, b_is_dir, ..)| {
        b_is_dir
            .cmp(a_is_dir)
            .then_with(|| a_name.to_lowercase().cmp(&b_name.to_lowercase()))
    });

    Ok(items
        .into_iter()
        .map(
            |(path, name, is_dir, modified_unix_ms, size_bytes, kind_label)| TreeNodeDto {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                has_children: is_dir,
                modified_unix_ms,
                size_bytes,
                kind_label,
                children: None,
            },
        )
        .collect())
}

pub fn list_children(path: &str) -> Result<Vec<TreeNodeDto>, String> {
    list_children_with_hidden(path, false)
}

pub fn refresh_tree_with_hidden_by_dir(
    root: &str,
    expanded: &[String],
    show_hidden_by_dir: &HashMap<String, bool>,
) -> Result<Vec<TreeNodeDto>, String> {
    let expanded_set: HashSet<String> = expanded.iter().cloned().collect();
    let mut nodes =
        list_children_with_hidden(root, show_hidden_for_path(show_hidden_by_dir, root))?;

    for node in &mut nodes {
        hydrate(node, &expanded_set, show_hidden_by_dir)?;
    }

    Ok(nodes)
}

fn hydrate(
    node: &mut TreeNodeDto,
    expanded_set: &HashSet<String>,
    show_hidden_by_dir: &HashMap<String, bool>,
) -> Result<(), String> {
    if !node.is_dir || !expanded_set.contains(&node.path) {
        return Ok(());
    }

    let mut children = list_children_with_hidden(
        &node.path,
        show_hidden_for_path(show_hidden_by_dir, &node.path),
    )?;
    for child in &mut children {
        hydrate(child, expanded_set, show_hidden_by_dir)?;
    }

    node.children = Some(children);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, fs, path::PathBuf};

    use super::{list_children, list_children_with_hidden, refresh_tree_with_hidden_by_dir};

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "adams_file_explorer_tree_{name}_{}",
            std::process::id()
        ))
    }

    fn child_names(path: &PathBuf, show_hidden: bool) -> Vec<String> {
        list_children_with_hidden(path.to_string_lossy().as_ref(), show_hidden)
            .expect("list")
            .into_iter()
            .map(|node| node.name)
            .collect()
    }

    #[test]
    fn list_children_returns_dir_items_with_metadata() {
        let base = test_dir("metadata");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("folder")).expect("create folder");
        fs::write(base.join("file.txt"), "hello").expect("write file");

        let children = list_children(base.to_string_lossy().as_ref()).expect("list");
        assert_eq!(children.len(), 2);

        let folder = children
            .iter()
            .find(|node| node.name == "folder")
            .expect("folder exists");
        assert!(folder.is_dir);
        assert_eq!(folder.kind_label, "Folder");
        assert!(folder.size_bytes.is_none());
        assert!(folder.modified_unix_ms.is_some());

        let file = children
            .iter()
            .find(|node| node.name == "file.txt")
            .expect("file exists");
        assert!(!file.is_dir);
        assert_eq!(file.kind_label, "TXT File");
        assert_eq!(file.size_bytes, Some(5));
        assert!(file.modified_unix_ms.is_some());

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn list_children_sets_kind_for_extensionless_file() {
        let base = test_dir("noext");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create base");
        fs::write(base.join("README"), "ok").expect("write file");

        let children = list_children(base.to_string_lossy().as_ref()).expect("list");
        let file = children
            .iter()
            .find(|node| node.name == "README")
            .expect("README exists");
        assert_eq!(file.kind_label, "File");
        assert_eq!(file.size_bytes, Some(2));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn list_children_hides_clutter_dot_files_by_default() {
        let base = test_dir("hide_dot");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join(".cache")).expect("create cache");
        fs::write(base.join(".DS_Store"), "system").expect("write ds store");
        fs::write(base.join("visible.txt"), "ok").expect("write visible");

        let names = child_names(&base, false);
        assert!(names.contains(&"visible.txt".to_string()));
        assert!(!names.contains(&".cache".to_string()));
        assert!(!names.contains(&".DS_Store".to_string()));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn list_children_keeps_common_project_dot_files_visible() {
        let base = test_dir("dev_dot");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join(".git")).expect("create git");
        fs::create_dir_all(base.join(".vscode")).expect("create vscode");
        fs::write(base.join(".env.local"), "TOKEN=test").expect("write env");
        fs::write(base.join(".gitignore"), "target").expect("write gitignore");
        fs::write(base.join(".prettierrc.json"), "{}").expect("write prettier");
        fs::write(base.join(".eslintrc.cjs"), "module.exports = {}").expect("write eslint");

        let names = child_names(&base, false);
        assert!(names.contains(&".git".to_string()));
        assert!(names.contains(&".vscode".to_string()));
        assert!(names.contains(&".env.local".to_string()));
        assert!(names.contains(&".gitignore".to_string()));
        assert!(names.contains(&".prettierrc.json".to_string()));
        assert!(names.contains(&".eslintrc.cjs".to_string()));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn list_children_with_hidden_shows_all_dot_files() {
        let base = test_dir("show_dot");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join(".cache")).expect("create cache");
        fs::write(base.join(".DS_Store"), "system").expect("write ds store");

        let names = child_names(&base, true);
        assert!(names.contains(&".cache".to_string()));
        assert!(names.contains(&".DS_Store".to_string()));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn refresh_tree_uses_separate_hidden_settings_per_folder() {
        let base = test_dir("per_folder");
        let _ = fs::remove_dir_all(&base);
        let shown_dir = base.join("shown");
        let hidden_dir = base.join("hidden");
        fs::create_dir_all(&shown_dir).expect("create shown");
        fs::create_dir_all(&hidden_dir).expect("create hidden");
        fs::write(shown_dir.join(".cache"), "visible here").expect("write shown cache");
        fs::write(hidden_dir.join(".cache"), "hidden here").expect("write hidden cache");

        let shown_path = shown_dir.to_string_lossy().to_string();
        let hidden_path = hidden_dir.to_string_lossy().to_string();
        let mut show_hidden_by_dir = HashMap::new();
        show_hidden_by_dir.insert(shown_path.clone(), true);
        show_hidden_by_dir.insert(hidden_path.clone(), false);

        let tree = refresh_tree_with_hidden_by_dir(
            base.to_string_lossy().as_ref(),
            &[shown_path.clone(), hidden_path.clone()],
            &show_hidden_by_dir,
        )
        .expect("refresh");

        let shown = tree
            .iter()
            .find(|node| node.path == shown_path)
            .expect("shown dir");
        let hidden = tree
            .iter()
            .find(|node| node.path == hidden_path)
            .expect("hidden dir");
        assert!(shown
            .children
            .as_ref()
            .is_some_and(|children| children.iter().any(|node| node.name == ".cache")));
        assert!(hidden
            .children
            .as_ref()
            .is_some_and(|children| children.iter().all(|node| node.name != ".cache")));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn list_children_rejects_missing_path() {
        let path = format!("/tmp/not-found-{}", std::process::id());
        let result = list_children(&path);
        assert!(result.is_err());
    }
}
