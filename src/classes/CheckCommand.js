import SheetManager from '../classes/SheetManager.js';
const sheetManager = new SheetManager();
import ArrowMovement from './ArrowMovement.js';
const arrowMovement = new ArrowMovement();
import FileManager from '../classes/FileManager.js';
const fileManager = new FileManager();
import VisualManager from './VisualManager.js';
const visualManager = new VisualManager();
export default class CheckCommand {
	constructor() {
		this.mode = "n";
		this.selStartRow = null;
		this.selStartCol = null;
		CheckCommand.instance = this;
	}

	setPhMessage(mg) {
		document.getElementById("commandLine").placeholder = mg;
	}

	// commands that do not need to have pressed enter to executre
	checkCommand() {
		this.setPhMessage("");
		// templog
		console.log(this.mode);
		let com = document.getElementById('commandLine').value;
		if (com == "") {
			return;
		}
		let formBar = document.getElementById('formulaBar');
		let cellPicker = document.getElementById("cellPicker");
		let clear = false;
		// non repeatable commands here
		// command to edit at the beginning the formula
		if (com == "i") {
			formBar.focus();
			formBar.setSelectionRange(0,0);
			clear = true;
		}
		// edit at the end of the formula
		else if (com == "a") {
			formBar.focus();
			const end = formBar.value.length;
			formBar.setSelectionRange(end, end);
			clear = true;
		}
		else if (com == "v") {
			this.mode = "v";
			this.selStartRow = sheetManager.selRow;
			this.selStartCol = sheetManager.selCol;
			visualManager.startVisual(sheetManager.selRow, sheetManager.selCol);
			clear = true;
		}
		// command to edit the formula of the first cell in the selected row
		else if (com == "I") {
			sheetManager.selectCell(sheetManager.selRow, 0);
			formBar.focus();
			clear = true;
		}
		// command to select the first cell in the selected row
		else if (com == "^") {
			sheetManager.selectCell(sheetManager.selRow, 0);
			clear = true;
		}
		// command to select last cell in a row
		else if (com == "$") {
			sheetManager.selectCell(sheetManager.selRow, sheetManager.numOfCols.value - 1);
			clear = true;
		}
		// command to replace the formula
		else if (com == "c") {
			formBar.value = "";
			formBar.focus();
			sheetManager.setFormula(false);
			clear = true;
		}
		// command to change the selected cell
		else if (com == ";") {
			cellPicker.focus();
			cellPicker.value = "";
			clear = true;
		}
		else if (com == "zz") {
			sheetManager.scrollToCenterSelCell();
			clear = true;
		}
		// insert row below
		else if (com == "oj") {
			sheetManager.insertRowBelow();
			clear = true;
		}
		// insert row above
		else if (com == "ok") {
			sheetManager.insertRowAbove();
			clear = true;
		}
		else if (com == "oh") {
			sheetManager.insertColLeft();
			clear = true;
		}
		else if (com == "ol") {
			sheetManager.insertColRight();
			clear = true;
		}
		else if (com == "yf" && this.mode == "v") {
			// templog
			console.log("visual selection");
			let col = sheetManager.selCol;
			let row = sheetManager.selRow;
			let text = sheetManager.getFormula(row, col);
			navigator.clipboard.writeText(text);

			visualManager.yankSelection(sheetManager);
			// templog
			console.log(sheetManager.copyBuffer);

			clear = true;
			this.handleEsc();
		}
		// yank formula
		else if (com == "yf") {
			let col = sheetManager.selCol;
			let row = sheetManager.selRow;
			let text = sheetManager.getFormula(row, col);
			navigator.clipboard.writeText(text);
			sheetManager.yank([[text]]);
			clear = true;
		}
		// yank value
		else if (com == "ys") {
			let col = sheetManager.selCol;
			let row = sheetManager.selRow;
			let text = sheetManager.getValue(row, col);
			navigator.clipboard.writeText(text);
			sheetManager.yank([[text]]);
			clear = true;
		}
		// yank a row
		else if (com == "yy") {
			const row = sheetManager.selRow;
			let buffer = sheetManager.rows[row];
			let endIndex = buffer.lastIndexOf("");
			buffer = endIndex === -1 ? buffer : buffer.slice(0, endIndex + 1);

			sheetManager.yank([buffer]);
		}
		else if (com == "gg") {
			let col = sheetManager.selCol;
			sheetManager.selectCell(0, col);
			clear = true;
		}
		else if (com == "G") {
			let col = sheetManager.selCol;
			let row = sheetManager.numOfRows.value - 1;
			sheetManager.selectCell(row, col);
			clear = true;
		}

		// repeated commands here
		// getting the amount
		let amount = this.parseCommand(com).amount;
		let command = this.parseCommand(com).command;
			
		//if (parseInt(com.substring(0, com.length - 2)) != "NaN") {
		// movements
		if (command == "h") {
			sheetManager.keyboardMotion(-amount, 0);
			clear = true;
		}
		else if (command == "j") {
			sheetManager.keyboardMotion(0, amount);
			clear = true;
		}
		else if (command == "k") {
			sheetManager.keyboardMotion(0, -amount);
			clear = true;
		}
		else if (command == "l") {
			sheetManager.keyboardMotion(amount, 0);
			clear = true;
		}
		else if (command == "p") {
			sheetManager.paste(amount, false);
			clear = true;
		}
		else if (command == "Pj") {
			sheetManager.pasteInGapRow(amount, 1);
			clear = true;
		}
		else if (command == "Pk") {
			sheetManager.pasteInGapRow(amount, -1);
			clear = true;
		}
		else if (command == "Pl") {
			sheetManager.pasteInGapCol(amount, 1);
			clear = true;
		}
		else if (command == "Ph") {
			sheetManager.pasteInGapCol(amount, -1);
			clear = true;
		}
		// command to delete a row
		else if (command == "dd") {
			sheetManager.deleteSelRow(amount);
			clear = true;
		}
		// command to delete a column
		else if (command == "dc") {
			sheetManager.deleteSelCol(amount);
			clear = true;
		}
		if (clear) {
			document.getElementById("commandLine").value = "";
		}
	}

	handleEnter() {
		let com = document.getElementById('commandLine').value;
		// save file with command :w
		if (com == ":w") {
			fileManager.saveFile();
		}
		else if (com == ":forceloadstyles") {
			sheetManager.loadStyles();
		}

		// save file as with command :wa
		else if (com == ":wa") {
			fileManager.saveFile(true);
		}

		// open file with command :o
		else if (com == ":o") {
			fileManager.openFile();
		}
		else if (com == ":clear") {
			sheetManager.clearScreen();
		}
		else if (com.startsWith(":hi")) {
			const row = sheetManager.selRow;
			const col = sheetManager.selCol;
			sheetManager.setStyles(com, row, col);
		}
		else if (com == ":resetallstyles") {
			sheetManager.resetAllStyles();
		}
		document.getElementById("commandLine").value = "";
	}

	handleEsc() {
		visualManager.exitVisual();
		this.mode = "n";
		document.getElementById("commandLine").value = "";
	}

	parseCommand(com) {
		const match = com.match(/^(\d+)?(.+)$/);

		if (!match) {
			return null;
		}

		const [_, amount, command] = match;

		return {
			amount: amount ? parseInt(amount, 10) : 1,
			command: command
		};
	}
}
