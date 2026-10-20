import { clamp, compare, offset, pointAt, resolveMotion, textObject, wordSpans } from './VimMotions.js';
import { defaultTimeoutlen, tokenize } from './LuaKeybindings.js';
import { formulaAssist, toggleReference } from './FormulaEditing.js';

const aliases = { '<Left>': 'h', '<Right>': 'l', '<Up>': 'k', '<Down>': 'j', '<Home>': '0', '<End>': '$', '<BS>': 'h', '<C-h>': 'h', '<C-j>': 'j', '<C-n>': 'j', '<C-p>': 'k', '<C-Right>': 'W', '<C-Left>': 'B', '<S-Right>': 'w', '<S-Left>': 'b', '<C-Home>': 'gg' };
const prefixes = ['g', "g'", 'g`', 'z', '[', ']', 'f', 'F', 't', 'T', 'm', "'", '`', 'q', '@', 'r'];
const isVisual = mode => ['v', 'V', 'b'].includes(mode);
const directions = { h: [0, -1], j: [1, 0], k: [-1, 0], l: [0, 1] };
// Shift-direction extends an active reference; otherwise uppercase letters remain ordinary input.
function directionKey(key, selecting) {
	const match = key.match(/^<(C|S)-([hjkl])>$/), shifted = /^[HJKL]$/.test(key);
	if (!match && !shifted) return null;
	const extend = shifted || match[1] === 'S';
	if (extend && !selecting) return null;
	const [dr, dc] = directions[shifted ? key.toLowerCase() : match[2]];
	return { dr, dc, extend };
}
const relative = (n, open, close) => `${open}${n ? (n > 0 ? '+' : '') + n : ''}${close}`;

// Keyboard state is independent of the DOM so commands, mappings and macros take the same path.
export default class VimKeyboard {
	constructor(sheet, hooks = {}) {
		this.sheet = sheet;
		this.hooks = hooks;
		this.context = 'sheet';
		this.mode = 'n';
		this.pending = '';
		this.command = null;
		this.formulaCursor = 0;
		this.mappingKeys = [];
		this.mappings = [];
		this.timeoutlen = defaultTimeoutlen;
		this.states = { sheet: { marks: {} } }; this.formulaStates = new Map();
		this.jumps = []; this.jumpIndex = 0;
		this.changes = []; this.changeIndex = 0;
		this.macros = new Map(); this.recording = null; this.playing = false;
		this.register = null;
		this.lastChange = [];
		this.changeKeys = [];
		this.reference = null; this.literalKey = null;
		this.completionIndex = 0;
		this.visualValueObject = false;
	}
	get rows() { return this.context === 'sheet' ? this.sheet.rows : this.formula.split('\n').map(line => Array.from(line)); }
	get formula() { return this.sheet.rows[this.sheet.selRow][this.sheet.selCol]; }
	get point() { return this.context === 'sheet' ? { row: this.sheet.selRow, col: this.sheet.selCol } : pointAt(this.rows, this.formulaCursor); }
	get state() {
		if (this.context === 'sheet') return this.states.sheet;
		const key = `${this.sheet.selRow}:${this.sheet.selCol}`;
		if (!this.formulaStates.has(key)) this.formulaStates.set(key, { marks: {} });
		return this.formulaStates.get(key);
	}
	get mappingMode() { return this.command !== null ? 'c' : this.mode === 'i' ? 'i' : isVisual(this.mode) ? 'x' : /^\d*[dcy]/.test(this.pending) ? 'o' : this.context === 'sheet' ? 'n' : 'f'; }

