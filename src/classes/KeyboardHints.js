const normal = [
	[['h', 'j', 'k', 'l'], 'Move'], [['i', 'a'], 'Edit'], [['<CR>'], 'Formula'],
	[['v'], 'Select'], [['d', 'c', 'y'], 'Operator…'], [['yic'], 'Yank formula'], [['yiv'], 'Yank value'], [['g'], 'Go…'], [['u'], 'Undo'], [['<C-r>'], 'Redo'], [[':'], 'Command'],
];
const formula = [
	[['h', 'l', 'w', 'b'], 'Text motion'], [['j', 'k'], 'Leave + move cell'], [['i', 'a'], 'Insert'],
	[['v'], 'Select text'], [['d', 'c', 'y'], 'Operator…'], [['g'], 'Go / text lines…'], [['<F4>'], 'Relative ↔ absolute'], [['<Esc>'], 'Sheet'],
];
const insert = [
	[['<CR>'], 'Commit → NORMAL'], [['<Esc>'], 'Formula NORMAL'],
	[['<C-h>', '<C-j>', '<C-k>', '<C-l>'], 'Relative cell'], [['H', 'J', 'K', 'L'], 'Extend range'],
	[['<Tab>'], 'Complete'], [['<F4>'], 'Relative ↔ absolute'], [['<S-CR>'], 'Newline'],
];
const motions = [
	[['h', 'j', 'k', 'l'], 'Motion'], [['w', 'b', 'e'], 'Word'], [['$', '0'], 'Line edge'],
	[['i', 'a'], 'Text object…'], [['<Esc>'], 'Cancel'],
];
const prefixes = {
	g: [[['g'], 'First row / line'], [['e', 'E'], 'Previous word end'], [['j', 'k'], 'Text line'], [['0', '$'], 'Visible edges'], [['v'], 'Previous selection'], [[';', ','], 'Changes']],
	z: [[['z'], 'Center'], [['t'], 'Top'], [['b'], 'Bottom'], [['h', 'l'], 'Scroll horizontally']],
	'[': [[['(', '{'], 'Unmatched opening'], [["'", '`'], 'Previous mark'], [['['], 'Previous block']],
	']': [[[')', '}'], 'Unmatched closing'], [["'", '`'], 'Next mark'], [[']'], 'Next block']],
};
const names = { '<CR>': 'Enter', '<Esc>': 'Esc', '<Tab>': 'Tab', '<F4>': 'F4', '<C-r>': 'Ctrl R', '<S-CR>': 'Shift Enter' };
const label = keys => {
	const group = keys.join('');
	if (group === '<C-h><C-j><C-k><C-l>') return 'Ctrl H J K L';
	if (group === 'HJKL') return 'Shift H J K L';
	return keys.map(key => names[key] ?? (key === ' ' ? 'Space' : key.replace(/^<|>$/g, ''))).join(' ');
};

export function keyboardHints(keyboard) {
	const prefix = keyboard.mappingKeys;
	const maps = keyboard.mappings.filter(map => map.mode === keyboard.mappingMode && prefix.every((key, i) => map.lhs[i] === key));
	const custom = maps.filter(map => map.rhs.join('') !== '<Nop>').map(map => ({
		key: label(map.lhs.slice(prefix.length)), description: map.desc || `→ ${label(map.rhs)}`,
	}));
	if (prefix.length) return custom;
	let defaults;
	if (keyboard.command !== null) defaults = [[['<CR>'], 'Run'], [['<BS>'], 'Backspace'], [['<Esc>'], 'Cancel']];
	else if (keyboard.mode === 'i') defaults = insert.filter(([keys]) => keys[0] !== 'H' || keyboard.reference);
	else if (['v', 'V', 'b'].includes(keyboard.mode)) defaults = [[['h', 'j', 'k', 'l'], 'Extend selection'], [['d'], 'Delete'], [['c'], 'Change'], [['y'], 'Yank'], [['o'], 'Swap corner'], [['<Esc>'], 'Cancel']];
	else {
		const pending = keyboard.pending.replace(/^\d+/, '');
		if (/^[dcy]/.test(pending)) {
			defaults = [[[pending[0]], 'Whole row / line'], ...motions];
			if (keyboard.context === 'sheet') {
				defaults = [[['ic'], 'Cell formula'], ...defaults];
				if (keyboard.canUseValueObject()) defaults = [[['iv'], 'Cell value'], ...defaults];
			}
		}
		else if (prefixes[pending]) defaults = prefixes[pending];
		else if (/^[fFtTm'`q@r]$/.test(pending)) defaults = [[['character'], 'Type target'], [['<Esc>'], 'Cancel']];
		else defaults = keyboard.context === 'formula' ? formula : normal.filter(([keys]) => keys[0] !== 'yiv' || keyboard.canUseValueObject());
	}
	const overridden = new Set(maps.filter(map => map.lhs.length === 1).map(map => map.lhs[0]));
	return [...custom, ...defaults.map(([keys, description]) => ({ key: label(keys.filter(key => !overridden.has(key))), description })).filter(hint => hint.key)];
}
