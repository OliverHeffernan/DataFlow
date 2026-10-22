import { nextTick, shallowRef } from 'vue';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import VisualManager from './VisualManager.js';
import FileManager from './FileManager.js';
import LaunchManager from './LaunchManager.js';
import VimKeyboard from './VimKeyboard.js';
import { compare, offset } from './VimMotions.js';
import { configTemplate, defaultTimeoutlen } from './LuaKeybindings.js';
import { formulaAssist, formulaReferences } from './FormulaEditing.js';
import { keyboardHints } from './KeyboardHints.js';
import SyntaxHighlighting from './SyntaxHighlighting.js';
import { cellLabel, referenceSpans, resolveReference } from './FormulaFunctions.js';
import { runScriptWorker, scriptLimits } from './LuaScript.js';
import { captureScriptWorkbook, publishWorkbookScript } from './WorkbookScript.js';
import WindowManager from './WindowManager.js';
import ConditionalSession from './ConditionalSession.js';
import { summarizeFormats } from './CellFormatting.js';
import { formatShortcut } from './FormatKeymaps.js';

export default class CheckCommand {
	constructor() {
		if (CheckCommand.instance) return CheckCommand.instance;
		CheckCommand.instance = this;
		this.sheet = new SheetManager();
		this.history = new HistoryManager();
		this.visual = new VisualManager();
		this.windows = new WindowManager(this.sheet.activeSheet);
		this.currentWindow = this.windows.active;
		this.ui = shallowRef({ hints: [], assist: { suggestions: [], signature: null } });
		this.script = shallowRef(null);
		this.keyboard = this.createKeyboard();
		this.currentWindow.keyboard = this.keyboard;
		this.loadConfig().catch(error => this.setPhMessage(`init.lua: ${error.message}`));
	}
	createKeyboard() {
		return new VimKeyboard(this.sheet, {
			active: () => this.keyboard,
			render: () => this.render(),
			message: text => this.setPhMessage(text),
			ex: command => this.handleEnterFromCom(command),
			change: () => { this.syncSize(); this.history.do(this.sheet); nextTick(() => { this.sheet.loadAllCells(); this.render(); }); },
			canFormat: () => this.currentWindow.content === 'sheet',
			formatChange: () => this.history.do(this.sheet),
			sheetChanged: () => { this.currentWindow.sheet = this.sheet.activeSheet; this.renderedRow = null; nextTick(() => this.sheet.loadStyles()); },
			undo: (redo, count) => { this.preserveWindows(() => this.history[redo ? 'redo' : 'undo'](this.sheet, count)); this.keyboard.move(this.keyboard.point); },
			window: action => this.windowAction(action),
			key: key => this.ruleKey?.(key) ?? false,
			copy: register => {
				if (register.cells) this.sheet.yank(register.cells);
				navigator.clipboard?.writeText(register.text).catch(() => {});
			},
			pending: () => { clearTimeout(this.mappingTimer); this.mappingTimer = setTimeout(() => this.keyboard.flushMappings(), this.keyboard.timeoutlen); },
			viewport: keyboard => this.viewport(keyboard),
			scroll: (action, count, explicit) => this.scroll(action, count, explicit),
		});
	}
	get mode() { return this.keyboard.mode; }
	setPhMessage(text) { const display = document.getElementById('commandLine'); if (display) display.dataset.message = text; }
	focus() { document.getElementById('app').focus({ preventScroll: true }); }
	get footerHeight() { return document.getElementById('statusBar')?.offsetHeight ?? 24; }
	get viewportElement() { return document.getElementById('sheetViewport'); }

