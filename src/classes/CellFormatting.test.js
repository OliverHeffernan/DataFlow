import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import VimKeyboard from './VimKeyboard.js';
import { compileConfig } from './LuaConfig.js';
import { cellToValue } from './FormulaFunctions.js';
import { presentCell, summarizeFormats } from './CellFormatting.js';
import { formatShortcut } from './FormatKeymaps.js';

const sheet = new SheetManager(), history = new HistoryManager();
sheet.loadAllCells = () => sheet.recalculate(); sheet.loadStyles = () => {};
globalThis.window = {};
beforeEach(() => sheet.loadWorkbook({ rows: [['0.125', '1234.56789', 'keep'], ['0.07', '-0.004', '']] }));
const keyboard = () => new VimKeyboard(sheet, {
	formatChange: () => history.do(sheet), undo: redo => history[redo ? 'redo' : 'undo'](sheet),
	change: () => { sheet.recalculate(); history.do(sheet); },
});
const show = (value, style) => presentCell(cellToValue(value), style, value);
const number = { formatKind: 'number', formatDigits: 2 };

test('display rounding, percent scaling and grouping retain decimal precision, signs and raw fallbacks', () => {
	assert.deepEqual(show('1234.56789', { ...number, formatGroup: true, formatDigits: 5 }), { text: '1,234.56789', warning: '' });
	assert.equal(show('999.995', number).text, '1000.00');
	assert.equal(show('-1.005', number).text, '-1.01');
	assert.equal(show('-0.004', number).text, '0.00');
	assert.equal(show('-1234.565', { ...number, formatKind: 'currency', formatCurrency: 'USD' }).text, '-USD 1,234.57');
	assert.equal(show('0.125', { ...number, formatPercent: true, formatDigits: 1 }).text, '12.5%');
	const large = '123456789012345678901234567890123456789012345678901234567890123456789.125';
	assert.equal(show(large, { ...number, formatPercent: true }).text, '12345678901234567890123456789012345678901234567890123456789012345678912.50%');
	assert.equal(show('9007199254740993.125', number).text, '9007199254740993.13');
	assert.equal(show('1e5000', number).text.length < 90, true);
	assert.match(show('1e5000', number).warning, /scientific/);
	for (const value of ['Infinity', 'not a number', '2026-10-20']) { const result = show(value, number); assert.equal(result.text, value); assert.match(result.warning, /finite/); }
	assert.equal(show('', number).warning, '');
	assert.equal(show('12', { ...number, formatDigits: 65 }).text, '12');
});

test('ISO dates are civil text, instants project to explicit zones, and clocks never acquire invented dates', () => {
	const date = { formatKind: 'date', formatPreset: 'long' }, timed = { ...date, formatIncludeTime: true };
	assert.deepEqual(show('2024-02-29', date), { text: '29 Feb 2024', warning: '' });
	assert.equal(show('2026-10-20', { ...date, formatTimeZone: 'America/Los_Angeles' }).text, '20 Oct 2026');
	assert.equal(show('2026-10-20T01:30:45+13:00', timed).text, '19 Oct 2026 12:30:45 UTC');
	assert.equal(show('2026-10-20T01:30:45Z', { ...timed, formatTimeZone: 'Pacific/Auckland', formatSeconds: false }).text, '20 Oct 2026 14:30 +13:00 [Pacific/Auckland]');
	// Both sides of a DST transition distinguish zone conversion from a fixed offset.
	assert.equal(show('2026-09-26T13:59:00Z', { ...timed, formatTimeZone: 'Pacific/Auckland' }).text, '27 Sep 2026 01:59:00 +12:00 [Pacific/Auckland]');
	assert.equal(show('2026-09-26T14:00:00Z', { ...timed, formatTimeZone: 'Pacific/Auckland' }).text, '27 Sep 2026 03:00:00 +13:00 [Pacific/Auckland]');
	assert.equal(show('09:08:07', { formatKind: 'time', formatSeconds: false, formatTimeZone: 'Pacific/Auckland' }).text, '09:08');
	for (const value of ['2023-02-29', '1900-02-29', '2026-04-31', '20/10/2026', '2026-10-20T12:00', '2026-10-20T24:00Z', '2026-10-20T12:00+24:00', '46000']) {
		assert.equal(show(value, date).text, value); assert.ok(show(value, date).warning);
	}
	assert.match(show('2026-10-20', timed).warning, /no time/);
	assert.match(show('09:08', date).warning, /no date/);
	assert.ok(show('0001-01-01T00:00+01:00', timed).warning);
	assert.equal(show('2000-02-29', date).warning, '');
});

