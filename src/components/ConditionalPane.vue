<template>
	<div class="conditional-pane" ref="panel">
		<div class="cf-toolbar"><div><h2>Rules</h2><span>{{ items.length }} {{ items.length === 1 ? 'rule' : 'rules' }} · Later rules win per colour</span></div><button @click="act('new')">+ New rule <kbd>a</kbd></button></div>
		<p v-if="!items.length" class="cf-empty">No rules on this sheet. Create a rule from your selection, then describe its condition with the formula builder.</p>
		<ol class="cf-rules" aria-label="Conditional formatting rules">
			<li v-for="item in items" :key="item.id" class="cf-rule" :data-rule-id="item.id" :class="{ chosen: item.id === session.selected?.id }">
				<button class="cf-rule-select" @click="choose(item.id)" @dblclick="act('edit', item.id)" :aria-pressed="item.id === session.selected?.id">
					<span class="cf-swatch" :style="{ color: item.colors.fg ?? '#dbe6f3', backgroundColor: item.colors.bg ?? '#091119' }">Aa</span>
					<span class="cf-summary"><strong>{{ item.name || `Rule ${item.id}` }} <small>#{{ item.id }}</small></strong><span class="cf-range">{{ item.target }} <span>· {{ result?.ruleMatches.get(item.id) ?? 0 }} matched</span></span><code>{{ item.predicate }}</code></span>
				</button>
				<div v-if="result?.ruleErrors.has(item.id)" class="cf-diagnostic" role="status">{{ result.ruleErrors.get(item.id).count }} predicate error(s) · {{ result.ruleErrors.get(item.id).message }}</div>
				<div v-if="item.id === session.selected?.id && !session.state.editing" class="cf-rule-actions"><button @click="act('edit', item.id)">Edit <kbd>Enter</kbd></button><button @click="act('up')" :disabled="items[0].id === item.id">Earlier <kbd>K</kbd></button><button @click="act('down')" :disabled="items.at(-1).id === item.id">Later <kbd>J</kbd></button><button @click="act('delete', item.id)">Delete <kbd>x</kbd></button></div>
			</li>
		</ol>
		<section v-if="session.state.editing" class="cf-builder" aria-label="Conditional rule builder">
			<div class="cf-builder-heading"><strong>{{ session.state.id === null ? 'New rule' : `Edit rule #${session.state.id}` }}</strong><span class="cf-draft-badge">Unapplied draft</span></div>
			<NewFormBar v-if="active" />
			<pre v-else class="cf-inactive-draft">{{ session.state.draft }}</pre>
			<div class="cf-diagnostic" role="status" v-if="session.state.error || validation">{{ session.state.error || validation }}</div>
			<p class="cf-editor-help"><kbd>i</kbd> insert · <kbd>Esc</kbd> text NORMAL · <kbd>Enter</kbd> apply · <kbd>Shift Enter</kbd> newline · <kbd>Tab</kbd> complete<br>Drafts stay in this window until applied or discarded.</p>
			<div class="cf-builder-actions"><button class="cf-primary" @click="act('apply')">Apply rule <kbd>Enter</kbd></button><button @click="act('discard')">Discard draft</button></div>
		</section>
		<section class="cf-reference" aria-label="Rule reference"><h3>One condition per target cell</h3><p><code>[]{} </code>this cell · <code>C{}</code> column C, this row · <code>A0</code> fixed cell</p><p>Use underlying values, before display formatting. Guard numeric thresholds with <code>isNumeric([]{})</code>. Failed predicates add no colour; chart targets are skipped.</p><p><code>=CF().range(A0:D9)<br> .when(C{}="Overdue").bg("#40381c")</code></p><p>Colours override direct <code>:hi</code> colours only while a rule matches. Rules never change wrapping, alignment, size or values.</p></section>
	</div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import CheckCommand from '../classes/CheckCommand.js';
