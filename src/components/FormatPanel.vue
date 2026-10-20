<template>
	<div ref="root" class="format-control" data-format-panel>
		<button class="format-badge" :class="{ open: session }" :disabled="!session && !format?.enabled" :title="format?.summary ?? 'General'" aria-label="Cell format" :aria-expanded="!!session" aria-controls="format-panel" @mousedown.prevent @click="toggle">
			<span>{{ format?.summary ?? 'General' }}</span><kbd v-if="session ? key('Done') : format?.openKey">{{ session ? key('Done') : format.openKey }}</kbd><span aria-hidden="true">{{ session ? '⌃' : '⌄' }}</span>
		</button>
		<section v-if="session" id="format-panel" role="dialog" aria-modal="false" aria-labelledby="format-title" class="format-panel" @mousedown.prevent>
			<header><strong id="format-title">Format</strong><span>{{ session.scope }} · {{ session.draft.size }} {{ session.draft.size === 1 ? 'cell' : 'cells' }}</span></header>
			<div class="format-rows">
				<div v-for="(row, index) in session.rows" :key="row.key" class="format-row" :class="{ selected: index === session.index, 'type-row': row.key === 'formatKind' }">
					<button class="format-setting" :aria-expanded="row.options ? session.menu?.key === row.key : undefined" @click="activate(row)">
						<span class="setting-label">{{ row.label }}</span><span class="setting-value">{{ session.label(row) }}<kbd v-if="key(row.action)">{{ key(row.action) }}</kbd><span v-if="row.options" aria-hidden="true">⌄</span></span>
					</button>
					<div v-if="row.key === 'formatDigits' && !session.input && !session.menu" class="digit-controls">
						<button aria-label="Fewer decimal places" @click="action('Decrease')">− <kbd v-if="key('Decrease')">{{ key('Decrease') }}</kbd></button>
						<button aria-label="More decimal places" @click="action('Increase')">+ <kbd v-if="key('Increase')">{{ key('Increase') }}</kbd></button>
					</div>
					<div v-if="session.menu?.key === row.key" class="format-options" role="listbox" :aria-label="row.label">
						<button v-for="(option, i) in session.menu.options" :key="option.value" role="option" :aria-selected="session.menu.index === i" :class="{ chosen: session.menu.index === i }" @click="choose(i)">{{ option.label }}<span v-if="row.value === option.value" aria-hidden="true">✓</span></button>
					</div>
					<div v-if="session.input?.key === row.key" class="format-input">
						<input :value="session.input.text" :aria-label="row.label" readonly :class="{ replacing: session.input.replace }" />
						<button @click="action('Select')">Confirm <kbd v-if="key('Select')">{{ key('Select') }}</kbd></button>
						<small>Type to replace · <template v-if="key('Backspace')">{{ key('Backspace') }} to erase</template></small>
					</div>
				</div>
			</div>
			<p class="preview-note">Live preview · all {{ session.draft.size }} {{ session.draft.size === 1 ? 'cell' : 'cells' }} · values unchanged</p>
			<p v-if="['date', 'time'].includes(session.common('formatKind'))" class="format-note">ISO text only. Civil dates and clock times stay local; timezone applies only to timestamps with an offset.</p>
			<p v-if="session.error" role="alert" class="format-warning">{{ session.error }}</p>
			<p v-if="format.warnings.length" class="format-warning" role="status">{{ format.warnings.length }} {{ format.warnings.length === 1 ? 'cell keeps' : 'cells keep' }} the raw display.<br>{{ format.warnings[0] }}</p>
			<footer><button @click="action('Revert')"><kbd v-if="key('Revert')">{{ key('Revert') }}</kbd> Revert session</button><button @click="action('Done')"><kbd v-if="key('Done')">{{ key('Done') }}</kbd> Done</button></footer>
		</section>
	</div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import CheckCommand from '../classes/CheckCommand.js';
