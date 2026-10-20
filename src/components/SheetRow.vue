<template>
	<tr class="sheetRow">
		<td class="labels rowLabels">{{ rowNo }}</td>
		<td class="labels relRow">{{ Math.abs(rowNo - pane.row) }}</td>
		<SheetCell 
			v-for="(cell, index) in row"
			:key="index"
			:rowNo="rowNo"
			:colNo="index"
			:pane="pane"
			:active="active"
		/>
	</tr>
</template>
<script setup>
	import SheetCell from './SheetCell.vue';

	defineProps({
		pane: { type: Object, required: true },
		active: Boolean,
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
