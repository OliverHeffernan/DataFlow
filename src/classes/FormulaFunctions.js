// Keep decimal values throughout evaluation, including intermediate cell results. Native numbers
// are only produced at the sheet's display/API boundary, not between arithmetic operations.
const config = { number: 'BigNumber', precision: 64, relTol: 1e-64, absTol: 0 }
import { create, all } from 'mathjs'
import { extractLambdas } from './FormulaLambda.js';
import { FormulaError, AnyType, NumberType, TextType, BooleanType, ScalarType, NumericInputType, ConditionType, ArrayType, RowType, TableType, RecordType, StreamType, OptionalType, LambdaType, typeOf, typeParameter, union, parameter, defineFunction, validateArguments, validateResult, resultType } from './FormulaTypes.js';
import { mathSignatures } from './FormulaMathSignatures.js';
export { FormulaError } from './FormulaTypes.js';
const math = create(all, config)
// Cache syntax only. Values, deferred references, pure-mode checks and RNG calls stay per evaluation.
const expressionTrees = new Map();
const T = typeParameter('T'), U = typeParameter('U'), A = typeParameter('A');
StreamType.itemParameter = OptionalType.itemParameter = T;
const ArrayInputType = union(ScalarType, ArrayType.of(ScalarType));
const ConditionInputType = union(ConditionType, ArrayType.of(ConditionType));

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
function normalise(value, expressionValue = false) {
	if (value && typeof value.toArray === "function" && math.isMatrix(value)) value = value.toArray();
	if (value === undefined || value === null) return "";
	const type = typeOf(value);
	if (expressionValue && (StreamType.accepts(value) || OptionalType.accepts(value) || LambdaType.accepts(value) || RecordType.accepts(value))) return value;
	if (!expressionValue) {
		const presentation = type.present(value);
		if (presentation.kind === 'record' || type.base === RowType) return streamTable(stream(function* () { yield value; }, null));
		value = presentation.value;
	}
	if (!isArray(value)) return value;
	if (value.length === 0) throw new FormulaError("#CALC!", "The result is an empty array");
	if (!value.some(isArray)) return [value.map(scalar)];
	if (!value.every(isArray)) throw new FormulaError("#VALUE!", "Arrays must be rectangular");
	const width = value[0].length;
	if (width === 0 || value.some(row => row.length !== width)) throw new FormulaError("#VALUE!", "Arrays must be rectangular");
	return value.map(row => row.map(scalar));
}

function scalar(value) {
	if (StreamType.accepts(value) || OptionalType.accepts(value) || LambdaType.accepts(value)) typeOf(value).present(value);
	if (RecordType.accepts(value)) throw new FormulaError('#VALUE!', 'A record is not a scalar; select a field or convert it to a table');
	if (isArray(value) || math.isMatrix(value)) throw new FormulaError("#VALUE!", "Arrays with more than two dimensions are not supported");
	return value ?? "";
}

