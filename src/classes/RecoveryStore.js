// Crash-recovery snapshot storage.
//
// This module only stores recovery snapshots. It never downloads files, never
// writes to the user's original workbook file and never falls back to
// localStorage. All storage failures (including quota errors) propagate.
//
// Store interface (both implementations):
//   write(record)  -> Promise<void>   store a new newest generation for record.id
//   list()         -> Promise<Array<{ id, generations: [newest, previous?], active, error?, ownershipUnknown? }>>
//   resolve(id)    -> Promise<void>   tombstone id; all later writes to id fail
//   release(id)    -> Promise<void>   give up ownership of id without deleting it
//   close()        -> Promise<void>   release every id owned by this store
//
// Record shape:
//   { snapshotVersion: 1, id, revision, updatedAt, sourcePath: null | string, name: string, workbook: object }
//
// Browser (IndexedDB) ownership semantics:
// - With Web Locks (navigator.locks): write() acquires an exclusive lock named
//   "dataflow-recovery:<id>" and holds it until release()/close() or until the
//   page dies. Writes to an id locked by another live owner fail with LOCKED.
//   list() marks ids locked by other owners as active; ids owned by this store
//   are reported active=false (the manager filters its own current id).
//   resolve() of an id held by another live owner fails with LOCKED.
// - Without Web Locks ownership cannot be determined. Writes still work (ids
//   must be unique, see createRecoveryId()) and resolve() of ids written by
//   this store is allowed. Every other entry is listed as active with
//   ownershipUnknown=true, and resolve() of it fails with OWNER_UNKNOWN, so a
//   potentially live window's work is never deleted. Such entries can still be
//   restored as a copy by the manager; they just cannot be discarded.

import { invoke, isTauri } from "@tauri-apps/api/core";

export const RECOVERY_DB_NAME = "dataflow-recovery";
export const RECOVERY_SCHEMA_VERSION = 1;
export const RECOVERY_SNAPSHOT_VERSION = 1;
const ENTRY_STORE = "entries";
const LOCK_PREFIX = "dataflow-recovery:";
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export class RecoveryError extends Error {
	constructor(code, message, options) {
		super(message, options);
		this.name = "RecoveryError";
		this.code = code;
	}
}

export function isValidRecoveryId(id) {
	return typeof id === "string" && ID_PATTERN.test(id);
}

export function assertValidRecoveryId(id) {
	if (!isValidRecoveryId(id)) {
		throw new RecoveryError("INVALID_ID", "Recovery id must be 1-64 letters, digits or hyphens");
	}
	return id;
}

// Unique id suitable for a new recovery record.
export function createRecoveryId() {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
	if (cryptoApi?.getRandomValues) {
		const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
		return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	}
	throw new RecoveryError("UNAVAILABLE", "Secure random ids are unavailable");
}

function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// Returns null when valid, otherwise a description of the first problem.
export function recoveryRecordProblem(record) {
	if (!isPlainObject(record)) return "record must be an object";
	if (record.snapshotVersion !== RECOVERY_SNAPSHOT_VERSION) return `snapshotVersion must be ${RECOVERY_SNAPSHOT_VERSION}`;
	if (!isValidRecoveryId(record.id)) return "id is invalid";
	if (!Number.isSafeInteger(record.revision) || record.revision < 1) return "revision must be a positive safe integer";
	if (typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt) || record.updatedAt < 0) return "updatedAt must be a timestamp in milliseconds";
	if (record.sourcePath !== null && typeof record.sourcePath !== "string") return "sourcePath must be null or a string";
	if (typeof record.name !== "string") return "name must be a string";
	if (!isPlainObject(record.workbook)) return "workbook must be an object";
	return null;
}

export function assertValidRecoveryRecord(record) {
	const problem = recoveryRecordProblem(record);
	if (problem) throw new RecoveryError("INVALID_RECORD", `Invalid recovery record: ${problem}`);
	return record;
}

function updatedAtTime(record) {
	const value = record?.updatedAt;
	if (typeof value === "number") return value;
	const parsed = typeof value === "string" ? Date.parse(value) : NaN;
	return Number.isNaN(parsed) ? 0 : parsed;
}

function closedError() {
	return new RecoveryError("CLOSED", "Recovery store is closed");
}

export function createRecoveryStore() {
	return isTauri() ? createNativeRecoveryStore() : createIndexedDbRecoveryStore();
}

