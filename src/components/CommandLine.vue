<template>
	<input id="commandLine" spellcheck="false" type="text" @input="checkCommand" />
</template>
<script setup>
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();
	function checkCommand() {
		let com = document.getElementById('commandLine').value;
		let formBar = document.getElementById('formulaBar');
		let cellPicker = document.getElementById("cellPicker");
		let clear = false;
		// command to edit the formula
		if (com == "i") {
			formBar.focus();
			clear = true;
		}
		// command to edit the formula of the first cell in the selected row
		else if (com == "I") {
			sheetManager.selectCell(sheetManager.selRow, 0);
			formBar.focus();
		}
		// command to replace the formula
		else if (com == "c") {
			formBar.value = "";
			sheetManager.setFormula();
			clear = true;
		}
		else if (com == ";") {
			cellPicker.focus();
			cellPicker.value = "";
			clear = true;
		}
		else if (com == "zz") {
			console.log("zz");
			sheetManager.scrollToCenterSelCell();
			clear = true;
		}

		// repeated commands
		if (com.length == 1) {
			com = "1" + com;
		}
		if (parseInt(com.substring(0, com.length - 2)) != "NaN") {
			// movements
			let amount = parseInt(com.substring(0, com.length - 1));
			if (com[com.length - 1] == "h") {
				sheetManager.moveLeft(amount);
				clear = true;
			}
			else if (com[com.length - 1] == "j") {
				sheetManager.moveDown(amount);
				clear = true;
			}
			else if (com[com.length - 1] == "k") {
				sheetManager.moveUp(amount);
				clear = true;
			}
			else if (com[com.length - 1] == "l") {
				sheetManager.moveRight(amount);
				clear = true;
			}
		}
		if (clear) {
			document.getElementById("commandLine").value = "";
		}
	}
</script>
<style>
#commandLine {
	position: fixed;
	width: 100%;
	bottom: 0;
	color: white;
	background-color: #15202E;
	border: none;
	outline: none;
	z-index: 10;
	box-shadow: rgba(0,0,0,0.5) 0px 0px 5px 0px;
}
</style>
