import test from 'node:test';
import assert from 'node:assert/strict';
import VimKeyboard from './VimKeyboard.js';
import HistoryManager from './HistoryManager.js';
import { compileConfig } from './LuaConfig.js';
import { configTemplate } from './LuaKeybindings.js';

function keyboard(rows, hooks = {}) {
	const sheet = { rows: rows.map(row => [...row]), styles: rows.map(row => row.map(() => ({ fg: 'white' }))), selRow: 0, selCol: 0, numOfRows: { value: rows.length }, numOfCols: { value: rows[0].length }, loadAllCells() {} };
	HistoryManager.instance = null;
	const history = new HistoryManager(); history.do(sheet);
	return new VimKeyboard(sheet, { change: () => history.do(sheet), undo: (redo, count) => history[redo ? 'redo' : 'undo'](sheet, count), ...hooks });
}
const formula = text => { const v = keyboard([[text]]); v.feed('<CR>'); return v; };

test('the inner-cell object composes with yank, delete and change only in the sheet', () => {
	const copied = [];
	const v = keyboard([['other', '=SUM(A1:A2)', 'tail'], ['3', '', ''], ['7', '', '']], { copy: register => copied.push(register.text) });
	v.feed('lyic');
	assert.deepEqual(v.register.cells, [['=SUM(A1:A2)']]);
	assert.deepEqual(copied, ['=SUM(A1:A2)']);
	assert.deepEqual([v.context, v.mode, v.point], ['sheet', 'n', { row: 0, col: 1 }]);
	v.feed('dic'); assert.deepEqual(v.sheet.rows[0], ['other', '', 'tail']);
	assert.equal(v.sheet.rows.length, 3);
	v.feed('u'); assert.equal(v.formula, '=SUM(A1:A2)');
	v.feed('cic=42<CR>'); assert.deepEqual(v.sheet.rows[0], ['other', '=42', 'tail']);
	assert.deepEqual([v.context, v.mode, v.point], ['sheet', 'n', { row: 0, col: 1 }]);
	v.feed('u'); assert.equal(v.formula, '=SUM(A1:A2)');
	v.feed('jpl');
	assert.equal(v.sheet.rows[1][1], '=SUM(A1:A2)');
	v.feed('yic'); assert.equal(v.register.text, '');
	v.feed('cicblank<CR>'); assert.equal(v.formula, 'blank');
	v.feed('gg0yfa'); assert.equal(v.register.text, 'other\t=SUM(A1:A2)\ttail');
	const f = formula('abc target');
	f.register = { text: 'keep' };
	f.feed('yicdiccic'); assert.equal(f.register.text, 'keep');
	assert.equal(f.formula, 'abc target');
	assert.equal(f.mode, 'n');
	f.feed('yft'); assert.equal(f.register.text, 'abc t');
});

test('inner-cell counts include blanks and clamp at the row edge; visual ic selects just the current cell', () => {
	const v = keyboard([['a', '', '=1+2', 'tail'], ['next', 'row', '', '']]);
	v.feed('l2yic'); assert.deepEqual(v.register.cells, [['', '=1+2']]);
	v.feed('2l99dic'); assert.deepEqual(v.sheet.rows, [['a', '', '=1+2', ''], ['next', 'row', '', '']]);
	v.feed('u0v2licy'); assert.deepEqual(v.register.cells, [['=1+2']]);
	assert.deepEqual(v.point, { row: 0, col: 2 });
});

test('counts wait for a motion; 0 is a motion but also a digit inside a count', () => {
	const v = keyboard(Array.from({ length: 25 }, () => Array(8).fill('')));
	v.feed('1'); assert.equal(v.point.row, 0);
	v.feed('2j3l'); assert.deepEqual(v.point, { row: 12, col: 3 });
	v.feed('0'); assert.equal(v.point.col, 0);
	v.feed('20G'); assert.deepEqual(v.point, { row: 19, col: 0 });
	v.feed('3gg'); assert.equal(v.point.row, 2);
});

