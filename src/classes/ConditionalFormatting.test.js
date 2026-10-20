import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { computed } from 'vue';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import VimKeyboard from './VimKeyboard.js';
import ConditionalSession from './ConditionalSession.js';
import { compileConditionalRule } from './ConditionalFormatting.js';
import { formulaAssist } from './FormulaEditing.js';

const sheet = new SheetManager();
sheet.loadAllCells = () => sheet.recalculate();
const result = () => sheet.sheetResults.value.get(sheet.activeSheet);
const rule = (id, range, predicate, style = '.bg("navy")') => ({ id, source: `=CF().range(${range}).when(${predicate})${style}` });
beforeEach(() => sheet.loadWorkbook({ rows: [['5', '4', '5', 'alpha'], ['8', '2', '5', 'alpha'], ['', '8', '3', 'beta'], ['bad', '4', '8', '']] }));

test('rules use per-target relative references, fixed cells and fresh cross-sheet typed values', () => {
	sheet.createSheet('Limits'); sheet.rows[0][0] = '6'; sheet.switchSheet(1);
	sheet.setConditionalRules([
		rule(1, 'A0:B3', 'AND(isNumeric(A{}), A{}>Limits!A0, []{}<A{})'),
		rule(2, 'D0:D3', 'B{}<A0', '.fg("gold")'),
		rule(3, 'C0:C3', '[-1]{}>5', '.fg("lime")'),
	]);
	assert.deepEqual([...result().colors], [['1:1', { bg: 'navy' }], ['0:3', { fg: 'gold' }], ['1:3', { fg: 'gold' }], ['3:3', { fg: 'gold' }], ['2:2', { fg: 'lime' }]]);
	sheet.sheets[1].rows[0][0] = '9'; sheet.recalculate();
	assert.equal(result().colors.has('1:1'), false);
	assert.equal(result().ruleErrors.size, 0);
	sheet.setConditionalRules([rule(4, 'D0:D3', 'AND([]{}<>"",COUNTIF(D0:D3,[]{})>1)')]);
	assert.deepEqual([...result().colors], [['0:3', { bg: 'navy' }], ['1:3', { bg: 'navy' }]]);
});

test('predicates distinguish decimal values that have the same displayed result', () => {
	sheet.rows[0] = ['=0.1+0.2', '=0.3+1e-25', '', 'text'];
	for (const col of [0, 1]) Object.assign(sheet.styles[0][col], { formatKind: 'number', formatDigits: 1 });
	sheet.setConditionalRules([rule(1, 'A0:D0', 'AND(isNumeric([]{}), []{}=0.3)')]);
	assert.deepEqual(result().values[0].slice(0, 2), [0.3, 0.3]);
	assert.deepEqual(result().presentation[0].slice(0, 2).map(cell => cell.text), ['0.3', '0.3']);
	assert.deepEqual([...result().colors], [['0:0', { bg: 'navy' }]]);
});

