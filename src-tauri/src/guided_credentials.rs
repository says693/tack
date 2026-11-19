#[cfg(windows)]
mod windows_vault {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    use crate::error::{AppError, AppResult};

    fn target(dir: &Path) -> Vec<u16> {
        let path = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        let namespace = crate::text::sha256_hex(&path.to_string_lossy().to_lowercase());
        std::ffi::OsStr::new(&format!("Fold/DeepSeek/{namespace}"))
            .encode_wide()
            .chain(Some(0))
            .collect()
    }

    pub fn read(dir: &Path) -> AppResult<Option<String>> {
        let target = target(dir);
        let mut ptr = null_mut();
        // The returned structure and blob share a Windows-owned allocation.
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                return Ok(None);
            }
            return Err(AppError::user(
                "key_vault",
                "无法读取 Windows 凭据管理器，请检查系统账户。",
            ));
        }
        if ptr.is_null() {
            return Ok(None);
        }
        let key = unsafe {
            let data = &*ptr;
            let result = if data.CredentialBlob.is_null() || data.CredentialBlobSize == 0 {
                None
            } else {
                let bytes = std::slice::from_raw_parts(
                    data.CredentialBlob,
                    data.CredentialBlobSize as usize,
                );
                std::str::from_utf8(bytes).ok().map(str::to_owned)
            };
            CredFree(ptr.cast());
            result
        };
        Ok(key)
    }

    pub fn write(dir: &Path, key: &str) -> AppResult<()> {
        let mut target = target(dir);
        let mut blob = key.as_bytes().to_vec();
        let record = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        if unsafe { CredWriteW(&record, 0) } == 0 {
            return Err(AppError::user(
                "key_vault",
                "未能保存到 Windows 凭据管理器。密钥未写入学习库。",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    #[test]
    fn test_key_isolated_and_persistent_in_windows_vault() {
        use windows_sys::Win32::Security::Credentials::CredDeleteW;
        let name = crate::db::new_id("test-key");
        let dir = std::env::temp_dir().join(name);
        let target = target(&dir);
        let dummy = "sk-test-fold-guided-never-valid";
        assert!(read(&dir).unwrap().is_none());
        let result = write(&dir, dummy).and_then(|_| read(&dir));
        unsafe {
            CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0);
        }
        assert_eq!(result.unwrap().as_deref(), Some(dummy));
        assert!(read(&dir).unwrap().is_none());
    }
}

#[cfg(windows)]
pub use windows_vault::{read, write};

#[cfg(not(windows))]
pub fn read(_: &std::path::Path) -> crate::error::AppResult<Option<String>> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn write(_: &std::path::Path, _: &str) -> crate::error::AppResult<()> {
    Err(crate::error::AppError::user(
        "key_vault",
        "暂时只支持在 Windows 上保存模型密钥。",
    ))
}
