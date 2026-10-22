import { reactive, watch } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createRecoveryId, createRecoveryStore } from './RecoveryStore.js';
import HistoryManager from './HistoryManager.js';

const signature = workbook => {
	const { activeSheet, ...content } = workbook;
	return JSON.stringify(content);
};
const basename = path => path?.split(/[\\/]/).at(-1) || 'Untitled';
const message = error => error?.message || String(error);

// One instance per workspace. FileManager instances are short-lived; timers,
// saved baselines, recovery ownership and lifecycle requests are not.
export default class RecoveryManager {
	constructor(sheet, store = createRecoveryStore()) {
		this.sheet = sheet;
		this.store = store;
		this.state = reactive({ enabled: true, dirty: false, pending: false, error: '', lastCheckpoint: null,
			name: basename(sheet.path), sourcePath: null, locked: false, dialog: null, entries: [] });
		this.tail = Promise.resolve();
		this.unsubscribe = sheet.onWorkbookChange(kind => {
			if (kind === 'baseline') this.opened();
			else {
				if (kind === 'content') this.state.dirty = true;
				if (!this.state.enabled) this.refresh();
				this.state.pending = this.state.dirty;
				if (this.state.enabled && this.state.dirty) this.schedule();
			}
		});
		this.opened();
	}

	opened() {
		this.cancelTimers();
		this.document = {};
		this.id = createRecoveryId();
		this.revision = 0;
		this.hasCheckpoint = false;
		this.browserCopy = false;
		this.lastContent = null;
		this.baseline = signature(this.sheet.serializeWorkbook());
		this.state.name = basename(this.sheet.path);
		this.state.sourcePath = null;
		this.state.dirty = false;
		this.state.pending = false;
		this.state.lastCheckpoint = null;
		this.state.error = '';
	}

	capture() {
		// serializeWorkbook intentionally contains live arrays. Never pass them
		// through an await, to IndexedDB, or to native IPC without capturing them.
		const source = JSON.stringify(this.sheet.serializeWorkbook());
		const workbook = JSON.parse(source);
		// Project pending INSERT with the same pure preflight used at commit.
		// This preserves dataset growth/header protection without publishing
		// marks, recalculating pending input, or adding an undo entry.
		const previous = new HistoryManager().historyFor(this.sheet).undo.at(-1)?.state;
		const baseline = previous?.sheets.find(sheet => sheet.name === this.sheet.activeSheet.name)?.rows;
		const rows = workbook.sheets[workbook.activeSheet].rows;
		if (!this.sheet.markStructureChanged && baseline?.length === rows.length && baseline[0].length === rows[0].length) {
			const noted = new Set(this.sheet.markWriteCells);
			const writes = [];
			rows.forEach((row, r) => row.forEach((value, c) => {
				if (value !== baseline[r][c] || noted.has(`${r}:${c}`)) writes.push({ row: r, col: c, value });
			}));
			workbook.marks = JSON.parse(JSON.stringify(this.sheet.prepareMarkWrites(writes, baseline)));
		}
		this.sheet.validateWorkbook(workbook);
		const content = JSON.stringify(workbook);
		return { document: this.document, workbook, content, source, signature: signature(workbook),
			writes: [...(this.sheet.markWriteCells ?? [])], structureChanged: this.sheet.markStructureChanged };
	}

	refresh(captured) {
		try { captured ??= this.capture(); }
		catch (error) {
			// Invalid pending edits remain dirty and can still be discarded.
			this.state.error = message(error);
			this.state.dirty = this.state.pending = true;
			return null;
		}
		this.state.dirty = captured.signature !== this.baseline;
		this.state.pending = this.state.dirty && captured.content !== this.lastContent;
		return captured;
	}