test('per-sheet formatting and FORMAT previews preserve exact predicate values, spills and other sheets', () => {
	sheet.loadWorkbook({ sheets: [
		{ name: 'Raw', rows: [['0.125', '=VSTACK(0.125,0.135)', '2026-10-20'], ['text', '', '=1/0']] },
		{ name: 'Report', rows: [['=Raw!A0', '=Raw!B1', ''], ['', '', '']] },
	] });
	const [raw, report] = sheet.sheets, history = new HistoryManager();
	Object.assign(raw.styles[0][0], { formatKind: 'number', formatPercent: true, formatDigits: 1 });
	Object.assign(raw.styles[1][1], { formatKind: 'number', formatPercent: true, formatDigits: 2 });
	Object.assign(raw.styles[0][2], { formatKind: 'date', formatPreset: 'long' });
	Object.assign(report.styles[0][0], { formatKind: 'currency', formatCurrency: 'USD', formatDigits: 2 });
	Object.assign(report.styles[0][1], { formatKind: 'number', formatDigits: 2 });
	sheet.setConditionalRules([rule(1, 'A0:C1', 'AND(isNumeric([]{}), []{}>0.13)')]);
	history.reset(sheet);
	const before = JSON.stringify(sheet.rows), snapshots = () => sheet.sheetResults.value;
	const rawResult = computed(() => sheet.sheetResults.value.get(raw));
	const shownSpill = computed(() => rawResult.value.presentation[1][1].text);
	assert.deepEqual(snapshots().get(raw).presentation[0].map(cell => cell.text), ['12.5%', '0.125', '20 Oct 2026']);
	assert.deepEqual(snapshots().get(report).presentation[0].map(cell => cell.text), ['USD 0.13', '0.14', '']);
	assert.equal(snapshots().get(raw).presentation[1][2].text, '#DIV/0!');
	assert.deepEqual(snapshots().get(raw).colors.get('1:1'), { bg: 'navy' });
	assert.equal(shownSpill.value, '13.50%');
	const keyboard = new VimKeyboard(sheet, { formatChange: () => history.do(sheet), window: () => sheet.switchSheet('Report') });
	keyboard.move({ row: 1, col: 1 }); keyboard.feed('gFd1<CR>');
	assert.equal(shownSpill.value, '13.5%');
	assert.equal(raw.styles[1][1].formatDigits, 2);
	assert.deepEqual(snapshots().get(raw).colors.get('1:1'), { bg: 'navy' });
	assert.equal(snapshots().get(report).presentation[0][1].text, '0.14');
	assert.equal(history.historyFor(sheet).undo.length, 1);
	keyboard.feed('<C-w>l');
	assert.equal(sheet.activeSheet.name, 'Report'); assert.equal(keyboard.formatSession, null);
	assert.equal(raw.styles[1][1].formatDigits, 1); assert.equal(report.styles[0][1].formatDigits, 2);
	assert.equal(history.historyFor(sheet).undo.length, 2);
	assert.equal(JSON.stringify(raw.rows), before);
	history.undo(sheet);
	assert.equal(sheet.sheetResults.value.get(sheet.sheets[0]).presentation[1][1].text, '13.50%');
	assert.equal(sheet.cellPresentation.value[0][0].text, 'USD 0.13');
});

test('later matching rules override only their colour channels and never change stored styling', () => {
	sheet.styles[0][0] = { fg: 'blue', bg: 'navy', wrap: true, align: 'right', format: { decimals: 2 } };
	const styles = JSON.stringify(sheet.styles), rows = JSON.stringify(sheet.rows);
	sheet.setConditionalRules([rule(1, 'A0:B1', 'TRUE', '.fg("red").bg("green")'), rule(2, 'A0', 'TRUE', '.fg("white")'), rule(3, 'A0', 'FALSE', '.bg("black")')]);
	assert.deepEqual(result().colors.get('0:0'), { fg: 'white', bg: 'green' });
	assert.deepEqual(result().colors.get('1:1'), { fg: 'red', bg: 'green' });
	assert.equal(JSON.stringify(sheet.styles), styles); assert.equal(JSON.stringify(sheet.rows), rows);
	sheet.setConditionalRules([]);
	assert.equal(result().colors.size, 0); assert.equal(JSON.stringify(sheet.styles), styles);
	sheet.resetAllStyles();
	assert.deepEqual(sheet.styles[0][0], { fg: 'white', bg: 'transparent', wrap: true, align: 'right', format: { decimals: 2 } });
	sheet.styles[1][0].fg = 'pink'; assert.equal(sheet.styles[0][0].fg, 'white');
});

