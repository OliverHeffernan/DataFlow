import SheetManager from '../classes/SheetManager.js';
const sheetManager = new SheetManager();
import ArrowMovement from './ArrowMovement.js';
const arrowMovement = new ArrowMovement();
import FileManager from '../classes/FileManager.js';
const fileManager = new FileManager();
import VisualManager from './VisualManager.js';
const visualManager = new VisualManager();

import LaunchManager from './LaunchManager.js';
const launchManager = new LaunchManager();

import Commands from './Commands.js';
const commands = new Commands();
export default class CheckCommand {
	constructor() {
		if (CheckCommand.instance) {
			return CheckCommand.instance;
		}
		this.mode = "n";
		this.selStartRow = null;
		this.selStartCol = null;
		CheckCommand.instance = this;
	}

	changeMode(mode) {
		commands.changeMode(mode);
	}

	setPhMessage(mg) {
		document.getElementById("commandLine").placeholder = mg;
	}

	// commands that do not need to have pressed enter to executre
	checkCommand() {
		// hide the right click menu if typing a command
		if (document.getElementsByClassName("rcActive").length != 0) {
			document.getElementsByClassName("rcActive")[0].className = "cellRightClick rcInactive";
		}
		
		this.setPhMessage("");
		// templog
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
			commands.insert();

		}
		// edit at the end of the formula
		else if (com == "a") {
			commands.append();
		}
		else if (com == "v") {
			commands.startVisual();
		}
		else if (com == "V") {
			commands.startVisualLine();
		}
		// command to edit the formula of the first cell in the selected row
		else if (com == "I") {
			commands.insertAtFirstColumn();
		}
		// command to select the first cell in the selected row
		else if (com == "^" || com == "gh") {
			commands.selectFirstColumn();
		}
		// command to select last cell in a row
		else if (com == "$" || com == "gl") {
			commands.selectLastColumn();
		}
		// command to replace the formula
		else if (com == "c" && this.mode == "n") {
			commands.replaceFormula();
		}
		else if ((com == "c" || com == "d") && this.mode == "v") {
			commands.clearSelection();
			this.handleEsc();
		}
		else if (com == "d" && this.mode == "V") {
			commands.deleteSelectedRows();
			this.handleEsc();
		}
		// command to change the selected cell
		else if (com == ";") {
			commands.focusCellPicker();
		}
		else if (com == "zz") {
			commands.viewportCenterCell();
		}
		else if (com == "oj") {
			commands.insertRowBelow();
		}
		else if (com == "ok") {
			commands.insertRowAbove();
		}
		else if (com == "oh") {
			commands.insertColLeft();
		}
		else if (com == "ol") {
			commands.insertColRight();
		}
		else if (com == "yf" && (this.mode == "v" || this.mode == "V")) {
			commands.yankSelectionFormulae();
		}
		else if (com == "ys" && (this.mode == "v" || this.mode == "V")) {
			commands.yankSelectionValues();
		}
		// yank formula
		else if (com == "yf") {
			commands.yankFormula();
		}
		// yank value
		else if (com == "ys") {
			commands.yankValue();
		}
		// yank a row
		else if (com == "yy") {
			commands.yankRowFormulae();
		}
		else if (com == "gg") {
			commands.selectRowZero();
		}
		else if (com[0] == "g" && Number(com.substring(1, com.length))) {
			let row = Number(com.substring(1, com.length));
			commands.selectRow(row);
		}
		else if (com == "G") {
			commands.selectLastRow();
		}

		// repeated commands here
		// getting the amount
		let amount = this.parseCommand(com).amount;
		let command = this.parseCommand(com).command;
			
		//if (parseInt(com.substring(0, com.length - 2)) != "NaN") {
		// movements
		switch (command) {
			case "h":
				sheetManager.keyboardMotion(-amount, 0);
				clear = true;
				break;
			case "j":
				sheetManager.keyboardMotion(0, amount);
				clear = true;
				break;
			case "k":
				sheetManager.keyboardMotion(0, -amount);
				clear = true;
				break;
			case "l":
				sheetManager.keyboardMotion(amount, 0);
				clear = true;
				break;
			case "p":
				sheetManager.paste(amount, false);
				clear = true;
				break;
			case "Pj":
				sheetManager.pasteInGapRow(amount, 1);
				clear = true;
				break;
			case "Pk":
				sheetManager.pasteInGapRow(amount, -1);
				clear = true;
				break;
			case "Pl":
				sheetManager.pasteInGapCol(amount, 1);
				clear = true;
				break;
			case "Ph":
				sheetManager.pasteInGapCol(amount, -1);
				clear = true;
				break;
			case "dd":
				sheetManager.relativeYank(amount);
				sheetManager.deleteSelRow(amount);
				clear = true;
				break;
			case "dc":
				sheetManager.deleteSelCol(amount);
				clear = true;
				break;
		}
		if (clear) {
			document.getElementById("commandLine").value = "";
		}
	}
	
	handleEnter() {
		let com = document.getElementById('commandLine').value;
		this.changeMode("n");
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
			launchManager.hide();
		}
		else if (com == ":clear") {

			sheetManager.clearScreen();

			launchManager.hide();
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
		commands.handleEsc();
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
