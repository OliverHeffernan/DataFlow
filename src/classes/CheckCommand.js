import SheetManager from "./SheetManager.js";
const sheetManager = new SheetManager();
import ArrowMovement from "./ArrowMovement.js";
const arrowMovement = new ArrowMovement();
import FileManager from "../classes/FileManager.js";
const fileManager = new FileManager();
import VisualManager from "./VisualManager.js";
const visualManager = new VisualManager();

import MacroManager from "./MacroManager.js";
const macroManager = new MacroManager();

import LaunchManager from "./LaunchManager.js";
const launchManager = new LaunchManager();


import Commands from "./Commands.js";
const commands = new Commands();
export default class CheckCommand {
	constructor() {
		if (CheckCommand.instance) {
			return CheckCommand.instance;
		}
		this.mode = "n";
		this.selStartRow = null;
		this.selStartCol = null;
		this.cDown = false;
		CheckCommand.instance = this;
	}

	changeMode(mode) {
		commands.changeMode(mode);
		this.mode = mode;
	}

	setPhMessage(mg) {
		document.getElementById("commandLine").placeholder = mg;
	}

	checkCommandDirect() {
		let com = document.getElementById("commandLine").value;
		if (com == "") {
			return;
		}
		this.checkCommand(com);
	}

	handleBackspace() {
		console.log("backspace");
		const com = document.getElementById("commandLine").value;
		if (com == "" && this.mode == "i") {
			commands.backspace();
		}
	}

	handleDelete() {
		console.log("delete");
		const com = document.getElementById("commandLine").value;
		if (com == "" && this.mode == "i") {
			commands.deleteKey();
		}
	}