// Native store: the Rust side owns persistence and locking.
export function createNativeRecoveryStore(invokeFn = invoke) {
	const owned = new Set();
	let closed = false;
	const ensureOpen = () => {
		if (closed) throw closedError();
	};
	return {
		async write(record) {
			ensureOpen();
			assertValidRecoveryRecord(record);
			await invokeFn("recovery_write", { record });
			owned.add(record.id);
		},
		async list() {
			ensureOpen();
			const entries = await invokeFn("recovery_list");
			if (!Array.isArray(entries)) throw new RecoveryError("INVALID_RESPONSE", "recovery_list returned a non-array");
			return entries;
		},
		async resolve(id) {
			ensureOpen();
			assertValidRecoveryId(id);
			await invokeFn("recovery_resolve", { id });
			owned.delete(id);
		},
		async release(id) {
			ensureOpen();
			assertValidRecoveryId(id);
			await invokeFn("recovery_release", { id });
			owned.delete(id);
		},
		async close() {
			if (closed) return;
			closed = true;
			const ids = [...owned];
			owned.clear();
			const results = await Promise.allSettled(ids.map((id) => invokeFn("recovery_release", { id })));
			const failure = results.find((result) => result.status === "rejected");
			if (failure) throw failure.reason;
		},
	};
}

function requestToPromise(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

// Resolves once the transaction has committed; rejects with abortReason() or the
// transaction error if it errors or aborts.
function transactionDone(tx, abortReason) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		const fail = () => reject(abortReason() || tx.error || new RecoveryError("TRANSACTION_ABORTED", "Recovery transaction aborted"));
		// Request errors are not prevented, so the transaction aborts and nothing commits.
		tx.onerror = fail;
		tx.onabort = fail;
	});
}

function readwriteTransaction(db) {
	try {
		return db.transaction(ENTRY_STORE, "readwrite", { durability: "strict" });
	} catch (error) {
		// Older engines may reject the options dictionary; nothing has happened yet.
		if (error?.name !== "TypeError") throw error;
		return db.transaction(ENTRY_STORE, "readwrite");
	}
}

