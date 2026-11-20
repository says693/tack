use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::db;
use crate::error::{AppError, AppResult};

const VAULT_FILE: &str = ".fold-vault";

fn vault_path(dir: &Path) -> PathBuf {
    dir.join(VAULT_FILE)
}

fn vault_mask(dir: &Path) -> [u8; 32] {
    let path = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(b"fold-vault-v1:");
    hasher.update(path.to_string_lossy().to_lowercase().as_bytes());
    hasher.finalize().into()
}

fn xor_mask(bytes: &[u8], mask: &[u8; 32]) -> Vec<u8> {
    bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ mask[i % mask.len()])
        .collect()
}

fn read_fallback(dir: &Path) -> AppResult<Option<String>> {
    let path = vault_path(dir);
    let raw = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(AppError::Io(err)),
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let Ok(cipher) = hex::decode(trimmed) else {
        return Ok(None);
    };
    let plain = xor_mask(&cipher, &vault_mask(dir));
    let Ok(key) = String::from_utf8(plain) else {
        return Ok(None);
    };
    let key = key.trim().to_string();
    if key.is_empty() {
        Ok(None)
    } else {
        Ok(Some(key))
    }
}

fn write_fallback(dir: &Path, key: &str) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    let cipher = xor_mask(key.as_bytes(), &vault_mask(dir));
    std::fs::write(vault_path(dir), hex::encode(cipher))?;
    Ok(())
}

fn clear_fallback(dir: &Path) -> AppResult<()> {
    match std::fs::remove_file(vault_path(dir)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::Io(err)),
    }
}

#[cfg(windows)]
mod windows_vault {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    use super::{clear_fallback, read_fallback, write_fallback};
    use crate::error::AppResult;

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
            let _ = error.raw_os_error() == Some(ERROR_NOT_FOUND as i32);
            return read_fallback(dir);
        }
        if ptr.is_null() {
            return read_fallback(dir);
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
                std::str::from_utf8(bytes)
                    .ok()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
            };
            CredFree(ptr.cast());
            result
        };
        if key.is_some() {
            Ok(key)
        } else {
            read_fallback(dir)
        }
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
            return write_fallback(dir, key);
        }
        let _ = clear_fallback(dir);
        Ok(())
    }

    pub fn clear(dir: &Path) -> AppResult<()> {
        let target = target(dir);
        unsafe {
            CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0);
        }
        clear_fallback(dir)
    }

    #[cfg(test)]
    #[test]
    fn test_key_isolated_and_persistent_in_windows_vault() {
        let name = crate::db::new_id("test-key");
        let dir = std::env::temp_dir().join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let dummy = "sk-test-fold-guided-never-valid";
        assert!(read(&dir).unwrap().is_none());
        let result = write(&dir, dummy).and_then(|_| read(&dir));
        clear(&dir).unwrap();
        let after_clear = read(&dir).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(result.unwrap().as_deref(), Some(dummy));
        assert!(after_clear.is_none());
    }
}

#[cfg(windows)]
pub use windows_vault::{clear, read, write};

#[cfg(not(windows))]
pub fn read(dir: &Path) -> AppResult<Option<String>> {
    read_fallback(dir)
}

#[cfg(not(windows))]
pub fn write(dir: &Path, key: &str) -> AppResult<()> {
    write_fallback(dir, key)
}

#[cfg(not(windows))]
pub fn clear(dir: &Path) -> AppResult<()> {
    clear_fallback(dir)
}

/// Reads the API key across the unified credential vault and legacy SQLite
/// `settings['model.api_key']`. If a legacy plaintext key exists in SQLite and
/// `data_dir` is provided, it is transparently migrated into the credential
/// vault and cleared from SQLite.
pub fn load_unified_key(conn: &rusqlite::Connection, data_dir: Option<&Path>) -> Option<String> {
    if let Some(legacy) = db::get_setting(conn, "model.api_key")
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
    {
        if let Some(dir) = data_dir {
            if write(dir, &legacy).is_ok() {
                let _ = db::set_setting(conn, "model.api_key", "");
            }
        }
        return Some(legacy);
    }
    data_dir.and_then(|dir| read(dir).ok().flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_vault_obfuscates_and_clears_key() {
        let dir = std::env::temp_dir().join(db::new_id("test-fallback"));
        std::fs::create_dir_all(&dir).unwrap();
        let secret = "sk-fallback-unit-test-1234";
        write_fallback(&dir, secret).unwrap();
        let raw = std::fs::read_to_string(vault_path(&dir)).unwrap();
        assert!(!raw.contains(secret));
        assert_eq!(read_fallback(&dir).unwrap().as_deref(), Some(secret));
        clear_fallback(&dir).unwrap();
        assert!(read_fallback(&dir).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unified_key_migrates_legacy_sqlite_setting_to_vault() {
        let conn = db::test_conn();
        let dir = std::env::temp_dir().join(db::new_id("test-migrate"));
        std::fs::create_dir_all(&dir).unwrap();
        db::set_setting(&conn, "model.api_key", "sk-legacy-plaintext").unwrap();

        let loaded = load_unified_key(&conn, Some(&dir));
        assert_eq!(loaded.as_deref(), Some("sk-legacy-plaintext"));
        assert_eq!(db::get_setting(&conn, "model.api_key").as_deref(), Some(""));
        assert_eq!(read(&dir).unwrap().as_deref(), Some("sk-legacy-plaintext"));

        clear(&dir).unwrap();
        assert!(load_unified_key(&conn, Some(&dir)).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