	// commands that do not need to have pressed enter to executre
	checkCommand(com) {
		if (commands.mode == "i") {
			commands.insertText(com);
			macroManager.addToRecording(com, "i");
			this.clearCom(com, false);
			return;
		}
		// hide the right click menu if typing a command
		if (document.getElementsByClassName("rcActive").length != 0) {
			document.getElementsByClassName("rcActive")[0].className =
				"cellRightClick rcInactive";
		}

		this.setPhMessage("");
		let formBar = document.getElementById("formulaBar");
		let cellPicker = document.getElementById("cellPicker");
		let clear = false;
		// non repeatable commands here
		if (com == "i") {
			this.changeMode("i");
			commands.insert();
			this.clearCom(com);
		} else if (com == "a") {
			this.changeMode("i");
			sheetManager.cellMotion(1);
			commands.insert();
			this.clearCom(com);
		} else if (com == "v") {
			commands.startVisual();
		} else if (com == "V") {
			commands.startVisualLine();
		} else if (com == "q" && macroManager.recordingTo !== null) {
			macroManager.endRecording();
			this.clearCom();
		} else if (com.length == 2 && com[0] == "q") {
			macroManager.startRecording(com[1]);
			this.clearCom(com, false);
		}
		// command to edit the formula of the first cell in the selected row
		else if (com == "I") {
			commands.startOfCell();
			this.changeMode("i");
			commands.insert();
		} else if (com == "A") {
			commands.endOfCell();
			this.changeMode("i");
			commands.insert();
		}
		// command to select the first cell in the selected row
		else if (com == "gh") {
			commands.selectFirstColumn();
		}
		// command to select last cell in a row
		else if (com == "gl") {
			commands.selectLastColumn();
		} else if (com == "^") {
			commands.startOfCell();
		} else if (com == "$") {
			commands.endOfCell();
		}
		// command to replace the formula
		else if (com == "C" && this.mode == "n") {
			commands.replaceFormula();
		} else if ((com == "c" || com == "d") && this.mode == "v") {
			commands.clearSelection();
			this.handleEsc();
		} else if (com == "d" && this.mode == "V") {
			commands.deleteSelectedRows();
			this.handleEsc();
		}
		// command to change the selected cell
		else if (com == "zz") {
			commands.viewportCenterCell();
		} else if (com == "yf" && (this.mode == "v" || this.mode == "V")) {
			commands.yankSelectionFormulae();
		} else if (com == "ys" && (this.mode == "v" || this.mode == "V")) {
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
		} else if (com == "gg") {
			commands.selectRowZero();
		} else if (com[0] == "g" && Number(com.substring(1, com.length))) {
			let row = Number(com.substring(1, com.length));
			commands.selectRow(row);
		} else if (com == "G") {
			commands.selectLastRow();
		}

		// repeated commands here
		// getting the amount
		let amount = this.parseCommand(com).amount;
		let command = this.parseCommand(com).command;

		let macro = "";

		if (command[0] == "@" && command.length == 2) {
			console.log("macro");
			macro = command[1];
			command = "@";
			macroManager.playMacro(macro, amount);
			return;
		}
		//if (parseInt(com.substring(0, com.length - 2)) != "NaN") {
		// movements
		switch (command) {
			case "h":
				sheetManager.keyboardMotion(-amount, 0);
				this.clearCom(com);
				break;
			case "j":
				sheetManager.keyboardMotion(0, amount);
				this.clearCom(com);
				break;
			case "k":
				sheetManager.keyboardMotion(0, -amount);
				this.clearCom(com);
				break;
			case "l":
				sheetManager.keyboardMotion(amount, 0);
				this.clearCom(com);
				break;
			case "oh":
				sheetManager.insertColLeft(amount);
				this.clearCom(com);
				break;
			case "oj":
				sheetManager.insertRowBelow(amount);
				this.clearCom(com);
				break;
			case "ok":
				sheetManager.insertRowAbove(amount);
				this.clearCom(com);
				break;
			case "ol":
				sheetManager.insertColRight(amount);
				this.clearCom(com);
				break;
			case "H":
				sheetManager.cellMotion(-amount, commands.tempForm);
				this.clearCom(com);
				break;
			case "L":
				sheetManager.cellMotion(amount, commands.tempForm);
				this.clearCom(com);
				break;
			case "p":
				sheetManager.paste(amount, false);
				this.clearCom(com);
				break;
			case "Pj":
				sheetManager.pasteInGapRow(amount, 1);
				this.clearCom(com);
				break;
			case "Pk":
				sheetManager.pasteInGapRow(amount, -1);
				this.clearCom(com);
				break;
			case "Pl":
				sheetManager.pasteInGapCol(amount, 1);
				this.clearCom(com);
				break;
			case "Ph":
				sheetManager.pasteInGapCol(amount, -1);
				this.clearCom(com);
				break;
			case "dd":
				sheetManager.relativeYank(amount);
				sheetManager.deleteSelRow(amount);
				this.clearCom(com);
				break;
			case "dc":
				sheetManager.deleteSelCol(amount);
				this.clearCom(com);
				break;
			case "W":
				commands.jumpWhiteSpace(amount);
				this.clearCom(com);
				break;
			case "B":
				commands.jumpBackWhiteSpace(amount);
				this.clearCom(com);
				break;
			case "w":
				commands.jumpWord(amount);
				this.clearCom(com);
				break;
			case "b":
				commands.jumpBackWord(amount);
				this.clearCom(com);
				break;
			case "e":
				commands.jumpEndWord(amount);
				this.clearCom(com);
				break;
			case "%":
				commands.matchPairMotion();
				this.clearCom(com);
				break;
			default:
				if (command[0] == "f" && command.length > 1) {
					console.log("kia ora");
					commands.findCharacter(command[1]);
					this.clearCom(com);
				}
				break;
		}
		if (clear) {
			document.getElementById("commandLine").value = "";
		}
	}

	handleEnter() {
		macroManager.addToRecording("<CR>", "key");
		if (commands.mode == "i") {
			commands.setFormula();
			this.changeMode("n");
			return;
		}

		let com = document.getElementById("commandLine").value;
		this.changeMode("n");
		// save file with command :w
		if (com == ":w") {
			fileManager.saveFile();
		} else if (com == ":forceloadstyles") {
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
		} else if (com == ":clear") {
			sheetManager.clearScreen();

			launchManager.hide();
		} else if (com.startsWith(":hi")) {
			const row = sheetManager.selRow;
			const col = sheetManager.selCol;
			sheetManager.setStyles(com, row, col);
		} else if (com == ":resetallstyles") {
			sheetManager.resetAllStyles();
		}
		document.getElementById("commandLine").value = "";

		// when entering long string into the table, it puts the whole table out of whack
		// for some reason doing this fixes it ??????
		sheetManager.cellMotion(-1);
		window.requestAnimationFrame(() => {
			sheetManager.cellMotion(1);
		});
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
			command: command,
		};
	}

	clearCom(com, record = true) {
		document.getElementById("commandLine").value = "";
		if (record) {
			macroManager.addToRecording(com, "n");
		}
	}
}
