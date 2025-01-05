<template>
	<input id="commandLine" spellcheck="false" type="text" @input="checkCommand" @keyup.enter="handleEnter" />
</template>
<script setup>
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();

	import { save, open } from '@tauri-apps/plugin-dialog';
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { invoke } from '@tauri-apps/api/core';

	async function saveFile(saveAs = false) {
		let path;
		if (sheetManager.path == null || saveAs) {
			path = await save
			(
				{
					filters:
					[
						{
						  name: 'My Filter',
						  extensions: ['.heff'],
						},
					]
				}
			);
			sheetManager.path = path;
		}
		else {
			path = sheetManager.path;
		}

		console.log(path);

		let content = JSON.stringify(sheetManager.rows);
		await invoke('write_file', { path: path, content: content });
	}

	async function openFile() {
		const path = await open
		(
			{
				filters:
				[
					{
					  name: 'My Filter',
					  extensions: ['.heff'],
					},
				]
			}
		);

		const file = await readTextFile(path);

		console.log(file);
		if (path.split('.').pop() == "heff") {
			sheetManager.rows = JSON.parse(file);
			sheetManager.numOfRows.value = sheetManager.rows.length;
			sheetManager.numOfCols.value = sheetManager.rows[0].length;
			sheetManager.loadAllCells();

			sheetManager.path = path;
		}
		else {
			console.log("Invalid file type");
		}
		//await file.close();
		//const file = await open(path)
	}

	function handleEnter() {
		let com = document.getElementById('commandLine').value;
		// save file with command :w
		if (com == ":w") {
			saveFile();
			document.getElementById("commandLine").value = "";
		}

		// save file as with command :wa
		else if (com == ":wa") {
			saveFile(true);
			document.getElementById("commandLine").value = "";
		}

		// open file with command :o
		else if (com == ":o") {
			openFile();
			document.getElementById("commandLine").value = "";
		}
	}

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
			sheetManager.setFormula();
			clear = true;
		}
		// command to change the selected cell
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

		// repeated commands
		/*
		if (com.length == 1) {
			com = "1" + com;
		}
		*/
		// getting the amount
		let amount = parseCommand(com).amount;
		let command = parseCommand(com).command;
			
		//if (parseInt(com.substring(0, com.length - 2)) != "NaN") {
		// movements
		//let amount = parseInt(com.substring(0, com.length - 1));
		if (command == "h") {
			sheetManager.moveLeft(amount);
			clear = true;
		}
		else if (command == "j") {
			console.log(amount);
			sheetManager.moveDown(amount);
			clear = true;
		}
		else if (command == "k") {
			sheetManager.moveUp(amount);
			clear = true;
		}
		else if (command == "l") {
			sheetManager.moveRight(amount);
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

	function parseCommand(com) {
		const match = com.match(/^(\d+)?(.+)$/);

		if (!match) {
			return nulll;
		}

		const [_, amount, command] = match;

		return {
			amount: amount ? parseInt(amount, 10) : 1,
			command: command
		};
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
