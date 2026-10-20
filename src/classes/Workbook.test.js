import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import FileManager from './FileManager.js';
import CheckCommand from './CheckCommand.js';
import VimKeyboard from './VimKeyboard.js';
import { compileConfig } from './LuaConfig.js';
import { formulaReferences } from './FormulaEditing.js';

const sheet = new SheetManager(), history = new HistoryManager();
// Workbook/keyboard contracts are DOM-free; browser coverage exercises the real renderer separately.
globalThis.window = {};
sheet.loadAllCells = () => sheet.recalculate();
sheet.loadStyles = () => {};
beforeEach(() => sheet.loadWorkbook({ rows: [['3', '7', ''], ['5', '=A0+4', '']] }));

test('legacy object and rows-only files load and upgrade without losing styles or formulae', async () => {
	const files = new FileManager(); files.setPhMessage = () => {};
	await files.loadFile(JSON.stringify({ rows: [['12', '=A0*3']], styles: [[{ fg: 'red', bg: 'navy' }, { fg: 'white', bg: 'transparent' }]] }), '/old.dflo');
	assert.equal(sheet.activeSheet.name, 'Sheet1');
	assert.equal(sheet.getValue(0, 1), 36);
	assert.deepEqual(sheet.styles[0][0], { fg: 'red', bg: 'navy' });
	assert.equal(sheet.path, '/old.dflo');
	sheet.createSheet('Second');
	await files.loadFile('[["9","=A0+2"],["text",""]]');
	assert.equal(sheet.sheets.length, 1);
	assert.equal(sheet.getValue(0, 1), 11);
	assert.deepEqual(sheet.styles[1][0], { fg: 'white', bg: 'transparent' });
	assert.equal(sheet.path, null);
	sheet.styles[0][0].fg = 'yellow';
	assert.equal(sheet.styles[1][0].fg, 'white');
});

test('browser save and reopen retain every sheet, active sheet, dimensions and independent styles', async () => {
	sheet.renameSheet('Inputs'); sheet.styles[0][0].bg = 'navy';
	sheet.createSheet('Results'); sheet.rows[0][0] = '=Inputs!A0*2';
	const files = new FileManager(); files.setPhMessage = () => {};
	let saved;
	files.downloadFile = content => { saved = content; };
	await files.saveFile();
	assert.equal(JSON.parse(saved).sheets.length, 2);
	sheet.loadWorkbook([['discard']]);
	await files.loadFile(saved);
	assert.equal(sheet.activeSheet.name, 'Results');
	assert.equal(sheet.getValue(0, 0), 6);
	assert.equal(sheet.rows.length, 50);
	sheet.switchSheet('Inputs');
	assert.equal(sheet.rows.length, 2);
	assert.equal(sheet.rows[0].length, 3);
	assert.equal(sheet.styles[0][0].bg, 'navy');
});

