import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createIndexedDbRecoveryStore,
	createNativeRecoveryStore,
	createRecoveryId,
	isValidRecoveryId,
	recoveryRecordProblem,
} from "./RecoveryStore.js";

const record = (overrides = {}) => ({
	snapshotVersion: 1,
	id: "abc-123",
	revision: 1,
	updatedAt: 1700000000000,
	sourcePath: null,
	name: "Untitled",
	workbook: { sheets: [] },
	...overrides,
});

test("recovery ids are restricted to safe characters and generated ids are valid", () => {
	for (const id of ["a", "Ab-9", createRecoveryId(), "x".repeat(64)]) assert.equal(isValidRecoveryId(id), true, id);
	for (const id of ["", "../x", "a/b", "a_b", "a b", "x".repeat(65), 7, null, undefined]) assert.equal(isValidRecoveryId(id), false, String(id));
});

test("recovery records must match the snapshot contract", () => {
	assert.equal(recoveryRecordProblem(record()), null);
	assert.equal(recoveryRecordProblem(record({ sourcePath: "/tmp/a.dflo", updatedAt: 0 })), null);
	for (const bad of [
		null,
		[],
		record({ snapshotVersion: 2 }),
		record({ id: "a/b" }),
		record({ revision: 0 }),
		record({ revision: 1.5 }),
		record({ updatedAt: "not a date" }),
		record({ updatedAt: Number.NaN }),
		record({ sourcePath: undefined }),
		record({ name: 3 }),
		record({ workbook: [] }),
		record({ workbook: null }),
	]) {
		assert.notEqual(recoveryRecordProblem(bad), null, JSON.stringify(bad));
	}
});

test("native store rejects invalid input and propagates storage failures", async () => {
	const store = createNativeRecoveryStore(async () => {
		throw new Error("disk full");
	});
	await assert.rejects(store.write(record({ revision: -1 })), { code: "INVALID_RECORD" });
	await assert.rejects(store.resolve("../x"), { code: "INVALID_ID" });
	await assert.rejects(store.write(record()), /disk full/);
	await store.close();
	await assert.rejects(store.write(record()), { code: "CLOSED" });
});

test("browser store reports missing IndexedDB and refuses to discard entries of unknown ownership", async () => {
	const store = createIndexedDbRecoveryStore({ indexedDB: null, locks: null });
	await assert.rejects(store.write(record()), { code: "UNAVAILABLE" });
	await assert.rejects(store.resolve("someone-else"), { code: "OWNER_UNKNOWN" });
	await store.close();
});

test("browser store refuses to write or discard an id locked by another live owner", { skip: !globalThis.navigator?.locks && "Web Locks unavailable" }, async () => {
	let releaseOther;
	const otherOwner = new Promise((acquired) => {
		navigator.locks.request("dataflow-recovery:live-id", () => new Promise((release) => {
			releaseOther = release;
			acquired();
		}));
	});
	await otherOwner;
	const store = createIndexedDbRecoveryStore({ indexedDB: null });
	try {
		await assert.rejects(store.write(record({ id: "live-id" })), { code: "LOCKED" });
		await assert.rejects(store.resolve("live-id"), { code: "LOCKED" });
	} finally {
		releaseOther();
		await store.close();
	}
});