test('word and WORD boundaries distinguish punctuation, underscores and whitespace', () => {
	const v = formula('one_two+=  three\tfour');
	v.feed('w'); assert.equal(v.formulaCursor, 7);
	v.feed('w'); assert.equal(v.formulaCursor, 11);
	v.feed('ge'); assert.equal(v.formulaCursor, 8);
	v.feed('0W'); assert.equal(v.formulaCursor, 11);
	v.feed('E'); assert.equal(v.formulaCursor, 15);
	v.feed('gE'); assert.equal(v.formulaCursor, 8);
	const whitespace = formula('one\n  \t\ntwo\n\nthree');
	whitespace.feed('w'); assert.deepEqual(whitespace.point, { row: 2, col: 0 });
	whitespace.feed('w'); assert.deepEqual(whitespace.point, { row: 3, col: 0 });
});

test('sheet words are cells and WORDs are occupied runs', () => {
	const v = keyboard([['a', 'b', '', 'c', 'd', '', 'e']]);
	v.feed('w'); assert.equal(v.point.col, 1);
	v.feed('W'); assert.equal(v.point.col, 3);
	v.feed('E'); assert.equal(v.point.col, 4);
	v.feed('B'); assert.equal(v.point.col, 3);
});

test('operators multiply counts and preserve exclusive vs inclusive endpoints', () => {
	const v = formula('a b c d e f g h');
	v.feed('2d3w'); assert.equal(v.formula, 'g h');
	const backwards = formula('abcdef');
	backwards.feed('4ld2h'); assert.equal(backwards.formula, 'abef');
	const inclusive = formula('abc def');
	inclusive.feed('de'); assert.equal(inclusive.formula, ' def');
});

test('cw changes a single-letter word without consuming the following word', () => {
	const v = formula('a next');
	v.feed('cwX<Esc>'); assert.equal(v.formula, 'X next');
});

test('find supports counts, reverse direction, till repeat and failed searches', () => {
	const v = formula('a,b,c,d');
	v.feed('2f,'); assert.equal(v.formulaCursor, 3);
	v.feed('F,'); assert.equal(v.formulaCursor, 1);
	v.feed('0t,;'); assert.equal(v.formulaCursor, 2);
	v.feed(';'); assert.equal(v.formulaCursor, 4);
	v.feed('fz'); assert.equal(v.formulaCursor, 4);
	v.feed(','); assert.equal(v.formulaCursor, 2);
});

test('nested matching and unmatched brackets stop safely at either boundary', () => {
	const v = formula('(a(b)c)');
	v.feed('%'); assert.equal(v.formulaCursor, 6);
	v.feed('%2l[('); assert.equal(v.formulaCursor, 0);
	v.feed('3l[('); assert.equal(v.formulaCursor, 2);
	v.feed('])'); assert.equal(v.formulaCursor, 4);
	const missing = formula('no brackets'); missing.feed('%'); assert.equal(missing.formulaCursor, 0);
});

test('text objects select nested pairs, quotes, words and tags', () => {
	for (const [text, keys, expected] of [
		['sum(a, (b+c))', '8ldi(', 'sum(a, ())'],
		['say "hello" now', '6ldi"', 'say "" now'],
		['one  two three', '5ldaw', 'one  three'],
		['<b>hello</b>', '4ldit', '<b></b>'],
		['()next', 'ci(X<Esc>', '(X)next'],
	]) { const v = formula(text); v.feed(keys); assert.equal(v.formula, expected, keys); }
});

