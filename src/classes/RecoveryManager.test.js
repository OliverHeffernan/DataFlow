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

test('a late recovery-list refresh cannot replace the unsaved-work decision during native quit', async () => {
	keyboard().feed('A9<Esc><Esc>'); await manager.flush();
	const record = { snapshotVersion: 1, id: 'other-copy', revision: 1, updatedAt: 10,
		name: 'Other.dflo', sourcePath: null, workbook: manager.capture().workbook };
	records.set(record.id, { id: record.id, active: false, generations: [record] });
	await manager.refreshList();
	const discarding = manager.discard(0); await settle();
	assert.equal(manager.state.dialog.kind, 'discard');
	let finishList;
	manager.store.list = () => new Promise(resolve => { finishList = resolve; });
	// The native lifecycle cancels an existing modal before asking to leave.
	manager.answer('cancel');
	const leaving = manager.guard('quit DataFlow'); await settle();
	assert.equal(manager.state.dialog.kind, 'leave');
	finishList([...records.values()]); await discarding;
	assert.equal(manager.state.dialog.kind, 'leave');
	manager.answer('cancel');
	assert.equal(await leaving, false);
	assert.equal(sheet.rows[0][0], '119');
});

test('automatic checkpoints debounce at one second, cap continuous typing at five seconds, and respect off/now', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1700000000000 });
	const keys = keyboard(); keys.feed('A1'); await settle();
	t.mock.timers.tick(999); await manager.tail;
	assert.equal(records.size, 0);
	t.mock.timers.tick(1); await manager.tail;
	assert.equal((await manager.store.list())[0].generations[0].workbook.sheets[0].rows[0][0], '111');
	for (let i = 0; i < 5; i++) { keys.feed('2'); await settle(); t.mock.timers.tick(900); }
	keys.feed('8'); await settle();
	t.mock.timers.tick(499); await manager.tail;
	assert.equal((await manager.store.list())[0].generations[0].revision, 1);
	t.mock.timers.tick(1); await manager.tail;
	assert.equal((await manager.store.list())[0].generations[0].workbook.sheets[0].rows[0][0], '111222228');
	await manager.command(':autosave off');
	keys.feed('9'); await settle(); t.mock.timers.tick(10000); await manager.tail;
	assert.equal((await manager.store.list())[0].generations[0].revision, 2);
	await manager.command(':autosave now');
	assert.equal((await manager.store.list())[0].generations[0].workbook.sheets[0].rows[0][0], '1112222289');
});

function dataset(blocked = false) {
	sheet.loadWorkbook({ version: 3, activeSheet: 0, title: { keep: 'workbook metadata' },
		marks: [{ name: 'sales', kind: 'dataset', sheetName: 'Data', bounds: { r0: 0, c0: 0, r1: 1, c1: 1 } }],
		sheets: [{ name: 'Data', note: { keep: 'sheet metadata' }, rows: [['name', 'amount', ''], ['one', '13', ''], ['', blocked ? 'occupied' : '', ''], ['', '', ''], ['', '', '']] },
			{ name: 'Totals', rows: [['=SUM(`sales.amount)', '']] }],
	}, '/data.dflo');
}

