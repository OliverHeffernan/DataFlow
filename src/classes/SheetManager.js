import { ref, shallowRef, shallowReactive, toDisplayString } from "vue";
//import { reactive } from "vue";
import { FormulaError, cellLabel, cellToValue, evaluateFormula, toCellValue, rewriteSheetReferences, rewriteMarkReferences } from "./FormulaFunctions.js";
import { markName, datasetColumns, validateMarks, structuralMarks } from './WorkbookMarks.js';
import { horizontalAlignments, presentCell } from './CellFormatting.js';
import SyntaxHighlighting from "./SyntaxHighlighting.js";
import { evaluateChart } from "./ChartFormula.js";
import { adjustConditionalRules, evaluateConditionalRules, validateConditionalRules } from './ConditionalFormatting.js';

import HistoryManager from "./HistoryManager.js";
const historyManager = new HistoryManager();

import VisualManager from "./VisualManager.js";
const visualManager = new VisualManager();

// Thrown when a formula reads a cell that is already being evaluated.
class CircularError extends Error {
	constructor(message = "circular logic detected") {
		super(message);
		this.uncatchable = true;
	}
}

// Internal: a speculative evaluation (used to discover spill shapes) needed a cell that is still being
// evaluated further down the stack. The speculation is dropped and recorded as an assumption instead.
class ProbeAbort extends Error {
	constructor(base, culprit) {
		super("speculative evaluation aborted");
		this.base = base;
		this.culprit = culprit;
		this.uncatchable = true;
	}
}

const keyOf = (row, col) => `${row}:${col}`;
const isFormula = raw => typeof raw === "string" && raw[0] === "=";
const isEmpty = raw => raw === "" || raw == null;
const errorText = error => error?.message ?? String(error);
const explain = error => error?.explanation ?? errorText(error);
const intersects = (row, col, rows, cols, region) => row <= region.r1 && col <= region.c1
	&& row + rows - 1 >= region.r0 && col + cols - 1 >= region.c0;

/*
 * One consistent evaluation of the sheet. Nothing is cached between passes, so direct edits to
 * sheet.rows are always seen. Within a pass every formula is evaluated at most once.
 *
 * Spill outputs are derived: an empty cell takes the element of the array formula whose valid spill
 * footprint covers it. Discovering that may need formulas that are still being evaluated; those are
 * skipped and recorded as assumptions, which verify() checks afterwards. A broken assumption means the
 * spill depends on its own output; the owner is blocked (#SPILL!) and the pass is rerun.
 */
class CalcPass {
	constructor(sheet, blocked, session, record = sheet.activeSheet) {
		this.rows = record.rows;
		this.datasets = sheet.marks.filter(mark => mark.kind === 'dataset' && mark.sheetName === record.name);
		this.id = sheet.sheets.indexOf(record);
		this.session = session;
		session.passes.set(record, this);
		this.blocked = blocked;
		this.results = new Map();
		this.spills = new Map();
		this.empties = new Map();
		this.stack = session.stack;
		this.probes = session.probes;
		this.assumptions = [];
		this.aborts = new Map();
		this.formulaCells = [];
		this.rows.forEach((row, r) => row?.forEach((raw, c) => {
			if (isFormula(raw)) this.formulaCells.push([r, c]);
		}));
		this.ctx = {
			mark: (name, column) => sheet.resolveMark(name, column),
			sheet: name => {
				const target = sheet.sheets.find(item => item.name.toLowerCase() === name.toLowerCase());
				if (!target) throw new FormulaError('#REF!', `Unknown sheet: ${name}`);
				return (session.passes.get(target) ?? new CalcPass(sheet, blocked, session, target)).ctx;
			},
			ref: (row, col) => this.formulaRead(row, col, false),
			// Charts keep literal text (including numeric labels), but read the element at spill sources.
			element: (row, col) => {
				if (!this.inSheet(row, col)) throw new FormulaError('#REF!');
				const value = this.cellValue(row, col);
				if (value?.kind === 'chart') throw new Error('A chart cannot be used as chart data');
				return Array.isArray(value) ? value[0][0] : value;
			},
			range: (r0, c0, r1, c1) => {
				for (const [row, col] of [[r0, c0], [r1, c1]]) {
					if (!this.inSheet(row, col)) throw new FormulaError("#REF!", `Range ${cellLabel(r0, c0)}:${cellLabel(r1, c1)} extends outside the sheet`);
				}
				const values = [];
				for (let row = r0; row <= r1; row++) {
					const line = [];
					for (let col = c0; col <= c1; col++) line.push(this.formulaRead(row, col, true));
					values.push(line);
				}
				return values;
			},
		};
	}

	key(row, col) { return `${this.id}:${keyOf(row, col)}`; }

	raw(row, col) {
		return this.rows[row]?.[col] ?? "";
	}

	inSheet(row, col) {
		return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0
			&& row < this.rows.length && col < (this.rows[row]?.length ?? 0);
	}

	enter(key) {
		if (this.stack.has(key)) {
			const index = this.stack.get(key);
			const base = this.probes.at(-1);
			if (base !== undefined && index < base) throw new ProbeAbort(base, key);
			throw new CircularError();
		}
		this.stack.set(key, this.stack.size);
	}

	leave(key) {
		this.stack.delete(key);
	}

	probe(fn) {
		const base = this.stack.size;
		this.probes.push(base);
		try {
			return { value: fn() };
		} catch (error) {
			if (error instanceof ProbeAbort && error.base === base) return { aborted: true };
			if (error instanceof ProbeAbort) throw error;
			return { error };
		} finally {
			this.probes.pop();
		}
	}

	// A needed result is still in progress. Inside a speculation started above it, abort that speculation
	// (it is retried or assumed by its caller); otherwise the caller records an assumption.
	inProgress(key) {
		const base = this.probes.at(-1);
		if (base !== undefined && this.stack.get(key) < base) throw new ProbeAbort(base, key);
	}

	assume(row, col, region) {
		this.assumptions.push({ row, col, ...region });
	}

	// Raw formula result (scalar or 2D array); throws formula errors.
	result(row, col) {
		const key = this.key(row, col);
		const cached = this.results.get(key);
		if (cached) {
			if ("error" in cached) throw cached.error;
			return cached.value;
		}
		// It needed an in-progress cell before and would reach it again, so abort the speculation early.
		const culprit = this.aborts.get(key);
		const base = this.probes.at(-1);
		if (base !== undefined && this.stack.get(culprit) < base) throw new ProbeAbort(base, culprit);
		this.enter(key);
		try {
			const value = this.compute(row, col);
			this.results.set(key, { value });
			return value;
		} catch (error) {
			if (error instanceof ProbeAbort) this.aborts.set(key, error.culprit);
			else this.results.set(key, { error });
			throw error;
		} finally {
			this.leave(key);
		}
	}

	compute(row, col) {
		const raw = this.raw(row, col);
		if (/^=\s*CHART\b/.test(raw)) {
			try {
				return evaluateChart(raw, row, col, this.ctx);
			} catch (error) {
				if (error instanceof ProbeAbort) throw error;
				if (error instanceof CircularError) throw new CircularError(`Chart: ${error.message}`);
				throw new Error(`Chart: ${error.message}`);
			}
		}
		return evaluateFormula(raw, row, col, this.ctx);
	}

