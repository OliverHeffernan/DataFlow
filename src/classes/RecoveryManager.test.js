import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import VimKeyboard from './VimKeyboard.js';
import FileManager from './FileManager.js';
import RecoveryManager from './RecoveryManager.js';

const sheet = new SheetManager(), history = new HistoryManager();
sheet.loadAllCells = () => sheet.recalculate();
sheet.loadStyles = () => {};
let manager, records, resolved;
const settle = () => new Promise(resolve => queueMicrotask(resolve));

beforeEach(() => {
	sheet.loadWorkbook({ rows: [['11', '=A0*3', ''], ['7', '', '']] }, '/original.dflo');
	records = new Map(); resolved = new Set();
	const store = {
		async write(record) {
			assert.equal(resolved.has(record.id), false, 'cannot resurrect a resolved copy');
			const old = records.get(record.id)?.generations[0];
			records.set(record.id, { id: record.id, active: false, generations: [structuredClone(record), ...(old ? [old] : [])] });
		},
		async list() { return [...records.values()].filter(entry => !resolved.has(entry.id)); },
		async resolve(id) { resolved.add(id); }, async release() {}, async close() {},
	};
	manager = new RecoveryManager(sheet, store);
	sheet.recovery = manager;
});
afterEach(async () => { await manager.close(); delete sheet.recovery; });

function keyboard() {
	return new VimKeyboard(sheet, { change: () => history.do(sheet), undo: (redo, count) => history[redo ? 'redo' : 'undo'](sheet, count) });
}
function files(io) {
	const file = new FileManager(undefined, io);
	file.setPhMessage = text => { file.message = text; };
	return file;
}

test('typing checkpoints before Escape without changing undo grouping, and undo back to saved content is clean', async () => {
	const keys = keyboard();
	keys.feed('A9'); // INSERT has not committed a history entry.
	await settle();
	assert.equal(manager.state.dirty, true);
	await manager.flush();
	assert.equal([...records.values()][0].generations[0].workbook.sheets[0].rows[0][0], '119');
	keys.feed('<Esc><Esc>u');
	await manager.flush();
	assert.equal(sheet.rows[0][0], '11');
	assert.equal(manager.state.dirty, false);
	assert.equal((await manager.store.list()).length, 0);
	keys.feed('<C-r>');
	await manager.flush();
	assert.equal(sheet.rows[0][0], '119');
	assert.equal(manager.state.dirty, true);
	assert.equal((await manager.store.list()).length, 1);
});

test('sheet structure and clear dirty content, while switching, rejected fill and recalculation do not', async () => {
	sheet.createSheet('Other');
	await manager.flush();
	await manager.saved(manager.capture(), '/both.dflo');
	sheet.switchSheet(1); sheet.recalculate();
	await settle();
	assert.equal(manager.state.dirty, false);
	assert.throws(() => sheet.applyRangeEdit([{ row: 99, col: 0, value: 'oops' }]));
	assert.equal(manager.state.dirty, false);
	sheet.clearScreen();
	await manager.flush();
	assert.equal(manager.state.dirty, true);
	assert.equal(sheet.sheets.length, 2);
	history.undo(sheet);
	await manager.flush();
	assert.equal(sheet.rows[0][0], '11');
	assert.equal(sheet.path, '/both.dflo');
	assert.equal(manager.state.dirty, false);
	sheet.renameSheet('Renamed');
	await manager.flush();
	assert.equal([...await manager.store.list()][0].generations[0].workbook.sheets[0].name, 'Renamed');
});

test('native failures and cancelled Save As retain work, recovery, path and dirty state without downloads', async () => {
	keyboard().feed('A9<Esc><Esc>'); await manager.flush();
	const fail = files({ native: true, invoke: async () => { throw new Error('permission denied'); } });
	fail.downloadFile = () => assert.fail('native failure must never download');
	assert.equal((await fail.saveFile()).status, 'failed');
	assert.match(fail.message, /Save failed: permission denied/);
	assert.equal(manager.state.dirty, true);
	assert.equal(sheet.path, '/original.dflo');
	assert.equal((await manager.store.list()).length, 1);
	const cancel = files({ native: true, save: async () => null, invoke: () => assert.fail('cancelled save must not write') });
	assert.equal((await cancel.saveFile(true)).status, 'cancelled');
	assert.equal(manager.state.dirty, true);
	assert.equal((await manager.store.list()).length, 1);
});

