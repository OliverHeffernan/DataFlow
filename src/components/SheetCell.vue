<template>
	<td class="tableCell"><button :id="colNo + ':' + rowNo" class="cell" @click="handleClick()"></button></td>
</template>

<script setup>
	import { defineProps, ref } from 'vue';
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = ref(new SheetManager());
	function handleClick() {
		sheetManager.value.selectCell(props.rowNo, props.colNo);
	}

	const props = defineProps({
		rowNo: {
			type: Number,
			required: true,
		},
		colNo: {
			type: Number,
			required: true,
		},
	});
</script>

<style scoped>
td {
	border: 1px solid #15202E;
	height: 20px;
}
.cell {
	background-color: #091119;
	border: none;
	outline: none;
	height: calc(18px);
	min-width: 80px;
	width: fit-content;
	color: white;
	text-align: left;
	font-size: 15px;
	margin: 0;
	white-space: nowrap;
}

.focussed {
	outline: 2px solid white;
}

</style>
