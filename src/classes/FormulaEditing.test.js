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

test('lookup and join completion exposes signatures through nested arrays and quoted sheet names', () => {
	const assist = text => formulaAssist(text, Array.from(text).length);
	assert.deepEqual(assist('=loo').suggestions, ['LOOKUP']);
	assert.deepEqual(assist('=JO').suggestions, ['JOIN']);
	assert.equal(assist('=LOOKUP(HSTACK("a,b", "NZ"), \'Prices, 2026\'!A0:B4, C0:C4, ').signature.argument, 3);
	assert.deepEqual(assist('=JOIN(A0:B2, A0:A2, HSTACK(C0:C2,D0:D2), E0:E2, ').signature,
		{ name: 'JOIN', args: ['left', 'leftKeys', 'right', 'rightKeys', '[kind = "left"]'], argument: 4 });
	const { keyboard } = setup('');
	keyboard.feed('i=LO<Tab>"x","x",7<End><CR>');
	assert.equal(keyboard.formula, '=LOOKUP("x","x",7)');
	assert.equal(keyboard.sheet.getValue(5, 3), 7);
	keyboard.feed('cic=JO<Tab>7,1,8,1<End><CR>');
	assert.equal(keyboard.formula, '=JOIN(7,1,8,1)');
	assert.deepEqual(keyboard.sheet.getValue(5, 3), [[7, 8]]);
});

test('CHART builder completion and signatures follow chains without leaking into ordinary formulas or strings', () => {
	const assist = text => formulaAssist(text, Array.from(text).length);
	assert.deepEqual(assist('=CHART().').suggestions, ['.line', '.bar', '.scatter', '.pie', '.x', '.series']);
	assert.deepEqual(assist('=CHART().series(A0:A3, "😀, .size(").si').suggestions, ['.size']);
	assert.deepEqual(assist('=CHART().series([-1]{max(0,1)}:[-1]{3}, ').signature,
		{ name: '.series', args: ['valueRange', '["name"]'], argument: 1 });
	assert.equal(assist('=CHART().size(320, ').signature.argument, 1);
	assert.equal(assist('=CHART().series([-1]{max(0,').signature.name, 'max');
	assert.deepEqual(assist('=SUM(A0:A3).si').suggestions, []);
	assert.deepEqual(assist('=CHART().title(".si').suggestions, []);
	assert.deepEqual(assist('=si').suggestions, ['sin']);
	const { keyboard } = setup('=CHART()');
	keyboard.feed('A. se<Tab>');
	assert.equal(keyboard.formula, '=CHART().series()');
	assert.equal(keyboard.formulaCursor, 16);
	keyboard.feed('A0:A3,"😀"<End>.p<Tab><End>.si<Tab>320,240<CR>');
	assert.equal(keyboard.formula, '=CHART().series(A0:A3,"😀").pie().size(320,240)');
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

test('cell formula and value objects copy distinct text, and value delete/change preserve the evaluated register', () => {
	const { sheet, keyboard } = setup('=2+3*4', 0, 0);
	sheet.rows[0][1] = '=0'; sheet.rows[0][2] = '=FALSE';
	sheet.rows[0][4] = '=VSTACK(8,13)';
	sheet.recalculate(); keyboard.escape();
	keyboard.feed('yi');
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'v' && hint.description === 'Cell value'));
	keyboard.feed('<Esc>');
	keyboard.feed('yicjp'); assert.equal(sheet.rows[1][0], '=2+3*4');
	keyboard.feed('kyiv2jp'); assert.equal(sheet.rows[2][0], '14');
	keyboard.feed('gg0y5iv');
	assert.equal(keyboard.register.text, '14\t0\tfalse\t\t8');
	keyboard.move({ row: 1, col: 4 }); keyboard.feed('yiv');
	assert.equal(keyboard.register.text, '13');
	keyboard.move({ row: 0, col: 0 }); keyboard.feed('div');
	assert.equal(sheet.rows[0][0], ''); assert.equal(keyboard.register.text, '14');
	keyboard.feed('cic=9*3<CR>civ');
	assert.equal(keyboard.register.text, '27'); assert.equal(keyboard.formula, '');
	assert.deepEqual([keyboard.context, keyboard.mode], ['formula', 'i']);
	keyboard.feed('=5+1<CR><CR>yicdiccicyivdivciv');
	assert.equal(keyboard.formula, '=5+1'); assert.equal(keyboard.register.text, '27');
	assert.equal(keyboard.mode, 'n');
	assert.ok(!keyboardHints(keyboard).some(hint => ['yic', 'yiv'].includes(hint.key)));
});