import SheetManager from '../classes/SheetManager.js';
import { compileConditionalRule } from '../classes/ConditionalFormatting.js';
import { cellLabel } from '../classes/FormulaFunctions.js';
import NewFormBar from './NewFormBar.vue';
const props = defineProps({ pane: { type: Object, required: true }, active: Boolean });
const check = new CheckCommand(), manager = new SheetManager(), session = check.rulesFor(props.pane), panel = ref(null);
const result = computed(() => manager.sheetResults.value.get(props.pane.sheet));
const items = computed(() => {
	manager.sheetResults.value;
	return session.rules.map(item => {
		try {
			const rule = compileConditionalRule(item.source), { r0, c0, r1, c1 } = rule.range;
			return { ...item, ...rule, target: `${cellLabel(r0, c0)}:${cellLabel(r1, c1)}` };
		} catch (error) { return { ...item, colors: {}, name: 'Invalid rule', target: '', predicate: error.message }; }
	});
});
const validation = computed(() => {
	if (!session.state.editing) return '';
	try { compileConditionalRule(session.state.draft); return ''; } catch (error) { return error.explanation ?? error.message; }
});
async function act(action, id) { await check.activateWindow(props.pane.id); await check.cfCommand(action, id); }
async function choose(id) { await check.activateWindow(props.pane.id); session.state.selectedId = id; await check.render(); }
watch(() => session.state.selectedId, async () => { await nextTick(); panel.value?.querySelector('.chosen')?.scrollIntoView({ block: 'nearest' }); });
watch(() => [session.state.editing, props.active], async ([editing, active]) => {
	if (editing && active) { await nextTick(); panel.value?.querySelector('.cf-builder')?.scrollIntoView({ block: 'nearest' }); }
});
</script>

<style>
.conditional-pane { color: #dbe6f3; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; flex: 1; min-height: 0; overflow: auto; padding: 18px; }
.conditional-pane button { font: inherit; color: #dbe6f3; background: #192c3a; border: 1px solid #334a62; padding: 5px 9px; cursor: pointer; border-radius: 3px; }
.conditional-pane button:hover, .conditional-pane button:focus-visible { border-color: #75e2bc; outline: none; }
.conditional-pane button:disabled { opacity: .4; cursor: default; }
.conditional-pane button kbd { color: #9aaec3; margin-left: 6px; font-size: 10px; }
.cf-toolbar { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.cf-toolbar h2 { font: 500 18px/1.5 ui-monospace, monospace; margin: 0 0 2px; }
.cf-toolbar span, .cf-empty, .cf-editor-help { color: #9aaec3; }
.cf-empty { padding: 18px; border: 1px dashed #334a62; }
.cf-rules { list-style: none; padding: 0; margin: 0 0 18px; display: grid; gap: 10px; }
.cf-rule { border: 1px solid #26394c; border-radius: 4px; background: #111d2a; overflow: hidden; }
.cf-rule.chosen { border-color: #75e2bc; }
.conditional-pane .cf-rule-select { display: flex; gap: 12px; padding: 12px; text-align: left; width: 100%; border: 0; background: none; }
.cf-summary { display: grid; gap: 3px; min-width: 0; }
.cf-summary strong { font-weight: 500; }
.cf-summary small { color: #688294; font-size: 10px; }
.cf-summary code { color: #b9c9d8; overflow-wrap: anywhere; white-space: pre-wrap; }
.cf-range { color: #9fd6ff; font-size: 11px; }
.cf-range span { color: #9aaec3; }
.cf-swatch { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 4px; border: 1px solid #334a62; flex-shrink: 0; font-size: 14px; }
.cf-rule-actions, .cf-builder-actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 12px 12px; }
.cf-rule-actions button { font-size: 11px; }
.cf-builder { border: 1px solid #334a62; background: #111d2a; margin: 0 0 20px; border-radius: 4px; }
.cf-builder-heading { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #26394c; }
.cf-builder-heading strong { font-weight: 500; }
.cf-draft-badge { color: #f4d779; font-size: 10px; }
.cf-builder .formula-editor { padding: 8px 12px; }
.cf-builder #newFormBar { min-height: 140px; max-height: 40vh; background: #111d2a; font-size: 13px; }
.cf-builder #formText { background: #111d2a; }
.cf-builder .formula-completions { z-index: 310; width: min(400px, 90%); }
.cf-builder .formula-signature { padding-left: 0; }
.cf-editor-help { padding: 0 12px; font-size: 10px; }
.cf-inactive-draft { overflow: auto; white-space: pre; margin: 0; padding: 12px; font: inherit; }
.cf-diagnostic { color: #ffb5a2; padding: 4px 12px 10px; overflow-wrap: anywhere; }
.conditional-pane .cf-primary { background: #20483e; border-color: #518d76; color: #b8f5d8; }
.cf-reference { color: #9aaec3; border-top: 1px solid #26394c; margin-top: 24px; padding-top: 14px; font-size: 11px; }
.cf-reference h3 { font-size: 11px; font-weight: 500; color: #dbe6f3; margin: 0; }
.cf-reference code { color: #bdcedd; font: inherit; }
</style>