	saveWindow() {
		const pane = this.currentWindow;
		if (pane.content === 'sheet') { pane.row = this.sheet.selRow; pane.col = this.sheet.selCol; }
	}
	captureWindowContext() {
		if (this.currentWindow.content !== 'sheet') throw new Error('Open a sheet window first');
		return { windowId: this.currentWindow.id, sheetName: this.sheet.activeSheet.name,
			cursor: { row: this.sheet.selRow, col: this.sheet.selCol }, selection: this.selectedRange() };
	}
	// Wrap synchronous live publication, never a worker's detached calculations or an async picker.
	preserveWindows(publish) {
		this.keyboard.finishFormat();
		this.saveWindow();
		try { return publish(); }
		finally {
			this.windows.reconcile(this.sheet.sheets);
			const pane = this.currentWindow;
			this.sheet.workbook.activeSheetIndex = this.sheet.sheets.indexOf(pane.sheet);
			this.sheet.selRow = pane.row; this.sheet.selCol = pane.col;
			this.syncSize(); this.syncActiveValues(); this.renderedRow = null;
			this.render();
		}
	}
	adoptKeyboard(keyboard) {
		const previous = this.keyboard;
		this.keyboard = keyboard;
		keyboard.register = previous.register;
		keyboard.mappings = previous.mappings; keyboard.timeoutlen = previous.timeoutlen;
		keyboard.macros = previous.macros; keyboard.recording = previous.recording; keyboard.lastMacro = previous.lastMacro;
		keyboard.pending = ''; keyboard.mappingKeys = [];
		clearTimeout(this.mappingTimer);
	}
	async activateWindow(id, render = true) {
		if (!this.windows.windows.some(pane => pane.id === id)) return false;
		if (id === this.currentWindow.id) return true;
		if (id !== this.currentWindow.id) {
			this.keyboard.finishFormat();
			if (this.currentWindow.content === 'sheet' && this.keyboard.mode === 'i') {
				// Settle raw cells and dataset bounds on their owning sheet before
				// another pane can capture/commit shared workbook history. Keep the
				// INSERT recording intact so returning and typing still repeats it.
				const keys = [...this.keyboard.changeKeys];
				if (this.keyboard.commit() === false) {
					this.keyboard.mode = 'n';
					this.preserveWindows(() => this.keyboard.move(this.keyboard.point));
					await this.render(); this.focus(); return false;
				}
				this.keyboard.changeKeys = keys;
			}
			this.saveWindow(); this.visual.exitVisual();
			document.getElementById('gridOverlays')?.replaceChildren();
			this.sheet.getSelectedCell()?.classList.remove('focussed');
			this.windows.focus(id); this.windows.reconcile(this.sheet.sheets);
			const pane = this.windows.active;
			this.currentWindow = pane;
			this.sheet.workbook.activeSheetIndex = this.sheet.sheets.indexOf(pane.sheet);
			this.sheet.selRow = pane.row; this.sheet.selCol = pane.col;
			pane.keyboard ??= this.createKeyboard();
			this.adoptKeyboard(pane.rules?.state.editing ? pane.rules.editor : pane.keyboard);
			this.syncActiveValues(); this.renderedRow = null;
		}
		if (render) { await this.render(); this.focus(); }
		return true;
	}
	syncActiveValues() {
		const result = this.sheet.sheetResults.value.get(this.sheet.activeSheet);
		if (!result) { this.sheet.recalculate(); return; }
		this.sheet.cellValues.value = result.values;
		this.sheet.spillCells.clear(); result.spills.forEach((value, key) => this.sheet.spillCells.set(key, value));
		this.sheet.cellErrors.clear(); result.errors.forEach((value, key) => this.sheet.cellErrors.set(key, value));
		this.sheet.calculated = { sheet: this.sheet.activeSheet, typed: result.typed };
		this.sheet.cellPresentation.value = result.presentation;
	}
	async windowAction(action) {
		if (action === 'c') return this.handleEnterFromCom(':close');
		const id = this.windows.neighbor(action);
		if (id !== null) await this.activateWindow(id);
	}
	syncSize() { this.sheet.numOfRows.value = this.sheet.rows.length; this.sheet.numOfCols.value = this.sheet.rows[0].length; }
	async newSheet(resetHistory = true, keepCursor = false) {
		const point = { row: this.sheet.selRow, col: this.sheet.selCol };
		this.adoptKeyboard(this.currentWindow.keyboard);
		this.keyboard.resetNavigation();
		if (keepCursor) this.keyboard.move(point);
		if (resetHistory) this.history.reset(this.sheet);
		this.windows.reconcile(this.sheet.sheets);
		this.currentWindow.sheet = this.sheet.activeSheet;
		this.currentWindow.content = 'sheet';
		this.currentWindow.rules = null;
		this.currentWindow.keyboard = this.keyboard;
		this.sheet.recalculate(); this.renderedRow = null;
		await this.render();
		this.sheet.loadStyles();
	}

