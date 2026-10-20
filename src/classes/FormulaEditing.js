import { cellLabel, cellToValue, normaliseFormula, referenceSpans } from './FormulaFunctions.js';

export const referenceColors = ['#73c9ff', '#ffa182', '#d7b5ff', '#75e2bc', '#f4d779', '#ff9bc5'];
export const functionHelp = {
	IF: ['condition', 'whenTrue', '[whenFalse]'],
	IFERROR: ['value', 'fallback'],
	FILTER: ['array', 'include', '[ifEmpty]'],
	VSTACK: ['array', '…'], HSTACK: ['array', '…'],
	SORT: ['array', '[columnIndex = 0]', '[sortOrder = 1]'], UNIQUE: ['array'],
	AND: ['condition', '…'], OR: ['condition', '…'], NOT: ['condition'],
	SUM: ['values', '…'], AVG: ['values', '…'], MEAN: ['values', '…'], COUNT: ['values', '…'],
	SUMIF: ['conditionRange', 'criteria', '[valueRange]'],
	COUNTIF: ['conditionRange', 'criteria'], AVGIF: ['conditionRange', 'criteria', '[valueRange]'],
	round: ['value', '[decimals]'], sqrt: ['value'], abs: ['value'], min: ['values', '…'], max: ['values', '…'],
	sin: ['angle'], cos: ['angle'], tan: ['angle'], CHART: [],
};

export function quotedEnd(text, at) {
	const quote = text[at];
	for (let i = at + 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (text[i] === quote) return i + 1;
	}
	return text.length;
}

// Source spans stay in UTF-16 for slicing/HTML; the keyboard caret uses code points.
// Resolve the same notation as evaluation, rather than guessing at []{} calculations.
export function formulaReferences(text, row, col, sheet) {
	if (!text.startsWith('=')) return [];
	const refs = [], colors = new Map();
	for (const { start, end, source } of referenceSpans(text)) {
		let region = null;
		try {
			const resolved = normaliseFormula(source, row, col, {
				ref: (r, c) => cellToValue(sheet.getElementValue(r, c)),
				range: () => { throw new Error('A reference coordinate must be scalar'); },
			});
			const match = resolved.match(/^(?:RANGE__)?([A-Z]+)(\d+)(?:__([A-Z]+)(\d+))?$/);
			if (match) {
				const column = letters => [...letters].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
				const r0 = Number(match[2]), c0 = column(match[1]), r1 = Number(match[4] ?? match[2]), c1 = column(match[3] ?? match[1]);
				if (Math.max(r0, r1) < sheet.rows.length && Math.max(c0, c1) < sheet.rows[0].length) {
					region = { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
				}
			}
		} catch { /* Incomplete or invalid references stay colored, without a misleading grid highlight. */ }
		const key = region ? JSON.stringify(region) : source;
		if (!colors.has(key)) colors.set(key, referenceColors[colors.size % referenceColors.length]);
		refs.push({ start, end, source, region, color: colors.get(key) });
	}
	return refs;
}

export function relativeReference(row, col, originRow, originCol) {
	const part = value => value ? `${value > 0 ? '+' : ''}${value}` : '';
	return `[${part(col - originCol)}]{${part(row - originRow)}}`;
}

export function toggleReference(keyboard) {
	const { sheet } = keyboard;
	const caret = Array.from(keyboard.formula).slice(0, keyboard.formulaCursor).join('').length;
	const ref = formulaReferences(keyboard.formula, sheet.selRow, sheet.selCol, sheet)
		.find(ref => ref.start <= caret && caret <= ref.end);
	if (!ref?.region) return false;
	const { r0, c0, r1, c1 } = ref.region;
	const format = /[\[{}]/.test(ref.source) ? cellLabel : (r, c) => relativeReference(r, c, sheet.selRow, sheet.selCol);
	const replacement = ref.source.includes(':') ? `${format(r0, c0)}:${format(r1, c1)}` : format(r0, c0);
	keyboard.setFormula(keyboard.formula.slice(0, ref.start) + replacement + keyboard.formula.slice(ref.end));
	keyboard.formulaCursor = Array.from(keyboard.formula.slice(0, ref.start) + replacement).length;
	keyboard.reference = null;
	return true;
}

export function formulaAssist(text, cursor) {
	if (!text.startsWith('=')) return { suggestions: [], signature: null };
	const before = Array.from(text).slice(0, cursor).join(''), stack = [];
	for (let i = 1; i < before.length; i++) {
		const char = before[i];
		if (char === '"' || char === "'") {
			const end = quotedEnd(before, i);
			if (before[end - 1] !== char || end === i + 1) return { suggestions: [], signature: null };
			i = end - 1;
		} else if ('([{'.includes(char)) {
			const name = char === '(' ? before.slice(0, i).match(/([A-Za-z]+)\s*$/)?.[1] : null;
			stack.push({ close: { '(': ')', '[': ']', '{': '}' }[char], name, argument: 0 });
		} else if (')]}'.includes(char)) stack.pop();
		else if (char === ',' && stack.length) stack.at(-1).argument++;
	}
	const call = [...stack].reverse().find(entry => functionHelp[entry.name]);
	const prefix = before.match(/(?:^|[^\w])([A-Za-z]+)$/)?.[1] ?? '';
	const after = Array.from(text).slice(cursor).join('');
	const suggestions = prefix && !/^(?:\w|\s*\()/.test(after)
		? Object.keys(functionHelp).filter(name => name.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 6) : [];
	return { prefix, suggestions, signature: call ? { name: call.name, args: functionHelp[call.name], argument: call.argument } : null };
}
