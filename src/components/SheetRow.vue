<template>
	<tr class="sheetRow" :style="{ height: height + 'px' }" :aria-rowindex="rowNo + 2">
		<td class="labels rowLabels">{{ rowNo }}</td>
		<td class="labels relRow">{{ Math.abs(rowNo - pane.row) }}</td>
		<template v-for="col in columns" :key="col.index">
		<td v-if="col.gap" class="column-spacer" :colspan="col.count" aria-hidden="true"></td>
		<SheetCell v-else
			:rowNo="rowNo"
			:colNo="col.index"
			:pane="pane"
			:selected="rowNo === pane.row && col.index === pane.col"
		/>
		</template>
	</tr>
</template>
<script setup>
	import SheetCell from './SheetCell.vue';

	defineProps({
		pane: { type: Object, required: true },
		rowNo: {
			type: Number,
			required: true,
		},
		height: { type: Number, required: true },
		columns: {
			type: Array,
			required: true,
		},
	});
</script>
<style scoped>

</style>
