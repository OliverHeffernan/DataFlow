export default class VisualManager {
	constructor() {
		if (VisualManager.instance) {
			return VisualManager.instance;
		}
		this.startRow = null;
		this.startCol = null;
		VisualManager.instance = this;
	}

	startVisual(row, col) {
		this.startRow = row;
		this.startCol = col;
		this.setVisual(this.startRow, this.startCol);
	}

	getSelectionElement(row, col) {
		let element = document.getElementById("visual" + col + ":" + row);
		return element;
	}

	setVisual(endRow, endCol) {
		if (this.startRow == null || this.startCol == null) return;

		this.clearVisual();

		let startRow = Math.min(this.startRow, endRow);
		endRow = Math.max(this.startRow, endRow);

		let startCol = Math.min(this.startCol, endCol);
		endCol = Math.max(this.startCol, endCol);
		for (let y = startRow; y <= endRow; y++) {
			for (let x = startCol; x <= endCol; x++) {
				this.getSelectionElement(y, x).className = "sel active";
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
	}

	exitVisual() {
		if (this.startRow == null && this.startCol == null) return;
		this.clearVisual();
		this.startRow = null;
		this.startCol = null;
	}

	yankSelection(sheetManager) {
		let endRow = sheetManager.selRow;
		let endCol = sheetManager.selCol;
		let startRow = Math.min(this.startRow, endRow);
		endRow = Math.max(this.startRow, endRow);

		let startCol = Math.min(this.startCol, endCol);
		endCol = Math.max(this.startCol, endCol);
		let buffer = [];
		for (let y = startRow; y <= endRow; y++) {
			let line = [];
			for (let x = startCol; x <= endCol; x++) {
				line.push(sheetManager.getFormula(y, x));
			}

			buffer.push(line);
		}

		console.log(buffer);

		sheetManager.copyBuffer = buffer;
	}

}