	feed(keys, mapped = true) { for (const key of tokenize(keys)) this.key(key, mapped); }
	key(key, mapped = true) {
		if (key === '<Space>') key = ' ';
		if (key === '<C-[>') key = '<Esc>';
		if (key === '<C-m>') key = '<CR>';
		if (mapped && key !== '<Esc>') {
			this.mappingKeys.push(key);
			const candidates = this.mappings.filter(map => !map.group && map.mode === this.mappingMode && this.mappingKeys.every((k, i) => map.lhs[i] === k));
			const exact = candidates.find(map => map.lhs.length === this.mappingKeys.length);
			if (exact && candidates.length === 1) {
				this.mappingKeys = [];
				for (const rhs of exact.rhs) this.key(rhs, false);
				return;
			}
			if (candidates.length) { this.hooks.pending?.(); this.render(); return; }
			const keys = this.mappingKeys; this.mappingKeys = [];
			const prefix = this.mappings.filter(map => !map.group && map.mode === this.mappingMode && map.lhs.every((k, i) => keys[i] === k)).sort((a, b) => b.lhs.length - a.lhs.length)[0];
			if (prefix) { keys.splice(0, prefix.lhs.length); for (const rhs of prefix.rhs) this.key(rhs, false); }
			else this.key(keys.shift(), false);
			for (const rest of keys) this.key(rest, true);
			return;
		}
		if (key === '<Nop>') return;
		if (this.recording && !this.playing && !(this.mode === 'n' && !this.pending && key === 'q')) this.macros.get(this.recording).push(key);
		this.changeKeys.push(key);
		if (key === '<Esc>' || key === '<C-c>') { this.escape(); this.render(); return; }
		if (this.command !== null) {
			if (key === '<CR>') this.enterCommand();
			else if (key === '<BS>') { this.command = Array.from(this.command).slice(0, -1).join(''); if (!this.command) this.command = null; }
			else if (Array.from(key).length === 1) this.command += key;
			this.render(); return;
		}
		if (this.mode === 'i') { this.insertKey(key); this.render(); return; }
		if (key === '<F4>' && this.context === 'formula' && !this.pending && this.mode === 'n') {
			if (toggleReference(this)) { this.formulaCursor = Math.max(0, this.formulaCursor - 1); this.commit(); }
			this.render(); return;
		}
		if (key === '<CR>' && !this.pending && this.context === 'sheet') { this.editOwner(); this.context = 'formula'; this.formulaCursor = 0; this.state.preferredColumn = 0; this.changeKeys = []; this.render(); return; }
		if (key === '<CR>' && this.pending !== 'z') key = '+';
		this.literalKey = key;
		if (!(key === '<End>' && this.pending.endsWith('g'))) key = aliases[key] || key;
		this.pending += key;
		this.executePending();
		this.render();
	}

	flushMappings() {
		if (!this.mappingKeys.length) return;
		this.mappingKeys = [];
		this.done();
		this.render();
	}

	escape() {
		const cancelling = this.pending || this.command !== null || this.mappingKeys.length;
		this.mappingKeys = []; this.pending = ''; this.command = null; this.reference = null;
		if (this.mode === 'i') {
			this.formulaCursor = Math.max(0, this.formulaCursor - 1);
			this.state.marks['^'] = this.point;
			this.state.preferredColumn = this.point.col;
			this.commit();
		} else if (!isVisual(this.mode) && !cancelling) this.leaveFormula();
		if (this.anchor) this.saveVisual();
		this.anchor = null; this.visualValueObject = false; this.mode = 'n'; this.changeKeys = [];
	}

	move(point, jump = false, keepColumn = false) {
		if (jump && compare(point, this.point)) {
			this.state.marks["'"] = this.point; this.state.marks['`'] = this.point;
			this.jumps = this.jumps.slice(0, this.jumpIndex);
			this.jumps.push(this.location()); this.jumpIndex = this.jumps.length;
		}
		if (this.context === 'sheet') {
			this.sheet.selRow = clamp(point.row, 0, this.sheet.rows.length - 1);
			this.sheet.selCol = clamp(point.col, 0, this.sheet.rows[0].length - 1);
		} else {
			const row = clamp(point.row, 0, this.rows.length - 1), col = clamp(point.col, 0, Math.max(0, this.rows[row].length - 1));
			this.formulaCursor = offset(this.rows, { row, col });
		}
		if (!keepColumn) this.state.preferredColumn = this.point.col;
	}
	leaveFormula() { this.context = 'sheet'; this.reference = null; }
	location() { return { context: this.context, row: this.sheet.selRow, col: this.sheet.selCol, cursor: this.formulaCursor }; }
	restore(location) {
		if (!location) return;
		this.context = location.context; this.reference = null;
		this.sheet.selRow = clamp(location.row, 0, this.sheet.rows.length - 1);
		this.sheet.selCol = clamp(location.col, 0, this.sheet.rows[0].length - 1);
		this.formulaCursor = clamp(location.cursor, 0, Math.max(0, Array.from(this.formula).length - 1));
	}
	commit() {
		this.hooks.change?.();
		this.state.marks['.'] = this.point;
		this.changes.push(this.location()); this.changeIndex = this.changes.length;
		if (!this.playing && this.changeKeys.length) this.lastChange = [...this.changeKeys];
		this.changeKeys = [];
	}
	render() { return this.hooks.render?.(this); }
	message(text) { this.hooks.message?.(text); }
	resetNavigation() {
		this.context = 'sheet'; this.mode = 'n'; this.pending = ''; this.command = null; this.anchor = null; this.reference = null;
		this.visualValueObject = false;
		this.mappingKeys = []; this.formulaCursor = 0; this.states.sheet = { marks: {} }; this.formulaStates.clear();
		this.jumps = []; this.jumpIndex = 0; this.changes = []; this.changeIndex = 0; this.lastVisual = null;
		this.move({ row: 0, col: 0 });
	}
	adjustSheetPositions(axis, at, removed, inserted) {
		const adjust = point => {
			if (point[axis] < at) return point;
			if (point[axis] < at + removed) return null;
			return { ...point, [axis]: point[axis] + inserted - removed };
		};
		this.states.sheet.marks = Object.fromEntries(Object.entries(this.states.sheet.marks).flatMap(([name, point]) => { const next = adjust(point); return next ? [[name, next]] : []; }));
		this.formulaStates = new Map([...this.formulaStates].flatMap(([key, state]) => {
			const [row, col] = key.split(':').map(Number), next = adjust({ row, col });
			return next ? [[`${next.row}:${next.col}`, state]] : [];
		}));
		this.jumps = this.jumps.map(adjust).filter(Boolean); this.jumpIndex = Math.min(this.jumpIndex, this.jumps.length);
		this.changes = this.changes.map(adjust).filter(Boolean); this.changeIndex = Math.min(this.changeIndex, this.changes.length);
		this.lastVisual = null;
	}
	editColumns(at, removed, inserted) {
		this.adjustSheetPositions('col', at, removed, inserted);
		this.sheet.rows.forEach((row, r) => {
			row.splice(at, removed, ...Array(inserted).fill(''));
			this.sheet.styles[r].splice(at, removed, ...Array.from({ length: inserted }, () => ({ ...this.sheet.defaultStyling })));
		});
		this.move({ row: this.sheet.selRow, col: at });
	}

