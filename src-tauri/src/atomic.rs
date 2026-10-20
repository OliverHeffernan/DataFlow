//! Crash-safe file replacement shared by workbook saves and recovery checkpoints.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Normalises a save destination: it must be absolute and name a file, and the
/// `.dflo` extension is appended when absent.
pub fn normalize_destination(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("No save path was provided.".into());
    }
    let mut destination = PathBuf::from(path);
    if !destination.is_absolute() {
        return Err(format!("Save path must be absolute: {path}"));
    }
    if path.ends_with('/') || path.ends_with(std::path::MAIN_SEPARATOR) {
        return Err(format!("Save path must name a file: {path}"));
    }
    match destination.file_name() {
        Some(name) if name != "." && name != ".." => {}
        _ => return Err(format!("Save path must name a file: {path}")),
    }
    let has_extension = destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("dflo"));
    if !has_extension {
        let mut name = destination.into_os_string();
        name.push(".dflo");
        destination = PathBuf::from(name);
    }
    Ok(destination)
}

/// Atomically replaces `destination` with `bytes`.
pub fn write_atomic(destination: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_with(destination, |file| file.write_all(bytes))
}

/// Writes through a same-directory temporary file and renames it over the
/// destination. Failures before the rename leave the previous bytes intact.
/// A directory-sync failure reports failure even if replacement has occurred.
/// Symlinks and non-regular destinations are refused.
pub fn write_atomic_with(
    destination: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let existing = regular_destination(destination)?;
    let name = destination
        .file_name()
        .ok_or_else(|| invalid(format!("{} does not name a file", destination.display())))?;
    let parent = match destination.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };

    let (temp_path, mut file) = create_temp(parent, &name.to_string_lossy())?;
    let result = (|| {
        write(&mut file)?;
        if let Some(metadata) = &existing {
            preserve_metadata(&file, metadata)?;
        }
        file.sync_all()?;
        drop(file);
        // Re-check immediately before replacing in case the destination changed type.
        regular_destination(destination)?;
        fs::rename(&temp_path, destination)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    sync_directory(parent)
}

fn regular_destination(destination: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(invalid(format!(
            "Refusing to replace symbolic link {}",
            destination.display()
        ))),
        Ok(metadata) if !metadata.is_file() => Err(invalid(format!(
            "Refusing to replace {} because it is not a regular file",
            destination.display()
        ))),
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn create_temp(parent: &Path, name: &str) -> io::Result<(PathBuf, File)> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or_default();
    let mut attempts = 0;
    loop {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".{name}.{}.{nanos}.{counter}.tmp",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists && attempts < 64 => {
                attempts += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn preserve_metadata(file: &File, metadata: &fs::Metadata) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // Ownership is best effort: unprivileged users may only keep their own.
        let _ = std::os::unix::fs::fchown(file, Some(metadata.uid()), Some(metadata.gid()));
    }
    file.set_permissions(metadata.permissions())
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> io::Result<()> {
    File::open(directory)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> io::Result<()> {
    Ok(())
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A disposable directory removed on drop.
    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "dataflow-{label}-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn entries(directory: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn normalizes_destinations() {
        let base = std::env::temp_dir();
        let expect = |input: &Path, output: &Path| {
            assert_eq!(
                normalize_destination(input.to_str().unwrap()).unwrap(),
                output
            );
        };
        expect(&base.join("book"), &base.join("book.dflo"));
        expect(&base.join("book.dflo"), &base.join("book.dflo"));
        expect(&base.join("book.DFLO"), &base.join("book.DFLO"));
        expect(&base.join("book.json"), &base.join("book.json.dflo"));
        expect(&base.join("book.h"), &base.join("book.h.dflo"));
        assert!(normalize_destination("").is_err());
        assert!(normalize_destination("relative/book").is_err());
        let directory = format!("{}{}", base.display(), std::path::MAIN_SEPARATOR);
        assert!(normalize_destination(&directory).is_err());
        assert!(normalize_destination(base.join("..").to_str().unwrap()).is_err());
    }

    #[test]
    fn overwrites_atomically_and_preserves_permissions() {
        let directory = TempDir::new("atomic");
        let path = directory.0.join("book.dflo");
        write_atomic(&path, b"first").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        }
        write_atomic(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(entries(&directory.0), ["book.dflo"]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o640);
        }
    }

    #[test]
    fn failed_overwrite_preserves_original_bytes() {
        let directory = TempDir::new("atomic-fail");
        let path = directory.0.join("book.dflo");
        fs::write(&path, b"original bytes").unwrap();
        let error = write_atomic_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("disk full"))
        })
        .unwrap_err();
        assert_eq!(error.to_string(), "disk full");
        assert_eq!(fs::read(&path).unwrap(), b"original bytes");
        assert_eq!(entries(&directory.0), ["book.dflo"]);

        // A destination that cannot be replaced also leaves the original alone.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o555)).unwrap();
            let readonly = write_atomic(&path, b"new");
            fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o755)).unwrap();
            // Root may bypass directory permissions; only assert when refused.
            if readonly.is_err() {
                assert_eq!(fs::read(&path).unwrap(), b"original bytes");
                assert_eq!(entries(&directory.0), ["book.dflo"]);
            }
        }
    }

    #[test]
    fn refuses_nonregular_destinations() {
        let directory = TempDir::new("atomic-dir");
        let folder = directory.0.join("folder.dflo");
        fs::create_dir(&folder).unwrap();
        assert!(write_atomic(&folder, b"x").is_err());
        assert!(folder.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_destinations() {
        let directory = TempDir::new("atomic-link");
        let target = directory.0.join("target.dflo");
        let link = directory.0.join("link.dflo");
        fs::write(&target, b"target bytes").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(write_atomic(&link, b"replacement").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"target bytes");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(entries(&directory.0), ["link.dflo", "target.dflo"]);
    }
}
