//import SheetManager from "./SyntaxHighlighting.js";

export default class HistoryManager {
	constructor() {
		if (HistoryManager.instance) {
			return HistoryManager.instance;
		}
		this._undo = [];
		this._redo = [];
		// if the last action was an undo this is true
		this.lastUndo = false;
		// and vice versa
		this.lastRedo = false;
		this.maxLength = 50;

		HistoryManager.instance = this;
	}

	do(sheetManager, line) {
		this.lastUndo = false;
		this.lastRedo = false;
		//console.log("do", line);
		this._undo.push({
			rows: sheetManager.rows.map(row => [...row]),
			styles: sheetManager.styles.map(row => [...row])
		});
		this._redo = [];
		this.fitLength();
	}

	undo(sheetManager, amount = 1) {
		if (this._undo.length == 0 ) return;
		//const state = this._undo.pop();
		let state;
		if (!this.lastUndo) {
			amount++;
		}
		for (let i = 0; i < amount; i++) {
			state = this._undo.pop();
			this._redo.push(state);
		}

		this.loadState(sheetManager, state);
		this.lastUndo = true;
		this.lastRedo = false;
	}

	redo(sheetManager, amount = 1) {
		if (this._redo.length == 0 ) return;
		let state;

		if (!this.lastRedo) {
			amount++;
		}
		for (let i = 0; i < amount; i++) {
			state = this._redo.pop();
			this._undo.push(state);
		}

		this.loadState(sheetManager, state);
		this.lastUndo = false;
		this.lastRedo = true;
	}


	loadState(sheetManager, state) {
		sheetManager.rows = state.rows;
		sheetManager.styles = state.styles;
		sheetManager.loadAllCells(sheetManager.numOfRows.value, sheetManager.numOfCols.value);
		sheetManager.loadStyles();
	}

	fitLength() {
		if (this._undo.length > this.maxLength) {
			this._undo.splice(0, this._undo.length - this.maxLength);
		}
	}
}
