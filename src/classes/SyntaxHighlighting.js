import { quotedEnd } from './FormulaEditing.js';

export default class SyntaxHighlighting {
	highlight(form, references = []) {
		if (!form.startsWith('=')) return this.preventHtmlInjection(form);
		const spans = new Map(references.map(ref => [ref.start, ref]));
		const depths = { '(': 0, '[': 0, '{': 0 }, closes = { ')': '(', ']': '[', '}': '{' };
		let html = '';
		for (let i = 0; i < form.length;) {
			const ref = spans.get(i), char = form[i];
			if (ref) {
				html += `<span class="formula-reference" style="color:${ref.color}">${this.preventHtmlInjection(form.slice(i, ref.end))}</span>`;
				i = ref.end;
			} else if (char === '"' || char === "'") {
				const end = quotedEnd(form, i);
				html += `<span class="formula-string">${this.preventHtmlInjection(form.slice(i, end))}</span>`;
				i = end;
			} else {
				const name = form.slice(i).match(/^[A-Za-z_]+(?=\s*\()/)?.[0];
				if (name) { html += `<span class="function">${name}</span>`; i += name.length; continue; }
				const escaped = this.preventHtmlInjection(char);
				if (Object.hasOwn(depths, char)) html += `<span class="depth${(++depths[char] - 1) % 6 + 1}">${escaped}</span>`;
				else if (closes[char]) {
					const open = closes[char], depth = Math.max(1, depths[open]--);
					html += `<span class="depth${(depth - 1) % 6 + 1}">${escaped}</span>`;
				} else html += '=+-*/^<>!'.includes(char) ? `<span class="operator">${escaped}</span>` : escaped;
				i++;
			}
		}
		return html;
	}

	preventHtmlInjection(form) {
		return form.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
	}
}
