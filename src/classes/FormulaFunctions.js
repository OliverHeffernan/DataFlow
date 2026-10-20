// Keep decimal values throughout evaluation, including intermediate cell results. Native numbers
// are only produced at the sheet's display/API boundary, not between arithmetic operations.
const config = { number: 'BigNumber', precision: 64, relTol: 1e-64, absTol: 0 }
import { create, all } from 'mathjs'
const math = create(all, config)

/*
 * Expression-tree formula engine.
 *
 * Formulas are normalised as text only where spreadsheet syntax differs from mathjs (relative {} and []
 * notation, unquoted legacy criteria, = and <> comparisons, A0:B3 ranges), always skipping quoted strings.
 * The result is parsed by mathjs and walked here; nothing is executed as JavaScript. Ranges and array
 * results are 2D arrays (arrays of rows). Cell access goes through a context object:
 *   ctx.ref(row, col)   -> scalar, or the full 2D array of an array formula
 *   ctx.range(r0, c0, r1, c1) -> 2D array of element values
 */

// A user-visible formula error. `message` is shown in the cell, `explanation` is the readable reason.
export class FormulaError extends Error {
	constructor(message, explanation = message) {
		super(message);
		this.explanation = explanation;
	}
}

// Control-flow errors (cycle detection, aborted speculative evaluation) set `uncatchable`, so IFERROR
// never hides them and results never depend on evaluation order.
const isUncatchable = error => Boolean(error?.uncatchable);

export function columnLabel(col) {
	let label = "";
	for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
	return label;
}