	executePending() {
		const match = this.pending.match(/^([1-9]\d*)?(.*)$/s);
		if (!match || !match[2]) return;
		let explicit = !!match[1];
		let count = clamp(Number(match[1] || 1), 1, 10000), action = match[2], operator = null, force = '';
		if (!isVisual(this.mode) && /^[dcy]/.test(action)) {
			operator = action[0]; action = action.slice(1);
			const motionCount = action.match(/^([1-9]\d*)/);
			if (motionCount) { explicit = true; count = Math.min(10000, count * Number(motionCount[1])); action = action.slice(motionCount[1].length); }
			if (/^(v|V|<C-v>)/.test(action)) { force = action.startsWith('<') ? '<C-v>' : action[0]; action = action.slice(force.length); }
			if (!action) return;
			if (action === operator) {
				this.operate(operator, { start: { row: this.point.row, col: 0 }, end: { row: Math.min(this.rows.length - 1, this.point.row + count - 1), col: 0 }, linewise: true }); this.done(); return;
			}
		}
		// Literal j/k in formula NORMAL leaves the formula and moves the sheet selection; gj/gk, operators and visual j/k stay text motions.
		if (!operator && this.mode === 'n' && this.context === 'formula' && ['j', 'k'].includes(action) && this.literalKey === action) {
			this.leaveFormula();
			this.move({ row: this.sheet.selRow + (action === 'j' ? count : -count), col: this.sheet.selCol });
			this.done(); return;
		}
		if (action === 'q' && this.recording && !operator) { this.recording = null; this.done(); return; }
		if (prefixes.includes(action) || ((operator || isVisual(this.mode)) && ['i', 'a'].includes(action))) return;
		if (action === ':' || action === '/' || action === '?') {
			this.command = action; this.searchOperator = operator; this.searchCount = count; this.done(); return;
		}
		if ((operator || isVisual(this.mode)) && /^[ia].$/us.test(action)) {
			const range = textObject(this.rows, this.point, action, count, this.context === 'sheet');
			if (range) {
				if (range.valueObject && !this.canUseValueObject(range.start, range.end)) {
					this.message('Value text object is unavailable on chart cells'); this.done(); return;
				}
				if (operator) this.operate(operator, range);
				else { this.anchor = range.start; this.visualValueObject = !!range.valueObject; this.mode = range.linewise ? 'V' : 'v'; this.move(range.end); }
			}
			this.done(); return;
		}
		if (!operator && this.action(action, count, explicit)) { this.done(); return; }
		let motion = resolveMotion(this.rows, this.point, action, count, { sheet: this.context === 'sheet', explicit, state: this.state, viewport: this.hooks.viewport?.(this) });
		if (operator === 'c' && /^[wW]$/.test(action) && /\S/u.test(this.rows[this.point.row][this.point.col] || '')) {
			const spans = wordSpans(this.rows, this.context === 'sheet', action === 'W'), index = offset(this.rows, this.point);
			const current = spans.findIndex(([a, b]) => a <= index && b >= index);
			motion = { point: pointAt(this.rows, spans[Math.min(spans.length - 1, current + count - 1)][1]), inclusive: true };
		}
		if (['n', 'N', '*', '#', 'g*', 'g#', 'gn', 'gN'].includes(action)) motion = this.searchMotion(action, count);
		const vertical = ['j', 'k', 'gj', 'gk'].includes(action);
		if (motion && vertical) motion.point.col = Math.min(this.state.preferredColumn ?? this.point.col, Math.max(0, this.rows[motion.point.row].length - 1));
		// An operator-w stops at the last word's line end, without eating its newline.
		if (operator && /^[wW]$/.test(action) && !motion?.inclusive && motion?.point.row > this.point.row && motion.point.col <= this.rows[motion.point.row].findIndex(c => /\S/u.test(c))) {
			motion = { point: { row: motion.point.row - 1, col: Math.max(0, this.rows[motion.point.row - 1].length - 1) }, inclusive: true };
		}
		if (motion) {
			if (motion.range && !operator) { this.anchor = motion.range.start; this.visualValueObject = false; this.mode = 'v'; this.move(motion.range.end); }
			else if (operator) {
				const range = motion.range || this.motionRange(motion, force);
				this.operate(operator, range);
			} else { this.move(motion.point, motion.jump, vertical); if (action === '$') this.state.preferredColumn = Infinity; }
		} else this.message(`No motion: ${action}`);
		this.done();
	}
	done() { this.pending = ''; if (this.mode !== 'i') this.changeKeys = []; }

