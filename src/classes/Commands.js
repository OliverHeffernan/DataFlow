import SheetManager from "./SheetManager.js";
const sheetManager = new SheetManager();

import VisualManager from "./VisualManager.js";
const visualManager = new VisualManager();

import MacroManager from "./MacroManager.js";

export default class Commands {
	constructor() {
		if (Commands.instance) {
			return Commands.instance;
		}
		this.mode = "n";
		this.selStartRow = null;
		this.selStartCol = null;
		this.tempForm = "";
		Commands.instance = this;
	}

	setTempForm(value) {
		this.tempForm = value;
	}

	changeMode(mode) {
		let modeName;
		switch (mode) {
			case "n":
				modeName = "NORMAL";
				break;
			case "i":
				modeName = "INSERT";
				break;
			case "v":
				modeName = "VISUAL";
				break;
			case "V":
				modeName = "VISUAL-LINE";
				break;
		}

		document.getElementById("formCursor").className = mode;

		document.getElementById("modeDisplay").innerText = `-- ${modeName} --`;
		this.mode = mode;
	}

	byId(id) {
		return document.getElementById(id);
	}

	clearComLine() {
		document.getElementById("commandLine").value = "";
	}

	handleEsc() {
		if (this.mode == "i") {
			this.setFormula();
		}
		visualManager.exitVisual();
		this.changeMode("n");
		const macroManager = new MacroManager();
		macroManager.addToRecording("<ESC>", "key");
		document.getElementById("commandLine").value = "";
	}

	// enter insert mode
	insert() {
		this.changeMode("i");
		const row = sheetManager.selRow;
		const col = sheetManager.selCol;
		this.tempForm = sheetManager.getFormula(row, col);
		this.clearComLine();
	}

	backspace() {
		const macroManager = new MacroManager();
		macroManager.addToRecording("<B-SPACE>", "key");
		const cellCol = sheetManager.cellCurPos;
		if (cellCol === 0) return;

		//let newForm = this.tempForm;
		let newForm = sheetManager.tempForm;
		newForm = newForm.slice(0, cellCol - 1) + newForm.slice(cellCol);

		this.tempForm = newForm;
		sheetManager.tempForm = newForm;

		sheetManager.updateEditFormula(newForm);
		//sheetManager.setCellCurPos(cellCol - 1, this.tempForm);
		sheetManager.setCellCurPos(cellCol - 1, sheetManager.tempForm);
	}

	deleteKey() {
		const macroManager = new MacroManager();
		macroManager.addToRecording("<DEL>", "key");
		const cellCol = sheetManager.cellCurPos;
		if (cellCol === 0) return;

		let newForm = this.tempForm;
		newForm = newForm.slice(0, cellCol) + newForm.slice(cellCol + 1);

		this.tempForm = newForm;

		sheetManager.updateEditFormula(newForm);
	}

	insertText(com) {
		const row = sheetManager.selRow;
		const col = sheetManager.selCol;
		const cellCol = sheetManager.cellCurPos;
		//let cell = sheetManager.getFormula(row, col);

		let cell = this.tempForm;

		const firstPart = cell.slice(0, cellCol);
		const endPart = cell.substring(cellCol);
		cell = firstPart + com + endPart;

		this.tempForm = cell;

		sheetManager.updateEditFormula(cell);
		//sheetManager.setCellCurPos(cellCol + com.length, this.tempForm);
		sheetManager.tempForm = this.tempForm;
		sheetManager.setCellCurPos(cellCol + com.length, sheetManager.tempForm);
	}

	startOfCell() {
		const row = sheetManager.selRow;
		const col = sheetManager.selCol;
		const form = sheetManager.getFormula(row, col);
		sheetManager.setCellCurPos(0, form);
		this.clearComLine();
	}

	endOfCell() {
		const row = sheetManager.selRow;
		const col = sheetManager.selCol;
		const form = sheetManager.getFormula(row, col);
		console.log(form.length);

		//sheetManager.setCellCurPos(form.length, this.tempForm);
		sheetManager.setCellCurPos(form.length, sheetManager.tempForm);

		this.clearComLine();
	}

	setFormula() {
		sheetManager.setSpecFormula(sheetManager.tempForm);
	}

	insertAtFirstColumn() {
		this.tempForm = sheetManager.getFormula(row, col);
		sheetManager.selectCell(sheetManager.selRow, 0);
		this.changeMode("i");
		formBar.focus();
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
		visualManager.startVisual(
			sheetManager.selRow,
			0,
			true,
			sheetManager.numOfCols.value,
		);
		this.clearComLine();
	}

	selectFirstColumn() {
		this.tempForm = sheetManager.getFormula(row, col);
		sheetManager.selectCell(sheetManager.selRow, 0);
		this.clearComLine();
	}

	selectLastColumn() {
		//sheetManager.selectCell(sheetManager.selRow, sheetManager.numOfCols.value - 1);
		//
		const row = sheetManager.selRow;
		let col = sheetManager.rows[row].findLastIndex((element) => element != "");
		console.log("col", col);
		col = Math.max(0, col);
		col = Math.min(col, sheetManager.rows[row].length - 1);
		this.tempForm = sheetManager.getFormula(row, col);
		sheetManager.selectCell(row, col);
		this.clearComLine();
	}

