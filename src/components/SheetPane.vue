<template>
	<div class="sheet-viewport" :id="active ? 'sheetViewport' : undefined" @scroll="scrolled" ref="viewport">
		<table>
			<thead><tr><th class="rowLabelType rowLabels">abs</th><th class="rowLabelType relRow">rel</th><th v-for="(_, col) in rows[0]" :key="col" class="labels colLabels">{{ manager.columnLabel(col) }}</th></tr></thead>
			<tbody><SheetRow v-for="(row, index) in rows" :key="index" :row="row" :rowNo="index" :pane="pane" /></tbody>
		</table>
		<div class="grid-overlays" :id="active ? 'gridOverlays' : undefined" aria-hidden="true"></div>
	</div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import SheetRow from './SheetRow.vue';
import SheetManager from '../classes/SheetManager.js';
import CheckCommand from '../classes/CheckCommand.js';
const props = defineProps({ pane: { type: Object, required: true }, active: Boolean });
const manager = new SheetManager(), check = new CheckCommand(), viewport = ref(null);
const rows = computed(() => manager.sheetResults.value.get(props.pane.sheet)?.values ?? props.pane.sheet.rows);
function scrolled() {
	props.pane.scrollTop = viewport.value.scrollTop; props.pane.scrollLeft = viewport.value.scrollLeft;
	if (props.active) check.refreshOverlays();
}
const observer = new ResizeObserver(() => {
	if (props.active) { manager.ensureCellVisible(props.pane.row, props.pane.col); check.refreshOverlays(); }
});
onMounted(() => { viewport.value.scrollTop = props.pane.scrollTop; viewport.value.scrollLeft = props.pane.scrollLeft; observer.observe(viewport.value); });
onUnmounted(() => observer.disconnect());
</script>

<style>
.sheet-viewport { flex: 1; min-height: 0; min-width: 0; overflow: auto; position: relative; isolation: isolate; }
.sheet-viewport table { border-collapse: collapse; margin: 0; }
.sheet-viewport .colLabels, .sheet-viewport .rowLabelType { top: 0; }
.sheet-viewport .rowLabels { min-width: 25px; }
.sheet-viewport .relRow { min-width: 25px; left: 45px; }
.sheet-viewport .cell { scroll-margin: 30px 0 0 90px; }
.grid-overlays { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 25; }
</style>
