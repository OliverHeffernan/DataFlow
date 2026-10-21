import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { computed } from 'vue';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import VimKeyboard from './VimKeyboard.js';
import ConditionalSession from './ConditionalSession.js';
import CheckCommand from './CheckCommand.js';
import { compileConditionalRule } from './ConditionalFormatting.js';
import { formulaAssist } from './FormulaEditing.js';
import { keyboardHints } from './KeyboardHints.js';

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

test('omitted conditions colour every non-chart target, including blanks, errors and spill elements', () => {
	sheet.loadWorkbook({ rows: [
		['outside', '', '', '', '', 'outside'],
		['outside', '0', 'text', '', '=VSTACK(3,7)', 'outside'],
		['outside', '=1/0', '=CHART().line().series(B1:B1)', '=D2', '', 'outside'],
		['outside', '', '', '', '', 'outside'],
	] });
	sheet.setConditionalRules([{ id: 1, source: '=CF().range(B1:E2).bg("navy")' }]);
	assert.equal(result().typed[2][2].kind, 'chart');
	assert.deepEqual([...result().colors], [
		['1:1', { bg: 'navy' }], ['1:2', { bg: 'navy' }], ['1:3', { bg: 'navy' }], ['1:4', { bg: 'navy' }],
		['2:1', { bg: 'navy' }], ['2:3', { bg: 'navy' }], ['2:4', { bg: 'navy' }],
	]);
	assert.equal(result().ruleMatches.get(1), 7); assert.equal(result().ruleErrors.size, 0);
});

test('later matching rules override only their style properties and never change stored styling', () => {
	sheet.styles[0][0] = { fg: 'blue', bg: 'navy', wrap: true, align: 'right', format: { decimals: 2 } };
	const styles = JSON.stringify(sheet.styles), rows = JSON.stringify(sheet.rows);
	sheet.setConditionalRules([{ id: 1, source: '=CF().range(A0:B1).fg("red").bg("green").align("left")' }, rule(2, 'A0', 'TRUE', '.fg("white")'), rule(3, 'A0', 'FALSE', '.bg("black").align("right")'), { id: 4, source: '=CF().range(B1).align("auto")' }]);
	assert.deepEqual(result().colors.get('0:0'), { fg: 'white', bg: 'green', align: 'left' });
	assert.deepEqual(result().colors.get('1:0'), { fg: 'red', bg: 'green', align: 'left' });
	assert.deepEqual(result().colors.get('1:1'), { fg: 'red', bg: 'green', align: 'auto' });
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
	for (const predicate of ['', ' ', '1,2', '(', 'random()>0', 'IF(FALSE,random(),TRUE)', 'A{random()}>0', 'IF(FALSE,Missing!A{createUnit("smoot")},TRUE)', 'import("x")', 'map([1,2],abs)', 'TRUE;FALSE', 'sqrt.constructor("x")()']) {
		assert.throws(() => sheet.setConditionalRules([rule(2, 'A0', predicate)]), undefined, predicate);
		assert.equal(JSON.stringify({ rows: sheet.rows, styles: sheet.styles, rules: sheet.activeSheet.conditionalRules }), before);
	}
	for (const source of ['=CF().bg("navy")', '=CF().range(A0)', '=CF().range(A99).bg("navy")', '=CF().range(A0).bg("not-a-colour")']) assert.throws(() => sheet.setConditionalRules([{ id: 2, source }]));
	for (const rules of [[rule(1, 'A99', 'TRUE')], [rule(1, 'A0', 'TRUE'), rule(1, 'B0', 'TRUE')], [rule(2, 'A0', 'TRUE', '.bg("not-a-colour")')], [rule(2, 'A0', 'TRUE', '.width(80)')]]) assert.throws(() => sheet.setConditionalRules(rules));
	for (const style of ['.align("justify")', '.align("start")', '.align(right)', '.align("left","right")', '.align()']) assert.throws(() => sheet.setConditionalRules([rule(2, 'A0', 'TRUE', style)]));
	assert.equal(JSON.stringify({ rows: sheet.rows, styles: sheet.styles, rules: sheet.activeSheet.conditionalRules }), before);
});

test('target ranges follow keyboard row/column edits but predicate literals stay positional', () => {
	sheet.setConditionalRules([rule(1, 'B1:C2', 'A0>3'), { id: 2, source: '=CF().range(B1:C2).fg("gold")' }]);
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
	sheet.recalculate();
	assert.equal(result().ruleMatches.get(2), 12); assert.equal(result().ruleErrors.size, 0);
	assert.deepEqual([...result().colors.keys()], ['2:0', '2:1', '2:2', '2:3', '3:0', '3:1', '3:2', '3:3', '4:0', '4:1', '4:2', '4:3']);
	keyboard.move({ row: 2, col: 0 }); keyboard.feed('3dd');
	assert.deepEqual(sheet.activeSheet.conditionalRules, []);
});