	selectedRange() {
		const point = { row: this.sheet.selRow, col: this.sheet.selCol };
		const anchor = this.keyboard.context === 'sheet' ? this.keyboard.anchor ?? point : point;
		const linewise = this.keyboard.context === 'sheet' && this.keyboard.mode === 'V';
		return { r0: Math.min(anchor.row, point.row), r1: Math.max(anchor.row, point.row),
			c0: linewise ? 0 : Math.min(anchor.col, point.col),
			c1: linewise ? this.sheet.rows[0].length - 1 : Math.max(anchor.col, point.col) };
	}
	rulesFor(pane = this.currentWindow) {
		pane.keyboard ??= this.createKeyboard();
		pane.rules ??= new ConditionalSession(this.sheet, pane, pane.keyboard.hooks);
		return pane.rules;
	}
	async cfCommand(action = '', argument) {
		const pane = this.currentWindow;
		if (pane.content === 'sheet') {
			pane.target = this.selectedRange(); this.saveWindow();
			this.visual.exitVisual(); pane.content = 'cf';
			pane.keyboard.context = 'sheet'; pane.keyboard.mode = 'n'; pane.keyboard.anchor = null;
		}
		const session = this.rulesFor();
		try {
			this.setPhMessage('');
			if (argument !== undefined && !['edit', 'delete'].includes(action)) throw new Error(`:cf ${action} takes no argument`);
			switch (action) {
				case '': break;
				case 'list': session.guard(); session.discard(); break;
				case 'new': session.begin(null, pane.target ?? { r0: pane.row, r1: pane.row, c0: pane.col, c1: pane.col }); break;
				case 'edit':
					if (argument === undefined && !session.selected) throw new Error('Create a rule with a or :cf new first');
					session.begin(argument === undefined ? session.selected.id : Number(argument)); break;
				case 'apply': session.apply(); break;
				case 'discard': session.discard(); break;
				case 'delete': session.remove(argument === undefined ? undefined : Number(argument)); break;
				case 'up': case 'down': session.reorder(action === 'up' ? -1 : 1); break;
				default: throw new Error('Usage: :cf [new|edit [id]|apply|discard|delete [id]|up|down]');
			}
		} catch (error) { session.state.error = error.explanation ?? error.message; this.setPhMessage(session.state.error); }
		this.adoptKeyboard(session.state.editing ? session.editor : pane.keyboard);
		this.renderedRow = null;
		await this.render(); this.focus();
	}
	ruleKey(key) {
		if (this.currentWindow.content !== 'cf') return false;
		const session = this.rulesFor(), keyboard = this.keyboard;
		if (keyboard.command !== null) return false;
		if (session.state.editing) {
			if (key === '<CR>' && keyboard.mode === 'n' && !keyboard.pending && !keyboard.anchor) { this.cfCommand('apply'); return true; }
			return false;
		}
		if (['<C-w>', 'q', '@'].includes(keyboard.pending) || ['<C-w>', 'q', '@', ':', 'u', '<C-r>', '<Esc>'].includes(key)) return false;
		if (['j', '<Down>'].includes(key)) session.select(1);
		else if (['k', '<Up>'].includes(key)) session.select(-1);
		else if (key === 'G') session.select(session.rules.length);
		else if (key === 'g') session.select(-session.rules.length);
		else if (key === 'a') this.cfCommand('new');
		else if (key === '<CR>' || key === 'i') this.cfCommand('edit');
		else if (key === 'x' || key === '<Del>') this.cfCommand('delete');
		else if (key === 'J' || key === 'K') this.cfCommand(key === 'J' ? 'down' : 'up');
		return true;
	}
	guardDrafts() {
		if (this.script?.value) throw new Error('Close or cancel the Lua script dialog before saving, replacing or leaving the workbook');
		if (this.windows.windows.some(pane => pane.rules?.dirty)) throw new Error('Unapplied rule draft in a window; apply or :cf discard before replacing or saving workbook data');
	}
	async renderRules() {
		this.visual.exitVisual();
		const session = this.rulesFor(), keyboard = this.keyboard;
		if (session.state.editing) {
			document.getElementById('formText').innerHTML = new SyntaxHighlighting().highlight(session.state.draft);
			this.sheet.cellCurPos = keyboard.formulaCursor; this.renderFormulaCursor();
		}
		const names = { n: 'NORMAL', i: 'INSERT', v: 'VISUAL', V: 'VISUAL-LINE', b: 'VISUAL-BLOCK' };
		document.getElementById('modeDisplay').innerText = `-- CF ${session.state.editing ? names[keyboard.mode] : 'RULES'} --`;
		const display = document.getElementById('commandLine');
		display.textContent = keyboard.command ?? keyboard.pending + keyboard.mappingKeys.join('');
		display.classList.toggle('typing-command', keyboard.command !== null);
		this.ui.value = { hints: session.state.editing || keyboard.command !== null || keyboard.pending || keyboard.mappingKeys.length ? keyboardHints(keyboard) : [
			{ key: 'j k', description: 'Select rule' }, { key: 'a', description: 'New rule' }, { key: 'Enter', description: 'Edit' },
			{ key: 'x', description: 'Delete' }, { key: 'J K', description: 'Reorder' }, { key: 'u / Ctrl R', description: 'Undo / redo' },
			{ key: 'Ctrl W → h j k l', description: 'Window' }, { key: ':', description: 'Command' },
		], assist: session.state.editing ? { ...formulaAssist(session.state.draft, keyboard.formulaCursor, this.sheet, 'CF'), inserting: keyboard.mode === 'i', selected: keyboard.completionIndex } : { suggestions: [], signature: null } };
		await nextTick();
		document.documentElement.style.setProperty('--status-bar-height', `${this.footerHeight}px`);
	}

