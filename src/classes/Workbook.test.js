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

test('lookups and joins consume cross-sheet spill arrays, survive history and reopen, and track renamed references', () => {
	const rows = () => Array.from({ length: 8 }, () => Array(14).fill(''));
	const prices = rows(), sales = rows(), report = rows();
	prices[0][0] = '=VSTACK("b","a")'; prices[0][1] = '=VSTACK(0.2,0.1)'; prices[0][2] = '=VSTACK("Bolt","Screw")';
	sales[0][0] = '=VSTACK("a","none","b","a")'; sales[0][1] = '=VSTACK(2,5,3,4)';
	report[0][0] = '=LOOKUP(Sales!A0, \'Prices 2026\'!A0, \'Prices 2026\'!B0, 0)';
	report[0][3] = '=JOIN(Sales!A0:B3, Sales!A0, \'Prices 2026\'!B0:C1, \'Prices 2026\'!A0)';
	report[0][10] = '=LOOKUP("b", \'Prices 2026\'!A0:A0, \'Prices 2026\'!B0:B0)';
	report[1][10] = '=LOOKUP("b", \'Prices 2026\'!A0, \'Prices 2026\'!B0, Missing!A0)';
	report[4][10] = '=LOOKUP("a", \'Prices 2026\'![-10]{-4}:[-10]{-3}, \'Prices 2026\'![-9]{-4}:[-9]{-3})';
	sheet.loadWorkbook({ sheets: [{ name: 'Prices 2026', rows: prices }, { name: 'Sales', rows: sales }, { name: 'Report', rows: report }], activeSheet: 2 });
	const stored = JSON.stringify(sheet.serializeWorkbook());
	assert.deepEqual(sheet.getValue(0, 0), [[0.1], [0], [0.2], [0.1]]);
	assert.deepEqual(sheet.getValue(0, 3), [['a', 2, 0.1, 'Screw'], ['none', 5, '', ''], ['b', 3, 0.2, 'Bolt'], ['a', 4, 0.1, 'Screw']]);
	assert.deepEqual([sheet.getValue(0, 10), sheet.getValue(1, 10), sheet.getValue(4, 10)], [0.2, 0.2, 0.1]);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), stored);

	sheet.rows[0][0] = '=LOOKUP("b", \'Prices 2026\'!A0, \'Prices 2026\'!B0)'; history.do(sheet);
	assert.equal(sheet.getValue(0, 0), 0.2);
	history.undo(sheet); assert.deepEqual(sheet.getValue(0, 0), [[0.1], [0], [0.2], [0.1]]);
	history.redo(sheet); assert.equal(sheet.getValue(0, 0), 0.2);
	history.undo(sheet);
	sheet.sheets[0].rows[0][1] = '=VSTACK(0.25,0.125)';
	assert.deepEqual(sheet.getValue(0, 0), [[0.125], [0], [0.25], [0.125]]);
	sheet.switchSheet('Prices 2026'); sheet.renameSheet("O'Brien 2026"); sheet.switchSheet('Report');
	assert.ok(sheet.rows[0][0].includes("'O''Brien 2026'!"));
	sheet.loadWorkbook(sheet.serializeWorkbook());
	assert.deepEqual(sheet.getValue(0, 0), [[0.125], [0], [0.25], [0.125]]);
	sheet.deleteSheet("O'Brien 2026", true);
	assert.equal(sheet.getValue(0, 0), '#REF!');
	assert.equal(sheet.getValue(0, 3), '#REF!');
});