	// Full cell value: stored text, formula result (whole 2D array at an array source) or spilled element.
	cellValue(row, col) {
		if (!this.inSheet(row, col)) return "";
		const raw = this.raw(row, col);
		if (isEmpty(raw)) return this.covered(row, col);
		if (!isFormula(raw)) return raw;
		const value = this.result(row, col);
		if (Array.isArray(value)) {
			const state = this.spillState(row, col);
			if (!state.ok) throw new FormulaError("#SPILL!", state.reason);
		}
		return value;
	}

	// Value seen by formula references; `element` selects the top-left element of an array source.
	formulaRead(row, col, element) {
		if (!this.inSheet(row, col)) throw new FormulaError("#REF!", `${cellLabel(row, col)} is outside the sheet`);
		const raw = this.raw(row, col);
		let value;
		if (isEmpty(raw)) value = this.covered(row, col);
		else if (!isFormula(raw)) value = cellToValue(raw);
		else {
			value = this.result(row, col);
			if (Array.isArray(value)) {
				const state = this.spillState(row, col);
				if (!state.ok) throw new FormulaError("#SPILL!", `${cellLabel(row, col)} cannot spill: ${state.reason}`);
				if (element) value = value[0][0];
			}
		}
		if (value?.kind === "chart") throw new Error("Chart cells cannot be used in numeric formulas");
		return value;
	}

	// Array result of a formula cell if it can be known now; otherwise records an assumption.
	peek(row, col, region) {
		const key = this.key(row, col);
		if (this.blocked.has(key)) return null;
		const cached = this.results.get(key);
		if (cached) return "error" in cached || !Array.isArray(cached.value) ? null : cached.value;
		// A formula that needed an in-progress cell would need it again: skip it while that cell is in progress.
		if (this.stack.has(key) || this.stack.has(this.aborts.get(key))) {
			this.inProgress(this.stack.has(key) ? key : this.aborts.get(key));
			this.assume(row, col, region);
			return null;
		}
		const outcome = this.probe(() => this.result(row, col));
		if (outcome.aborted) {
			this.assume(row, col, region);
			return null;
		}
		return Array.isArray(outcome.value) ? outcome.value : null;
	}

	// Value of an empty cell: the element of the valid spill covering it, or "".
	covered(row, col) {
		const key = this.key(row, col);
		if (this.empties.has(key)) return this.empties.get(key);
		const region = { r0: row, c0: col, r1: row, c1: col };
		let found = "";
		for (const [r, c] of this.formulaCells) {
			if (r > row) break;
			if (c > col) continue;
			const value = this.peek(r, c, region);
			if (!value || !intersects(r, c, value.length, value[0].length, region)) continue;
			if (this.stack.has(`spill:${this.key(r, c)}`)) {
				this.inProgress(`spill:${this.key(r, c)}`);
				this.assume(r, c, region);
				continue;
			}
			if (this.spillState(r, c).ok) {
				found = value[row - r][col - c];
				break;
			}
		}
		this.empties.set(key, found);
		return found;
	}

	baseProblem(row, col, rows, cols) {
		const range = `${cellLabel(row, col)}:${cellLabel(row + rows - 1, col + cols - 1)}`;
		if (this.datasets.some(mark => intersects(row, col, rows, cols, mark.bounds))) return `Spill range ${range} intersects a dataset; dataset formulas must be scalar`;
		for (let r = row; r < row + rows; r++) {
			if (!this.inSheet(r, col + cols - 1)) return `Spill range ${range} (${rows}×${cols}) extends beyond the edge of the sheet`;
		}
		for (let r = row; r < row + rows; r++) {
			for (let c = col; c < col + cols; c++) {
				if ((r !== row || c !== col) && !isEmpty(this.raw(r, c))) {
					return `Spill range ${range} is blocked by non-empty cell ${cellLabel(r, c)}`;
				}
			}
		}
		return null;
	}

	spillState(row, col) {
		const key = this.key(row, col);
		if (this.spills.has(key)) return this.spills.get(key);
		const value = this.result(row, col);
		const rows = value.length;
		const cols = value[0].length;
		const range = `${cellLabel(row, col)}:${cellLabel(row + rows - 1, col + cols - 1)}`;
		const state = { row, col, rows, cols, ok: false, reason: "" };
		const marker = `spill:${key}`;
		this.enter(marker);
		try {
			const problem = this.baseProblem(row, col, rows, cols);
			if (this.blocked.has(key)) state.reason = `Spill range ${range} depends on its own output (spill cycle)`;
			else if (problem) state.reason = problem;
			else {
				const other = this.overlapping(row, col, rows, cols);
				if (other) state.reason = `Spill range ${range} overlaps the spill range of ${other}`;
				else state.ok = true;
			}
		} finally {
			this.leave(marker);
		}
		this.spills.set(key, state);
		return state;
	}

	overlapping(row, col, rows, cols) {
		const region = { r0: row, c0: col, r1: row + rows - 1, c1: col + cols - 1 };
		for (const [r, c] of this.formulaCells) {
			if (r > region.r1) break;
			if (c > region.c1 || (r === row && c === col)) continue;
			const value = this.peek(r, c, region);
			if (!value || !intersects(r, c, value.length, value[0].length, region)) continue;
			if (this.baseProblem(r, c, value.length, value[0].length) === null) return cellLabel(r, c);
		}
		return null;
	}

	// Owners whose spill would cover a cell that was assumed not to be covered (spill cycles).
	verify() {
		const broken = new Set();
		for (let i = 0; i < this.assumptions.length; i++) {
			const { row, col, ...region } = this.assumptions[i];
			const key = this.key(row, col);
			if (this.blocked.has(key) || broken.has(key)) continue;
			let value;
			try {
				value = this.result(row, col);
			} catch {
				continue;
			}
			if (!Array.isArray(value) || !intersects(row, col, value.length, value[0].length, region)) continue;
			if (this.baseProblem(row, col, value.length, value[0].length) === null) broken.add(key);
		}
		return [...broken];
	}

	snapshot() {
		const values = this.rows.map(row => (row ?? []).map(raw => raw ?? ""));
		const typed = values.map(row => row.map(cellToValue));
		const spills = new Map();
		const errors = new Map();
		const failures = new Map();
		for (const [row, col] of this.formulaCells) {
			const key = keyOf(row, col);
			let value;
			try {
				value = this.result(row, col);
			} catch (error) {
				values[row][col] = errorText(error);
				typed[row][col] = null;
				errors.set(key, explain(error));
				failures.set(key, error);
				continue;
			}
			if (!Array.isArray(value)) {
				values[row][col] = toCellValue(value);
				typed[row][col] = value;
				continue;
			}
			const state = this.spillState(row, col);
			if (!state.ok) {
				values[row][col] = "#SPILL!";
				typed[row][col] = null;
				errors.set(key, state.reason);
				failures.set(key, new FormulaError('#SPILL!', state.reason));
				continue;
			}
			const owner = { row, col, rows: state.rows, cols: state.cols };
			value.forEach((line, i) => line.forEach((element, j) => {
				values[row + i][col + j] = toCellValue(element);
				typed[row + i][col + j] = element;
				spills.set(keyOf(row + i, col + j), { ...owner });
			}));
		}
		return { values, typed, spills, errors, failures };
	}
}

