import SheetManager from "./SheetManager.js";
const sheetManager = new SheetManager();

import VisualManager from "./VisualManager.js";
const visualManager = new VisualManager();

export default class Commands {
	constructor() {
		if (Commands.instance) {
			return Commands.instance;
		}
		this.mode = "n";
		this.selStartRow = null;
		this.selStartCol = null;
		Commands.instance = this;
	}
	changeMode(mode) {
		let modeName;
		switch (mode) {
			case 'n':
				modeName = "NORMAL";
				break;
			case 'i':
				modeName = "INSERT";
				break;
			case 'v':
				modeName = "VISUAL";
				break;
			case 'V':
				modeName = "VISUAL-LINE";
				break;
		}

		document.getElementById("modeDisplay").innerText = `-- ${modeName} --`
		this.mode = mode;
	}

	byId(id) {
		return document.getElementById(id);
	}

	clearComLine() {
		document.getElementById("commandLine").value = "";
	}

	handleEsc() {
		visualManager.exitVisual();
		this.changeMode("n");
		document.getElementById("commandLine").value = "";
	}
	// enter insert mode
	insert() {
		const formBar = this.byId("formulaBar");
		formBar.focus();
		this.changeMode("i");
		formBar.setSelectionRange(0,0);
		this.clearComLine();
	}

	insertAtFirstColumn() {
		sheetManager.selectCell(sheetManager.selRow, 0);
		this.changeMode("i");
		formBar.focus();
		this.clearComLine();
	}

	append() {
		const formBar = this.byId("formulaBar");
		formBar.focus();
		this.changeMode("i");
		const end = formBar.value.length;
		formBar.setSelectionRange(end,end);
		this.clearComLine();
	}

	startVisual() {
		this.changeMode("v");
		this.selStartRow = sheetManager.selRow;
		this.selStartCol = sheetManager.selCol;
		visualManager.startVisual(sheetManager.selRow, sheetManager.selCol);
		this.clearComLine();
	}

	startVisualLine() {
		this.changeMode("V");
		this.selStartRow = sheetManager.selRow;
		this.selStartCol = 0;
		visualManager.startVisual(sheetManager.selRow, 0, true, sheetManager.numOfCols.value);
		this.clearComLine();
	}

	selectFirstColumn() {
		sheetManager.selectCell(sheetManager.selRow, 0);
		this.clearComLine();
	}

	selectLastColumn() {
		sheetManager.selectCell(sheetManager.selRow, sheetManager.numOfCols.value - 1);
		this.clearComLine();
	}

	replaceFormula() {
		const formBar = this.byId("formulaBar");
		formBar.value = "";
		formBar.focus();
		sheetManager.setFormula(false);
		this.clearComLine();
	}

	clearSelection() {
		const startRow = visualManager.startRow;
		const startCol = visualManager.startCol;
		const endRow = sheetManager.selRow;
		const endCol = sheetManager.selCol;

		const sr = Math.min(startRow, endRow);
		const sc = Math.min(startCol, endCol);
		const er = Math.max(startRow, endRow);
		const ec = Math.max(startCol, startCol);

		for (let i = sr; i < er + 1; i++) {
			for (let p = sc; p < ec + 1; p++) {
				sheetManager.rows[i][p] = "";
			}
		}

		sheetManager.loadAllCells();
		this.clearComLine();
	}

	deleteSelectedRows() {
		const startRow = visualManager.startRow;
		const endRow = sheetManager.selRow;
		const selCol = sheetManager.selCol;

		const sr = Math.min(startRow, endRow);
		const er = Math.max(startRow, endRow);

		const amount = er - sr;

		sheetManager.selectCell(sr, selCol);

		sheetManager.deleteSelRow(amount + 1);

		this.clearComLine();
	}

	focusCellPicker() {
		cellPicker.focus();
		cellPicker.value = "";
		this.clearComLine();
	}

	viewportCenterCell() {
		sheetManager.scrollToCenterSelCell();
		this.clearComLine();
	}

	insertRowBelow() {
		sheetManager.insertRowBelow();
		this.clearComLine();
	}

	insertRowAbove() {
		sheetManager.insertRowAbove();
		this.clearComLine();
	}

	insertColLeft() {
		sheetManager.insertColLeft();
		this.clearComLine();
	}

	insertColRight() {
		sheetManager.insertColRight();
		this.clearComLine();
	}

	yankSelectionFormulae() {
		let col = sheetManager.selCol;
		let row = sheetManager.selRow;
		let text = sheetManager.getFormula(row, col);
		navigator.clipboard.writeText(text);

		visualManager.yankSelection(sheetManager);

		this.clearComLine();
		this.handleEsc();
	}

	yankSelectionValues() {
		let col = sheetManager.selCol;
		let row = sheetManager.selRow;
		let text = sheetManager.getValue(row, col);
		navigator.clipboard.writeText(text);

		visualManager.yankSelection(sheetManager, false);

		this.clearComLine();
		this.handleEsc();
	}

	yankFormula() {
		sheetManager.yankFormula();
		this.clearComLine();
	}

	yankValue() {
		sheetManager.yankValue();
		this.clearComLine();
	}

	yankRowFormulae() {
		const row = sheetManager.selRow;
		let buffer = sheetManager.rows[row];
		let endIndex = buffer.lastIndexOf("");
		buffer = endIndex === -1 ? buffer : buffer.slice(0, endIndex + 1);

		sheetManager.yank([buffer]);
		this.clearComLine();
	}

	selectRowZero() {
		let col = sheetManager.selCol;
		sheetManager.selectCell(0, col);
		this.clearComLine();
	}

	selectRow(row) {
		let col = sheetManager.selCol;
		sheetManager.selectCell(row, col);
	}

	selectLastRow() {
		let col = sheetManager.selCol;
		let row = sheetManager.numOfRows.value - 1;
		sheetManager.selectCell(row, col);
		this.clearComLine();
	}
}