test('visual sheet deletion clears the complete rectangle, including reversed selections', () => {
	const v = keyboard([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
	v.feed('2l2jvkh d'.replace(' ', ''));
	assert.deepEqual(v.sheet.rows, [['a', 'b', 'c'], ['d', '', ''], ['g', '', '']]);
	assert.equal(v.mode, 'n');
});

test('linewise delete and put insert copied rows; undo/redo clamp counts and retain styles', () => {
	const v = keyboard([['a', '1'], ['b', '2'], ['c', '3']]);
	v.feed('2dd'); assert.deepEqual(v.sheet.rows, [['c', '3']]);
	v.feed('P'); assert.deepEqual(v.sheet.rows, [['a', '1'], ['b', '2'], ['c', '3']]);
	v.feed('99u'); assert.deepEqual(v.sheet.rows, [['a', '1'], ['b', '2'], ['c', '3']]);
	v.feed('99<C-r>'); assert.equal(v.sheet.rows.length, 3);
	v.feed('x'); assert.equal(v.sheet.rows[0][0], '');
	v.feed('u'); assert.equal(v.sheet.rows[0][0], 'a');
});

test('operator counts also apply to doubled row operators', () => {
	const v = keyboard(Array.from({ length: 8 }, (_, i) => [String(i)]));
	v.feed('2d3d'); assert.deepEqual(v.sheet.rows, [['6'], ['7']]);
	v.feed('99dd'); assert.deepEqual(v.sheet.rows, [['']]);
});

test('search wraps, respects direction, distinguishes word search and composes with delete', () => {
	const v = formula('cat cats cat');
	v.feed('*'); assert.equal(v.formulaCursor, 9);
	v.feed('n'); assert.equal(v.formulaCursor, 0);
	v.feed('g*'); assert.equal(v.formulaCursor, 4);
	v.feed('?cat<CR>'); assert.equal(v.formulaCursor, 0);
	v.feed('d/cats<CR>'); assert.equal(v.formula, 'cats cat');
});

test('gn selects the complete search match rather than merely moving to its start', () => {
	const v = formula('one two two');
	v.feed('/two<CR>gnd'); assert.equal(v.formula, 'one  two');
});

test('marks, jump list and change list restore their own cursor locations', () => {
	const v = keyboard(Array.from({ length: 12 }, (_, i) => ['', String(i), 'x']));
	v.feed('3j2lmaG`a'); assert.deepEqual(v.point, { row: 3, col: 2 });
	v.feed('gg<C-o>'); assert.deepEqual(v.point, { row: 3, col: 2 });
	v.feed('<C-i>'); assert.deepEqual(v.point, { row: 0, col: 1 });
	v.feed('2jx3jxg;'); assert.deepEqual(v.point, { row: 5, col: 1 });
	v.feed('g;'); assert.deepEqual(v.point, { row: 2, col: 1 });
	const noJump = keyboard(Array.from({ length: 6 }, () => ['', 'x', 'z']));
	noJump.feed('2j2lmaGgg');
	noJump.feed("g'a"); assert.deepEqual(noJump.point, { row: 2, col: 1 });
	noJump.feed('g`a'); assert.deepEqual(noJump.point, { row: 2, col: 2 });
	noJump.feed('<C-o>'); assert.deepEqual(noJump.point, { row: 5, col: 1 });
});

test('paragraphs, sections, sentences and viewport motions have spreadsheet meanings', () => {
	const v = keyboard([['a', ''], ['b', ''], ['', ''], ['c', ''], ['d', ''], ['', ''], ['e', '']], { viewport: () => ({ top: 1, bottom: 4, left: 0, right: 1 }) });
	v.feed('}'); assert.equal(v.point.row, 2);
	v.feed(']]'); assert.equal(v.point.row, 3);
	v.feed(']['); assert.equal(v.point.row, 4);
	v.feed('2H'); assert.equal(v.point.row, 2);
	v.feed('L'); assert.equal(v.point.row, 4);
	v.feed('50%'); assert.equal(v.point.row, 3);
	const visibleEnd = keyboard([['a', '', 'b', '', 'offscreen']], { viewport: () => ({ top: 0, bottom: 0, left: 0, right: 3 }) });
	visibleEnd.feed('g<End>'); assert.equal(visibleEnd.point.col, 2);
	visibleEnd.feed('g$'); assert.equal(visibleEnd.point.col, 3);
	const text = formula('First.  Second! Third?'); text.feed(')'); assert.equal(text.formulaCursor, 8);
});

test('macros and dot replay complete edits, not just the last typed character', () => {
	const v = keyboard([['a', 'b', 'c'], ['d', 'e', 'f']]);
	v.feed('qaxlq'); assert.equal(v.recording, null);
	v.feed('@a'); assert.deepEqual(v.sheet.rows[0], ['', '', 'c']);
	const text = formula('red blue'); text.feed('ciwX<Esc>w.'); assert.equal(text.formula, 'X X');
});

test('Lua mappings support mode lists, leader, computed sequences and deletion', () => {
	const v = keyboard(Array.from({ length: 10 }, () => ['', '', '']));
	v.mappings = compileConfig(`vim.g.mapleader = ' '
for _, mode in ipairs({'n', 'f'}) do vim.keymap.set(mode, '<Leader>j', tostring(3) .. 'j') end
vim.keymap.set('n', 'Q', 'G')
vim.keymap.del('n', 'Q')
vim.keymap.set('i', 'jk', '<Esc>')`).mappings;
	v.feed(' j'); assert.equal(v.point.row, 3);
	v.feed('ihello jk'); assert.equal(v.mode, 'n'); assert.equal(v.formula, 'hello ');
	v.feed('<Esc>Q'); assert.equal(v.point.row, 3);
});

test('timed-out leader commands do not edit cells or affect the next command', () => {
	const v = keyboard([['keep', 'next', 'last'], ['below', 'tail', 'end']]);
	v.mappings = compileConfig(`vim.g.mapleader = ' '
vim.keymap.set({'n', 'f', 'o'}, '<Leader>sn', 'G')`).mappings;
	for (const prefix of [' s', '2 s', 'd s']) {
		v.feed(prefix); v.flushMappings();
		assert.deepEqual([v.context, v.mode, v.formula, v.point], ['sheet', 'n', 'keep', { row: 0, col: 0 }]);
		v.feed('l'); assert.equal(v.formula, 'next');
		v.feed('h');
	}
	v.feed('<CR> s'); v.flushMappings();
	assert.deepEqual([v.context, v.mode, v.formula, v.formulaCursor], ['formula', 'n', 'keep', 0]);
});

test('mapping prefixes cancel on timeout, fall back on mismatch, and RHS is nonrecursive', () => {
	const v = formula('');
	v.mappings = compileConfig(`vim.keymap.group('i', 'j', 'Leave insert')
vim.keymap.group('i', 'x', 'Unused label')
vim.keymap.group('f', 'h', 'Move')
vim.keymap.set('i', 'jk', '<Esc>')
vim.keymap.set('f', 'h', 'l')
vim.keymap.set('f', 'l', 'h')`).mappings;
	v.feed('ij'); assert.equal(v.formula, '');
	v.flushMappings(); assert.equal(v.formula, '');
	v.feed('jx'); assert.equal(v.formula, 'jx');
	v.feed('<Esc>0h'); assert.equal(v.formulaCursor, 1);
});

test('operator-pending mappings apply after the operator and its count', () => {
	const v = formula('one two three four');
	v.mappings = compileConfig(`vim.keymap.set('o', 'q', '2w')`).mappings;
	v.feed('dq'); assert.equal(v.formula, 'three four');
});

test('Lua timeoutlen defaults, computed values and bounds', () => {
	assert.equal(compileConfig('').timeoutlen, 500);
	assert.equal(compileConfig('vim.opt.timeoutlen = 3 * 400').timeoutlen, 1200);
	for (const value of [0, 2147483647]) assert.equal(compileConfig(`vim.opt.timeoutlen = ${value}`).timeoutlen, value);
	for (const value of ['-1', '0.5', '2147483648.0', '"500"', 'false', 'nil', '{}', 'math.huge', '0/0']) {
		assert.throws(() => compileConfig(`vim.opt.timeoutlen = ${value}`), /vim.opt.timeoutlen must be an integer/);
	}
});

test('invalid Lua, unsupported APIs and runaway scripts do not install partial maps', () => {
	assert.ok(compileConfig(configTemplate).mappings.length > 0);
	for (const source of ['vim.keymap.set(', 'os.execute("whoami")', 'while true do end', 'vim.keymap.set("n", "x", function() end)', 'vim.keymap.set("n", "x", "j", {expr=true})']) assert.throws(() => compileConfig(source));
	for (const source of ['vim.keymap.group("n", "", "Sheets")', 'vim.keymap.group("bad", "s", "Sheets")', 'vim.keymap.group("n", "s", {})', 'vim.keymap.group("n", "s", "")']) assert.throws(() => compileConfig(source));
});

test('vertical motions remember the preferred column and sticky end of line', () => {
	const v = formula('abcdefg\nxy\n123456789');
	v.feed('5lgjgj'); assert.deepEqual(v.point, { row: 2, col: 5 });
	v.feed('$gkgk'); assert.deepEqual(v.point, { row: 0, col: 6 });
	v.feed('gj'); assert.deepEqual(v.point, { row: 1, col: 1 });
	v.feed('hgjgk'); assert.deepEqual(v.point, { row: 1, col: 0 });
});

test('line-ending operators preserve the newline and paragraph operators exclude the next line', () => {
	const word = formula('one\nnext'); word.feed('dw'); assert.equal(word.formula, '\nnext');
	const paragraph = formula('one\ntwo\n\nnext'); paragraph.feed('d}'); assert.equal(paragraph.formula, '\nnext');
	const partial = formula('abc\ndef\n\nnext'); partial.feed('ld}'); assert.equal(partial.formula, 'a\nnext');
	const last = formula('one\ntwo'); last.feed('Gdd'); assert.equal(last.formula, 'one');
});

test('linewise and blockwise registers put complete lines and columns of formula text', () => {
	const line = formula('first\nsecond\nthird');
	line.feed('gjddP'); assert.equal(line.formula, 'first\nsecond\nthird');
	const block = formula('abcd\nWXYZ');
	block.feed('l<C-v>jly0P'); assert.equal(block.formula, 'bcabcd\nXYWXYZ');
	const change = formula('first\nsecond\nthird');
	change.feed('gjccX<Esc>'); assert.equal(change.formula, 'first\nX\nthird');
});

test('editing shortcuts respect row boundaries in both contexts', () => {
	const sheet = keyboard([['a', 'b', 'c'], ['d', 'e', 'f']]);
	sheet.feed('lD'); assert.deepEqual(sheet.sheet.rows, [['a', '', ''], ['d', 'e', 'f']]);
	sheet.feed('0X'); assert.equal(sheet.sheet.rows[0][0], 'a');
	const text = formula('first\n  second\nthird');
	text.feed('gjI!<Esc>A?<Esc>'); assert.equal(text.formula, 'first\n  !second?\nthird');
	text.feed('0D'); assert.equal(text.formula, 'first\n\nthird');
	text.feed('oadded<Esc>'); assert.equal(text.formula, 'first\n\nadded\nthird');
	text.feed('0$2r!'); assert.equal(text.formula, 'first\n\nadded\nthird');
	text.feed('0r!'); assert.equal(text.formula, 'first\n\n!dded\nthird');
	text.feed('A<S-CR>tail<C-[>'); assert.equal(text.formula, 'first\n\n!dded\ntail\nthird');
	assert.equal(text.mode, 'n');
	// Physical Ctrl-[ / Ctrl-m events bypass feed's key-notation tokenizer.
	text.key('i'); text.key('<C-m>'); assert.equal(text.mode, 'n');
	text.key('i'); text.key('<C-[>'); assert.equal(text.mode, 'n');
});

test('cell offsets and control-end aliases distinguish last column from first nonblank', () => {
	const v = keyboard([['', 'a', ''], ['', 'b', 'c']]);
	v.feed('4go'); assert.deepEqual(v.point, { row: 1, col: 0 });
	v.feed('gg<C-End>'); assert.deepEqual(v.point, { row: 1, col: 2 });
	v.feed('ggG'); assert.deepEqual(v.point, { row: 1, col: 1 });
	const unicode = formula('é😀z'); unicode.feed('3go'); assert.equal(unicode.formulaCursor, 1);
});

test('comment and conditional motions navigate nested formula text without inventing sheet targets', () => {
	const comment = formula('/*a*/ /*b*/');
	comment.feed(']/'); assert.equal(comment.formulaCursor, 4);
	comment.feed(']/'); assert.equal(comment.formulaCursor, 10);
	comment.feed('[*'); assert.equal(comment.formulaCursor, 6);
	comment.feed('[/'); assert.equal(comment.formulaCursor, 0);
	comment.feed('%'); assert.equal(comment.formulaCursor, 4);
	comment.feed('%'); assert.equal(comment.formulaCursor, 0);
	const conditional = formula('#if A\n#if B\nb\n#endif\n#else\nc\n#endif');
	conditional.feed('2gj[#'); assert.equal(conditional.point.row, 1);
	conditional.feed(']#'); assert.equal(conditional.point.row, 3);
	conditional.feed(']#'); assert.equal(conditional.point.row, 4);
	conditional.feed('%'); assert.equal(conditional.point.row, 6);
	conditional.feed('%'); assert.equal(conditional.point.row, 0);
	const sheet = keyboard([['/*a*/', '/*b*/']]); sheet.feed(']/'); assert.equal(sheet.point.col, 0);
});

test('formula marks belong to their cells and sheet marks follow inserted rows', () => {
	const v = keyboard([['abcdef', 'uvwxyz'], ['second', 'row']]);
	v.feed('<CR>3lma<Esc>l<CR>`a'); assert.equal(v.formulaCursor, 0);
	v.feed('<Esc>h<CR>`a'); assert.equal(v.formulaCursor, 3);
	v.feed('<Esc>jmbggO<Esc><Esc>`b'); assert.equal(v.point.row, 2);
});

test('ambiguous mappings fall back only on mismatch, never on timeout', () => {
	const v = keyboard(Array.from({ length: 8 }, () => ['a']));
	v.mappings = compileConfig(`vim.keymap.set('n', 'x', '3j')
vim.keymap.set('n', 'xx', 'G')`).mappings;
	v.feed('xk'); assert.equal(v.point.row, 2);
	v.feed('x'); v.flushMappings(); assert.equal(v.point.row, 2);
	v.feed('xx'); assert.equal(v.point.row, 7);
	v.mappings = compileConfig(`vim.keymap.set('n', 'x', '3j')
vim.keymap.set('n', 'xkk', 'G')`).mappings;
	v.feed('ggxk'); v.flushMappings(); assert.equal(v.point.row, 0);
	v.feed('d'); v.flushMappings(); v.feed('d'); assert.equal(v.sheet.rows.length, 7);
	v.mappings = compileConfig(`vim.g.maplocalleader = ','
vim.keymap.set('n', '<Space>', 'G')
vim.keymap.set('n', ' ', 'gg')
vim.keymap.set('n', '<LocalLeader>x', 'G')
vim.keymap.del('n', '<LocalLeader>x')`).mappings;
	v.feed(' '); assert.equal(v.point.row, 0);
	assert.equal(v.mappings.length, 1);
});

test('formula NORMAL j/k leave to sheet rows while operators, visual and gj/gk stay text motions', () => {
	const grid = () => { const v = keyboard(Array.from({ length: 6 }, (_, r) => ['a\nb\nc', `r${r}`])); v.feed('2j<CR>'); return v; };
	const down = grid(); down.feed('j'); assert.equal(down.context, 'sheet'); assert.deepEqual(down.point, { row: 3, col: 0 });
	const counted = grid(); counted.feed('9j'); assert.deepEqual([counted.context, counted.mode, counted.point.row], ['sheet', 'n', 5]);
	const up = grid(); up.feed('2k'); assert.deepEqual(up.point, { row: 0, col: 0 });
	const clampUp = grid(); clampUp.feed('5k'); assert.deepEqual(clampUp.point, { row: 0, col: 0 });
	const text = grid(); text.feed('gj'); assert.deepEqual([text.context, text.point.row], ['formula', 1]);
	text.feed('gk'); assert.deepEqual([text.context, text.point.row], ['formula', 0]);
	const op = grid(); op.feed('dj'); assert.deepEqual([op.context, op.formula], ['formula', 'c']);
	const change = grid(); change.feed('gjckX<Esc>'); assert.deepEqual([change.context, change.formula], ['formula', 'X\nc']);
	const visual = grid(); visual.feed('vjd'); assert.deepEqual([visual.context, visual.formula], ['formula', '\nc']);
	const enter = grid(); enter.feed('GA!<CR>'); assert.deepEqual([enter.context, enter.mode, enter.point, enter.sheet.rows[2][0]], ['sheet', 'n', { row: 2, col: 0 }, 'a\nb\nc!']);
	const esc = grid(); esc.feed('A!<Esc>'); assert.deepEqual([esc.context, esc.mode], ['formula', 'n']);
	const newline = grid(); newline.feed('GA<S-CR>d<CR>'); assert.equal(newline.sheet.rows[2][0], 'a\nb\nc\nd');
	const dot = grid(); dot.feed('GA!<CR>j.'); assert.deepEqual([dot.context, dot.mode, dot.sheet.rows[3][0]], ['sheet', 'n', 'a!\nb\nc']);
});

test('insert Ctrl-direction builds and adjusts one DataFlow-relative reference', () => {
	const at = (row, col, text = '') => { const v = keyboard(Array.from({ length: 8 }, () => Array(6).fill(''))); v.sheet.selRow = row; v.sheet.selCol = col; v.setFormula(text); v.feed('<CR>A'); return v; };
	const v = at(5, 3, '='); v.feed('<C-h>'); assert.equal(v.formula, '=[-1]{}');
	v.feed('<C-k><C-k>'); assert.equal(v.formula, '=[-1]{-2}');
	v.feed('<C-l><C-l><C-l>'); assert.equal(v.formula, '=[+2]{-2}');
	v.feed('<C-j><C-j>'); assert.equal(v.formula, '=[+2]{}'); assert.equal(v.formulaCursor, 7);
	v.feed('<C-h><C-h>'); assert.equal(v.formula, '=[]{}');
	v.feed('+<C-j>'); assert.equal(v.formula, '=[]{}+[]{+1}');
	const edge = at(0, 0); edge.feed('<C-h><C-k>'); assert.equal(edge.formula, '[]{}');
	const far = at(7, 5); far.feed('<C-l><C-j><C-k>'); assert.equal(far.formula, '[]{-1}');
	const replay = at(5, 3); replay.feed('<C-h><CR>l<CR>A<C-h><C-h><CR>'); assert.equal(replay.sheet.rows[5][4], '[-2]{}');
	replay.feed('j.'); assert.equal(replay.sheet.rows[6][4], '[-2]{}');
});

test('Shift-direction extends active references, normalises, reverses and clamps', () => {
	const at = (row, col) => { const v = keyboard(Array.from({ length: 8 }, () => Array(6).fill(''))); v.sheet.selRow = row; v.sheet.selCol = col; v.feed('<CR>i'); return v; };
	const fresh = at(5, 3); fresh.feed('<C-k><C-j>KK'); assert.equal(fresh.formula, '[]{-2}:[]{}');
	fresh.feed('<C-h>'); assert.equal(fresh.formula, '[-1]{-2}:[]{}');
	fresh.feed('L<C-l><C-l>'); assert.equal(fresh.formula, '[]{-2}:[+2]{}');
	fresh.feed('<C-j><C-j><C-j><C-j>'); assert.equal(fresh.formula, '[]{}:[+2]{+2}');
	const scalar = at(5, 3); scalar.feed('<C-k>HH'); assert.equal(scalar.formula, '[-2]{-1}:[]{-1}');
	scalar.feed('<C-l><C-l><C-l><C-l>'); assert.equal(scalar.formula, '[]{-1}:[+2]{-1}');
	const clamped = at(1, 1); clamped.feed('<C-h><C-l>HHKKK'); assert.equal(clamped.formula, '[-1]{-1}:[]{}');
	const down = at(5, 3); down.feed('<C-l>JJ'); assert.equal(down.formula, '[+1]{}:[+1]{+2}');
	const shiftName = at(5, 3); shiftName.feed('<C-l><S-l>'); assert.equal(shiftName.formula, '[+1]{}:[+2]{}');
	const text = at(5, 3); text.feed('=HSTACK(FILTER(A0:B1,B0:B1>0))');
	assert.equal(text.formula, '=HSTACK(FILTER(A0:B1,B0:B1>0))');
});

test('reference sessions end on other keys and use code-point carets', () => {
	const v = keyboard([['', '', ''], ['', 'é😀', ''], ['', '', '']]);
	v.sheet.selRow = 1; v.sheet.selCol = 1; v.feed('<CR>A'); assert.equal(v.formulaCursor, 2);
	v.feed('<C-h>'); assert.deepEqual([v.formula, v.formulaCursor], ['é😀[-1]{}', 8]);
	v.feed(',<C-h>'); assert.equal(v.formula, 'é😀[-1]{},[-1]{}');
	v.feed('<C-u><C-k>'); assert.deepEqual([v.formula, v.formulaCursor], ['[]{-1}', 6]);
	v.feed('<Home><C-j>'); assert.deepEqual([v.formula, v.formulaCursor], ['[]{+1}[]{-1}', 6]);
	v.feed('<Del><C-l>'); assert.equal(v.formula, '[]{+1}[+1]{}]{-1}');
	v.feed('<BS><BS><C-k>'); assert.equal(v.formula, '[]{+1}[+1][]{-1}]{-1}');
	v.feed('<Esc>aK'); assert.equal(v.formula, '[]{+1}[+1][]{-1}K]{-1}');
	v.feed('<Esc>'); assert.equal(v.reference, null);
	v.feed('A<C-h>'); v.resetNavigation(); assert.equal(v.reference, null);
});