export default class SheetManager {
	constructor() {
		// make sure there is only one instance of SheetManager
		if (SheetManager.instance) {
			return SheetManager.instance;
		}

		this.workbook = shallowReactive({ sheets: [{ name: 'Sheet1', rows: [], styles: [], selRow: 0, selCol: 0 }], activeSheetIndex: 0, marks: [] });
		this.cellValues = shallowRef([]);
		this.sheetResults = shallowRef(new Map());
		this.styleVersion = ref(0);
		this.cellPresentation = shallowRef([]);
		this.formatPreview = null;
		// derived by recalculate(): "row:col" -> { row, col, rows, cols } of the array formula spilling there
		this.spillCells = new Map();
		// derived by recalculate(): "row:col" -> readable explanation of the error shown in that cell
		this.cellErrors = new Map();
		this.pass = null;
		this.defaultBG = "#091119";
		this.defaultFG = "white";

		this.numOfRows = ref(50);
		this.numOfCols = ref(50);
		this.selRow = 0;
		this.selCol = 0;
		this.cellCurPos = 0;
		this.prevRow = 0;
		this.prevCol = 0;
		this.copyBuffer = [[]];
		this.path = null;
		this.workbookListeners = new Set();
		this.defaultStyling = {
			fg: "white",
			bg: "transparent",
		};

		this.tempForm = "";

		// create a 2D array of empty strings
		for (let i = 0; i < 50; i++) {
			let row = [];
			let styleRow = [];
			for (let j = 0; j < 50; j++) {
				row.push("");
				styleRow.push({
					fg: "white",
					bg: "transparent",
				});
			}
			this.rows.push(row);
			this.styles.push(styleRow);
		}
		historyManager.reset(this);
		SheetManager.instance = this;
	}

	get sheets() { return this.workbook.sheets; }
	get activeSheet() { return this.sheets[this.workbook.activeSheetIndex]; }
	get rows() { return this.activeSheet.rows; }
	set rows(rows) { this.activeSheet.rows = rows; }
	get styles() { return this.activeSheet.styles; }
	set styles(styles) { this.activeSheet.styles = styles; }
	get selRow() { return this.activeSheet.selRow; }
	set selRow(row) {
		if (this.activeSheet.selRow === row) return;
		this.activeSheet.selRow = row; this.notifyWorkbookChanged('view');
	}
	get selCol() { return this.activeSheet.selCol; }
	set selCol(col) {
		if (this.activeSheet.selCol === col) return;
		this.activeSheet.selCol = col; this.notifyWorkbookChanged('view');
	}
	get marks() { return this.workbook.marks ?? []; }

	mark(name) {
		const mark = this.marks.find(mark => mark.name.toLowerCase() === String(name).toLowerCase());
		if (!mark) throw new FormulaError('#NAME?', `Unknown mark: ${name}`);
		return mark;
	}

	// Read-only descriptors for formula/editor/chart/automation consumers. No live handles escape.
	resolveMark(name, column) {
		const mark = this.mark(name);
		if (!mark.bounds) throw new FormulaError('#REF!', `Mark ${name}'s cells were deleted`);
		let { r0, c0, r1, c1 } = mark.bounds;
		if (mark.kind === 'dataset') {
			r0++;
			if (column !== undefined) {
				const item = datasetColumns(mark, this.sheets).find(item => item.name.toLowerCase() === column.toLowerCase());
				if (!item) throw new FormulaError('#REF!', `Unknown column ${column} in ${name}`);
				c0 = c1 = item.col;
			}
		} else if (column !== undefined) throw new FormulaError('#REF!', `Mark ${name} is not a dataset`);
		return { name: mark.name, sheetName: mark.sheetName, mode: mark.kind === 'cell' ? 'cell' : 'range', r0, c0, r1, c1, height: r1 - r0 + 1, width: c1 - c0 + 1 };
	}

	describeDataset(name) {
		const mark = this.mark(name);
		if (mark.kind !== 'dataset') throw new Error(`Mark ${name} is not a dataset`);
		return { ...this.resolveMark(name), header: { ...mark.bounds, r1: mark.bounds.r0 }, columns: datasetColumns(mark, this.sheets), rowCount: mark.bounds.r1 - mark.bounds.r0 };
	}

	setMark(name, bounds, kind = 'cell', sheetName = this.activeSheet.name) {
		if (!markName(name)) throw new Error('Mark names must be identifiers: letters/underscore, then letters/digits/underscore');
		const previous = this.marks.find(mark => mark.name.toLowerCase() === name.toLowerCase());
		if (previous?.kind === 'dataset') throw new Error('Remove the dataset definition before resetting its mark');
		const next = [...this.marks.filter(mark => mark !== previous), { name, kind, sheetName, bounds: { ...bounds } }];
		validateMarks(next, this.sheets);
		if (kind === 'dataset') {
			const target = this.sheets.find(sheet => sheet.name === sheetName);
			// Inspect the target's actual spill map, not the active sheet's same coordinates.
			const oldActive = this.workbook.activeSheetIndex;
			try {
				this.workbook.activeSheetIndex = this.sheets.indexOf(target);
				this.recalculate();
				if ([...this.spillCells.keys()].some(key => { const [row, col] = key.split(':').map(Number); return intersects(row, col, 1, 1, bounds); })) throw new Error('A dataset cannot contain spill cells');
			} finally { this.workbook.activeSheetIndex = oldActive; this.recalculate(); }
		}
		this.workbook.marks = next;
		this.recalculate(); historyManager.do(this);
	}

	rewriteMark(name, replacement, column = null, newColumn = null) {
		const transform = text => rewriteMarkReferences(text, name, replacement, column, newColumn);
		for (const sheet of this.sheets) {
			sheet.rows = sheet.rows.map(row => row.map(transform));
			if (sheet.conditionalRules) sheet.conditionalRules = sheet.conditionalRules.map(rule => ({ ...rule, source: transform(rule.source) }));
		}
	}

	renameMark(name, replacement) {
		const mark = this.mark(name);
		if (!markName(replacement) || this.marks.some(item => item !== mark && item.name.toLowerCase() === replacement.toLowerCase())) throw new Error('Invalid or duplicate mark name');
		this.rewriteMark(mark.name, replacement);
		this.workbook.marks = this.marks.map(item => item === mark ? { ...item, name: replacement } : item);
		this.recalculate(); historyManager.do(this);
	}

	deleteMark(name, force = false) {
		const mark = this.mark(name);
		if (!force && this.sheets.some(sheet => [...sheet.rows.flat(), ...(sheet.conditionalRules ?? []).map(rule => rule.source)]
			.some(text => rewriteMarkReferences(text, mark.name, null) !== text))) throw new Error('Mark is referenced; use :delmarks! to invalidate its references');
		this.rewriteMark(mark.name, null);
		this.workbook.marks = this.marks.filter(item => item !== mark);
		this.recalculate(); historyManager.do(this);
	}

	renameDatasetColumn(name, column, replacement) {
		const mark = this.mark(name), schema = this.describeDataset(name);
		const item = schema.columns.find(item => item.name.toLowerCase() === column.toLowerCase());
		if (!item || !markName(replacement) || schema.columns.some(other => other !== item && other.name.toLowerCase() === replacement.toLowerCase())) throw new Error('Invalid or duplicate dataset column');
		this.sheets.find(sheet => sheet.name === mark.sheetName).rows[mark.bounds.r0][item.col] = replacement;
		this.rewriteMark(mark.name, mark.name, item.name, replacement);
		this.recalculate(); historyManager.do(this);
	}