	motionRange(motion, force = '') {
		let start = this.point, end = motion.point;
		if (compare(start, end) > 0) [start, end] = [end, start];
		let linewise = force === 'V' || (motion.linewise && !force);
		let inclusive = force === 'v' && !motion.linewise ? !motion.inclusive : motion.inclusive;
		if (!inclusive && !linewise && force !== '<C-v>') {
			const index = offset(this.rows, end) - 1;
			if (index < offset(this.rows, start)) return { start, end, empty: true };
			if (end.col === 0 && end.row > start.row) {
				linewise = !force && start.col <= Math.max(0, this.rows[start.row].findIndex(c => /\S/u.test(c)));
				end = { row: end.row - 1, col: linewise ? 0 : Math.max(0, this.rows[end.row - 1].length - (this.context === 'sheet' ? 1 : 0)) };
			} else end = pointAt(this.rows, index);
		}
		return { start, end, linewise, block: force === '<C-v>' };
	}

	action(action, count, explicit = false) {
		if (isVisual(this.mode) && ['d', 'c', 'y', 'x'].includes(action)) {
			const range = { start: this.anchor, end: this.point, linewise: this.mode === 'V', block: this.mode === 'b', valueObject: this.visualValueObject };
			this.saveVisual(); this.operate(action === 'x' ? 'd' : action[0], range); return true;
		}
		if (['v', 'V', '<C-v>'].includes(action)) {
			const mode = action === '<C-v>' ? 'b' : action;
			if (this.mode === mode) { this.saveVisual(); this.anchor = null; this.mode = 'n'; }
			else { if (!this.anchor) this.visualValueObject = false; this.anchor ||= this.point; this.mode = mode; }
			return true;
		}
		if (action === 'o' && isVisual(this.mode)) { const point = this.point; this.move(this.anchor); this.anchor = point; return true; }
		if (action === 'gv' && this.lastVisual) { this.restore(this.lastVisual.location); this.mode = this.lastVisual.mode; this.anchor = this.lastVisual.anchor; this.visualValueObject = this.lastVisual.valueObject; this.move(this.lastVisual.end); return true; }
		if (/^m[a-zA-Z'`]$/.test(action)) { this.state.marks[action[1]] = this.point; return true; }
		if (['<C-o>', '<C-i>', '<Tab>', 'g;', 'g,'].includes(action)) {
			const change = action.startsWith('g'), list = change ? this.changes : this.jumps, name = change ? 'changeIndex' : 'jumpIndex';
			if (!list.length) return true;
			if (!change && this[name] === list.length) list.push(this.location());
			this[name] = clamp(this[name] + (['<C-o>', 'g;'].includes(action) ? -count : count), 0, list.length - 1);
			this.restore(list[this[name]]); return true;
		}
		if (['i', 'a', 'I', 'A', 's', 'S', 'C', 'D', 'x', 'X'].includes(action)) {
			if (action === 'S') {
				this.operate('c', { start: { row: this.point.row, col: 0 }, end: { row: Math.min(this.rows.length - 1, this.point.row + count - 1), col: 0 }, linewise: true }); return true;
			}
			if (action === 'C' || action === 'D') {
				const motion = resolveMotion(this.rows, this.point, '$', count);
				this.operate(action === 'C' ? 'c' : 'd', this.motionRange(motion)); return true;
			}
			if (['s', 'x', 'X'].includes(action)) {
				const point = this.point, last = Math.max(0, this.rows[point.row].length - 1);
				const start = { row: point.row, col: action === 'X' ? Math.max(0, point.col - count) : point.col };
				const end = { row: point.row, col: action === 'X' ? Math.max(0, point.col - 1) : Math.min(last, point.col + count - 1) };
				this.operate(action === 's' ? 'c' : 'd', { start, end, empty: !this.rows[point.row].length || (action === 'X' && point.col === 0) }); return true;
			}
			if (this.context === 'sheet') { this.editOwner(); this.context = 'formula'; this.formulaCursor = 0; }
			const row = this.point.row, line = this.rows[row], base = offset(this.rows, { row, col: 0 });
			if (action === 'I') this.formulaCursor = base + Math.max(0, line.findIndex(c => /\S/u.test(c)));
			if (action === 'A') this.formulaCursor = base + line.length;
			if (action === 'a') this.formulaCursor = Math.min(base + line.length, this.formulaCursor + 1);
			this.mode = 'i'; return true;
		}
		if (['o', 'O'].includes(action)) {
			if (this.context === 'sheet') {
				const at = this.sheet.selRow + (action === 'o' ? 1 : 0), cols = this.sheet.rows[0].length;
				this.adjustSheetPositions('row', at, 0, count);
				this.sheet.rows.splice(at, 0, ...Array.from({ length: count }, () => Array(cols).fill('')));
				this.sheet.styles.splice(at, 0, ...Array.from({ length: count }, () => Array.from({ length: cols }, () => ({ ...this.sheet.defaultStyling }))));
				this.sheet.selRow = at; this.sheet.selCol = 0; this.context = 'formula'; this.formulaCursor = 0;
			} else {
				const rows = this.rows, at = this.point.row + (action === 'o' ? 1 : 0);
				rows.splice(at, 0, ...Array(count).fill([])); this.setFormula(rows.map(row => row.join('')).join('\n'));
				this.formulaCursor = offset(this.rows, { row: at, col: 0 });
			}
			this.mode = 'i'; return true;
		}
		if (action === 'p' || action === 'P') { this.put(action === 'P', count); return true; }
		if (action === 'u' || action === '<C-r>') { this.hooks.undo?.(action === '<C-r>', count); return true; }
		if (action === '.' && this.lastChange.length && !this.playing) { this.replay(Array(count).fill(this.lastChange).flat()); return true; }
		if (action === 'q' && this.recording) { this.recording = null; return true; }
		if (/^q[a-z]$/.test(action)) { this.recording = action[1]; this.macros.set(this.recording, []); return true; }
		if (/^@[a-z@]$/.test(action)) { const name = action[1] === '@' ? this.lastMacro : action[1]; this.lastMacro = name; this.replay(Array(count).fill(this.macros.get(name) || []).flat()); return true; }
		if (/^r.$/us.test(action) && this.context === 'formula') {
			if (count > this.rows[this.point.row].length - this.point.col) return true;
			const text = Array.from(this.formula); text.splice(this.formulaCursor, count, ...Array(count).fill(Array.from(action)[1])); this.setFormula(text.join('')); this.commit(); return true;
		}
		if (['zz', 'zt', 'zb', 'z.', 'z<CR>', 'z-', 'zh', 'zl', 'zH', 'zL', 'zs', 'ze', '<C-e>', '<C-y>', '<C-d>', '<C-u>', '<C-f>', '<C-b>', '<PageDown>', '<PageUp>'].includes(action)) {
			if (['z.', 'z<CR>', 'z-'].includes(action)) this.move(resolveMotion(this.rows, this.point, '^').point);
			this.hooks.scroll?.(action, count, explicit); return true;
		}
		return false;
	}

	replay(keys) {
		if (this.playing) { this.message('Recursive macro/repeat blocked'); return; }
		this.pending = ''; this.playing = true;
		try { for (const key of keys.slice(0, 10000)) this.key(key, false); }
		finally { this.playing = false; }
	}
	saveVisual() {
		this.lastVisual = { mode: this.mode, anchor: { ...this.anchor }, end: this.point, location: this.location(), valueObject: this.visualValueObject };
		this.state.marks['<'] = compare(this.anchor, this.point) < 0 ? this.anchor : this.point;
		this.state.marks['>'] = compare(this.anchor, this.point) < 0 ? this.point : this.anchor;
	}
	canUseValueObject(start = this.point, end = start) {
		if (this.context !== 'sheet') return false;
		for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
			for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col++) {
				if (this.sheet.getElementValue?.(row, col)?.kind === 'chart') return false;
			}
		}
		return true;
	}
	setFormula(text) { this.sheet.rows[this.sheet.selRow][this.sheet.selCol] = text; }
	editOwner() {
		const owner = this.sheet.spillCells?.get(`${this.sheet.selRow}:${this.sheet.selCol}`);
		if (owner) this.move(owner);
	}
	protectSpill(start, end) {
		const contains = (row, col) => row >= start.row && row <= end.row && col >= start.col && col <= end.col;
		for (const [key, owner] of this.sheet.spillCells ?? []) {
			const [row, col] = key.split(':').map(Number);
			if (contains(row, col) && !contains(owner.row, owner.col)) {
				this.message(`Spill output is read-only; edit ${this.sheet.columnLabel(owner.col)}${owner.row}`);
				this.anchor = null; this.mode = 'n'; this.move(owner); return true;
			}
		}
		return false;
	}
	insertKey(key) {
		const assist = formulaAssist(this.formula, this.formulaCursor);
		if (assist.suggestions.length && ['<Up>', '<Down>'].includes(key)) {
			this.completionIndex = (this.completionIndex + (key === '<Down>' ? 1 : -1) + assist.suggestions.length) % assist.suggestions.length;
			this.reference = null; return;
		}
		if (key === '<Tab>' && assist.suggestions.length) {
			const text = Array.from(this.formula), name = assist.suggestions[this.completionIndex % assist.suggestions.length];
			text.splice(this.formulaCursor - assist.prefix.length, assist.prefix.length, ...`${name}()`);
			this.formulaCursor += name.length - assist.prefix.length + 1;
			this.setFormula(text.join('')); this.reference = null; this.completionIndex = 0; return;
		}
		this.completionIndex = 0;
		if (key === '<F4>') { toggleReference(this); return; }
		const direction = directionKey(key, this.reference);
		if (direction) { this.insertReference(direction); return; }
		this.reference = null;
		key = key.replace(/^<S-([hjkl])>$/, (_, letter) => letter.toUpperCase());
		const text = Array.from(this.formula);
		// Enter commits the edit and returns to the sheet on the same cell; Shift-Enter inserts a newline.
		if (key === '<CR>') { this.escape(); this.leaveFormula(); return; }
		if (key === '<S-CR>') key = '\n';
		if (key === '<Left>') { this.formulaCursor = Math.max(0, this.formulaCursor - 1); return; }
		if (key === '<Right>') { this.formulaCursor = Math.min(text.length, this.formulaCursor + 1); return; }
		if (key === '<Home>' || key === '<C-a>') { this.formulaCursor = 0; return; }
		if (key === '<End>' || key === '<C-e>') { this.formulaCursor = text.length; return; }
		if (key === '<BS>') { if (this.formulaCursor) text.splice(--this.formulaCursor, 1); }
		else if (key === '<Del>') text.splice(this.formulaCursor, 1);
		else if (key === '<C-w>') {
			const before = text.slice(0, this.formulaCursor).join(''), trimmed = before.replace(/\s*\S+\s*$/u, '');
			text.splice(Array.from(trimmed).length, this.formulaCursor - Array.from(trimmed).length); this.formulaCursor = Array.from(trimmed).length;
		} else if (key === '<C-u>') { text.splice(0, this.formulaCursor); this.formulaCursor = 0; }
		else if (Array.from(key).length === 1 || key === '<Tab>') { text.splice(this.formulaCursor++, 0, key === '<Tab>' ? '\t' : key); }
		this.setFormula(text.join(''));
	}
	// Positions are absolute sheet cells; the inserted token is relative to the edited cell. A session survives only
	// while the token is unchanged and the caret still sits directly after it.
	insertReference({ dr, dc, extend }) {
		const origin = { row: this.sheet.selRow, col: this.sheet.selCol }, text = Array.from(this.formula);
		let ref = this.reference;
		const intact = ref && ref.origin.row === origin.row && ref.origin.col === origin.col && this.formulaCursor === ref.start + ref.length
			&& text.slice(ref.start, ref.start + ref.length).join('') === ref.token;
		if (!intact) ref = { start: Math.min(this.formulaCursor, text.length), length: 0, token: '', origin, anchor: extend ? origin : null, end: origin };
		else if (extend && !ref.anchor) ref = { ...ref, anchor: ref.end };
		const end = { row: clamp(ref.end.row + dr, 0, this.sheet.rows.length - 1), col: clamp(ref.end.col + dc, 0, this.sheet.rows[0].length - 1) };
		const cell = point => relative(point.col - origin.col, '[', ']') + relative(point.row - origin.row, '{', '}');
		const token = ref.anchor
			? `${cell({ row: Math.min(ref.anchor.row, end.row), col: Math.min(ref.anchor.col, end.col) })}:${cell({ row: Math.max(ref.anchor.row, end.row), col: Math.max(ref.anchor.col, end.col) })}`
			: cell(end);
		const units = Array.from(token);
		text.splice(ref.start, ref.length, ...units);
		this.setFormula(text.join(''));
		this.formulaCursor = ref.start + units.length;
		this.reference = { ...ref, end, token, length: units.length };
	}

