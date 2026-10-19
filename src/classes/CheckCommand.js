import { nextTick } from 'vue';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import VisualManager from './VisualManager.js';
import FileManager from './FileManager.js';
import LaunchManager from './LaunchManager.js';
import VimKeyboard from './VimKeyboard.js';
import { compare, offset } from './VimMotions.js';
import { configTemplate } from './LuaKeybindings.js';

export default class CheckCommand {
	constructor() {
		if (CheckCommand.instance) return CheckCommand.instance;
		CheckCommand.instance = this;
		this.sheet = new SheetManager();
		this.history = new HistoryManager();
		this.visual = new VisualManager();
		this.keyboard = new VimKeyboard(this.sheet, {
			render: () => this.render(),
			message: text => this.setPhMessage(text),
			ex: command => this.handleEnterFromCom(command),
			change: () => { this.syncSize(); this.history.do(this.sheet); nextTick(() => this.sheet.loadAllCells()); },
			undo: (redo, count) => { this.history[redo ? 'redo' : 'undo'](this.sheet, count); this.keyboard.move(this.keyboard.point); },
			copy: register => {
				if (register.cells) this.sheet.yank(register.cells);
				navigator.clipboard?.writeText(register.text).catch(() => {});
			},
			pending: () => { clearTimeout(this.mappingTimer); this.mappingTimer = setTimeout(() => this.keyboard.flushMappings(), 500); },
			viewport: keyboard => this.viewport(keyboard),
			scroll: (action, count, explicit) => this.scroll(action, count, explicit),
		});
		this.loadConfig().catch(error => this.setPhMessage(`init.lua: ${error.message}`));
	}
	get mode() { return this.keyboard.mode; }
	setPhMessage(text) { document.getElementById('commandLine').placeholder = text; }
	syncSize() { this.sheet.numOfRows.value = this.sheet.rows.length; this.sheet.numOfCols.value = this.sheet.rows[0].length; }
	newSheet() { this.keyboard.resetNavigation(); this.history.reset(this.sheet); this.renderedRow = null; this.render(); }

	async render() {
		const keyboard = this.keyboard;
		this.syncSize();
		await nextTick();
		this.visual.exitVisual();
		const row = this.sheet.selRow, col = this.sheet.selCol;
		// Keep scrolling a motion's responsibility; formula edits and Ex typing must not reset the viewport.
		if (this.renderedRow !== row || this.renderedCol !== col) this.sheet.selectCell(row, col);
		this.renderedRow = row; this.renderedCol = col;
		this.sheet.tempForm = keyboard.formula;
		this.sheet.updateEditFormula(keyboard.formula);
		this.sheet.cellCurPos = keyboard.context === 'formula' ? keyboard.formulaCursor : 0;
		this.renderFormulaCursor();
		if (keyboard.anchor && keyboard.context === 'sheet') {
			const start = keyboard.anchor;
			this.visual.sheetSelection = true;
			this.visual.startVisual(start.row, keyboard.mode === 'V' ? 0 : start.col, 0, keyboard.mode === 'V', this.sheet.rows[0].length);
			this.visual.setVisual(row, col, 0, this.sheet.rows[0].length);
		}
		const names = { n: 'NORMAL', i: 'INSERT', v: 'VISUAL', V: 'VISUAL-LINE', b: 'VISUAL-BLOCK' };
		document.getElementById('modeDisplay').innerText = `-- ${keyboard.context === 'formula' ? 'FORMULA ' : ''}${names[keyboard.mode]} --`;
		const input = document.getElementById('commandLine');
		input.value = keyboard.command ?? keyboard.pending + keyboard.mappingKeys.join('');
		input.setAttribute('aria-label', keyboard.command !== null ? 'Command or search' : 'Spreadsheet keyboard commands');
		input.setSelectionRange(input.value.length, input.value.length);
	}

