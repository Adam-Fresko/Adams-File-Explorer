use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

const THUMBNAIL_CACHE_DIR: &str = "adams_file_explorer/image_thumbnails";
const THUMBNAIL_SIZE: u64 = 32;

const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "tif", "tiff", "bmp",
];

fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_IMAGE_EXTENSIONS
                .iter()
                .any(|supported| ext.eq_ignore_ascii_case(supported))
        })
        .unwrap_or(false)
}

fn modified_nanos(path: &Path) -> Option<i128> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    match modified.duration_since(UNIX_EPOCH) {
        Ok(duration) => Some(duration.as_nanos() as i128),
        Err(error) => Some(-(error.duration().as_nanos() as i128)),
    }
}

fn thumbnail_cache_key(
    image_path: &Path,
    image_size: u64,
    image_modified_nanos: i128,
    thumbnail_size: u64,
) -> String {
    let mut hasher = DefaultHasher::new();
    image_path.to_string_lossy().hash(&mut hasher);
    image_size.hash(&mut hasher);
    image_modified_nanos.hash(&mut hasher);
    thumbnail_size.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn cache_dir() -> Option<PathBuf> {
    Some(dirs::cache_dir()?.join(THUMBNAIL_CACHE_DIR))
}

fn ensure_cached_thumbnail(image_path: &Path) -> Option<PathBuf> {
    if !is_supported_image_path(image_path) {
        return None;
    }

    let metadata = fs::metadata(image_path).ok()?;
    if !metadata.is_file() {
        return None;
    }

    let image_modified_nanos = modified_nanos(image_path)?;
    let cache_key = thumbnail_cache_key(
        image_path,
        metadata.len(),
        image_modified_nanos,
        THUMBNAIL_SIZE,
    );
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
        .arg(THUMBNAIL_SIZE.to_string())
        .arg(image_path)
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

pub fn thumbnail_data_url(path: &str) -> Option<String> {
    let png_path = ensure_cached_thumbnail(Path::new(path))?;
    png_as_data_url(&png_path)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{is_supported_image_path, thumbnail_cache_key, thumbnail_data_url};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
        let unique_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "adams_file_explorer_image_thumbnails_{name}_{}_{}",
            std::process::id(),
            unique_id
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn supported_image_extensions_are_detected() {
        for extension in [
            "png", "JPG", "jpeg", "webp", "gif", "heic", "heif", "tif", "tiff", "bmp",
        ] {
            let path = format!("image.{extension}");
            assert!(is_supported_image_path(Path::new(&path)));
        }

        assert!(!is_supported_image_path(Path::new("vector.svg")));
        assert!(!is_supported_image_path(Path::new("notes.txt")));
    }

    #[test]
    fn cache_key_changes_when_file_fingerprint_changes() {
        let path = Path::new("/tmp/photo.png");
        let base = thumbnail_cache_key(path, 100, 123_456, 32);
        let changed_size = thumbnail_cache_key(path, 101, 123_456, 32);
        let changed_time = thumbnail_cache_key(path, 100, 123_457, 32);
        let changed_thumb_size = thumbnail_cache_key(path, 100, 123_456, 40);

        assert_ne!(base, changed_size);
        assert_ne!(base, changed_time);
        assert_ne!(base, changed_thumb_size);
    }

    #[test]
    fn missing_image_returns_none() {
        let path = format!(
            "/tmp/file-explorer-missing-image-{}.png",
            std::process::id()
        );
        assert!(thumbnail_data_url(&path).is_none());
    }

    #[test]
    fn broken_image_returns_none() {
        let base = temp_dir("broken");
        let path = base.join("broken.png");
        fs::write(&path, b"not an image").expect("write broken image");

        assert!(thumbnail_data_url(path.to_string_lossy().as_ref()).is_none());

        let _ = fs::remove_dir_all(base);
    }
}
