import { builderCalls } from './FormulaBuilder.js';
import { cellLabel, columnIndex, evaluateFormula, FormulaError, truthy, validatePredicate } from './FormulaFunctions.js';
import { horizontalAlignments } from './CellFormatting.js';

const namedColors = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));

function text(argument) {
	if (!argument.startsWith('"')) throw new Error('Text and colours must be in double quotes');
	const value = JSON.parse(argument);
	if (typeof value !== 'string') throw new Error('Expected quoted text');
	return value;
}

export function compileConditionalRule(source) {
	if (typeof source !== 'string') throw new Error('A conditional rule must be builder text');
	// Keep the existing overlay shape for consumers; colours and alignment merge per property.
	const rule = { source, range: null, predicate: 'TRUE', colors: {}, name: '' };
	for (const { method, args } of builderCalls(source, 'CF')) {
		if (!['range', 'when', 'fg', 'bg', 'align', 'name'].includes(method)) throw new Error(`Unknown CF method .${method}()`);
		if (args.length !== 1 || !args[0]) throw new Error(`.${method}() expects one argument`);
		if (method === 'range') {
			const match = args[0].match(/^([A-Z]+)(\d+)(?:\s*:\s*([A-Z]+)(\d+))?$/);
			if (!match) throw new Error('.range() needs a local absolute range such as A0:D3');
			const [r0, c0, r1, c1] = [Number(match[2]), columnIndex(match[1]), Number(match[4] ?? match[2]), columnIndex(match[3] ?? match[1])];
			if (![r0, c0, r1, c1].every(Number.isSafeInteger)) throw new Error('Range coordinates are too large');
			rule.range = { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
		} else if (method === 'when') {
			validatePredicate(args[0]); rule.predicate = args[0];
		} else if (method === 'name') rule.name = text(args[0]);
		else if (method === 'align') {
			const align = text(args[0]);
			if (!horizontalAlignments.includes(align)) throw new Error('Alignment must be auto, left, center or right');
			rule.colors.align = align;
		}
		else {
			const color = text(args[0]);
			if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) && !namedColors.has(color.toLowerCase())) throw new Error(`Invalid colour: ${color}; use a hex or CSS named colour`);
			rule.colors[method] = color;
		}
	}
	if (!rule.range) throw new Error('Add .range(A0:D3)');
	if (!Object.keys(rule.colors).length) throw new Error('Add .fg("colour"), .bg("colour") or .align("left"|"center"|"right"|"auto")');
	return rule;
}

export function conditionalSource(rule) {
	const { r0, c0, r1, c1 } = rule.range;
	return `=CF()${rule.name ? `.name(${JSON.stringify(rule.name)})` : ''}\n  .range(${cellLabel(r0, c0)}:${cellLabel(r1, c1)})\n  .when(${rule.predicate})`
		+ Object.entries(rule.colors).map(([method, value]) => `\n  .${method}(${JSON.stringify(value)})`).join('');
}

export function validateConditionalRules(rules = [], rows) {
	if (!Array.isArray(rules)) throw new Error('conditionalRules must be an array');
	const ids = new Set();
	return rules.map(item => {
		if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id)) throw new Error('Conditional rule IDs must be unique positive integers');
		ids.add(item.id);
		const rule = compileConditionalRule(item.source);
		if (rule.range.r1 >= rows.length || rule.range.c1 >= rows[0].length) throw new Error('Conditional rule range is outside the sheet');
		return { id: item.id, source: item.source };
	});
}

// Inserted cells inside a rule join it; cells inserted at/before its first edge shift it. Formula
// literals stay positional, like normal cell formulas. Only the target rectangle follows edits.
export function adjustConditionalRules(rules, axis, at, removed, inserted) {
	return (rules ?? []).flatMap(item => {
		const rule = compileConditionalRule(item.source), start = axis === 'row' ? 'r0' : 'c0', end = axis === 'row' ? 'r1' : 'c1', range = rule.range;
		if (removed) {
			const last = at + removed;
			range[start] = range[start] >= last ? range[start] - removed : range[start] >= at ? at : range[start];
			range[end] = range[end] >= last ? range[end] - removed : range[end] >= at ? at - 1 : range[end];
			if (range[end] < range[start]) return [];
		}
		if (inserted && at <= range[end]) {
			if (at <= range[start]) range[start] += inserted;
			range[end] += inserted;
		}
		return [{ ...item, source: conditionalSource(rule) }];
	});
}

export function evaluateConditionalRules(record, results, sheets, mark) {
	const colors = new Map(), ruleErrors = new Map(), ruleMatches = new Map();
	function context(sheet) {
		const snapshot = results.get(sheet);
		const check = (row, col) => {
			if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= sheet.rows.length || col >= sheet.rows[0].length) throw new FormulaError('#REF!', `${cellLabel(row, col)} is outside ${sheet.name}`);
		};
		const read = (row, col) => {
			check(row, col);
			const key = `${row}:${col}`;
			if (snapshot.failures.has(key)) throw snapshot.failures.get(key);
			const value = snapshot.typed[row][col];
			if (value?.kind === 'chart') throw new FormulaError('#VALUE!', 'Chart cells cannot be used in conditional predicates');
			return value;
		};
		return {
			pure: true, ref: read, mark,
			range: (r0, c0, r1, c1) => {
				check(r0, c0); check(r1, c1);
				return Array.from({ length: r1 - r0 + 1 }, (_, r) => Array.from({ length: c1 - c0 + 1 }, (_, c) => read(r0 + r, c0 + c)));
			},
			sheet: name => {
				const other = sheets.find(item => item.name.toLowerCase() === name.toLowerCase());
				if (!other) throw new FormulaError('#REF!', `Unknown sheet: ${name}`);
				return context(other);
			},
		};
	}
	const ctx = context(record), snapshot = results.get(record);
	for (const item of record.conditionalRules ?? []) {
		let matches = 0;
		try {
			const rule = compileConditionalRule(item.source), { r0, c0, r1, c1 } = rule.range;
			for (let row = r0; row <= Math.min(r1, record.rows.length - 1); row++) for (let col = c0; col <= Math.min(c1, record.rows[0].length - 1); col++) {
				if (snapshot.typed[row][col]?.kind === 'chart') continue;
				try {
					const value = evaluateFormula(rule.predicate, row, col, ctx);
					if (Array.isArray(value) || (typeof value === 'object' && value !== null && !value.isBigNumber)) throw new Error('A predicate must return one scalar condition');
					if (!truthy(value)) continue;
					const key = `${row}:${col}`;
					colors.set(key, { ...colors.get(key), ...rule.colors }); matches++;
				} catch (error) {
					const previous = ruleErrors.get(item.id);
					ruleErrors.set(item.id, { count: (previous?.count ?? 0) + 1, message: previous?.message ?? `${cellLabel(row, col)}: ${error.explanation ?? error.message}` });
				}
			}
		} catch (error) { ruleErrors.set(item.id, { count: 1, message: error.explanation ?? error.message }); }
		ruleMatches.set(item.id, matches);
	}
	return { colors, ruleErrors, ruleMatches };
}
