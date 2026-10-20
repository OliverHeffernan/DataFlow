<template>
	<div v-if="state.dialog" class="recovery-shade">
		<section ref="panel" class="recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title" tabindex="-1" @keydown="keydown">
			<template v-if="state.dialog.kind === 'list'">
				<h1 id="recovery-title">Recovery copies</h1>
				<p>Restore an unsaved copy. Original files are never changed.</p>
				<ol v-if="state.entries.length" role="listbox" aria-label="Recovery copies" :aria-activedescendant="`recovery-${selected}`" tabindex="0">
					<li v-for="(entry, index) in state.entries" :id="`recovery-${index}`" :key="entry.id" role="option" :aria-selected="selected === index" @click="selected = index">
						<strong>{{ index + 1 }} · {{ entry.record?.name || 'Unreadable recovery copy' }}</strong>
						<span>{{ entry.record ? new Date(entry.record.updatedAt).toLocaleString() : entry.id }}<template v-if="entry.record"> · {{ entry.record.workbook.sheets?.length || 1 }} sheets</template></span>
						<span>{{ entry.record?.sourcePath || 'Untitled / browser workbook' }}</span>
						<span v-if="entry.active">In use or ownership unavailable — restore as a copy only</span>
						<span v-if="entry.error" class="recovery-error">{{ entry.error }} · Using the newest readable checkpoint, if available.</span>
					</li>
				</ol>
				<p v-else>No recovery copies. Unsaved work will appear here after a checkpoint.</p>
				<div class="recovery-actions">
					<button :disabled="!state.entries[selected]?.record" @click="run(() => manager.restore(selected))">Restore copy</button>
					<button :disabled="!state.entries[selected] || state.entries[selected].active" @click="run(() => manager.discard(selected))">Discard copy…</button>
					<button @click="dismiss">Later</button>
				</div>
				<p class="recovery-help"><kbd>j/k</kbd> select · <kbd>Enter</kbd> restore · <kbd>d</kbd> discard · <kbd>Esc</kbd> later<br />Local copies only, not backups. Browser storage may be cleared or unavailable.</p>
			</template>
			<template v-else-if="state.dialog.kind === 'leave'">
				<h1 id="recovery-title">Unsaved workbook</h1>
				<p>Before you {{ state.dialog.reason }}, choose what to do with <strong>{{ state.name }}</strong>.</p>
				<p>Keep recovery stores a local copy without saving over the original file.</p>
				<div class="recovery-actions">
					<button @click="manager.answer('save')">{{ native ? 'Save' : 'Download & keep recovery' }}</button>
					<button @click="manager.answer('keep')">Keep recovery</button>
					<button @click="manager.answer('discard')">Discard changes</button>
					<button data-cancel @click="dismiss">Cancel</button>
				</div>
			</template>
			<template v-else>
				<h1 id="recovery-title">Discard recovery copy?</h1>
				<p>Delete the recovery checkpoints for <strong>{{ state.dialog.name }}</strong>? This cannot be undone. The original file will not be changed.</p>
				<div class="recovery-actions">
					<button @click="manager.answer('discard')">Discard recovery copy</button>
					<button data-cancel @click="dismiss">Cancel</button>
				</div>
			</template>
			<p v-if="state.error" class="recovery-error" role="alert">{{ state.error }}</p>
		</section>
	</div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
const props = defineProps({ manager: { type: Object, required: true } });
const manager = props.manager, state = manager.state, native = isTauri();
const panel = ref(), selected = ref(0);
watch(() => state.dialog, async dialog => {
	await nextTick();
	if (dialog) {
		selected.value = Math.min(selected.value, Math.max(0, state.entries.length - 1));
		(panel.value?.querySelector('[data-cancel]') || panel.value)?.focus();
	} else manager.focus?.();
});
function dismiss() { manager.answer('cancel'); }
async function run(action) {
	try { await action(); }
	catch (error) { state.error = error.message || String(error); }
}
function keydown(event) {
	if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
	if (event.key === 'Tab') {
		const controls = [...panel.value.querySelectorAll('button:not(:disabled), [role="listbox"]')];
		const at = controls.indexOf(document.activeElement);
		event.preventDefault();
		controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
		return;
	}
	if (state.dialog.kind !== 'list') return;
	if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
		event.preventDefault();
		selected.value = Math.max(0, Math.min(state.entries.length - 1, selected.value + (['j', 'ArrowDown'].includes(event.key) ? 1 : -1)));
		panel.value.querySelector(`#recovery-${selected.value}`)?.scrollIntoView({ block: 'nearest' });
	} else if (event.key === 'd') { event.preventDefault(); run(() => manager.discard(selected.value)); }
	else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') { event.preventDefault(); run(() => manager.restore(selected.value)); }
}
</script>

<style scoped>
.recovery-shade { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px; background: #060d15d9; }
.recovery-panel { box-sizing: border-box; width: min(650px, 100%); max-height: 85vh; overflow: auto; padding: 24px; border: 1px solid #45617b; background: #111d2a; color: #dbe6f3; box-shadow: 0 12px 60px #0009; font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
h1 { margin: 0 0 12px; font: inherit; font-size: 20px; color: #75e2bc; }
p { margin: 12px 0; }
ol { list-style: none; padding: 0; margin: 20px 0; max-height: 38vh; overflow: auto; }
li { padding: 12px; border: 1px solid transparent; cursor: pointer; overflow-wrap: anywhere; }
li[aria-selected="true"] { background: #192f42; border-color: #75e2bc; }
li span { display: block; color: #a8bed2; font-size: 12px; }
.recovery-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
button { font: inherit; padding: 7px 12px; background: #20384d; color: #dbe6f3; border: 1px solid #52718c; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button:focus, ol:focus { outline: 2px solid #75e2bc; outline-offset: 3px; }
.recovery-help { color: #a8bed2; font-size: 12px; }
.recovery-error, li .recovery-error { color: #ffb5a2; overflow-wrap: anywhere; }
</style>
