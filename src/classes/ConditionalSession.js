import { shallowReactive } from 'vue';
import VimKeyboard from './VimKeyboard.js';
import { cellLabel } from './FormulaFunctions.js';
import { compileConditionalRule } from './ConditionalFormatting.js';

// One window's unapplied text buffer. Its Vim edits/undo never touch cells or workbook history.
export default class ConditionalSession {
	constructor(manager, pane, hooks) {
		this.manager = manager; this.pane = pane;
		this.state = shallowReactive({ editing: false, selectedId: null, id: null, draft: '', base: '', error: '' });
		const state = this.state;
		const buffer = { selRow: 0, selCol: 0, get rows() { return [[state.draft]]; },
			get marks() { return manager.marks; }, describeDataset: name => manager.describeDataset(name) };
		this.editor = new VimKeyboard(buffer, {
			...hooks,
			change: () => this.checkpoint(),
			undo: (redo, count) => {
				this.checkpoint();
				this.position = Math.max(0, Math.min(this.edits.length - 1, this.position + (redo ? count : -count)));
				state.draft = this.edits[this.position];
				this.editor.move(this.editor.point);
			},
		});
		this.editor.textBuffer = true;
		this.editor.setFormula = text => { state.draft = text; state.error = ''; };
	}
	get rules() { return this.pane.sheet.conditionalRules ?? []; }
	get selected() { return this.rules.find(rule => rule.id === this.state.selectedId) ?? this.rules[0]; }
	get dirty() { return this.state.editing && (this.state.id === null || this.state.draft !== this.state.base); }
	guard() { if (this.dirty) throw new Error('Unapplied rule draft; apply it with Enter or use :cf discard'); }
	select(delta) {
		const index = Math.max(0, this.rules.findIndex(rule => rule.id === this.selected?.id));
		this.state.selectedId = this.rules[Math.max(0, Math.min(this.rules.length - 1, index + delta))]?.id ?? null;
	}
	begin(id = null, range = null) {
		this.guard();
		const rule = id === null ? null : this.rules.find(rule => rule.id === id);
		if (id !== null && !rule) throw new Error(`Unknown rule: ${id}`);
		this.owner = this.pane.sheet;
		this.state.id = id; this.state.selectedId = id; this.state.base = rule?.source ?? '';
		this.state.draft = rule?.source ?? `=CF()\n  .range(${cellLabel(range.r0, range.c0)}:${cellLabel(range.r1, range.c1)})\n  .when(AND(isNumeric([]{}), []{}>0))\n  .bg("#40381c")`;
		this.state.editing = true; this.state.error = '';
		this.edits = [this.state.draft]; this.position = 0;
		this.editor.resetNavigation(); this.editor.context = 'formula';
		this.editor.formulaCursor = 0;
	}
	checkpoint() {
		if (this.edits[this.position] === this.state.draft) return;
		this.edits = [...this.edits.slice(0, this.position + 1), this.state.draft]; this.position++;
	}
	apply() {
		if (!this.state.editing) throw new Error('Open a rule draft first');
		if (this.owner !== this.pane.sheet) throw new Error('The sheet was replaced while this draft was open; copy the draft, then discard it and reopen the rule');
		compileConditionalRule(this.state.draft);
		const existing = this.rules.find(rule => rule.id === this.state.id);
		if (this.state.id !== null && existing?.source !== this.state.base) throw new Error('This rule changed or was removed in another view; copy the draft, then discard it and reopen the rule');
		const id = this.state.id ?? Math.max(0, ...this.rules.map(rule => rule.id)) + 1;
		const next = { id, source: this.state.draft };
		const rules = this.state.id === null ? [...this.rules, next] : this.rules.map(rule => rule.id === id ? next : rule);
		this.manager.setConditionalRules(rules);
		this.state.selectedId = id; this.discard();
	}
	discard() { this.state.editing = false; this.state.draft = ''; this.state.error = ''; }
	remove(id = this.selected?.id) {
		this.guard();
		if (!this.rules.some(rule => rule.id === id)) throw new Error('Select a rule first');
		this.manager.setConditionalRules(this.rules.filter(rule => rule.id !== id));
		this.state.selectedId = this.selected?.id ?? null;
		if (this.state.editing && this.state.id === id) this.discard();
	}
	reorder(delta) {
		this.guard();
		const rules = [...this.rules], from = rules.findIndex(rule => rule.id === this.selected?.id), to = from + delta;
		if (from < 0 || to < 0 || to >= rules.length) return;
		this.state.selectedId = rules[from].id;
		[rules[from], rules[to]] = [rules[to], rules[from]];
		this.manager.setConditionalRules(rules);
	}
}