export function columnIndex(letters) {
	return [...letters].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

export const cellLabel = (row, col) => `${columnLabel(col)}${row}`;

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$|^[+-]?Infinity$/i;

// Convert stored (non-formula) cell text to a formula value: numeric text becomes a number, text is kept intact.
export function cellToValue(raw) {
	if (raw == null) return "";
	if (typeof raw !== "string") return raw;
	const trimmed = raw.trim();
	return trimmed !== "" && NUMERIC.test(trimmed) ? math.bignumber(trimmed) : raw;
}

// Preserve the existing numeric UI/chart/clipboard contract without losing decimal intermediates.
export function toCellValue(value) {
	if (Array.isArray(value)) return value.map(toCellValue);
	return math.isBigNumber(value) ? value.toNumber() : value;
}

const isArray = Array.isArray;
const shapeText = array => `${array.length}×${array[0]?.length ?? 0}`;
const isMathObject = value => value !== null && typeof value === "object" && !isArray(value);

function unwrap(value) {
	return isArray(value) && value.length === 1 && value[0].length === 1 ? value[0][0] : value;
}

export function to2D(value) {
	return isArray(value) ? value : [[value]];
}

const flat = values => values.flatMap(value => to2D(value).flat());
const map2D = (array, fn) => array.map(row => row.map(fn));

// Normalise a mathjs result (Matrix, 1D array, nested array) into the 2D convention.
function normalise(value) {
	if (value && typeof value.toArray === "function" && math.isMatrix(value)) value = value.toArray();
	if (value === undefined || value === null) return "";
	if (!isArray(value)) return value;
	if (value.length === 0) throw new FormulaError("#CALC!", "The result is an empty array");
	if (!value.some(isArray)) return [value.map(scalar)];
	if (!value.every(isArray)) throw new FormulaError("#VALUE!", "Arrays must be rectangular");
	const width = value[0].length;
	if (width === 0 || value.some(row => row.length !== width)) throw new FormulaError("#VALUE!", "Arrays must be rectangular");
	return value.map(row => row.map(scalar));
}

function scalar(value) {
	if (isArray(value) || math.isMatrix(value)) throw new FormulaError("#VALUE!", "Arrays with more than two dimensions are not supported");
	return value ?? "";
}

function num(value) {
	if (typeof value === "number") return math.bignumber(String(value));
	if (typeof value === "boolean") return math.bignumber(Number(value));
	if (value === "" || value == null) return math.bignumber(0);
	if (typeof value === "string") {
		if (value.trim() === "") return math.bignumber(0);
		if (NUMERIC.test(value.trim())) return math.bignumber(value.trim());
		throw new FormulaError("#VALUE!", `Text "${value}" cannot be used as a number`);
	}
	if (value?.kind === "chart") throw new Error("Chart cells cannot be used in numeric formulas");
	return value;
}

export function truthy(value) {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
	if (math.isBigNumber(value)) return !value.isZero() && !value.isNaN();
	if (value === "" || value == null) return false;
	if (typeof value === "string") {
		const text = value.trim().toUpperCase();
		if (text === "TRUE") return true;
		if (text === "FALSE") return false;
		if (NUMERIC.test(text)) return !math.bignumber(text).isZero();
		throw new FormulaError("#VALUE!", `Text "${value}" cannot be used as a condition`);
	}
	return !math.isZero(value);
}

// Spreadsheet comparison: blanks act as 0 against numbers, numbers sort before text, text compares exactly.
export function compareValues(a, b) {
	if (a === "" && (typeof b === "number" || typeof b === "boolean" || math.isBigNumber(b))) a = 0;
	if (b === "" && (typeof a === "number" || typeof a === "boolean" || math.isBigNumber(a))) b = 0;
	if (typeof a === "boolean") a = Number(a);
	if (typeof b === "boolean") b = Number(b);
	const aText = typeof a === "string";
	const bText = typeof b === "string";
	if (aText !== bText) return aText ? 1 : -1;
	if (isMathObject(a) || isMathObject(b)) return Number(math.compare(num(a), num(b)));
	return a < b ? -1 : a > b ? 1 : 0;
}

const COMPARISONS = {
	equal: r => r === 0, unequal: r => r !== 0, smaller: r => r < 0,
	larger: r => r > 0, smallerEq: r => r <= 0, largerEq: r => r >= 0,
};

// Elementwise binary operation with scalar broadcasting and same-shape arrays.
export function broadcast(a, b, fn) {
	a = unwrap(a);
	b = unwrap(b);
	if (!isArray(a) && !isArray(b)) return fn(a, b);
	if (!isArray(a)) return map2D(b, y => fn(a, y));
	if (!isArray(b)) return map2D(a, x => fn(x, b));
	if (a.length !== b.length || a[0].length !== b[0].length) {
		throw new FormulaError("#VALUE!", `Array sizes do not match: ${shapeText(a)} and ${shapeText(b)}`);
	}
	return a.map((row, i) => row.map((x, j) => fn(x, b[i][j])));
}

const elementwise = (value, fn) => isArray(value) ? map2D(value, fn) : fn(value);

function arity(name, args, min, max = min) {
	if (args.length < min || args.length > max) {
		const expected = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
		throw new FormulaError("#N/A", `${name} expects ${expected} argument${max === 1 ? "" : "s"}, got ${args.length}`);
	}
}

function integerArg(value, name, what) {
	value = unwrap(value);
	const number = num(isArray(value) ? NaN : value);
	if (!math.isInteger(number)) throw new FormulaError("#VALUE!", `${name} ${what} must be a whole number`);
	return Number(number);
}

// Legacy SUMIF/COUNTIF/AVGIF criteria: optional operator (=, !, <, >, <=, >=, <>, !=, ==) followed by a term.
function criterion(crit) {
	crit = unwrap(crit);
	if (isArray(crit)) throw new FormulaError("#VALUE!", "Criteria must be a single value");
	const loose = value => typeof value === "string" ? cellToValue(value.trim()) : value;
	if (typeof crit !== "string") return value => compareValues(loose(value), crit) === 0;
	const match = crit.match(/^\s*(<=|>=|<>|!=|==|=|!|<|>)?([\s\S]*)$/);
	const test = {
		"=": r => r === 0, "==": r => r === 0, "!": r => r !== 0, "!=": r => r !== 0, "<>": r => r !== 0,
		"<": r => r < 0, ">": r => r > 0, "<=": r => r <= 0, ">=": r => r >= 0,
	}[match[1] ?? "="];
	const term = loose(match[2]);
	return value => test(compareValues(loose(value), term));
}

const numericOrNull = value => typeof value === "number" || typeof value === "boolean" ? num(value)
	: isMathObject(value) && value?.kind !== "chart" ? value : null;

function conditional(name, args, evaluate) {
	arity(name, args, 2, 3);
	const conditions = flat([evaluate(args[0])]);
	const test = criterion(evaluate(args[1]));
	const values = name !== "COUNTIF" && args[2] ? flat([evaluate(args[2])]) : conditions;
	if (values.length !== conditions.length) {
		throw new FormulaError("#VALUE!", `${name} ranges must be the same size (${conditions.length} and ${values.length} cells)`);
	}
	let sum = 0;
	let count = 0;
	conditions.forEach((condition, i) => {
		if (!test(condition)) return;
		count++;
		const value = numericOrNull(values[i]);
		if (value !== null) sum = math.add(sum, value);
	});
	if (name === "COUNTIF") return count;
	if (name === "AVGIF") {
		if (!count) throw new FormulaError("#DIV/0!", "AVGIF found no matching values");
		return math.divide(sum, count);
	}
	return sum;
}

function sumOf(values) {
	return flat(values).reduce((total, value) => {
		const number = numericOrNull(value);
		if (value?.kind === "chart") throw new Error("Chart cells cannot be used in numeric formulas");
		return number === null ? total : math.add(total, number);
	}, 0);
}

function stack(name, arrays) {
	if (name === "VSTACK") {
		const width = arrays[0][0].length;
		const bad = arrays.find(array => array[0].length !== width);
		if (bad) throw new FormulaError("#VALUE!", `VSTACK arrays must have the same number of columns (got ${shapeText(arrays[0])} and ${shapeText(bad)})`);
		return arrays.flatMap(array => array.map(row => [...row]));
	}
	const height = arrays[0].length;
	const bad = arrays.find(array => array.length !== height);
	if (bad) throw new FormulaError("#VALUE!", `HSTACK arrays must have the same number of rows (got ${shapeText(arrays[0])} and ${shapeText(bad)})`);
	return arrays[0].map((_, i) => arrays.flatMap(array => array[i]));
}

// Spreadsheet functions receive unevaluated argument nodes, so IF/IFERROR/FILTER can be lazy.
const FUNCTIONS = {
	SUM: (args, evaluate) => { arity("SUM", args, 1, Infinity); return sumOf(args.map(evaluate)); },
	COUNT: (args, evaluate) => { arity("COUNT", args, 1, Infinity); return flat(args.map(evaluate)).length; },
	AVG: (args, evaluate) => average("AVG", args, evaluate),
	MEAN: (args, evaluate) => average("MEAN", args, evaluate),
	SUMIF: (args, evaluate) => conditional("SUMIF", args, evaluate),
	COUNTIF: (args, evaluate) => conditional("COUNTIF", args, evaluate),
	AVGIF: (args, evaluate) => conditional("AVGIF", args, evaluate),
	IF(args, evaluate) {
		arity("IF", args, 2, 3);
		const condition = unwrap(evaluate(args[0]));
		if (isArray(condition)) throw new FormulaError("#VALUE!", "IF needs a single condition; use FILTER or AND/OR masks for arrays");
		if (truthy(condition)) return evaluate(args[1]);
		return args.length === 3 ? evaluate(args[2]) : false;
	},
	IFERROR(args, evaluate) {
		arity("IFERROR", args, 2);
		try {
			return evaluate(args[0]);
		} catch (error) {
			if (isUncatchable(error)) throw error;
			return evaluate(args[1]);
		}
	},
	FILTER(args, evaluate) {
		arity("FILTER", args, 2, 3);
		const array = to2D(evaluate(args[0]));
		const include = to2D(evaluate(args[1]));
		const mask = include[0].length === 1 ? include.map(row => row[0]) : include.length === 1 ? include[0] : null;
		if (!mask || mask.length !== array.length) {
			throw new FormulaError("#VALUE!", `FILTER include must have one value per row: expected ${array.length}×1, got ${shapeText(include)}`);
		}
		const rows = array.filter((_, i) => truthy(mask[i]));
		if (rows.length) return rows.map(row => [...row]);
		if (args.length === 3) return evaluate(args[2]);
		throw new FormulaError("#CALC!", "FILTER found no matching rows");
	},
	VSTACK: (args, evaluate) => { arity("VSTACK", args, 1, Infinity); return stack("VSTACK", args.map(arg => to2D(evaluate(arg)))); },
	HSTACK: (args, evaluate) => { arity("HSTACK", args, 1, Infinity); return stack("HSTACK", args.map(arg => to2D(evaluate(arg)))); },
	AND: (args, evaluate) => logical("AND", args, evaluate, (a, b) => a && b),
	OR: (args, evaluate) => logical("OR", args, evaluate, (a, b) => a || b),
	NOT(args, evaluate) {
		arity("NOT", args, 1);
		return elementwise(evaluate(args[0]), value => !truthy(value));
	},
	SORT(args, evaluate) {
		arity("SORT", args, 1, 3);
		const array = to2D(evaluate(args[0]));
		const column = args.length > 1 ? integerArg(evaluate(args[1]), "SORT", "column index") : 0;
		const order = args.length > 2 ? integerArg(evaluate(args[2]), "SORT", "sort order") : 1;
		if (column < 0 || column >= array[0].length) {
			throw new FormulaError("#VALUE!", `SORT column index ${column} is outside 0..${array[0].length - 1}`);
		}
		if (order !== 1 && order !== -1) throw new FormulaError("#VALUE!", "SORT order must be 1 (ascending) or -1 (descending)");
		return array.map(row => [...row]).sort((a, b) => {
			const x = a[column];
			const y = b[column];
			if (x === "" || y === "") return (x === "") - (y === ""); // blanks last
			return order * compareValues(x, y);
		});
	},
	UNIQUE(args, evaluate) {
		arity("UNIQUE", args, 1);
		const seen = new Set();
		return to2D(evaluate(args[0])).filter(row => {
			const key = JSON.stringify(row.map(value => [math.isBigNumber(value) ? 'number' : typeof value, String(value)]));
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}).map(row => [...row]);
	},
};

// Legacy AVG/MEAN semantics: sum of numeric values divided by the number of cells.
function average(name, args, evaluate) {
	arity(name, args, 1, Infinity);
	const values = args.map(evaluate);
	return math.divide(sumOf(values), flat(values).length);
}

function logical(name, args, evaluate, combine) {
	arity(name, args, 1, Infinity);
	return args.map(evaluate).map(value => elementwise(value, truthy))
		.reduce((total, value) => broadcast(total, value, combine));
}

// mathjs functions that must not be reachable from cells.
const BLOCKED_MATH = new Set([
	"import", "createUnit", "evaluate", "parse", "compile", "chain", "config", "reviver", "replacer",
	"resolve", "simplify", "simplifyCore", "simplifyConstant", "derivative", "rationalize", "help",
	"parser", "typed", "leafCount", "symbolicEqual",
]);

const REF = /^([A-Z]+)(\d+)$/;
const RANGE = /^RANGE__([A-Z]+)(\d+)__([A-Z]+)(\d+)$/;

function evaluateNode(node, ctx) {
	const evaluate = child => evaluateNode(child, ctx);
	switch (node.type) {
		case "ConstantNode":
			return node.value ?? "";
		case "ParenthesisNode":
			return evaluate(node.content);
		case "SymbolNode":
			return symbol(node.name, ctx);
		case "ConditionalNode": {
			const condition = unwrap(evaluate(node.condition));
			if (isArray(condition)) throw new FormulaError("#VALUE!", "Conditions must be a single value");
			return truthy(condition) ? evaluate(node.trueExpr) : evaluate(node.falseExpr);
		}
		case "ArrayNode": {
			const items = node.items.map(evaluate).map(unwrap);
			if (items.some(isArray)) return normalise(items.map(item => isArray(item) ? item.flat() : item));
			return normalise(items);
		}
		case "RangeNode": {
			if (node.step) throw new FormulaError("#VALUE!", "Ranges with steps are not supported");
			const start = unwrap(evaluate(node.start));
			const end = unwrap(evaluate(node.end));
			return normalise(math.range(num(start), num(end), true));
		}
		case "RelationalNode": {
			let result = true;
			for (let i = 0; i < node.conditionals.length; i++) {
				const left = evaluate(node.params[i]);
				const right = evaluate(node.params[i + 1]);
				const test = COMPARISONS[node.conditionals[i]];
				const part = broadcast(left, right, (a, b) => test(compareValues(a, b)));
				result = broadcast(result, part, (a, b) => a && b);
			}
			return result;
		}
		case "OperatorNode":
			return operator(node, evaluate);
		case "FunctionNode":
			return call(node, ctx, evaluate);
		default:
			throw new FormulaError("#VALUE!", `Unsupported syntax: ${node.toString()}`);
	}
}

function symbol(name, ctx) {
	if (ctx.references?.has(name)) return ctx.references.get(name)();
	let match = name.match(RANGE);
	if (match) {
		const c0 = columnIndex(match[1]);
		const r0 = Number(match[2]);
		const c1 = columnIndex(match[3]);
		const r1 = Number(match[4]);
		return ctx.range(Math.min(r0, r1), Math.min(c0, c1), Math.max(r0, r1), Math.max(c0, c1));
	}
	match = name.match(REF);
	if (match) return ctx.ref(Number(match[2]), columnIndex(match[1]));
	if (name === "TRUE") return true;
	if (name === "FALSE") return false;
	if (Object.hasOwn(math, name) && typeof math[name] !== "function" && name !== "config") return normalise(math[name]);
	if (math.Unit.isValuelessUnit(name)) return new math.Unit(null, name);
	throw new FormulaError("#NAME?", `Undefined symbol ${name}`);
}

function operator(node, evaluate) {
	const { fn, args } = node;
	if (fn === "and" || fn === "or" || fn === "xor") {
		const combine = { and: (a, b) => a && b, or: (a, b) => a || b, xor: (a, b) => a !== b }[fn];
		return broadcast(evaluate(args[0]), evaluate(args[1]), (a, b) => combine(truthy(a), truthy(b)));
	}
	if (fn === "not") return elementwise(evaluate(args[0]), value => !truthy(value));
	if (COMPARISONS[fn]) {
		return broadcast(evaluate(args[0]), evaluate(args[1]), (a, b) => COMPARISONS[fn](compareValues(a, b)));
	}
	if (fn === "transpose" || fn === "ctranspose") {
		const value = evaluate(args[0]);
		return isArray(value) ? value[0].map((_, j) => value.map(row => row[j])) : value;
	}
	if (typeof math[fn] !== "function") throw new FormulaError("#VALUE!", `Unsupported operator ${node.op}`);
	const coerce = fn === "to" ? value => value : num;
	if (args.length === 1) return elementwise(evaluate(args[0]), value => math[fn](coerce(value)));
	return args.map(evaluate).reduce((a, b) => broadcast(a, b, (x, y) => {
		const right = coerce(y);
		if (['divide', 'dotDivide', 'mod'].includes(fn) && math.isZero(right)) throw new FormulaError('#DIV/0!', 'Cannot divide by zero');
		return math[fn](coerce(x), right);
	}));
}

function call(node, ctx, evaluate) {
	const name = node.fn?.type === "SymbolNode" ? node.fn.name : null;
	if (!name) throw new FormulaError("#VALUE!", `Unsupported function call: ${node.toString()}`);
	if (Object.hasOwn(FUNCTIONS, name)) return FUNCTIONS[name](node.args, evaluate);
	if (typeof math[name] !== "function" || BLOCKED_MATH.has(name) || !Object.hasOwn(math, name)) {
		throw new FormulaError("#NAME?", `Unknown function ${name}`);
	}
	const toMath = value => value === "" ? 0 : value?.kind === "chart" ? num(value) : value;
	const args = node.args.map(evaluate).map(value => isArray(value) ? map2D(value, toMath) : toMath(value));
	// Some mathjs functions (e.g. random/randomInt) only support native numbers. Convert only at
	// that boundary; array/any and decimal-aware functions retain their high-precision inputs.
	const signatures = Object.keys(math[name].signatures ?? {});
	const numberOnly = signatures.some(signature => /\bnumber\b/.test(signature))
		&& !signatures.some(signature => /\b(?:BigNumber|any)\b/.test(signature));
	return normalise(math[name](...args.map(value => numberOnly ? toCellValue(value) : value)));
}

/* ---------- text normalisation (always skipping quoted strings) ---------- */

function stringEnd(text, start) {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (quote === "'" && text[i] === "'" && text[i + 1] === "'") i++;
		else if (text[i] === quote) return i + 1;
	}
	return text.length;
}