const command = new CheckCommand(), ui = command.ui, root = ref(null);
const format = computed(() => ui.value.format), session = computed(() => format.value?.session);
const key = action => format.value?.shortcut(action) ?? '';
function toggle() { if (session.value) command.keyboard.finishFormat(); else command.keyboard.openFormat(); command.focus(); }
function action(name) { if (name === 'Done') command.keyboard.finishFormat(); else { session.value.action(name); command.render(); } command.focus(); }
function activate(row) { if (session.value.menu || session.value.input) return; session.value.activate(row); command.render(); command.focus(); }
function choose(index) { session.value.menu.index = index; action('Select'); }
function outside(event) { if (session.value && !root.value.contains(event.target)) command.keyboard.finishFormat(); }
watch(ui, async () => {
	await nextTick();
	const panel = root.value?.querySelector('.format-panel');
	const target = panel?.querySelector('.chosen, .format-input') ?? panel?.querySelector('.format-row.selected');
	if (!target) return;
	const bounds = panel.getBoundingClientRect(), rect = target.getBoundingClientRect();
	if (rect.bottom > bounds.bottom - 8) panel.scrollTop += rect.bottom - bounds.bottom + 8;
	else if (rect.top < bounds.top + 8) panel.scrollTop -= bounds.top + 8 - rect.top;
});
onMounted(() => window.addEventListener('pointerdown', outside, true));
onUnmounted(() => window.removeEventListener('pointerdown', outside, true));
</script>

<style scoped>
.format-control { flex: 0 1 auto; align-self: flex-start; min-width: 0; max-width: 45%; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
button, input { color: inherit; font: inherit; }
button { cursor: pointer; }
.format-badge { display: flex; align-items: center; gap: 10px; max-width: min(340px, calc(100% - 12px)); min-height: 26px; margin: 3px 6px; padding: 3px 10px; border: 1px solid #38516b; border-radius: 7px; color: #dbe6f3; background: #1b3045; }
.format-badge > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.format-badge.open, .format-badge:hover { border-color: #79a9ce; background: #223e57; }
.format-badge:disabled { opacity: .45; cursor: default; }
kbd { flex-shrink: 0; display: inline-block; border: 1px solid #3a526a; border-radius: 4px; padding: 0 5px; font: inherit; color: #b3cfe6; background: #21364b; white-space: nowrap; }
.format-panel { position: absolute; top: calc(var(--pane-formula-height, 36px) + 6px); right: 6px; width: min(420px, calc(100% - 12px)); max-height: max(0px, calc(100% - var(--pane-formula-height, 36px) - 40px)); overflow-y: auto; box-sizing: border-box; padding: 16px; border: 1px solid #4c6c89; border-radius: 10px; color: #dbe6f3; background: #142233; box-shadow: 0 12px 32px #0008; }
header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid #2c4157; }
header strong { font-size: 18px; font-weight: 500; }
header span, .preview-note, .format-note { color: #97b5d0; }
.format-rows { padding: 9px 0; }
.format-row { border: 1px solid transparent; border-radius: 6px; margin: 4px -5px; padding: 3px; }
.format-row.selected { border-color: #577f9f; background: #1a3044; }
.format-setting { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px; background: none; border: 0; padding: 3px; text-align: left; }
.setting-label { flex: 0 0 42%; }
.setting-value { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 6px 8px; border: 1px solid #3a526a; border-radius: 5px; background: #101d2b; }
.setting-value kbd { margin-left: auto; }
.type-row { margin-bottom: 12px; }
.digit-controls { display: flex; justify-content: flex-end; gap: 6px; margin: 3px; }
.digit-controls button { background: #223a50; border: 1px solid #3a526a; border-radius: 4px; padding: 1px 7px; }
.format-options { margin: 6px 3px 2px; border: 1px solid #486884; border-radius: 6px; overflow: hidden; }
.format-options button { width: 100%; display: flex; justify-content: space-between; border: 0; background: #101d2b; padding: 6px 10px; text-align: left; }
.format-options button.chosen { background: #2b4c63; color: #90f0d0; }
.format-input { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 3px; }
.format-input input { width: 0; min-width: 90px; flex: 1; padding: 6px; border: 1px solid #75e2bc; border-radius: 4px; background: #0d1926; outline: none; caret-color: #75e2bc; }
.format-input input.replacing { color: #90f0d0; }
.format-input button { background: #223a50; border: 1px solid #3a526a; border-radius: 4px; }
.format-input small { flex-basis: 100%; color: #97b5d0; }
.preview-note { margin: 10px 0; font-size: 11px; }
.format-note { font-size: 11px; margin: 6px 0; }
.format-warning { color: #f4cd8a; font-size: 11px; overflow-wrap: anywhere; }
footer { display: flex; justify-content: space-between; border-top: 1px solid #2c4157; padding-top: 12px; margin-top: 14px; }
footer button { display: flex; align-items: center; gap: 7px; border: 0; background: none; color: #b3cfe6; padding: 3px; }
button:hover { color: #90f0d0; }
button:focus-visible { outline: 2px solid #75e2bc; outline-offset: 2px; }
@media (max-width: 480px) { .format-panel { padding: 10px; } .format-badge { gap: 5px; } .setting-label { flex-basis: 39%; } }
</style>