test('spill elements, blanks, error-looking text and actual errors remain distinct; charts are skipped', () => {
	sheet.loadWorkbook({ rows: [
		['=VSTACK(3,7)', '=1/0', '#DIV/0!', '=CHART().line().series(A0:A1)'],
		['', '', '=B0+1', ''], ['', '=VSTACK(1,2)', '', ''], ['', 'occupied', '=C3', ''],
	] });
	sheet.setConditionalRules([
		rule(1, 'A0:D3', 'AND(isNumeric([]{}), []{}>=5)'),
		rule(2, 'A0:D3', 'IFERROR([]{}="#DIV/0!",FALSE)', '.fg("yellow")'),
		rule(3, 'B0', 'TRUE', '.bg("maroon")'),
	]);
	assert.equal(result().colors.has('0:0'), false); assert.deepEqual(result().colors.get('1:0'), { bg: 'navy' });
	assert.deepEqual(result().colors.get('0:2'), { fg: 'yellow' });
	assert.deepEqual(result().colors.get('0:1'), { bg: 'maroon' });
	assert.equal(result().colors.has('0:3'), false); assert.equal(result().colors.has('2:1'), false);
	assert.equal(result().ruleErrors.get(1).count, 4);
	assert.equal(result().ruleErrors.get(2).count, 1); // IFERROR cannot hide circular dependencies.
	assert.equal(result().ruleMatches.get(2), 1);
});

test('unsafe or malformed rules are rejected atomically, even in unused branches and reference offsets', () => {
	sheet.setConditionalRules([rule(1, 'A0', 'TRUE')]);
	const before = JSON.stringify({ rows: sheet.rows, styles: sheet.styles, rules: sheet.activeSheet.conditionalRules });
	for (const predicate of ['random()>0', 'IF(FALSE,random(),TRUE)', 'A{random()}>0', 'IF(FALSE,Missing!A{createUnit("smoot")},TRUE)', 'import("x")', 'map([1,2],abs)', 'TRUE;FALSE', 'sqrt.constructor("x")()']) {
		assert.throws(() => sheet.setConditionalRules([rule(2, 'A0', predicate)]), undefined, predicate);
		assert.equal(JSON.stringify({ rows: sheet.rows, styles: sheet.styles, rules: sheet.activeSheet.conditionalRules }), before);
	}
	for (const rules of [[rule(1, 'A99', 'TRUE')], [rule(1, 'A0', 'TRUE'), rule(1, 'B0', 'TRUE')], [rule(2, 'A0', 'TRUE', '.bg("not-a-colour")')], [rule(2, 'A0', 'TRUE', '.width(80)')]]) assert.throws(() => sheet.setConditionalRules(rules));
	assert.equal(JSON.stringify({ rows: sheet.rows, styles: sheet.styles, rules: sheet.activeSheet.conditionalRules }), before);
});

test('target ranges follow keyboard row/column edits but predicate literals stay positional', () => {
	sheet.setConditionalRules([rule(1, 'B1:C2', 'A0>3')]);
	const keyboard = new VimKeyboard(sheet, { change: () => sheet.recalculate() });
	keyboard.feed('o<Esc><Esc>');
	assert.deepEqual(compileConditionalRule(sheet.activeSheet.conditionalRules[0].source).range, { r0: 2, c0: 1, r1: 3, c1: 2 });
	keyboard.move({ row: 2, col: 0 }); keyboard.feed('o<Esc><Esc>');
	assert.deepEqual(compileConditionalRule(sheet.activeSheet.conditionalRules[0].source).range, { r0: 2, c0: 1, r1: 4, c1: 2 });
	keyboard.editColumns(2, 0, 2);
	assert.deepEqual(compileConditionalRule(sheet.activeSheet.conditionalRules[0].source).range, { r0: 2, c0: 1, r1: 4, c1: 4 });
	keyboard.editColumns(0, 1, 0);
	const compiled = compileConditionalRule(sheet.activeSheet.conditionalRules[0].source);
	assert.deepEqual(compiled.range, { r0: 2, c0: 0, r1: 4, c1: 3 }); assert.equal(compiled.predicate, 'A0>3');
	keyboard.move({ row: 2, col: 0 }); keyboard.feed('3dd');
	assert.deepEqual(sheet.activeSheet.conditionalRules, []);
});