test('a delayed save captures immutable content and cannot resolve newer edits or attach its path to another workbook', async () => {
	const keys = keyboard(); keys.feed('A9<Esc><Esc>'); await settle();
	let finishWrite, savedBytes;
	const file = files({ native: true, invoke: async (_, { content }) => {
		savedBytes = content;
		return new Promise(resolve => { finishWrite = resolve; });
	} });
	const saving = file.saveFile();
	keys.feed('A8<Esc><Esc>'); await manager.flush();
	finishWrite('/normalized.dflo'); await saving;
	assert.equal(JSON.parse(savedBytes).sheets[0].rows[0][0], '119');
	assert.equal(sheet.rows[0][0], '1198');
	assert.equal(manager.state.dirty, true);
	assert.equal((await manager.store.list())[0].generations[0].workbook.sheets[0].rows[0][0], '1198');
	assert.equal(sheet.path, '/normalized.dflo');
	const old = manager.capture();
	sheet.loadWorkbook([['replacement']], '/replacement.dflo');
	await manager.saved(old, '/wrong.dflo');
	assert.equal(sheet.path, '/replacement.dflo');
	assert.equal(manager.state.dirty, false);
});

test('invalid opens and failed Keep recovery leave the current workbook intact; cancel never discards it', async () => {
	keyboard().feed('A9<Esc><Esc>'); await settle();
	await assert.rejects(files().loadFile('{"sheets":[]}'), /at least one sheet/);
	assert.equal(sheet.rows[0][0], '119');
	assert.equal(manager.state.dialog, null);
	const opening = files().loadFile('[["replacement"]]');
	await settle();
	assert.equal(manager.state.dialog.kind, 'leave');
	manager.answer('cancel');
	assert.equal(await opening, false);
	assert.equal(sheet.rows[0][0], '119');
	manager.store.write = async () => { throw new Error('disk full'); };
	const keeping = manager.guard(); await settle(); manager.answer('keep');
	assert.equal(await keeping, false);
	assert.match(manager.state.error, /disk full/);
	assert.equal(manager.state.locked, false);
	assert.equal(manager.state.dirty, true);
});

test('recovery validates generations, restores a detached dirty copy, and keeps the source if replacement storage fails', async () => {
	const valid = { snapshotVersion: 1, id: 'crashed', revision: 1, updatedAt: 10, name: 'Budget.dflo',
		sourcePath: '/do-not-overwrite.dflo', workbook: structuredClone(sheet.serializeWorkbook()) };
	valid.workbook.sheets[0].rows[0][0] = '29';
	records.set(valid.id, { id: valid.id, active: false, generations: [{ ...valid, revision: 2, workbook: { sheets: [] } }, valid] });
	await manager.refreshList();
	assert.match(manager.state.entries[0].error, /at least one sheet/);
	manager.store.write = async () => { throw new Error('quota exceeded'); };
	await manager.restore(0);
	assert.equal(sheet.path, null);
	assert.equal(manager.state.sourcePath, '/do-not-overwrite.dflo');
	assert.equal(sheet.rows[0][0], '29');
	assert.equal(sheet.getValue(0, 1), 87);
	assert.equal(manager.state.dirty, true);
	assert.equal((await manager.store.list()).some(entry => entry.id === valid.id), true);
	assert.match(manager.state.error, /quota exceeded/);
});

test('intentional browser exports retain recovery even though the export baseline is clean', async () => {
	keyboard().feed('A9<Esc><Esc>'); await settle();
	const file = files({ native: false }); let downloaded;
	file.downloadFile = bytes => { downloaded = bytes; };
	assert.equal((await file.saveFile()).status, 'exported');
	assert.equal(JSON.parse(downloaded).sheets[0].rows[0][0], '119');
	assert.equal(manager.state.dirty, false);
	assert.equal((await manager.store.list()).length, 1);
	assert.equal(sheet.path, '/original.dflo');
});
