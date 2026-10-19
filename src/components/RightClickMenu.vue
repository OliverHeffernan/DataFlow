<template>
	<div id="rightClickMenu" class="rcInactive">
		<ul id="rcn">
			<li @click="deleteRow()" class="delete">Delete Row <span class="com">dd</span></li>
			<li @click="deleteColumn()" class="delete">Delete Column<span class="com">:deletecol</span></li>
			<li>--</li>
			<li @click="run('O&lt;Esc&gt;&lt;Esc&gt;')">Insert Row Above<span class="com">O</span></li>
			<li @click="run('o&lt;Esc&gt;&lt;Esc&gt;')">Insert Row Below<span class="com">o</span></li>
			<li @click="ex(':insertleft')">Insert Column Left<span class="com">:insertleft</span></li>
			<li @click="ex(':insertright')">Insert Column Right<span class="com">:insertright</span></li>
			<li>--</li>
			<li @click="ex(':yankcell')">Copy Cell Formula<span class="com">:yankcell</span></li>
			<li @click="ex(':yankvalue')">Copy Cell Value<span class="com">:yankvalue</span></li>
			<li>--</li>
			<li @click="paste()">Paste<span class="com">p</span></li>
			<li @click="ex(':putabove')">Paste Above<span class="com">:putabove</span></li>
			<li @click="ex(':putbelow')">Paste Below<span class="com">:putbelow</span></li>
			<li @click="ex(':putleft')">Paste Left<span class="com">:putleft</span></li>
			<li @click="ex(':putright')">Paste Right<span class="com">:putright</span></li>
			<li @click="openHelp()">Help ...</li>
		</ul>
		<ul id="rcv">
			<li @click="run('y')">Copy Selection Formulae <span class="com">y</span></li>
			<li @click="ex(':yankvalue')">Copy Selection Value <span class="com">:yankvalue</span></li>
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
		ex(':help');
	}

	function run(keys) { checkCommand.keyboard.feed(keys, false); hideDialog(); }
	function ex(command) { checkCommand.handleEnterFromCom(command); hideDialog(); }
	function deleteRows() { run('d'); }
	function deleteRow() { run('dd'); }
	function deleteColumn() { ex(':deletecol'); }
	function paste() { run('p'); }

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