	// Pure preflight seam consumed by fill's applyRangeEdit. Publication/history stay caller-owned.
	prepareMarkWrites(writes, baseline = this.rows) {
		const next = this.marks.map(mark => ({ ...mark, bounds: mark.bounds && { ...mark.bounds } }));
		for (const mark of next.filter(mark => mark.kind === 'dataset' && mark.sheetName === this.activeSheet.name)) {
			const b = mark.bounds;
			if (writes.some(write => write.row === b.r0 && write.col >= b.c0 && write.col <= b.c1 && write.value !== baseline[write.row][write.col])) throw new Error(`Use :datasetcolumnrename to edit ${mark.name}'s headers`);
			const added = writes.filter(write => write.row > b.r1 && write.col >= b.c0 && write.col <= b.c1);
			if (!added.length || !added.some(write => !isEmpty(write.value))) continue;
			const writtenRows = new Set(added.map(write => write.row));
			let first = Infinity, end = b.r1;
			for (const row of writtenRows) { first = Math.min(first, row); end = Math.max(end, row); }
			if (first !== b.r1 + 1) continue;
			// Only a single block confined to dataset columns may imply new records.
			if (writes.some(write => write.col < b.c0 || write.col > b.c1)) continue;
			for (let row = b.r1 + 1; row <= end; row++) {
				if (!writtenRows.has(row)) throw new Error('Dataset expansion cannot skip rows');
				for (let col = b.c0; col <= b.c1; col++) {
					if (!isEmpty(baseline[row]?.[col]) || this.spillCells.has(keyOf(row, col))) throw new Error(`Dataset ${mark.name} expansion is blocked at ${cellLabel(row, col)}`);
				}
			}
			b.r1 = end;
		}
		return validateMarks(next, this.sheets);
	}

	appendDataset(name, count = 1) {
		const mark = this.mark(name);
		if (mark.kind !== 'dataset' || !Number.isInteger(count) || count < 1) throw new Error('Append requires a dataset and a positive row count');
		const target = this.sheets.find(sheet => sheet.name === mark.sheetName), b = mark.bounds;
		if (b.r1 + count >= target.rows.length) throw new Error('Append exceeds sheet bounds; insert sheet rows first');
		const active = this.workbook.activeSheetIndex;
		try {
			this.workbook.activeSheetIndex = this.sheets.indexOf(target); this.recalculate();
			for (let row = b.r1 + 1; row <= b.r1 + count; row++) for (let col = b.c0; col <= b.c1; col++) {
				if (!isEmpty(target.rows[row][col]) || this.spillCells.has(keyOf(row, col))) throw new Error('Append destinations must be blank and not spill-covered');
			}
			const next = this.marks.map(item => item === mark ? { ...item, bounds: { ...b, r1: b.r1 + count } } : item);
			validateMarks(next, this.sheets); this.workbook.marks = next;
		} finally { this.workbook.activeSheetIndex = active; this.recalculate(); }
		historyManager.do(this);
	}

	editMarkedStructure(axis, at, removed, inserted) {
		this.workbook.marks = structuralMarks(this.marks, this.activeSheet.name, axis, at, removed, inserted);
		this.markStructureChanged = true;
	}

	noteMarkWrite(row, col) {
		(this.markWriteCells ??= new Set()).add(keyOf(row, col));
	}

	commitMarkedEdit() {
		const previous = historyManager.historyFor(this).undo.at(-1);
		try {
			if (!this.markStructureChanged && previous) {
				const baseline = previous.state.sheets.find(sheet => sheet.name === this.activeSheet.name)?.rows;
				if (baseline && baseline.length === this.rows.length && baseline[0].length === this.rows[0].length) {
					const writes = [];
					this.rows.forEach((row, r) => row.forEach((value, c) => { if (value !== baseline[r][c] || this.markWriteCells?.has(keyOf(r, c))) writes.push({ row: r, col: c, value }); }));
					this.workbook.marks = this.prepareMarkWrites(writes, baseline);
				}
			}
			validateMarks(this.marks, this.sheets);
		} catch (error) {
			if (previous) historyManager.loadState(this, previous);
			throw error;
		} finally { this.markStructureChanged = false; this.markWriteCells = null; }
	}

	onWorkbookChange(listener) {
		this.workbookListeners.add(listener);
		return () => this.workbookListeners.delete(listener);
	}

	// Content notifications settle after a synchronous edit, independently of
	// history grouping and derived calculation/rendering. A validated file load
	// establishes its baseline immediately, before any subsequent user edits.
	notifyWorkbookChanged(kind = 'content') {
		if (kind === 'baseline') {
			this.pendingWorkbookChange = null;
			for (const listener of this.workbookListeners) listener(kind);
			return;
		}
		if (this.pendingWorkbookChange) {
			if (kind === 'content') this.pendingWorkbookChange = kind;
			return;
		}
		this.pendingWorkbookChange = kind;
		queueMicrotask(() => {
			const change = this.pendingWorkbookChange;
			this.pendingWorkbookChange = null;
			if (change) for (const listener of this.workbookListeners) listener(change);
		});
	}

