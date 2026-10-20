import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import CheckCommand from './CheckCommand.js';
import WindowManager from './WindowManager.js';
import VimKeyboard from './VimKeyboard.js';
import { captureScriptWorkbook, executeWorkbookScript, publishWorkbookScript } from './WorkbookScript.js';

const sheet = new SheetManager(), history = new HistoryManager();
// Keep the real loadAllCells/cache install path; only renderer effects are stubbed.
sheet.loadStyles = () => {};
sheet.clearPlaceholder = () => {};
globalThis.window = {};
const grid = (name, rows) => ({ name, rows });
beforeEach(() => {
	sheet.loadWorkbook({ sheets: [
		grid('Inputs', [['9007199254740993.125', '2', ''], ['7', '5', ''], ['', '', ''], ['', '', '']]),
		grid('Report', [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']]),
	] });
	sheet.path = '/keep.dflo';
});
const capture = () => captureScriptWorkbook(sheet, { sheetName: 'Inputs', selection: { r0: 0, c0: 0, r1: 1, c1: 1 } });
const content = () => JSON.stringify(sheet.serializeWorkbook());
function run(source, request = capture()) {
	const result = executeWorkbookScript({ ...request, source });
	return { changed: publishWorkbookScript(sheet, request, structuredClone(result)), result };
}

test('cross-sheet exact reads, read-your-writes and dataset growth publish as one chronological undo', () => {
	sheet.workbook.acceptedMetadata = { preserve: ['workbook'] };
	sheet.sheets[1].acceptedMetadata = { preserve: ['sheet'] };
	sheet.styles[0][0] = { fg: 'white', bg: 'transparent', formatKind: 'number', formatDigits: 3, formatGroup: true };
	sheet.sheets[1].styles[0][1] = { fg: 'orange', bg: 'navy', formatKind: 'currency', formatDigits: 3, formatCurrency: 'USD' };
	sheet.sheets[1].conditionalRules = [{ id: 1, source: '=CF().range(A0:B1).when(AND(isNumeric([]{}), []{}>3)).fg("lime")' }];
	sheet.rows[2][0] = 'amount'; sheet.rows[3][0] = '';
	sheet.setMark('sales', { r0: 2, c0: 0, r1: 2, c1: 0 }, 'dataset');
	const before = content();
	const { changed, result } = run(`
local src = df.selection():read_values()
df.sheet('Report'):range('A0:B1'):write_values(src)
df.active_sheet():range('A3'):write_values({{src[1][1]}})
assert(df.named('sales.amount'):read_values()[1][1].decimal == '9007199254740993.125')
df.sheet('Report'):range('C2'):write_raw({{'=Inputs!B0*Inputs!B1'}})
df.log(df.sheet('Report'):range('C2'):read_values()[1][1].decimal)
`);
	assert.equal(changed, true); assert.deepEqual(result.logs, ['10']);
	assert.equal(sheet.sheets[1].rows[0][0], '9007199254740993.125');
	assert.equal(sheet.describeDataset('sales').rowCount, 1);
	assert.deepEqual(sheet.workbook.acceptedMetadata, { preserve: ['workbook'] });
	assert.deepEqual(sheet.sheets[1].acceptedMetadata, { preserve: ['sheet'] });
	assert.deepEqual(sheet.sheets[1].styles[0][1], { fg: 'orange', bg: 'navy', formatKind: 'currency', formatDigits: 3, formatCurrency: 'USD' });
	assert.equal(sheet.cellPresentation.value[0][0].text, '9,007,199,254,740,993.125');
	const report = sheet.sheetResults.value.get(sheet.sheets[1]);
	assert.equal(report.presentation[0][1].text, 'USD 2.000');
	assert.deepEqual([...report.colors], [['0:0', { fg: 'lime' }], ['1:0', { fg: 'lime' }], ['1:1', { fg: 'lime' }]]);
	for (const field of ['cellPresentation', 'formatPreview', 'calculated', 'typed', 'sheetResults', 'windows']) assert.equal(Object.hasOwn(sheet.serializeWorkbook(), field), false);
	assert.equal(sheet.path, '/keep.dflo');
	history.undo(sheet); assert.deepEqual(JSON.parse(content()), JSON.parse(before));
	history.redo(sheet); assert.equal(sheet.describeDataset('sales').rowCount, 1);
	assert.equal(sheet.sheets[1].rows[2][2], '=Inputs!B0*Inputs!B1');
});

test('every failed stage leaves cells, marks, history and redo untouched', () => {
	run(`df.sheet('Report'):range('A0'):write_raw({{'first'}})`);
	history.undo(sheet);
	const before = content();
	for (const tail of [
		'error("late failure")', 'while true do end',
		`df.sheet('Report'):range('C3'):write_raw({{'=VSTACK(2,3)'}})`,
		`df.sheet('Report'):range('B0'):write_raw({{'=Inputs!Z999'}})`,
		`df.sheet('Report'):range('C0'):write_values({{{kind='number',decimal=0.2}}})`,
	]) {
		assert.throws(() => executeWorkbookScript({ ...capture(), source: `df.active_sheet():range('B0'):write_raw({{'changed'}}); ${tail}` }));
		assert.equal(content(), before);
	}
	history.redo(sheet); assert.equal(sheet.sheets[1].rows[0][0], 'first');
});

test('inactive disconnected cycles/spill errors block publication, not unrelated rich values', () => {
	for (const formula of ['=A0', '=VSTACK(1,2)']) {
		sheet.sheets[1].rows[0][0] = formula; sheet.sheets[1].rows[1][0] = 'occupied';
		const before = content();
		assert.throws(() => executeWorkbookScript({ ...capture(), source: `df.active_sheet():range('B0'):write_raw({{'99'}})` }), /Report!A0/);
		assert.equal(content(), before);
	}
	sheet.sheets[1].rows[0][0] = '=complex(2,3)'; sheet.sheets[1].rows[1][0] = '=unit(2,"cm")';
	assert.equal(run(`df.active_sheet():range('B0'):write_raw({{'99'}})`).changed, true);
	sheet.switchSheet('Report');
	assert.equal(run(`df.active_sheet():range('B0'):write_raw({{'98'}})`).changed, true);
	assert.equal(String(sheet.cellValues.value[0][0]), '2 + 3i');
	assert.equal(String(sheet.cellValues.value[1][0]), '2 cm');
});

test('navigation during a job preserves current sheet/cursor/cache; stale edits and cancellation reject', () => {
	const request = capture();
	const result = executeWorkbookScript({ ...request, source: `df.active_sheet():range('B0'):write_raw({{'=17+2'}})` });
	sheet.switchSheet('Report'); sheet.selRow = 2; sheet.selCol = 1;
	assert.equal(publishWorkbookScript(sheet, request, result), true);
	assert.equal(sheet.activeSheet.name, 'Report'); assert.deepEqual([sheet.selRow, sheet.selCol], [2, 1]);
	assert.equal(sheet.cellValues.value[0][1], '');
	const stale = capture(); sheet.sheets[0].rows[0][2] = 'new edit';
	const before = content();
	assert.throws(() => publishWorkbookScript(sheet, stale, result), /Workbook changed/);
	assert.equal(content(), before);
	const aborted = new AbortController(); aborted.abort();
	assert.throws(() => publishWorkbookScript(sheet, capture(), result, aborted.signal), { name: 'AbortError' });
	assert.equal(content(), before);
	const beforeFormat = capture();
	sheet.styles[0][0].formatKind = 'number'; sheet.styles[0][0].formatDigits = 6;
	const formatted = content();
	assert.throws(() => publishWorkbookScript(sheet, beforeFormat, result), /Workbook changed/);
	assert.equal(content(), formatted);
});

test('window publication keeps current focus and finishes FORMAT before stale script validation', () => {
	const check = Object.assign(Object.create(CheckCommand.prototype), {
		sheet, windows: new WindowManager(sheet.activeSheet), render() {},
	});
	check.currentWindow = check.windows.active;
	check.keyboard = new VimKeyboard(sheet);
	check.keyboard.move({ row: 1, col: 1 });
	check.keyboard.anchor = { row: 0, col: 0 }; check.keyboard.mode = 'v';
	const request = captureScriptWorkbook(sheet, check.captureWindowContext());
	const result = executeWorkbookScript({ ...request, source: `df.active_sheet():range('B0'):write_raw({{'19'}}); df.sheet('Report'):range('A0'):write_raw({{'=Inputs!B0*2'}})` });
	const left = check.currentWindow, right = check.windows.split('vertical');
	left.row = 1; left.col = 1; left.scrollTop = 31;
	right.sheet = sheet.sheets[1]; right.row = 2; right.col = 1; right.scrollLeft = 47;
	check.currentWindow = right;
	sheet.switchSheet('Report'); sheet.selRow = 2; sheet.selCol = 1;
	check.keyboard = new VimKeyboard(sheet, { formatChange: () => history.do(sheet) });
	assert.equal(check.preserveWindows(() => publishWorkbookScript(sheet, request, result)), true);
	assert.equal(check.windows.active, right); assert.equal(sheet.activeSheet.name, 'Report');
	assert.deepEqual([sheet.selRow, sheet.selCol, left.row, left.col, left.scrollTop, right.scrollLeft], [2, 1, 1, 1, 31, 47]);
	assert.equal(sheet.cellPresentation.value[0][0].text, '38');
	assert.equal(sheet.sheetResults.value.get(left.sheet).presentation[0][1].text, '19');
	const stale = captureScriptWorkbook(sheet, check.captureWindowContext());
	const late = executeWorkbookScript({ ...stale, source: `df.sheet('Inputs'):range('C0'):write_raw({{'must not publish'}})` });
	check.keyboard.feed('gFfj<CR>d6<CR>');
	assert.equal(sheet.styles[2][1].formatDigits, undefined);
	assert.throws(() => check.preserveWindows(() => publishWorkbookScript(sheet, stale, late)), /Workbook changed/);
	assert.equal(sheet.styles[2][1].formatDigits, 6);
	assert.equal(sheet.sheets[0].rows[0][2], '');
	assert.equal(check.windows.active, right);
	check.preserveWindows(() => history.undo(sheet));
	assert.equal(sheet.styles[2][1].formatDigits, undefined);
	assert.equal(sheet.rows[0][0], '=Inputs!B0*2');
	check.preserveWindows(() => history.undo(sheet));
	assert.equal(sheet.sheets[0].rows[0][1], '2'); assert.equal(sheet.rows[0][0], '');
	assert.equal(check.windows.active, right);
});

test('spill owners/children and dataset headers remain protected across ordered batches', () => {
	sheet.rows[2][1] = '=VSTACK(2,3)';
	for (const address of ['B2', 'B3']) {
		assert.throws(() => run(`df.sheet('Report'):range('A0'):write_raw({{'early'}}); df.active_sheet():range('${address}'):write_raw({{'blocked'}})`), /spill/);
		assert.equal(sheet.sheets[1].rows[0][0], '');
	}
	sheet.rows[2][1] = '';
	sheet.rows[2][0] = 'amount'; sheet.setMark('sales', { r0: 2, c0: 0, r1: 2, c1: 0 }, 'dataset');
	assert.throws(() => run(`df.sheet('Report'):range('A0'):write_raw({{'early'}}); df.active_sheet():range('A2'):write_raw({{'renamed'}})`), /headers/);
	assert.equal(sheet.sheets[1].rows[0][0], '');
	const before = content();
	assert.throws(() => run(`df.active_sheet():range('A3'):write_raw({{'11'}}); df.sheet('Report'):range('A0'):write_raw({{'early'}}); error('after growth')`), /after growth/);
	assert.equal(content(), before);
	assert.equal(sheet.describeDataset('sales').rowCount, 0);
});

test('error, text, blank, boolean, array source, spill child and chart computed reads are distinct', () => {
	sheet.rows = [['=VSTACK(2,3)', '', '=CHART().bar().series(B1:B2)'], ['', '4', '=1/0'], ['', '6', '=FALSE'], ['=""', '', 'text']];
	sheet.sheets[1].rows[0][0] = '=VSTACK("seed","")';
	const result = executeWorkbookScript({ ...capture(), source: `
local r=df.active_sheet():range('A0:C3'):read_values()
assert(r[1][1].kind=='unsupported' and r[2][1].decimal=='3')
assert(r[1][3].kind=='chart' and r[2][3].kind=='error')
assert(r[3][3].kind=='boolean' and r[3][3].value==false)
assert(r[4][1].kind=='text' and r[4][2].kind=='blank')
local emptyChild = df.sheet('Report'):range('A1'):read_values()[1][1]
assert(emptyChild.kind=='text' and emptyChild.text=='')
df.active_sheet():range('C1'):write_raw({{''}})
` });
	assert.equal(result.operations.length, 1);
	sheet.rows[1][2] = '=Missing!A0';
	assert.throws(() => executeWorkbookScript({ ...capture(), source: `assert(df.active_sheet():range('C1'):read_values()[1][1].kind=='error')` }), /Unknown sheet/);
});

test('no-op jobs preserve redo and malicious/malformed worker transcripts cannot partially publish', () => {
	run(`df.sheet('Report'):range('A0'):write_raw({{'redo'}})`); history.undo(sheet);
	const before = content();
	assert.equal(run(`df.active_sheet():range('B0'):write_raw({{'2'}})`).changed, false);
	const request = capture();
	assert.throws(() => publishWorkbookScript(sheet, request, { operations: [
		{ rect: { sheet: 0, r0: 0, c0: 1, r1: 0, c1: 1 }, matrix: [['17']] },
		{ rect: { sheet: 1, r0: 0, c0: 0, r1: 0, c1: 1 }, matrix: [['bad']] },
	] }));
	assert.equal(content(), before);
	history.redo(sheet); assert.equal(sheet.sheets[1].rows[0][0], 'redo');
});

test('speculative spill verification returns final all-sheet snapshots and exact reads', () => {
	sheet.rows = [['=B1+1', '=VSTACK(A0,2)', ''], ['', '', ''], ['', '', '']];
	sheet.sheets[1].rows[0][0] = '=Inputs!B0';
	const draft = SheetManager.createDraft(sheet.serializeWorkbook());
	const result = draft.calculateWorkbook({ sheet: 1, r0: 0, c0: 0, r1: 0, c1: 0 });
	assert.equal(result.sheets[0].errors.has('0:1'), true);
	assert.equal(result.sheets[1].errors.has('0:0'), true);
	assert.ok(result.cells[0][0].error);
	assert.equal(draft.pass, null);
	assert.equal(sheet.sheets[0].rows[0][1], '=VSTACK(A0,2)');
});

test('volatile formula dependents share the final all-sheet calculation, including shaped spills', () => {
	sheet.rows[0][2] = '=VSTACK(random(),random())';
	sheet.sheets[1].rows[0][2] = '=Inputs!C0';
	const draft = SheetManager.createDraft(sheet.serializeWorkbook());
	const { sheets: [inputs, report] } = draft.calculateWorkbook();
	assert.equal(inputs.errors.size, 0); assert.equal(report.errors.size, 0);
	assert.equal(typeof inputs.values[0][2], 'number');
	assert.equal(report.values[0][2], inputs.values[0][2]);
	assert.equal(report.values[1][2], inputs.values[1][2]);
	assert.deepEqual(report.spills.get('1:2'), { row: 0, col: 2, rows: 2, cols: 1 });
});