	operate(operator, range) {
		let { start, end, linewise, block, empty, values } = range;
		if (empty && operator !== 'c') return;
		const sheetContext = this.context === 'sheet';
		if (compare(start, end) > 0) [start, end] = [end, start];
		this.state.marks['['] = start; this.state.marks[']'] = end;
		if (this.context === 'sheet') {
			const left = linewise ? 0 : Math.min(start.col, end.col), right = linewise ? this.rows[0].length - 1 : Math.max(start.col, end.col);
			if (range.valueObject && !this.canUseValueObject({ row: start.row, col: left }, { row: end.row, col: right })) {
				this.message('Value text object is unavailable on chart cells'); return;
			}
			if (operator !== 'y' && this.protectSpill({ row: start.row, col: left }, { row: end.row, col: right })) return;
			values ||= range.valueObject;
			const cells = this.rows.slice(start.row, end.row + 1).map((row, r) => row.slice(left, right + 1).map((value, c) => values ? String(this.sheet.getCopyValue?.(start.row + r, left + c) ?? value) : value));
			this.register = { cells, linewise, text: cells.map(row => row.join('\t')).join('\n') };
			if (operator !== 'y' && !empty) {
				if (linewise && operator === 'd') {
					this.adjustSheetPositions('row', start.row, end.row - start.row + 1, 0);
					this.sheet.rows.splice(start.row, end.row - start.row + 1); this.sheet.styles.splice(start.row, end.row - start.row + 1);
					if (!this.sheet.rows.length) { this.sheet.rows.push(Array(right + 1).fill('')); this.sheet.styles.push(Array.from({ length: right + 1 }, () => ({ ...this.sheet.defaultStyling }))); }
				} else for (let r = start.row; r <= end.row; r++) for (let c = left; c <= right; c++) this.sheet.rows[r][c] = '';
			}
			this.move({ row: start.row, col: left });
		} else {
			const text = Array.from(this.formula), rows = this.rows;
			let a = offset(rows, start), b = offset(rows, end) + (empty ? 0 : 1);
			if (linewise) {
				const selected = rows.slice(start.row, end.row + 1).map(row => row.join(''));
				this.register = { text: selected.join('\n') + '\n', linewise: true };
				if (operator !== 'y') {
					rows.splice(start.row, end.row - start.row + 1, ...(operator === 'c' ? [[]] : []));
					if (!rows.length) rows.push([]);
					this.setFormula(rows.map(row => row.join('')).join('\n'));
				}
				a = offset(this.rows, { row: Math.min(start.row, this.rows.length - 1), col: 0 });
			} else if (block) {
				const left = Math.min(start.col, end.col), right = Math.max(start.col, end.col);
				const selected = rows.slice(start.row, end.row + 1).map(row => row.slice(left, right + 1).join(''));
				this.register = { text: selected.join('\n'), block: true, width: right - left + 1 };
				if (operator !== 'y') { for (let r = start.row; r <= end.row; r++) rows[r].splice(left, right - left + 1); this.setFormula(rows.map(row => row.join('')).join('\n')); }
				a = offset(this.rows, { row: start.row, col: Math.min(left, this.rows[start.row].length) });
			} else {
				this.register = { text: text.slice(a, b).join(''), linewise };
				if (operator !== 'y') { text.splice(a, b - a); this.setFormula(text.join('')); }
			}
			this.formulaCursor = Math.min(a, Math.max(0, Array.from(this.formula).length - (operator === 'c' ? 0 : 1)));
		}
		this.hooks.copy?.(this.register);
		this.anchor = null; this.visualValueObject = false; this.mode = 'n';
		if (operator === 'c') { this.context = 'formula'; this.mode = 'i'; if (sheetContext) this.formulaCursor = 0; }
		else if (operator !== 'y') this.commit();
	}