function num(value) {
	scalar(value);
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
	scalar(value);
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
	scalar(a); scalar(b);
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

// Record keys deliberately differ from spreadsheet comparisons: blanks never match, booleans
// are distinct from numbers, and decimals compare exactly rather than with mathjs's tolerance.
function recordKeys(array, name, argument) {
	return array.map((row, r) => {
		let blank = false;
		const parts = row.map((value, c) => {
			if (typeof value === "number") value = math.bignumber(String(value));
			if (math.isBigNumber(value) && value.isFinite()) return ["number", value.toString()];
			if (typeof value === "boolean") return ["boolean", value];
			if (typeof value === "string") {
				if (value === "") blank = true;
				return ["text", value];
			}
			throw new FormulaError("#VALUE!", `${name} ${argument} key at row ${r}, column ${c} must be text, a boolean, or a finite real number`);
		});
		// JSON preserves component boundaries and escaping; decimal strings preserve precision.
		return blank ? null : JSON.stringify(parts);
	});
}

function matchingRows(name, queryKeys, sourceKeys) {
	if (queryKeys[0].length !== sourceKeys[0].length) {
		throw new FormulaError("#VALUE!", `${name} key arrays must have the same number of columns (got ${shapeText(queryKeys)} and ${shapeText(sourceKeys)})`);
	}
	const queries = recordKeys(queryKeys, name, "query");
	const sources = recordKeys(sourceKeys, name, "source");
	const index = new Map();
	sources.forEach((key, row) => {
		if (key === null) return;
		if (!index.has(key)) index.set(key, []);
		index.get(key).push(row);
	});
	return queries.map(key => index.get(key) ?? []);
}

function checkMatchSize(name, rows, cols) {
	if (rows * cols > 1_000_000) {
		throw new FormulaError("#CALC!", `${name} result ${rows}×${cols} exceeds the limit of 1,000,000 cells`);
	}
}

// Spreadsheet functions receive unevaluated argument nodes, so IF/IFERROR/FILTER can be lazy.
export const formulaFunctions = {
	rowstream: defineFunction({ parameters: [parameter('rangeIncludingHeadings', ArrayInputType)], returns: StreamType.of(RecordType),
		description: 'Read a range or array as headed records. The first row supplies unique nonblank text field names; remaining rows are read lazily. No terminal operation is implied.',
		errors: ['#VALUE!: invalid headings or source shape; source/reference errors propagate when read.'], examples: ['rowstream(VSTACK("age",23,19)).toTable()'], run(args, evaluate, ctx) {
		arity('rowstream', args, 1);
		const iterator = streamRows(args[0], ctx, evaluate)[Symbol.iterator]();
		const first = iterator.next();
		if (first.done) throw new FormulaError('#VALUE!', 'rowstream requires a header row');
		const headers = first.value;
		validateStreamHeaders(headers);
		return stream(function* () {
			for (let next = iterator.next(); !next.done; next = iterator.next()) {
				yield record(headers.map((name, index) => [name, next.value[index]]));
			}
		}, { kind: 'record', headers });
	} }),
	SUM: defineFunction({ parameters: [parameter('values', ArrayInputType, { rest: true, required: true })], returns: ScalarType,
		description: 'Sum numeric values across all cells in all arguments. Text and blanks are ignored; booleans count as 1/0. Ordinary real inputs return Number; compatible mathjs numeric values retain their numeric type. Unlike Stream.sum, numeric text literals are not converted.',
		errors: ['Source errors propagate; charts and unresolved expression values are not numeric inputs.'], examples: ['SUM(0.1,0.2)', 'SUM(VSTACK(2,"ignored",3))'],
		run: (args, evaluate) => sumOf(args.map(evaluate)) }),
	COUNT: defineFunction({ parameters: [parameter('values', ArrayInputType, { rest: true, required: true })], returns: NumberType,
		description: 'Count all cells, including text and blanks. This preserves DataFlow compatibility, not Excel numeric-only COUNT.', examples: ['COUNT(VSTACK(2,"", "text"))'], run: (args, evaluate) => flat(args.map(evaluate)).length }),
	AVG: defineFunction({ parameters: [parameter('values', ArrayInputType, { rest: true, required: true })], returns: ScalarType,
		description: 'Divide SUM by COUNT of all supplied cells, including text/blanks in the divisor. Ordinary real inputs return Number; compatible mathjs numeric inputs retain their numeric type. This is not Stream.average and does not return Optional.', examples: ['AVG(VSTACK(2,"",4))'], run: (args, evaluate) => average('AVG', args, evaluate) }),
	MEAN: defineFunction({ parameters: [parameter('values', ArrayInputType, { rest: true, required: true })], returns: ScalarType,
		description: 'Alias of AVG: numeric sum divided by every supplied cell, including text/blanks. Returns Number for ordinary real inputs.', examples: ['MEAN(2,4)'], run: (args, evaluate) => average('MEAN', args, evaluate) }),
	SUMIF: defineFunction({ parameters: [parameter('conditionRange', ArrayInputType), parameter('criteria', ScalarType), parameter('valueRange', ArrayInputType, { optional: true })], returns: ScalarType,
		description: 'Sum numeric values whose corresponding condition matches criteria. Omitted valueRange uses conditionRange. Flattened input cell counts must match. Criteria accept =, <>, !=, !, <, >, <=, >= and legacy unquoted syntax; no range-valued criteria. Text values are ignored, booleans count as 1/0.',
		errors: ['#VALUE!: mismatched cell counts; source errors propagate.'], examples: ['SUMIF(VSTACK(1,3),">1",VSTACK(10,20))'], run: (args, evaluate) => conditional('SUMIF', args, evaluate) }),
	COUNTIF: defineFunction({ parameters: [parameter('conditionRange', ArrayInputType), parameter('criteria', ScalarType), parameter('legacyIgnoredRange', ArrayInputType, { optional: true })], returns: NumberType,
		description: 'Count cells matching the same comparison criteria as SUMIF. The optional legacy third argument is accepted but not evaluated or used.', examples: ['COUNTIF(VSTACK(1,3),">1")'], run: (args, evaluate) => conditional('COUNTIF', args, evaluate) }),
	AVGIF: defineFunction({ parameters: [parameter('conditionRange', ArrayInputType), parameter('criteria', ScalarType), parameter('valueRange', ArrayInputType, { optional: true })], returns: ScalarType,
		description: 'Divide the matching numeric sum by the number of matching conditions, including matches with nonnumeric values. Omitted valueRange uses conditionRange. Criteria and flattened dimensions follow SUMIF. Does not return Optional.',
		errors: ['#DIV/0!: no matches; #VALUE!: mismatched cell counts.'], examples: ['AVGIF(VSTACK(1,3),">1",VSTACK(10,20))'], run: (args, evaluate) => conditional('AVGIF', args, evaluate) }),
	IF: defineFunction({ parameters: [parameter('condition', ConditionType), parameter('whenTrue', T, { lazy: true }), parameter('whenFalse', U, { optional: true, lazy: true })], returns: union(T, U, BooleanType),
		description: 'Evaluate only the branch selected by one scalar condition. Omitted whenFalse returns FALSE. Branches may return different types or arrays; the return type is their union. Errors in unused branches are not evaluated.',
		errors: ['#VALUE!: array condition or invalid condition conversion.'], examples: ['IF(TRUE,7,1/0)'], run(args, evaluate) {
		arity("IF", args, 2, 3);
		const condition = unwrap(evaluate(args[0]));
		if (isArray(condition)) throw new FormulaError("#VALUE!", "IF needs a single condition; use FILTER or AND/OR masks for arrays");
		if (truthy(condition)) return evaluate(args[1]);
		return args.length === 3 ? evaluate(args[2]) : false;
	} }),
	IFERROR: defineFunction({ parameters: [parameter('value', T, { lazy: true }), parameter('fallback', U, { lazy: true })], returns: union(T, U),
		description: 'Evaluate value, using fallback only if evaluation fails. Error-looking text is not an error. Cycles and aborted evaluations cannot be hidden. This handles errors, not empty Optionals.', examples: ['IFERROR(1/0,"Unavailable")'], run(args, evaluate) {
		arity("IFERROR", args, 2);
		try {
			return evaluate(args[0]);
		} catch (error) {
			if (isUncatchable(error)) throw error;
			return evaluate(args[1]);
		}
	} }),
	FILTER: defineFunction({ parameters: [parameter('array', ArrayInputType), parameter('include', ConditionInputType), parameter('ifEmpty', U, { optional: true, lazy: true })], returns: union(ArrayType.of(T), U),
		description: 'Keep rows with a true mask value, in source order. Include must be one column or one row with exactly one condition per input row. Scalars promote to 1×1 arrays. Headers are ordinary rows. Fallback evaluates only if no rows match; without it no matches is an error, not Optional.empty.',
		errors: ['#VALUE!: invalid mask dimensions; #CALC!: no matches without ifEmpty; #SPILL!: occupied or out-of-sheet output.'], examples: ['FILTER(VSTACK(2,5),VSTACK(FALSE,TRUE))'], run(args, evaluate) {
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
	} }),
	LOOKUP: defineFunction({ parameters: [parameter('queryKeys', ArrayInputType), parameter('sourceKeys', ArrayInputType), parameter('values', ArrayInputType), parameter('ifMissing', ArrayInputType, { optional: true, lazy: true })], returns: ArrayType.of(T),
		description: 'Return one values row per query key row, preserving query order. Key widths must match; sourceKeys and values need the same height. Multiple key columns form exact composite keys. Text is case/whitespace sensitive; numeric decimals match exactly; blank components never match. A missing-key fallback is a scalar filling the row, or a 1×output-width row, evaluated only if needed. Duplicate matches are errors even with a fallback. A 1×1 result displays as a scalar. Maximum output: 1,000,000 cells.',
		errors: ['#N/A: missing key without fallback; #VALUE!: duplicate matches, invalid keys/shapes/fallback; #CALC!: result too large; source and spill errors propagate.'], examples: ['LOOKUP("P2",VSTACK("P1","P2"),VSTACK(10,20))'], run(args, evaluate) {
		arity("LOOKUP", args, 3, 4);
		const [queries, keys, values] = args.slice(0, 3).map(arg => to2D(evaluate(arg)));
		if (keys.length !== values.length) {
			throw new FormulaError("#VALUE!", `LOOKUP sourceKeys and values must have the same number of rows (got ${shapeText(keys)} and ${shapeText(values)})`);
		}
		const matches = matchingRows("LOOKUP", queries, keys);
		const duplicate = matches.findIndex(rows => rows.length > 1);
		if (duplicate >= 0) {
			throw new FormulaError("#VALUE!", `LOOKUP query row ${duplicate} matches multiple source rows ${matches[duplicate].join(", ")}; use JOIN for all matches`);
		}
		const width = values[0].length;
		checkMatchSize("LOOKUP", queries.length, width);
		const missing = matches.findIndex(rows => !rows.length);
		let fallback;
		if (missing >= 0) {
			if (args.length < 4) throw new FormulaError("#N/A", `LOOKUP query row ${missing} has no match`);
			const value = unwrap(evaluate(args[3]));
			if (isArray(value) && (value.length !== 1 || value[0].length !== width)) {
				throw new FormulaError("#VALUE!", `LOOKUP ifMissing must be a scalar or 1×${width} row (got ${shapeText(value)})`);
			}
			fallback = isArray(value) ? value[0] : Array(width).fill(value);
		}
		return matches.map(rows => [...(rows.length ? values[rows[0]] : fallback)]);
	} }),
	JOIN: defineFunction({ parameters: [parameter('left', ArrayInputType), parameter('leftKeys', ArrayInputType), parameter('right', ArrayInputType), parameter('rightKeys', ArrayInputType), parameter('kind', TextType, { optional: true, default: 'left' })], returns: ArrayType.of(ScalarType),
		description: 'Return all matching pairs: left columns followed by right columns, in left then right source order. Data/key heights and key widths must match. Exact composite-key semantics follow LOOKUP. Duplicate keys produce every pair. Kind "left" keeps unmatched left rows padded with blanks; "inner" omits them. No sorting or deduplication. Headers are ordinary rows. Maximum output: 1,000,000 cells.',
		errors: ['#VALUE!: invalid kind, keys or shapes; #CALC!: no inner matches or output too large; source and spill errors propagate.'], examples: ['JOIN(VSTACK("a","b"),VSTACK(1,2),"x",2)'], run(args, evaluate) {
		arity("JOIN", args, 4, 5);
		const [left, leftKeys, right, rightKeys] = args.slice(0, 4).map(arg => to2D(evaluate(arg)));
		const kind = args.length === 5 ? unwrap(evaluate(args[4])) : "left";
		if (kind !== "left" && kind !== "inner") throw new FormulaError("#VALUE!", 'JOIN kind must be "left" or "inner"');
		if (left.length !== leftKeys.length || right.length !== rightKeys.length) {
			throw new FormulaError("#VALUE!", `JOIN each data array and its keys must have the same number of rows (left ${shapeText(left)}, keys ${shapeText(leftKeys)}; right ${shapeText(right)}, keys ${shapeText(rightKeys)})`);
		}
		const matches = matchingRows("JOIN", leftKeys, rightKeys);
		const rows = matches.reduce((total, match) => total + (match.length || (kind === "left" ? 1 : 0)), 0);
		checkMatchSize("JOIN", rows, left[0].length + right[0].length);
		if (!rows) throw new FormulaError("#CALC!", "JOIN found no matching rows");
		const padding = Array(right[0].length).fill("");
		const result = [];
		left.forEach((row, i) => {
			if (matches[i].length) matches[i].forEach(j => result.push([...row, ...right[j]]));
			else if (kind === "left") result.push([...row, ...padding]);
		});
		return result;
	} }),
	VSTACK: defineFunction({ parameters: [parameter('array', ArrayInputType, { rest: true, required: true })], returns: ArrayType.of(ScalarType),
		description: 'Stack arrays vertically in argument order. Scalars promote to 1×1. Every input must have the same width; no padding or implicit headers.', errors: ['#VALUE!: incompatible widths; normal spill protection applies.'], examples: ['VSTACK(2,5)'], run: (args, evaluate) => stack('VSTACK', args.map(arg => to2D(evaluate(arg)))) }),
	HSTACK: defineFunction({ parameters: [parameter('array', ArrayInputType, { rest: true, required: true })], returns: ArrayType.of(ScalarType),
		description: 'Stack arrays horizontally in argument order. Scalars promote to 1×1. Every input must have the same height; no padding or implicit headers.', errors: ['#VALUE!: incompatible heights; normal spill protection applies.'], examples: ['HSTACK(2,5)'], run: (args, evaluate) => stack('HSTACK', args.map(arg => to2D(evaluate(arg)))) }),
	AND: defineFunction({ parameters: [parameter('condition', ConditionInputType, { rest: true, required: true })], returns: union(BooleanType, ArrayType.of(BooleanType)),
		description: 'Combine conditions elementwise with AND. All arguments evaluate; scalars broadcast, while arrays must have the same shape. Uses spreadsheet condition conversion, not JavaScript truthiness.', errors: ['#VALUE!: invalid condition or shape mismatch.'], examples: ['AND(VSTACK(TRUE,FALSE),TRUE)'], run: (args, evaluate) => logical('AND', args, evaluate, (a, b) => a && b) }),
	OR: defineFunction({ parameters: [parameter('condition', ConditionInputType, { rest: true, required: true })], returns: union(BooleanType, ArrayType.of(BooleanType)),
		description: 'Combine conditions elementwise with OR. All arguments evaluate; scalars broadcast and arrays require the same shape.', errors: ['#VALUE!: invalid condition or shape mismatch.'], examples: ['OR(FALSE,TRUE)'], run: (args, evaluate) => logical('OR', args, evaluate, (a, b) => a || b) }),
	NOT: defineFunction({ parameters: [parameter('condition', ConditionInputType)], returns: union(BooleanType, ArrayType.of(BooleanType)),
		description: 'Invert a scalar condition or every element of a condition array, preserving shape.', errors: ['#VALUE!: invalid condition conversion.'], examples: ['NOT(FALSE)'], run(args, evaluate) {
		arity("NOT", args, 1);
		return elementwise(evaluate(args[0]), value => !truthy(value));
	} }),
	SORT: defineFunction({ parameters: [parameter('array', ArrayInputType), parameter('columnIndex', NumericInputType, { optional: true, default: 0 }), parameter('sortOrder', NumericInputType, { optional: true, default: 1 })], returns: ArrayType.of(T),
		description: 'Stable row sort by a zero-based column index within the array. Order is 1 ascending or -1 descending; blanks are always last. Headers, if supplied, are ordinary data. Column and order must be integers.',
		errors: ['#VALUE!: invalid column/order or numeric conversion; normal spill protection applies.'], examples: ['SORT(VSTACK(5,2),0,1)'], run(args, evaluate) {
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
	} }),
	UNIQUE: defineFunction({ parameters: [parameter('array', ArrayInputType)], returns: ArrayType.of(T),
		description: 'Keep the first occurrence of each distinct row, preserving source order. Equality is type-sensitive across fields: text "1", number 1 and TRUE are different.', examples: ['UNIQUE(VSTACK(2,2,5))'], run(args, evaluate) {
		arity("UNIQUE", args, 1);
		const seen = new Set();
		return to2D(evaluate(args[0])).filter(row => {
			const key = JSON.stringify(row.map(value => [math.isBigNumber(value) ? 'number' : typeof value, String(value)]));
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}).map(row => [...row]);
	} }),
};
const FUNCTIONS = formulaFunctions;

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

// Conditional formatting uses the same expression evaluator, but cannot advance an RNG, modify the
// math instance, invoke callbacks or acquire new capabilities when mathjs adds an export.
const PURE_MATH = new Set([
	'abs', 'sqrt', 'cbrt', 'round', 'floor', 'ceil', 'fix', 'min', 'max', 'sum', 'mean', 'median',
	'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'log', 'log10', 'log2', 'exp', 'pow', 'mod',
	'isNumeric', 'isNaN', 'isInteger', 'isPositive', 'isNegative', 'isZero', 'equalText', 'compareText',
]);

// The imported library owns its prose and public overload declarations. Bind both to
// its actual implementation here; never maintain a second handwritten library catalog.
export const mathFunctions = Object.fromEntries(Object.keys(math).filter(name => typeof math[name] === 'function' && !BLOCKED_MATH.has(name)).map(name => {
	let documentation;
	try { documentation = math.help(name).doc; } catch { documentation = {}; }
	const overloads = mathSignatures[name] ?? [];
	const signatures = Object.keys(math[name].signatures ?? {});
	const numberOnly = signatures.some(signature => /\bnumber\b/.test(signature)) && !signatures.some(signature => /\b(?:BigNumber|any)\b/.test(signature));
	return [name, defineFunction({ parameters: overloads[0]?.parameters ?? [parameter('arguments', AnyType, { rest: true })], returns: overloads.length ? union(...overloads.map(overload => overload.returns)) : AnyType,
		description: Array.isArray(documentation.description) ? documentation.description.join('\n') : documentation.description ?? `mathjs ${name}. No upstream prose is supplied; refer to the declared/runtime overloads below.`,
		category: documentation.category ?? 'Library', overloads, syntax: documentation.syntax ?? [], runtimeSignatures: signatures, library: true, pure: PURE_MATH.has(name), nativeNumbers: numberOnly,
		examples: documentation.examples ?? [], errors: ['Library type/domain/shape errors propagate. Spreadsheet inputs use two-dimensional arrays, blank becomes 0, and unresolved Stream/Optional/Lambda or record inputs are rejected. JavaScript callback overloads are unavailable; use stream methods. Native library array outputs must normalize to a nonempty rectangular array of scalar cells.'],
		run(args, evaluate) {
			const toMath = value => { scalar(value); return value === '' ? 0 : value?.kind === 'chart' ? num(value) : value; };
			const values = args.map(evaluate).map(value => isArray(value) ? map2D(value, toMath) : toMath(value));
			return normalise(math[name](...values.map(value => numberOnly ? toCellValue(value) : value)));
		} })];
}));

function validatePureTree(tree) {
	const supported = new Set(['ConstantNode', 'ParenthesisNode', 'SymbolNode', 'ConditionalNode', 'ArrayNode', 'RangeNode', 'RelationalNode', 'OperatorNode', 'FunctionNode', 'ObjectNode', 'AccessorNode', 'IndexNode']);
	tree.traverse(node => {
		if (!supported.has(node.type)) throw new FormulaError('#VALUE!', `Unsupported predicate syntax: ${node.type}`);
		if (node.type === 'FunctionNode') {
			if (node.fn?.type === 'AccessorNode' && (StreamType.method(propertyName(node.fn)) || OptionalType.method(propertyName(node.fn)))) return;
			const name = node.fn?.type === 'SymbolNode' ? node.fn.name : '';
			if (!Object.hasOwn(FUNCTIONS, name) && !PURE_MATH.has(name)) throw new FormulaError('#NAME?', `Function ${name || node.toString()} is not available in conditional rules`);
		}
	});
}

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
		case 'ObjectNode':
			if (!ctx.streamExpression) throw new FormulaError('#VALUE!', 'Record literals are only available inside stream operations');
			return record(Object.entries(node.properties).map(([name, value]) => [name, evaluate(value)]));
		case 'AccessorNode': {
			const value = evaluate(node.object), name = propertyName(node);
			if (StreamType.accepts(value) || OptionalType.accepts(value)) throw new FormulaError('#VALUE!', 'Call a registered method with parentheses');
			if (!RecordType.accepts(value) || !Object.hasOwn(value, name)) throw new FormulaError('#VALUE!', `Unknown row field ${name}`);
			return value[name];
		}
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
			return operator(node, evaluate, ctx);
		case "FunctionNode":
			return call(node, ctx, evaluate);
		default:
			throw new FormulaError("#VALUE!", `Unsupported syntax: ${node.toString()}`);
	}
}