test('draft Vim edits and undo are isolated until apply; stale rule drafts cannot overwrite another view', () => {
	const pane = { sheet: sheet.activeSheet }, session = new ConditionalSession(sheet, pane, {});
	session.begin(null, { r0: 0, c0: 0, r1: 1, c1: 1 });
	const initial = session.state.draft, cells = JSON.stringify(sheet.rows);
	session.editor.feed('gF<FormatOpen>');
	assert.equal(session.editor.formatSession, undefined); assert.equal(session.state.draft, initial);
	session.editor.feed('A.fg("gold")<Esc>');
	assert.notEqual(session.state.draft, initial); assert.equal(sheet.activeSheet.conditionalRules, undefined);
	session.editor.feed('u'); assert.equal(session.state.draft, initial);
	session.editor.feed('<C-r>'); assert.match(session.state.draft, /fg\("gold"\)/);
	assert.equal(JSON.stringify(sheet.rows), cells);
	session.apply(); assert.equal(sheet.activeSheet.conditionalRules.length, 1);
	const id = session.selected.id;
	session.begin(id); session.editor.feed('A.name("Changed")<Esc>');
	const other = new ConditionalSession(sheet, pane, {}); other.begin(id); other.editor.feed('A.name("Other")<Esc>'); other.apply();
	assert.throws(() => session.apply(), /another view/);
	assert.match(sheet.activeSheet.conditionalRules[0].source, /Other/);
	session.discard(); session.begin(id); pane.sheet = { ...sheet.activeSheet };
	assert.throws(() => session.apply(), /sheet was replaced/);
});

test('CF completion and signatures use the chart builder interaction without mixing their methods', () => {
	assert.deepEqual(formulaAssist('=CF().', 6, sheet, 'CF').suggestions, ['.range', '.when', '.fg', '.bg', '.name']);
	assert.equal(formulaAssist('=CF().when(C{}="Overdue",', 25, sheet, 'CF').signature.name, '.when');
	assert.deepEqual(formulaAssist('=CHART().b', 10).suggestions, ['.bar']);
	assert.equal(formulaAssist('=CF().range(A0:B3).name(".b', 26, sheet, 'CF').suggestions.length, 0);
});

test('rules use chronological workbook history and round-trip metadata without sharing duplicate state', () => {
	const history = new HistoryManager(), first = rule(1, 'A0:B1', '[]{}>4');
	sheet.activeSheet.layout = { widths: [91, 143] };
	sheet.styles[0][0].format = 'number';
	sheet.setConditionalRules([first]);
	sheet.createSheet('Other'); sheet.setConditionalRules([rule(1, 'C2', 'TRUE', '.fg("gold")')]);
	sheet.rows[0][0] = '11'; history.do(sheet);
	sheet.switchSheet(1); sheet.selRow = 3;
	history.undo(sheet);
	assert.equal(sheet.activeSheet.name, 'Sheet1'); assert.equal(sheet.selRow, 3);
	assert.equal(sheet.sheets[1].rows[0][0], ''); assert.equal(sheet.sheets[1].conditionalRules.length, 1);
	history.undo(sheet); assert.equal(sheet.sheets[1].conditionalRules, undefined);
	history.undo(sheet); assert.equal(sheet.sheets.length, 1); assert.deepEqual(sheet.activeSheet.conditionalRules, [first]);
	history.redo(sheet, 3); assert.equal(sheet.sheets[1].rows[0][0], '11');
	const saved = JSON.parse(JSON.stringify(sheet.serializeWorkbook()));
	sheet.loadWorkbook(saved);
	assert.deepEqual(sheet.activeSheet.conditionalRules, [first]);
	assert.deepEqual(sheet.activeSheet.layout, { widths: [91, 143] }); assert.equal(sheet.styles[0][0].format, 'number');
	assert.deepEqual([...result().colors.keys()], ['0:0', '1:0']);
	sheet.createSheet('Copy', true); sheet.activeSheet.conditionalRules[0].source = rule(1, 'A0', 'FALSE').source;
	sheet.activeSheet.layout.widths[0] = 250;
	assert.deepEqual(sheet.sheets[0].conditionalRules, [first]); assert.equal(sheet.sheets[0].layout.widths[0], 91);
	history.do(sheet); sheet.clearScreen(); assert.deepEqual(sheet.activeSheet.conditionalRules, []);
	history.undo(sheet); assert.match(sheet.activeSheet.conditionalRules[0].source, /FALSE/);
});