test('draft Vim edits and undo are isolated until apply; stale rule drafts cannot overwrite another view', () => {
	sheet.loadWorkbook({ rows: [['item', 'count'], ['widget', '2']] });
	sheet.setMark('inventory', { r0: 0, c0: 0, r1: 1, c1: 1 }, 'dataset');
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

test('CF insert uses line-local carets, vertical movement and newlines without applying the rule', async () => {
	const check = Object.create(CheckCommand.prototype), pane = { sheet: sheet.activeSheet, content: 'cf', row: 0, col: 0 };
	pane.keyboard = new VimKeyboard(sheet, { key: key => check.ruleKey(key) });
	Object.assign(check, { sheet, currentWindow: pane, keyboard: pane.keyboard, render: async () => {}, focus() {}, setPhMessage() {} });
	await check.cfCommand('new');
	const session = check.rulesFor(), v = check.keyboard;
	v.feed('A<CR>');
	assert.equal(session.state.editing, true); assert.equal(session.rules.length, 0);
	assert.match(session.state.draft, /^=CF\(\)\n\n  \.range/);
	assert.deepEqual(v.point, { row: 1, col: 0 });
	v.feed('<Esc>'); assert.deepEqual(v.point, { row: 1, col: 0 });
	assert.ok(keyboardHints(v).some(hint => hint.key === 'Enter' && hint.description === 'Apply rule'));
	v.feed('i');
	assert.ok(keyboardHints(v).some(hint => hint.key === 'Enter' && hint.description === 'Newline'));
	v.feed('<Esc><CR>');
	assert.equal(session.state.editing, false); assert.equal(session.rules.length, 1);

	await check.cfCommand('edit', '1');
	v.feed('2jA<Up><Up>'); assert.deepEqual(v.point, { row: 0, col: 5 });
	v.feed('<Down><Down>'); assert.deepEqual(v.point, { row: 2, col: 15 });
	v.feed('<Home>'); assert.deepEqual(v.point, { row: 2, col: 0 });
	v.feed('<End>'); assert.deepEqual(v.point, { row: 2, col: 15 });
	v.feed('<C-h>'); assert.match(session.state.draft, /\.range\(A0:A0\n/);
	v.feed('<C-u>'); assert.match(session.state.draft, /^=CF\(\)\n\n\n  \.when/);
});

test('CF completion still owns arrows and Tab while ordinary Insert navigation preserves Unicode columns', () => {
	const session = new ConditionalSession(sheet, { sheet: sheet.activeSheet }, {});
	session.begin(null, { r0: 0, c0: 0, r1: 0, c1: 0 });
	session.editor.setFormula('=CF().\n123456789012345');
	const v = session.editor;
	v.feed('A<Down><Tab>'); assert.equal(session.state.draft, '=CF().when()\n123456789012345');
	v.feed('<Down>'); assert.deepEqual(v.point, { row: 1, col: 11 });
	session.editor.setFormula('😀abc\nx\n1234567'); v.formulaCursor = 0;
	v.feed('<Esc>gg3li<Down><Down>!<Home><Up>');
	assert.deepEqual(v.point, { row: 1, col: 0 });
	assert.equal(session.state.draft, '😀abc\nx\n123!4567');
	assert.equal(JSON.stringify(sheet.rows), JSON.stringify([['5', '4', '5', 'alpha'], ['8', '2', '5', 'alpha'], ['', '8', '3', 'beta'], ['bad', '4', '8', '']]));
});

test('CF joins and indentation compose with counts, motions, visual selections and repeat without yanking', () => {
	const session = new ConditionalSession(sheet, { sheet: sheet.activeSheet }, {});
	session.begin(null, { r0: 0, c0: 0, r1: 0, c1: 0 });
	const v = session.editor;
	v.setFormula('first\n  second\nthird\nfourth');
	v.register = { text: 'keep' };
	v.feed('2>>'); assert.equal(session.state.draft, '  first\n    second\nthird\nfourth');
	v.feed('j.'); assert.equal(session.state.draft, '  first\n      second\n  third\nfourth');
	v.feed('gg>2j'); assert.equal(session.state.draft, '    first\n        second\n    third\nfourth');
	v.feed('ggV2j2<'); assert.equal(session.state.draft, 'first\n    second\nthird\nfourth');
	assert.equal(v.mode, 'n'); assert.equal(v.register.text, 'keep');
	v.feed('3J'); assert.equal(session.state.draft, 'first second third\nfourth');
	v.feed('gJ'); assert.equal(session.state.draft, 'first second thirdfourth');
	v.feed('J'); assert.equal(session.state.draft, 'first second thirdfourth');
	v.setFormula('one\ntwo\nthree\nfour\nfive'); v.feed('ggVJ');
	assert.equal(session.state.draft, 'one two\nthree\nfour\nfive'); assert.equal(v.mode, 'n');
	v.feed('2jVkJgg.'); assert.equal(session.state.draft, 'one two three four\nfive');
	v.setFormula('one\ntwo\nthree\nfour'); v.feed('ggVj2>j.');
	assert.equal(session.state.draft, '    one\n        two\n    three\nfour');
	assert.equal(v.register.text, 'keep');
});

test('CF undo and redo restore edit locations and a reopened draft cannot repeat the previous draft edit', () => {
	sheet.setConditionalRules([rule(1, 'A0', 'TRUE')]);
	const session = new ConditionalSession(sheet, { sheet: sheet.activeSheet }, {});
	session.begin(1);
	const original = session.state.draft, v = session.editor;
	v.feed('A.name("Added")<Esc>ggu');
	assert.equal(session.state.draft, original); assert.equal(v.formulaCursor, original.length - 1);
	v.feed('gg<C-r>'); assert.equal(v.formulaCursor, original.length + 13);
	v.feed('uA.fg("gold")<Esc><C-r>');
	assert.equal(session.state.draft, original + '.fg("gold")');
	v.feed('ggVGcaaaa<Esc>0lxu');
	assert.equal(session.state.draft, 'aaaa'); assert.deepEqual(v.point, { row: 0, col: 1 });
	session.discard(); session.begin(1); v.feed('.');
	assert.equal(session.state.draft, original);
});

test('CF completion and signatures use the chart builder interaction without mixing their methods', () => {
	assert.deepEqual(formulaAssist('=CF().', 6, sheet, 'CF').suggestions, ['.range', '.when', '.fg', '.bg', '.name', '.align']);
	assert.equal(formulaAssist('=CF().when(C{}="Overdue",', 25, sheet, 'CF').signature.name, '.when');
	assert.deepEqual(formulaAssist('=CF().align(', 12, sheet, 'CF').signature.args, ['"auto" | "left" | "center" | "right"']);
	assert.deepEqual(formulaAssist('=CHART().a', 10).suggestions, []);
	assert.deepEqual(formulaAssist('=CHART().b', 10).suggestions, ['.bar']);
	assert.equal(formulaAssist('=CF().range(A0:B3).name(".b', 26, sheet, 'CF').suggestions.length, 0);
});

test('pane alignment edits remain draft-local, support text undo, and persist alignment-only rules through structural edits', () => {
	const history = new HistoryManager(), pane = { sheet: sheet.activeSheet };
	const source = '=CF().range(B1:C2).name("literal .align(\\"right\\")").align("center")';
	sheet.setConditionalRules([{ id: 1, source }]);
	const before = JSON.stringify(sheet.serializeWorkbook()), session = new ConditionalSession(sheet, pane, {});
	session.begin(1); session.editor.feed('$'); session.setAlignment('right');
	assert.equal(session.alignment, 'right'); assert.equal(JSON.stringify(sheet.serializeWorkbook()), before);
	session.editor.feed('u'); assert.equal(session.state.draft, source);
	assert.equal(session.editor.formulaCursor, source.length - 1);
	session.editor.feed('<C-r>'); assert.equal(compileConditionalRule(session.state.draft).colors.align, 'right');
	session.setAlignment(''); assert.equal(session.alignment, ''); assert.throws(() => session.apply(), /Add .fg/);
	session.setAlignment('auto'); session.apply();
	assert.deepEqual(result().colors.get('1:1'), { align: 'auto' });
	assert.equal(compileConditionalRule(sheet.activeSheet.conditionalRules[0].source).name, 'literal .align("right")');
	history.undo(sheet); assert.equal(sheet.activeSheet.conditionalRules[0].source, source);
	history.redo(sheet); sheet.adjustConditionalRules('row', 0, 0, 1);
	const saved = JSON.parse(JSON.stringify(sheet.serializeWorkbook())); sheet.loadWorkbook(saved);
	assert.deepEqual(result().colors.get('2:1'), { align: 'auto' });
	assert.equal(result().colors.has('1:1'), false);
	assert.equal(saved.sheets[0].conditionalRules[0].source.includes('.align("auto")'), true);
});

test('rules use chronological workbook history and round-trip metadata without sharing duplicate state', () => {
	const history = new HistoryManager(), first = { id: 1, source: '=CF().range(A0:B1).bg("navy")' };
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
	assert.deepEqual([...result().colors.keys()], ['0:0', '0:1', '1:0', '1:1']);
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
