use crate::dto::DefaultFolderBrowserStatusDto;

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        env,
        path::{Path, PathBuf},
    };

    use core_foundation::{
        array::{CFArray, CFArrayRef},
        base::{Boolean, TCFType},
        string::{CFString, CFStringRef},
        url::{CFURLRef, CFURL},
    };

    use super::DefaultFolderBrowserStatusDto;

    const FOLDER_UTI: &str = "public.folder";
    const DIRECTORY_UTI: &str = "public.directory";
    const FINDER_BUNDLE_ID: &str = "com.apple.finder";
    const INSTALL_MESSAGE: &str = "Build and install the app first, then run it from Applications.";
    const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
        ) -> CFStringRef;
        fn LSCopyAllRoleHandlersForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
        ) -> CFArrayRef;
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
            in_handler_bundle_id: CFStringRef,
        ) -> i32;
        fn LSRegisterURL(in_url: CFURLRef, in_update: Boolean) -> i32;
    }

    pub fn status(app_identifier: &str) -> DefaultFolderBrowserStatusDto {
        let folder_handler = copy_default_handler(FOLDER_UTI);
        let directory_handler = copy_default_handler(DIRECTORY_UTI);
        let is_default = handler_matches(&folder_handler, app_identifier)
            && handler_matches(&directory_handler, app_identifier);
        let can_set = installed_current_app_bundle().is_some();
        let message = if can_set || is_default {
            None
        } else {
            Some(INSTALL_MESSAGE.to_string())
        };

        DefaultFolderBrowserStatusDto {
            is_default,
            folder_handler,
            directory_handler,
            can_set,
            message,
        }
    }

    pub fn set_default(app_identifier: &str) -> Result<DefaultFolderBrowserStatusDto, String> {
        register_current_app(app_identifier)?;
        set_handler(FOLDER_UTI, app_identifier)?;
        set_handler(DIRECTORY_UTI, app_identifier)?;
        Ok(status(app_identifier))
    }

    pub fn reset_default(app_identifier: &str) -> Result<DefaultFolderBrowserStatusDto, String> {
        set_handler(FOLDER_UTI, FINDER_BUNDLE_ID)?;
        set_handler(DIRECTORY_UTI, FINDER_BUNDLE_ID)?;
        Ok(status(app_identifier))
    }

    fn copy_default_handler(content_type: &str) -> Option<String> {
        let content_type = CFString::new(content_type);
        let handler = unsafe {
            LSCopyDefaultRoleHandlerForContentType(
                content_type.as_concrete_TypeRef(),
                K_LS_ROLES_ALL,
            )
        };

        if handler.is_null() {
            return None;
        }

        Some(unsafe { CFString::wrap_under_create_rule(handler) }.to_string())
    }

    fn copy_all_handlers(content_type: &str) -> Vec<String> {
        let content_type = CFString::new(content_type);
        let handlers = unsafe {
            LSCopyAllRoleHandlersForContentType(content_type.as_concrete_TypeRef(), K_LS_ROLES_ALL)
        };

        if handlers.is_null() {
            return Vec::new();
        }

        let handlers: CFArray<CFString> = unsafe { CFArray::wrap_under_create_rule(handlers) };
        handlers.iter().map(|handler| handler.to_string()).collect()
    }

    fn register_current_app(app_identifier: &str) -> Result<(), String> {
        let app_bundle =
            installed_current_app_bundle().ok_or_else(|| INSTALL_MESSAGE.to_string())?;
        let app_url = CFURL::from_path(&app_bundle, true)
            .ok_or_else(|| "Could not read the installed app path.".to_string())?;
        let status = unsafe { LSRegisterURL(app_url.as_concrete_TypeRef(), true as Boolean) };

        if status != 0 {
            return Err(format!(
                "macOS could not register this app as a folder browser. Status {status}."
            ));
        }

        let folder_handlers = copy_all_handlers(FOLDER_UTI);
        let directory_handlers = copy_all_handlers(DIRECTORY_UTI);
        if folder_handlers
            .iter()
            .any(|handler| handler == app_identifier)
            && directory_handlers
                .iter()
                .any(|handler| handler == app_identifier)
        {
            return Ok(());
        }

        Err(
            "macOS did not list this app as a folder browser. Build and install the app first."
                .to_string(),
        )
    }

    fn set_handler(content_type: &str, bundle_identifier: &str) -> Result<(), String> {
        let content_type = CFString::new(content_type);
        let bundle_identifier = CFString::new(bundle_identifier);
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                content_type.as_concrete_TypeRef(),
                K_LS_ROLES_ALL,
                bundle_identifier.as_concrete_TypeRef(),
            )
        };

        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "macOS could not update the folder browser setting. Status {status}."
            ))
        }
    }

    fn installed_current_app_bundle() -> Option<PathBuf> {
        let app_bundle = current_app_bundle()?;
        if is_installed_app_bundle(&app_bundle) {
            Some(app_bundle)
        } else {
            None
        }
    }

    fn current_app_bundle() -> Option<PathBuf> {
        env::current_exe().ok()?.ancestors().find_map(|path| {
            path.extension()
                .filter(|extension| extension.to_string_lossy().eq_ignore_ascii_case("app"))
                .map(|_| path.to_path_buf())
        })
    }

    fn is_installed_app_bundle(path: &Path) -> bool {
        let is_app = path
            .extension()
            .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("app"));
        let has_info_plist = path.join("Contents/Info.plist").is_file();
        let is_in_applications = path.starts_with("/Applications")
            || dirs::home_dir()
                .map(|home| path.starts_with(home.join("Applications")))
                .unwrap_or(false);

        is_app && has_info_plist && is_in_applications
    }

    fn handler_matches(handler: &Option<String>, app_identifier: &str) -> bool {
        handler.as_deref() == Some(app_identifier)
    }

    #[cfg(test)]
    mod tests {
        use std::path::Path;

        use super::{handler_matches, is_installed_app_bundle};

        #[test]
        fn handler_matches_only_matching_bundle_id() {
            assert!(handler_matches(
                &Some("com.adamfresko.fileexplorer".to_string()),
                "com.adamfresko.fileexplorer"
            ));
            assert!(!handler_matches(
                &Some("com.apple.finder".to_string()),
                "com.adamfresko.fileexplorer"
            ));
            assert!(!handler_matches(&None, "com.adamfresko.fileexplorer"));
        }

        #[test]
        fn installed_bundle_requires_app_extension() {
            assert!(!is_installed_app_bundle(Path::new(
                "/Applications/File Explorer"
            )));
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::DefaultFolderBrowserStatusDto;

    pub fn status(_app_identifier: &str) -> DefaultFolderBrowserStatusDto {
        DefaultFolderBrowserStatusDto {
            is_default: false,
            folder_handler: None,
            directory_handler: None,
            can_set: false,
            message: Some("Default folder browser setting is only available on macOS.".to_string()),
        }
    }

    pub fn set_default(_app_identifier: &str) -> Result<DefaultFolderBrowserStatusDto, String> {
        Err("Default folder browser setting is only available on macOS.".to_string())
    }

    pub fn reset_default(_app_identifier: &str) -> Result<DefaultFolderBrowserStatusDto, String> {
        Err("Default folder browser setting is only available on macOS.".to_string())
    }
}

pub fn status(app_identifier: &str) -> DefaultFolderBrowserStatusDto {
    platform::status(app_identifier)
}

pub fn set_default(app_identifier: &str) -> Result<DefaultFolderBrowserStatusDto, String> {
    platform::set_default(app_identifier)
}

pub fn reset_default(app_identifier: &str) -> Result<DefaultFolderBrowserStatusDto, String> {
    platform::reset_default(app_identifier)
}
