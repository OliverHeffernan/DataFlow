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

test('workbook undo is chronological across sheets, including topology, while preserving navigation', () => {
	sheet.rows[0][0] = '19'; sheet.styles[0][0].fg = 'orange'; history.do(sheet);
	sheet.selRow = 1; sheet.selCol = 2;
	sheet.createSheet('Other'); sheet.rows[0][0] = '42'; history.do(sheet);
	sheet.switchSheet(1);
	assert.deepEqual([sheet.selRow, sheet.selCol], [1, 2]);
	assert.equal(history.do(sheet), false);
	history.undo(sheet); assert.equal(sheet.sheets[1].rows[0][0], '');
	assert.equal(sheet.rows[0][0], '19');
	history.undo(sheet); assert.equal(sheet.sheets.length, 1);
	history.undo(sheet); assert.equal(sheet.rows[0][0], '3'); assert.equal(sheet.styles[0][0].fg, 'white');
	history.redo(sheet, 3); assert.equal(sheet.sheets[1].rows[0][0], '42');
	assert.deepEqual([sheet.selRow, sheet.selCol], [1, 2]);
	sheet.createSheet('Copy', true); sheet.rows[0][0] = '99'; sheet.styles[0][0].fg = 'pink';
	sheet.moveSheet(1); assert.equal(sheet.activeSheet.name, 'Copy');
	history.undo(sheet); assert.deepEqual(sheet.sheets.map(item => item.name), ['Sheet1', 'Other', 'Copy']);
	history.redo(sheet); assert.equal(sheet.activeSheet.name, 'Copy');
	sheet.switchSheet('Sheet1');
	assert.equal(sheet.rows[0][0], '19'); assert.equal(sheet.styles[0][0].fg, 'orange');
	sheet.deleteSheet('Other', true); history.undo(sheet); assert.equal(sheet.sheets.find(item => item.name === 'Other').rows[0][0], '42');
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

test('rename and its cross-sheet rewrites undo together without changing text or chart titles', () => {
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
	history.undo(sheet); assert.equal(sheet.sheets[0].name, 'Inputs'); assert.equal(sheet.rows[0][0], '=Inputs!B0');
	history.redo(sheet); assert.equal(sheet.sheets[0].name, "O'Brien, 2026"); assert.equal(sheet.getValue(0, 0), 7);
});

test('history and file round trips preserve workbook and nested sheet metadata without persisting history', () => {
	sheet.loadWorkbook({ version: 2, metadata: { language: 'en-NZ' }, sheets: [{ name: 'Data', rows: [['5']], layout: { widths: [112] } }] });
	sheet.workbook.metadata.language = 'mi'; sheet.activeSheet.layout.widths[0] = 180; sheet.rows[0][0] = '17'; history.do(sheet);
	history.undo(sheet);
	assert.equal(sheet.workbook.metadata.language, 'en-NZ'); assert.equal(sheet.activeSheet.layout.widths[0], 112);
	history.redo(sheet);
	const saved = JSON.parse(JSON.stringify(sheet.serializeWorkbook()));
	sheet.loadWorkbook(saved);
	assert.equal(sheet.workbook.metadata.language, 'mi'); assert.equal(sheet.activeSheet.layout.widths[0], 180);
	history.undo(sheet); assert.equal(sheet.rows[0][0], '17');
	assert.throws(() => sheet.loadWorkbook({ ...saved, version: 99 }), /version/);
	assert.deepEqual(sheet.serializeWorkbook(), saved);
	sheet.createSheet('Copy', true);
	assert.deepEqual(sheet.activeSheet.layout, { widths: [180] });
	sheet.activeSheet.layout.widths[0] = 240; sheet.rows[0][0] = '29'; history.do(sheet);
	assert.equal(sheet.sheets[0].layout.widths[0], 180); assert.equal(sheet.sheets[0].rows[0][0], '17');
	history.undo(sheet); assert.equal(sheet.activeSheet.layout.widths[0], 180);
	history.undo(sheet); assert.equal(sheet.sheets.length, 1);
	history.redo(sheet, 2); assert.equal(sheet.sheets[1].layout.widths[0], 240);
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

test('persistent marks share cross-sheet precision, lazy evaluation, spill and cycle semantics', () => {
	sheet.loadWorkbook([['0.1', '=VSTACK(11,13)', '', ''], ['0.2', '', '', ''], ['', '', '', '']]);
	sheet.setMark('tax', { r0: 0, c0: 0, r1: 0, c1: 0 });
	sheet.setMark('source', { r0: 0, c0: 1, r1: 0, c1: 1 });
	sheet.setMark('element', { r0: 0, c0: 1, r1: 0, c1: 1 }, 'range');
	sheet.createSheet('Report');
	for (const [formula, expected] of [
		['=`TAX+Sheet1!A1', 0.3], ['=`source', [[11], [13]]], ['=`element', 11],
		['=IF(FALSE,`missing,17)', 17], ['=IFERROR(`missing,23)', 23], ['=`missing', '#NAME?'],
		['=Sheet1!`tax', '#REF!'],
	]) { sheet.rows[2][2] = formula; assert.deepEqual(sheet.getValue(2, 2), expected, formula); }
	const descriptor = sheet.resolveMark('TAX'); descriptor.r0 = 99;
	assert.equal(sheet.resolveMark('tax').r0, 0);
	assert.throws(() => sheet.setMark('1bad', { r0: 0, c0: 0, r1: 0, c1: 0 }), /identifiers/);
	sheet.setMark('loop', { r0: 2, c0: 2, r1: 2, c1: 2 });
	sheet.rows[2][2] = '=`tax'; sheet.sheets[0].rows[0][0] = '=`loop';
	assert.match(sheet.getValue(2, 2), /circular/);
	assert.match(sheet.recalculate()[2][2], /circular/);
});

test('mark rename rewrites exact tokens and nested coordinates, and deletion never resurrects old references', () => {
	sheet.setMark('a', { r0: 0, c0: 0, r1: 0, c1: 0 });
	sheet.setMark('ab', { r0: 0, c0: 1, r1: 0, c1: 1 });
	sheet.createSheet('Report');
	sheet.rows[0][0] = '=`a+`ab'; sheet.rows[0][1] = '=IF(TRUE,"`a",`a)';
	sheet.rows[1][0] = '=Sheet1!A{`a-3}'; sheet.rows[1][1] = '`a';
	sheet.rows[2][0] = '=CHART().bar().series(`a).title("`a")'; history.do(sheet);
	sheet.renameMark('A', 'input');
	assert.equal(sheet.rows[0][0], '=`input+`ab'); assert.equal(sheet.getValue(0, 0), 10);
	assert.equal(sheet.rows[0][1], '=IF(TRUE,"`a",`input)');
	assert.equal(sheet.rows[1][0], '=Sheet1!A{`input-3}'); assert.equal(sheet.getValue(1, 0), 3);
	assert.equal(sheet.rows[1][1], '`a'); assert.equal(sheet.getValue(2, 0).title, '`a');
	assert.throws(() => sheet.renameMark('input', 'AB'), /duplicate/);
	history.undo(sheet); assert.equal(sheet.rows[0][0], '=`a+`ab');
	history.redo(sheet); assert.equal(sheet.rows[0][0], '=`input+`ab');
	assert.throws(() => sheet.deleteMark('input'), /delmarks!/);
	sheet.deleteMark('input', true); assert.equal(sheet.getValue(0, 0), '#REF!');
	sheet.setMark('input', { r0: 0, c0: 1, r1: 0, c1: 1 }, 'cell', 'Sheet1');
	assert.equal(sheet.getValue(0, 0), '#REF!');
	history.undo(sheet, 2); assert.equal(sheet.getValue(0, 0), 10);
	sheet.switchSheet('Sheet1'); sheet.renameSheet('Inputs');
	assert.equal(sheet.resolveMark('input').sheetName, 'Inputs');
	sheet.deleteSheet('Inputs', true); assert.equal(sheet.getValue(0, 0), '#REF!');
	history.undo(sheet); assert.equal(sheet.resolveMark('input').sheetName, 'Inputs');
});

test('dataset records expand on adjacent writes, not distant data; charts and one undo follow the same bounds', () => {
	sheet.loadWorkbook([
		['item', 'amount', '', '=SUM(`sales.amount)', '=SUM(`fixed)'], ['a', '5', '', '', ''],
		['b', '17', '', '=CHART().bar().series(`sales.amount).x(`sales.item)', ''],
		['', '', '', '', ''], ['', '', '', '', ''], ['', '91', '', '', ''], ['', '', '', '', ''],
	]);
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 2, c1: 1 }, 'dataset');
	sheet.setMark('fixed', { r0: 1, c0: 1, r1: 2, c1: 1 }, 'range');
	assert.equal(sheet.describeDataset('SALES').rowCount, 2);
	assert.deepEqual(sheet.describeDataset('sales').columns, [{ name: 'item', col: 0 }, { name: 'amount', col: 1 }]);
	const keyboard = new VimKeyboard(sheet, { change: () => { history.do(sheet); sheet.recalculate(); } });
	keyboard.move({ row: 3, col: 1 }); keyboard.feed('i29<CR>');
	assert.equal(sheet.describeDataset('sales').rowCount, 3);
	assert.equal(sheet.getValue(0, 3), 51); assert.equal(sheet.getValue(0, 4), 22);
	assert.deepEqual(sheet.getValue(2, 3).series[0].values, [5, 17, 29]);
	history.undo(sheet); assert.equal(sheet.rows[3][1], ''); assert.equal(sheet.describeDataset('sales').rowCount, 2);
	history.redo(sheet); assert.equal(sheet.rows[3][1], '29'); assert.equal(sheet.describeDataset('sales').rowCount, 3);
	sheet.appendDataset('sales'); assert.equal(sheet.describeDataset('sales').rowCount, 4);
	assert.throws(() => sheet.appendDataset('sales'), /blank/);
	assert.equal(sheet.describeDataset('sales').rowCount, 4); assert.equal(sheet.getValue(0, 3), 51);
	history.undo(sheet, 2);
	keyboard.move({ row: 3, col: 0 }); keyboard.register = { cells: [['c', '29'], ['', '']], linewise: false };
	keyboard.feed('p');
	assert.equal(sheet.describeDataset('sales').rowCount, 4); assert.equal(sheet.getValue(0, 3), 51);
});

test('dataset preflight is pure, rejects headers and blocked growth, and accepts already prepared publication', () => {
	sheet.loadWorkbook([['', 'item', 'amount', ''], ['', 'a', '5', ''], ['=HSTACK(1,2,3)', '', '', ''], ['', '', '', ''], ['', '', '', '']]);
	sheet.setMark('sales', { r0: 0, c0: 1, r1: 1, c1: 2 }, 'dataset');
	let before = JSON.stringify(sheet.serializeWorkbook());
	assert.throws(() => sheet.prepareMarkWrites([{ row: 0, col: 1, value: 'other' }]), /datasetcolumnrename/);
	assert.throws(() => sheet.prepareMarkWrites([{ row: 2, col: 1, value: 'b' }]), /blocked/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	sheet.rows[2][0] = ''; sheet.recalculate(); history.do(sheet);
	before = JSON.stringify(sheet.serializeWorkbook());
	assert.throws(() => sheet.prepareMarkWrites([{ row: 2, col: 1, value: 'b' }, { row: 4, col: 2, value: '29' }]), /skip/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	assert.deepEqual(sheet.prepareMarkWrites([{ row: 2, col: 1, value: '' }]), sheet.marks);
	assert.deepEqual(sheet.prepareMarkWrites([{ row: 3, col: 1, value: 'distant' }]), sheet.marks);
	const writes = [{ row: 2, col: 1, value: 'b' }, { row: 2, col: 2, value: '17' }, { row: 3, col: 1, value: '' }];
	const prepared = sheet.prepareMarkWrites(writes);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	// Exercise the agreed publication contract without duplicating fill's mutation API.
	for (const write of writes) sheet.rows[write.row][write.col] = write.value;
	sheet.workbook.marks = prepared; sheet.commitMarkedEdit(); history.do(sheet);
	assert.equal(sheet.describeDataset('sales').rowCount, 3);
	history.undo(sheet); assert.equal(sheet.describeDataset('sales').rowCount, 1); assert.equal(sheet.rows[2][2], '');
	history.redo(sheet); assert.equal(sheet.describeDataset('sales').rowCount, 3); assert.equal(sheet.rows[2][2], '17');
});

test('dataset schemas protect headers, rename only column tokens, and reject intersecting spills', () => {
	sheet.loadWorkbook([['item', 'amount', 'amount_extra', '=SUM(`sales.amount)+SUM(`sales.amount_extra)', ''], ['a', '5', '17', '=IF(TRUE,"`sales.amount",0)', ''], ['', '', '', '', ''], ['', '', '', '', '']]);
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 1, c1: 2 }, 'dataset');
	let message = '';
	const keyboard = new VimKeyboard(sheet, { message: text => { message = text; } });
	keyboard.register = { text: 'kept' }; keyboard.move({ row: 0, col: 1 });
	const before = JSON.stringify(sheet.serializeWorkbook());
	for (const keys of ['i', 'x', 'dd', 'p', '<CR>rX<Esc>']) keyboard.feed(keys);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	assert.equal(keyboard.register.text, 'kept'); assert.match(message, /headers/);
	assert.throws(() => sheet.setSpecFormula('renamed'), /datasetcolumnrename/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	sheet.renameDatasetColumn('SALES', 'AMOUNT', 'total');
	assert.equal(sheet.rows[0][1], 'total'); assert.equal(sheet.rows[0][3], '=SUM(`sales.total)+SUM(`sales.amount_extra)');
	assert.equal(sheet.rows[1][3], '=IF(TRUE,"`sales.amount",0)'); assert.equal(sheet.getValue(0, 3), 22);
	assert.throws(() => sheet.renameDatasetColumn('sales', 'total', 'ITEM'), /duplicate/);
	history.undo(sheet); assert.equal(sheet.rows[0][1], 'amount'); assert.equal(sheet.rows[0][3], '=SUM(`sales.amount)+SUM(`sales.amount_extra)');
	sheet.rows[1][1] = '=VSTACK(5,17)'; assert.equal(sheet.getValue(1, 1), '#SPILL!');
	sheet.rows[1][1] = '=SUM(`sales.amount)'; assert.match(sheet.getValue(1, 1), /circular/);
	sheet.rows[1][1] = '5';
	assert.throws(() => sheet.setMark('overlap', { r0: 0, c0: 1, r1: 1, c1: 1 }, 'dataset'), /overlap/);
	assert.throws(() => sheet.setMark('sales', { r0: 2, c0: 0, r1: 2, c1: 0 }), /dataset definition/);
});

test('structural edits shift and resize marks, preserve fixed schemas, and expose empty dataset bounds', () => {
	sheet.loadWorkbook([['item', 'amount', '', ''], ['a', '5', '', ''], ['b', '17', '', ''], ['', '', '', ''], ['', '', '', '']]);
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 2, c1: 1 }, 'dataset');
	sheet.setMark('fixed', { r0: 1, c0: 1, r1: 2, c1: 1 }, 'range');
	const keyboard = new VimKeyboard(sheet, { change: () => { history.do(sheet); sheet.recalculate(); } });
	keyboard.editColumns(0, 0, 1); keyboard.commit();
	assert.deepEqual(sheet.describeDataset('sales').columns, [{ name: 'item', col: 1 }, { name: 'amount', col: 2 }]);
	assert.equal(sheet.resolveMark('fixed').c0, 2);
	let before = JSON.stringify(sheet.serializeWorkbook());
	assert.throws(() => keyboard.editColumns(2, 0, 1), /fixed columns/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	keyboard.move({ row: 1, col: 1 }); keyboard.feed('O<Esc><Esc>');
	assert.equal(sheet.describeDataset('sales').rowCount, 3);
	assert.equal(sheet.resolveMark('fixed').r0, 2); assert.equal(sheet.resolveMark('fixed').r1, 3);
	keyboard.move({ row: 2, col: 0 }); keyboard.feed('O<Esc><Esc>');
	assert.equal(sheet.resolveMark('fixed').r0, 3); assert.equal(sheet.resolveMark('fixed').r1, 4);
	keyboard.move({ row: 4, col: 0 }); keyboard.feed('O<Esc><Esc>');
	assert.equal(sheet.resolveMark('fixed').r0, 3); assert.equal(sheet.resolveMark('fixed').r1, 5);
	keyboard.move({ row: 1, col: 0 }); keyboard.feed('5dd');
	assert.equal(sheet.describeDataset('sales').rowCount, 0);
	assert.equal(sheet.resolveMark('sales').height, 0); assert.equal(sheet.resolveMark('sales').r1, 0);
	assert.throws(() => sheet.resolveMark('fixed'), /#REF!/);
	sheet.rows[1][3] = '=SUM(`sales.amount)'; assert.equal(sheet.getValue(1, 3), '#CALC!');
	sheet.rows[1][3] = '=IFERROR(SUM(`sales.amount),23)'; assert.equal(sheet.getValue(1, 3), 23);
	before = JSON.stringify(sheet.serializeWorkbook());
	assert.throws(() => sheet.removeRowAtIndex(0), /header/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
});

test('v3 marks and schemas round-trip and malformed definitions leave live data/path/history intact', () => {
	sheet.loadWorkbook({ version: 2, sheets: [{ name: 'Data', rows: [['item', 'amount'], ['a', '5']], layout: { widths: [111, 222] } }], extension: { kept: true } });
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 1, c1: 1 }, 'dataset');
	const saved = JSON.parse(JSON.stringify(sheet.serializeWorkbook())); assert.equal(saved.version, 3);
	sheet.loadWorkbook(saved, '/keep.dflo');
	assert.deepEqual(sheet.serializeWorkbook(), saved);
	assert.deepEqual(sheet.describeDataset('sales').columns.map(item => item.name), ['item', 'amount']);
	for (const marks of [null, {}, [saved.marks[0], { ...saved.marks[0], name: 'SALES' }],
		[{ ...saved.marks[0], bounds: null }], [{ ...saved.marks[0], sheetName: 'Missing' }],
		[{ ...saved.marks[0], bounds: { r0: 0, c0: 0, r1: 9, c1: 1 } }]]) {
		assert.throws(() => sheet.loadWorkbook({ ...saved, marks }));
		assert.deepEqual(sheet.serializeWorkbook(), saved); assert.equal(sheet.path, '/keep.dflo');
	}
	const badHeaders = structuredClone(saved); badHeaders.sheets[0].rows[0] = ['item', 'ITEM'];
	assert.throws(() => sheet.loadWorkbook(badHeaders), /headers/);
	assert.deepEqual(sheet.serializeWorkbook(), saved);
	sheet.clearScreen(); assert.equal(sheet.marks.length, 0);
	history.undo(sheet); assert.deepEqual(sheet.serializeWorkbook(), saved);
});

test('mark keys, visual ranges, Ex commands and cross-sheet jumps use persistent workbook definitions', async () => {
	const command = new CheckCommand(); command.render = async () => {}; command.setPhMessage = text => { command.message = text; };
	command.keyboard = new VimKeyboard(sheet);
	command.keyboard.move({ row: 1, col: 1 }); command.keyboard.feed('ma');
	assert.equal(sheet.resolveMark('A').mode, 'cell');
	command.keyboard.move({ row: 0, col: 0 }); command.keyboard.feed('vjlmb<Esc>');
	assert.deepEqual([sheet.resolveMark('b').height, sheet.resolveMark('b').width], [2, 2]);
	await command.handleEnterFromCom(':mark tax_rate Sheet1!B0');
	assert.equal(sheet.resolveMark('tax_rate').c0, 1);
	await command.handleEnterFromCom(':marks'); assert.match(command.message, /tax_rate/);
	await command.handleEnterFromCom(':markrename tax_rate rate');
	sheet.createSheet('Report'); command.keyboard.move({ row: 3, col: 2 });
	command.keyboard.feed('`a'); assert.equal(sheet.activeSheet.name, 'Sheet1'); assert.deepEqual(command.keyboard.point, { row: 1, col: 1 });
	command.keyboard.feed('<C-o>'); assert.equal(sheet.activeSheet.name, 'Report'); assert.deepEqual(command.keyboard.point, { row: 3, col: 2 });
	command.keyboard.feed('<C-i>'); assert.equal(sheet.activeSheet.name, 'Sheet1');
	await command.handleEnterFromCom(':markgoto rate'); assert.deepEqual(command.keyboard.point, { row: 0, col: 1 });
	await command.handleEnterFromCom(':delmarks rate'); assert.throws(() => sheet.resolveMark('rate'), /#NAME\?/);
	const saved = JSON.parse(JSON.stringify(sheet.serializeWorkbook())); sheet.loadWorkbook(saved);
	command.keyboard.resetNavigation(); command.keyboard.feed('`a'); assert.deepEqual(command.keyboard.point, { row: 1, col: 1 });
});