	renderFormulaCursor() {
		const keyboard = this.keyboard, bar = document.getElementById('newFormBar'), text = document.getElementById('formText');
		const cursor = document.getElementById('formCursor'), selection = document.getElementById('formSelection');
		selection.replaceChildren();
		// Give a trailing empty line a measurable caret and line box without changing the formula.
		const endMarker = document.createElement('span');
		endMarker.setAttribute('aria-hidden', 'true'); endMarker.textContent = '\u200b'; text.append(endMarker);
		const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), nodes = [];
		let node, length = 0;
		while ((node = walker.nextNode())) { nodes.push({ node, start: length, end: length + node.length }); length += node.length; }
		const utf16 = index => Array.from(keyboard.formula).slice(0, index).join('').length;
		const locate = index => {
			const part = nodes.find(part => index < part.end) || nodes.at(-1);
			return part ? [part.node, Math.min(part.node.length, index - part.start)] : [text, 0];
		};
		const range = document.createRange(), at = utf16(this.sheet.cellCurPos), units = Array.from(keyboard.formula);
		range.setStart(...locate(at)); range.setEnd(...locate(utf16(this.sheet.cellCurPos + (units[this.sheet.cellCurPos] === '\n' ? 0 : 1))));
		const rect = range.getBoundingClientRect(), base = bar.getBoundingClientRect();
		const x = rect.height ? rect.left - base.left + bar.scrollLeft : 0, y = rect.height ? rect.top - base.top + bar.scrollTop : 0;
		cursor.className = keyboard.mode === 'i' ? 'i' : 'n';
		Object.assign(cursor.style, { marginLeft: '0', left: `${x}px`, top: `${y}px`, width: rect.width ? `${rect.width}px` : '1ch' });
		if (keyboard.context !== 'formula') return;
		if (x < bar.scrollLeft) bar.scrollLeft = x;
		else if (x + 12 > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = x + 12 - bar.clientWidth;
		if (y < bar.scrollTop) bar.scrollTop = y;
		else if (y + 20 > bar.scrollTop + bar.clientHeight) bar.scrollTop = y + 20 - bar.clientHeight;
		if (!keyboard.anchor) return;
		let start = keyboard.anchor, end = keyboard.point;
		if (compare(start, end) > 0) [start, end] = [end, start];
		const rows = keyboard.rows;
		const highlight = (a, b) => {
			for (const part of nodes) {
				if (a >= part.end || b <= part.start) continue;
				range.setStart(part.node, Math.max(0, a - part.start)); range.setEnd(part.node, Math.min(part.node.length, b - part.start));
				for (const rect of range.getClientRects()) {
					const span = document.createElement('span');
					Object.assign(span.style, { left: `${rect.left - base.left + bar.scrollLeft}px`, top: `${rect.top - base.top + bar.scrollTop}px`, width: `${Math.max(1, rect.width)}px`, height: `${rect.height}px` });
					selection.append(span);
				}
			}
		};
		if (keyboard.mode === 'b' || keyboard.mode === 'V') {
			for (let row = start.row; row <= end.row; row++) {
				const left = keyboard.mode === 'V' ? 0 : Math.min(start.col, end.col), right = keyboard.mode === 'V' ? rows[row].length : Math.max(start.col, end.col) + 1;
				highlight(utf16(offset(rows, { row, col: Math.min(left, rows[row].length) })), utf16(offset(rows, { row, col: Math.min(right, rows[row].length) })));
			}
		} else highlight(utf16(offset(rows, start)), utf16(offset(rows, end) + 1));
	}

