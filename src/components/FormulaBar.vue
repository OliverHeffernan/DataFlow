<template>
	<div :id="active ? 'topBar' : undefined" class="formula-bar" ref="bar">
		<input :id="active ? 'cellPicker' : undefined" class="cell-picker" :value="address" :readonly="!active" aria-label="Cell address" @input="selectCell" @keyup.esc="handleEscape" @keyup.enter="focusFormulaBar" type="text" placeholder="e.g. A0" />
		<NewFormBar v-if="active" />
		<div v-else class="inactive-formula" aria-label="Formula text">{{ formula }}</div>
		<FormatPanel v-if="active" />
		<span v-else class="inactive-format" :title="summary">{{ summary }}</span>
	</div>
</template>
<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import NewFormBar from "./NewFormBar.vue";
import FormatPanel from './FormatPanel.vue';
import SheetManager from '../classes/SheetManager.js';
import { summarizeFormats } from '../classes/CellFormatting.js';
const props = defineProps({ pane: { type: Object, required: true }, active: Boolean });
const sheetManager = new SheetManager();
const bar = ref(null);
const address = computed(() => `${sheetManager.columnLabel(props.pane.col)}${props.pane.row}`);
const formula = computed(() => {
	sheetManager.sheetResults.value;
	return props.pane.sheet.rows[props.pane.row]?.[props.pane.col] ?? '';
});
const summary = computed(() => {
	sheetManager.styleVersion.value;
	sheetManager.sheetResults.value;
	const preview = sheetManager.formatPreview?.sheet === props.pane.sheet ? sheetManager.formatPreview.styles.get(`${props.pane.row}:${props.pane.col}`) : null;
	return summarizeFormats([preview ?? props.pane.sheet.styles[props.pane.row]?.[props.pane.col] ?? sheetManager.defaultStyling]);
});

import CheckCommand from "../classes/CheckCommand.js";
const checkCommand = new CheckCommand();
const resize = new ResizeObserver(() => {
	const pane = bar.value.parentElement;
	pane.style.setProperty('--pane-formula-height', `${bar.value.offsetHeight}px`);
	pane.style.setProperty('--pane-height', `${pane.clientHeight}px`);
});
onMounted(() => { resize.observe(bar.value); resize.observe(bar.value.parentElement); });
onUnmounted(() => resize.disconnect());

function handleEscape() {
	checkCommand.changeMode("n");
	checkCommand.focus();
}

function selectCell(event) {
	const match = event.target.value.match(/^([A-Z]+)(\d+)$/);
	if (match) {
		const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
		checkCommand.keyboard.context = 'sheet';
		checkCommand.keyboard.move({ row: Number(match[2]), col });
		checkCommand.render();
	}
}

function focusFormulaBar() {
	checkCommand.editCell();
	checkCommand.focus();
}

</script>
<style scoped>
.formula-bar {
	flex-shrink: 0;
	min-width: 0;
	font-size: 15px;
	background-color: #15202E;
	border-bottom: 1px solid #26394c;
	outline: none;
	color: white;
	display: flex;
	z-index: 40;
	padding: 0;
}

.cell-picker {
	flex: 0 0 60px;
	min-width: 0;
	background-color: #15202E;
	border: none;
	outline: none;
	height: 26px;
	width: 60px;
	color: white;
	text-align: left;
	font: 13px/20px ui-monospace, monospace;
	margin: 0;
	padding: 3px 6px;
	white-space: nowrap;
	border-right: 1px solid #395269;
}

.inactive-formula { flex: 1; min-width: 0; max-height: max(20px, calc(var(--pane-height, 100vh) * .35)); overflow: auto; white-space: pre; color: #9aaec3; font: 15px/20px ui-monospace, monospace; }
.inactive-format { align-self: flex-start; max-width: 40%; margin: 6px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aaec3; font: 12px/20px ui-monospace, monospace; }
.formula-bar :deep(.formula-editor) { position: static; }
.formula-bar :deep(#newFormBar) { max-height: max(20px, calc(var(--pane-height, 100vh) * .35)); }
.formula-bar :deep(.formula-completions) { top: var(--pane-formula-height, 36px); left: 6px; width: min(440px, calc(100% - 12px)); max-height: max(0px, calc(100% - var(--pane-formula-height, 36px) - 40px)); overflow: auto; box-sizing: border-box; z-index: 310; }
</style>