	put(before, count) {
		if (!this.register) return;
		if (this.context === 'sheet') {
			const cells = this.register.cells || [[this.register.text]];
			let row = this.sheet.selRow;
			if (this.register.linewise) {
				row += before ? 0 : 1;
				const width = this.rows[0].length;
				const copies = Array.from({ length: count }, () => cells.map(r => Array.from({ length: width }, (_, c) => r[c] ?? ''))).flat();
				this.adjustSheetPositions('row', row, 0, copies.length);
				this.sheet.rows.splice(row, 0, ...copies);
				this.sheet.styles.splice(row, 0, ...copies.map(r => r.map(() => ({ ...this.sheet.defaultStyling }))));
			} else {
				const end = { row: row + cells.length * count - 1, col: this.sheet.selCol + Math.max(...cells.map(line => line.length)) - 1 };
				if (this.protectSpill(this.point, end)) return;
				for (let n = 0; n < count; n++) for (let r = 0; r < cells.length && row + r + n * cells.length < this.rows.length; r++) {
					for (let c = 0; c < cells[r].length && this.sheet.selCol + c < this.rows[0].length; c++) this.sheet.rows[row + r + n * cells.length][this.sheet.selCol + c] = cells[r][c];
				}
			}
			this.move({ row, col: this.sheet.selCol });
		} else {
			const rows = this.rows, point = this.point;
			if (this.register.linewise) {
				const at = point.row + (before ? 0 : 1), lines = this.register.text.replace(/\n$/, '').split('\n');
				rows.splice(at, 0, ...Array(count).fill(lines).flat().map(line => Array.from(line)));
				this.setFormula(rows.map(row => row.join('')).join('\n')); this.move({ row: at, col: 0 });
			} else if (this.register.block) {
				const at = point.col + (before ? 0 : 1);
				this.register.text.split('\n').forEach((line, index) => {
					while (rows.length <= point.row + index) rows.push([]);
					const row = rows[point.row + index];
					while (row.length < at) row.push(' ');
					row.splice(at, 0, ...Array.from(line.padEnd(this.register.width, ' ').repeat(count)));
				});
				this.setFormula(rows.map(row => row.join('')).join('\n')); this.move({ row: point.row, col: at });
			} else {
				const units = Array.from(this.formula), at = Math.min(offset(rows, { row: point.row, col: rows[point.row].length }), this.formulaCursor + (before ? 0 : 1)), inserted = Array.from(this.register.text.repeat(count));
				units.splice(at, 0, ...inserted); this.setFormula(units.join('')); this.formulaCursor = at + Math.max(0, inserted.length - 1);
			}
		}
		this.commit();
	}

