import SheetManager from "./SheetManager.js";
export default class VisualManager {
	constructor() {
		if (VisualManager.instance) {
			return VisualManager.instance;
		}
		this.startRow = null;
		this.startCol = null;
		this.startCellCurPos = null;
		this.line = false;
		this.dragging = false;
		VisualManager.instance = this;
	}

	startVisual(row, col, cellCurPos, line = false, numOfCols) {
		//checkCommand.changeMode("v");
		this.startRow = row;
		this.startCol = col;
		this.startCellCurPos = cellCurPos;
		this.line = line;
		this.setVisual(this.startRow, this.startCol, numOfCols);
	}

	getSelectionElement(row, col) {
		let element = document.getElementById("visual" + col + ":" + row);
		return element;
	}

	setVisual(endRow, endCol, cellCurPos, numOfCols) {
		if (this.startRow == null || this.startCol == null) return;

		if (this.startRow == endRow && this.startCol == endCol) {
			this.clearVisual();
			const cursor = document.getElementById("formCursor");
			cellCurPos = cellCurPos >= this.startCellCurPos ? cellCurPos + 1 : cellCurPos;
			const tempStart = this.startCellCurPos >= cellCurPos ? this.startCellCurPos + 1 : this.startCellCurPos;
			cursor.style.width = Math.abs(cellCurPos - tempStart) + "ch";
			cursor.style.marginLeft = Math.min(cellCurPos, tempStart) + "ch";

			return;
		}

		this.clearVisual();

		let startRow = Math.min(this.startRow, endRow);
		endRow = Math.max(this.startRow, endRow);

		let startCol = Math.min(this.startCol, endCol);
		endCol = this.line ? numOfCols - 1 : Math.max(this.startCol, endCol);
		for (let y = startRow; y <= endRow; y++) {
			for (let x = startCol; x <= endCol; x++) {
				let dir = "";
				if (y == startRow) dir += " t";
				if (y == endRow) dir += " b";
				if (x == startCol) dir += " l";
				if (x == endCol) dir += " r";
				this.getSelectionElement(y, x).className = "sel active" + dir;
			}
		}

	}

	// clears the styling of the visual selection,
	clearVisual() {
		const collection = document.getElementsByClassName("active");
		const visuals = [...collection];
		for (let i = 0; i < visuals.length; i++) {
			visuals[i].className = "sel inactive";
		}
		
		const cursor = document.getElementById("formCursor");
		cursor.style.width = "1ch";
		cursor.style.marginLeft = new SheetManager().cellCurPos + "ch";
	}

	exitVisual() {
		if (this.startRow == null && this.startCol == null) return;
		this.clearVisual();
		this.startRow = null;
		this.startCol = null;
	}

	yankSelection(sheetManager, formula = true) {
		let endRow = sheetManager.selRow;
		let endCol = this.line ? sheetManager.numOfCols.value : sheetManager.selCol;
		let startRow = Math.min(this.startRow, endRow);
		endRow = Math.max(this.startRow, endRow);

		let startCol = Math.min(this.startCol, endCol);
		endCol = Math.max(this.startCol, endCol);
		let buffer = [];
		for (let y = startRow; y <= endRow; y++) {
			let line = [];
			for (let x = startCol; x <= endCol; x++) {
				if (formula) line.push(sheetManager.getFormula(y, x));
				else line.push(sheetManager.getValue(y, x));
			}

			buffer.push(line);
		}


		sheetManager.copyBuffer = buffer;
	}

}