	replaceFormula() {
		const formBar = this.byId("formulaBar");
		//formBar.value = "";
		this.tempForm = "";
		//formBar.focus();
		this.changeMode("i");
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

		this.tempForm = sheetManager.getFormula(row, col);

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
		this.tempForm = sheetManager.getFormula(0, col);
		this.clearComLine();
	}

	selectRow(row) {
		let col = sheetManager.selCol;
		this.tempForm = sheetManager.getFormula(row, col);
		sheetManager.selectCell(row, col);
	}

	selectLastRow() {
		let col = sheetManager.selCol;
		let row = sheetManager.numOfRows.value - 1;
		this.tempForm = sheetManager.getFormula(row, col);
		sheetManager.selectCell(row, col);
		this.tempForm = sheetManager.getFormula(row, col);
		this.clearComLine();
	}

	jumpWhiteSpace(amount = 1) {
		console.log("kia ora");
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;
		
		//form = form.substring(pos);
		//pos += form.indexOf(" ") + 1;
		
		let newPos = pos;

		for (let i = 0; i < amount; i++) {
			newPos = form.indexOf(" ", newPos) + 1;
		}
		
		// ensures the position increases, and doesn't cycle through the formula.
		newPos = newPos > pos ? newPos : pos;

		sheetManager.setCellCurPos(newPos, sheetManager.tempForm);
	}

	jumpBackWhiteSpace(amount = 1) {
		console.log("kia ora");
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;
		
		let newPos = pos;
		for (let i = 0; i < amount; i++) {
			newPos = form.substring(0, newPos - 1).lastIndexOf(" ") + 1;
		}
		
		// ensures the position decreases, and doesn't cycle through the formula.
		newPos = newPos < pos ? newPos : pos;

		sheetManager.setCellCurPos(newPos, sheetManager.tempForm);
	}

	// different to the convention provided by neovim, but I prefer this.
	// may need to conform to the convention in the future.
	jumpWord(amount = 1) {
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;

		let index;

		for (let i = pos; i < form.length - 1; i++) {
			// check if the previous character is punctuation, and that the current character is not punctuation, signifying the
			// start of a word.
			if (this.isStartOfWord(form[i], form[i + 1])) {
				amount--;
				if (amount == 0) {
					index = i + 1;
					break;
				}
			}
		}
		if (index) {
			sheetManager.setCellCurPos(index, sheetManager.tempForm);
		}
	}

	jumpEndWord(amount = 1) {
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;
		let index;
		for (let i = pos + 1; i < form.length - 1; i++) {
			if (this.isEndOfWord(form[i], form[i + 1])) {
				amount --;
				if (amount == 0) {
					index = i;
					break;
				}
			}
		}
		index = index ? index : form.length - 1;
		sheetManager.setCellCurPos(index, sheetManager.tempForm)
	}

	jumpBackWord(amount = 1) {
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;

		let index;

		for (let i = pos - 2; i >= 0; i--) {
			// check if the previous character is punctuation, and that the current character is not punctuation, signifying the
			// start of a word.
			if (this.isStartOfWord(form[i], form[i + 1])) {
				amount--;
				if (amount == 0) {
					index = i + 1;
					break;
				}
			}
		}
		console.log("kia ora");
		index = index ? index : 0;
		sheetManager.setCellCurPos(index, sheetManager.tempForm);
	}

	matchPairMotion() {
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;

		let index;
		let char;
		for (let i = pos; i < form.length; i++) {
			let tempChar = this.getOppositeChar(form[i]);
			if (tempChar) {
				char = tempChar;
				index = i;
				break;
			}
		}
		
		let startChar = form[index];
		let depth = 0;

		for (index > 0; index < form.length; index += char.dir) {
			if (form[index] == startChar) {
				depth++;
			}
			else if (form[index] == char.char) {
				depth--;

				if (depth <= 0) {
					break;
				}
			}
		}

		sheetManager.setCellCurPos(index, sheetManager.tempForm);
	}

	findIndexOfCharacter(char) {
		let form = sheetManager.tempForm;
		let pos = sheetManager.cellCurPos;

		let index = form.indexOf(char, pos + 1);
		// if not found, it returns the original position.
		return index >= 0 ? index : pos;
	}

	findCharacter(char) {
		const index = this.findIndexOfCharacter(char);
		if (!index) return;
		sheetManager.setCellCurPos(index, sheetManager.tempForm);
	}

	isPunctuation(char) {
		return /\p{P}|\p{Zs}/u.test(char);
	}

	isStartOfWord(prev, char) {
		return this.isPunctuation(prev) && !this.isPunctuation(char);
	}

	isEndOfWord(prev, char) {
		return !this.isPunctuation(prev) && this.isPunctuation(char);
	}

	getOppositeChar(char) {
		switch (char) {
			case "(":
				return {
					char: ")",
					dir: 1
				}
			case ")":
				return {
					char: "(",
					dir: -1
				}
			case "[":
				return {
					char: "]",
					dir: 1
				}
			case "]":
				return {
					char: "[",
					dir: -1
				}
			case "{":
				return {
					char: "}",
					dir: 1
				}
			case "}":
				return {
					char: "{",
					dir: -1
				}
		}
	}
}
