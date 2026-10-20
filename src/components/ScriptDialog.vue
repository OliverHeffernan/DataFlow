<template>
	<dialog ref="dialog" class="script-dialog" aria-labelledby="script-title" @cancel.prevent="commands.cancelScript()">
		<template v-if="state">
			<header><h2 id="script-title">Run workbook Lua</h2><span>Explicit run · local file</span></header>
			<p class="script-context">{{ state.context.sheetName }} · {{ address(state.context.selection) }} captured at invocation</p>
			<p class="script-warning">Run only scripts you trust. No file, network or shell access. Changes publish together or not at all. Lua and formulas can still exhaust memory; this is not a hostile-code sandbox.</p>
			<label v-if="!state.running && !state.complete" class="script-file">Choose .lua file
				<input type="file" accept=".lua" @change="commands.importScript($event.target.files[0])" />
			</label>
			<div v-if="state.name" class="script-source"><strong>{{ state.name }}</strong><pre tabindex="0" aria-label="Lua source preview">{{ state.source }}</pre></div>
			<p v-if="state.running" role="status">Running in a worker… Escape or Cancel discards the draft. Final validation may briefly block input.</p>
			<p v-if="state.error" class="script-error" role="alert">{{ state.error }}</p>
			<div v-if="state.complete" class="script-result" role="status"><strong>{{ state.message }}</strong><pre v-if="state.logs.length">{{ state.logs.join('\n') }}</pre></div>
			<footer>
				<button autofocus @click="commands.cancelScript()">{{ state.complete ? 'Close' : 'Cancel' }}</button>
				<button v-if="!state.complete" class="script-run" :disabled="!state.name || state.running" @click="commands.runScript()">{{ state.running ? 'Running…' : 'Run script' }}</button>
			</footer>
		</template>
	</dialog>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import CheckCommand from '../classes/CheckCommand.js';
import { cellLabel } from '../classes/FormulaFunctions.js';
const commands = new CheckCommand(), state = commands.script, dialog = ref(null);
const address = range => `${cellLabel(range.r0, range.c0)}:${cellLabel(range.r1, range.c1)}`;
watch(state, async value => {
	await nextTick();
	if (value && !dialog.value.open) dialog.value.showModal();
	else if (!value && dialog.value.open) dialog.value.close();
});
</script>

<style scoped>
.script-dialog { box-sizing: border-box; width: min(780px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 22px; border: 1px solid #395269; border-radius: 8px; color: #dbe6f3; background: #111d2a; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.script-dialog::backdrop { background: #030911b8; }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
h2 { margin: 0; color: #75e2bc; font-size: 18px; }
header span, .script-context { color: #9aaec3; }
.script-warning { padding: 12px; border-left: 3px solid #c6a56b; background: #252a2e; }
.script-file { display: block; margin: 16px 0; }
input { display: block; max-width: 100%; margin-top: 8px; color: inherit; }
.script-source { margin: 16px 0; overflow-wrap: anywhere; }
pre { max-height: 28vh; overflow: auto; padding: 12px; border: 1px solid #2a3d51; background: #091119; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
.script-error { color: #ffb5a2; overflow-wrap: anywhere; }
.script-result { color: #75e2bc; }
footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 18px; }
button { padding: 8px 14px; border: 1px solid #395269; border-radius: 4px; color: #dbe6f3; background: #1b2d3f; font: inherit; cursor: pointer; }
.script-run { color: #091119; background: #75e2bc; }
button:disabled { opacity: .45; cursor: default; }
:focus-visible { outline: 2px solid #9fd6ff; outline-offset: 3px; }
@media (max-width: 480px) { .script-dialog { padding: 16px; } header span { display: none; } }
</style>