	cancelTimers() { clearTimeout(this.timer); clearTimeout(this.deadline); this.timer = this.deadline = null; }
	schedule() {
		clearTimeout(this.timer);
		const run = () => { this.flush().catch(() => {}); };
		this.timer = setTimeout(run, 1000);
		this.deadline ??= setTimeout(run, 5000);
	}
	enqueue(operation) {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => {});
		return result;
	}

	async flush() {
		this.cancelTimers();
		const document = this.document;
		return this.enqueue(async () => {
			if (document !== this.document) return;
			const captured = this.refresh();
			if (!captured) throw new Error(this.state.error);
			if (!this.state.dirty && !this.browserCopy) {
				try { if (this.hasCheckpoint) await this.retire(); }
				catch (error) { this.state.error = message(error); throw error; }
				return;
			}
			if (captured.content === this.lastContent && this.hasCheckpoint) return;
			const record = { snapshotVersion: 1, id: this.id, revision: ++this.revision, updatedAt: Date.now(),
				sourcePath: this.sheet.path || this.state.sourcePath, name: this.state.name, workbook: captured.workbook };
			try {
				await this.store.write(record);
				if (document !== this.document) return;
				this.hasCheckpoint = true;
				this.lastContent = captured.content;
				this.state.lastCheckpoint = record.updatedAt;
				this.state.error = '';
				// The detached capture is still valid if no raw data or navigation changed during I/O.
				const unchanged = this.sheet.markStructureChanged === captured.structureChanged
					&& (this.sheet.markWriteCells?.size ?? 0) === captured.writes.length && captured.writes.every(key => this.sheet.markWriteCells.has(key))
					&& JSON.stringify(this.sheet.serializeWorkbook()) === captured.source;
				this.refresh(unchanged ? captured : undefined);
			} catch (error) { this.state.error = message(error); throw error; }
		});
	}

	async retire() {
		if (this.hasCheckpoint) await this.store.resolve(this.id);
		this.id = createRecoveryId();
		this.revision = 0;
		this.hasCheckpoint = false;
		this.lastContent = null;
		this.state.lastCheckpoint = null;
	}

	async saved(captured, path, exported = false) {
		if (captured.document !== this.document) return;
		if (!exported) this.sheet.path = path;
		this.baseline = captured.signature;
		this.browserCopy = exported;
		this.state.name = basename(path || this.state.name);
		this.state.sourcePath = null;
		this.state.error = '';
		this.refresh();
		// Serialize cleanup with pending writes. If edits happened during save,
		// their checkpoint must survive, even if it was already written.
		try { await this.flush(); }
		catch (error) { this.state.error = `Recovery: ${message(error)}`; }
	}

	async refreshList() {
		const entries = await this.store.list();
		this.state.entries = entries.filter(entry => entry.id !== this.id).map(entry => {
			const problems = entry.error ? [entry.error] : [];
			let record;
			for (const candidate of entry.generations) {
				try { this.sheet.validateWorkbook(candidate.workbook); record = candidate; break; }
				catch (error) { problems.push(message(error)); }
			}
			return { ...entry, record, error: problems.join('; ') };
		});
	}

	async showList() {
		try {
			await this.refreshList();
			// Native quit may have cancelled discard and opened its leave prompt
			// while this list was loading. Never replace that pending decision.
			if (!this.state.locked) this.state.dialog = { kind: 'list' };
		}
		catch (error) { this.state.error = message(error); }
	}
	ask(dialog) {
		return new Promise(resolve => { this.answerDialog = resolve; this.state.dialog = dialog; });
	}
	answer(value) {
		this.state.dialog = null;
		const answer = this.answerDialog;
		this.answerDialog = null;
		answer?.(value);
	}

	async guard(reason = 'open another workbook') {
		if (this.state.locked) return false;
		this.state.locked = true;
		try {
			// Session-only rule drafts are not recoverable workbook content. Never
			// let a clean baseline or Keep recovery silently discard them on exit.
			this.beforeLeave?.();
			await this.tail;
			this.refresh();
			if (!this.state.dirty) { await this.flush(); await this.store.release(this.id); return true; }
			const choice = await this.ask({ kind: 'leave', reason });
			if (choice === 'save') {
				const result = await this.save?.();
				if (!['saved', 'exported'].includes(result?.status)) return false;
				this.refresh();
				if (this.state.dirty) throw new Error('Workbook changed during save; please try again');
				if (result.status === 'exported') await this.flush();
			} else if (choice === 'keep') await this.flush();
			else if (choice === 'discard') {
				await this.enqueue(() => this.retire());
				this.cancelTimers();
			} else return false;
			await this.store.release(this.id);
			return true;
		} catch (error) { this.state.error = message(error); return false; }
		finally { this.state.locked = false; }
	}

	async restore(index) {
		const entry = this.state.entries[index];
		if (!entry?.record) { this.state.error = 'No readable checkpoint for that recovery copy'; return; }
		this.sheet.validateWorkbook(entry.record.workbook);
		this.state.dialog = null;
		if (!await this.guard('restore a recovery copy')) return;
		this.state.locked = true;
		try {
			this.sheet.loadWorkbook(entry.record.workbook, null);
			this.baseline = null; // A restored copy is unsaved, even if its original exists.
			this.state.name = `${entry.record.name.replace(/\.dflo$/i, '')} (recovered).dflo`;
			this.state.sourcePath = entry.record.sourcePath;
			this.browserCopy = false;
			this.refresh();
			await this.onOpen?.();
			await this.flush();
			// Only retire the old copy after the detached replacement is durable.
			if (!entry.active) await this.store.resolve(entry.id);
		} catch (error) { this.state.error = message(error); }
		finally { this.state.locked = false; this.focus?.(); }
	}

	async discard(index) {
		const entry = this.state.entries[index];
		if (!entry) { this.state.error = 'Unknown recovery copy'; return; }
		if (entry.active) { this.state.error = 'Recovery copy is in use, or its owner cannot be checked'; return; }
		if (await this.ask({ kind: 'discard', name: entry.record?.name || entry.id }) !== 'discard') return this.showList();
		try { await this.store.resolve(entry.id); }
		catch (error) { this.state.error = message(error); }
		await this.showList();
	}

	async command(command) {
		if (command === ':recover') return this.showList();
		const recover = command.match(/^:(recover|recoverdiscard)\s+([1-9]\d*)$/);
		if (recover) { await this.refreshList(); return this[recover[1] === 'recover' ? 'restore' : 'discard'](Number(recover[2]) - 1); }
		if (command === ':autosave now') return this.flush();
		if (command === ':autosave on' || command === ':autosave off') {
			this.state.enabled = command.endsWith('on');
			if (this.state.enabled) return this.flush();
			this.cancelTimers();
		} else if (command !== ':autosave') throw new Error('Usage: :autosave [on|off|now], :recover [number], :recoverdiscard number');
		this.refresh();
		this.report?.(`Recovery ${this.state.enabled ? 'on' : 'off'} · ${this.state.pending ? 'changes pending' : this.state.lastCheckpoint ? `checkpoint ${new Date(this.state.lastCheckpoint).toLocaleTimeString()}` : 'no checkpoint'}${this.state.error ? ` · ${this.state.error}` : ''}`);
	}

	async start() {
		this.state.locked = true;
		this.disposers = [];
		try {
			await this.refreshList();
			if (this.state.entries.length) this.state.dialog = { kind: 'list' };
		} catch (error) { this.state.error = message(error); }
		finally { this.state.locked = false; }
		const beforeUnload = event => { event.preventDefault(); event.returnValue = true; };
		const hidden = () => { if (this.state.enabled && document.visibilityState === 'hidden') this.flush().catch(() => {}); };
		document.addEventListener('visibilitychange', hidden);
		this.disposers.push(() => document.removeEventListener('visibilitychange', hidden));
		if (isTauri()) {
			this.disposers.push(await listen('lifecycle-request', async ({ payload }) => {
				this.answer('cancel');
				const proceed = await this.guard(payload.reason === 'update' ? 'install the update and restart' : 'quit DataFlow');
				this.state.locked = proceed;
				try { await invoke('lifecycle_complete', { id: payload.id, proceed }); }
				catch (error) { this.state.locked = false; this.state.error = message(error); }
			}));
			this.disposers.push(await listen('lifecycle-resume', () => { this.state.locked = false; }));
			await invoke('lifecycle_ready');
		} else {
			// Drafts remain session-only, but still need the browser's exit warning.
			this.disposers.push(watch(() => this.state.dirty || this.hasDrafts?.(), dirty => {
				window[dirty ? 'addEventListener' : 'removeEventListener']('beforeunload', beforeUnload);
			}, { immediate: true }));
			this.disposers.push(() => window.removeEventListener('beforeunload', beforeUnload));
		}
	}

	async close() {
		this.cancelTimers(); this.unsubscribe(); this.answer('cancel');
		for (const dispose of this.disposers || []) dispose();
		await this.tail;
		await this.store.close();
	}
}