	enterCommand() {
		const command = this.command; this.command = null;
		if (command.startsWith(':')) this.hooks.ex?.(command);
		else {
			this.state.search = { pattern: command.slice(1) || this.state.search?.pattern, direction: command[0] === '/' ? 1 : -1 };
			const motion = this.searchMotion('n', this.searchCount || 1);
			if (motion) { if (this.searchOperator) this.operate(this.searchOperator, this.motionRange(motion)); else this.move(motion.point, true); }
		}
		this.searchOperator = null;
	}
	searchMotion(action, count) {
		if (['*', '#', 'g*', 'g#'].includes(action)) {
			const spans = wordSpans(this.rows, this.context === 'sheet'), index = offset(this.rows, this.point);
			const span = spans.find(([a, b]) => a <= index && b >= index);
			if (!span) return null;
			const units = this.rows.flatMap((row, i) => i ? ['\n', ...row] : row);
			const word = units.slice(span[0], span[1] + 1).join('');
			this.state.search = { pattern: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), direction: action.endsWith('#') ? -1 : 1, whole: action.length === 1 };
		}
		const search = this.state.search;
		if (!search?.pattern) return null;
		let regex;
		try { regex = new RegExp(search.whole ? `(?<![\\p{L}\\p{N}_])(?:${search.pattern})(?![\\p{L}\\p{N}_])` : search.pattern, 'gu'); }
		catch (error) { this.message(`Invalid search: ${error.message}`); return null; }
		const matches = [];
		if (this.context === 'sheet') {
			this.rows.forEach((row, r) => row.forEach((text, c) => { regex.lastIndex = 0; if (regex.test(text)) matches.push({ point: { row: r, col: c }, end: { row: r, col: c } }); }));
		} else {
			for (const match of this.formula.matchAll(regex)) {
				const index = Array.from(this.formula.slice(0, match.index)).length;
				matches.push({ point: pointAt(this.rows, index), end: pointAt(this.rows, index + Math.max(0, Array.from(match[0]).length - 1)) });
			}
		}
		if (!matches.length) { this.message(`Pattern not found: ${search.pattern}`); return null; }
		const direction = action === 'gn' ? 1 : action === 'gN' ? -1 : search.direction * (action === 'N' ? -1 : 1);
		const ordered = direction > 0 ? matches : [...matches].reverse();
		const select = action === 'gn' || action === 'gN';
		let index = select ? ordered.findIndex(match => compare(match.point, this.point) <= 0 && compare(match.end, this.point) >= 0) : -1;
		if (index < 0) index = ordered.findIndex(match => direction * compare(match.point, this.point) > 0);
		if (index < 0) index = 0;
		const match = ordered[(index + count - 1) % ordered.length];
		return { point: match.point, jump: true, range: select ? { start: match.point, end: match.end } : null };
	}
}
