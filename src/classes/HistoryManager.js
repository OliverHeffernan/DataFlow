export default class HistoryManager {
	constructor() {
		if (HistoryManager.instance) return HistoryManager.instance;
		this._undo = []; this._redo = []; this.maxLength = 50;
		HistoryManager.instance = this;
	}
	reset(sheetManager) { this._undo = []; this._redo = []; this.do(sheetManager); }
	do(sheetManager) {
		const state = { rows: sheetManager.rows.map(row => [...row]), styles: sheetManager.styles.map(row => row.map(style => ({ ...style }))) };
		if (JSON.stringify(this._undo.at(-1)) === JSON.stringify(state)) return;
		this._undo.push(state); this._redo = [];
		if (this._undo.length > this.maxLength) this._undo.shift();
	}
	undo(sheetManager, amount = 1) {
		while (amount-- > 0 && this._undo.length > 1) this._redo.push(this._undo.pop());
		if (this._undo.length) this.loadState(sheetManager, this._undo.at(-1));
	}
	redo(sheetManager, amount = 1) {
		while (amount-- > 0 && this._redo.length) this._undo.push(this._redo.pop());
		if (this._undo.length) this.loadState(sheetManager, this._undo.at(-1));
	}
	loadState(sheetManager, state) {
		sheetManager.rows = state.rows.map(row => [...row]);
		sheetManager.styles = state.styles.map(row => row.map(style => ({ ...style })));
		sheetManager.numOfRows.value = sheetManager.rows.length;
		sheetManager.numOfCols.value = sheetManager.rows[0].length;
		sheetManager.selRow = Math.min(sheetManager.selRow, sheetManager.rows.length - 1);
		sheetManager.selCol = Math.min(sheetManager.selCol, sheetManager.rows[0].length - 1);
		sheetManager.loadAllCells();
	}
}