	validateSheetName(name, except = null) {
		if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f\x7f]/.test(name)) throw new Error('A sheet name must be non-empty and on one line');
		name = name.trim();
		if (this.sheets.some(sheet => sheet !== except && sheet.name.toLowerCase() === name.toLowerCase())) throw new Error(`Sheet already exists: ${name}`);
		return name;
	}

	unusedSheetName(base = 'Sheet') {
		let n = 1;
		while (this.sheets.some(sheet => sheet.name.toLowerCase() === `${base}${n}`.toLowerCase())) n++;
		return `${base}${n}`;
	}

	sheetIndex(target) {
		const index = /^\d+$/.test(String(target)) ? Number(target) - 1 : this.sheets.findIndex(sheet => sheet.name.toLowerCase() === String(target).toLowerCase());
		if (!Number.isInteger(index) || index < 0 || index >= this.sheets.length) throw new Error(`Unknown sheet: ${target}`);
		return index;
	}

	switchSheet(target) {
		this.workbook.activeSheetIndex = this.sheetIndex(target);
		this.numOfRows.value = this.rows.length;
		this.numOfCols.value = this.rows[0].length;
		this.recalculate();
		this.notifyWorkbookChanged('view');
	}

	createSheet(name = this.unusedSheetName(), duplicate = false) {
		name = this.validateSheetName(name);
		const copy = duplicate ? JSON.parse(JSON.stringify(this.activeSheet)) : {};
		const rows = copy.rows ?? Array.from({ length: 50 }, () => Array(50).fill(''));
		const styles = copy.styles ?? rows.map(row => row.map(() => ({ ...this.defaultStyling })));
		this.workbook.sheets = [...this.sheets, { ...copy, name, rows, styles, selRow: 0, selCol: 0 }];
		this.switchSheet(this.sheets.length);
		historyManager.do(this);
	}

	rewriteSheetReferences(oldName, newName) {
		const transform = text => rewriteSheetReferences(text, oldName, newName);
		for (const sheet of this.sheets) {
			sheet.rows = sheet.rows.map(row => row.map(transform));
			if (sheet.conditionalRules) sheet.conditionalRules = sheet.conditionalRules.map(rule => ({ ...rule, source: transform(rule.source) }));
		}
	}

	renameSheet(name) {
		name = this.validateSheetName(name, this.activeSheet);
		if (name === this.activeSheet.name) return;
		this.rewriteSheetReferences(this.activeSheet.name, name);
		this.workbook.marks = this.marks.map(mark => mark.sheetName === this.activeSheet.name ? { ...mark, sheetName: name } : mark);
		this.activeSheet.name = name;
		this.workbook.sheets = [...this.sheets];
		this.recalculate();
		historyManager.do(this);
	}

	moveSheet(position) {
		const index = this.sheetIndex(position), sheets = [...this.sheets], active = this.activeSheet;
		if (index === this.workbook.activeSheetIndex) return;
		sheets.splice(this.workbook.activeSheetIndex, 1);
		sheets.splice(index, 0, active);
		this.workbook.sheets = sheets;
		this.workbook.activeSheetIndex = index;
		historyManager.do(this);
	}

	deleteSheet(target = this.workbook.activeSheetIndex + 1, force = false) {
		if (this.sheets.length === 1) throw new Error('Cannot delete the last sheet');
		const index = this.sheetIndex(target), removed = this.sheets[index], active = this.activeSheet;
		const referenced = this.sheets.some(sheet => sheet !== removed && [...sheet.rows.flat(), ...(sheet.conditionalRules ?? []).map(rule => rule.source)]
			.some(text => rewriteSheetReferences(text, removed.name, null) !== text));
		const hasData = removed.rows.some(row => row.some(value => value !== '' && value != null));
		const hasStyles = removed.styles.some(row => row.some(style => Object.entries(style).some(([key, value]) => value !== this.defaultStyling[key])));
		const owned = this.marks.filter(mark => mark.sheetName === removed.name);
		if (!force && (hasData || hasStyles || referenced || owned.length || removed.conditionalRules?.length)) throw new Error('Sheet has data, styles, or references; use :sheetdelete! to delete it');
		for (const mark of owned) this.rewriteMark(mark.name, null);
		this.workbook.marks = this.marks.filter(mark => mark.sheetName !== removed.name);
		this.rewriteSheetReferences(removed.name, null);
		this.workbook.sheets = this.sheets.filter(sheet => sheet !== removed);
		this.switchSheet(active === removed ? Math.min(index + 1, this.sheets.length) : this.sheets.indexOf(active) + 1);
		historyManager.do(this);
	}

	serializeWorkbook() {
		const { activeSheetIndex, ...data } = this.workbook;
		return { ...data, version: 3, activeSheet: activeSheetIndex, sheets: this.sheets.map(({ selRow, selCol, ...sheet }) => sheet) };
	}

	// Detached trusted envelope: no singleton constructor, renderer, history, or live cache refs.
	static createDraft(data) {
		const draft = Object.create(SheetManager.prototype);
		const { version, activeSheet, ...workbook } = JSON.parse(JSON.stringify(data));
		draft.workbook = { ...workbook, activeSheetIndex: activeSheet };
		draft.pass = null;
		draft.cellValues = { value: [] };
		draft.sheetResults = { value: new Map() };
		draft.cellPresentation = { value: [] };
		draft.formatPreview = null;
		draft.spillCells = new Map();
		draft.cellErrors = new Map();
		return draft;
	}

	restoreWorkbook(data, calculation = null) {
		// Only the caller's exact, final evaluated envelope may bypass recalculation. Data caches
		// stay local (Complex/Unit retain their prototypes); undo and normal loads still recalculate.
		if (calculation && (calculation.workbook !== data || calculation.sheets.length !== data.sheets.length
			|| calculation.sheets.some((cache, i) => cache.values.length !== data.sheets[i].rows.length
				|| cache.values.some(row => row.length !== data.sheets[i].rows[0].length)))) throw new Error('Calculation does not match workbook');
		// History restores data, not navigation. Keep the visible sheet/cursors where possible.
		const active = this.activeSheet.name;
		const cursors = new Map(this.sheets.map(sheet => [sheet.name, { row: sheet.selRow, col: sheet.selCol }]));
		const { version, activeSheet, sheets, ...metadata } = data;
		for (const key of Object.keys(this.workbook)) delete this.workbook[key];
		Object.assign(this.workbook, metadata, { sheets: sheets.map(sheet => {
			const cursor = cursors.get(sheet.name) ?? { row: 0, col: 0 };
			return { ...sheet, selRow: Math.min(cursor.row, sheet.rows.length - 1), selCol: Math.min(cursor.col, sheet.rows[0].length - 1) };
		}), activeSheetIndex: Math.max(0, sheets.findIndex(sheet => sheet.name === active)) });
		this.numOfRows.value = this.rows.length;
		this.numOfCols.value = this.rows[0].length;
		this.loadAllCells(undefined, undefined, calculation);
	}

	validateWorkbook(data) {
		// Validate the whole file before replacing any existing work. Both legacy layouts remain readable.
		if (data?.version !== undefined && ![1, 2, 3].includes(data.version)) throw new Error(`Unsupported workbook version: ${data.version}`);
		const source = Array.isArray(data) ? [{ rows: data }] : data?.sheets ?? [data];
		if (!Array.isArray(source) || !source.length) throw new Error('Invalid workbook: at least one sheet is required');
		const names = new Set();
		const sheets = source.map((sheet, index) => {
			const name = sheet?.name ?? `Sheet${index + 1}`, rows = sheet?.rows;
			if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f\x7f]/.test(name) || names.has(name.trim().toLowerCase())) throw new Error('Invalid workbook: sheet names must be non-empty and unique');
			names.add(name.trim().toLowerCase());
			if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0]) || !rows[0].length || rows.some(row => !Array.isArray(row) || row.length !== rows[0].length || row.some(value => typeof value !== 'string' && typeof value !== 'number'))) throw new Error(`Invalid cell grid in ${name}`);
			const styles = sheet.styles;
			if (styles != null && (!Array.isArray(styles) || styles.length !== rows.length || styles.some((row, r) => !Array.isArray(row) || row.length !== rows[r].length || row.some(style => !style || typeof style !== 'object' || Array.isArray(style))))) throw new Error(`Invalid styles in ${name}`);
			if (sheet.conditionalRules !== undefined) validateConditionalRules(sheet.conditionalRules, rows);
			return { ...JSON.parse(JSON.stringify(sheet)), name: name.trim(), rows: rows.map(row => row.map(String)), styles: rows.map((row, r) => row.map((_, c) => ({ ...this.defaultStyling, ...styles?.[r]?.[c] }))), selRow: 0, selCol: 0 };
		});
		const active = data?.activeSheet ?? 0;
		if (!Number.isInteger(active) || active < 0 || active >= sheets.length) throw new Error('Invalid active sheet');
		const marks = JSON.parse(JSON.stringify(data?.marks === undefined ? [] : data.marks));
		validateMarks(marks, sheets);
		const { version, activeSheet, sheets: ignored, ...metadata } = data?.sheets ? data : {};
		return { sheets, active, marks, metadata: JSON.parse(JSON.stringify(metadata)) };
	}

	loadWorkbook(data, path = null) {
		const { sheets, active, marks, metadata } = this.validateWorkbook(data);
		for (const key of Object.keys(this.workbook)) delete this.workbook[key];
		Object.assign(this.workbook, metadata);
		this.workbook.marks = marks;
		this.workbook.sheets = sheets;
		this.workbook.activeSheetIndex = active;
		this.path = path;
		this.markStructureChanged = false;
		this.markWriteCells = null;
		this.switchSheet(active + 1);
		historyManager.reset(this);
		this.notifyWorkbookChanged('baseline');
	}

	clearScreen() {
		for (const mark of this.marks.filter(mark => mark.kind === 'dataset' && mark.sheetName === this.activeSheet.name)) this.rewriteMark(mark.name, null);
		this.workbook.marks = this.marks.filter(mark => mark.kind !== 'dataset' || mark.sheetName !== this.activeSheet.name);
		if (this.activeSheet.conditionalRules) this.activeSheet.conditionalRules = [];
		this.rows = [];
		this.styles = [];

		for (let i = 0; i < this.numOfRows.value; i++) {
			let row = [];
			let styleRow = [];
			for (let j = 0; j < this.numOfCols.value; j++) {
				row.push("");
				styleRow.push({
					fg: "white",
					bg: "transparent",
				});
			}
			this.rows.push(row);
			this.styles.push(styleRow);
		}

		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.loadStyles();
		historyManager.do(this);
	}

	loadStyles() {
		// Every view binds styling from the model; never write one window's DOM to style a sheet.
		this.styleVersion.value++;
	}

	setStyles(com, row, col, recordUndo = true) {
		const tokens = com.trim().split(/\s+/).slice(1), changes = [];
		// Validate the whole command before mutating styles or publishing history.
		for (let i = 0; i < tokens.length; i++) {
			const key = tokens[i];
			if (key === 'reset' || key === 'resetall') { changes.push([key]); continue; }
			if (!['fg', 'bg', 'align'].includes(key) || tokens[i + 1] === undefined) throw new Error('Usage: :hi fg <colour> bg <colour> align <auto|left|center|right> (or reset / resetall)');
			const value = tokens[++i];
			if (key === 'align') {
				if (!horizontalAlignments.includes(value)) throw new Error('Alignment must be auto, left, center or right');
			} else {
				const style = new Option().style;
				style.color = value;
				if (!style.color) throw new Error(`${value} is not a valid CSS color`);
			}
			changes.push([key, value]);
		}
		for (const [key, value] of changes) {
			if (key === 'resetall') this.resetAllStyles(false);
			else if (key === 'reset') Object.assign(this.styles[row][col], this.defaultStyling);
			else if (key === 'align' && value === 'auto') delete this.styles[row][col].align;
			else this.styles[row][col][key] = value;
		}
		this.loadStyles();
		if (recordUndo) historyManager.do(this);
	}

	resetStyles(row, col) {
		this.setStyles(":hi fg white bg transparent", row, col);
	}

	resetAllStyles(recordUndo = true) {
		// Existing highlight resets affect colours, not number formats or layout metadata.
		this.styles = this.styles.map(row => row.map(style => ({ ...style, fg: this.defaultStyling.fg, bg: this.defaultStyling.bg })));
		this.loadStyles();
		if (recordUndo) historyManager.do(this);
	}

	setConditionalRules(rules) {
		const next = validateConditionalRules(rules, this.rows);
		if (JSON.stringify(next) === JSON.stringify(this.activeSheet.conditionalRules ?? [])) return false;
		this.activeSheet.conditionalRules = next;
		this.recalculate();
		historyManager.do(this);
		return true;
	}

	adjustConditionalRules(axis, at, removed, inserted) {
		if (this.activeSheet.conditionalRules?.length) this.activeSheet.conditionalRules = adjustConditionalRules(this.activeSheet.conditionalRules, axis, at, removed, inserted);
	}

	// function to get the formula for a specific cell
	getFormula(row, col) {
		// tries to get the formula, if it fails, it returns blank and logs the error
		try {
			return this.rows[row][col];
		} catch (e) {
			console.log(e.message);
			return "";
		}
	}

	// Run fn inside one evaluation pass (reusing the active pass for nested calls such as charts).
	runPass(fn) {
		if (this.pass) return fn(this.pass, this.pass.session);
		const blocked = new Set();
		try {
			for (let attempt = 0; ; attempt++) {
				const session = { passes: new Map(), stack: new Map(), probes: [] };
				const pass = new CalcPass(this, blocked, session);
				this.pass = pass;
				const result = fn(pass, session);
				const broken = [];
				for (const other of session.passes.values()) broken.push(...other.verify());
				const count = [...session.passes.values()].reduce((n, other) => n + other.formulaCells.length, 0);
				if (!broken.length || attempt > count) return result;
				broken.forEach(key => blocked.add(key));
			}
		} finally {
			this.pass = null;
		}
	}

	// Data only, from the final verified attempt. Foreign-sheet passes share the same session.
	// Optional exact reads precede the UI's lossy decimal conversion; no pass/ctx escapes.
	calculateWorkbook(read = null) {
		const calculation = this.runPass((active, session) => {
			const passes = this.sheets.map(record => session.passes.get(record) ?? new CalcPass(this, active.blocked, session, record));
			const sheets = passes.map(pass => pass.snapshot());
			let cells;
			if (read) {
				const pass = passes[read.sheet];
				cells = [];
				for (let row = read.r0; row <= read.r1; row++) {
					const line = [];
					for (let col = read.c0; col <= read.c1; col++) {
						try {
							const value = pass.formulaRead(row, col, false);
							line.push({ value, blank: pass.raw(row, col) === '' && value === '' && !sheets[read.sheet].spills.has(keyOf(row, col)) });
						} catch (error) {
							const displayed = sheets[read.sheet].values[row][col];
							line.push(displayed?.kind === 'chart' ? { value: displayed } : { error: explain(error) });
						}
					}
					cells.push(line);
				}
			}
			return { sheets, cells };
		});
		// Predicates only read settled typed values; they cannot affect spill discovery.
		const results = new Map(this.sheets.map((record, i) => [record, calculation.sheets[i]]));
		for (const record of this.sheets) Object.assign(results.get(record), evaluateConditionalRules(record, results, this.sheets, (name, column) => this.resolveMark(name, column)));
		return calculation;
	}

	// Value of a cell: stored text, a formula result (the full 2D array at an array formula), or the
	// spilled element of an empty cell. Top-level calls return errors as their message; nested calls
	// (during evaluation, e.g. from charts) throw them.
	getValue(row, col) {
		row = Number(row);
		col = Number(col);
		if (this.pass) return toCellValue(this.pass.cellValue(row, col));
		return this.runPass(pass => {
			try {
				return toCellValue(pass.cellValue(row, col));
			} catch (error) {
				return errorText(error);
			}
		});
	}

	// Like getValue, but an array formula gives the element displayed in its own cell.
	getElementValue(row, col) {
		const value = this.getValue(row, col);
		return Array.isArray(value) ? value[0][0] : value;
	}

	// Evaluate the formula of a cell, throwing errors.
	evaluateCell(row, col) {
		return this.runPass(pass => toCellValue(isFormula(pass.raw(row, col)) ? pass.result(row, col) : pass.raw(row, col)));
	}

	// One settled workbook pass feeds every visible window. Inactive sheets must not show stale data.
	recalculate() {
		return this.installCalculation(this.calculateWorkbook());
	}

	installCalculation({ sheets }) {
		this.sheetResults.value = new Map(this.sheets.map((record, i) => [record, sheets[i]]));
		const { values, typed, spills, errors } = this.sheetResults.value.get(this.activeSheet);
		this.spillCells.clear();
		spills.forEach((value, key) => this.spillCells.set(key, value));
		this.cellErrors.clear();
		errors.forEach((value, key) => this.cellErrors.set(key, value));
		this.cellValues.value = values;
		this.calculated = { sheet: this.activeSheet, typed };
		this.refreshPresentation();
		return values;
	}

	refreshPresentation() {
		const results = new Map();
		for (const [record, result] of this.sheetResults.value) {
			const preview = this.formatPreview?.sheet === record ? this.formatPreview.styles : null;
			const presentation = result.values.map((row, r) => row.map((legacy, c) => {
				const value = result.typed[r][c], text = toDisplayString(legacy);
				return { value, ...(result.errors.has(keyOf(r, c)) ? { text, warning: '', align: 'left' } : presentCell(value, preview?.get(keyOf(r, c)) ?? record.styles[r]?.[c], text)) };
			}));
			results.set(record, { ...result, presentation });
		}
		this.sheetResults.value = results;
		this.cellPresentation.value = results.get(this.activeSheet)?.presentation ?? [];
	}

	// DOM-free, raw-content-atomic edit on the active sheet. Writes require raw string values
	// and unique destinations. Optional sources are spill-protected seeds, not a general read set
	// or expected-value check. Call synchronously after staging; the caller owns history and the
	// post-edit recalculation. Cursor, styles, registers and dimensions are untouched. Validation
	// refreshes derived caches even when it rejects an edit; it never rolls back formula results.
	applyRangeEdit(writes, sources = []) {
		const cells = [...sources, ...writes];
		for (const { row, col } of cells) {
			if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= this.rows.length || col >= this.rows[0].length) {
				throw new Error('Range extends outside the sheet; nothing changed');
			}
		}
		const destinations = new Set();
		for (const { row, col, value } of writes) {
			if (typeof value !== 'string') throw new Error('Range writes require raw string values');
			const key = keyOf(row, col);
			if (destinations.has(key)) throw new Error(`Duplicate range destination ${cellLabel(row, col)}`);
			destinations.add(key);
		}
		// A preceding macro command may have changed spill ownership before its render runs.
		this.recalculate();
		for (const { row, col } of cells) {
			const owner = this.spillCells.get(keyOf(row, col));
			if (owner) throw new Error(`Range intersects spill ${cellLabel(owner.row, owner.col)}; nothing changed`);
		}
		if (!writes.some(({ row, col, value }) => this.rows[row][col] !== value)) return false;
		const marks = this.prepareMarkWrites(writes);
		for (const { row, col, value } of writes) this.rows[row][col] = value;
		this.workbook.marks = marks;
		return true;
	}

	// Copy raw seeds, or generate decimal numeric literals from them. Direction chooses the
	// source edge, never the order in which the visual selection's corners were established.
	fillRange({ r0, c0, r1, c1 }, direction, step) {
		if (r0 < 0 || c0 < 0 || r1 >= this.rows.length || c1 >= this.rows[0].length) throw new Error('Range extends outside the sheet; nothing changed');
		const vertical = direction === 'down' || direction === 'up';
		const length = vertical ? r1 - r0 : c1 - c0, lanes = vertical ? c1 - c0 + 1 : r1 - r0 + 1;
		const dr = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
		const dc = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
		const increment = step === undefined ? null : cellToValue(step);
		if (increment !== null && !increment?.isFinite?.()) throw new Error('Series step must be a finite number');
		const sources = [], writes = [];
		for (let lane = 0; lane < lanes; lane++) {
			const row = (direction === 'up' ? r1 : r0) + (vertical ? 0 : lane);
			const col = (direction === 'left' ? c1 : c0) + (vertical ? lane : 0);
			const raw = this.rows[row][col], seed = increment === null ? raw : cellToValue(raw);
			if (increment !== null && !seed?.isFinite?.()) throw new Error(`Series seed ${cellLabel(row, col)} must be a finite literal number`);
			sources.push({ row, col });
			for (let i = 1; i <= length; i++) {
				const value = increment === null ? raw : seed.plus(increment.times(i));
				if (increment !== null && !value.isFinite()) throw new Error('Series result must be finite; nothing changed');
				writes.push({ row: row + dr * i, col: col + dc * i, value: increment === null ? value : value.toString() });
			}
		}
		return this.applyRangeEdit(writes, sources);
	}

	columnLabel(col) {
		let label = '';
		for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
		return label;
	}

	// function to select a specific cell
	selectCell(row, col) {
		row = Math.max(0, Math.min(row, this.rows.length - 1));
		col = Math.max(0, Math.min(col, this.rows[0].length - 1));
		this.selRow = row; this.selCol = col;
		const menu = document.getElementsByClassName('rcActive')[0];
		if (menu) menu.className = 'cellRightClick rcInactive';
		const picker = document.getElementById('cellPicker');
		if (picker) picker.value = this.columnLabel(col) + row;
		this.getSelectedCell()?.classList.remove('focussed');
		this.getCell(row, col)?.classList.add('focussed');
		this.ensureCellVisible(row, col);
		this.tempForm = this.getFormula(row, col);
		this.clearPlaceholder();
	}

	ensureCellVisible(row, col) {
		const cell = this.getCell(row, col), viewport = cell?.closest('.sheet-viewport');
		if (!viewport) return;
		const rect = cell.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
		const header = viewport.querySelector('thead').offsetHeight;
		const labels = [...viewport.querySelectorAll('thead .rowLabelType')].reduce((sum, label) => sum + label.offsetWidth, 0);
		if (rect.top < bounds.top + header) viewport.scrollTop -= bounds.top + header - rect.top;
		else if (rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom;
		if (rect.left < bounds.left + labels) viewport.scrollLeft -= bounds.left + labels - rect.left;
		else if (rect.right > bounds.right) viewport.scrollLeft += rect.right - bounds.right;
	}

	scrollToCenterSelCell() {
		let cell = this.getCell(this.selRow, this.selCol);

		cell.scrollIntoView({
			behavior: "smooth",
			block: "center",
			inline: "center",
		});
	}

	// function to set the formula of the selected cell
	setFormula(move = true) {
		// set the formula from the formula bar to the selected cell
		this.rows[this.selRow][this.selCol] =
			document.getElementById("formulaBar")?.value ?? this.tempForm;
		this.commitMarkedEdit();

		// update the value of the selected cell
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);

		//this.moveDown(1);
		if (move) {
			this.keyboardMotion(0, 1);
		}
		historyManager.do(this, 334);
	}

	setSpecFormula(value) {
		const oldValue = this.getFormula(this.selRow, this.selCol);

		this.rows[this.selRow][this.selCol] = value;
		this.commitMarkedEdit();
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		historyManager.do(this, 353);
	}

	updateEditFormula(form) {
		//document.getElementById("formText").innerText = form;
		document.getElementById("formText").innerHTML =
			new SyntaxHighlighting().highlight(form);
	}

	// called when the user yanks something
	yank(cells) {
		this.copyBuffer = cells;
	}

	yankFormula() {
		let col = this.selCol;
		let row = this.selRow;
		let text = this.getFormula(row, col);
		navigator.clipboard.writeText(text);
		this.yank([[text]]);
	}

	getCopyValue(row, col) {
		const value = this.getElementValue(row, col);
		return value?.kind === "chart" ? this.getFormula(row, col) : value;
	}

	yankValue() {
		let col = this.selCol;
		let row = this.selRow;
		let text = this.getCopyValue(row, col);
		navigator.clipboard.writeText(text);
		this.yank([[text]]);
	}

	relativeYank(end) {
		const startRow = this.selRow;
		const endRow = this.selRow + end;

		this.yank(this.rows.slice(startRow, endRow));
	}

	paste(amount, horizontal = false) {
		for (let i = 0; i < amount; i++) {
			for (let y = 0; y < this.copyBuffer.length; y++) {
				for (let x = 0; x < this.copyBuffer[y].length; x++) {
					this.noteMarkWrite(this.selRow + y, this.selCol + x);
					this.rows[this.selRow + y][this.selCol + x] = this.copyBuffer[y][x];
				}
			}
			this.commitMarkedEdit();
			this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
			//this.moveDown(1);
			if (!horizontal) {
				this.keyboardMotion(0, this.copyBuffer.length);
			} else {
				this.keyboardMotion(this.copyBuffer[0].length, 0);
			}
		}
		historyManager.do(this, 397);
	}

	pasteInGapRow(amount, dir) {
		if (dir == -1) this.keyboardMotion(0, -1);

		const startRow = this.selRow + 1;
		const startCol = this.selCol;

		const rowAmount = this.copyBuffer.length * amount;

		this.insertRowBelow(rowAmount);

		this.selectCell(startRow, startCol);
		this.paste(amount, false);
	}

	pasteInGapCol(amount, dir) {
		if (dir == -1) this.keyboardMotion(-1, 0);
		const startRow = this.selRow;
		const startCol = this.selCol + 1;

		const colAmount = this.copyBuffer[0].length * amount;

		this.insertColRight(colAmount);

		this.selectCell(startRow, startCol);

		this.paste(amount, true);
	}

	// function to get the element of a specific cell
	getCell(row, col) {
		const pane = document.getElementById('sheetViewport')?.closest('.workspace-window');
		return pane ? document.getElementById(`window-${pane.dataset.window}-${col}:${row}`) : null;
	}

	// returns the currently selected cell based on the className "focusssed"
	getSelectedCell() {
		return document.getElementsByClassName("focussed")[0];
	}

	cellMotion(amount, tempForm = "") {
		this.cellCurPos += amount;
		this.cellCurPos = Math.max(0, this.cellCurPos);
		const cell = this.getFormula(this.selRow, this.selCol);
		this.cellCurPos = Math.min(this.cellCurPos, this.tempForm.length);

		document.getElementById("formCursor").style.marginLeft = this.cellCurPos.toString() + "ch";
		visualManager.setVisual(this.selRow, this.selCol, this.cellCurPos, this.numOfCols.value);
	}

	setCellCurPos(value, tempForm = "") {
		this.cellCurPos = value;
		this.cellMotion(0, tempForm);
	}

	// navigation functions
	keyboardMotion(x, y) {
		let newCol = this.selCol + x;
		let newRow = this.selRow + y;
		newCol = Number(Math.max(0, newCol));
		newCol = Number(Math.min(newCol, this.numOfCols.value - 1));

		newRow = Number(Math.max(0, newRow));
		newRow = Number(Math.min(newRow, this.numOfRows.value - 1));

		this.selectCell(newRow, newCol);
		this.updateRelRows();
	}

	// function to update the relative row numbers
	updateRelRows() {
		// SheetRow binds labels to each window's own cursor.
	}

	// functions for saving using strings, temporary before i work out backend
	saveSheetToClipboard() {
		let str = JSON.stringify(this.rows);
		navigator.clipboard.writeText(str);
		let commandLine = document.getElementById("commandLine");
	}

	async loadFromClipboard() {
		let str = await navigator.clipboard.readText();

		if (str === "") {
			this.setPlaceholder("Copy a sheet's JSON before loading from the clipboard");
			return;
		}
		let data = JSON.parse(str);
		if (this.marks.some(mark => mark.sheetName === this.activeSheet.name)) throw new Error('Remove sheet marks before replacing its grid; open a workbook to replace cells and definitions together');
		this.rows = data;
		this.loadAllCells(data.length, data[0].length);
		this.clearPlaceholder();
	}

	clearPlaceholder() {
		let commandLine = document.getElementById("commandLine");
		commandLine.dataset.message = "";
	}

	setPlaceholder(str) {
		let commandLine = document.getElementById("commandLine");
		commandLine.dataset.message = str;
	}

	loadAllCells(r, c, calculation = null) {
		if (calculation) this.installCalculation(calculation);
		else this.recalculate();

		// checks if new cells are being created, if they are, then it lets the styles be loaded once it is all mounted, otherwise it loads the styles right away.
		if (r == null) this.loadStyles();
		else if (r >= this.numOfRows.value && c >= this.numOfCols.value) {
			this.loadStyles();
		}

		this.clearPlaceholder();
	}

	removeColAtIndex(index) {
		this.editMarkedStructure('col', index, 1, 0);
		this.adjustConditionalRules('col', index, 1, 0);
		for (let i = 0; i < this.rows.length; i++) {
			this.rows[i].splice(index, 1);
			this.styles[i].splice(index, 1);
		}

		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.selectCell(this.selRow, this.selCol);
		this.commitMarkedEdit();
		historyManager.do(this, 546);
	}

	deleteSelCol(amount) {
		for (let i = 0; i < amount; i++) {
			this.removeColAtIndex(this.selCol);
		}
	}

	removeRowAtIndex(index) {
		this.editMarkedStructure('row', index, 1, 0);
		this.adjustConditionalRules('row', index, 1, 0);
		this.rows.splice(index, 1);
		this.styles.splice(index, 1);
		this.numOfRows.value--;
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.selectCell(this.selRow, this.selCol);
		this.commitMarkedEdit();
		historyManager.do(this, 563);
	}

	deleteSelRow(amount) {
		for (let i = 0; i < amount; i++) {
			this.removeRowAtIndex(this.selRow);
		}
	}

	insertRowAtIndex(index, amount = 1) {
		this.editMarkedStructure('row', index, 0, amount);
		const createRow = () =>
			Array.from({ length: this.numOfCols.value }, () => "");
		const createStyleRow = () =>
			Array.from({ length: this.numOfCols.value }, () => ({
				fg: this.defaultStyling.fg,
				bg: this.defaultStyling.bg,
			}));

		const rowsToInsert = Array.from({ length: amount }, createRow);
		const stylesToInsert = Array.from({ length: amount }, createStyleRow);

		this.adjustConditionalRules('row', index, 0, amount);
		this.rows.splice(index, 0, ...rowsToInsert);
		this.styles.splice(index, 0, ...stylesToInsert);

		this.numOfRows.value += amount;
		this.selectCell(this.selRow, this.selCol);
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);
		this.commitMarkedEdit();
		historyManager.do(this, 578);
	}

	insertColumnAtIndex(index) {
		this.editMarkedStructure('col', index, 0, 1);
		this.adjustConditionalRules('col', index, 0, 1);
		for (let i = 0; i < this.numOfRows.value; i++) {
			this.rows[i].splice(index, 0, "");
			this.styles[i].splice(index, 0, {
				fg: this.defaultStyling.fg,
				bg: this.defaultStyling.bg,
			});
		}
		this.numOfCols.value++;
		this.loadAllCells(this.numOfRows.value, this.numOfCols.value);

		this.selectCell(this.selRow, this.selCol);
		this.commitMarkedEdit();
		historyManager.do(this, 599);
	}

	insertRowBelow(amount = 1) {
		//for (let i = 0; i < amount; i++) {
		//this.insertRowAtIndex(this.selRow + 1);
		//this.keyboardMotion(0, 1);
		//}
		//
		this.insertRowAtIndex(this.selRow + 1, amount);
		this.keyboardMotion(0, 1);
	}

	insertRowAbove(amount = 1) {
		for (let i = 0; i < amount; i++) {
			this.insertRowAtIndex(this.selRow);
		}
		//this.moveUp(1);
	}

	insertColRight(amount) {
		for (let i = 0; i < amount; i++) {
			this.insertColumnAtIndex(this.selCol + 1);
		}
		this.keyboardMotion(amount, 0);
	}

	insertColLeft(amount) {
		for (let i = 0; i < amount; i++) {
			this.insertColumnAtIndex(this.selCol);
		}
		//this.moveLeft(1);
	}
}