test('visual value selections retain their meaning through corner swaps and gv without affecting later formula selections', () => {
	const { sheet, keyboard } = setup('=2+3*4', 0, 0);
	sheet.rows[0][1] = '=3*7'; sheet.recalculate(); keyboard.escape();
	keyboard.feed('vivloy'); assert.equal(keyboard.register.text, '14\t21');
	keyboard.feed('gvy'); assert.equal(keyboard.register.text, '14\t21');
	keyboard.feed('vly'); assert.equal(keyboard.register.text, '=2+3*4\t=3*7');
	keyboard.feed('viv<Esc>vly'); assert.equal(keyboard.register.text, '=2+3*4\t=3*7');
	keyboard.feed('vivlicy'); assert.equal(keyboard.register.text, '=3*7');
});

test('shortcut hints follow modes and Lua descriptions, prefixes and disabled defaults', () => {
	const { keyboard } = setup('');
	keyboard.mappings = compileConfig(`vim.keymap.set('f', 'h', '<Nop>')
vim.g.mapleader = ' '
vim.keymap.set('f', '<Leader>z', 'gk', {desc='Previous formula line'})
vim.keymap.set({'n', 'f'}, '<Leader>sn', ':sheetnew<CR>', {desc='New sheet'})
vim.keymap.set('f', '<Leader>so', ':o<CR>', {desc='Open sheet'})
vim.keymap.set('f', '<Leader>w', ':w<CR>', {desc='Save'})
vim.keymap.set('f', '<Leader>xx', '<Nop>')
vim.keymap.set('n', 'Q', 'G', {desc='Last row'})
vim.keymap.set('f', 'gq', 'gk', {desc='Previous line'})
vim.keymap.set('f', '<F6>', 'gk', {desc='Previous line'})
vim.keymap.set('f', '<F6>x', 'gj', {desc='Next line'})`).mappings;
	assert.deepEqual(keyboardHints(keyboard).filter(hint => hint.key === 'Space'), [{ key: 'Space', description: '…' }]);
	assert.deepEqual(keyboardHints(keyboard).filter(hint => hint.key === 'g'), [{ key: 'g', description: '…' }]);
	assert.ok(!keyboardHints(keyboard).some(hint => ['New sheet', 'Open sheet', 'Last row'].includes(hint.description)));
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'F6' && hint.description === 'Previous line …'));
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Text motion' && hint.key.split(' ').includes('h')));
	keyboard.feed(' ');
	assert.deepEqual(keyboardHints(keyboard), [
		{ key: 'z', description: 'Previous formula line' }, { key: 's', description: '…' }, { key: 'w', description: 'Save' },
	]);
	keyboard.feed('s');
	assert.deepEqual(keyboardHints(keyboard), [{ key: 'n', description: 'New sheet' }, { key: 'o', description: 'Open sheet' }]);
	keyboard.feed('<Esc><F6>');
	assert.deepEqual(keyboardHints(keyboard), [{ key: 'x', description: 'Next line' }]);
	keyboard.feed('<Esc>i');
	assert.ok(keyboardHints(keyboard).some(hint => hint.description === 'Relative cell'));
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Extend range'));
	keyboard.feed('<C-h>');
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'H J K L' && hint.description === 'Extend range'));
	keyboard.feed('+');
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Extend range'));
});

test('Lua group labels name only existing branches in the active mode', () => {
	const { keyboard } = setup('');
	keyboard.mappings = compileConfig(`vim.g.mapleader = ' '
vim.g.maplocalleader = ','
vim.keymap.group({'n', 'f'}, '<Leader>', 'Actions')
vim.keymap.group({'n', 'f'}, '<Leader>s', 'Old label')
vim.keymap.set({'n', 'f'}, '<Leader>sn', ':sheetnew<CR>', {desc='New sheet'})
vim.keymap.set({'n', 'f'}, '<Leader>so', ':o<CR>', {desc='Open sheet'})
vim.keymap.group({'n', 'f'}, '<Leader>s', 'Sheets')
vim.keymap.group('n', '<Leader>s', 'Sheet commands')
vim.keymap.set('f', '<Leader>w', ':w<CR>', {desc='Save'})
vim.keymap.group('f', '<Leader>x', 'Disabled')
vim.keymap.set('f', '<Leader>xx', '<Nop>')
vim.keymap.group('f', '<F6>', 'Unused')
vim.keymap.group('f', '<LocalLeader>', 'Local')
vim.keymap.set('f', '<LocalLeader>j', 'gj', {desc='Next line'})
vim.keymap.group('f', '<F7>', 'Branch label')
vim.keymap.set('f', '<F7>', 'gk', {desc='Previous line'})
vim.keymap.set('f', '<F7>x', 'gj', {desc='Next line'})`).mappings;
	assert.deepEqual(keyboardHints(keyboard).filter(hint => hint.key === 'Space'), [{ key: 'Space', description: 'Actions …' }]);
	assert.ok(!keyboardHints(keyboard).some(hint => hint.key === 'F6'));
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === ',' && hint.description === 'Local …'));
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'F7' && hint.description === 'Previous line …'));
	keyboard.feed(' ');
	assert.deepEqual(keyboardHints(keyboard), [{ key: 's', description: 'Sheets …' }, { key: 'w', description: 'Save' }]);
	keyboard.feed('s');
	assert.deepEqual(keyboardHints(keyboard), [{ key: 'n', description: 'New sheet' }, { key: 'o', description: 'Open sheet' }]);
	keyboard.feed('<Esc><Esc> ');
	assert.deepEqual(keyboardHints(keyboard), [{ key: 's', description: 'Sheet commands …' }]);
});

