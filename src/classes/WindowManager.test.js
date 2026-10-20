import { test } from 'node:test';
import assert from 'node:assert/strict';
import WindowManager from './WindowManager.js';
import CheckCommand from './CheckCommand.js';
import SheetManager from './SheetManager.js';
import VimKeyboard from './VimKeyboard.js';

const sheet = name => ({ name, rows: [['', ''], ['', '']], selRow: 0, selCol: 0 });

test('nested splits navigate spatially, close to a neighbor, and retain independent views of shared data', () => {
	const record = sheet('Inputs'), manager = new WindowManager(record), left = manager.active;
	left.row = 1; left.scrollLeft = 47;
	const rightTop = manager.split('vertical'), rightBottom = manager.split('horizontal');
	assert.equal(manager.windows.length, 3);
	assert.equal(rightTop.sheet, left.sheet);
	assert.equal(rightTop.row, 1);
	rightTop.row = 0; rightTop.scrollLeft = 98;
	assert.equal(left.row, 1); assert.equal(left.scrollLeft, 47);
	assert.equal(manager.neighbor('k'), rightTop.id);
	assert.equal(manager.neighbor('h'), left.id);
	assert.equal(manager.neighbor('j'), null);
	manager.focus(rightTop.id);
	assert.equal(manager.neighbor('j'), rightBottom.id);
	assert.equal(manager.neighbor('l'), null);
	manager.focus(left.id);
	assert.equal(manager.neighbor('l'), rightTop.id);
	manager.focus(rightBottom.id); manager.close();
	assert.equal(manager.windows.length, 2);
	assert.equal(manager.active, left);
	assert.deepEqual(manager.rectangles().get(rightTop.id), { x: 0.5, y: 0, width: 0.5, height: 1 });
	manager.close(); assert.throws(() => manager.close(), /last window/);
});

test('window content, resizing and workbook replacement preserve session state without touching workbook data', () => {
	const inputs = sheet('Inputs'), report = sheet('Report'), manager = new WindowManager(inputs);
	const original = manager.active, right = manager.split('vertical');
	right.sheet = report; right.content = 'cf'; right.row = 1;
	manager.resize(manager.state.root.id, 0.7);
	assert.equal(manager.rectangles().get(original.id).width, 0.7);
	assert.equal(manager.neighbor('h'), original.id);
	const newInputs = sheet('Inputs'), newReport = sheet('Report'); newReport.rows = [['']];
	manager.reconcile([newInputs, newReport]);
	assert.equal(original.sheet, newInputs); assert.equal(right.sheet, newReport);
	assert.equal(right.row, 0); assert.equal(right.content, 'cf');
	assert.deepEqual(Object.keys(inputs).sort(), ['name', 'rows', 'selCol', 'selRow']);
	manager.reconcile([newInputs]); assert.equal(right.sheet, newInputs);
});

test('invocations capture detached sheet selections, never formula text selections or rule windows', () => {
	const manager = new SheetManager(); manager.loadWorkbook({ rows: [['a', 'b', 'c'], ['d', 'e', 'f']] });
	const check = Object.create(CheckCommand.prototype);
	check.sheet = manager; check.windows = new WindowManager(manager.activeSheet); check.currentWindow = check.windows.active;
	check.keyboard = new VimKeyboard(manager); check.keyboard.move({ row: 1, col: 1 });
	check.keyboard.anchor = { row: 0, col: 2 }; check.keyboard.mode = 'v';
	const context = check.captureWindowContext();
	assert.deepEqual(context, { windowId: 1, sheetName: 'Sheet1', cursor: { row: 1, col: 1 }, selection: { r0: 0, c0: 1, r1: 1, c1: 2 } });
	context.selection.c0 = 99; context.cursor.row = 0;
	assert.equal(check.captureWindowContext().selection.c0, 1); assert.equal(manager.selRow, 1);
	check.keyboard.context = 'formula'; check.keyboard.mode = 'V';
	assert.deepEqual(check.captureWindowContext().selection, { r0: 1, c0: 1, r1: 1, c1: 1 });
	check.currentWindow.content = 'cf'; assert.throws(() => check.captureWindowContext(), /sheet window/);
});