test('FORMAT previews a fixed visual range, isolates input, preserves other styles, and commits one undoable workbook edit', () => {
	sheet.styles[0][0] = { ...sheet.styles[0][0], fg: 'yellow', wrap: true, align: 'right' };
	history.reset(sheet); const raw = JSON.stringify(sheet.rows), v = keyboard();
	v.feed('vjgFfj<CR>%d1<CR>');
	assert.equal(v.mappingMode, 'format');
	assert.equal(v.formatSession.scope, 'A0:A1');
	assert.equal(sheet.cellPresentation.value[0][0].text, '12.5%');
	assert.equal(sheet.cellPresentation.value[1][0].text, '7.0%');
	assert.equal(sheet.styles[0][0].formatKind, undefined); // preview is not persisted before Done
	v.feed('i:xgg'); // no ordinary editing, commands or motions escape the mode
	assert.equal(JSON.stringify(sheet.rows), raw);
	assert.deepEqual([sheet.selRow, sheet.selCol], [1, 0]);
	v.feed('<Esc>');
	assert.equal(v.mappingMode, 'n'); assert.equal(history.historyFor(sheet).undo.length, 2);
	assert.equal(sheet.styles[0][0].formatKind, 'number');
	assert.equal(sheet.styles[0][0].fg, 'yellow'); assert.equal(sheet.styles[0][0].wrap, true);
	assert.equal(sheet.styles[0][1].formatKind, undefined);
	v.feed('u'); assert.equal(sheet.styles[0][0].formatKind, undefined);
	v.feed('<C-r>'); assert.equal(sheet.cellPresentation.value[0][0].text, '12.5%');
	assert.equal(JSON.stringify(sheet.rows), raw);
	v.feed('gFud8<Esc>'); // revert preview; unfinished input is discarded, no extra history
	assert.equal(history.historyFor(sheet).undo.length, 2);
	v.feed('gF<Esc>'); assert.equal(history.historyFor(sheet).undo.length, 2);
	v.feed('qagF%<Esc>qk@a');
	assert.equal(sheet.styles[1][0].formatPercent, false); assert.equal(sheet.styles[0][0].formatPercent, false);
	assert.equal(v.formatSession, null); // macro replay must not leave a half-recorded FORMAT session open
});

test('mixed fields change independently; full-row selections and reverted sessions preserve their contract', () => {
	sheet.styles[0][0] = { ...sheet.styles[0][0], ...number, formatDigits: 1, formatGroup: true };
	sheet.styles[1][0] = { ...sheet.styles[1][0], ...number, formatDigits: 3, formatPercent: true };
	history.reset(sheet); const original = { ...sheet.styles[0][0] }, v = keyboard();
	v.feed('gF%%<Esc>'); // Editing back to the same effective format is a no-op, even with omitted defaults.
	assert.deepEqual(sheet.styles[0][0], original); assert.equal(history.historyFor(sheet).undo.length, 1);
	v.feed('vjgF');
	assert.equal(v.formatSession.summary, 'Mixed');
	v.feed('+'); assert.match(v.formatSession.error, /explicit/);
	v.feed(',d4<CR><Esc>');
	assert.equal(sheet.styles[0][0].formatDigits, 4); assert.equal(sheet.styles[1][0].formatDigits, 4);
	assert.equal(sheet.styles[0][0].formatPercent, false); assert.equal(sheet.styles[1][0].formatPercent, true);
	assert.equal(sheet.styles[0][0].formatGroup, true); assert.equal(sheet.styles[1][0].formatGroup, true);
	assert.equal(summarizeFormats([sheet.styles[0][0], sheet.styles[1][0]]), 'Mixed');
	v.feed('VgF'); assert.equal(v.formatSession.scope, 'A1:C1');
	v.feed('fkk<CR>u<Esc>'); assert.equal(sheet.styles[1][0].formatDigits, 4);
});

test('Lua remaps every FORMAT action and visible key labels, including multi-key selection and exit', () => {
	const v = keyboard();
	v.mappings = compileConfig(`vim.g.mapleader = ' '
vim.keymap.set({'n','f','x'}, 'Q', '<FormatOpen>')
vim.keymap.set('n', 'gF', '<Nop>')
vim.keymap.set('format', 'f', '<Nop>')
vim.keymap.set('format', 'T', '<FormatType>')
vim.keymap.set('format', 'J', '<FormatNext>')
vim.keymap.set('format', 'K', '<FormatPrevious>')
vim.keymap.set('format', 'p', '<FormatPercent>')
vim.keymap.set('format', '%', '<Nop>')
vim.keymap.set('format', 'e', '<FormatDigits>')
vim.keymap.set('format', '<C-y>', '<FormatSelect>')
vim.keymap.set('format', '<CR>', '<Nop>')
vim.keymap.set('format', '<Leader>x', '<FormatDone>')
vim.keymap.set('format', '<Esc>', '<Nop>')`).mappings;
	assert.equal(formatShortcut(v.mappings, 'Open', 'n'), 'Q');
	assert.equal(formatShortcut(v.mappings, 'Percent'), 'p');
	assert.equal(formatShortcut(v.mappings, 'Done'), 'Space x');
	v.feed('gF'); assert.equal(v.formatSession, undefined);
	v.feed('QTJ<C-y>pe3<C-y>'); assert.equal(sheet.cellPresentation.value[0][0].text, '12.500%');
	v.feed('<Esc>'); assert.ok(v.formatSession);
	v.feed(' x'); assert.equal(v.formatSession, null);
	assert.equal(sheet.styles[0][0].formatDigits, 3);
	// Ambiguous mappings have no misleading shortcut label, and timeout runs no shorter action.
	v.mappings = compileConfig(`vim.keymap.set('format', 'w', '<FormatPercent>')
vim.keymap.set('format', 'ww', '<FormatGroup>')`).mappings;
	assert.equal(formatShortcut(v.mappings, 'Percent'), '%');
	v.feed('gFw'); v.flushMappings(); assert.ok(v.formatSession); assert.equal(v.formatSession.common('formatPercent'), true);
	v.feed('<Esc>');
});