	async render() {
		this.syncSize();
		this.windows.reconcile(this.sheet.sheets);
		this.saveWindow();
		const version = this.renderVersion = (this.renderVersion ?? 0) + 1;
		await nextTick();
		if (version !== this.renderVersion) return;
		const keyboard = this.keyboard;
		if (this.windows.active.content === 'cf') return this.renderRules();
		this.visual.exitVisual();
		const row = this.sheet.selRow, col = this.sheet.selCol;
		// Keep scrolling a motion's responsibility; formula edits and Ex typing must not reset the viewport.
		const moved = this.renderedRow !== row || this.renderedCol !== col;
		if (moved) this.sheet.selectCell(row, col);
		this.renderedRow = row; this.renderedCol = col;
		this.sheet.tempForm = keyboard.formula;
		const references = keyboard.context === 'formula' ? formulaReferences(keyboard.formula, row, col, this.sheet) : [];
		document.getElementById('formText').innerHTML = new SyntaxHighlighting().highlight(keyboard.formula, references);
		this.sheet.cellCurPos = keyboard.context === 'formula' ? keyboard.formulaCursor : 0;
		this.renderFormulaCursor();
		if (keyboard.anchor && keyboard.context === 'sheet') {
			const start = keyboard.anchor;
			this.visual.sheetSelection = true;
			this.visual.startVisual(start.row, keyboard.mode === 'V' ? 0 : start.col, 0, keyboard.mode === 'V', this.sheet.rows[0].length);
			this.visual.setVisual(row, col, 0, this.sheet.rows[0].length);
		}
		const names = { n: 'NORMAL', i: 'INSERT', v: 'VISUAL', V: 'VISUAL-LINE', b: 'VISUAL-BLOCK' };
		document.getElementById('modeDisplay').innerText = keyboard.formatSession ? '-- FORMAT --' : `-- ${keyboard.context === 'formula' ? 'FORMULA ' : ''}${names[keyboard.mode]} --`;
		const display = document.getElementById('commandLine');
		display.textContent = keyboard.command ?? keyboard.pending + keyboard.mappingKeys.join('');
		display.classList.toggle('typing-command', keyboard.command !== null);
		const owner = this.sheet.spillCells.get(`${row}:${col}`);
		const session = keyboard.formatSession, range = session?.range ?? keyboard.formatRange;
		const styles = [], warnings = [];
		for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) {
			styles.push(this.sheet.styles[r][c]);
			const warning = this.sheet.cellPresentation.value[r]?.[c]?.warning;
			if (warning) warnings.push(`${cellLabel(r, c)}: ${warning}`);
		}
		const shortcut = (action, mode) => session?.input && !['Select', 'Done', 'Backspace'].includes(action) ? '' : formatShortcut(keyboard.mappings, action, mode);
		const formatHints = session ? [
			['Previous', 'Move up'], ['Next', 'Move down'], ['Select', session.input ? 'Confirm' : 'Choose / edit'],
			...(session.input ? [['Backspace', 'Erase']] : session.menu ? [] : session.rows.map(item => [item.action, item.label])),
			['Revert', 'Revert session'], ['Done', 'Done'],
		].map(([action, description]) => ({ key: shortcut(action), description })).filter(hint => hint.key) : null;
		this.ui.value = {
			hints: formatHints ?? keyboardHints(keyboard),
			assist: keyboard.context === 'formula' ? { ...formulaAssist(keyboard.formula, keyboard.formulaCursor, this.sheet), inserting: keyboard.mode === 'i', selected: keyboard.completionIndex } : { suggestions: [], signature: null },
			format: { session, summary: session?.summary ?? summarizeFormats(styles), warnings, shortcut, openKey: shortcut('Open', keyboard.mappingMode), enabled: keyboard.mode !== 'i' && keyboard.command === null && !(keyboard.context === 'formula' && keyboard.anchor) },
		};
		await nextTick();
		// Apply the new assistance/footer sizes before ensuring the selection is visible. Waiting for a
		// ResizeObserver alone leaves the last row underneath a footer that changed height during this render.
		const style = document.documentElement.style;
		const heights = { '--status-bar-height': this.footerHeight };
		const resized = Object.entries(heights).some(([name, height]) => style.getPropertyValue(name) !== `${height}px`);
		for (const [name, height] of Object.entries(heights)) style.setProperty(name, `${height}px`);
		if (moved || resized) this.sheet.ensureCellVisible(row, col);
		this.renderOverlays(references, owner);
	}
	refreshOverlays() {
		if (this.windows.active.content !== 'sheet') return;
		const { selRow: row, selCol: col } = this.sheet;
		this.renderOverlays(this.keyboard.context === 'formula' ? formulaReferences(this.keyboard.formula, row, col, this.sheet) : [], this.sheet.spillCells.get(`${row}:${col}`));
	}

	renderOverlays(references, owner) {
		const layer = document.getElementById('gridOverlays');
		if (!layer) return;
		const viewport = this.viewportElement, base = viewport.getBoundingClientRect();
		layer.replaceChildren();
		const outline = (region, color, spill = false) => {
			const first = this.sheet.getCell(region.r0, region.c0)?.parentElement.getBoundingClientRect();
			const last = this.sheet.getCell(region.r1, region.c1)?.parentElement.getBoundingClientRect();
			if (!first || !last) return;
			const box = document.createElement('div');
			box.className = spill ? 'spill-outline' : 'reference-outline';
			box.dataset.range = `${this.sheet.columnLabel(region.c0)}${region.r0}:${this.sheet.columnLabel(region.c1)}${region.r1}`;
			box.style.setProperty('--reference-color', color);
			Object.assign(box.style, { left: `${first.left - base.left + viewport.scrollLeft}px`, top: `${first.top - base.top + viewport.scrollTop}px`, width: `${last.right - first.left}px`, height: `${last.bottom - first.top}px` });
			layer.append(box);
		};
		if (owner) outline({ r0: owner.row, c0: owner.col, r1: owner.row + owner.rows - 1, c1: owner.col + owner.cols - 1 }, '#8ba5c6', true);
		if (this.keyboard.formatSession) outline(this.keyboard.formatSession.range, '#75e2bc');
		const seen = new Set();
		for (const ref of references) {
			const key = JSON.stringify(ref.region);
			if (ref.region && !seen.has(key)) { outline(ref.region, ref.color); seen.add(key); }
		}
	}

	renderFormulaCursor() {
		const keyboard = this.keyboard, bar = document.getElementById('newFormBar'), text = document.getElementById('formText');
		const cursor = document.getElementById('formCursor'), selection = document.getElementById('formSelection');
		if (!bar || !text || !cursor || !selection) return;
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
		cursor.hidden = keyboard.context !== 'formula';
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

	// Native controls and dialogs own their input. The spreadsheet receives keys regardless of which cell is focused.
	acceptsInput(event) {
		if (this.script.value) return false;
		if (this.sheet.recovery?.state.locked || this.sheet.recovery?.state.dialog) return false;
		if (this.keyboard.formatSession && event.target?.closest?.('[data-format-panel]')) return !event.defaultPrevented;
		return !event.defaultPrevented && !event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [data-keyboard-ignore]');
	}
	connectInput() {
		const root = document.getElementById('app');
		root.tabIndex = 0; root.setAttribute('aria-label', 'Spreadsheet workspace'); root.setAttribute('role', 'region');
		const keydown = event => this.handleKeydown(event);
		const paste = event => {
			if (this.keyboard.formatSession?.input && this.acceptsInput(event)) {
				event.preventDefault(); for (const key of event.clipboardData.getData('text/plain')) this.keyboard.formatSession.text(key); this.render(); return;
			}
			if (!this.acceptsInput(event) || !(this.keyboard.mode === 'i' || this.keyboard.command !== null)) return;
			event.preventDefault(); this.insertText(event.clipboardData.getData('text/plain'));
		};
		const composition = event => {
			if (this.keyboard.formatSession?.input && this.acceptsInput(event)) { for (const key of event.data) this.keyboard.formatSession.text(key); this.render(); return; }
			if (this.acceptsInput(event) && (this.keyboard.mode === 'i' || this.keyboard.command !== null)) this.insertText(event.data);
		};
		window.addEventListener('keydown', keydown); window.addEventListener('paste', paste); window.addEventListener('compositionend', composition);
		this.focus(); this.render();
		return () => {
			window.removeEventListener('keydown', keydown); window.removeEventListener('paste', paste); window.removeEventListener('compositionend', composition);
			clearTimeout(this.mappingTimer);
		};
	}
	handleKeydown(event) {
		if (!this.acceptsInput(event) || event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.altKey || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && (this.keyboard.mode === 'i' || this.keyboard.command !== null)) return;
		if (event.metaKey) return;
		const names = { Escape: 'Esc', Enter: 'CR', Backspace: 'BS', Delete: 'Del', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' };
		let key = names[event.key] || event.key;
		if (event.ctrlKey) key = `C-${event.shiftKey ? 'S-' : ''}${key.length === 1 ? key.toLowerCase() : key}`;
		else if (event.shiftKey && ['CR', 'Left', 'Right', 'Up', 'Down'].includes(key)) key = `S-${key}`;
		else if (event.shiftKey && /^[hjkl]$/i.test(key)) key = key.toUpperCase();
		if (key.length > 1) key = `<${key}>`;
		event.preventDefault();
		this.keyboard.key(key);
	}
	insertText(text) { for (const char of text) this.keyboard.key(char === '\n' && this.keyboard.command === null ? '<S-CR>' : char, false); this.render(); }
	checkCommand(command) { this.keyboard.feed(command); }
	handleEsc() { this.keyboard.key('<Esc>'); }
	handleEnter() { this.keyboard.key('<CR>'); }
	changeMode(mode) { if (mode === 'n') this.keyboard.escape(); else this.keyboard.mode = mode; this.render(); }
	editCell() { this.keyboard.escape(); this.keyboard.editOwner(); this.keyboard.context = 'formula'; this.keyboard.formulaCursor = 0; this.keyboard.feed('i'); }

	viewport(keyboard = this.keyboard) {
		if (keyboard.context === 'formula') {
			const bar = document.getElementById('newFormBar'), width = parseFloat(getComputedStyle(bar).fontSize) * 0.6;
			return { top: Math.ceil(bar.scrollTop / 20), bottom: Math.min(keyboard.rows.length - 1, Math.floor((bar.scrollTop + bar.clientHeight) / 20) - 1), left: Math.ceil(bar.scrollLeft / width), right: Math.min(keyboard.rows[keyboard.point.row].length - 1, Math.floor((bar.scrollLeft + bar.clientWidth) / width) - 1) };
		}
		const visibleRows = [], visibleCols = [], viewport = this.viewportElement;
		if (!viewport) return { top: 0, bottom: this.sheet.rows.length - 1, left: 0, right: this.sheet.rows[0].length - 1 };
		const bounds = viewport.getBoundingClientRect(), top = bounds.top + viewport.querySelector('thead').offsetHeight;
		for (let row = 0; row < this.sheet.rows.length; row++) {
			const rect = this.sheet.getCell(row, this.sheet.selCol)?.getBoundingClientRect();
			if (rect && rect.top >= top && rect.bottom <= bounds.bottom) visibleRows.push(row);
		}
		for (let col = 0; col < this.sheet.rows[0].length; col++) {
			const rect = this.sheet.getCell(this.sheet.selRow, col)?.getBoundingClientRect();
			if (rect && rect.left >= bounds.left + 90 && rect.right <= bounds.right) visibleCols.push(col);
		}
		return { top: visibleRows[0] ?? this.sheet.selRow, bottom: visibleRows.at(-1) ?? this.sheet.selRow, left: visibleCols[0] ?? this.sheet.selCol, right: visibleCols.at(-1) ?? this.sheet.selCol };
	}
	scroll(action, count, explicit = false) {
		const keyboard = this.keyboard, formula = keyboard.context === 'formula', bar = document.getElementById('newFormBar');
		const rect = (formula ? document.getElementById('formCursor') : this.sheet.getCell(this.sheet.selRow, this.sheet.selCol)).getBoundingClientRect();
		const pane = this.viewportElement, paneRect = pane?.getBoundingClientRect();
		const bounds = formula ? bar.getBoundingClientRect() : { top: paneRect.top + pane.querySelector('thead').offsetHeight, left: paneRect.left + 90, right: paneRect.right, bottom: paneRect.bottom };
		const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
		const scroll = (x, y) => (formula ? bar : pane).scrollBy(x, y);
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
		const config = await new Promise((resolve, reject) => {
			const worker = new Worker(new URL('./LuaConfigWorker.js', import.meta.url), { type: 'module' });
			const finish = (error, value) => { clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(value); };
			const timer = setTimeout(() => finish('init.lua execution timed out'), 2000);
			worker.onmessage = ({ data }) => finish(data.error, data.config);
			worker.onerror = event => finish(event.message);
			worker.postMessage(source);
		});
		clearTimeout(this.mappingTimer);
		this.keyboard.mappingKeys = []; Object.assign(this.keyboard, config);
	}
	async loadConfig() {
		let source;
		if (isTauri()) {
			const config = await invoke('keybinding_config', { create: false, template: null });
			this.configPath = config.path; source = config.content;
		} else source = localStorage.getItem('dataflow.init.lua');
		if (source === null) {
			clearTimeout(this.mappingTimer);
			this.keyboard.mappings = []; this.keyboard.mappingKeys = []; this.keyboard.timeoutlen = defaultTimeoutlen;
		}
		else await this.compile(source);
		if (document.getElementById('formText')) await this.render();
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
			await this.render();
		} catch (error) { this.setPhMessage(`init.lua: ${error.message}`); }
	}

	openScript() {
		if (this.script.value) return;
		if (this.keyboard.playing || this.keyboard.recording) throw new Error(':luarun requires an explicit run outside macro recording/playback');
		if (this.keyboard.context !== 'sheet') throw new Error('Select sheet cells before :luarun');
		const context = this.captureWindowContext();
		clearTimeout(this.mappingTimer);
		this.keyboard.mappingKeys = []; this.keyboard.changeKeys = [];
		this.script.value = { context, source: '', name: '', running: false, error: '', complete: false, logs: [] };
	}
	async importScript(file) {
		const state = this.script.value;
		if (!file || !state || state.running) return;
		try {
			if (file.size > scriptLimits.sourceBytes) throw new Error('Script exceeds 128 KiB');
			const source = await file.text();
			if (new TextEncoder().encode(source).length > scriptLimits.sourceBytes) throw new Error('Script exceeds 128 KiB');
			if (this.script.value === state) this.script.value = { ...state, source, name: file.name, error: '', complete: false };
		} catch (error) { if (this.script.value === state) this.script.value = { ...state, error: error.message }; }
	}
	cancelScript() {
		this.scriptAbort?.abort(); this.script.value = null; this.focus();
	}
	async runScript() {
		const state = this.script.value;
		if (!state?.name || state.running || state.complete) return;
		const controller = new AbortController(); this.scriptAbort = controller;
		this.script.value = { ...state, running: true, error: '' };
		try {
			const request = captureScriptWorkbook(this.sheet, state.context);
			const worker = new Worker(new URL('./LuaScriptWorker.js', import.meta.url), { type: 'module' });
			const result = await runScriptWorker(worker, { ...request, source: state.source }, controller.signal);
			let changed;
			const publish = () => { changed = publishWorkbookScript(this.sheet, request, result, controller.signal); };
			this.preserveWindows(publish);
			this.script.value = { ...state, running: false, complete: true, logs: result.logs,
				message: changed ? 'Workbook updated · one undo step' : 'No workbook changes' };
			await this.render();
		} catch (error) {
			if (!controller.signal.aborted) this.script.value = { ...state, running: false, error: error.message };
		} finally { if (this.scriptAbort === controller) this.scriptAbort = null; }
	}

	async sheetCommand(action, argument, force) {
		if (force && action !== 'sheetdelete') throw new Error('Only :sheetdelete accepts !');
		if (['sheets', 'sheetnext', 'sheetprev'].includes(action) && argument) throw new Error(`:${action} takes no arguments`);
		if (action === 'sheets' || (action === 'sheet' && !argument)) {
			this.setPhMessage(this.sheet.sheets.map((sheet, i) => `${i === this.sheet.workbook.activeSheetIndex ? '*' : ''}${i + 1}: ${sheet.name}`).join(' · '));
			return;
		}
		if (this.currentWindow.content === 'cf') this.currentWindow.rules?.guard();
		const before = this.sheet.activeSheet;
		switch (action) {
			case 'sheetnew': this.sheet.createSheet(argument || undefined); break;
			case 'sheetduplicate': this.sheet.createSheet(argument || this.sheet.unusedSheetName(`${before.name} copy `), true); break;
			case 'sheetrename': this.sheet.renameSheet(argument); break;
			case 'sheet': this.sheet.switchSheet(argument); break;
			case 'sheetnext': case 'sheetprev':
				this.sheet.switchSheet((this.sheet.workbook.activeSheetIndex + (action === 'sheetnext' ? 1 : -1) + this.sheet.sheets.length) % this.sheet.sheets.length + 1); break;
			case 'sheetmove':
				if (!/^\d+$/.test(argument || '')) throw new Error('Usage: :sheetmove <one-based position>');
				this.sheet.moveSheet(Number(argument)); break;
			case 'sheetdelete': this.sheet.deleteSheet(argument || undefined, Boolean(force)); break;
		}
		new LaunchManager().hide();
		this.currentWindow.sheet = this.sheet.activeSheet;
		if (before !== this.sheet.activeSheet) await this.newSheet(false, true);
		else if (this.currentWindow.content === 'cf' && action === 'sheet') await this.newSheet(false, true);
		else { this.sheet.recalculate(); await this.render(); this.sheet.loadStyles(); }
		this.setPhMessage(`Sheet ${this.sheet.workbook.activeSheetIndex + 1}/${this.sheet.sheets.length}: ${this.sheet.activeSheet.name}`);
	}

	async markCommand(action, argument = '', force = '') {
		if (force && action !== 'delmarks') throw new Error('Only :delmarks accepts !');
		const args = argument.trim().split(/\s+/).filter(Boolean), name = args[0];
		if (action === 'marks') {
			if (args.length > 1) throw new Error('Usage: :marks [name]');
			const marks = name ? [this.sheet.mark(name)] : this.sheet.marks;
			this.setPhMessage(marks.map(mark => `${mark.name}: ${mark.sheetName}!${mark.bounds ? `${cellLabel(mark.bounds.r0, mark.bounds.c0)}:${cellLabel(mark.bounds.r1, mark.bounds.c1)}` : '#REF!'}${mark.kind === 'dataset' ? ` · ${this.sheet.describeDataset(mark.name).rowCount} records` : ''}`).join(' · ') || 'No marks');
			return;
		}
		if (action === 'mark' || action === 'dataset') {
			if (!name) throw new Error(`Usage: :${action} name [absolute reference]`);
			const text = argument.trim().slice(name.length).trim();
			let sheetName = this.sheet.activeSheet.name, bounds, kind;
			if (text) {
				const span = referenceSpans(text)[0];
				if (!span || span.start !== 0 || span.end !== text.length || !/^[A-Z]+\d+(?:\s*:\s*[A-Z]+\d+)?$/.test(span.reference)) throw new Error('Use an absolute cell or rectangle, optionally sheet-qualified');
				if (span.sheetName !== undefined) {
					const target = this.sheet.sheets.find(sheet => sheet.name.toLowerCase() === span.sheetName.toLowerCase());
					if (!target) throw new Error('Unknown target sheet');
					sheetName = target.name;
				}
				bounds = resolveReference(span.reference, 0, 0, {}); kind = span.reference.includes(':') ? 'range' : 'cell';
			} else {
				if (this.keyboard.context !== 'sheet') throw new Error('Select sheet cells before setting a mark');
				const a = this.keyboard.anchor ?? this.keyboard.point, b = this.keyboard.point;
				bounds = { r0: Math.min(a.row, b.row), c0: this.keyboard.mode === 'V' ? 0 : Math.min(a.col, b.col), r1: Math.max(a.row, b.row), c1: this.keyboard.mode === 'V' ? this.sheet.rows[0].length - 1 : Math.max(a.col, b.col) };
				kind = this.keyboard.anchor ? 'range' : 'cell';
			}
			this.sheet.setMark(name, bounds, action === 'dataset' ? 'dataset' : kind, sheetName);
		} else if (action === 'markrename') {
			if (args.length !== 2) throw new Error('Usage: :markrename old new');
			this.sheet.renameMark(...args);
		} else if (action === 'delmarks') {
			if (args.length !== 1) throw new Error('Usage: :delmarks[!] name');
			this.sheet.deleteMark(name, Boolean(force));
		} else if (action === 'datasetcolumnrename') {
			if (args.length !== 3) throw new Error('Usage: :datasetcolumnrename dataset old new');
			this.sheet.renameDatasetColumn(...args);
		} else if (action === 'datasetappend') {
			if (args.length < 1 || args.length > 2 || (args[1] && !/^\d+$/.test(args[1]))) throw new Error('Usage: :datasetappend name [count]');
			this.sheet.appendDataset(name, args[1] ? Number(args[1]) : 1);
		} else if (action === 'markgoto') {
			if (args.length !== 1) throw new Error('Usage: :markgoto name');
			this.keyboard.gotoMark(name); this.renderedRow = null;
		}
		await this.render(); this.sheet.loadStyles(); this.setPhMessage(`${action}: ${name}`);
	}

	async handleEnterFromCom(command) {
		try {
			if (this.sheet.recovery?.state.locked) return;
			command = command.trim();
			if (/^:(autosave|recover|recoverdiscard)(\s|$)/.test(command)) return await this.sheet.recovery?.command(command);
			this.keyboard.finishFormat();
			if (/^:luarun(?:\s|!|$)/.test(command.trim())) {
				if (command.trim() !== ':luarun') throw new Error('Usage: :luarun (choose a local Lua file, preview, then Run)');
				this.openScript(); return;
			}
			const marks = command.match(/^:(marks|markrename|markgoto|mark|delmarks|datasetappend|datasetcolumnrename|dataset)(!?)(?:\s+(.*))?$/);
			if (marks) {
				if (this.currentWindow.content !== 'sheet' && marks[1] !== 'marks') throw new Error('Open a sheet window to change or jump to marks');
				return await this.markCommand(marks[1], marks[3], marks[2]);
			}
			const conditional = command.match(/^:cf(?:\s+(\w+)(?:\s+(\d+))?)?$/);
			if (conditional) return await this.cfCommand(conditional[1], conditional[2]);
			if (/^:(?:fill|series)(?:\s|!|$)/.test(command.trim())) {
				if (this.currentWindow.content !== 'sheet') throw new Error('Open a sheet window to fill cells');
				this.keyboard.changeKeys = []; // Failed/no-op Ex input must not leak into the next edit's dot recording.
				const range = command.trim().match(/^:(fill|series)\s+(down|right|up|left)(?:\s+(\d+))?(?:\s+step\s+(\S+))?$/);
				if (!range || (range[1] === 'fill' && range[4] !== undefined)) throw new Error('Usage: :fill <direction> [count] or :series <direction> [count] [step <number>]');
				// Mutate synchronously, before rendering, so macros see each command's completed edit.
				this.keyboard.fill(range[2], range[3] === undefined ? undefined : Number(range[3]), range[1] === 'series' ? range[4] ?? '1' : undefined);
				this.render(); return;
			}
			if ([':splitv', ':splith'].includes(command)) {
				this.saveWindow();
				const before = this.currentWindow, anchor = this.keyboard.anchor, mode = this.keyboard.mode;
				const pane = this.windows.split(command === ':splitv' ? 'vertical' : 'horizontal');
				if (before.content === 'sheet') {
					pane.keyboard = this.createKeyboard(); pane.keyboard.anchor = anchor && { ...anchor }; pane.keyboard.mode = mode;
				}
				return await this.activateWindow(pane.id);
			}
			if (command === ':close' || command === ':close!') {
				if (this.currentWindow.rules?.dirty && command !== ':close!') throw new Error('Unapplied rule draft; use :cf discard or :close!');
				return await this.activateWindow(this.windows.close().id);
			}
			const sheetCommand = command.trim().match(/^:(sheets|sheetnew|sheetduplicate|sheetrename|sheetnext|sheetprev|sheetmove|sheetdelete|sheet)(!?)(?:\s+(.*))?$/);
			if (sheetCommand) return await this.sheetCommand(sheetCommand[1], sheetCommand[3]?.trim(), sheetCommand[2]);
			if ([':o', ':clear', ':w', ':wa'].includes(command)) this.guardDrafts();
			if (this.currentWindow.content !== 'sheet' && ![':config', ':configload', ':configcreate', ':source', ':configreload', ':w', ':wa', ':o', ':clear', ':help'].includes(command)) throw new Error('Open a sheet window for cell commands; :cf manages rules');
			const files = new FileManager(async () => { await this.newSheet(false); new LaunchManager().hide(); }, () => this.guardDrafts());
			if ([':config', ':configload', ':configcreate', ':source', ':configreload'].includes(command)) await this.configCommand(command);
			else if (command === ':w') return await files.saveFile();
			else if (command === ':wa') return await files.saveFile(true);
			else if (command === ':o') { await files.openFile(); new LaunchManager().hide(); return; }
			else if (command === ':clear') { this.sheet.clearScreen(); await this.newSheet(false); new LaunchManager().hide(); return; }
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
		} catch (error) { this.setPhMessage(error.explanation || error.message || String(error)); }
	}
}
