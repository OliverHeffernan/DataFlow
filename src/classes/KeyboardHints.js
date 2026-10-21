const normal = [
	[['h', 'j', 'k', 'l'], 'Move'], [['i', 'a'], 'Edit'], [['<CR>'], 'Formula'],
	[['v'], 'Select'], [['d', 'c', 'y'], 'Operator…'], [['g'], 'Go / fill…'], [['u'], 'Undo'], [['<C-r>'], 'Redo'], [['<C-w>'], 'Window…'], [[':'], 'Command'],
];
const formula = [
	[['h', 'l', 'w', 'b'], 'Text motion'], [['j', 'k'], 'Leave + move cell'], [['i', 'a'], 'Insert'],
	[['v'], 'Select text'], [['d', 'c', 'y'], 'Operator…'], [['g'], 'Go / text lines…'], [['<F4>'], 'Relative ↔ absolute'], [['<C-w>'], 'Window…'], [['<Esc>'], 'Sheet'],
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
const objects = [[['w', 'W'], 'Word'], [['s'], 'Sentence'], [['p'], 'Paragraph']];
const formulaObjects = [
	[['"', "'", '`'], 'Quoted text'], [['(', ')', 'b', '[', ']', '{', '}', 'B', '<', '>'], 'Block'], [['t'], 'Tag'],
];
const prefixes = {
	'<C-w>': [[['h'], 'Left window'], [['j'], 'Lower window'], [['k'], 'Upper window'], [['l'], 'Right window'], [['c'], 'Close window'], [['<Esc>'], 'Cancel']],
	g: [[['g'], 'First row / line'], [['e', 'E'], 'Previous word end'], [['j', 'k'], 'Text line'], [['0', '$'], 'Visible edges'], [['v'], 'Previous selection'], [[';', ','], 'Changes']],
	z: [[['z'], 'Center'], [['t'], 'Top'], [['b'], 'Bottom'], [['h', 'l'], 'Scroll horizontally']],
	'[': [[['(', '{'], 'Unmatched opening'], [["'", '`'], 'Previous mark'], [['['], 'Previous block']],
	']': [[[')', '}'], 'Unmatched closing'], [["'", '`'], 'Next mark'], [[']'], 'Next block']],
};
const names = { '<CR>': 'Enter', '<Esc>': 'Esc', '<Tab>': 'Tab', '<F4>': 'F4', '<C-r>': 'Ctrl R', '<S-CR>': 'Shift Enter' };
const label = keys => {
	const group = keys.join('');
	if (group === '<C-h><C-j><C-k><C-l>') return 'Ctrl H J K L';
	if (group === 'HJKL') return 'H J K L';
	return keys.map(key => names[key] ?? (key === ' ' ? 'Space' : key.replace(/^<|>$/g, ''))).join(' ');
};

export function keyboardHints(keyboard) {
	const prefix = keyboard.mappingKeys;
	const matching = keyboard.mappings.filter(map => map.mode === keyboard.mappingMode && prefix.every((key, i) => map.lhs[i] === key));
	const maps = matching.filter(map => !map.group);
	const enabled = maps.filter(map => map.rhs.join('') !== '<Nop>' && map.lhs.length > prefix.length);
	const custom = [...new Set(enabled.map(map => map.lhs[prefix.length]))].map(key => {
		const children = enabled.filter(map => map.lhs[prefix.length] === key);
		const leaf = children.find(map => map.lhs.length === prefix.length + 1);
		const more = children.some(map => map.lhs.length > prefix.length + 1);
		const group = matching.find(map => map.group && map.lhs.length === prefix.length + 1 && map.lhs[prefix.length] === key);
		const description = leaf ? leaf.desc || `→ ${label(leaf.rhs)}` : group?.desc || '';
		return { key: label([key]), description: description + (more ? `${description ? ' ' : ''}…` : '') };
	});
	if (prefix.length) return custom;
	let defaults;
	if (keyboard.command !== null) defaults = [[['<CR>'], 'Run'], [['<BS>'], 'Backspace'], [['<Esc>'], 'Cancel']];
	else if (keyboard.mode === 'i') defaults = insert.filter(([keys]) => keys[0] !== 'H' || keyboard.reference);
	else {
		const visual = ['v', 'V', 'b'].includes(keyboard.mode);
		const pending = keyboard.pending.replace(/^\d+/, '');
		const operator = !visual ? keyboard.pendingOperator : '';
		const action = operator ? pending.slice(1).replace(/^\d+/, '').replace(/^(v|V|<C-v>)/, '') : pending;
		if ((operator || visual) && /^[ia]$/.test(action)) {
			defaults = [...objects, [['<Esc>'], 'Cancel']];
			if (keyboard.context === 'formula') defaults = [...formulaObjects, ...defaults];
			else if (action === 'i') {
				defaults = [[['c'], 'Cell formula'], ...defaults];
				if (keyboard.canUseValueObject()) defaults = [[['v'], 'Cell value'], ...defaults];
			}
		}
		else if (prefixes[action]) {
			defaults = prefixes[action];
			if (action === 'g' && !operator && keyboard.context === 'sheet') defaults = [...defaults, [['H', 'J', 'K', 'L'], 'Fill']];
		}
		else if (/^(?:[fFtTm'`q@r]|g['`])$/.test(action)) defaults = [[['character'], 'Type target'], [['<Esc>'], 'Cancel']];
		else if (operator) defaults = [[[operator], 'Whole row / line'], ...motions];
		else if (visual) defaults = [...(keyboard.context === 'sheet' ? [[['g'], 'Go / fill…']] : []), [['h', 'j', 'k', 'l'], 'Extend selection'], [['d'], 'Delete'], [['c'], 'Change'], [['y'], 'Yank'], [['i', 'a'], 'Text object…'], [['o'], 'Swap corner'], [['<Esc>'], 'Cancel']];
		else defaults = keyboard.context === 'formula' ? formula : normal;
	}
	if (keyboard.textBuffer && keyboard.command === null && !keyboard.pending) {
		defaults = defaults.filter(([keys]) => !['<F4>', '<C-h>', 'H'].includes(keys[0])).map(([keys, description]) => [keys,
			keys[0] === '<CR>' ? 'Newline' : keys[0] === '<Esc>' ? 'Keep draft · NORMAL' : keys[0] === 'j' ? 'Text line' : description]);
		if (keyboard.mode === 'n') defaults = [[['<CR>'], 'Apply rule'], ...defaults];
		if (keyboard.mode !== 'i') defaults = [...defaults, [['J'], 'Join lines'], [['>', '<'], 'Indent / outdent']];
	}
	const overridden = new Set(maps.map(map => map.lhs[0]));
	return [...custom, ...defaults.map(([keys, description]) => ({ key: label(keys.filter(key => !overridden.has(key))), description })).filter(hint => hint.key)];
}