function mapOutsideStrings(text, fn) {
	let out = "";
	let segment = "";
	for (let i = 0; i < text.length;) {
		if (text[i] === '"' || text[i] === "'") {
			const end = stringEnd(text, i);
			out += fn(segment) + text.slice(i, end);
			segment = "";
			i = end;
		} else segment += text[i++];
	}
	return out + fn(segment);
}

// Index of the bracket closing the one at `start`, or -1.
function matching(text, start) {
	const pairs = { "(": ")", "[": "]", "{": "}" };
	const stack = [];
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") { i = stringEnd(text, i) - 1; continue; }
		if (pairs[char]) stack.push(pairs[char]);
		else if (")]}".includes(char)) {
			if (stack.pop() !== char) return -1;
			if (!stack.length) return i;
		}
	}
	return -1;
}

function endpointEnd(text, at) {
	let end = text[at] === '[' ? matching(text, at) + 1 : at + (text.slice(at).match(/^[A-Z]+/)?.[0].length ?? 0);
	if (end <= at) return -1;
	if (text[end] === '{') { const close = matching(text, end); return close < 0 ? -1 : close + 1; }
	const digits = text.slice(end).match(/^\d+/)?.[0];
	return digits ? end + digits.length : -1;
}

// Literal source spans are shared with the editor so relative and mixed range syntax agrees with evaluation.
export function referenceSpans(text) {
	const spans = [];
	for (let i = 0; i < text.length;) {
		const prefix = text.slice(i).match(/^(?:'((?:[^'\\]|\\.|'')*)'|([A-Za-z_][A-Za-z0-9_]*|#REF))!/);
		if (!prefix && (text[i] === '"' || text[i] === "'")) { i = stringEnd(text, i); continue; }
		if (/[\w.]/u.test(text[i - 1] ?? '')) { i++; continue; }
		const at = i + (prefix?.[0].length ?? 0);
		let end = endpointEnd(text, at);
		if (end < 0 || /\w/u.test(text[end] ?? '')) { i++; continue; }
		const colon = text.slice(end).match(/^\s*:\s*/);
		if (colon) {
			const rangeEnd = endpointEnd(text, end + colon[0].length);
			if (rangeEnd > end && !/\w/u.test(text[rangeEnd] ?? '')) end = rangeEnd;
		}
		spans.push({ start: i, end, source: text.slice(i, end), reference: text.slice(at, end),
			...(prefix ? { sheetName: prefix[2] ?? prefix[1].replace(/''/g, "'").replace(/\\(.)/g, '$1'), prefix: prefix[0] } : {}) });
		i = end;
	}
	return spans;
}

