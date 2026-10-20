<template>
	<div v-if="node.type === 'split'" class="window-split" :class="node.axis" :style="splitStyle">
		<WindowNode :node="node.first" />
		<div class="window-separator" role="separator" tabindex="0" :aria-orientation="node.axis" aria-label="Resize split"
			:aria-valuenow="Math.round(node.ratio * 100)" aria-valuemin="15" aria-valuemax="85"
			@pointerdown.prevent="startResize" @pointermove="resize" @pointerup="endResize" @pointercancel="endResize"
			@keydown.stop="resizeKey" />
		<WindowNode :node="node.second" />
	</div>
	<section v-else class="workspace-window" :class="{ 'active-window': active }" :data-window="node.id" :data-active="active" :aria-label="title" @pointerdown.capture="activate">
		<FormulaBar v-if="node.content === 'sheet'" :pane="node" :active="active" />
		<SheetPane v-if="node.content === 'sheet'" :pane="node" :active="active" />
		<ConditionalPane v-else :pane="node" :active="active" />
		<footer class="window-status">
			<span class="window-title" :title="title">{{ title }}</span>
			<span v-if="diagnostic" class="pane-diagnostic" :class="{ 'cell-error': error }" role="status" :title="diagnostic">{{ diagnostic }}</span>
			<span class="window-sheet-number" aria-label="Sheet number / total sheets">{{ sheetNumber }}/{{ check.sheet.sheets.length }}</span>
		</footer>
	</section>
</template>

<script setup>
import { computed } from 'vue';
import CheckCommand from '../classes/CheckCommand.js';
import FormulaBar from './FormulaBar.vue';
import SheetPane from './SheetPane.vue';
import ConditionalPane from './ConditionalPane.vue';
const props = defineProps({ node: { type: Object, required: true } });
const check = new CheckCommand();
const active = computed(() => check.windows.state.activeId === props.node.id);
const title = computed(() => {
	check.sheet.sheetResults.value;
	return props.node.content === 'cf' ? `Conditional formatting · ${props.node.sheet.name}` : props.node.sheet.name;
});
const sheetNumber = computed(() => check.sheet.sheets.indexOf(props.node.sheet) + 1);
const result = computed(() => check.sheet.sheetResults.value.get(props.node.sheet));
const error = computed(() => props.node.content === 'sheet'
	? result.value?.errors.get(`${props.node.row}:${props.node.col}`) || result.value?.presentation[props.node.row]?.[props.node.col]?.warning
	: props.node.rules?.state.error);
const diagnostic = computed(() => {
	if (error.value) return error.value;
	if (props.node.content !== 'sheet') return '';
	const owner = result.value?.spills.get(`${props.node.row}:${props.node.col}`);
	return owner ? `Spill ${check.sheet.columnLabel(owner.col)}${owner.row} · ${owner.rows} × ${owner.cols}${owner.row !== props.node.row || owner.col !== props.node.col ? ' · Edit source with i / Enter' : ''}` : '';
});
const splitStyle = computed(() => ({ [props.node.axis === 'vertical' ? 'gridTemplateColumns' : 'gridTemplateRows']: `minmax(0, ${props.node.ratio}fr) 5px minmax(0, ${1 - props.node.ratio}fr)` }));
function activate() { if (!active.value) check.activateWindow(props.node.id); }
let dragging = false;
function startResize(event) { dragging = true; event.currentTarget.setPointerCapture(event.pointerId); }
function endResize() { dragging = false; }
function resize(event) {
	if (!dragging) return;
	const rect = event.currentTarget.parentElement.getBoundingClientRect(), vertical = props.node.axis === 'vertical';
	check.windows.resize(props.node.id, vertical ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height);
}
function resizeKey(event) {
	const keys = props.node.axis === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
	if (keys.includes(event.key)) { event.preventDefault(); check.windows.resize(props.node.id, props.node.ratio + (event.key === keys[0] ? -0.05 : 0.05)); }
	else if (event.key === 'Escape') { event.preventDefault(); check.focus(); }
}
</script>

<style>
.window-split { display: grid; min-width: 0; min-height: 0; overflow: hidden; }
.window-split.vertical { grid-template-rows: minmax(0, 1fr); }
.window-split.horizontal { grid-template-columns: minmax(0, 1fr); }
.window-separator { background: #26394c; touch-action: none; z-index: 35; }
.vertical > .window-separator { cursor: col-resize; }
.horizontal > .window-separator { cursor: row-resize; }
.window-separator:hover, .window-separator:focus-visible { background: #75e2bc; outline: none; }
.workspace-window { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: #091119; border: 1px solid #26394c; }
.workspace-window.active-window { border-color: #395269; }
.window-status { display: flex; align-items: center; gap: 12px; flex-shrink: 0; padding: 4px 10px; height: 20px; background: #111d2a; color: #9aaec3; font: 12px/20px ui-monospace, monospace; border-top: 1px solid #26394c; }
.window-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.active-window > .window-status { color: #dbe6f3; }
.window-sheet-number { margin-left: auto; flex-shrink: 0; color: #9aaec3; }
.pane-diagnostic { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #afc5df; font-size: 11px; }
.pane-diagnostic.cell-error { color: #ffb5a2; }
</style>
