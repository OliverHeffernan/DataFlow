<template>
	<td class="tableCell">
		<button
			:id="colNo + ':' + rowNo"
			class="cell"
			@dblclick="handleDblClick"
			@click="handleClick"
			@contextmenu.prevent="handleRightClick"
		></button>
		<div
			:id="'visual'+colNo+':'+rowNo"
			class="sel inactive"
		></div>
	</td>
</template>

<script setup>
	import { ref, onMounted, defineProps } from 'vue';
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();

	import VisualManager from '../classes/VisualManager.js';
	const visualManager = new VisualManager();

	import CheckCommand from '../classes/CheckCommand.js';
	const checkCommand = new CheckCommand();

	const props = defineProps({
		rowNo: {
			type: Number,
			required: true,
		},
		colNo: {
			type: Number,
			required: true,
		},
		numOfCols: {
			type: Number,
			required: true,
		},
		numOfRows: {
			type: Number,
			required: true,
		}
	});

	onMounted(() => {
		//if (props.rowNo == sheetManager.value.numOfRows.value - 1 && props.colNo == sheetManager.value.numOfCols.value - 1) {
		if (props.rowNo == props.numOfRows - 1 && props.colNo == props.numOfCols - 1) {
			sheetManager.loadAllCells(sheetManager.numOfRows.value, sheetManager.numOfCols.value);
			sheetManager.loadStyles();
		}
	});
	function handleMouseover() {
		const thisRow = props.rowNo;
		const thisCol = props.colNo;
		if (visualManager.dragging) {
			const startRow = sheetManager.selRow;
			const startCol = sheetManager.selCol;
			

			// check if new cell
			// if different, then do a visualselection
			if (startRow != thisRow || startCol != thisCol) {
				sheetManager.selectCell(thisRow, thisCol);
			}
		}
	}
			
	function handleClick(event) {
		console.log(checkCommand.mode);
		if (event.shiftKey && checkCommand.mode == "n") {
			checkCommand.changeMode("v");
			visualManager.startVisual(sheetManager.selRow, sheetManager.selCol);
		}
		else if (!event.shiftKey && checkCommand.mode == "v") {
			checkCommand.handleEsc();
		}
		sheetManager.selectCell(props.rowNo, props.colNo);
		document.getElementById("commandLine").focus();
	}

	function handleDblClick() {
		sheetManager.selectCell(props.rowNo, props.colNo);
		document.getElementById("formulaBar").focus();
	}

	const rcMenu = document.getElementById("rightClickMenu");
	function handleRightClick(event) {
		const thisRow = props.rowNo;
		const thisCol = props.colNo;
		sheetManager.selectCell(thisRow, thisCol);
		rcMenu.className = "rcActive";
		modalRightClick();

		const rcHeight = rcMenu.style.height;
		console.log(rcHeight);
		
		rcMenu.style.left = event.clientX + "px";
		rcMenu.style.top = event.clientY + "px";
	}

	function modalRightClick() {
		const mode = checkCommand.mode;
		const rcn = document.getElementById("rcn");
		const rcv = document.getElementById("rcv");
		const rcV = document.getElementById("rcV");

		if (mode == "n") {
			rcn.style.display = "block";
		}
		else {
			rcn.style.display = "none";
		}

		if (mode == "v") {
			rcv.style.display = "block";
		}
		else {
			rcv.style.display = "none";
		}
			
		if (mode == "V") {
			rcV.style.display = "block";
		}
		else {
			rcV.style.display = "none";
		}
	}

</script>

<style scoped>
td {
	border: 1px solid #15202E;
	height: 20px;
	padding: 0;
	margin: 0;
	/*background-color: #091119;*/
	background-color: transparent;
	position: relative;
	z-index: 10;
}

.cell {
	z-index: 3;
	/*background-color: #091119;*/
	background-color: transparent;
	border: none;
	outline: none;
	/*height: calc(18px);*/
	height: 100%;
	min-width: 80px;
	/*width: fit-content;*/
	width: 100%;
	color: white;
	text-align: left;
	font-size: 15px;
	margin: 0;
	padding: 2px;
	white-space: pre;
	display: block;
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.cell:hover {
	/*outline: 1px solid rgba(255,255,255,0.5);*/
	box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5); /* Inner outline effect */
}

.focussed:hover {
	/*outline: 2px solid white;*/
	box-shadow: inset 0 0 0 2px white; /* Inner outline effect */
}

.focussed {
	/*outline: 2px solid white;*/
	box-shadow: inset 0 0 0 2px white; /* Inner outline effect */
}

.visualSelection {
	/*background-color: rgba(0, 216, 255, 0.5);*/
	background-color: rgba(255,255,255,0.5);
}

.sel {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	right: 0;
	/*background-color: rgba(15, 255, 255);*/
	/*background-color: #4CFDFF;*/
	/*background-color: #A0FEFF;*/
	background-color: rgba(160,254,255,0.3);
	z-index: 1;
	/*opacity: 0.3;*/
	pointer-events: none;
}

.t {
	border-top: lightblue 2px solid;
}
.r {
	border-right: lightblue 2px solid;
}
.b {
	border-bottom: lightblue 2px solid;
}
.l {
	border-left: lightblue 2px solid;
}

div.t.r.b.l {
	border: none !important;
	box-shadow: inset 0 0 0 2px white !important; /* Inner outline effect */
}


.inactive {
	display: none;
}

.active {
	display: block;
}
</style>
