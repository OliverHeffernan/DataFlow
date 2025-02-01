import { ref } from "vue";
//import { reactive } from "vue";
import { create, all } from 'mathjs'
import Formulas from './FormulaFunctions.js';
const formulas = new Formulas();
const config = { }
const math = create(all, config)

import VisualManager from './VisualManager.js';
const visualManager = new VisualManager();

export default class SheetManager {
	constructor() {
		// make sure there is only one instance of SheetManager
		if (SheetManager.instance) {
			return SheetManager.instance;
		}

		this.rows = [];
		this.styles = [];
		this.defaultBG = "#091119";
		this.defaultFG = "white";

		this.numOfRows = ref(50);
		this.numOfCols = ref(50);
		this.selRow = 0;
		this.selCol = 0;
		this.cellCurPos = 0;
		this.prevRow = 0;
		this.prevCol = 0;
		this.copyBuffer = [[]];
		this.path = null;
		this.defaultStyling = {
			fg: "white",
			bg: "transparent"
		};

		// create a 2D array of empty strings
		for (let i = 0; i < this.numOfRows.value; i++) {
			let row = [];
			let styleRow = [];
			for (let j = 0; j < this.numOfCols.value; j++) {
				row.push("");
				styleRow.push({
					fg: "white",
					bg: "transparent"
				});
			}
			this.rows.push(row);
			this.styles.push(styleRow);
		}
		SheetManager.instance = this;
	}

	clearScreen() {
		this.rows = [];
		this.styles = [];

		for (let i = 0; i < this.numOfRows.value; i++) {
			let row = [];
			let styleRow = [];
			for (let j = 0; j < this.numOfCols.value; j++) {
				row.push("");
				styleRow.push({
					fg: "white",
					bg: "transparent"
				});
			}
			this.rows.push(row);
			this.styles.push(styleRow);
		}

		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.loadStyles();
	}

	loadStyles() {
		//const cols = this.numOfCols.value;
		//const rows = this.numOfRows.value;
		//
		const cols = this.rows[0].length;
		const rows = this.rows.length;

		for (let x = 0; x < cols; x++) {
			for (let y = 0; y < rows; y++) {
				try {
					const styles = this.styles[y][x];
					const com = `:hi bg ${styles.bg} fg ${styles.fg}`;
					this.setStyles(com, y, x);
				} catch(e) {
					console.log(e.message);
				}
			}
		}
	}


	setStyles(com, row, col) {
		const split = com.split(" ");
		let validCom = true;
		for (let i = 1; i < split.length; i++) {
			const color = split[i];
			const style = new Option().style;
			style.color = color;
			// check if it is a valid css color
			const validColor = style.color !== '';
			if (split[i - 1] == "bg") {
				if (validColor) {
					this.getCell(row, col).style.backgroundColor = split[i];
					this.styles[row][col].bg = split[i];
				}
				else {
					this.setPlaceholder(color + "is not a valid CSS color");
				}
			}
			else if (split[i - 1] == "fg") {
				if (validColor) {
					this.getCell(row, col).style.color = split[i];
					this.styles[row][col].fg = split[i];
				}
				else {
					this.setPlaceholder(color + "is not a valid CSS color");
				}
			}
			else if (split[i] == "reset") {
				this.resetStyles(row, col);
			}
			else if (split[i] == "resetall") {
				this.resetAllStyles();
			}
		}
	}

	resetStyles(row, col) {
		this.setStyles(":hi fg white bg transparent", row, col);
	}

	resetAllStyles() {
		const cols = this.numOfCols.value;
		const rows = this.numOfRows.value;
		//for (let x = 0; x < cols; x++) {
			//for (let y = 0; y < rows; y++) {
				//this.resetStyles(x, y);
			//}
		//}

		let styleRow = [];
		let styles = [];
		for (let i = 0; i < cols; i++) {
			//styleRow.push(this.defaultStyling);
			styleRow.push({
				fg: this.defaultStyling.fg,
				bg: this.defaultStyling.bg
			});
		}

		for (let p = 0; p < rows; p++) {
			styles.push(styleRow);
		}

		this.styles = styles;

		this.loadStyles();
	}

	// function to get the formula for a specific cell
	getFormula(row, col) {
		// tries to get the formula, if it fails, it returns blank and logs the error
		try {
			return this.rows[row][col];
		}
		catch(e) {
			console.log(e.message);
			return '';
		}
	}