test('named datasets preserve exact lookup/join keys through fill growth, workbook undo and reopen', () => {
	const { keyboard } = rangeKeyboard([['']]);
	const rows = () => Array.from({ length: 8 }, () => Array(6).fill(''));
	const products = rows(), orders = rows(), report = rows();
	products[0].splice(0, 2, 'key', 'amount'); orders[0].splice(0, 2, 'key', 'qty');
	[['9007199254740991', '10'], ['9007199254740992', '20'], ['9007199254740993', '30']]
		.forEach((row, i) => products[i + 1].splice(0, 2, ...row));
	[['9007199254740993', '2'], ['9007199254740994', '9'], ['9007199254740992', '3'], ['9007199254740991', '4']]
		.forEach((row, i) => orders[i + 1].splice(0, 2, ...row));
	report[0][0] = '=LOOKUP(`orders.key,`products.key,`products.amount,-1)';
	report[0][2] = '=JOIN(`orders.qty,`orders.key,`products.amount,`products.key)';
	sheet.loadWorkbook({ sheets: [{ name: 'Products', rows: products }, { name: 'Orders', rows: orders }, { name: 'Report', rows: report }] });
	sheet.setMark('products', { r0: 0, c0: 0, r1: 3, c1: 1 }, 'dataset');
	sheet.setMark('orders', { r0: 0, c0: 0, r1: 4, c1: 1 }, 'dataset', 'Orders');
	const expectResults = expanded => {
		assert.deepEqual(sheet.getValue(0, 0), [[30], [expanded ? 31 : -1], [20], [10]]);
		assert.deepEqual(sheet.getValue(0, 2), [[2, 30], [9, expanded ? 31 : ''], [3, 20], [4, 10]]);
	};
	sheet.switchSheet('Report'); expectResults(false);
	sheet.switchSheet('Products'); keyboard.move({ row: 3, col: 0 });
	keyboard.feed('vlj:series down step 1<CR>');
	assert.deepEqual(sheet.rows[4].slice(0, 2), ['9007199254740994', '31']);
	assert.equal(sheet.describeDataset('products').rowCount, 4);
	sheet.switchSheet('Report'); expectResults(true);
	keyboard.feed('u');
	assert.equal(sheet.activeSheet.name, 'Report');
	assert.equal(sheet.describeDataset('products').rowCount, 3); expectResults(false);
	keyboard.feed('<C-r>'); expectResults(true);
	sheet.loadWorkbook(JSON.parse(JSON.stringify(sheet.serializeWorkbook())));
	assert.equal(sheet.describeDataset('products').rowCount, 4); expectResults(true);
	sheet.renameMark('products', 'catalog');
	sheet.renameDatasetColumn('catalog', 'amount', 'cost');
	assert.ok(sheet.rows[0][0].includes('`catalog.cost')); expectResults(true);
	history.undo(sheet, 2);
	assert.ok(sheet.rows[0][0].includes('`products.amount')); expectResults(true);
	history.redo(sheet, 2);
	sheet.deleteMark('catalog', true);
	assert.equal(sheet.getValue(0, 0), '#REF!'); assert.equal(sheet.getValue(0, 2), '#REF!');
	history.undo(sheet); expectResults(true);
});

test('lookup and join cross-sheet cycles cannot be hidden by defaults or IFERROR', () => {
	for (const formula of ['=IFERROR(LOOKUP(1,1,B!A0,0),0)', '=IFERROR(JOIN(7,1,B!A0,1),0)']) {
		sheet.loadWorkbook({ sheets: [
			{ name: 'A', rows: [[formula, ''], ['', '']] },
			{ name: 'B', rows: [['=A!A0', ''], ['', '']] },
		] });
		for (const name of ['A', 'B']) {
			sheet.switchSheet(name);
			assert.match(sheet.getValue(0, 0), /circular/);
			assert.match(sheet.recalculate()[0][0], /circular/);
		}
	}
	// The join's right payload depends on its own second output row through the other sheet.
	sheet.sheets[0].rows[0][0] = '=JOIN(VSTACK(1,2),VSTACK(1,2),VSTACK(3,B!A0),VSTACK(1,2))';
	sheet.sheets[1].rows[0][0] = '=A!B1';
	sheet.switchSheet('A');
	assert.equal(sheet.getValue(0, 0), '#SPILL!');
	assert.equal(sheet.recalculate()[0][0], '#SPILL!');
	assert.match(sheet.cellErrors.get('0:0'), /spill cycle/);
});