export const sheetPrefix = name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `${name}!` : `'${name.replaceAll("'", "''").replaceAll('\\', '\\\\')}'!`;

// Only actual references change: text cells and quoted formula/chart labels remain literal.
export function rewriteSheetReferences(text, oldName, newName) {
	if (typeof text !== 'string' || !text.startsWith('=')) return text;
	for (const span of referenceSpans(text).reverse()) {
		let reference = '';
		for (let i = 0; i < span.reference.length;) {
			const char = span.reference[i];
			if (char === '[' || char === '{') {
				const end = matching(span.reference, i);
				reference += char + rewriteSheetReferences('=' + span.reference.slice(i + 1, end), oldName, newName).slice(1) + span.reference[end];
				i = end + 1;
			} else reference += span.reference[i++];
		}
		const prefix = span.prefix !== '#REF!' && span.sheetName?.toLowerCase() === oldName.toLowerCase()
			? newName === null ? '#REF!' : sheetPrefix(newName) : span.prefix ?? '';
		text = text.slice(0, span.start) + prefix + reference + text.slice(span.end);
	}
	return text;
}

export function resolveReference(source, row, col, ctx) {
	const resolved = normaliseFormula(source, row, col, ctx);
	const match = resolved.match(/^(?:RANGE__)?([A-Z]+)(\d+)(?:__([A-Z]+)(\d+))?$/);
	if (!match) throw new FormulaError('#REF!', `Invalid reference: ${source}`);
	return { r0: Number(match[2]), c0: columnIndex(match[1]), r1: Number(match[4] ?? match[2]), c1: columnIndex(match[3] ?? match[1]) };
}

