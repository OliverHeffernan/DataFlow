<template>
	<div class="conditional-pane" :class="{ 'editing-rule': session.state.editing }" ref="panel">
		<template v-if="!session.state.editing">
			<div class="cf-toolbar"><div><h2>Rules</h2><span>{{ items.length }} {{ items.length === 1 ? 'rule' : 'rules' }} · Later rules win per colour</span></div></div>
			<p v-if="!items.length" class="cf-empty">No rules on this sheet. Create a rule from your selection, then describe its condition with the formula builder.</p>
			<ol class="cf-rules" aria-label="Conditional formatting rules">
				<li v-for="item in items" :key="item.id" class="cf-rule" :data-rule-id="item.id" :class="{ chosen: item.id === session.selected?.id }" :aria-current="item.id === session.selected?.id ? 'true' : undefined">
					<div class="cf-rule-content">
						<span class="cf-swatch" :style="{ color: item.colors.fg ?? '#dbe6f3', backgroundColor: item.colors.bg ?? '#091119' }">Aa</span>
						<span class="cf-summary"><strong>{{ item.name || `Rule ${item.id}` }} <small>#{{ item.id }}</small></strong><span class="cf-range">{{ item.target }} <span>· {{ result?.ruleMatches.get(item.id) ?? 0 }} matched</span></span><code>{{ item.predicate }}</code></span>
					</div>
					<div v-if="result?.ruleErrors.has(item.id)" class="cf-diagnostic" role="status">{{ result.ruleErrors.get(item.id).count }} predicate error(s) · {{ result.ruleErrors.get(item.id).message }}</div>
				</li>
			</ol>
		</template>
		<section v-else class="cf-builder" aria-label="Conditional rule builder">
			<div class="cf-builder-heading"><strong>{{ session.state.id === null ? 'New rule' : `Edit rule #${session.state.id}` }}</strong><span class="cf-draft-badge">Unapplied draft</span></div>
			<NewFormBar v-if="active" keyboard-only />
			<pre v-else class="cf-inactive-draft">{{ session.state.draft }}</pre>
			<div class="cf-diagnostic" role="status" v-if="session.state.error || validation">{{ session.state.error || validation }}</div>
		</section>
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
watch(() => session.state.selectedId, async () => { await nextTick(); panel.value?.querySelector('.chosen')?.scrollIntoView({ block: 'nearest' }); });
watch(() => [session.state.editing, props.active], async ([editing, active]) => {
	if (editing && active) { await nextTick(); panel.value?.querySelector('.cf-builder')?.scrollIntoView({ block: 'nearest' }); }
});
</script>

<style>
.conditional-pane { color: #dbe6f3; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; flex: 1; min-height: 0; overflow: auto; padding: 18px; }
.conditional-pane.editing-rule { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.cf-toolbar { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.cf-toolbar h2 { font: 500 18px/1.5 ui-monospace, monospace; margin: 0 0 2px; }
.cf-toolbar span, .cf-empty { color: #9aaec3; }
.cf-empty { padding: 18px; border: 1px dashed #334a62; }
.cf-rules { list-style: none; padding: 0; margin: 0 0 18px; display: grid; gap: 10px; }
.cf-rule { border: 1px solid #26394c; border-radius: 4px; background: #111d2a; overflow: hidden; }
.cf-rule.chosen { border-color: #75e2bc; }
.cf-rule-content { display: flex; gap: 12px; padding: 12px; }
.cf-summary { display: grid; gap: 3px; min-width: 0; }
.cf-summary strong { font-weight: 500; }
.cf-summary small { color: #688294; font-size: 10px; }
.cf-summary code { color: #b9c9d8; overflow-wrap: anywhere; white-space: pre-wrap; }
.cf-range { color: #9fd6ff; font-size: 11px; }
.cf-range span { color: #9aaec3; }
.cf-swatch { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 4px; border: 1px solid #334a62; flex-shrink: 0; font-size: 14px; }
.cf-builder { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #111d2a; }
.cf-builder-heading { display: flex; flex-wrap: wrap; flex-shrink: 0; gap: 8px; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #26394c; }
.cf-builder-heading strong { font-weight: 500; }
.cf-draft-badge { color: #f4d779; font-size: 10px; }
.cf-builder .formula-editor { display: flex; flex-direction: column; min-height: 0; padding: 8px 12px; }
.cf-builder #newFormBar { min-height: 0; max-height: none; background: #111d2a; font-size: 13px; }
.cf-builder #formText { background: #111d2a; }
.cf-builder .formula-completions { top: auto; bottom: 12px; left: 12px; z-index: 310; width: min(400px, calc(100% - 24px)); max-height: 50%; overflow: auto; }
.cf-builder .formula-signature { padding-left: 0; }
.cf-inactive-draft { flex: 1; min-height: 0; overflow: auto; white-space: pre; margin: 0; padding: 12px; font: inherit; }
.cf-diagnostic { color: #ffb5a2; padding: 4px 12px 10px; overflow-wrap: anywhere; }
</style>
