import { cellLabel } from './FormulaFunctions.js';
import { formatDefaults, formatFields, formatSpec, summarizeFormats, formatTypeLabel, formatTypes, withFormat } from './CellFormatting.js';

// One keyboard-owned presentation draft. Only finish() publishes metadata/history; no raw writes.
export default class FormatSession {
	constructor(sheet, range) {
		this.sheet = sheet; this.target = sheet.activeSheet; this.range = range;
		this.original = new Map();
		for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) this.original.set(`${r}:${c}`, { ...sheet.styles[r][c] });
		this.draft = new Map(this.original); this.index = 0; this.menu = null; this.input = null; this.error = '';
		this.preview();
	}
	get scope() { const b = this.range; return `${cellLabel(b.r0, b.c0)}${b.r0 !== b.r1 || b.c0 !== b.c1 ? `:${cellLabel(b.r1, b.c1)}` : ''}`; }
	spec(style) { try { return formatSpec(style); } catch { return { ...formatDefaults }; } }
	common(key) { const values = [...this.draft.values()].map(style => this.spec(style)[key]); return values.every(value => value === values[0]) ? values[0] : null; }
	get summary() { return summarizeFormats(this.draft.values()); }
	get rows() {
		const row = (key, label, action, options) => ({ key, label, action, value: this.common(key), options });
		const rows = [row('formatKind', 'Type', 'Type', formatTypes.map(value => ({ value, label: formatTypeLabel(value) })))];
		const kind = this.common('formatKind');
		if (kind === 'number') rows.push(row('formatPercent', 'Percent', 'Percent'));
		if (kind === 'currency') rows.push(row('formatCurrency', 'Currency', 'Currency'));
		if (['number', 'currency'].includes(kind)) rows.push(row('formatDigits', 'Decimal places', 'Digits'), row('formatGroup', 'Thousands separator', 'Group'));
		if (kind === 'date') rows.push(row('formatPreset', 'Date style', 'Digits', [
			{ value: 'iso', label: '2026-10-20' }, { value: 'short', label: '20/10/2026' }, { value: 'long', label: '20 Oct 2026' },
		]), row('formatIncludeTime', 'Include time', 'Time'));
		if (kind === 'time' || (kind === 'date' && this.common('formatIncludeTime') !== false)) rows.push(row('formatSeconds', 'Seconds', 'Seconds'), row('formatTimeZone', 'Timezone', 'Zone'));
		return rows;
	}
	label(row) { return row.value === null ? 'Mixed' : row.options?.find(option => option.value === row.value)?.label ?? (typeof row.value === 'boolean' ? row.value ? 'On' : 'Off' : String(row.value)); }
	preview() { this.sheet.formatPreview = { sheet: this.target, styles: this.draft }; this.sheet.refreshPresentation(this.target, this.range); }
	set(key, value) {
		this.draft = new Map([...this.draft].map(([position, style]) => {
			const spec = key === 'formatKind' ? { ...formatDefaults, formatKind: value, formatGroup: value === 'currency' } : { ...this.spec(style), [key]: value };
			return [position, withFormat(style, spec)];
		}));
		this.error = ''; this.preview();
	}
	activate(row) {
		if (!row) return;
		this.index = this.rows.findIndex(item => item.key === row.key); this.error = '';
		if (row.options) this.menu = { key: row.key, options: row.options, index: Math.max(0, row.options.findIndex(option => option.value === row.value)) };
		else if (['formatPercent', 'formatGroup', 'formatIncludeTime', 'formatSeconds'].includes(row.key)) this.set(row.key, row.value !== true);
		else this.input = { key: row.key, text: row.value === null ? '' : String(row.value), replace: true };
	}
	select() {
		if (this.menu) { const { key, options, index } = this.menu; this.menu = null; this.set(key, options[index].value); this.index = 0; }
		else if (this.input) {
			const { key, text } = this.input;
			try {
				let value = text;
				if (key === 'formatDigits') { if (!/^\d+$/.test(text) || Number(text) > 64) throw new Error('Enter a decimal count from 0 to 64'); value = Number(text); }
				if (key === 'formatCurrency') { value = text.toUpperCase(); if (!/^[A-Z]{3}$/.test(value)) throw new Error('Enter a three-letter currency code, such as NZD'); }
				if (key === 'formatTimeZone') { new Intl.DateTimeFormat('en-NZ', { timeZone: value }); }
				this.set(key, value); this.input = null;
			} catch (error) { this.error = error.message; }
		} else this.activate(this.rows[this.index]);
	}
	action(action) {
		if (action === 'Select') return this.select();
		if (action === 'Revert') { this.draft = new Map(this.original); this.menu = null; this.input = null; this.index = 0; this.error = ''; return this.preview(); }
		if (action === 'Backspace' && this.input) { this.input.text = this.input.replace ? '' : this.input.text.slice(0, -1); this.input.replace = false; return; }
		if (action === 'Next' || action === 'Previous') {
			if (this.input) return;
			const target = this.menu ?? this, max = this.menu ? this.menu.options.length : this.rows.length;
			target.index = Math.max(0, Math.min(max - 1, target.index + (action === 'Next' ? 1 : -1))); return;
		}
		if (this.menu || this.input) return;
		if (action === 'Increase' || action === 'Decrease') {
			if (!['number', 'currency'].includes(this.common('formatKind'))) return;
			const digits = this.common('formatDigits');
			if (digits === null) { this.error = 'Set an explicit decimal count first'; return; }
			return this.set('formatDigits', Math.max(0, Math.min(64, digits + (action === 'Increase' ? 1 : -1))));
		}
		this.activate(this.rows.find(row => row.action === action || (action === 'DateStyle' && row.key === 'formatPreset')));
	}
	text(key) { if (this.input && Array.from(key).length === 1 && this.input.text.length < 128) { this.input.text = (this.input.replace ? '' : this.input.text) + key; this.input.replace = false; this.error = ''; } }
	finish() {
		if (this.sheet.activeSheet !== this.target) throw new Error('The formatting target changed');
		const changes = [...this.draft].filter(([key, style]) => {
			const original = this.original.get(key);
			if (JSON.stringify(style) === JSON.stringify(original)) return false;
			try { return JSON.stringify(formatFields(formatSpec(style))) !== JSON.stringify(formatFields(formatSpec(original))); }
			catch { return true; } // Explicitly replacing unsupported settings is still a change.
		});
		for (const [key, style] of changes) { const [r, c] = key.split(':').map(Number); this.target.styles[r][c] = style; }
		this.sheet.formatPreview = null; this.sheet.refreshPresentation(this.target, this.range);
		return changes.length > 0;
	}
}