test('row streams retain lazy foreign and relative reads, named ranges and object tables across rename and reopen', () => {
	const report = Array.from({ length: 6 }, () => Array(6).fill(''));
	report[0][0] = '=rowstream(`people).map(a->{name:a.name,age:a.age}).toTable()';
	report[0][3] = '=rowstream(\'People 2026\'!A0:B2).map(a->a.age).sum()';
	report[1][3] = '=rowstream(\'People 2026\'![-3]{0}:[-2]{2}).map(a->a.age).sum()';
	report[2][3] = '=rowstream(\'People 2026\'!A0:B3).anyMatch(a->a.name="John")';
	report[3][3] = '=SUM(B1:B2)';
	sheet.loadWorkbook({ sheets: [
		{ name: 'People 2026', rows: [['name', 'age'], ['John', '0.1'], ['Mary', '0.2'], ['Later', '=1/0']] },
		{ name: 'Report', rows: report },
	], activeSheet: 1 });
	sheet.setMark('people', { r0: 0, c0: 0, r1: 2, c1: 1 }, 'range', 'People 2026');
	assert.deepEqual(sheet.getValue(0, 0), [['name', 'age'], ['John', 0.1], ['Mary', 0.2]]);
	assert.deepEqual([0, 1, 2, 3].map(row => sheet.getValue(row, 3)), [0.3, 0.3, true, 0.3]);
	sheet.switchSheet('People 2026'); sheet.renameSheet("O'Brien"); sheet.switchSheet('Report');
	assert.match(sheet.rows[0][3], /'O''Brien'!/);
	sheet.loadWorkbook(JSON.parse(JSON.stringify(sheet.serializeWorkbook())));
	assert.deepEqual(sheet.getValue(0, 0), [['name', 'age'], ['John', 0.1], ['Mary', 0.2]]);
	assert.deepEqual([0, 1, 2, 3].map(row => sheet.getValue(row, 3)), [0.3, 0.3, true, 0.3]);
	assert.equal(sheet.rows[1][0], '');
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
	assert.throws(() => sheet.applyRangeEdit([{ row: 0, col: 1, value: 'other' }]), /datasetcolumnrename/);
	assert.throws(() => sheet.prepareMarkWrites([{ row: 2, col: 1, value: 'b' }]), /blocked/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	sheet.rows[2][0] = ''; sheet.recalculate(); history.do(sheet);
	before = JSON.stringify(sheet.serializeWorkbook());
	assert.throws(() => sheet.prepareMarkWrites([{ row: 2, col: 1, value: 'b' }, { row: 4, col: 2, value: '29' }]), /skip/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	assert.deepEqual(sheet.prepareMarkWrites([{ row: 2, col: 1, value: '' }]), sheet.marks);
	assert.deepEqual(sheet.prepareMarkWrites([{ row: 3, col: 1, value: 'distant' }]), sheet.marks);
	const writes = [{ row: 2, col: 1, value: 'b' }, { row: 2, col: 2, value: '17' }, { row: 3, col: 1, value: '' }];
	sheet.prepareMarkWrites(writes);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	assert.equal(sheet.applyRangeEdit(writes), true);
	sheet.commitMarkedEdit(); history.do(sheet);
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

function rangeKeyboard(rows) {
	sheet.loadWorkbook(rows);
	const messages = [], command = new CheckCommand();
	command.render = async () => {}; command.setPhMessage = text => messages.push(text);
	const keyboard = new VimKeyboard(sheet, {
		change: () => history.do(sheet),
		undo: (redo, count) => history[redo ? 'redo' : 'undo'](sheet, count),
		message: text => messages.push(text),
		ex: text => command.handleEnterFromCom(text),
	});
	command.keyboard = keyboard;
	return { keyboard, messages };
}

test('directional fill uses normalized source edges for rectangular, block and full-row selections', () => {
	for (const [keys, expected, point] of [
		['v2j2lgJ', [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']], { row: 2, col: 0 }],
		['2j2lv2k2hogK', [['g', 'h', 'i'], ['g', 'h', 'i'], ['g', 'h', 'i']], { row: 0, col: 0 }],
		['<C-v>2j2lgL', [['a', 'a', 'a'], ['d', 'd', 'd'], ['g', 'g', 'g']], { row: 0, col: 2 }],
		['v2j2logH', [['c', 'c', 'c'], ['f', 'f', 'f'], ['i', 'i', 'i']], { row: 0, col: 0 }],
		['lV2jgJ', [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']], { row: 2, col: 0 }],
	]) {
		const { keyboard } = rangeKeyboard([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
		sheet.styles[1][1].bg = 'navy'; history.reset(sheet);
		keyboard.register = { cells: [['keep']], text: 'keep' };
		const before = JSON.stringify(sheet.serializeWorkbook());
		keyboard.feed(keys);
		assert.deepEqual(sheet.rows, expected, keys);
		assert.deepEqual(keyboard.point, point); assert.equal(keyboard.mode, 'n');
		assert.equal(keyboard.register.text, 'keep'); assert.equal(sheet.styles[1][1].bg, 'navy');
		keyboard.feed('u'); assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
		keyboard.feed('<C-r>'); assert.deepEqual(sheet.rows, expected);
		keyboard.feed('gv'); assert.ok(keyboard.anchor); assert.equal(keyboard.mode, keys.includes('V') ? 'V' : keys.includes('<C-v>') ? 'b' : 'v');
	}
});

test('fill counts extend from one seed and failed or unchanged fills preserve the previous repeat and redo', () => {
	const { keyboard, messages } = rangeKeyboard([['seed', '', 'other'], ['old', '', ''], ['last', '', ''], ['', '', '']]);
	keyboard.feed('2gJ'); assert.deepEqual(sheet.rows.map(row => row[0]), ['seed', 'seed', 'seed', '']);
	keyboard.feed('ugg0');
	for (const keys of ['4gJ', '10001gJ', 'gK', 'vgJ', '<Esc>v2j2gJ']) {
		const before = JSON.stringify(sheet.serializeWorkbook()), point = keyboard.point;
		keyboard.feed(keys);
		assert.equal(JSON.stringify(sheet.serializeWorkbook()), before, keys);
		// Selection motions may move the cursor, but rejected fill itself never redirects to a source.
		if (!keys.includes('v')) assert.deepEqual(keyboard.point, point);
	}
	assert.match(messages.join(' '), /outside the sheet/); assert.match(messages.join(' '), /omit the count/);
	keyboard.feed('<Esc><C-r>'); assert.equal(sheet.rows[2][0], 'seed');
	keyboard.feed('gg0gJ'); assert.equal(messages.at(-1), 'Fill unchanged');
	keyboard.feed('2l.'); assert.deepEqual(sheet.rows.slice(0, 3).map(row => row[2]), ['other', 'other', 'other']);
	keyboard.feed('gg0<CR>gJ'); assert.equal(keyboard.context, 'formula'); assert.match(messages.at(-1), /sheet-only/);

	const blank = rangeKeyboard([['', 'keep', 'keep'], ['below', '', '']]).keyboard;
	blank.feed('2gL'); assert.deepEqual(sheet.rows[0], ['', '', '']);
	blank.feed('u'); assert.deepEqual(sheet.rows[0], ['', 'keep', 'keep']);
	const failed = rangeKeyboard([['3', 'keep', 'tail'], ['below', '', '']]).keyboard;
	failed.feed(':series down step nope<CR>xl.'); assert.deepEqual(sheet.rows[0], ['', '', 'tail']);
	failed.feed('u'); assert.deepEqual(sheet.rows[0], ['', 'keep', 'tail']);
});

test('fill and put preserve formula text while explicit relative and calculated references re-evaluate at destinations', () => {
	for (const [formula, expected] of [
		['=A0', [3, 3]], ['=[-1]{}', [11, 29]], ['=A{}', [11, 29]],
		['=[0]0', [3, 3]], ['=SUM(A0:A{-1})', [3, 14]], ['="A0 [-1]{}"', ['A0 [-1]{}', 'A0 [-1]{}']],
	]) {
		const { keyboard } = rangeKeyboard([['3', '', ''], ['11', formula, ''], ['29', '', '']]);
		keyboard.feed('jlyicgJ');
		assert.deepEqual([sheet.getValue(1, 1), sheet.getValue(2, 1)], expected, formula);
		assert.equal(sheet.rows[2][1], formula);
		keyboard.feed('lp'); assert.equal(sheet.rows[2][2], formula);
	}
	const { keyboard } = rangeKeyboard([['3', '8', ''], ['11', '=[-1]{}+1', ''], ['29', '', '']]);
	keyboard.feed('jlgL');
	assert.equal(sheet.getValue(1, 2), 13); // B1 = 12; C1 reads B1, not A1.
	keyboard.feed('jlgL'); assert.equal(sheet.rows[2][2], ''); // rejected at the right edge

	sheet.renameSheet('Inputs'); sheet.createSheet('Report');
	[sheet.rows[0][0], sheet.rows[1][0], sheet.rows[2][0]] = ['1000', '101', '307'];
	for (const [formula, expected] of [['=Inputs!A0', [3, 3]], ["='Inputs'![-1]{}", [11, 29]], ['=SUM(Inputs!A0:A{-1})', [3, 14]]]) {
		sheet.rows[1][1] = formula; sheet.rows[2][1] = ''; history.reset(sheet);
		keyboard.resetNavigation(); keyboard.feed('jlgJ');
		assert.equal(sheet.rows[2][1], formula);
		assert.deepEqual([sheet.getValue(1, 1), sheet.getValue(2, 1)], expected, formula);
		keyboard.feed('u'); assert.equal(sheet.rows[2][1], ''); assert.equal(sheet.sheets[0].rows[1][0], '11');
	}
});

test('numeric series use independent decimal lanes, explicit steps and travel order without guessing formulas or dates', () => {
	const { keyboard, messages } = rangeKeyboard([['0.1', '1000000000000000.1', ''], ['', '', ''], ['', '', ''], ['', '', '']]);
	keyboard.feed('vl2j:series down step 0.1<CR>');
	assert.deepEqual(sheet.rows.slice(0, 3).map(row => row.slice(0, 2)), [
		['0.1', '1000000000000000.1'], ['0.2', '1000000000000000.2'], ['0.3', '1000000000000000.3'],
	]);
	keyboard.feed('u'); assert.equal(sheet.rows[1][0], ''); assert.equal(sheet.rows[1][1], '');
	keyboard.feed('<C-r>l:series up 2 step -0.5<CR>');
	assert.deepEqual(sheet.rows.slice(0, 3).map(row => row[1]), ['999999999999999.3', '999999999999999.8', '1000000000000000.3']);
	keyboard.feed('2j0:series right 2 step 2e-1<CR>');
	assert.deepEqual(sheet.rows[2], ['0.3', '0.5', '0.7']);
	for (const text of [':series down 0', ':series down 1 step Infinity', ':series down 1 step NaN', ':series down 1 step 1+2', ':fill down step 2', ':fill! down', ':series down 2 unit day']) {
		const before = JSON.stringify(sheet.serializeWorkbook()); keyboard.feed(`${text}<CR>`);
		assert.equal(JSON.stringify(sheet.serializeWorkbook()), before, text);
	}
	assert.ok(messages.length >= 7);
	for (const seed of ['', '=10', 'TRUE', '2026-10-20', 'Infinity', 'label']) {
		const { keyboard: invalid } = rangeKeyboard([['2', seed], ['old', 'keep']]);
		invalid.feed('vlj:series down<CR>');
		assert.deepEqual(sheet.rows, [['2', seed], ['old', 'keep']], seed); // no partial first lane
	}
	const zero = rangeKeyboard([['2', 'old', '10'], ['old', 'old', 'old']]).keyboard;
	zero.feed(':series down step 0<CR>'); assert.equal(sheet.rows[1][0], '2');
	zero.feed('k2l:series left 2<CR>'); assert.deepEqual(sheet.rows[0], ['12', '11', '10']);
	const overflow = rangeKeyboard([['9e9000000000000000', 'keep']]);
	overflow.keyboard.feed(':series right step 9e9000000000000000<CR>');
	assert.equal(sheet.rows[0][1], 'keep'); assert.match(overflow.messages.at(-1), /result must be finite/);
});

test('visual fill repeat retains its shape but reads fresh seeds, also after switching sheets or replacing the repeat', () => {
	const { keyboard } = rangeKeyboard([['a', 'b', '', 'x', 'y'], ['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']]);
	keyboard.feed('vljgJgg3l.');
	assert.deepEqual(sheet.rows[1], ['a', 'b', '', 'x', 'y']);
	keyboard.feed('2.'); assert.deepEqual(sheet.rows[3], ['', '', '', 'x', 'y']);
	keyboard.feed('u'); assert.equal(sheet.rows[3][3], ''); assert.equal(sheet.rows[2][3], 'x');
	sheet.createSheet('Other'); sheet.rows[0][0] = 'new'; sheet.rows[0][1] = 'seeds'; history.reset(sheet);
	keyboard.resetNavigation(); keyboard.feed('.'); assert.deepEqual(sheet.rows[1].slice(0, 2), ['new', 'seeds']);
	keyboard.feed('2jcictext<CR>j.'); assert.equal(sheet.rows[4][0], 'text');
});

test('Lua mappings and macros execute native fills and Ex series synchronously, with one undo per invocation', () => {
	const { keyboard } = rangeKeyboard([['10', '50', ''], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']]);
	keyboard.mappings = compileConfig(`vim.keymap.set('n', 'Q', ':series down 2 step 3<CR>')
vim.keymap.set('x', 'F', 'gJ')`).mappings;
	keyboard.feed('qaQq@a'); assert.deepEqual(sheet.rows.map(row => row[0]), ['10', '13', '16', '19', '22', '', '']);
	keyboard.feed('u'); assert.deepEqual(sheet.rows.map(row => row[0]), ['10', '13', '16', '', '', '', '']);
	keyboard.feed('<C-r>.'); assert.deepEqual(sheet.rows.map(row => row[0]), ['10', '13', '16', '19', '22', '25', '28']);
	keyboard.feed('gglv2jF'); assert.deepEqual(sheet.rows.slice(0, 3).map(row => row[1]), ['50', '50', '50']);
	keyboard.feed('qbgJq@b'); assert.equal(sheet.rows[4][1], '50');
});

test('range edits reject spill sources and children atomically using fresh ownership, without redirecting the cursor', () => {
	for (const [start, keys] of [[{ row: 0, col: 1 }, 'gL'], [{ row: 1, col: 1 }, 'gL'], [{ row: 1, col: 0 }, '2gL'], [{ row: 0, col: 0 }, 'v2l2jgJ']]) {
		const { keyboard, messages } = rangeKeyboard([['7', '=VSTACK(11,29)', ''], ['8', '', ''], ['', '', '']]);
		keyboard.move(start); const before = JSON.stringify(sheet.serializeWorkbook());
		keyboard.feed(keys);
		assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
		assert.match(messages.at(-1), /intersects spill B0/);
		if (!keys.includes('v')) assert.deepEqual(keyboard.point, start);
	}
	const { keyboard, messages } = rangeKeyboard([['=IF(THISROW=0,1,VSTACK(7,9))', ''], ['', ''], ['', ''], ['', '']]);
	keyboard.feed('qagJgJq');
	assert.equal(sheet.rows[1][0], '=IF(THISROW=0,1,VSTACK(7,9))');
	assert.equal(sheet.rows[2][0], ''); assert.match(messages.at(-1), /intersects spill A1/);
	assert.deepEqual(keyboard.point, { row: 1, col: 0 });
	keyboard.feed('u'); assert.equal(sheet.rows[1][0], '');

	const blocked = rangeKeyboard([['=IF(THISROW=0,1,VSTACK(7,9))'], [''], ['keep']]).keyboard;
	blocked.feed('gJ'); sheet.recalculate();
	assert.equal(sheet.getValue(1, 0), '#SPILL!'); assert.equal(sheet.rows[2][0], 'keep');
});

test('range-write API validates the full staged write set without owning history, cursor or styles', () => {
	rangeKeyboard([['keep', 'other'], ['below', 'last']]);
	assert.throws(() => sheet.applyRangeEdit([{ row: 0, col: 0, value: 'changed' }, { row: 9, col: 1, value: 'outside' }]), /outside/);
	assert.equal(sheet.rows[0][0], 'keep');
	assert.throws(() => sheet.applyRangeEdit([{ row: 0, col: 0, value: 'changed' }, { row: 1, col: 1, value: 12 }]), /raw string/);
	assert.throws(() => sheet.applyRangeEdit([{ row: 0, col: 0, value: 'changed' }, { row: 0, col: 0, value: 'keep' }]), /Duplicate/);
	assert.equal(sheet.rows[0][0], 'keep'); assert.equal(sheet.rows[1][1], 'last');
	assert.equal(sheet.applyRangeEdit([{ row: 0, col: 0, value: 'keep' }]), false);
	assert.equal(sheet.applyRangeEdit([{ row: 1, col: 1, value: 'changed' }]), true);
	assert.deepEqual([sheet.selRow, sheet.selCol], [0, 0]);
	assert.equal(sheet.styles[1][1].fg, 'white');
	history.do(sheet); history.undo(sheet); assert.equal(sheet.rows[1][1], 'last');
});

test('fill and dataset growth share atomic publication, no-op rejection and chronological undo', () => {
	const { keyboard, messages } = rangeKeyboard([
		['item', 'amount', '', '=SUM(`sales.amount)'], ['a', '5', '', ''],
		['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '91', '', ''],
	]);
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 1, c1: 1 }, 'dataset');
	const original = JSON.stringify(sheet.serializeWorkbook());
	assert.equal(sheet.applyRangeEdit([{ row: 1, col: 1, value: '5' }, { row: 2, col: 1, value: '' }]), false);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), original);
	keyboard.move({ row: 1, col: 1 }); keyboard.feed(':series down 2 step 12<CR>');
	assert.equal(sheet.describeDataset('sales').rowCount, 3); assert.equal(sheet.getValue(0, 3), 51);
	assert.deepEqual(sheet.rows.slice(1, 4).map(row => row[1]), ['5', '17', '29']);
	const expanded = JSON.stringify(sheet.serializeWorkbook()), repeat = keyboard.lastChange;
	keyboard.feed(':series down 2 step 12<CR>');
	assert.match(messages.at(-1), /blocked/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), expanded); assert.equal(keyboard.lastChange, repeat);
	keyboard.move({ row: 1, col: 1 }); keyboard.feed(':fill up<CR>');
	assert.match(messages.at(-1), /datasetcolumnrename/);
	assert.equal(JSON.stringify(sheet.serializeWorkbook()), expanded);
	keyboard.feed('u'); assert.equal(JSON.stringify(sheet.serializeWorkbook()), original);
	keyboard.feed('<C-r>'); assert.equal(JSON.stringify(sheet.serializeWorkbook()), expanded);
});
