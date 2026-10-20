//! Crash-recovery checkpoints stored under `app_local_data_dir()/recovery`.
//!
//! Each record id owns these files in the recovery directory:
//! - `<id>.a.json` / `<id>.b.json`: the two most recent checkpoints. A write
//!   always replaces the older (or unreadable) slot, so the newest valid
//!   checkpoint is never overwritten in place.
//! - `<id>.lock`: held with `File::try_lock` by the live session that owns the
//!   record, isolating concurrently running DataFlow processes.
//! - `<id>.resolved`: a tombstone written before cleanup; later writes fail.

use crate::atomic::{sync_directory, write_atomic};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

const SLOTS: [&str; 2] = ["a", "b"];

#[derive(Clone)]
pub struct RecoveryStore {
    root: Result<PathBuf, String>,
    held: Arc<Mutex<HashMap<String, File>>>,
}

#[derive(Debug, serde::Serialize)]
pub struct RecoveryEntry {
    pub id: String,
    /// Valid checkpoints, newest first (at most two).
    pub generations: Vec<Value>,
    /// True when another live DataFlow process holds this record.
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct Checkpoint {
    revision: u64,
    updated_at: f64,
    record: Value,
}

impl Checkpoint {
    fn newer_than(&self, other: &Checkpoint) -> bool {
        (self.revision, self.updated_at) > (other.revision, other.updated_at)
    }
}

enum Slot {
    Missing,
    Valid(Checkpoint),
    Corrupt(String),
}

impl RecoveryStore {
    pub fn new(root: Result<PathBuf, String>) -> Self {
        Self {
            root,
            held: Arc::default(),
        }
    }

    fn held(&self) -> MutexGuard<'_, HashMap<String, File>> {
        self.held
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn root(&self) -> Result<&Path, String> {
        let root = self
            .root
            .as_deref()
            .map_err(|error| format!("Recovery storage is unavailable: {error}"))?;
        let missing: Vec<_> = root.ancestors().take_while(|path| !path.exists()).collect();
        fs::create_dir_all(root)
            .map_err(|error| format!("Could not create {}: {error}", root.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("Could not protect {}: {error}", root.display()))?;
        }
        // A durable first checkpoint also needs its newly created parent
        // directories to survive; syncing only the record's directory is not enough.
        for directory in missing.into_iter().rev() {
            if let Some(parent) = directory.parent() {
                sync_directory(parent)
                    .map_err(|error| format!("Could not sync {}: {error}", parent.display()))?;
            }
        }
        Ok(root)
    }

    /// Validates and persists a checkpoint, taking this session's lock on the id.
    pub fn write(&self, record: Value) -> Result<(), String> {
        let checkpoint = validate(&record, None)?;
        let id = record_id(&record)?.to_owned();
        let root = self.root()?;
        let mut held = self.held();
        acquire(&mut held, root, &id)?;
        if tombstone(root, &id).exists() {
            held.remove(&id);
            return Err(format!(
                "Recovery record {id} was already resolved; refusing a late checkpoint."
            ));
        }

        let slots = SLOTS.map(|slot| read_slot(&slot_path(root, &id, slot), &id));
        let newest = match (&slots[0], &slots[1]) {
            (Slot::Valid(a), Slot::Valid(b)) => Some(if b.newer_than(a) { b } else { a }),
            (Slot::Valid(a), _) => Some(a),
            (_, Slot::Valid(b)) => Some(b),
            _ => None,
        };
        if let Some(newest) = newest {
            if checkpoint.revision <= newest.revision {
                return Err(format!(
                    "Stale recovery checkpoint for {id}: revision {} is not newer than stored revision {}.",
                    checkpoint.revision, newest.revision
                ));
            }
        }
        // Replace the slot that is not the newest valid checkpoint.
        let target = match (&slots[0], &slots[1]) {
            (Slot::Valid(a), Slot::Valid(b)) => usize::from(!b.newer_than(a)),
            (Slot::Valid(_), _) => 1,
            (_, Slot::Valid(_)) => 0,
            // Prefer filling a missing slot so a corrupt one stays inspectable.
            (Slot::Corrupt(_), Slot::Missing) => 1,
            _ => 0,
        };
        let bytes = serde_json::to_vec(&record).map_err(|error| error.to_string())?;
        let path = slot_path(root, &id, SLOTS[target]);
        write_atomic(&path, &bytes)
            .map_err(|error| format!("Could not write recovery checkpoint {id}: {error}"))
    }

