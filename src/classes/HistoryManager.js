export default class HistoryManager {
	constructor() {
		if (HistoryManager.instance) return HistoryManager.instance;
		this.histories = new WeakMap(); this.maxLength = 50;
		HistoryManager.instance = this;
	}
	historyFor(sheetManager) {
		const sheet = sheetManager.activeSheet ?? sheetManager;
		if (!this.histories.has(sheet)) this.histories.set(sheet, { undo: [], redo: [] });
		return this.histories.get(sheet);
	}
	reset(sheetManager) { const history = this.historyFor(sheetManager); history.undo = []; history.redo = []; this.do(sheetManager, false); }
	do(sheetManager, notify = true) {
		const history = this.historyFor(sheetManager);
		const state = { rows: sheetManager.rows.map(row => [...row]), styles: sheetManager.styles.map(row => row.map(style => ({ ...style }))) };
		if (JSON.stringify(history.undo.at(-1)) === JSON.stringify(state)) return false;
		history.undo.push(state); history.redo = [];
		if (history.undo.length > this.maxLength) history.undo.shift();
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
	rewrite(sheet, transform) {
		const history = this.historyFor(sheet);
		for (const state of [...history.undo, ...history.redo]) state.rows = state.rows.map(row => row.map(transform));
	}
	loadState(sheetManager, state) {
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