test('pending dataset INSERT projects consistent metadata without publishing marks or changing undo grouping', async () => {
	dataset();
	const keys = keyboard(); keys.feed('2jitwo'); await settle();
	await manager.flush();
	const candidate = (await manager.store.list())[0].generations[0].workbook;
	assert.equal(candidate.marks[0].bounds.r1, 2);
	assert.equal(candidate.sheets[0].rows[2][0], 'two');
	assert.equal(sheet.marks[0].bounds.r1, 1, 'capture must not publish inferred bounds');
	assert.deepEqual(candidate.title, { keep: 'workbook metadata' });
	assert.deepEqual(candidate.sheets[0].note, { keep: 'sheet metadata' });
	let saved;
	const file = files({ native: true, invoke: async (_, args) => { saved = JSON.parse(args.content); return args.path; } });
	assert.equal((await file.saveFile()).status, 'saved');
	assert.equal(saved.marks[0].bounds.r1, 2);
	assert.equal(manager.state.dirty, false);
	keys.feed('<Esc><Esc>'); await manager.flush();
	assert.equal(manager.state.dirty, false, 'committing the projected content must not create a false dirty change');
	history.undo(sheet); await manager.flush();
	assert.equal(sheet.rows[2][0], '');
	assert.equal(sheet.marks[0].bounds.r1, 1);
	assert.equal(manager.state.dirty, true);
	const record = { snapshotVersion: 1, id: 'metadata-recovery', revision: 1, updatedAt: 10,
		name: 'Data.dflo', sourcePath: '/data.dflo', workbook: saved };
	records.set(record.id, { id: record.id, active: false, generations: [record] });
	await manager.refreshList();
	const restoring = manager.restore(0); await settle(); manager.answer('keep'); await restoring;
	assert.deepEqual(sheet.workbook.title, { keep: 'workbook metadata' });
	assert.deepEqual(sheet.activeSheet.note, { keep: 'sheet metadata' });
	assert.equal(sheet.describeDataset('sales').rowCount, 2);
	assert.equal(sheet.path, null);
	assert.equal(manager.state.dirty, true);
});

test('invalid pending headers and blocked dataset growth retain the readable generation and cannot save', async () => {
	dataset();
	const keys = keyboard(); keys.feed('jA3<Esc><Esc>'); await manager.flush();
	keys.feed('kIbad'); await settle();
	assert.equal(sheet.rows[0][0], 'name', 'keyboard header protection remains intact');
	// A caller publishing raw rows must not bypass header protection merely
	// because its replacement is a valid identifier.
	sheet.rows[0][0] = 'badname'; sheet.notifyWorkbookChanged(); await settle();
	await assert.rejects(manager.flush(), /datasetcolumnrename/);
	assert.equal((await manager.store.list())[0].generations[0].workbook.sheets[0].rows[0][0], 'name');
	const file = files({ native: true, invoke: () => assert.fail('invalid pending content must not reach disk') });
	file.downloadFile = () => assert.fail('a validation failure must not download');
	assert.equal((await file.saveFile()).status, 'failed');
	const leaving = manager.guard(); await settle(); manager.answer('cancel');
	assert.equal(await leaving, false);
	sheet.rows[0][0] = 'name'; sheet.notifyWorkbookChanged(); await manager.flush();
	assert.equal(sheet.rows[0][0], 'name');
	dataset(true);
	keyboard().feed('2jitwo'); await settle();
	await assert.rejects(manager.flush(), /blocked/);
	assert.equal(sheet.marks[0].bounds.r1, 1);
});

test('structural INSERT and chronological undo checkpoint cells, marks and metadata together; notifications exclude no-ops', async () => {
	dataset();
	const changes = [], unsubscribe = sheet.onWorkbookChange(kind => changes.push(kind));
	try {
		history.reset(sheet); history.undo(sheet); history.redo(sheet); sheet.recalculate(); await settle();
		assert.deepEqual(changes, []);
		const keys = keyboard(); keys.feed('jOfresh'); await settle();
		assert.deepEqual(changes, ['content']);
		await manager.flush();
		const inserted = (await manager.store.list())[0].generations[0].workbook;
		assert.equal(inserted.sheets[0].rows[1][0], 'fresh');
		assert.equal(inserted.sheets[0].rows[2][0], 'one');
		assert.equal(inserted.marks[0].bounds.r1, 2);
		keys.feed('<Esc><Esc>'); sheet.switchSheet('Totals'); await settle();
		history.undo(sheet); await manager.flush();
		assert.equal(sheet.activeSheet.name, 'Totals');
		assert.equal(sheet.sheets[0].rows[1][0], 'one');
		assert.equal(sheet.marks[0].bounds.r1, 1);
		assert.equal(manager.state.dirty, false);
		assert.equal((await manager.store.list()).length, 0);
	} finally { unsubscribe(); }
});
