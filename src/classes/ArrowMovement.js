import SheetManager from './SheetManager.js';
export default class ArrowMovement {
	constructor() {
		ArrowMovement.instance = this;
		document.onkeydown = this.movement;
	}

	movement(key) {
		const sheetManager = new SheetManager();
		key = key || window.event;
		const isFocusedInput = document.activeElement.tagName === 'INPUT';
		const typingCommand = document.activeElement.value.length > 0;

		// preventing it from scrolling with key presses, also preventing it from moving when the user tries to use the arrow keys to move to a different part of a command
		if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(key.code) && !typingCommand) {
			key.preventDefault();
			switch (key.code) {
				case "ArrowLeft":
					sheetManager.keyboardMotion(-1, 0);
					break;
				case "ArrowRight":
					sheetManager.keyboardMotion(1, 0);
					break;
				case "ArrowUp":
					sheetManager.keyboardMotion(0, -1);
					break;
				case "ArrowDown":
					sheetManager.keyboardMotion(0, 1);
					break;
			}
		}
		//console.log(key.code);
	}
}