	handleKeydown(event) {
		if (event.isComposing || event.key === 'Process' || event.metaKey || event.altKey || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
		if (event.ctrlKey && event.key.toLowerCase() === 'v' && (this.keyboard.mode === 'i' || this.keyboard.command !== null)) return;
		const names = { Escape: 'Esc', Enter: 'CR', Backspace: 'BS', Delete: 'Del', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' };
		let key = names[event.key] || event.key;
		if (event.ctrlKey) key = `C-${key.length === 1 ? key.toLowerCase() : key}`;
		else if (event.shiftKey && ['Left', 'Right', 'Up', 'Down'].includes(key)) key = `S-${key}`;
		if (key.length > 1) key = `<${key}>`;
		event.preventDefault();
		this.keyboard.key(key);
	}
	// IME, paste and accessibility text insertion arrive as input rather than keydown.
	checkCommandDirect(event) {
		if (event.isComposing) return;
		if (event.inputType === 'deleteContentBackward') this.keyboard.key('<BS>');
		else this.insertText(event.data || '');
	}
	insertText(text) { for (const char of text) this.keyboard.key(char); this.render(); }
	checkCommand(command) { this.keyboard.feed(command); }
	handleEsc() { this.keyboard.key('<Esc>'); }
	handleEnter() { this.keyboard.key('<CR>'); }
	changeMode(mode) { if (mode === 'n') this.keyboard.escape(); else this.keyboard.mode = mode; this.render(); }
	editCell() { this.keyboard.escape(); this.keyboard.context = 'formula'; this.keyboard.formulaCursor = 0; this.keyboard.feed('i'); }

	viewport(keyboard = this.keyboard) {
		if (keyboard.context === 'formula') {
			const bar = document.getElementById('newFormBar'), width = parseFloat(getComputedStyle(bar).fontSize) * 0.6;
			return { top: Math.ceil(bar.scrollTop / 20), bottom: Math.min(keyboard.rows.length - 1, Math.floor((bar.scrollTop + bar.clientHeight) / 20) - 1), left: Math.ceil(bar.scrollLeft / width), right: Math.min(keyboard.rows[keyboard.point.row].length - 1, Math.floor((bar.scrollLeft + bar.clientWidth) / width) - 1) };
		}
		const visibleRows = [], visibleCols = [];
		const top = document.getElementById('topBar').getBoundingClientRect().bottom + document.querySelector('thead').offsetHeight;
		for (let row = 0; row < this.sheet.rows.length; row++) {
			const rect = this.sheet.getCell(row, this.sheet.selCol)?.getBoundingClientRect();
			if (rect && rect.top >= top && rect.bottom <= window.innerHeight - 24) visibleRows.push(row);
		}
		for (let col = 0; col < this.sheet.rows[0].length; col++) {
			const rect = this.sheet.getCell(this.sheet.selRow, col)?.getBoundingClientRect();
			if (rect && rect.left >= 75 && rect.right <= window.innerWidth) visibleCols.push(col);
		}
		return { top: visibleRows[0] ?? this.sheet.selRow, bottom: visibleRows.at(-1) ?? this.sheet.selRow, left: visibleCols[0] ?? this.sheet.selCol, right: visibleCols.at(-1) ?? this.sheet.selCol };
	}
	scroll(action, count, explicit = false) {
		const keyboard = this.keyboard, formula = keyboard.context === 'formula', bar = document.getElementById('newFormBar');
		const rect = (formula ? document.getElementById('formCursor') : this.sheet.getCell(this.sheet.selRow, this.sheet.selCol)).getBoundingClientRect();
		const bounds = formula ? bar.getBoundingClientRect() : { top: document.getElementById('topBar').getBoundingClientRect().bottom + document.querySelector('thead').offsetHeight, left: 75, right: window.innerWidth, bottom: window.innerHeight - 24 };
		const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
		const scroll = (x, y) => formula ? bar.scrollBy(x, y) : window.scrollBy(x, y);
		if (['zz', 'z.', 'zt', 'z<CR>', 'zb', 'z-'].includes(action)) {
			const target = ['zz', 'z.'].includes(action) ? bounds.top + (height - rect.height) / 2 : ['zt', 'z<CR>'].includes(action) ? bounds.top : bounds.bottom - rect.height;
			scroll(0, rect.top - target); return;
		}
		if (['zh', 'zl', 'zH', 'zL', 'zs', 'ze'].includes(action)) {
			const amount = action === 'zs' ? rect.left - bounds.left : action === 'ze' ? rect.right - bounds.right : (['zh', 'zH'].includes(action) ? -1 : 1) * (action === action.toLowerCase() ? rect.width : width / 2) * count;
			scroll(amount, 0); return;
		}
		const direction = ['<C-y>', '<C-u>', '<C-b>', '<PageUp>'].includes(action) ? -1 : 1;
		const page = Math.max(1, Math.floor(height / rect.height)), half = ['<C-d>', '<C-u>'].includes(action);
		if (half && explicit) keyboard.state.scrollRows = count;
		const distance = ['<C-e>', '<C-y>'].includes(action) ? count : half ? keyboard.state.scrollRows || Math.max(1, Math.floor(page / 2)) : Math.max(1, page - 2) * count;
		scroll(0, distance * rect.height * direction);
		const visible = this.viewport();
		const row = ['<C-e>', '<C-y>'].includes(action) ? Math.max(visible.top, Math.min(keyboard.point.row, visible.bottom)) : keyboard.point.row + distance * direction;
		keyboard.move({ row, col: keyboard.point.col });
	}

	async compile(source) {
		const mappings = await new Promise((resolve, reject) => {
			const worker = new Worker(new URL('./LuaConfigWorker.js', import.meta.url), { type: 'module' });
			const finish = (error, value) => { clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(value); };
			const timer = setTimeout(() => finish('init.lua execution timed out'), 2000);
			worker.onmessage = ({ data }) => finish(data.error, data.mappings);
			worker.onerror = event => finish(event.message);
			worker.postMessage(source);
		});
		this.keyboard.mappingKeys = []; this.keyboard.mappings = mappings;
	}
	async loadConfig() {
		let source;
		if (isTauri()) {
			const config = await invoke('keybinding_config', { create: false, template: null });
			this.configPath = config.path; source = config.content;
		} else source = localStorage.getItem('dataflow.init.lua');
		if (source === null) { this.keyboard.mappings = []; this.keyboard.mappingKeys = []; }
		else await this.compile(source);
	}
	async configCommand(command) {
		if (command === ':source' || command === ':configreload') { await this.loadConfig(); this.setPhMessage('Keybindings reloaded'); return; }
		if (command === ':configcreate') {
			if (isTauri()) {
				const config = await invoke('keybinding_config', { create: true, template: configTemplate });
				this.configPath = config.path; this.setPhMessage(`Config: ${config.path}`); await this.loadConfig();
			} else { new FileManager().downloadFile(configTemplate, 'init.lua'); this.setPhMessage('Edit init.lua, then import it with :config'); }
			return;
		}
		if (isTauri()) { this.setPhMessage(`Edit ${this.configPath}; :source reloads it, :configcreate creates it`); return; }
		const input = document.getElementById('luaConfigInput');
		input.value = ''; input.click();
	}
	async importConfig(file) {
		if (!file) return;
		try {
			if (file.size > 128 * 1024) throw new Error('init.lua exceeds 128 KiB');
			const source = await file.text(); await this.compile(source);
			localStorage.setItem('dataflow.init.lua', source); this.setPhMessage(`Loaded ${file.name}; saved for this browser`);
		} catch (error) { this.setPhMessage(`init.lua: ${error.message}`); }
	}

	async handleEnterFromCom(command) {
		try {
			const files = new FileManager(() => this.newSheet());
			if ([':config', ':configload', ':configcreate', ':source', ':configreload'].includes(command)) await this.configCommand(command);
			else if (command === ':w') await files.saveFile();
			else if (command === ':wa') await files.saveFile(true);
			else if (command === ':o') { await files.openFile(); new LaunchManager().hide(); }
			else if (command === ':clear') { this.sheet.clearScreen(); this.newSheet(); new LaunchManager().hide(); }
			else if (command === ':forceloadstyles') this.sheet.loadStyles();
			else if (command === ':resetallstyles') this.sheet.resetAllStyles();
			else if (command.startsWith(':hi ')) this.sheet.setStyles(command, this.sheet.selRow, this.sheet.selCol);
			else if (command.startsWith(':normal ')) this.keyboard.feed(command.slice(8));
			else if (/^:goto [A-Z]+\d+$/.test(command)) {
				const [, letters, row] = command.match(/^:goto ([A-Z]+)(\d+)$/);
				const col = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
				this.keyboard.anchor = null; this.keyboard.mode = 'n';
				this.keyboard.context = 'sheet'; this.keyboard.move({ row: Number(row), col }, true);
			} else if (/^:\d+$/.test(command)) this.keyboard.feed(`${Math.max(1, Number(command.slice(1)))}G`);
			else if (command === ':yankvalue' || command === ':yankcell') {
				if (this.keyboard.context !== 'sheet') { this.keyboard.anchor = null; this.keyboard.mode = 'n'; }
				this.keyboard.context = 'sheet';
				this.keyboard.operate('y', { start: this.keyboard.anchor || this.keyboard.point, end: this.keyboard.point, linewise: this.keyboard.mode === 'V', values: command === ':yankvalue' });
			}
			else if ([':insertleft', ':insertright', ':deletecol'].includes(command)) {
				this.keyboard.context = 'sheet'; this.keyboard.anchor = null; this.keyboard.mode = 'n';
				if (command !== ':deletecol' || this.sheet.rows[0].length > 1) {
					this.keyboard.editColumns(this.sheet.selCol + (command === ':insertright' ? 1 : 0), command === ':deletecol' ? 1 : 0, command === ':deletecol' ? 0 : 1); this.keyboard.commit();
				}
			}
			else if ([':putabove', ':putbelow', ':putleft', ':putright'].includes(command)) {
				if (!this.keyboard.register?.cells) throw new Error('Yank cells before putting a cell range');
				this.keyboard.context = 'sheet'; this.keyboard.anchor = null; this.keyboard.mode = 'n';
				if (command === ':putabove' || command === ':putbelow') {
					const saved = this.keyboard.register;
					this.keyboard.register = { ...saved, linewise: true }; this.keyboard.put(command === ':putabove', 1); this.keyboard.register = saved;
				} else {
					const saved = this.keyboard.register, width = Math.max(...saved.cells.map(row => row.length));
					this.keyboard.editColumns(this.sheet.selCol + (command === ':putright' ? 1 : 0), 0, width);
					this.keyboard.register = { ...saved, linewise: false }; this.keyboard.put(true, 1); this.keyboard.register = saved;
				}
			}
			else if (command === ':help') {
				const url = 'https://github.com/OliverHeffernan/DataFlow/blob/main/docs/keyboard.md';
				if (isTauri()) await open(url); else window.open(url, '_blank', 'noopener');
			}
			else this.setPhMessage(`Unknown command: ${command}`);
			this.syncSize(); this.keyboard.move(this.keyboard.point); this.render();
		} catch (error) { this.setPhMessage(error.message || String(error)); }
	}
}
