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

test("native store invokes the recovery commands and close releases only still-owned ids", async () => {
	const calls = [];
	const store = createNativeRecoveryStore(async (command, args) => {
		calls.push([command, args]);
		return command === "recovery_list" ? [] : undefined;
	});
	await store.write(record({ id: "one" }));
	await store.write(record({ id: "two" }));
	await store.write(record({ id: "three" }));
	assert.deepEqual(await store.list(), []);
	await store.resolve("two");
	await store.release("three");
	await store.close();
	assert.deepEqual(calls.map(([command, args]) => [command, args?.id ?? args?.record?.id]), [
		["recovery_write", "one"],
		["recovery_write", "two"],
		["recovery_write", "three"],
		["recovery_list", undefined],
		["recovery_resolve", "two"],
		["recovery_release", "three"],
		["recovery_release", "one"],
	]);
	await assert.rejects(store.write(record()), { code: "CLOSED" });
});

test("native store validates before invoking and propagates command failures", async () => {
	const calls = [];
	const store = createNativeRecoveryStore(async (command) => {
		calls.push(command);
		throw new Error("disk full");
	});
	await assert.rejects(store.write(record({ revision: -1 })), { code: "INVALID_RECORD" });
	await assert.rejects(store.resolve("../x"), { code: "INVALID_ID" });
	assert.deepEqual(calls, []);
	await assert.rejects(store.write(record()), /disk full/);
	await store.close();
	assert.deepEqual(calls, ["recovery_write"]);
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
