<template>
	<div class="window-layout" ref="host">
		<WorkspaceWindow v-for="item in layout.windows" :key="item.node.id" :pane="item.node" :style="position(item)" />
		<div v-for="item in layout.separators" :key="item.node.id" class="window-separator" :class="item.node.axis" :style="position(item)"
			role="separator" tabindex="0" :aria-orientation="item.node.axis" aria-label="Resize split"
			:aria-valuenow="Math.round(item.node.ratio * 100)" aria-valuemin="15" aria-valuemax="85"
			@pointerdown.prevent="startResize($event, item)" @pointermove="resize" @pointerup="endResize" @pointercancel="endResize"
			@keydown.stop="resizeKey($event, item.node)" />
	</div>
</template>

<script setup>
import { computed, ref, shallowRef, onMounted, onUnmounted } from 'vue';
import CheckCommand from '../classes/CheckCommand.js';
import WorkspaceWindow from './WorkspaceWindow.vue';
const check = new CheckCommand(), host = ref(null), size = shallowRef({ width: 0, height: 0 });
const layout = computed(() => check.windows.layout(size.value.width, size.value.height));
const position = item => ({ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
const measure = () => { size.value = { width: host.value.clientWidth, height: host.value.clientHeight }; };
const observer = new ResizeObserver(measure);
onMounted(() => { measure(); observer.observe(host.value); });
onUnmounted(() => observer.disconnect());
let dragging = null;
function startResize(event, item) { dragging = item; event.currentTarget.setPointerCapture(event.pointerId); }
function endResize() { dragging = null; }
function resize(event) {
	if (!dragging) return;
	const rect = host.value.getBoundingClientRect(), vertical = dragging.node.axis === 'vertical', bounds = dragging.bounds;
	const offset = vertical ? event.clientX - rect.left - bounds.x : event.clientY - rect.top - bounds.y;
	check.windows.resize(dragging.node.id, (offset - 2.5) / Math.max(1, (vertical ? bounds.width : bounds.height) - 5));
}
function resizeKey(event, node) {
	const keys = node.axis === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
	if (keys.includes(event.key)) { event.preventDefault(); check.windows.resize(node.id, node.ratio + (event.key === keys[0] ? -0.05 : 0.05)); }
	else if (event.key === 'Escape') { event.preventDefault(); check.focus(); }
}
</script>

<style>
.window-layout { position: absolute; inset: 0; overflow: hidden; }
.window-separator { position: absolute; background: #26394c; touch-action: none; z-index: 35; }
.window-separator.vertical { cursor: col-resize; }
.window-separator.horizontal { cursor: row-resize; }
.window-separator:hover, .window-separator:focus-visible { background: #75e2bc; outline: none; }
</style>
