<template>
	<div class="sheet-viewport" :id="active ? 'sheetViewport' : undefined" :style="{ '--row-label-width': geometry.label + 'px' }" @scroll="scrolled" ref="viewport">
		<table :style="{ width: geometry.label * 2 + geometry.cols.at(-1) + 'px' }" :aria-rowcount="cells.length + 1" :aria-colcount="cells[0].length + 2">
			<colgroup>
				<col :span="2" :style="{ width: geometry.label + 'px' }">
				<col v-for="(_, col) in cells[0]" :key="col" :style="{ width: geometry.cols[col + 1] - geometry.cols[col] + 'px' }">
			</colgroup>
			<thead><tr>
				<th class="rowLabelType rowLabels">abs</th><th class="rowLabelType relRow">rel</th>
				<template v-for="col in columns" :key="col.index">
					<th v-if="col.gap" class="column-spacer" :colspan="col.count" aria-hidden="true"></th>
					<th v-else class="labels colLabels" :aria-colindex="col.index + 3">{{ manager.columnLabel(col.index) }}</th>
				</template>
			</tr></thead>
			<tbody><template v-for="row in visibleRows" :key="row.index">
				<tr v-if="row.gap" class="grid-spacer" aria-hidden="true"><td :colspan="cells[0].length + 2" :style="{ height: row.size + 'px' }"></td></tr>
				<SheetRow v-else :rowNo="row.index" :height="row.size" :columns="columns" :pane="pane" />
			</template></tbody>
		</table>
		<div class="grid-overlays" :id="active ? 'gridOverlays' : undefined" aria-hidden="true"></div>
	</div>
</template>

<script setup>
import { computed, ref, watchEffect, onMounted, onUnmounted, nextTick } from 'vue';
import SheetRow from './SheetRow.vue';
import SheetManager from '../classes/SheetManager.js';
import CheckCommand from '../classes/CheckCommand.js';
import GridGeometry from '../classes/GridGeometry.js';
const props = defineProps({ pane: { type: Object, required: true }, active: Boolean });
const manager = new SheetManager(), check = new CheckCommand(), viewport = ref(null);
const cells = computed(() => manager.sheetResults.value.get(props.pane.sheet)?.presentation ?? props.pane.sheet.rows.map(row => row.map(text => ({ text }))));
const context = document.createElement('canvas').getContext('2d');
const font = ref(`15px ${getComputedStyle(document.getElementById('app')).fontFamily}`), height = ref(600), width = ref(1000);
const geometry = computed(() => {
	context.font = font.value;
	return GridGeometry.for(cells.value, font.value, text => context.measureText(text).width);
});
const visibleRows = computed(() => geometry.value.segments(geometry.value.rows, props.pane.scrollTop, height.value, geometry.value.chartRows));
const columns = computed(() => geometry.value.segments(geometry.value.cols, props.pane.scrollLeft, width.value, geometry.value.chartCols));
watchEffect(() => { if (viewport.value) viewport.value.gridGeometry = geometry.value; });
function scrolled() {
	props.pane.scrollTop = viewport.value.scrollTop; props.pane.scrollLeft = viewport.value.scrollLeft;
	if (props.active) check.refreshOverlays();
}
const observer = new ResizeObserver(() => {
	height.value = viewport.value.clientHeight; width.value = viewport.value.clientWidth;
	if (props.active) { manager.ensureCellVisible(props.pane.row, props.pane.col); check.refreshOverlays(); }
});
onMounted(async () => {
	font.value = getComputedStyle(viewport.value).getPropertyValue('--cell-font').trim();
	await nextTick();
	if (!viewport.value) return;
	viewport.value.scrollTop = props.pane.scrollTop; viewport.value.scrollLeft = props.pane.scrollLeft;
	height.value = viewport.value.clientHeight; width.value = viewport.value.clientWidth;
	observer.observe(viewport.value);
});
onUnmounted(() => observer.disconnect());
</script>

<style>
.sheet-viewport { --cell-font: 15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; flex: 1; min-height: 0; min-width: 0; overflow: auto; position: relative; isolation: isolate; overflow-anchor: none; }
.sheet-viewport table { border-collapse: separate; border-spacing: 0; table-layout: fixed; margin: 0; }
.sheet-viewport .colLabels, .sheet-viewport .rowLabelType { top: 0; height: 21px; box-sizing: border-box; }
.sheet-viewport .rowLabels { min-width: 25px; }
.sheet-viewport .relRow { min-width: 25px; left: var(--row-label-width); }
.grid-spacer > td, .column-spacer { padding: 0; border: 0; }
.active-window .pane-cursor { box-shadow: inset 0 0 0 2px white; }
.sheet-viewport .cell { scroll-margin: 30px 0 0 90px; }
.grid-overlays { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 25; }
</style>
