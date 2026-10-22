<template>
	<section class="workspace-window" :class="{ 'active-window': active }" :data-window="pane.id" :data-active="active" :aria-label="title" @pointerdown.capture="activate">
		<FormulaBar v-if="pane.content === 'sheet'" :pane="pane" :active="active" />
		<SheetPane v-if="pane.content === 'sheet'" :pane="pane" :active="active" />
		<ConditionalPane v-else :pane="pane" :active="active" />
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
const props = defineProps({ pane: { type: Object, required: true } });
const check = new CheckCommand();
const active = computed(() => check.windows.state.activeId === props.pane.id);
const title = computed(() => {
	check.sheet.sheetResults.value;
	return props.pane.content === 'cf' ? `Conditional formatting · ${props.pane.sheet.name}` : props.pane.sheet.name;
});
const sheetNumber = computed(() => check.sheet.sheets.indexOf(props.pane.sheet) + 1);
const result = computed(() => check.sheet.sheetResults.value.get(props.pane.sheet));
const error = computed(() => props.pane.content === 'sheet'
	? result.value?.errors.get(`${props.pane.row}:${props.pane.col}`) || result.value?.presentation[props.pane.row]?.[props.pane.col]?.warning
	: props.pane.rules?.state.error);
const diagnostic = computed(() => {
	if (error.value) return error.value;
	if (props.pane.content !== 'sheet') return '';
	const owner = result.value?.spills.get(`${props.pane.row}:${props.pane.col}`);
	return owner ? `Spill ${check.sheet.columnLabel(owner.col)}${owner.row} · ${owner.rows} × ${owner.cols}${owner.row !== props.pane.row || owner.col !== props.pane.col ? ' · Edit source with i / Enter' : ''}` : '';
});
function activate(event) {
	// Cell handlers activate and select together, without rendering the old cursor first.
	if (!active.value && !event.target.closest('.cell')) check.activateWindow(props.pane.id);
}
</script>

<style>
.workspace-window { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: #091119; border: 1px solid #26394c; }
.workspace-window.active-window { border-color: #395269; }
.workspace-window:not(.active-window) .pane-cursor { box-shadow: inset 0 0 0 1px #688294; }
.window-status { display: flex; align-items: center; gap: 12px; flex-shrink: 0; padding: 4px 10px; height: 20px; background: #111d2a; color: #9aaec3; font: 12px/20px ui-monospace, monospace; border-top: 1px solid #26394c; }
.window-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.active-window > .window-status { color: #dbe6f3; }
.window-sheet-number { margin-left: auto; flex-shrink: 0; color: #9aaec3; }
.pane-diagnostic { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #afc5df; font-size: 11px; }
.pane-diagnostic.cell-error { color: #ffb5a2; }
</style>