	// get the value of a specific cell
	getValue(row, col) {
		let expr = this.getFormula(row, col);

		// if the cell is not a formula, return the expression with no changes
		if (expr[0] !== "=") {
			return expr;
		}
		// remove the equals sign from the expression
		expr = expr.substring(1);

		// replacing all variables and relative references
		expr = formulas.replaceVariables(expr, row, col);

		// replacing curly brace calcs with a number result
		expr = formulas.evaluateRefCalcs(expr, this);
		// replacing square brace calcs with a letter result for col references
		expr = formulas.evaluateLetterRefCalcs(expr, this);
		// remove all white space
		expr = expr.replaceAll(" ", "");
		// replacing cell ranges with string objects containing the sum and array.
		// replace cell ranges (e.g. A0:A20) with objects
		expr = formulas.replaceCellRanges(expr, row, col, this);
		if (expr === "circular") return "circular logic detected";
		// replacing SUM with its value
		expr = formulas.replaceSUM(expr);
		expr = formulas.replaceAVG(expr);
		// replacing SUMIF with its value
		// SUMIF(conditionRange| criteria| valueRange)
		expr = formulas.replaceSUMIF(expr);
		expr = formulas.replaceCOUNTIF(expr);
		expr = formulas.replaceAVGIF(expr);
		// replacing COUNT with the count
		expr = formulas.replaceCOUNT(expr);
		// replacing cell references with their values
		expr = formulas.replaceReferences(expr, this);

		// try to evaluate the expreession, if it fails, return the error message.
		try {
			return math.evaluate(expr);
		}
		catch(e) {
			return e.message;
		}
	}

	// function to select a specific cell
	selectCell(row, col) {
		if (document.getElementsByClassName("rcActive").length != 0) {
			document.getElementsByClassName("rcActive")[0].className = "cellRightClick rcInactive";
		}
		// tries to select the cell, if it fails, it logs the error
		try {
			this.selRow = row;
			this.selCol = col;
			// display the formula of the new selected cell in the formula bar
			//let bar = document.getElementById("formulaBar");
			//bar.value = this.getFormula(row, col);

			let newBar = document.getElementById("formText");
			newBar.innerText = this.getFormula(row, col);

			// if it is defined, remove the focussed class from the previously selected cell
			if (this.getSelectedCell() != undefined) {
				this.getSelectedCell().className = "cell";
			}

			// update the cell picker value
			document.getElementById("cellPicker").value = String.fromCharCode(col + 65) + (row);

			// add the focussed class to the new selected cell
			this.getCell(row, col).className = "focussed cell";

			// update the relative row numbers
			this.updateRelRows();
			let scrollCol = col;
			if (this.selCol < this.prevCol) {
				scrollCol = col > 1 ? col - 1 : 0;
			}
			let scrollRow = row;
			if (this.selRow > this.prevRow) {
				scrollRow = row < this.numOfRows.value - 1 ? row + 1 : this.numOfRows.value - 1;
			}
			else if (this.selRow < this.prevRow) {
				scrollRow = row > 2 ? row - 2 : 0;
			}

			const cell = this.getCell(scrollRow, scrollCol);

			const initialPos = cell.getBoundingClientRect();

			this.getCell(scrollRow, scrollCol).scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});

			const finalPos = cell.getBoundingClientRect();

			const scrolled = initialPos.top !== finalPos.top || initialPos.left !== finalPos.left;

			// if scrolling to first col, then scroll all the way
			let scrollEdge = false;
			let left = window.scrollX;
			let top = window.scrollY;
			if (col == 0) {
				left = 0;
				scrollEdge = true;
			}

			// if scrolling to last row, then scroll all the way
			if (row == this.numOfRows.value - 1) {
				top = document.body.scrollHeight;
				scrollEdge = true;
			}

			// if scrolling to first row, then scroll all the way
			if (row < 2) {
				top = 0;
				scrollEdge = true;
			}

			if (scrollEdge) {
				window.scrollTo({
					left: left,
					top: top
				});
			}

			this.prevRow = this.selRow;
			this.prevCol = this.selCol;

			visualManager.setVisual(this.selRow, this.selCol, this.numOfCols.value);

