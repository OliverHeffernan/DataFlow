<template>
	<td class="tableCell"><button :id="colNo + ':' + rowNo" class="cell" @dblclick="handleDblClick" @click="handleClick()"></button></td>
</template>

<script setup>
	import { ref, onMounted, defineProps } from 'vue';
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();

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
		if (props.rowNo == 0) {
			console.log(props.numOfCols);
		}
		if (props.rowNo == props.numOfRows - 1 && props.colNo == props.numOfCols - 1) {
			console.log("loaded");
			sheetManager.loadAllCells(sheetManager.numOfRows.value, sheetManager.numOfCols.value);
			sheetManager.loadStyles();
		}
	});
	function handleClick() {
		sheetManager.selectCell(props.rowNo, props.colNo);
		document.getElementById("commandLine").focus();
	}

	function handleDblClick() {
		sheetManager.selectCell(props.rowNo, props.colNo);
		document.getElementById("formulaBar").focus();
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
}
.cell {
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
	white-space: nowrap;
	display: block;
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
</style>