test('invalid saved rules reject the entire workbook before replacing live data, history or path', () => {
	const history = new HistoryManager();
	sheet.path = 'keep.dflo'; sheet.setConditionalRules([rule(1, 'A0', 'TRUE')]);
	const before = JSON.stringify(sheet.serializeWorkbook());
	for (const rules of [null, {}, [rule(1, 'A99', 'TRUE')], [rule(1, 'A0', 'random()>0')], [rule(1, 'A0', 'TRUE'), rule(1, 'B0', 'TRUE')]]) {
		assert.throws(() => sheet.loadWorkbook({ sheets: [{ name: 'Bad', rows: [['']], conditionalRules: rules }] }, 'bad.dflo'));
		assert.equal(JSON.stringify(sheet.serializeWorkbook()), before); assert.equal(sheet.path, 'keep.dflo');
	}
	history.undo(sheet); assert.equal(sheet.activeSheet.conditionalRules, undefined);
});

test('predicate marks, dataset columns, lookup and foreign references follow accepted rename and delete contracts', () => {
	const history = new HistoryManager();
	sheet.loadWorkbook({ sheets: [
		{ name: 'Inputs', rows: [['item', 'amount', 'limit'], ['alpha', '3', '4'], ['beta', '8', ''], ['', '', '']] },
		{ name: 'Report', rows: [['alpha', 'beta', ''], ['', '', '']] },
	] });
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 2, c1: 1 }, 'dataset');
	sheet.setMark('limit', { r0: 1, c0: 2, r1: 1, c1: 2 }); sheet.switchSheet('Report');
	sheet.setConditionalRules([{ id: 1, source: '=CF().name("Inputs!C1 `limit").range(A0:B0).when(LOOKUP([]{},`sales.item,`sales.amount)>`limit).bg("navy")' },
		rule(2, 'A1', 'Inputs!C1=4', '.fg("gold")')]);
	assert.deepEqual([...result().colors], [['0:1', { bg: 'navy' }], ['1:0', { fg: 'gold' }]]);
	assert.throws(() => sheet.deleteMark('limit'), /referenced/);
	sheet.renameMark('limit', 'floor'); sheet.renameDatasetColumn('sales', 'amount', 'total');
	assert.match(sheet.activeSheet.conditionalRules[0].source, /`sales.total\)>`floor/);
	assert.match(sheet.activeSheet.conditionalRules[0].source, /name\("Inputs!C1 `limit"\)/);
	sheet.switchSheet('Inputs'); sheet.renameSheet('Prices 2026'); sheet.switchSheet('Report');
	assert.match(sheet.activeSheet.conditionalRules[1].source, /'Prices 2026'!C1/);
	assert.deepEqual([...result().colors], [['0:1', { bg: 'navy' }], ['1:0', { fg: 'gold' }]]);
	sheet.deleteMark('floor', true); assert.equal(result().colors.has('0:1'), false);
	sheet.setMark('floor', { r0: 0, c0: 0, r1: 0, c1: 0 }); assert.equal(result().colors.has('0:1'), false);
	history.undo(sheet, 2); assert.equal(result().colors.has('0:1'), true);
	sheet.deleteSheet('Prices 2026', true); assert.equal(result().colors.size, 0);
	history.undo(sheet); assert.equal(result().colors.has('0:1'), true); assert.equal(result().colors.has('1:0'), true);
	const input = '=CF().when(`sales.to';
	assert.deepEqual(formulaAssist(input, input.length, sheet, 'CF').suggestions, ['`sales.total']);
});