// [start, end) spans of comma separated top-level arguments between from and to.
function splitTopLevel(text, from, to, separators = ",") {
	const spans = [];
	let start = from;
	for (let i = from; i < to; i++) {
		const char = text[i];
		if (char === '"' || char === "'") i = stringEnd(text, i) - 1;
		else if ("([{".includes(char)) i = matching(text, i);
		else if (separators.includes(char)) { spans.push([start, i]); start = i + 1; }
		if (i < 0) break;
	}
	spans.push([start, to]);
	return spans;
}

function resolveRelative(text, row, col, ctx, depth) {
	let out = "";
	for (let i = 0; i < text.length;) {
		const char = text[i];
		if (char === '"' || char === "'") {
			const end = stringEnd(text, i);
			out += text.slice(i, end);
			i = end;
			continue;
		}
		if (char !== "{" && char !== "[") { out += char; i++; continue; }
		const close = matching(text, i);
		if (close < 0) throw new FormulaError("#ERROR!", `Unclosed ${char} in formula`);
		const inner = text.slice(i + 1, close);
		i = close + 1;
		// [1, 2; 3, 4] stays a matrix literal; a single expression in [] is a column calculation.
		if (char === "[" && splitTopLevel(inner, 0, inner.length, ",;").length > 1) {
			out += `[${resolveRelative(inner, row, col, ctx, depth)}]`;
			continue;
		}
		const base = char === "{" ? row : col;
		const resolved = resolveRelative(inner, row, col, ctx, depth).trim();
		const source = resolved === "" ? String(base) : /^[+-]/.test(resolved) ? `${base}${resolved}` : resolved;
		const value = unwrap(evaluateExpression(source, row, col, ctx, depth + 1));
		const index = isArray(value) ? NaN : Number(num(value));
		if (isArray(value) || !math.isInteger(num(value)) || !Number.isInteger(index) || index < 0) {
			const kind = char === "{" ? "row" : "column";
			throw new FormulaError("#REF!", `Relative ${kind} ${char}${inner}${char === "{" ? "}" : "]"} evaluated to ${value}, not a valid ${kind} number`);
		}
		out += char === "{" ? String(index) : columnLabel(index);
	}
	return out;
}

