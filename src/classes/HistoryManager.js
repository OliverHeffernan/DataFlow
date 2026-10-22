export default class HistoryManager {
	constructor() {
		if (HistoryManager.instance) return HistoryManager.instance;
		this.histories = new WeakMap(); this.maxLength = 50; this.maxBytes = 64 * 1024 * 1024;
		HistoryManager.instance = this;
	}
	historyFor(sheetManager) {
		if (!this.histories.has(sheetManager)) this.histories.set(sheetManager, { undo: [], redo: [] });
		return this.histories.get(sheetManager);
	}
	reset(sheetManager) { const history = this.historyFor(sheetManager); history.undo = []; history.redo = []; this.do(sheetManager, false); }
	do(sheetManager, notify = true) {
		const history = this.historyFor(sheetManager);
		const state = sheetManager.serializeWorkbook?.() ?? { rows: sheetManager.rows, styles: sheetManager.styles };
		// Navigation is persisted, but never creates an undo entry.
		const { activeSheet, ...content } = state;
		const text = JSON.stringify(content);
		if (history.undo.at(-1)?.text === text) return false;
		history.undo.push({ state: { ...JSON.parse(text), ...(activeSheet === undefined ? {} : { activeSheet }) }, text, bytes: text.length * 2 }); history.redo = [];
		let bytes = history.undo.reduce((total, item) => total + item.bytes, 0);
		while (history.undo.length > 1 && (history.undo.length > this.maxLength || bytes > this.maxBytes)) bytes -= history.undo.shift().bytes;
		if (notify) sheetManager.notifyWorkbookChanged?.();
		return true;
	}
	undo(sheetManager, amount = 1) {
		const history = this.historyFor(sheetManager);
		const before = history.undo.length;
		while (amount-- > 0 && history.undo.length > 1) history.redo.push(history.undo.pop());
		if (history.undo.length !== before) this.loadState(sheetManager, history.undo.at(-1));
	}
	redo(sheetManager, amount = 1) {
		const history = this.historyFor(sheetManager);
		const before = history.undo.length;
		while (amount-- > 0 && history.redo.length) history.undo.push(history.redo.pop());
		if (history.undo.length !== before) this.loadState(sheetManager, history.undo.at(-1));
	}
	loadState(sheetManager, entry) {
		const state = JSON.parse(JSON.stringify(entry.state));
		if (sheetManager.restoreWorkbook) {
			sheetManager.restoreWorkbook(state);
			sheetManager.notifyWorkbookChanged?.();
			return;
		}
		sheetManager.rows = state.rows.map(row => [...row]);
		sheetManager.styles = state.styles.map(row => row.map(style => ({ ...style })));
		sheetManager.numOfRows.value = sheetManager.rows.length;
		sheetManager.numOfCols.value = sheetManager.rows[0].length;
		sheetManager.selRow = Math.min(sheetManager.selRow, sheetManager.rows.length - 1);
		sheetManager.selCol = Math.min(sheetManager.selCol, sheetManager.rows[0].length - 1);
		sheetManager.loadAllCells();
		sheetManager.notifyWorkbookChanged?.();
	}
}