    /// Lists unresolved records with up to two valid generations each.
    pub fn list(&self) -> Result<Vec<RecoveryEntry>, String> {
        let root = self.root()?;
        let held = self.held();
        let mut ids: Vec<String> = Vec::new();
        for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let id = SLOTS.iter().find_map(|slot| {
                name.strip_suffix(&format!(".{slot}.json"))
                    .filter(|id| valid_id(id).is_ok())
            });
            if let Some(id) = id {
                if !ids.iter().any(|known| known == id) {
                    ids.push(id.to_owned());
                }
            }
        }

        let mut entries = Vec::new();
        for id in ids {
            if tombstone(root, &id).exists() {
                continue;
            }
            let mut generations = Vec::new();
            let mut errors = Vec::new();
            for slot in SLOTS {
                match read_slot(&slot_path(root, &id, slot), &id) {
                    Slot::Valid(checkpoint) => generations.push(checkpoint),
                    Slot::Corrupt(error) => errors.push(format!("checkpoint {slot}: {error}")),
                    Slot::Missing => {}
                }
            }
            generations.sort_by(|a, b| {
                (b.revision, b.updated_at)
                    .partial_cmp(&(a.revision, a.updated_at))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let active = !held.contains_key(&id) && held_elsewhere(root, &id);
            entries.push(RecoveryEntry {
                id,
                generations: generations.into_iter().map(|g| g.record).collect(),
                active,
                error: (!errors.is_empty()).then(|| errors.join("; ")),
            });
        }
        entries.sort_by(|a, b| {
            let time = |entry: &RecoveryEntry| {
                entry
                    .generations
                    .first()
                    .and_then(|record| record["updatedAt"].as_f64())
                    .unwrap_or(0.0)
            };
            time(b)
                .partial_cmp(&time(a))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(entries)
    }

    /// Persists a tombstone, then removes the checkpoints. Refuses records held
    /// by another live session; this session's own records may be resolved.
    pub fn resolve(&self, id: &str) -> Result<(), String> {
        valid_id(id)?;
        let root = self.root()?;
        let mut held = self.held();
        acquire(&mut held, root, id)?;
        let marker = tombstone(root, id);
        if !marker.exists() {
            let resolved_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default();
            let body = serde_json::json!({ "id": id, "resolvedAt": resolved_at as u64 });
            write_atomic(&marker, body.to_string().as_bytes()).map_err(|error| {
                format!("Could not mark recovery record {id} as resolved: {error}")
            })?;
        }
        let mut failures = Vec::new();
        for slot in SLOTS {
            if let Err(error) = remove_if_present(&slot_path(root, id, slot)) {
                failures.push(format!("checkpoint {slot}: {error}"));
            }
        }
        held.remove(id);
        let _ = remove_if_present(&lock_path(root, id));
        if failures.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Recovery record {id} was resolved but cleanup failed: {}",
                failures.join("; ")
            ))
        }
    }

    /// Drops this session's lock on an id without touching its checkpoints.
    pub fn release(&self, id: &str) -> Result<(), String> {
        valid_id(id)?;
        self.held().remove(id);
        Ok(())
    }
}

fn acquire(held: &mut HashMap<String, File>, root: &Path, id: &str) -> Result<(), String> {
    if held.contains_key(id) {
        return Ok(());
    }
    let file = open_lock(root, id)?;
    match file.try_lock() {
        Ok(()) => {
            held.insert(id.to_owned(), file);
            Ok(())
        }
        Err(TryLockError::WouldBlock) => Err(format!(
            "Recovery record {id} is in use by another open DataFlow window."
        )),
        Err(TryLockError::Error(error)) => {
            Err(format!("Could not lock recovery record {id}: {error}"))
        }
    }
}

fn held_elsewhere(root: &Path, id: &str) -> bool {
    match fs::symlink_metadata(lock_path(root, id)) {
        Ok(metadata) if metadata.is_file() => {}
        _ => return false,
    }
    match open_lock(root, id).map(|file| file.try_lock()) {
        Ok(Ok(())) => false,
        Ok(Err(TryLockError::WouldBlock)) => true,
        _ => false,
    }
}

fn open_lock(root: &Path, id: &str) -> Result<File, String> {
    let path = lock_path(root, id);
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() {
            return Err(format!("Refusing non-regular lock file {}", path.display()));
        }
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))
}