			this.setCellCurPos(0, this.getFormula(this.selRow, this.selCol));
		}
		catch(e) {
			console.log(e.message);
		}
		this.clearPlaceholder();
	}

	scrollToCenterSelCell() {
		let cell = this.getCell(this.selRow, this.selCol);

		cell.scrollIntoView({
			behavior: 'smooth',
			block: 'center',
			inline: 'center'
		});

	}

	// function to set the formula of the selected cell
	setFormula(move = true) {
		// set the formula from the formula bar to the selected cell
		this.rows[this.selRow][this.selCol] = document.getElementById("formulaBar").value;

		// update the value of the selected cell
		this.getCell(this.selRow, this.selCol).innerText = this.getValue(this.selRow, this.selCol);
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);

		//this.moveDown(1);
		if (move) {
			this.keyboardMotion(0, 1);
		}
	}

	setSpecFormula(value) {
		this.rows[this.selRow][this.selCol] = value;
		this.getCell(this.selRow, this.selCol).innerText = this.getValue(this.selRow, this.selCol);
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
	}

	updateEditFormula(form) {
		document.getElementById("formText").innerText = form;
	}

	// called when the user yanks something
	yank(cells) {
		this.copyBuffer = cells;
	}

	yankFormula() {
		let col = this.selCol;
		let row = this.selRow;
		let text = this.getFormula(row, col);
		navigator.clipboard.writeText(text);
		this.yank([[text]]);
	}

	yankValue() {
		let col = this.selCol;
		let row = this.selRow;
		let text = this.getValue(row, col);
		navigator.clipboard.writeText(text);
		this.yank([[text]]);
	}

	relativeYank(end) {
		const startRow = this.selRow;
		const endRow = this.selRow + end;

		this.yank(this.rows.slice(startRow, endRow));
	}

	paste(amount, horizontal = false) {
		for (let i = 0; i < amount; i++) {
			for (let y = 0; y < this.copyBuffer.length; y++) {
				for (let x = 0; x < this.copyBuffer[y].length; x++) {
					this.rows[this.selRow + y][this.selCol + x] = this.copyBuffer[y][x];
				}
			}
			this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
			//this.moveDown(1);
			if (!horizontal) {
				this.keyboardMotion(0, this.copyBuffer.length);
			}
			else {
				this.keyboardMotion(this.copyBuffer[0].length, 0);
			}
		}
	}

	pasteInGapRow(amount, dir) {
		if (dir == -1) this.keyboardMotion(0, -1);

		const startRow = this.selRow + 1;
		const startCol = this.selCol;

		const rowAmount = this.copyBuffer.length * amount;

		this.insertRowBelow(rowAmount);

		this.selectCell(startRow, startCol);
		this.paste(amount, false);
	}

	pasteInGapCol(amount, dir) {
		if (dir == -1) this.keyboardMotion(-1, 0);
		const startRow = this.selRow;
		const startCol = this.selCol + 1;

		const colAmount = this.copyBuffer[0].length * amount;

		this.insertColRight(colAmount);

		this.selectCell(startRow, startCol);

		this.paste(amount, true);
	}

	// function to get the element of a specific cell
	getCell(row, col) {
		return document.getElementById(col + ":" + row);
	}

	// returns the currently selected cell based on the className "focusssed"
	getSelectedCell() {
		return document.getElementsByClassName("focussed")[0];
	}

	cellMotion(amount, tempForm = "") {
		this.cellCurPos += amount;
		this.cellCurPos = math.max(0, this.cellCurPos);
		const cell = this.getFormula(this.selRow, this.selCol);
		this.cellCurPos = math.min(this.cellCurPos, tempForm.length);

		document.getElementById("formCursor").style.marginLeft = this.cellCurPos.toString() + "ch";
	}

	setCellCurPos(value, tempForm = "") {
		this.cellCurPos = value;
		this.cellMotion(0, tempForm);
	}

	// navigation functions
	keyboardMotion(x, y) {
		let newCol = this.selCol + x;
		let newRow = this.selRow + y;
		newCol = Number(Math.max(0, newCol));
		newCol = Number(Math.min(newCol, this.numOfCols.value - 1));

		newRow = Number(Math.max(0, newRow));
		newRow = Number(Math.min(newRow, this.numOfRows.value - 1));

		this.selectCell(newRow, newCol);
		this.updateRelRows();
	}

	// function to update the relative row numbers
	updateRelRows() {
		let labels = document.getElementsByClassName("relRow");
		for (let i = 1; i < labels.length; i++) {
			labels[i].innerText = Math.abs(this.selRow - i + 1);
		}
	}

	// functions for saving using strings, temporary before i work out backend
	saveSheetToClipboard() {
		let str = JSON.stringify(this.rows);
		navigator.clipboard.writeText(str);
		let commandLine = document.getElementById("commandLine");
	}

	loadFromClipboard() {
		let commandLine = document.getElementById("commandLine");
		//let str = navigator.clipboard.readText();
		let str = commandLine.value;

		if (str === "") {
			commandLine.placeholder = "Paste the JSON string here, then click 'Load from clipboard'";
			return;
		}
		let data = JSON.parse(str);
		this.rows = data;
		this.loadAllCells(data.length, data[0].length);
		commandLine.value = "";
		this.clearPlaceholder();
	}

	clearPlaceholder() {
		let commandLine = document.getElementById("commandLine");
		commandLine.placeholder = "";
	}

	setPlaceholder(str) {
		let commandLine = document.getElementById("commandLine");
		commandLine.placeholder = str;
	}

	loadAllCells(r, c) {
		const rows = this.rows.length;
		const cols = this.rows[0].length;
		for (let i = 0; i < rows; i++) {
			for (let j = 0; j < cols; j++) {
				try {
					this.getCell(i, j).innerText = this.getValue(i, j);
				}
				catch {
					console.log("cell not yet loaded");
				}
			}
		}

		// checks if new cells are being created, if they are, then it lets the styles be loaded once it is all mounted, otherwise it loads the styles right away.
		if (r == null) this.loadStyles();
		else if (r >= this.numOfRows.value && c >= this.numOfCols.value) {
			this.loadStyles();
		}

		this.clearPlaceholder();
	}

	removeColAtIndex(index) {
		for (let i = 0; i < this.rows.length; i++) {
			this.rows[i].splice(index, 1);
			this.styles[i].splice(index, 1);
		}

		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.selectCell(this.selRow, this.selCol);
	}

	deleteSelCol(amount) {
		for (let i = 0; i < amount; i++) {
			this.removeColAtIndex(this.selCol);
		}
	}

	removeRowAtIndex(index) {
		this.rows.splice(index, 1);
		this.styles.splice(index, 1);
		this.numOfRows.value--;
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.selectCell(this.selRow, this.selCol);
	}

	deleteSelRow(amount) {
		for (let i = 0; i < amount; i++) {	
			this.removeRowAtIndex(this.selRow);
		}
	}

	insertRowAtIndex(index, amount = 1) {
		const createRow = () => Array.from({ length: this.numOfCols.value }, () => "");
		const createStyleRow = () => Array.from({ length: this.numOfCols.value }, () => ({
			fg: this.defaultStyling.fg,
			bg: this.defaultStyling.bg
		}));

		const rowsToInsert = Array.from({ length: amount }, createRow);
		const stylesToInsert = Array.from({ length: amount }, createStyleRow);

		this.rows.splice(index, 0, ...rowsToInsert);
		this.styles.splice(index, 0, ...stylesToInsert);

		this.numOfRows.value += amount;
		this.selectCell(this.selRow, this.selCol);
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
	}

	insertColumnAtIndex(index) {
		for (let i = 0; i < this.numOfRows.value; i++) {
				this.rows[i].splice(index, 0, "");
				this.styles[i].splice(index, 0, {
					fg: this.defaultStyling.fg,
					bg: this.defaultStyling.bg
				});
		}
		this.numOfCols.value++;
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);

		this.selectCell(this.selRow, this.selCol);
	}

	insertRowBelow(amount = 1) {
		//for (let i = 0; i < amount; i++) {
			//this.insertRowAtIndex(this.selRow + 1);
			//this.keyboardMotion(0, 1);
		//}
		//
		this.insertRowAtIndex(this.selRow + 1, amount);
		this.keyboardMotion(0, 1);
	}

	insertRowAbove(amount = 1) {
		for (let i = 0; i < amount; i++) {
			this.insertRowAtIndex(this.selRow);
		}
		//this.moveUp(1);
	}

	insertColRight(amount) {
		for (let i = 0; i < amount; i++) {
			this.insertColumnAtIndex(this.selCol + 1);
		}
		this.keyboardMotion(amount, 0);
	}

	insertColLeft(amount) {
		for (let i = 0; i < amount; i++) {
			this.insertColumnAtIndex(this.selCol);
		}
		//this.moveLeft(1);
	}
}
