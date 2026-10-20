import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaAssist, formulaReferences } from './FormulaEditing.js';
import SyntaxHighlighting from './SyntaxHighlighting.js';
import SheetManager from './SheetManager.js';
import VimKeyboard from './VimKeyboard.js';
import { compileConfig } from './LuaConfig.js';
import { keyboardHints } from './KeyboardHints.js';

function setup(formula, row = 5, col = 3) {
	const sheet = new SheetManager();
	sheet.rows = Array.from({ length: 12 }, () => Array(30).fill(''));
	sheet.selRow = row; sheet.selCol = col; sheet.rows[row][col] = formula;
	const keyboard = new VimKeyboard(sheet);
	keyboard.feed('<CR>');
	return { sheet, keyboard };
}

test('absolute, relative and calculated ranges share matching source colors without touching quoted text', () => {
	const source = '=SUM(A0:B2)+[-2]{-3}+B2+SUM([-3]{-5}:[-2]{-3})+AA1+IF(TRUE,"A0 [1]{2} <img>",0)';
	const { sheet } = setup(source);
	const refs = formulaReferences(source, 5, 3, sheet);
	assert.deepEqual(refs.map(ref => [ref.source, ref.region]), [
		['A0:B2', { r0: 0, c0: 0, r1: 2, c1: 1 }],
		['[-2]{-3}', { r0: 2, c0: 1, r1: 2, c1: 1 }],
		['B2', { r0: 2, c0: 1, r1: 2, c1: 1 }],
		['[-3]{-5}:[-2]{-3}', { r0: 0, c0: 0, r1: 2, c1: 1 }],
		['AA1', { r0: 1, c0: 26, r1: 1, c1: 26 }],
	]);
	assert.equal(refs[0].color, refs[3].color);
	assert.equal(refs[1].color, refs[2].color);
	assert.notEqual(refs[0].color, refs[1].color);
	const html = new SyntaxHighlighting().highlight(source, refs);
	assert.equal((html.match(/class="formula-reference"/g) || []).length, 5);
	assert.ok(html.includes(`style="color:${refs[1].color}">[-2]{-3}</span>`));
	assert.ok(html.includes('A0 [1]{2} &lt;img&gt;'));
	assert.ok(!html.includes('<img>'));
	const calculated = formulaReferences('=[-2]{max(0, 1)+1}+Z999', 5, 3, sheet);
	assert.deepEqual(calculated[0].region, { r0: 2, c0: 1, r1: 2, c1: 1 });
	assert.equal(calculated[1].region, null);
});

test('completion and signatures respect nested calls, relative calculations and quoted commas', () => {
	const text = '=VSTACK(FILTER(A0:C3, C0:C3>0), SO';
	const help = formulaAssist(text, text.length);
	assert.deepEqual(help.suggestions, ['SORT']);
	assert.equal(help.signature.name, 'VSTACK');
	assert.equal(help.signature.argument, 1);
	const nested = '=FILTER(A0:C3, AND(B0:B3="a,b", C0:C3>0), ';
	assert.equal(formulaAssist(nested, nested.length).signature.argument, 2);
	const relative = '=FILTER(A0:C3, [-1]{max(0,1)}';
	assert.equal(formulaAssist(relative, relative.length).signature.argument, 1);
	assert.deepEqual(formulaAssist('="FIL', 5).suggestions, []);
	const { keyboard } = setup('');
	keyboard.feed('i=FI<Tab>');
	assert.equal(keyboard.formula, '=FILTER()');
	assert.equal(keyboard.formulaCursor, 8);
	keyboard.feed('A0:C3,C0:C3>0<End><CR>');
	assert.equal(keyboard.formula, '=FILTER(A0:C3,C0:C3>0)');
	assert.equal(keyboard.context, 'sheet');
});

test('F4 toggles scalar and range references reversibly and preserves Unicode caret positions', () => {
	const { keyboard } = setup('="😀"+B2:C4');
	keyboard.feed('A<F4>');
	assert.equal(keyboard.formula, '="😀"+[-2]{-3}:[-1]{-1}');
	assert.equal(keyboard.formulaCursor, Array.from(keyboard.formula).length);
	keyboard.feed('<F4>');
	assert.equal(keyboard.formula, '="😀"+B2:C4');
	const { sheet, keyboard: spillKeyboard } = setup('=VSTACK(3,7)', 0, 4);
	sheet.recalculate(); spillKeyboard.escape(); spillKeyboard.move({ row: 1, col: 4 });
	spillKeyboard.feed('i');
	assert.deepEqual([sheet.selRow, sheet.selCol], [0, 4]);
	assert.equal(spillKeyboard.formula, '=VSTACK(3,7)');
});

test('spill children reject partial deletes and puts, but selecting their source allows replacement', () => {
	const { sheet, keyboard } = setup('=VSTACK(3,7)', 0, 4);
	sheet.recalculate(); keyboard.escape(); keyboard.move({ row: 1, col: 3 });
	keyboard.feed('vld');
	assert.equal(sheet.rows[0][4], '=VSTACK(3,7)');
	assert.equal(sheet.getElementValue(1, 4), 7);
	keyboard.move({ row: 1, col: 4 });
	keyboard.register = { cells: [['replace']], text: 'replace' };
	keyboard.feed('p');
	assert.equal(sheet.rows[1][4], '');
	keyboard.move({ row: 1, col: 4 }); keyboard.feed('vkd');
	assert.equal(sheet.rows[0][4], '');
	assert.equal(sheet.getElementValue(1, 4), '');
});

test('shortcut hints follow modes and Lua descriptions, prefixes and disabled defaults', () => {
	const { keyboard } = setup('');
	keyboard.mappings = compileConfig(`vim.keymap.set('f', 'h', '<Nop>')
vim.keymap.set('f', ' z', 'gk', {desc='Previous formula line'})`);
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Text motion' && hint.key.split(' ').includes('h')));
	keyboard.feed(' ');
	assert.deepEqual(keyboardHints(keyboard), [{ key: 'z', description: 'Previous formula line' }]);
	keyboard.feed('<Esc>i');
	assert.ok(keyboardHints(keyboard).some(hint => hint.description === 'Relative cell'));
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Extend range'));
	keyboard.feed('<C-h>');
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'Shift H J K L' && hint.description === 'Extend range'));
	keyboard.feed('+');
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Extend range'));
});