// Browser store backed by IndexedDB, with Web Locks for live ownership.
export function createIndexedDbRecoveryStore({
	indexedDB: idb = globalThis.indexedDB,
	locks = globalThis.navigator?.locks,
} = {}) {
	const hasLocks = !!(locks && typeof locks.request === "function");
	const heldLocks = new Map(); // id -> release function (Web Locks mode)
	const pendingLocks = new Map(); // id -> Promise<release function>
	const ownedWithoutLocks = new Set(); // ids written by this store (no Web Locks)
	let dbPromise = null;
	let closed = false;

	const ensureOpen = () => {
		if (closed) throw closedError();
	};

	function openDb() {
		if (dbPromise) return dbPromise;
		if (!idb || typeof idb.open !== "function") {
			return Promise.reject(new RecoveryError("UNAVAILABLE", "IndexedDB is unavailable"));
		}
		dbPromise = new Promise((resolve, reject) => {
			const request = idb.open(RECOVERY_DB_NAME, RECOVERY_SCHEMA_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(ENTRY_STORE)) db.createObjectStore(ENTRY_STORE, { keyPath: "id" });
			};
			request.onsuccess = () => {
				const db = request.result;
				db.onversionchange = () => {
					db.close();
					dbPromise = null;
				};
				resolve(db);
			};
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new RecoveryError("UNAVAILABLE", "Recovery database upgrade is blocked by another window"));
		});
		dbPromise.catch(() => {
			dbPromise = null;
		});
		return dbPromise;
	}

	// Try to take the exclusive lock for id without waiting. Resolves to a release
	// function, or null when another owner holds it.
	function tryLock(id) {
		return new Promise((resolve, reject) => {
			let releaseLock;
			const held = new Promise((r) => {
				releaseLock = r;
			});
			locks.request(LOCK_PREFIX + id, { mode: "exclusive", ifAvailable: true }, (lock) => {
				if (!lock) {
					resolve(null);
					return undefined;
				}
				resolve(() => releaseLock());
				return held;
			}).catch(reject);
		});
	}

	async function acquireOwned(id) {
		if (heldLocks.has(id)) return;
		if (!pendingLocks.has(id)) {
			const pending = tryLock(id).finally(() => pendingLocks.delete(id));
			pendingLocks.set(id, pending);
		}
		const releaseLock = await pendingLocks.get(id);
		if (heldLocks.has(id)) {
			// Another call raced and already stored the same lock.
			return;
		}
		if (!releaseLock) throw new RecoveryError("LOCKED", `Recovery record ${id} is owned by another live window`);
		if (closed) {
			releaseLock();
			throw closedError();
		}
		heldLocks.set(id, releaseLock);
	}

	function releaseOwned(id) {
		const releaseLock = heldLocks.get(id);
		heldLocks.delete(id);
		ownedWithoutLocks.delete(id);
		if (releaseLock) releaseLock();
	}

	function ownsId(id) {
		return hasLocks ? heldLocks.has(id) : ownedWithoutLocks.has(id);
	}

	async function heldLockIds() {
		const snapshot = await locks.query();
		const ids = new Set();
		for (const lock of snapshot?.held || []) {
			if (typeof lock?.name === "string" && lock.name.startsWith(LOCK_PREFIX)) ids.add(lock.name.slice(LOCK_PREFIX.length));
		}
		return ids;
	}

	async function putTransaction(id, decide) {
		const db = await openDb();
		const tx = readwriteTransaction(db);
		let failure = null;
		const done = transactionDone(tx, () => failure);
		const store = tx.objectStore(ENTRY_STORE);
		const getRequest = store.get(id);
		getRequest.onsuccess = () => {
			try {
				store.put(decide(getRequest.result));
			} catch (error) {
				failure = error;
				tx.abort();
			}
		};
		await done;
	}

	return {
		async write(record) {
			ensureOpen();
			assertValidRecoveryRecord(record);
			const { id } = record;
			if (hasLocks) await acquireOwned(id);
			try {
				await putTransaction(id, (existing) => {
					if (existing?.resolved) throw new RecoveryError("RESOLVED", `Recovery record ${id} was resolved and cannot be written`);
					const previous = Array.isArray(existing?.generations) ? existing.generations[0] : undefined;
					if (previous && !(record.revision > previous.revision)) {
						throw new RecoveryError("STALE_REVISION", `Recovery revision ${record.revision} for ${id} is not newer than stored revision ${previous.revision}`);
					}
					return { id, resolved: false, generations: previous ? [record, previous] : [record] };
				});
			} catch (error) {
				// A resolved id can never be written again, so do not keep owning it.
				if (error?.code === "RESOLVED") releaseOwned(id);
				throw error;
			}
			if (!hasLocks) ownedWithoutLocks.add(id);
		},

		async list() {
			ensureOpen();
			const db = await openDb();
			const tx = db.transaction(ENTRY_STORE, "readonly");
			const done = transactionDone(tx, () => null);
			const rows = await requestToPromise(tx.objectStore(ENTRY_STORE).getAll());
			await done;

			let othersHeld = null;
			let ownershipUnknown = !hasLocks;
			if (hasLocks) {
				try {
					othersHeld = await heldLockIds();
				} catch {
					// Cannot tell who is live; treat unowned entries as potentially active.
					ownershipUnknown = true;
				}
			}

			const entries = [];
			for (const row of rows) {
				if (row?.resolved) continue;
				const id = row?.id;
				const raw = Array.isArray(row?.generations) ? row.generations : [];
				const generations = raw
					.filter((generation) => recoveryRecordProblem(generation) === null && generation.id === id)
					.sort((a, b) => b.revision - a.revision)
					.slice(0, 2);
				if (raw.length === 0) continue;
				const entry = { id, generations, active: false };
				if (generations.length !== raw.length || !isValidRecoveryId(id)) entry.error = "Recovery entry contains invalid data";
				if (!ownsId(id)) {
					if (ownershipUnknown) {
						entry.active = true;
						entry.ownershipUnknown = true;
					} else {
						entry.active = othersHeld.has(id);
					}
				}
				entries.push(entry);
			}
			entries.sort((a, b) => updatedAtTime(b.generations[0]) - updatedAtTime(a.generations[0]));
			return entries;
		},

		async resolve(id) {
			ensureOpen();
			assertValidRecoveryId(id);
			let temporaryRelease = null;
			if (!ownsId(id)) {
				if (!hasLocks) {
					throw new RecoveryError("OWNER_UNKNOWN", `Recovery record ${id} may belong to another live window and cannot be discarded`);
				}
				temporaryRelease = await tryLock(id);
				if (!temporaryRelease) throw new RecoveryError("LOCKED", `Recovery record ${id} is owned by another live window`);
			}
			try {
				await putTransaction(id, () => ({ id, resolved: true, resolvedAt: Date.now(), generations: [] }));
			} finally {
				if (temporaryRelease) temporaryRelease();
			}
			releaseOwned(id);
		},

		async release(id) {
			ensureOpen();
			assertValidRecoveryId(id);
			const pending = pendingLocks.get(id);
			if (pending) await pending.catch(() => null);
			releaseOwned(id);
		},

		async close() {
			if (closed) return;
			closed = true;
			for (const id of [...heldLocks.keys()]) releaseOwned(id);
			ownedWithoutLocks.clear();
			const opening = dbPromise;
			dbPromise = null;
			if (opening) {
				try {
					(await opening).close();
				} catch {
					// Opening failed; nothing to close.
				}
			}
		},
	};
}