function symbol(name, ctx) {
	if (ctx.locals?.has(name)) return ctx.locals.get(name);
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

function operator(node, evaluate, ctx) {
	const { fn, args } = node;
	if (fn === 'add' && ctx.streamExpression) {
		return args.map(evaluate).reduce((a, b) => broadcast(a, b, (x, y) => {
			if (typeof x === 'string' || typeof y === 'string') return String(scalar(x)) + String(scalar(y));
			return math.add(num(x), num(y));
		}));
	}
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
	if (node.fn?.type === 'AccessorNode') {
		const value = evaluate(node.fn.object), name = propertyName(node.fn);
		if (!StreamType.accepts(value) && !OptionalType.accepts(value)) throw new FormulaError('#VALUE!', 'This value has no callable formula methods');
		const method = typeOf(value).method(name);
		if (!method) throw new FormulaError('#NAME?', `Unknown ${typeOf(value).name} method ${name}`);
		arity(name, node.args, method.min, method.max);
		const args = node.args.map((arg, i) => {
			const read = () => evaluateNode(arg, { ...ctx, streamExpression: true });
			return method.parameters[i]?.lazy ? read : read();
		});
		validateArguments(method, args);
		const returns = resultType(method, typeOf(value), args.map((arg, i) => method.parameters[i]?.lazy ? AnyType : typeOf(arg)));
		return validateResult({ ...method, returns }, method.run(value, args));
	}
	const name = node.fn?.type === "SymbolNode" ? node.fn.name : null;
	if (!name) throw new FormulaError("#VALUE!", `Unsupported function call: ${node.toString()}`);
	if (ctx.pure && !Object.hasOwn(FUNCTIONS, name) && !PURE_MATH.has(name)) throw new FormulaError('#NAME?', `Function ${name} is not available in conditional rules`);
	if (Object.hasOwn(FUNCTIONS, name)) {
		const definition = FUNCTIONS[name];
		arity(name, node.args, definition.min, definition.max);
		return definition.run(node.args, child => {
			const value = evaluate(child);
			if (StreamType.accepts(value) || OptionalType.accepts(value) || LambdaType.accepts(value)) typeOf(value).present(value);
			return value;
		}, ctx);
	}
	if (!Object.hasOwn(mathFunctions, name)) {
		throw new FormulaError("#NAME?", `Unknown function ${name}`);
	}
	return mathFunctions[name].run(node.args, evaluate);
}

/* ---------- lazy row streams ---------- */

function record(entries) {
	const value = Object.assign(Object.create(null), Object.fromEntries(entries));
	RecordType.of(Object.fromEntries(entries.map(([key, value]) => [key, typeOf(value)]))).brand(value);
	return Object.freeze(value);
}

function propertyName(node) {
	const dimensions = node.index.dimensions;
	if (dimensions.length !== 1 || dimensions[0].type !== 'ConstantNode' || typeof dimensions[0].value !== 'string') {
		throw new FormulaError('#VALUE!', 'Row fields and stream methods require a literal name');
	}
	return dimensions[0].value;
}

function validateStreamHeaders(headers) {
	if (!headers.length || headers.some(name => typeof name !== 'string' || !name.trim()) || new Set(headers).size !== headers.length) {
		throw new FormulaError('#VALUE!', 'Stream headings must be nonblank, unique text (case-sensitive)');
	}
}

function stream(values, schema) {
	const value = { values, schema };
	const itemType = schema?.kind === 'record' ? RecordType.of(Object.fromEntries(schema.headers.map(name => [name, AnyType]))) : AnyType;
	return StreamType.of(itemType).brand(value);
}

function referenceRows(source, row, col, ctx) {
	const span = referenceSpans(source)[0];
	if (span?.sheetName !== undefined) {
		if (span.prefix === '#REF!' || !ctx.sheet) throw new FormulaError('#REF!', `Unknown sheet: ${span.sheetName}`);
		return referenceRows(span.reference, row, col, ctx.sheet(span.sheetName));
	}
	const ref = resolveReference(source, row, col, ctx);
	const target = ref.sheetName ? ctx.sheet(ref.sheetName) : ctx;
	const args = [Math.min(ref.r0, ref.r1), Math.min(ref.c0, ref.c1), Math.max(ref.r0, ref.r1), Math.max(ref.c0, ref.c1)];
	return target.rangeRows ? target.rangeRows(...args) : target.range(...args);
}

function streamRows(node, ctx, evaluate) {
	if (node.type === 'ParenthesisNode') return streamRows(node.content, ctx, evaluate);
	if (node.type === 'SymbolNode') {
		const deferred = ctx.references?.get(node.name);
		if (deferred?.rows) return deferred.rows();
		const range = node.name.match(RANGE);
		if (range) return referenceRows(`${range[1]}${range[2]}:${range[3]}${range[4]}`, 0, 0, ctx);
	}
	return to2D(evaluate(node));
}

function callback(value, count) {
	if (!LambdaType.accepts(value) || value.params.length !== count) throw new FormulaError('#VALUE!', `Expected a lambda with ${count} parameter${count === 1 ? '' : 's'}`);
	return value.invoke;
}

function projectionSchema(lambda, original) {
	// Shape inference never reads cells or invokes a mapper, so an empty projection retains headings.
	let tree;
	try { tree = math.parse(lambda.body); } catch { return null; }
	while (tree.type === 'ParenthesisNode') tree = tree.content;
	if (tree.type === 'ObjectNode') return { kind: 'record', headers: Object.keys(tree.properties) };
	if (tree.type === 'ArrayNode') return { kind: 'row', headers: tree.items.map((_, i) => `column${i + 1}`) };
	if (tree.type === 'SymbolNode' && tree.name === lambda.params[0]) return original;
	return null;
}

function itemSchema(value) {
	if (RecordType.accepts(value)) return { kind: 'record', headers: Object.keys(value) };
	if (isArray(value)) {
		if (value.length !== 1) throw new FormulaError('#VALUE!', 'A stream item must be a scalar, record, or single row');
		return { kind: 'row', headers: value[0].map((_, i) => `column${i + 1}`) };
	}
	scalar(value);
	return { kind: 'scalar', headers: ['value'] };
}

function streamTable(input, headings = []) {
	const iterator = input.values()[Symbol.iterator](), first = iterator.next();
	const schema = first.done ? input.schema ?? { kind: 'scalar', headers: headings.length ? headings : ['value'] } : itemSchema(first.value);
	const headers = headings.length ? headings : schema.headers;
	validateStreamHeaders(headers);
	if (headers.length !== schema.headers.length) throw new FormulaError('#VALUE!', 'toTable headings must match the number of output columns');
	const table = [[...headers]];
	for (let next = first; !next.done; next = iterator.next()) {
		const value = next.value, actual = itemSchema(value);
		if (actual.kind !== schema.kind || actual.headers.length !== schema.headers.length
			|| (schema.kind === 'record' && schema.headers.some(name => !Object.hasOwn(value, name)))) {
			throw new FormulaError('#VALUE!', 'toTable requires the same fields and number of columns in every row');
		}
		checkMatchSize('toTable', table.length + 1, headers.length);
		table.push((schema.kind === 'record' ? schema.headers.map(name => value[name]) : schema.kind === 'row' ? value[0] : [value]).map(scalar));
	}
	return table;
}

function optional(value, present = true) {
	if (present && isArray(value)) RowType.of(AnyType).brand(value);
	return OptionalType.of(present ? typeOf(value) : AnyType).brand(Object.freeze({ present, value }));
}

function streamKey(value) {
	if (RecordType.accepts(value)) return ['record', Object.keys(value).sort().map(name => [name, streamKey(value[name])])];
	if (isArray(value)) return ['row', value.map(streamKey)];
	scalar(value);
	return [math.isBigNumber(value) ? 'number' : typeof value, String(value)];
}

function streamAggregate(input, kind) {
	let total = math.bignumber(0), count = 0;
	for (const item of input.values()) {
		const raw = unwrap(item);
		if (!NumericInputType.accepts(raw)) throw new FormulaError('#VALUE!', `${kind} requires numeric stream items; map a numeric field first`);
		const value = num(raw);
		if (kind === 'min' || kind === 'max') {
			if (!count || (kind === 'min' ? compareValues(value, total) < 0 : compareValues(value, total) > 0)) total = value;
		} else total = math.add(total, value);
		count++;
	}
	if (kind === 'sum') return total;
	return count ? optional(kind === 'average' ? math.divide(total, count) : total) : optional(undefined, false);
}

// Each operation owns its signature and iterator/terminal implementation. Adding a method requires
// no syntax changes. Only sorting, distinct's seen-set, and table results retain input values.
StreamType.methods = {
	filter: defineFunction({ parameters: [parameter('predicate', LambdaType.of(T, ConditionType))], returns: StreamType.of(T),
		description: 'Lazily keep items whose one-parameter predicate is true, preserving order and headings. Predicate results use spreadsheet condition conversion.', emptyBehavior: 'Returns an empty stream retaining its schema.', examples: ['rowstream(VSTACK("n",2,5)).filter(a->a.n>2).toTable()'], run(input, [lambda]) {
		const test = callback(lambda, 1);
		return stream(function* () { for (const value of input.values()) if (truthy(unwrap(test(value)))) yield value; }, input.schema);
	} }),
	map: defineFunction({ parameters: [parameter('mapper', LambdaType.of(T, U))], returns: StreamType.of(U),
		description: 'Lazily project each item to a scalar, immutable record, or positional row. Record keys become headings; literal record/row projections retain headings even if empty. Fields must be scalar when converted to a table. Inside callbacks + concatenates if either operand is text; otherwise it adds numerically.', emptyBehavior: 'No mapper invocations. Literal projection schema is retained.', errors: ['#VALUE!: invalid callback, duplicate/empty/reserved object keys or incompatible table fields.'], examples: ['rowstream(VSTACK("n",2,5)).map(a->{double:a.n*2}).toTable()'], run(input, [lambda]) {
		const project = callback(lambda, 1);
		return stream(function* () { for (const value of input.values()) yield project(value); }, projectionSchema(lambda, input.schema));
	} }),
	sorted: defineFunction({ parameters: [parameter('comparator', LambdaType.of(T, T, NumberType))], returns: StreamType.of(T),
		description: 'Stable sort with a two-parameter comparator returning a finite negative, zero or positive number. Buffers the input when consumed.', emptyBehavior: 'Empty stream with original schema.', errors: ['#VALUE!: invalid comparator or nonfinite comparison result.'], examples: ['rowstream(VSTACK("n",2,5)).sorted((a,b)->b.n-a.n).toTable()'], run(input, [lambda]) {
		const compare = callback(lambda, 2);
		return stream(function* () { yield* [...input.values()].sort((a, b) => {
			const result = num(unwrap(compare(a, b)));
			if (!math.isFinite(result)) throw new FormulaError('#VALUE!', 'A stream comparator must return a finite number');
			return Number(math.sign(result));
		}); }, input.schema);
	} }),
	distinct: defineFunction({ parameters: [], returns: StreamType.of(T),
		description: 'Keep the first structurally equal item, preserving order. Text, numbers and booleans are distinct types; record field order does not affect equality. Retains seen keys, not whole input tables.', emptyBehavior: 'Empty stream.', examples: ['rowstream(VSTACK("n",2,2,5)).distinct().count()'], run(input) {
		return stream(function* () {
			const seen = new Set();
			for (const value of input.values()) {
				const key = JSON.stringify(streamKey(value));
				if (!seen.has(key)) { seen.add(key); yield value; }
			}
		}, input.schema);
	} }),
	limit: defineFunction({ parameters: [parameter('count', NumericInputType)], returns: StreamType.of(T),
		description: 'Keep at most count items. Count must convert to a nonnegative integer. Zero reads no data rows; the source heading still validates. Does not read an item beyond the limit.', emptyBehavior: 'Empty stream.', errors: ['#VALUE!: negative/nonintegral count.'], examples: ['rowstream(VSTACK("n",2,5)).limit(1).toTable()'], run(input, [value]) {
		const count = integerArg(value, 'limit', 'count');
		if (count < 0) throw new FormulaError('#VALUE!', 'limit count must be nonnegative');
		return stream(function* () {
			if (!count) return;
			let remaining = count;
			for (const item of input.values()) { yield item; if (!--remaining) break; }
		}, input.schema);
	} }),
	skip: defineFunction({ parameters: [parameter('count', NumericInputType)], returns: StreamType.of(T),
		description: 'Read and discard the first count items, then yield the rest. Count must convert to a nonnegative integer. Errors in skipped source rows still propagate.', emptyBehavior: 'Empty stream.', errors: ['#VALUE!: negative/nonintegral count.'], examples: ['rowstream(VSTACK("n",2,5)).skip(1).toTable()'], run(input, [value]) {
		let remaining = integerArg(value, 'skip', 'count');
		if (remaining < 0) throw new FormulaError('#VALUE!', 'skip count must be nonnegative');
		return stream(function* () { for (const item of input.values()) { if (remaining > 0) remaining--; else yield item; } }, input.schema);
	} }),
	reduce: defineFunction({ parameters: [parameter('seed', A), parameter('reducer', LambdaType.of(A, T, A))], returns: A, terminal: true,
		description: 'Fold items left-to-right with (accumulator,item)->nextAccumulator. The accumulator must retain the seed type/record schema. Returns the accumulated value directly, never an Optional merely because the input is empty. Records/rows become headed tables only at the cell boundary.', emptyBehavior: 'Returns seed unchanged.', errors: ['#VALUE!: invalid reducer or changed accumulator type/schema.'], examples: ['rowstream(VSTACK("n",2,5)).reduce(10,(total,a)->total+a.n)'], run(input, [seed, lambda]) {
		const reduce = callback(lambda, 2);
		let result = seed;
		const accumulatorType = typeOf(seed);
		for (const item of input.values()) {
			result = reduce(result, item);
			if (!accumulatorType.accepts(result)) throw new FormulaError('#VALUE!', 'reduce must preserve the seed type and record schema');
		}
		if (isArray(result)) RowType.of(AnyType).brand(result);
		return result;
	} }),
	toTable: defineFunction({ parameters: [parameter('heading', TextType, { rest: true, help: '["heading", …]' })], returns: TableType.of(T), terminal: true,
		description: 'Materialize a spill table, headings first. Records use their field names; scalars use value; positional rows use column1, column2, …. Optional heading arguments rename columns and must match width. Every item must have consistent fields/width and scalar cells. Without projection, reproduces the source range like always-true FILTER. Maximum output: 1,000,000 cells.', emptyBehavior: 'Headings only. Literal projection headings survive; provide headings for an otherwise unknown empty shape.', errors: ['#VALUE!: inconsistent shapes, invalid headings or non-scalar fields; #CALC!: too many cells; #SPILL!: collision or sheet bounds.'], examples: ['rowstream(VSTACK("n",2,5)).toTable()'], run: (input, headers) => TableType.of(T).brand(streamTable(input, headers)) }),
	count: defineFunction({ parameters: [], returns: NumberType, terminal: true, description: 'Count data items, excluding the heading. Consumes the stream; source errors propagate.', emptyBehavior: '0.', examples: ['rowstream(VSTACK("n",2,5)).count()'], run(input) { let count = 0; for (const _ of input.values()) count++; return math.bignumber(count); } }),
	anyMatch: defineFunction({ parameters: [parameter('predicate', LambdaType.of(T, ConditionType))], returns: BooleanType, terminal: true,
		description: 'Return TRUE on the first matching item; no later rows are read. Predicate uses spreadsheet condition conversion.', emptyBehavior: 'FALSE.', examples: ['rowstream(VSTACK("n",2,5)).anyMatch(a->a.n>3)'], run(input, [lambda]) {
		const test = callback(lambda, 1);
		for (const value of input.values()) if (truthy(unwrap(test(value)))) return true;
		return false;
	} }),
	allMatch: defineFunction({ parameters: [parameter('predicate', LambdaType.of(T, ConditionType))], returns: BooleanType, terminal: true,
		description: 'Return FALSE on the first nonmatching item; no later rows are read. Predicate uses spreadsheet condition conversion.', emptyBehavior: 'TRUE (there are no counterexamples).', examples: ['rowstream(VSTACK("n",2,5)).allMatch(a->a.n>0)'], run(input, [lambda]) {
		const test = callback(lambda, 1);
		for (const value of input.values()) if (!truthy(unwrap(test(value)))) return false;
		return true;
	} }),
	noneMatch: defineFunction({ parameters: [parameter('predicate', LambdaType.of(T, ConditionType))], returns: BooleanType, terminal: true,
		description: 'Return FALSE on the first matching item; no later rows are read. Equivalent to negating anyMatch.', emptyBehavior: 'TRUE.', examples: ['rowstream(VSTACK("n",2,5)).noneMatch(a->a.n<0)'], run: (input, args) => !StreamType.methods.anyMatch.run(input, args) }),
	findFirst: defineFunction({ parameters: [], returns: OptionalType.of(T), terminal: true,
		description: 'Return the first item wrapped in Optional without reading later items. Retains the actual scalar/record/row for subsequent Optional methods. A blank first item is present, not empty.', emptyBehavior: 'Optional.empty.', examples: ['rowstream(VSTACK("n",2,5)).findFirst().map(a->a.n).orElse(0)'], run(input) {
		const first = input.values().next();
		return optional(first.value, !first.done);
	} }),
	...Object.fromEntries(['sum', 'min', 'max', 'average'].map(name => [name, {
		...defineFunction({ parameters: [], returns: name === 'sum' ? NumberType : OptionalType.of(NumberType), terminal: true,
			description: `${({ sum: 'Add', min: 'Find the smallest of', max: 'Find the largest of', average: 'Compute the arithmetic mean of' })[name]} the numeric stream items. Map the desired field first. Numeric text and booleans convert; blanks count as zero (including in the average divisor); nonnumeric text errors. Uses decimal arithmetic.`,
			emptyBehavior: name === 'sum' ? '0, the additive identity.' : 'Optional.empty, not a calculation error.', errors: ['#VALUE!: nonnumeric items; source and arithmetic errors propagate, never become empty.'],
			examples: [`rowstream(VSTACK("n",2,5)).map(a->a.n).${name}()${name === 'sum' ? '' : '.orElse(0)'}`], run: input => streamAggregate(input, name) }),
	}])),
};

OptionalType.methods = {
	map: defineFunction({ parameters: [parameter('mapper', LambdaType.of(T, U))], returns: OptionalType.of(U), description: 'Transform a present value. The mapper is not invoked when empty. Returning an Optional nests it; use flatMap to flatten one level.', emptyBehavior: 'Optional.empty.', examples: ['rowstream(VSTACK("n",2)).findFirst().map(a->a.n*3).orElse(0)'], run(input, [lambda]) {
		const project = callback(lambda, 1);
		return input.present ? optional(project(input.value)) : optional(undefined, false);
	} }),
	flatMap: defineFunction({ parameters: [parameter('mapper', LambdaType.of(T, OptionalType.of(U)))], returns: OptionalType.of(U), description: 'Transform a present value using a mapper that itself returns Optional. Flattens exactly one level. A non-Optional mapper result is an error.', emptyBehavior: 'Optional.empty; mapper not invoked.', errors: ['#VALUE!: mapper did not return Optional.'], examples: ['rowstream(VSTACK("n",2)).findFirst().flatMap(a->rowstream(VSTACK("n",a.n)).findFirst()).map(a->a.n).orElse(0)'], run(input, [lambda]) {
		const project = callback(lambda, 1);
		return input.present ? project(input.value) : optional(undefined, false);
	} }),
	filter: defineFunction({ parameters: [parameter('predicate', LambdaType.of(T, ConditionType))], returns: OptionalType.of(T), description: 'Keep a present value only if its predicate is true; otherwise return empty. Uses spreadsheet condition conversion.', emptyBehavior: 'Optional.empty; predicate not invoked.', examples: ['rowstream(VSTACK("n",2)).findFirst().filter(a->a.n>3).isEmpty()'], run(input, [lambda]) {
		const test = callback(lambda, 1);
		return input.present && truthy(unwrap(test(input.value))) ? input : optional(undefined, false);
	} }),
	isPresent: defineFunction({ parameters: [], returns: BooleanType, description: 'Test presence without unwrapping. Zero, FALSE and empty text are present.', emptyBehavior: 'FALSE.', examples: ['rowstream(VSTACK("n",0)).findFirst().isPresent()'], run: input => input.present }),
	isEmpty: defineFunction({ parameters: [], returns: BooleanType, description: 'Test absence without unwrapping.', emptyBehavior: 'TRUE.', examples: ['rowstream(VSTACK("n",2)).limit(0).findFirst().isEmpty()'], run: input => !input.present }),
	orElse: defineFunction({ parameters: [parameter('fallback', T, { lazy: true })], returns: T, description: 'Unwrap a present value, or evaluate fallback only when empty. Unlike Java orElse, this is lazy like spreadsheet IF; a separate orElseGet is unnecessary. The fallback supplies the missing result type when empty.', emptyBehavior: 'Evaluates and returns fallback.', examples: ['rowstream(VSTACK("n",2)).map(a->a.n).average().orElse(0)', 'rowstream(VSTACK("n",2)).findFirst().map(a->a.n).orElse(1/0)'], run: (input, [fallback]) => input.present ? input.value : fallback() }),
	orElseThrow: defineFunction({ parameters: [], returns: T, description: 'Unwrap a present value; explicitly request #N/A if empty. Errors remain distinguishable from an empty Optional.', emptyBehavior: 'Throws #N/A.', errors: ['#N/A: Optional is empty.'], examples: ['rowstream(VSTACK("n",2)).findFirst().orElseThrow().n'], run(input) {
		if (!input.present) throw new FormulaError('#N/A', 'Optional has no value');
		return input.value;
	} }),
};
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
		const mark = text.slice(at).match(/^`([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/);
		if (mark) {
			const end = at + mark[0].length;
			spans.push({ start: i, end, source: text.slice(i, end), reference: mark[0], kind: 'mark', name: mark[1], column: mark[2], prefix: prefix?.[0] ?? '' });
			i = end; continue;
		}
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
	return rewriteReferences(text, span => span.prefix !== '#REF!' && span.sheetName?.toLowerCase() === oldName.toLowerCase()
		? newName === null ? '#REF!' : sheetPrefix(newName) : span.prefix ?? '');
}

export function rewriteMarkReferences(text, oldName, newName, column = null, newColumn = null) {
	return rewriteReferences(text, span => {
		if (span.kind !== 'mark' || span.prefix === '#REF!' || span.name.toLowerCase() !== oldName.toLowerCase()
			|| (column !== null && span.column?.toLowerCase() !== column.toLowerCase())) return span.prefix ?? '';
		if (newName === null) return '#REF!';
		span.reference = '`' + newName + (span.column ? '.' + (column === null ? span.column : newColumn) : '');
		return '';
	});
}

