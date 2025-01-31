<template>
	<div id="rightClickMenu" class="rcInactive">
		<ul id="rcn">
			<li @click="deleteRow()" class="delete">Delete Row <span class="com">dd</span></li>
			<li @click="deleteColumn()" class="delete">Delete Column<span class="com">dc</span></li>
			<li>--</li>
			<li @click="rowAbove()">Insert Row Above<span class="com">ok</span></li>
			<li @click="rowBelow()">Insert Row Below<span class="com">oj</span></li>
			<li @click="colLeft()">Insert Column Left<span class="com">oh</span></li>
			<li @click="colRight()">Insert Column Right<span class="com">ol</span></li>
			<li>--</li>
			<li @click="copyFormula()">Copy Cell Formula<span class="com">yf</span></li>
			<li @click="copyValue()">Copy Cell Value<span class="com">ys</span></li>
			<li>--</li>
			<li @click="paste()">Paste<span class="com">p</span></li>
			<li @click="pasteAbove()">Paste Above<span class="com">Pk</span></li>
			<li @click="pasteBelow()">Paste Below<span class="com">Pj</span></li>
			<li @click="pasteLeft()">Paste Left<span class="com">Ph</span></li>
			<li @click="pasteRight()">Paste Right<span class="com">Pl</span></li>
			<li @click="openHelp()">Help ...</li>
		</ul>
		<ul id="rcv">
			<li @click="copySelection()">Copy Selection Formulae <span class="com">yf</span></li>
			<li @click="copySelectionValue()">Copy Selection Value <span class="com">ys</span></li>
		</ul>
		<ul id="rcV">
			<li @click="deleteRows()">Delete Rows <span class="com">d</span></li>
		</ul>
	</div>
</template>
<script setup>
	import { open } from '@tauri-apps/plugin-shell';
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();

	import VisualManager from '../classes/VisualManager.js';
	const visualManager = new VisualManager();

	import CheckCommand from '../classes/CheckCommand.js';
	const checkCommand = new CheckCommand();

	function hideDialog() {
		document.getElementById("rightClickMenu").className = "rcInactive";
	}

	function openHelp() {
		open("https://oliverheffernan.github.io/DataFlow/documentationPage/");
	}

	// rcV functions, some crossover between rcV and rcv
	function deleteRows() {
		const startRow = visualManager.startRow;
		const endRow = sheetManager.selRow;
		const selCol = sheetManager.selCol;

		const sr = Math.min(startRow, endRow);
		const er = Math.max(startRow, endRow);

		const amount = er - sr;

		sheetManager.selectCell(sr, selCol);

		sheetManager.deleteSelRow(amount + 1);
		checkCommand.handleEsc();
		hideDialog();
	}

	// rcv functions
	function copySelection() {
		let col = sheetManager.selCol;
		let row = sheetManager.selRow;
		let text = sheetManager.getFormula(row, col);
		navigator.clipboard.writeText(text);
		visualManager.yankSelection(sheetManager);
		hideDialog();
	}

	function copySelectionValue() {
		let col = sheetManager.selCol;
		let row = sheetManager.selRow;
		let text = sheetManager.getValue(row, col);
		navigator.clipboard.writeText(text);
		visualManager.yankSelection(sheetManager, false);
		hideDialog();
	}

	// rcn functions
	function deleteRow() {
		sheetManager.deleteSelRow(1);
		hideDialog();
	}

	function deleteColumn() {
		sheetManager.deleteSelCol(1);
		hideDialog();
	}

	function rowAbove() {
		sheetManager.insertRowAbove();
		hideDialog();
	}

	function rowBelow() {
		sheetManager.insertRowBelow();
		hideDialog();
	}

	function copyFormula() {
		sheetManager.yankFormula();
		hideDialog();
	}

	function copyValue() {
		sheetManager.yankValue();
		hideDialog();
	}

	function paste() {
		sheetManager.paste(1);
		hideDialog();
	}

	function pasteBelow() {
		sheetManager.pasteInGapRow(1, 1);
		hideDialog();
	}

	function pasteAbove() {
		sheetManager.pasteInGapRow(1, -1);
		hideDialog();
	}

	function pasteLeft() {
		sheetManager.pasteInGapCol(1, -1);
		hideDialog();
	}

	function pasteRight() {
		sheetManager.pasteInGapCol(1, 1);
		hideDialog();
	}

</script>

<style scoped>
#rightClickMenu {
	position: fixed;
	margin: 0;
	padding: 0;
	z-index: 9999;
	transform: translateZ(0);
}

#rightClickMenu ul {
	list-style-type: none;
	background-color: rgb(15,15,15);
	margin: 0;
	border-radius: 5px;
	border: 1px solid rgb(30,30,30);
	padding: 2px;
	font-size: 13px;
	color: white;
	width: fit-content;
	white-space: nowrap;
	z-index: 9999;
}

#rightClickMenu ul li {
	padding: 3px;
	border-radius: 3px;
	cursor: pointer;
}

.delete:hover {
	color: #FF3D69;
}

#rightClickMenu ul li:hover {
	background-color: rgb(30,30,30);
}

.rcInactive {
	display: none;
}

.rcActive {
	display: block;
}

.com {
	color: rgb(70,70,70);
	margin-left: 20px;
	float: right;
}
</style>
