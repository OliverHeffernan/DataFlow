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