test('built-in shortcut hints expose only the next key through operators and text objects', () => {
	const { keyboard } = setup('=2+3', 0, 0);
	keyboard.escape();
	assert.ok(!keyboardHints(keyboard).some(hint => ['yic', 'yiv'].includes(hint.key)));
	for (const operator of ['y', '2d3', 'c', 'v']) {
		keyboard.feed(operator);
		assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'i a' && hint.description === 'Text object…'), operator);
		assert.ok(!keyboardHints(keyboard).some(hint => ['ic', 'iv'].includes(hint.key) || ['Cell formula', 'Cell value'].includes(hint.description)), operator);
		keyboard.feed('i');
		assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'c' && hint.description === 'Cell formula'), operator);
		assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'v' && hint.description === 'Cell value'), operator);
		assert.ok(!keyboardHints(keyboard).some(hint => ['i a', 'h j k l', 'ic', 'iv'].includes(hint.key)), operator);
		keyboard.feed('<Esc>');
	}
	keyboard.feed('ya');
	assert.ok(!keyboardHints(keyboard).some(hint => ['Cell formula', 'Cell value'].includes(hint.description)));
	keyboard.feed('<Esc>yg');
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'g' && hint.description === 'First row / line'));
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description === 'Whole row / line'));
	keyboard.feed('<Esc>yf');
	assert.ok(keyboardHints(keyboard).some(hint => hint.description === 'Type target'));
	keyboard.feed('<Esc><CR>yi');
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'w W' && hint.description === 'Word'));
	assert.ok(!keyboardHints(keyboard).some(hint => ['Cell formula', 'Cell value', 'Whole row / line'].includes(hint.description)));
	keyboard.feed('<Esc>g');
	assert.ok(!keyboardHints(keyboard).some(hint => hint.description.startsWith('Fill')));
	keyboard.feed('<Esc><Esc>g');
	assert.deepEqual(keyboardHints(keyboard).filter(hint => hint.description.startsWith('Fill')), [
		{ key: 'H J K L', description: 'Fill' },
	]);
	keyboard.feed('<Esc>vg');
	assert.deepEqual(keyboardHints(keyboard).filter(hint => hint.description.startsWith('Fill')), [
		{ key: 'H J K L', description: 'Fill' },
	]);
});

test('marks and dataset columns complete without calls, share reference colors, and stay named under F4', () => {
	const { sheet, keyboard } = setup('');
	sheet.rows[0][0] = 'item'; sheet.rows[0][1] = 'amount'; sheet.rows[1][1] = '17';
	sheet.setMark('sales', { r0: 0, c0: 0, r1: 2, c1: 1 }, 'dataset');
	sheet.setMark('tax_rate', { r0: 0, c0: 3, r1: 0, c1: 3 });
	const assist = text => formulaAssist(text, Array.from(text).length, sheet);
	assert.deepEqual(assist('=SUM(`sa').suggestions, ['`sales']);
	assert.deepEqual(assist('=SUM(`sales.AM').suggestions, ['`sales.amount']);
	assert.deepEqual(assist('="`sales.am').suggestions, []);
	assert.equal(assist('=SUM(`sales.AM').signature.name, 'SUM');
	keyboard.feed('i=SUM(`sa<Tab>.am<Tab>)');
	assert.equal(keyboard.formula, '=SUM(`sales.amount)');
	keyboard.feed('<Left><F4>'); assert.equal(keyboard.formula, '=SUM(`sales.amount)');
	const text = '=SUM(`sales.amount)+SUM(B1:B2)+`tax_rate+IF(TRUE,"`sales.item",0)';
	const refs = formulaReferences(text, 5, 3, sheet);
	assert.deepEqual(refs.map(ref => ref.source), ['`sales.amount', 'B1:B2', '`tax_rate']);
	assert.equal(refs[0].color, refs[1].color);
	assert.deepEqual(refs[0].region, { r0: 1, c0: 1, r1: 2, c1: 1 });
	assert.ok(new SyntaxHighlighting().highlight(text, refs).includes('>`sales.amount</span>'));
	sheet.createSheet('Report');
	const foreign = formulaReferences('=SUM(`sales.amount)', 5, 3, sheet)[0];
	assert.equal(foreign.region, null); assert.deepEqual(foreign.coordinates, refs[0].coordinates);
});
