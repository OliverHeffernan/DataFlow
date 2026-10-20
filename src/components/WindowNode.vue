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
		<header class="window-header"><span>{{ title }}</span><span class="window-number">{{ node.id }}{{ active ? ' · ACTIVE' : '' }}</span></header>
		<SheetPane v-if="node.content === 'sheet'" :pane="node" :active="active" />
		<ConditionalPane v-else :pane="node" :active="active" />
	</section>
</template>

<script setup>
import { computed } from 'vue';
import CheckCommand from '../classes/CheckCommand.js';
import SheetPane from './SheetPane.vue';
import ConditionalPane from './ConditionalPane.vue';
const props = defineProps({ node: { type: Object, required: true } });
const check = new CheckCommand();
const active = computed(() => check.windows.state.activeId === props.node.id);
const title = computed(() => props.node.content === 'cf' ? `Conditional formatting · ${props.node.sheet.name}` : props.node.sheet.name);
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
.workspace-window { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: #091119; border: 1px solid #26394c; }
.workspace-window.active-window { border-color: #75e2bc; }
.window-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; padding: 5px 10px; min-height: 20px; background: #111d2a; color: #9aaec3; font: 12px/20px ui-monospace, monospace; border-bottom: 1px solid #26394c; }
.window-header > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.active-window > .window-header { color: #dbe6f3; }
.window-number { flex-shrink: 0; font-size: 10px; color: #75e2bc; }
</style>
