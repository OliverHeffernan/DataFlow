import CheckCommand from "./CheckCommand.js";
import Commands from "./Commands.js";
export default class MacroManager {
	constructor() {
		if (MacroManager.instance) {
			return MacroManager.instance;
		}

		this.macros = new Map();
		this.mode = "n";

		this.recordingMacro = [];
		this.recordingTo = null;
	}
	

	startRecording(char) {
		this.recordingTo = char;
		const checkCommand = new CheckCommand();
		checkCommand.setPhMessage(`macro recording @${this.recordingTo}`);

		this.macros.set(char, []);
	}

	addToRecording(com, mode) {
		if (this.recordingTo === null) return;
		try {
			if (this.recordingMacro.length > 0) {
				if (this.recordingMacro[this.recordingMacro.length - 1].mode == "i" && mode == "i") {
					this.recordingMacro[this.recordingMacro.length - 1].com += com;
					this.macros.set(this.recordingTo, this.recordingMacro);
					return;
				}
			} 
			this.recordingMacro.push({
				"com": com,
				"mode": mode
			});
			this.macros.set(this.recordingTo, this.recordingMacro);
		} catch(e) {
			console.log(e.message);
		}
	}

	endRecording() {
		const checkCommand = new CheckCommand();
		checkCommand.setPhMessage(`macro recorded @${this.recordingTo}`);
		this.recordingTo = null;
		this.recordingMacro = [];
	}

	playMacro(char, amount) {
		// get a shallow copy of the array, so that shifting from it doesn't clear it in the map
		let macro = [...(this.macros.get(char) || [])];

		macro = Array(amount).fill(macro).flat();

		const checkCommand = new CheckCommand();

		this.throughMacro(macro, checkCommand);
	}

	throughMacro(macro, checkCommand) {
		try {
			if (macro.length == 0) return;

			const action = macro.shift()
			const commands = new Commands();
			if (action.mode == "n") {
				checkCommand.checkCommand(action.com);
			} else if (action.mode == "i") {
				commands.insertText(action.com);
			} else if (action.mode == "key") {
				if (action.com == "<ESC>") {
					commands.handleEsc();
				} else if (action.com == "<CR>") {
					checkCommand.handleEnter();
				} else if (action.com == "<DEL>") {
					commands.deleteKey();
				} else if (action.com == "<B-SPACE>") {
					commands.backspace();
				}
			}


			window.requestAnimationFrame(() => {
				this.throughMacro(macro, checkCommand)
			});
		} catch (e) {
			console.log(e.message);
		}
	}

}