test('invalid files and sheet operations do not replace or partially mutate existing work', () => {
	const before = JSON.stringify(sheet.serializeWorkbook()); sheet.path = '/keep.dflo';
	for (const data of [null, [], { rows: [[]] }, { rows: [['a'], ['b', 'c']] }, { sheets: [] },
		{ sheets: [{ name: 'A', rows: [['a']] }, { name: 'a', rows: [['b']] }] },
		{ sheets: [{ rows: [['a']] }], activeSheet: 1 }, { rows: [['a']], styles: [[]] }]) {
		assert.throws(() => sheet.loadWorkbook(data));
		assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
		assert.equal(sheet.path, '/keep.dflo');
	}
	assert.throws(() => sheet.createSheet('sheet1'));
	assert.throws(() => sheet.renameSheet('  '));
	assert.throws(() => sheet.switchSheet(0));
	assert.throws(() => sheet.moveSheet(2));
	assert.throws(() => sheet.deleteSheet(undefined, true), /last sheet/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
});

test('switching preserves per-sheet cursor and undo/redo, while duplication and reordering stay independent', () => {
	sheet.rows[0][0] = '19'; sheet.styles[0][0].fg = 'orange'; history.do(sheet);
	sheet.selRow = 1; sheet.selCol = 2;
	sheet.createSheet('Other'); sheet.rows[0][0] = '42'; history.do(sheet);
	history.undo(sheet); assert.equal(sheet.rows[0][0], '');
	sheet.switchSheet(1);
	assert.deepEqual([sheet.selRow, sheet.selCol], [1, 2]);
	history.undo(sheet); assert.equal(sheet.rows[0][0], '3');
	assert.equal(sheet.styles[0][0].fg, 'white');
	history.redo(sheet); assert.equal(sheet.rows[0][0], '19');
	sheet.createSheet('Copy', true); sheet.rows[0][0] = '99'; sheet.styles[0][0].fg = 'pink';
	sheet.moveSheet(1); assert.equal(sheet.activeSheet.name, 'Copy');
	sheet.switchSheet('Sheet1');
	assert.equal(sheet.rows[0][0], '19'); assert.equal(sheet.styles[0][0].fg, 'orange');
	sheet.switchSheet('Other'); history.redo(sheet); assert.equal(sheet.rows[0][0], '42');
});

test('cross-sheet scalars, ranges, relative coordinates, spills and charts use the target sheet', () => {
	sheet.renameSheet('Inputs');
	sheet.rows[0][2] = '=VSTACK(11,13)';
	sheet.createSheet('Report');
	const cases = [
		['=Inputs!A0+Inputs!B1', 10], ['=SUM(inputs!A0:B1)', 22],
		['=Inputs!C1', 13], ['=Inputs!C0', [[11], [13]]],
		['=FILTER(Inputs!A0:B1, Inputs!A0:A1>3)', [[5, 7]]],
		['=Inputs![-1]{-1}', 7], ['=Inputs!A{Inputs!A0-3}', 3],
		['=IF(FALSE, Missing!A0, 17)', 17], ['=IFERROR(Missing!A0, 23)', 23],
		['=Inputs!A99', '#REF!'],
	];
	for (const [formula, expected] of cases) {
		sheet.rows[2][2] = formula;
		assert.deepEqual(sheet.getValue(2, 2), expected, formula);
	}
	sheet.rows[2][2] = '=CHART().line().series(Inputs!A0:A1).x(Inputs!B0:B1)';
	const chart = sheet.getValue(2, 2);
	assert.deepEqual(chart.series[0].values, [3, 5]); assert.deepEqual(chart.x, ['7', 7]);
	sheet.rows[2][2] = '=SUM(Inputs!A0:B1)';
	sheet.switchSheet('Inputs'); sheet.rows[0][0] = '20'; sheet.switchSheet('Report');
	assert.equal(sheet.cellValues.value[2][2], 56);
});

test('rename updates actual references, including undo/redo snapshots, but leaves text and chart titles alone', () => {
	sheet.renameSheet('Inputs'); sheet.createSheet('Report');
	sheet.rows[0][0] = '=Inputs!B0'; sheet.rows[0][1] = '=IF(TRUE,"Inputs!A0",Inputs!A0)';
	sheet.rows[0][2] = '=CHART().line().series(Inputs!A0:A1).title("Inputs!A0")';
	sheet.rows[1][0] = 'Inputs!A0'; sheet.rows[1][1] = '=Inputs!A{Inputs!A0-3}'; history.do(sheet);
	sheet.rows[0][0] = '=Inputs!A0'; history.do(sheet); history.undo(sheet);
	sheet.switchSheet('Inputs'); sheet.renameSheet("O'Brien, 2026"); sheet.switchSheet('Report');
	assert.equal(sheet.rows[0][0], "='O''Brien, 2026'!B0");
	assert.equal(sheet.getValue(0, 0), 7);
	assert.equal(sheet.getValue(0, 1), 'Inputs!A0');
	assert.equal(sheet.rows[1][0], 'Inputs!A0');
	assert.equal(sheet.rows[1][1], "='O''Brien, 2026'!A{'O''Brien, 2026'!A0-3}");
	assert.equal(sheet.getValue(1, 1), 3);
	assert.equal(sheet.getValue(0, 2).title, 'Inputs!A0');
	assert.deepEqual(sheet.getValue(0, 2).series[0].values, [3, 5]);
	history.redo(sheet); assert.equal(sheet.rows[0][0], "='O''Brien, 2026'!A0");
	history.undo(sheet); assert.equal(sheet.getValue(0, 0), 7);
});

test('deletion protects data and references; forced deletion permanently invalidates references', () => {
	sheet.createSheet('Blank'); sheet.switchSheet(1); sheet.rows[0][0] = '=Blank!A0'; history.do(sheet);
	assert.throws(() => sheet.deleteSheet('Blank'), /sheetdelete!/);
	sheet.deleteSheet('Blank', true);
	assert.equal(sheet.rows[0][0], '=#REF!A0'); assert.equal(sheet.getValue(0, 0), '#REF!');
	sheet.createSheet('Blank'); sheet.rows[0][0] = '99'; sheet.switchSheet(1);
	assert.equal(sheet.getValue(0, 0), '#REF!');
	assert.throws(() => sheet.deleteSheet(), /sheetdelete!/);
	sheet.deleteSheet(undefined, true); assert.equal(sheet.activeSheet.name, 'Blank');
	assert.throws(() => sheet.deleteSheet(undefined, true), /last sheet/);
});

test('cross-sheet cycles and spill cycles are detected from either root without conflating equal coordinates', () => {
	sheet.loadWorkbook({ sheets: [
		{ name: 'A', rows: [['=B!A0+1', ''], ['', '']] },
		{ name: 'B', rows: [['=A!A0+1', ''], ['', '']] },
	] });
	for (const name of ['A', 'B']) { sheet.switchSheet(name); assert.match(sheet.getValue(0, 0), /circular/); assert.match(sheet.recalculate()[0][0], /circular/); }
	sheet.sheets[1].rows[0][0] = '8'; sheet.switchSheet('A'); assert.equal(sheet.getValue(0, 0), 9);
	sheet.sheets[0].rows[0][0] = '=VSTACK(1, B!A0)';
	sheet.sheets[1].rows[0][0] = '=A!A1';
	sheet.switchSheet('A'); assert.equal(sheet.recalculate()[0][0], '#SPILL!');
	assert.equal(sheet.getValue(0, 0), '#SPILL!');
});

test('Lua shortcuts run sheet commands and leave rename/switch prompts ready for user input', async () => {
	globalThis.localStorage = { getItem: () => null };
	const command = new CheckCommand();
	command.render = async () => {}; command.setPhMessage = text => { command.message = text; };
	const pending = [];
	command.keyboard = new VimKeyboard(sheet, { ex: text => pending.push(command.handleEnterFromCom(text)) });
	command.keyboard.mappings = compileConfig(`vim.keymap.set({'n','f'}, ']s', ':sheetnext<CR>')
vim.keymap.set('n', 'N', ':sheetnew Sales 2026<CR>')
vim.keymap.set('n', 'R', ':sheetrename ')
vim.keymap.set('n', 'S', ':sheet ')`).mappings;
	const feed = async keys => { command.keyboard.feed(keys); await Promise.all(pending.splice(0)); };
	await feed('N'); assert.equal(sheet.activeSheet.name, 'Sales 2026');
	await feed('RBudget<CR>'); assert.equal(sheet.activeSheet.name, 'Budget');
	await feed('S1<CR>'); assert.equal(sheet.activeSheet.name, 'Sheet1');
	await feed('<CR>]s'); assert.equal(sheet.activeSheet.name, 'Budget'); assert.equal(command.keyboard.context, 'sheet');
	await command.handleEnterFromCom(':sheetprev'); assert.equal(sheet.activeSheet.name, 'Sheet1');
	await command.handleEnterFromCom(':sheetprev'); assert.equal(sheet.activeSheet.name, 'Budget');
	await command.handleEnterFromCom(':sheets'); assert.match(command.message, /\*2: Budget/);
	await command.handleEnterFromCom(':sheetnew'); assert.equal(sheet.activeSheet.name, 'Sheet2');
	await command.handleEnterFromCom(':sheetduplicate'); assert.equal(sheet.activeSheet.name, 'Sheet2 copy 1');
	await command.handleEnterFromCom(':sheetmove 1'); assert.equal(sheet.sheets[0].name, 'Sheet2 copy 1');
	await command.handleEnterFromCom(':sheetdelete'); assert.equal(sheet.activeSheet.name, 'Sheet1');
	await command.handleEnterFromCom(':sheetrename Budget'); assert.match(command.message, /already exists/);
});

test('foreign reference highlights and F4 keep sheet identity and never draw on unrelated grid cells', () => {
	sheet.renameSheet('Inputs'); sheet.createSheet('Report');
	sheet.rows[2][2] = "=Inputs!A0+'Inputs'!A0+A0+Missing!A0";
	const refs = formulaReferences(sheet.rows[2][2], 2, 2, sheet);
	assert.equal(refs.length, 4); assert.equal(refs[0].region, null);
	assert.equal(refs[0].color, refs[1].color); assert.notEqual(refs[0].color, refs[2].color);
	assert.deepEqual(refs[2].region, { r0: 0, c0: 0, r1: 0, c1: 0 });
	assert.equal(refs[3].coordinates, null);
	sheet.selRow = 2; sheet.selCol = 2; sheet.rows[2][2] = "='Inputs'!A0:B1";
	const keyboard = new VimKeyboard(sheet); keyboard.feed('<CR>A<F4>');
	assert.equal(keyboard.formula, "='Inputs'![-2]{-2}:[-1]{-1}");
	keyboard.feed('<F4>'); assert.equal(keyboard.formula, "='Inputs'!A0:B1");
});