fn read_slot(path: &Path, id: &str) -> Slot {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Slot::Missing,
        Err(error) => return Slot::Corrupt(error.to_string()),
        Ok(metadata) if !metadata.is_file() => {
            return Slot::Corrupt("not a regular file".into());
        }
        Ok(_) => {}
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Slot::Missing,
        Err(error) => return Slot::Corrupt(error.to_string()),
    };
    let record: Value = match serde_json::from_slice(&bytes) {
        Ok(record) => record,
        Err(error) => return Slot::Corrupt(format!("invalid JSON ({error})")),
    };
    match validate(&record, Some(id)) {
        Ok(checkpoint) => Slot::Valid(checkpoint),
        Err(error) => Slot::Corrupt(error),
    }
}

fn record_id(record: &Value) -> Result<&str, String> {
    record["id"]
        .as_str()
        .ok_or_else(|| "Recovery record id must be a string.".to_owned())
}

fn validate(record: &Value, expected_id: Option<&str>) -> Result<Checkpoint, String> {
    let object = record
        .as_object()
        .ok_or("Recovery record must be a JSON object.")?;
    if object.get("snapshotVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Recovery record snapshotVersion must be 1.".into());
    }
    let id = record_id(record)?;
    valid_id(id)?;
    if expected_id.is_some_and(|expected| expected != id) {
        return Err(format!("Recovery record id {id} does not match its file."));
    }
    let revision = object
        .get("revision")
        .and_then(Value::as_u64)
        .filter(|revision| (1..=9_007_199_254_740_991).contains(revision))
        .ok_or("Recovery record revision must be a positive safe integer.")?;
    let updated_at = object
        .get("updatedAt")
        .and_then(Value::as_f64)
        .filter(|time| time.is_finite() && *time >= 0.0)
        .ok_or("Recovery record updatedAt must be a timestamp in milliseconds.")?;
    if !matches!(
        object.get("sourcePath"),
        Some(Value::Null | Value::String(_))
    ) {
        return Err("Recovery record sourcePath must be a string or null.".into());
    }
    if !matches!(object.get("name"), Some(Value::String(_))) {
        return Err("Recovery record name must be a string.".into());
    }
    if !matches!(object.get("workbook"), Some(Value::Object(_))) {
        return Err("Recovery record workbook must be an object.".into());
    }
    Ok(Checkpoint {
        revision,
        updated_at,
        record: record.clone(),
    })
}

/// Ids are UUID-safe: 1–64 ASCII letters, digits, or hyphens. This rules out
/// separators, dots, and therefore any path traversal.
pub fn valid_id(id: &str) -> Result<(), String> {
    let ok = (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid recovery record id: {id:?}"))
    }
}

fn slot_path(root: &Path, id: &str, slot: &str) -> PathBuf {
    root.join(format!("{id}.{slot}.json"))
}

fn lock_path(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{id}.lock"))
}