// Legacy SUMIF(range, =14, values): quote unquoted criteria so mathjs can parse them.
function quoteCriteria(text) {
	const call = /\b(SUMIF|COUNTIF|AVGIF)\s*\(/g;
	let position = 0;
	for (;;) {
		const inString = new Uint8Array(text.length);
		for (let i = 0; i < text.length;) {
			if (text[i] === '"' || text[i] === "'") {
				const end = stringEnd(text, i);
				inString.fill(1, i, end);
				i = end;
			} else i++;
		}
		call.lastIndex = position;
		let match;
		do match = call.exec(text); while (match && inString[match.index]);
		if (!match) return text;
		const open = match.index + match[0].length - 1;
		position = open + 1;
		const close = matching(text, open);
		if (close < 0) return text;
		const spans = splitTopLevel(text, open + 1, close);
		if (spans.length < 2) continue;
		const [start, end] = spans[1];
		const criteria = text.slice(start, end).trim();
		if (/^[=!<>]/.test(criteria)) text = text.slice(0, start) + JSON.stringify(criteria) + text.slice(end);
	}
}

export function normaliseFormula(source, row, col, ctx, depth = 0) {
	let text = String(source).replace(/^\s*=/, "");
	text = mapOutsideStrings(text, segment => segment
		.replace(/\bTHISROW\b/g, row).replace(/\bTHISCOL\b/g, col)
		.replace(/\bPREVROW\b/g, row - 1).replace(/\bPREVCOL\b/g, col - 1));
	text = resolveRelative(text, row, col, ctx, depth);
	text = quoteCriteria(text);
	return mapOutsideStrings(text, segment => segment
		.replace(/<>/g, "!=")
		.replace(/(?<![=!<>])=(?!=)/g, "==")
		.replace(/\b([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\b/g, "RANGE__$1__$2"));
}

function evaluateExpression(source, row, col, ctx, depth) {
	if (depth > 50) throw new FormulaError("#ERROR!", "Relative references are nested too deeply");
	// Defer coordinate calculations until their AST node is evaluated. Eager substitution would read
	// cells in an unused IF branch and would put relative-reference errors outside IFERROR's boundary.
	let deferred = '', at = 0;
	const references = new Map();
	source = quoteCriteria(String(source));
	const spans = new Map(referenceSpans(source).map(span => [span.start, span]));
	while (at < source.length) {
		const span = spans.get(at);
		if (!span && (source[at] === '"' || source[at] === "'")) {
			const end = stringEnd(source, at); deferred += source.slice(at, end); at = end; continue;
		}
		const bracket = !span && '[{'.includes(source[at]) ? matching(source, at) : -1;
		const end = span?.end ?? (bracket < 0 ? at + 1 : bracket + 1);
		const token = source.slice(at, end);
		// Matrix literals must keep their ArrayNode; defer only actual reference/calculation syntax.
		const matrix = token[0] === '[' && !span && splitTopLevel(token, 1, token.length - 1, ',;').length > 1;
		if (matrix) { deferred += '['; at++; continue; }
		if (span?.sheetName !== undefined) {
			const name = `DFREF__${references.size}`;
			references.set(name, () => {
				if (span.prefix === '#REF!' || !ctx.sheet) throw new FormulaError('#REF!', `Unknown sheet: ${span.sheetName}`);
				return evaluateExpression(span.reference, row, col, ctx.sheet(span.sheetName), depth + 1);
			});
			deferred += name;
		} else if (!matrix && /[\[{}]/.test(token) && (span || bracket >= 0)) {
			const name = `DFREF__${references.size}`;
			references.set(name, () => evaluateExpression(normaliseFormula(token, row, col, ctx, depth + 1), row, col, ctx, depth + 1));
			deferred += name;
		} else deferred += token;
		at = end;
	}
	const text = normaliseFormula(deferred, row, col, ctx, depth);
	if (text.trim() === "") return "";
	let tree;
	try {
		tree = math.parse(text);
	} catch (error) {
		throw new FormulaError(error.message);
	}
	return normalise(evaluateNode(tree, { ...ctx, references }));
}

/**
 * Evaluate a formula (with or without the leading "=") for the cell at row/col.
 * Returns a scalar or a 2D array (1×1 arrays are returned as scalars); throws Error/FormulaError.
 * Real numbers remain BigNumbers until the sheet converts them with toCellValue.
 */
export function evaluateFormula(source, row, col, ctx) {
	const value = evaluateExpression(source, row, col, ctx, 0);
	return unwrap(value);
}

export default class Formulas {
	constructor() {
		Formulas.instance = this;
	}

	evaluate(source, row, col, ctx) {
		return evaluateFormula(source, row, col, ctx);
	}

	replaceVariables(expr, row, col) {
		expr = expr.replaceAll("{-", "{THISROW-");
		expr = expr.replaceAll("{}", "{THISROW}");
		expr = expr.replaceAll("{+", "{THISROW+");

		expr = expr.replaceAll("[-", "[THISCOL-");
		expr = expr.replaceAll("[]", "[THISCOL]");
		expr = expr.replaceAll("[+", "[THISCOL+");

		expr = expr.replaceAll("THISROW", row);
		expr = expr.replaceAll("THISCOL", col);
		expr = expr.replaceAll("PREVROW", row - 1);
		expr = expr.replaceAll("PREVCOL", col - 1);
		return expr;
	}

	replaceSUM(expr) {
		expr = expr.replace(/SUM\(([^)]+)\)/g, (match, array) => {
			try {
				//let result = JSON.parse(array.split("<nExTProP*!>")[1]).SUM;
				let result = this.getObjectFromTag(array).SUM;
				return result;
			}
			catch(e) {
				return e.message;
			}
		});

		return expr;
	}

	replaceAVG(expr) {
		expr = expr.replace(/AVG\(([^)]+)\)/g, (match, array) => {
			//return JSON.parse(array).AVG;
			try {
				let result = this.getObjectFromTag(array).AVG;
				return result;
			}
			catch(e) {
				return e.message;
			}
		});
		expr = expr.replace(/MEAN\(([^)]+)\)/g, (match, array) => {
			//return JSON.parse(array).AVG;
			try {
				let result = this.getObjectFromTag(array).AVG;
				return result;
			}
			catch(e) {
				return e.message;
			}
		});

		return expr;
	}

	getObjectFromTag(tag) {
		return JSON.parse(tag.split("<nExTProP*!>")[1]);
	}

	replaceSUMIF(expr) {
		expr = expr.replace(/SUMIF\(([^)]+)\)/g, (match, contents) => {
			//const props = contents.split(",");
			//const conRange = JSON.parse(props[0]).ARRAY;
			const props = contents.split("<nExTProP*!>");
			const conRange = JSON.parse(props[1]).ARRAY;
			const crit = props[2].substring(1, props[2].length - 1);
			const valRange = JSON.parse(props[3]).ARRAY;

			let sum = 0;
			let term = crit.substring(1);
			for (let i = 0; i < valRange.length; i++) {
				if (crit[0] == "=" && conRange[i] == term) {
					sum += Number(valRange[i]);
				}
				else if (crit[0] == "!" && conRange[i] != term) {
					sum += Number(valRange[i]);
				}
				else if (crit[0] == "<" && conRange[i] < term) {
					sum += Number(valRange[i]);
				}
				else if (crit[0] == ">" && conRange[i] > term) {
					sum += Number(valRange[i]);
				}
			}

			return sum;
		});

		return expr;
	}

	replaceCOUNTIF(expr) {
		expr = expr.replace(/COUNTIF\(([^)]+)\)/g, (match, contents) => {
			const props = contents.split("<nExTProP*!>");
			const conRange = JSON.parse(props[1]).ARRAY;
			const crit = props[2].substring(1, props[2].length - 1);
			const valRange = JSON.parse(props[3]).ARRAY;

			let count = 0;
			let term = crit.substring(1);
			for (let i = 0; i < valRange.length; i++) {
				if (crit[0] == "=" && conRange[i] == term) {
					count ++;
				}
			}

			return count;
		});

		return expr;
	}

	replaceAVGIF(expr) {
		expr = expr.replace(/AVGIF\(([^)]+)\)/g, (match, contents) => {
			const props = contents.split("<nExTProP*!>");
			const conRange = JSON.parse(props[1]).ARRAY;
			const crit = props[2].substring(1, props[2].length - 1);
			const valRange = JSON.parse(props[3]).ARRAY;

			let count = 0;
			let sum = 0;
			let term = crit.substring(1);
			for (let i = 0; i < valRange.length; i++) {
				if (crit[0] == "=" && conRange[i] == term) {
					sum += Number(valRange[i]);
					count ++;
				}
			}

			return sum/count;
		});

		return expr;
	}


	replaceCOUNT(expr) {
		expr = expr.replace(/COUNT\(([^)]+)\)/g, (match, array) => {
			return this.getObjectFromTag(array).COUNT;
		});
		return expr;
	}


	replaceReferences(expr, sheetManager) {
		// replacing cell references with their values
		expr = expr.replace(/\b([A-Z]+)(\d+)\b/g, (match, letters, number) => {
			const value = sheetManager.getValue(Number(number), columnIndex(letters));
			if (value?.kind === "chart") throw new Error("Chart cells cannot be used in numeric formulas");
			return value;
		});
		
		return expr;
	}

	// evaluated curly bracs, which can be used to use a calculation to choose a row in formulas
	evaluateRefCalcs(expr, sheetManager) {
		expr = expr.replaceAll(/\{([^}]+)\}/g, (match, expression) => {
			try {
				// Evaluate the expression within the curly braces
				const result = math.evaluate(this.replaceReferences(expression, sheetManager));
				return result; // Replace the match with the result
			}
			catch (error) {
				// cycle detection and speculative-evaluation aborts must reach the sheet engine
				if (error?.uncatchable) throw error;
				console.error(`Error evaluating expression "${expression}":`, error);
				return match; // If evaluation fails, return the original match
			}
		});
		return expr;
	}
	evaluateLetterRefCalcs(expr, sheetManager) {
		expr = expr.replaceAll(/\[([^\]]+)\]/g, (match, expression) => {
			try {
				// Evaluate the expression within the curly braces
				const result = math.evaluate(this.replaceReferences(expression, sheetManager));
				return columnLabel(Number(result));
			}
			catch (error) {
				// cycle detection and speculative-evaluation aborts must reach the sheet engine
				if (error?.uncatchable) throw error;
				console.error(`Error evaluating expression "${expression}":`, error);
				return match; // If evaluation fails, return the original match
			}
		});
		return expr;
	}

	replaceCellRanges(expr, row, col, sheetManager) {
		let circularLogic = false;
		// replace cell ranges (e.g. A0:A20) with objects
		expr = expr.replace(/\b([A-Z]+\d+):([A-Z]+\d+)\b/g, (match, start, end) => {

			// Extract column and row for start and end cells
			const startCol = start.match(/[A-Z]+/)[0].charCodeAt(0) - 65;
			const startRow = parseInt(start.match(/\d+/)[0]);
			const endCol = end.match(/[A-Z]+/)[0].charCodeAt(0) - 65;
			const endRow = parseInt(end.match(/\d+/)[0]);

			// check that the cell is outside the range
			if (startCol <= col && col <= endCol && startRow <= row && row <= endRow) {
				circularLogic = true;
				console.error("Circular reference detected for range:", match);
				return JSON.stringify({ error: "Circular Reference Detected" });
			}

			let sum = 0;
			let values = [];
			let count = 0;

			// Iterate through the range and collect values
			for (let i = startRow; i <= endRow; i++) {
				for (let j = startCol; j <= endCol; j++) {
					const value = sheetManager.getValue(i, j);
					if (value?.kind === "chart") throw new Error("Chart cells cannot be used in numeric formulas");
					sum += Number(value);
					values.push(value);
					count++;
				}
			}

			// Calculate average
			const average = sum / count;

			// Return JSON string with results
			return "<nExTProP*!>" + JSON.stringify({
				SUM: sum,
				ARRAY: values,
				COUNT: count,
				AVG: average
			}) + "<nExTProP*!>";
		});
		
		if (!circularLogic) {
			return expr;
		}

		return "circular";
	}
}