function rewriteReferences(text, prefixFor) {
	if (typeof text !== 'string' || !text.startsWith('=')) return text;
	for (const span of referenceSpans(text).reverse()) {
		const prefix = prefixFor(span);
		let reference = '';
		for (let i = 0; i < span.reference.length;) {
			const char = span.reference[i];
			if (char === '[' || char === '{') {
				const end = matching(span.reference, i);
				reference += char + rewriteReferences('=' + span.reference.slice(i + 1, end), prefixFor).slice(1) + span.reference[end];
				i = end + 1;
			} else reference += span.reference[i++];
		}
		text = text.slice(0, span.start) + prefix + reference + text.slice(span.end);
	}
	return text;
}

export function resolveReference(source, row, col, ctx) {
	const span = referenceSpans(source)[0];
	if (span?.kind === 'mark' && span.start === 0 && span.end === source.length) {
		if (span.prefix) throw new FormulaError('#REF!', 'Marks are workbook-wide; no sheet qualifier is allowed');
		if (!ctx.mark) throw new FormulaError('#NAME?', `Unknown mark: ${span.name}`);
		return ctx.mark(span.name, span.column);
	}
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

function expressionBracket(text, at, ctx) {
	if (text[at] === '{') return !/[\w\]]/.test(text.slice(0, at).trimEnd().at(-1) ?? '')
		&& /^\{\s*(?:[A-Za-z_]\w*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:/.test(text.slice(at));
	return text[at] === '[' && ctx.streamExpression && !/^[{\d]/.test(text.slice(matching(text, at) + 1));
}

function quoteRecordKeys(text) {
	let result = '';
	for (let at = 0; at < text.length;) {
		if (text[at] === '"' || text[at] === "'") {
			const end = stringEnd(text, at); result += text.slice(at, end); at = end; continue;
		}
		if (text[at] !== '{' || !expressionBracket(text, at, {})) { result += text[at++]; continue; }
		const end = matching(text, at);
		if (end < 0) throw new FormulaError('#ERROR!', 'Unclosed record literal');
		const keys = new Set();
		result += '{' + splitTopLevel(text, at + 1, end).map(([start, stop]) => {
			const entry = text.slice(start, stop), key = entry.match(/^\s*([A-Za-z_]\w*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:/);
			if (!key) throw new FormulaError('#VALUE!', 'Record fields need a literal name followed by a colon');
			const name = /^["']/.test(key[1]) ? math.parse(key[1]).value : key[1];
			// mathjs stores ObjectNode properties in a plain object; never silently drop this key.
			if (name === '__proto__' || keys.has(name)) throw new FormulaError('#VALUE!', 'Projected field names must be unique and cannot be __proto__');
			keys.add(name);
			return JSON.stringify(name) + ':' + quoteRecordKeys(entry.slice(key[0].length));
		}).join(',') + '}';
		at = end + 1;
	}
	return result;
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
		if (expressionBracket(text, i, ctx)) {
			out += char + resolveRelative(inner, row, col, ctx, depth) + text[close];
			i = close + 1; continue;
		}
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
		.replace(/(?<![\w.])(?:THISROW|THISCOL|PREVROW|PREVCOL)\b/g, name => ctx.locals?.has(name) ? name
			: ({ THISROW: row, THISCOL: col, PREVROW: row - 1, PREVCOL: col - 1 })[name]));
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
	const syntax = extractLambdas(quoteRecordKeys(quoteCriteria(String(source))), stringEnd, matching);
	source = syntax.text;
	for (const lambda of syntax.lambdas) {
		if (!lambda.body || new Set(lambda.params).size !== lambda.params.length) throw new FormulaError('#VALUE!', 'A lambda needs a body and unique parameters');
		if (/^\{\s*\}$/.test(lambda.body)) throw new FormulaError('#VALUE!', 'A projected record needs at least one field');
		evaluateExpression(lambda.body, row, col, {
			...ctx, locals: new Map([...(ctx.locals ?? []), ...lambda.params.map(name => [name, null])]), streamExpression: true, validateOnly: true,
		}, depth + 1);
		lambda.invoke = (...values) => {
			const locals = new Map(ctx.locals);
			lambda.params.forEach((name, i) => locals.set(name, values[i]));
			return evaluateExpression(lambda.body, row, col, { ...ctx, locals, streamExpression: true }, depth + 1);
		};
		LambdaType.of(...lambda.params.map(() => AnyType), AnyType).brand(lambda);
		references.set(lambda.name, () => lambda);
	}
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
		if (matrix || (!span && expressionBracket(source, at, ctx))) { deferred += source[at++]; continue; }
		if (ctx.pure && (span || bracket >= 0)) {
			// Validate deferred coordinate expressions too, including unused IF branches. Validation
			// must never read a sheet or execute a predicate while a builder is being edited/loaded.
			for (let i = 0; i < token.length; i++) {
				if (token[i] === '"' || token[i] === "'") { i = stringEnd(token, i) - 1; continue; }
				if (!'[{'.includes(token[i])) continue;
				const close = matching(token, i);
				if (close < 0) throw new FormulaError('#ERROR!', 'Unclosed relative reference');
				const inner = token.slice(i + 1, close);
				if (inner.trim()) evaluateExpression(inner, row, col, { ...ctx, validateOnly: true }, depth + 1);
				i = close;
			}
		}
		if (span?.kind === 'mark') {
			const name = `DFREF__${references.size}`;
			references.set(name, () => {
				const ref = resolveReference(span.source, row, col, ctx);
				if (ref.height === 0) throw new FormulaError('#CALC!', `Dataset ${span.name} has no records`);
				const target = ctx.sheet(ref.sheetName);
				return ref.mode === 'cell' ? target.ref(ref.r0, ref.c0) : target.range(ref.r0, ref.c0, ref.r1, ref.c1);
			});
			references.get(name).rows = () => referenceRows(token, row, col, ctx);
			deferred += name;
		} else if (span?.sheetName !== undefined) {
			const name = `DFREF__${references.size}`;
			references.set(name, () => {
				if (span.prefix === '#REF!' || !ctx.sheet) throw new FormulaError('#REF!', `Unknown sheet: ${span.sheetName}`);
				return evaluateExpression(span.reference, row, col, ctx.sheet(span.sheetName), depth + 1);
			});
			references.get(name).rows = () => referenceRows(token, row, col, ctx);
			deferred += name;
		} else if (!matrix && /[\[{}]/.test(token) && (span || bracket >= 0)) {
			const name = `DFREF__${references.size}`;
			references.set(name, () => evaluateExpression(normaliseFormula(token, row, col, ctx, depth + 1), row, col, ctx, depth + 1));
			references.get(name).rows = () => referenceRows(token, row, col, ctx);
			deferred += name;
		} else deferred += token;
		at = end;
	}
	const text = normaliseFormula(deferred, row, col, ctx, depth);
	if (text.trim() === "") return "";
	let tree;
	try {
		tree = expressionTrees.get(text);
		if (!tree) {
			tree = math.parse(text);
			if (text.length <= 4096) {
				if (expressionTrees.size >= 256) expressionTrees.delete(expressionTrees.keys().next().value);
				expressionTrees.set(text, tree);
			}
		}
	} catch (error) {
		throw new FormulaError(error.message);
	}
	if (ctx.pure) validatePureTree(tree);
	if (ctx.validateOnly) return false;
	return normalise(evaluateNode(tree, { ...ctx, references }), ctx.streamExpression);
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

export function validatePredicate(source) {
	if (typeof source !== 'string' || !source.trim()) throw new FormulaError('#VALUE!', 'Add a .when(condition) predicate');
	evaluateFormula(source, 0, 0, { pure: true, validateOnly: true });
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
