use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

const ICON_CACHE_DIR: &str = "adams_file_explorer/open_with_icons";

fn read_plist_value(info_plist: &Path, key: &str) -> Option<String> {
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

fn app_bundle_root(app_path: &str) -> Option<PathBuf> {
    let bundle_root = PathBuf::from(app_path.trim_end_matches('/'));
    if bundle_root.extension().and_then(|ext| ext.to_str()) != Some("app") {
        return None;
    }
    if !bundle_root.is_dir() {
        return None;
    }
    Some(bundle_root)
}

fn icon_name_from_bundle(bundle_root: &Path) -> Option<String> {
    let info_plist = bundle_root.join("Contents/Info.plist");
    if !info_plist.is_file() {
        return None;
    }
    read_plist_value(&info_plist, "CFBundleIconFile")
}

fn normalized_icon_file_name(icon_name: &str) -> String {
    let trimmed = icon_name.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if Path::new(trimmed).extension().is_some() {
        trimmed.to_string()
    } else {
        format!("{trimmed}.icns")
    }
}

fn first_icns_in_resources(resources_dir: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = fs::read_dir(resources_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("icns"))
                .unwrap_or(false)
        })
        .collect();

    candidates.sort();
    candidates.into_iter().next()
}

fn resolve_icon_from_resources(resources_dir: &Path, icon_name: Option<&str>) -> Option<PathBuf> {
    if !resources_dir.is_dir() {
        return None;
    }

    if let Some(icon_name) = icon_name {
        let normalized = normalized_icon_file_name(icon_name);
        if !normalized.is_empty() {
            let configured = resources_dir.join(normalized);
            if configured.is_file() {
                return Some(configured);
            }
        }
    }

    first_icns_in_resources(resources_dir)
}

fn resolve_icon_source(app_path: &str) -> Option<PathBuf> {
    let bundle_root = app_bundle_root(app_path)?;
    let resources_dir = bundle_root.join("Contents/Resources");
    let configured_icon = icon_name_from_bundle(&bundle_root);
    resolve_icon_from_resources(&resources_dir, configured_icon.as_deref())
}

fn modified_nanos(path: &Path) -> Option<i128> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    match modified.duration_since(UNIX_EPOCH) {
        Ok(duration) => Some(duration.as_nanos() as i128),
        Err(error) => Some(-(error.duration().as_nanos() as i128)),
    }
}

fn icon_cache_key(
    app_path: &str,
    icon_source: &Path,
    icon_size: u64,
    icon_modified_nanos: i128,
) -> String {
    let mut hasher = DefaultHasher::new();
    app_path.hash(&mut hasher);
    icon_source.to_string_lossy().hash(&mut hasher);
    icon_size.hash(&mut hasher);
    icon_modified_nanos.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn cache_dir() -> Option<PathBuf> {
    Some(dirs::cache_dir()?.join(ICON_CACHE_DIR))
}

fn ensure_cached_png(app_path: &str, icon_source: &Path) -> Option<PathBuf> {
    let metadata = fs::metadata(icon_source).ok()?;
    let icon_modified_nanos = modified_nanos(icon_source)?;
    let cache_key = icon_cache_key(app_path, icon_source, metadata.len(), icon_modified_nanos);
    let output_dir = cache_dir()?;
    fs::create_dir_all(&output_dir).ok()?;
    let png_path = output_dir.join(format!("{cache_key}.png"));

    if png_path.is_file() {
        return Some(png_path);
    }

    let output = Command::new("sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg("-Z")
        .arg("32")
        .arg(icon_source)
        .arg("--out")
        .arg(&png_path)
        .output()
        .ok()?;

    if !output.status.success() {
        let _ = fs::remove_file(&png_path);
        return None;
    }

    if png_path.is_file() {
        Some(png_path)
    } else {
        None
    }
}

fn png_as_data_url(png_path: &Path) -> Option<String> {
    let bytes = fs::read(png_path).ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

pub fn open_with_icon_data_urls(
    open_with_map: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut icon_map = HashMap::new();

    for (extension, app_path) in open_with_map {
        let Some(icon_source) = resolve_icon_source(app_path) else {
            continue;
        };
        let Some(png_path) = ensure_cached_png(app_path, &icon_source) else {
            continue;
        };
        let Some(data_url) = png_as_data_url(&png_path) else {
            continue;
        };

        icon_map.insert(extension.clone(), data_url);
    }

    icon_map
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{icon_cache_key, resolve_icon_from_resources};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
        let unique_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "adams_file_explorer_app_icons_{name}_{}_{}",
            std::process::id(),
            unique_id
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn resolve_icon_uses_icon_name_without_extension() {
        let base = temp_dir("no_ext");
        let resources = base.join("Resources");
        fs::create_dir_all(&resources).expect("create resources");
        let icon_path = resources.join("webstorm.icns");
        fs::write(&icon_path, b"not real icns").expect("write icon");

        let resolved = resolve_icon_from_resources(&resources, Some("webstorm"));
        assert_eq!(resolved, Some(icon_path));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn resolve_icon_falls_back_to_first_icns_when_configured_missing() {
        let base = temp_dir("fallback");
        let resources = base.join("Resources");
        fs::create_dir_all(&resources).expect("create resources");
        let alpha = resources.join("alpha.icns");
        let zeta = resources.join("zeta.icns");
        fs::write(&zeta, b"z").expect("write zeta");
        fs::write(&alpha, b"a").expect("write alpha");

        let resolved = resolve_icon_from_resources(&resources, Some("missing-icon"));
        assert_eq!(resolved, Some(alpha));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn cache_key_changes_when_icon_fingerprint_changes() {
        let app_path = "/Applications/WebStorm.app";
        let icon_source = Path::new("/Applications/WebStorm.app/Contents/Resources/webstorm.icns");

        let base = icon_cache_key(app_path, icon_source, 100, 123_456);
        let changed_size = icon_cache_key(app_path, icon_source, 101, 123_456);
        let changed_time = icon_cache_key(app_path, icon_source, 100, 123_457);

        assert_ne!(base, changed_size);
        assert_ne!(base, changed_time);
    }
}
