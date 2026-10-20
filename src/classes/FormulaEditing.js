import { cellLabel, referenceSpans, resolveReference } from './FormulaFunctions.js';

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
	'.line': [], '.bar': [], '.scatter': [], '.pie': [],
	'.x': ['labelRange'], '.series': ['valueRange', '["name"]'],
	'.title': ['"text"'], '.xLabel': ['"text"'], '.yLabel': ['"text"'],
	'.size': ['width', 'height'], '.width': ['pixels'], '.height': ['pixels'], '.position': ['x', 'y'],
};

export function quotedEnd(text, at) {
	const quote = text[at];
	for (let i = at + 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (quote === "'" && text[i] === "'" && text[i + 1] === "'") i++;
		else if (text[i] === quote) return i + 1;
	}
	return text.length;
}

// Source spans stay in UTF-16 for slicing/HTML; the keyboard caret uses code points.
// Resolve the same notation as evaluation, rather than guessing at []{} calculations.
export function formulaReferences(text, row, col, sheet) {
	if (!text.startsWith('=')) return [];
	const refs = [], colors = new Map();
	for (const { start, end, source, reference, sheetName, kind, prefix = '' } of referenceSpans(text)) {
		let region = null, coordinates = null;
		let resolvedSheet = sheetName ?? sheet.activeSheet.name;
		try {
			const resolved = sheet.runPass(pass => resolveReference(kind === 'mark' ? source : reference, row, col, sheetName === undefined ? pass.ctx : pass.ctx.sheet(sheetName)));
			const { r0, c0, r1, c1 } = resolved;
			resolvedSheet = resolved.sheetName ?? resolvedSheet;
			const target = sheet.sheets.find(item => item.name.toLowerCase() === resolvedSheet.toLowerCase());
			if (resolved.height === 0) throw new Error('Empty dataset');
			if (target && Math.max(r0, r1) < target.rows.length && Math.max(c0, c1) < target.rows[0].length) {
				coordinates = { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
				// A foreign sheet's coordinates must never outline unrelated cells on the visible sheet.
				if (target === sheet.activeSheet) region = coordinates;
			}
		} catch { /* Incomplete or invalid references stay colored, without a misleading grid highlight. */ }
		const key = coordinates ? `${resolvedSheet.toLowerCase()}:${JSON.stringify(coordinates)}` : source;
		if (!colors.has(key)) colors.set(key, referenceColors[colors.size % referenceColors.length]);
		refs.push({ start, end, source, region, coordinates, prefix, kind, color: colors.get(key) });
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
	if (!ref?.coordinates || ref.kind === 'mark') return false;
	const { r0, c0, r1, c1 } = ref.coordinates;
	const reference = ref.source.slice(ref.prefix.length);
	const format = /[\[{}]/.test(reference) ? cellLabel : (r, c) => relativeReference(r, c, sheet.selRow, sheet.selCol);
	const replacement = ref.prefix + (reference.includes(':') ? `${format(r0, c0)}:${format(r1, c1)}` : format(r0, c0));
	keyboard.setFormula(keyboard.formula.slice(0, ref.start) + replacement + keyboard.formula.slice(ref.end));
	keyboard.formulaCursor = Array.from(keyboard.formula.slice(0, ref.start) + replacement).length;
	keyboard.reference = null;
	return true;
}

export function formulaAssist(text, cursor, sheet) {
	if (!text.startsWith('=')) return { suggestions: [], signature: null };
	const before = Array.from(text).slice(0, cursor).join(''), stack = [];
	let chartEnd = -1;
	for (let i = 1; i < before.length; i++) {
		const char = before[i];
		if (char === '"' || char === "'") {
			const end = quotedEnd(before, i);
			if (before[end - 1] !== char || end === i + 1) return { suggestions: [], signature: null };
			i = end - 1;
		} else if ('([{'.includes(char)) {
			let name = char === '(' ? before.slice(0, i).match(/([A-Za-z]+)\s*$/)?.[1] : null;
			const method = char === '(' && !stack.length && chartEnd >= 0 && /^\s*\.\s*[A-Za-z]+\s*$/.test(before.slice(chartEnd, i));
			if (method) name = `.${name}`;
			stack.push({ name, argument: 0, chart: method || (name === 'CHART' && !stack.length) });
		} else if (')]}'.includes(char)) {
			const call = stack.pop();
			if (!stack.length) chartEnd = call?.chart ? i + 1 : -1;
		}
		else if (char === ',' && stack.length) stack.at(-1).argument++;
	}
	const call = [...stack].reverse().find(entry => functionHelp[entry.name]);
	const mark = before.match(/`([A-Za-z_][A-Za-z0-9_]*)?(?:\.([A-Za-z_][A-Za-z0-9_]*)?)?$/);
	if (mark && sheet?.marks) {
		const prefix = mark[0];
		let candidates = sheet.marks.map(item => '`' + item.name);
		if (prefix.includes('.')) {
			try { candidates = sheet.describeDataset(mark[1]).columns.map(item => '`' + mark[1] + '.' + item.name); }
			catch { candidates = []; }
		}
		return { kind: 'mark', prefix, suggestions: candidates.filter(name => name.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 6), signature: call ? { name: call.name, args: functionHelp[call.name], argument: call.argument } : null };
	}
	const method = !stack.length && chartEnd >= 0 && /^\s*\.\s*[A-Za-z]*$/.test(before.slice(chartEnd));
	const prefix = method ? before.match(/\.\s*[A-Za-z]*$/)[0] : before.match(/(?:^|[^\w.])([A-Za-z]+)$/)?.[1] ?? '';
	const matchPrefix = method ? prefix.replace(/\s/g, '') : prefix;
	const after = Array.from(text).slice(cursor).join('');
	const suggestions = prefix && !/^(?:\w|\s*\()/.test(after)
		? Object.keys(functionHelp).filter(name => name.toLowerCase().startsWith(matchPrefix.toLowerCase())).slice(0, 6) : [];
	return { prefix, suggestions, signature: call ? { name: call.name, args: functionHelp[call.name], argument: call.argument } : null };
}
