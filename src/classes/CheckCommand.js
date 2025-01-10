import SheetManager from '../classes/SheetManager.js';
const sheetManager = new SheetManager();
import ArrowMovement from './ArrowMovement.js';
const arrowMovement = new ArrowMovement();
import FileManager from '../classes/FileManager.js';
const fileManager = new FileManager();
export default class CheckCommand {
	constructor() {
		CheckCommand.instance = this;

	}

	setPhMessage(mg) {
		document.getElementById("commandLine").placeholder = mg;
	}

	// commands that do not need to have pressed enter to executre
	checkCommand() {
		this.setPhMessage("");
		let com = document.getElementById('commandLine').value;
		if (com == "") {
			return;
		}
		let formBar = document.getElementById('formulaBar');
		let cellPicker = document.getElementById("cellPicker");
		let clear = false;
		// non repeatable commands here
		// command to edit the formula
		if (com == "i") {
			formBar.focus();
			formBar.setSelectionRange(0,0);
			clear = true;
		}
		else if (com == "a") {
			formBar.focus();
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
			sheetManager.paste(amount);
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
			document.getElementById("commandLine").value = "";
		}
		else if (com == ":forceloadstyles") {
			sheetManager.loadStyles();
			document.getElementById("commandLine").value = "";
		}

		// save file as with command :wa
		else if (com == ":wa") {
			fileManager.saveFile(true);
			document.getElementById("commandLine").value = "";
		}

		// open file with command :o
		else if (com == ":o") {
			fileManager.openFile();
			document.getElementById("commandLine").value = "";
		}
		else if (com == ":clear") {
			sheetManager.clearScreen();
			document.getElementById("commandLine").value = "";
		}
		else if (com.startsWith(":hi")) {
			console.log("styling");
			const row = sheetManager.selRow;
			const col = sheetManager.selCol;
			sheetManager.setStyles(com, row, col);
			document.getElementById("commandLine").value = "";
		}
		else if (com == ":resetallstyles") {
			sheetManager.resetAllStyles();
			document.getElementById("commandLine").value = "";
		}
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
