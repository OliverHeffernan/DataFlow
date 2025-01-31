<template>
	<div id="statusBar" @click="handleClick()">
		<div id="modeDisplay">-- NORMAL --</div>
		<input id="commandLine" placeholder="command line here" spellcheck="false" type="text" @input="checkCommand.checkCommand()" @keyup.enter="checkCommand.handleEnter()" @keyup.esc="checkCommand.handleEsc()" />
	</div>
	<div id="webFileUpload">
		<input id="fileInput" type="file" />
		<button id="readFileBtn" @click="openFileWeb()">Read File</button>
		<button id="cancelButton" @click="closeWebFilePick()">Cancel</button>
	</div>
</template>
<script setup>
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();

	import CheckCommand from '../classes/CheckCommand.js';
	const checkCommand = new CheckCommand();

	import { save, open } from '@tauri-apps/plugin-dialog';
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { invoke } from '@tauri-apps/api/core';

	function closeWebFilePick() {
		document.getElementById("webFileUpload").style.display = "none";
	}

	function setPhMessage(mg) {
		document.getElementById("commandLine").placeholder = mg;
	}

	function openFileWeb() {
		const fileInput = document.getElementById('fileInput');
		const file = fileInput.files[0];

		console.log("web view");

		const reader = new FileReader();

		reader.onload = function(e) {
			console.log(e.target.result);
			sheetManager.rows = JSON.parse(e.target.result);
			sheetManager.numOfRows.value = sheetManager.rows.length;
			sheetManager.numOfCols.value = sheetManager.rows[0].length;
			sheetManager.loadAllCells();
		}

		reader.readAsText(file);


		document.getElementById("webFileUpload").style.display = "none";
	}
	function handleClick() {
		document.getElementById("commandLine").focus();
	}
</script>
<style>
#commandLine {
	/*position: fixed;*/
	/*width: 100%;*/
	/*bottom: 0;*/
	width: calc(100% - 70px);
	color: white;
	background-color: #15202E;
	border: none;
	outline: none;
	z-index: 60;
	/*box-shadow: rgba(0,0,0,0.5) 0px 0px 5px 0px;*/
	text-shadow: 0 0 0 white;
	margin-left: 10px;

	/*width: calc(100%-100px);*/
}

#modeDisplay {
	font-size: 11px;
	width: 70px;
}

#statusBar {
	position: fixed;
	display: flex;
	width: 100%;
	bottom: 0;
	color: white;
	background-color: #15202E;
	border: none;
	outline: none;
	z-index: 50;
	box-shadow: rgba(0,0,0,0.5) 0px 0px 5px 0px;
	text-shadow: 0 0 0 white;
}

#webFileUpload {
	display: none;
	position: fixed;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);

	background-color: #15202E;
	border-radius: 20px;
	padding: 20px;
	box-shadow: black 0px 0px 50px;
}

#fileInput {
	color: white;
}

#cancelButton {
	margin-left: 5px;
}

</style>
