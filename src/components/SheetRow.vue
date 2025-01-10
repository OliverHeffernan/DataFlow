<template>
	<tr class="sheetRow">
		<td class="labels rowLabels">{{ rowNo }}</td>
		<td class="labels relRow">{{ rowNo }}</td>
		<SheetCell 
			v-for="(cell, index) in row"
			:key="index"
			:rowNo="rowNo"
			:colNo="index"
			:numOfRows="sheetManager.numOfRows.value"
			:numOfCols="sheetManager.numOfCols.value"
		/>
	</tr>
</template>
<script setup>
	import { defineProps } from 'vue';
	import SheetCell from './SheetCell.vue';
	import SheetManager from '../classes/SheetManager.js';

	const sheetManager = new SheetManager();

	defineProps({
		rowNo: {
			type: Number,
			required: true,
		},
		row: {
			type: Array,
			required: true,
		},
	});
</script>
<style scoped>

</style>
