<template>
	<div id="topBar">
		<input id="cellPicker" @input="selectCell" @keyup.esc="handleEscape" @keyup.enter="focusFormulaBar" type="text" placeholder="e.g. A0" />
		<NewFormBar />
		<!--<input id="formulaBar" type="text" placeholder="edit cell formulae" @keyup.enter="handleEnter" @keyup.esc="handleEscape" />-->
	</div>
</template>
<script setup>
import NewFormBar from "./NewFormBar.vue";
import SheetManager from '../classes/SheetManager.js';
const sheetManager = new SheetManager();

import CheckCommand from "../classes/CheckCommand.js";
const checkCommand = new CheckCommand();
function handleEnter() {
	sheetManager.setFormula();
	checkCommand.changeMode("n");
	document.getElementById("commandLine").focus();
}

function handleEscape() {
	checkCommand.changeMode("n");
	document.getElementById("commandLine").focus();
}

function selectCell() {
	let coords = document.getElementById("cellPicker").value;
	let col = coords.charCodeAt(0) - 65;
	let row = parseInt(coords.slice(1));
	const pattern = /^[A-Z]\d+$/
	if (pattern.test(coords)) {
		sheetManager.selectCell(row, col);
	}
}

function focusFormulaBar() {
	document.getElementById("formulaBar").focus();
}

</script>
<style scoped>
#topBar {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	font-size: 15px;
	background-color: #15202E;
	border: 1px solid #15202E;
	outline: none;
	color: white;
	display: flex;
	z-index: 40;
	box-shadow: rgba(0,0,0,0.5) 0px 0px 5px 0px;
}

#cellPicker {
	background-color: #15202E;
	border: none;
	outline: none;
	height: 20px;
	width: 80px;
	color: white;
	text-align: left;
	font-size: 15px;
	margin: 0;
	white-space: nowrap;
	border-right: 1px solid white;
}

#formulaBar {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	background-color: #15202E;
	border: none;
	outline: none;
	height: 20px;
	width: calc(100% - 80px);
	color: white;
	text-align: left;
	font-size: 15px;
	margin: 0;
	white-space: nowrap;
}

</style>