fn tombstone(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{id}.resolved"))
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomic::tests::TempDir;
    use serde_json::json;

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

    fn store(directory: &TempDir) -> RecoveryStore {
        RecoveryStore::new(Ok(directory.0.join("recovery")))
    }

    fn record(id: &str, revision: u64) -> Value {
        json!({
            "snapshotVersion": 1,
            "id": id,
            "revision": revision,
            "updatedAt": 1_700_000_000_000_u64 + revision,
            "sourcePath": null,
            "name": "Book",
            "workbook": { "sheets": [revision] },
        })
    }

    fn revisions(entry: &RecoveryEntry) -> Vec<u64> {
        entry
            .generations
            .iter()
            .map(|record| record["revision"].as_u64().unwrap())
            .collect()
    }

    #[test]
    fn keeps_two_generations_newest_first() {
        let directory = TempDir::new("recovery-generations");
        let store = store(&directory);
        for revision in 1..=4 {
            store.write(record(ID, revision)).unwrap();
        }
        let entries = store.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, ID);
        assert_eq!(revisions(&entries[0]), [4, 3]);
        assert!(!entries[0].active);
        assert!(entries[0].error.is_none());
        assert!(store.write(record(ID, 2)).is_err(), "stale revision");
        assert!(store.write(record(ID, 4)).is_err(), "equal revision");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let root = directory.0.join("recovery");
            assert_eq!(
                fs::metadata(&root).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(slot_path(&root, ID, "a"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn corrupt_latest_falls_back_to_previous_without_deleting() {
        let directory = TempDir::new("recovery-corrupt");
        let store = store(&directory);
        store.write(record(ID, 1)).unwrap();
        store.write(record(ID, 2)).unwrap();
        let root = directory.0.join("recovery");
        let latest = SLOTS
            .iter()
            .map(|slot| slot_path(&root, ID, slot))
            .find(|path| fs::read_to_string(path).unwrap().contains("\"revision\":2"))
            .unwrap();
        fs::write(&latest, b"{\"snapshotVersion\":1,").unwrap();

        let entries = store.list().unwrap();
        assert_eq!(revisions(&entries[0]), [1]);
        assert!(entries[0]
            .error
            .as_deref()
            .unwrap()
            .contains("invalid JSON"));
        assert_eq!(fs::read(&latest).unwrap(), b"{\"snapshotVersion\":1,");

        // The next write replaces the corrupt slot and keeps the valid one.
        store.write(record(ID, 3)).unwrap();
        let entries = store.list().unwrap();
        assert_eq!(revisions(&entries[0]), [3, 1]);
        assert!(entries[0].error.is_none());
    }

    #[test]
    fn rejects_invalid_records_and_traversal_ids() {
        let directory = TempDir::new("recovery-invalid");
        let store = store(&directory);
        for id in [
            "",
            "../escape",
            "a/b",
            "a\\b",
            "..",
            "id.json",
            &"a".repeat(65),
        ] {
            assert!(store.write(record(id, 1)).is_err(), "{id:?}");
            assert!(store.resolve(id).is_err(), "{id:?}");
            assert!(store.release(id).is_err(), "{id:?}");
        }
        let mut wrong = record(ID, 1);
        wrong["snapshotVersion"] = json!(2);
        assert!(store.write(wrong).is_err());
        let mut wrong = record(ID, 1);
        wrong["workbook"] = json!([]);
        assert!(store.write(wrong).is_err());
        let mut wrong = record(ID, 1);
        wrong["revision"] = json!(1.5);
        assert!(store.write(wrong).is_err());
        assert!(store.write(record(ID, 0)).is_err());
        assert!(store.write(record(ID, 9_007_199_254_740_992)).is_err());
        assert!(!directory.0.join("escape.a.json").exists());
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn tombstone_rejects_late_writes() {
        let directory = TempDir::new("recovery-tombstone");
        let store = store(&directory);
        store.write(record(ID, 1)).unwrap();
        store.resolve(ID).unwrap();
        let root = directory.0.join("recovery");
        assert!(tombstone(&root, ID).exists());
        assert!(!slot_path(&root, ID, "a").exists());
        assert!(store.list().unwrap().is_empty());
        assert!(store.write(record(ID, 2)).is_err());
        // A fresh session (new store instance) also rejects the late write.
        assert!(super::RecoveryStore::new(Ok(root.clone()))
            .write(record(ID, 3))
            .is_err());
        assert!(!slot_path(&root, ID, "a").exists());
        assert!(!slot_path(&root, ID, "b").exists());
        // Resolving again is harmless.
        store.resolve(ID).unwrap();
    }

    #[test]
    fn locks_isolate_separate_store_instances() {
        let directory = TempDir::new("recovery-locks");
        let first = store(&directory);
        let second = store(&directory);
        first.write(record(ID, 1)).unwrap();

        // The other session sees the record as active and may not touch it.
        let listed = second.list().unwrap();
        assert!(listed[0].active);
        assert!(second.write(record(ID, 2)).is_err());
        assert!(second.resolve(ID).is_err());
        assert_eq!(revisions(&second.list().unwrap()[0]), [1]);

        // The owner does not see its own record as active.
        assert!(!first.list().unwrap()[0].active);

        // Releasing keeps the checkpoint but frees it for another session.
        first.release(ID).unwrap();
        let listed = second.list().unwrap();
        assert!(!listed[0].active);
        assert_eq!(revisions(&listed[0]), [1]);
        second.write(record(ID, 2)).unwrap();
        assert!(first.list().unwrap()[0].active);
        assert!(first.resolve(ID).is_err());

        // Owners may resolve their own records.
        second.resolve(ID).unwrap();
        assert!(first.list().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_checkpoints() {
        let directory = TempDir::new("recovery-symlink");
        let store = store(&directory);
        let root = directory.0.join("recovery");
        fs::create_dir_all(&root).unwrap();
        let outside = directory.0.join("outside.json");
        fs::write(&outside, b"outside").unwrap();
        std::os::unix::fs::symlink(&outside, slot_path(&root, ID, "a")).unwrap();
        std::os::unix::fs::symlink(&outside, slot_path(&root, ID, "b")).unwrap();
        assert!(store.write(record(ID, 1)).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
        let entries = store.list().unwrap();
        assert!(entries[0].generations.is_empty());
        assert!(entries[0].error.is_some());
    }
}