test('all contextual currency/date controls work through remapped actions, with literal input and validation', () => {
	const v = keyboard();
	v.mappings = compileConfig(`vim.keymap.set('n', 'Q', '<FormatOpen>')
local actions = {'Next','Previous','Select','Type','Percent','Digits','Increase','Decrease','Group','Currency','Time','Seconds','Zone','Revert','Done','Backspace'}
for i, action in ipairs(actions) do vim.keymap.set('format', '<F' .. i .. '>', '<Format' .. action .. '>') end`).mappings;
	v.feed('Q<F4><F1><F3><F5>');
	assert.equal(sheet.cellPresentation.value[0][0].text, '12.50%');
	v.feed('<F4><F1><F3><F10>usdx<F16><F3><F7><F8><F9><F6>65<F3>');
	assert.match(v.formatSession.error, /0 to 64/);
	v.feed('<F16>4<F3>'); // 65 -> 6 -> 64
	assert.equal(v.formatSession.common('formatCurrency'), 'USD');
	assert.equal(v.formatSession.common('formatGroup'), false);
	assert.equal(v.formatSession.common('formatDigits'), 64);
	v.feed('<F4><F1><F2><F1><F3><F11><F12><F13>bad-zone<F3>');
	assert.ok(v.formatSession.error);
	v.feed('<F16><F16><F16><F16><F16><F16><F16><F16>Pacific/Auckland<F3><F15>');
	assert.equal(sheet.styles[0][0].formatKind, 'date');
	assert.equal(sheet.styles[0][0].formatIncludeTime, true);
	assert.equal(sheet.styles[0][0].formatSeconds, false);
	assert.equal(sheet.styles[0][0].formatTimeZone, 'Pacific/Auckland');
	v.feed('Q<F11><F14><F15>'); assert.equal(sheet.styles[0][0].formatIncludeTime, true);
	assert.equal(formatShortcut(v.mappings, 'Currency'), 'F10');
	assert.equal(formatShortcut(v.mappings, 'Backspace'), 'F16');
});

test('precise formula/spill presentation survives save/reopen without changing chart, clipboard or formula values', () => {
	sheet.loadWorkbook({ rows: [['=9007199254740993+0.125', '=VSTACK(0.125,0.13)', '=CHART().line().series(B0:B1)'], ['', '', '']] });
	const before = sheet.getValue(0, 0), v = keyboard();
	v.feed('gFfj<CR>d3<CR><Esc>');
	assert.equal(sheet.cellPresentation.value[0][0].text, '9007199254740993.125');
	assert.equal(sheet.getValue(0, 0), before); assert.equal(sheet.getCopyValue(0, 0), before);
	v.feed('ljgFfj<CR>%d1<CR><Esc>');
	assert.equal(sheet.cellPresentation.value[1][1].text, '13.0%');
	assert.equal(sheet.cellPresentation.value[0][1].text, '0.125');
	assert.equal(sheet.rows[1][1], '');
	assert.deepEqual(sheet.getValue(0, 2).series[0].values, [0.125, 0.13]);
	const saved = JSON.stringify(sheet.serializeWorkbook());
	assert.equal(saved.includes('formatPreview'), false); assert.equal(saved.includes('typed'), false);
	sheet.loadWorkbook(JSON.parse(saved));
	assert.equal(sheet.cellPresentation.value[0][0].text, '9007199254740993.125');
	assert.equal(sheet.cellPresentation.value[1][1].text, '13.0%');
	sheet.rows[0][1] = ''; sheet.recalculate(); assert.equal(sheet.cellPresentation.value[1][1].text, '');
	assert.equal(sheet.styles[1][1].formatPercent, true); // coordinate-local, even after a spill shrinks
	sheet.styles[1][1].fg = 'red'; sheet.styles[1][1].wrap = true;
	sheet.resetAllStyles(); assert.equal(sheet.styles[1][1].fg, 'white');
	assert.equal(sheet.styles[1][1].formatPercent, true); assert.equal(sheet.styles[1][1].wrap, true);
});
