import { tokenize } from './LuaKeybindings.js';

// The only default key definitions. Controls and hints resolve these through current Lua mappings.
export const formatBindings = [
	['j', 'Next'], ['<Down>', 'Next'], ['k', 'Previous'], ['<Up>', 'Previous'],
	['<CR>', 'Select'], ['f', 'Type'], ['%', 'Percent'], ['d', 'Digits'],
	['+', 'Increase'], ['-', 'Decrease'], [',', 'Group'], ['c', 'Currency'],
	['t', 'Time'], ['s', 'Seconds'], ['z', 'Zone'], ['u', 'Revert'],
	['<Esc>', 'Done'], ['<BS>', 'Backspace'], ['<Del>', 'Backspace'],
].map(([keys, action]) => ({ mode: 'format', lhs: tokenize(keys), rhs: [`<Format${action}>`] }));
const openBinding = { lhs: tokenize('gF'), rhs: ['<FormatOpen>'] };
const same = (a, b) => a.length === b.length && a.every((key, i) => key === b[i]);
const starts = (a, b) => b.every((key, i) => a[i] === key);

export function effectiveFormatBindings(mappings, mode = 'format') {
	const custom = mappings.filter(map => !map.group && map.mode === mode);
	const defaults = mode === 'format' ? formatBindings : ['n', 'f', 'x'].includes(mode) ? [openBinding] : [];
	return [...custom, ...defaults.filter(map => !custom.some(other => starts(map.lhs, other.lhs) || starts(other.lhs, map.lhs)))];
}

export function formatAction(keys, mode = 'format') {
	if (keys.length === 1 && /^<Format[A-Za-z]+>$/.test(keys[0])) return keys[0].slice(7, -1);
	return (mode === 'format' ? formatBindings : [openBinding]).find(map => same(keys, map.lhs))?.rhs[0].slice(7, -1);
}

export const keyLabel = keys => keys.map(key => ({ '<CR>': 'Enter', '<Esc>': 'Esc', '<BS>': 'Backspace', '<Del>': 'Delete', '<Up>': '↑', '<Down>': '↓', '<Tab>': 'Tab', ' ': 'Space' })[key]
	?? (key.startsWith('<') ? key.slice(1, -1).replace(/^C-/, 'Ctrl ').replace(/^S-/, 'Shift ') : key)).join(keys.every(key => key.length === 1 && key !== ' ') ? '' : ' ');

export function formatShortcut(mappings, action, mode = 'format') {
	const bindings = effectiveFormatBindings(mappings, mode);
	return keyLabel(bindings.find(map => formatAction(map.rhs, mode) === action && !bindings.some(other => other !== map && starts(other.lhs, map.lhs)))?.lhs ?? []);
}
