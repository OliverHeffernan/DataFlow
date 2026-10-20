import SheetManager from './SheetManager.js';
import HistoryManager from './HistoryManager.js';
import { executeLuaScript, scriptLimits } from './LuaScript.js';
import { toScriptValue } from './ScriptValues.js';
import { cellLabel } from './FormulaFunctions.js';

const encoder = new TextEncoder();
const changedCellLimit = 10000;
// Navigation is not content. All other workbook metadata participates in the stale check.
const content = ({ activeSheet, ...data }) => JSON.stringify(data);
function admit(data) {
	let cells = 0;
	for (const sheet of data.sheets) {
		const width = sheet.rows[0]?.length;
		if (!width || !sheet.rows.length || sheet.rows.some(row => row.length !== width || row.some(raw => typeof raw !== 'string')))
			throw new Error('Scripts require rectangular raw-string grids');
		cells += sheet.rows.length * width;
	}
	if (cells > scriptLimits.transferCells || encoder.encode(JSON.stringify(data)).length > scriptLimits.transferBytes)
		throw new Error('Script workbook limit: 100,000 cells / 8 MiB including metadata');
}

export function captureScriptWorkbook(sheet, context) {
	const data = sheet.serializeWorkbook();
	admit(data);
	const baseline = JSON.parse(JSON.stringify(data));
	const activeSheet = baseline.sheets.findIndex(item => item.name === context.sheetName);
	if (activeSheet < 0) throw new Error('Invoking sheet no longer exists');
	return { baseline, context: { ...context, selection: { ...context.selection } }, activeSheet };
}

function adapter(request) {
	admit(request.baseline);
	const draft = SheetManager.createDraft(request.baseline), operations = [];
	const changed = new Set();
	let writtenBytes = 0, writtenCells = 0;
	const write = (rect, matrix) => {
		const record = draft.sheets[rect.sheet];
		if (!record || ![rect.sheet, rect.r0, rect.c0, rect.r1, rect.c1].every(Number.isSafeInteger)
			|| rect.r0 < 0 || rect.c0 < 0 || rect.r1 < rect.r0 || rect.c1 < rect.c0
			|| rect.r1 >= record.rows.length || rect.c1 >= record.rows[0].length
			|| !Array.isArray(matrix) || matrix.length !== rect.r1 - rect.r0 + 1) throw new Error('Invalid script write rectangle');
		const writes = [];
		matrix.forEach((row, r) => {
			if (!Array.isArray(row) || row.length !== rect.c1 - rect.c0 + 1) throw new Error('Invalid script write matrix');
			row.forEach((value, c) => {
				if (typeof value !== 'string') throw new Error('Scripts write raw strings only');
				const size = encoder.encode(value).length;
				if (size > scriptLimits.cellBytes) throw new Error('Script cell limit exceeded');
				writtenBytes += size; writtenCells++;
				const at = { row: rect.r0 + r, col: rect.c0 + c, value };
				if (record.rows[at.row][at.col] !== value) changed.add(`${rect.sheet}:${at.row}:${at.col}`);
				writes.push(at);
			});
		});
		if (changed.size > changedCellLimit || writtenBytes > scriptLimits.transferBytes || writtenCells > scriptLimits.transferCells
			|| operations.length >= scriptLimits.apiCalls) throw new Error('Script write budget exceeded (10,000 changed cells / bounded transfer)');
		draft.workbook.activeSheetIndex = rect.sheet;
		draft.applyRangeEdit(writes);
		// Keep temporal batches: merging writes changes dataset growth and spill ownership semantics.
		operations.push({ rect: { ...rect }, matrix: matrix.map(row => [...row]) });
	};
	return { draft, operations, write, access: {
		sheets: draft.sheets.map(sheet => ({ name: sheet.name, rows: sheet.rows.length, cols: sheet.rows[0].length })),
		activeSheet: request.activeSheet,
		selection: { ...request.context.selection, sheet: request.activeSheet },
		resolve(name) {
			const match = name.match(/^`?([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/);
			if (!match) throw new Error('Use a mark or dataset.column identifier');
			const descriptor = draft.resolveMark(match[1], match[2]);
			return { ...descriptor, sheet: draft.sheets.findIndex(sheet => sheet.name === descriptor.sheetName) };
		},
		read(rect, computed) {
			if (!computed) return draft.sheets[rect.sheet].rows.slice(rect.r0, rect.r1 + 1).map(row => row.slice(rect.c0, rect.c1 + 1));
			return draft.calculateWorkbook(rect).cells.map(row => row.map(cell => cell.error
				? { kind: 'error', message: cell.error } : toScriptValue(cell.value, cell.blank)));
		},
		write,
	} };
}

function validate(draft) {
	admit(draft.serializeWorkbook());
	const calculation = draft.calculateWorkbook();
	calculation.sheets.forEach((cache, index) => {
		if (cache.errors.size) {
			const [key, error] = cache.errors.entries().next().value;
			const [row, col] = key.split(':').map(Number);
			throw new Error(`${draft.sheets[index].name}!${cellLabel(row, col)}: ${error}; nothing changed`);
		}
	});
	return calculation;
}

// Worker returns only bounded raw operations. UI values may contain non-cloneable MathJS values.
export function executeWorkbookScript({ source, ...request }) {
	const stage = adapter(request);
	const { logs } = executeLuaScript(source, stage.access);
	validate(stage.draft);
	return { operations: stage.operations, logs };
}

export function publishWorkbookScript(sheet, request, result, signal) {
	const started = performance.now(), baseline = content(request.baseline);
	const budget = () => {
		if (signal?.aborted) throw new DOMException('Script cancelled', 'AbortError');
		if (performance.now() - started > scriptLimits.timeoutMs) throw new Error('Script validation timed out; nothing changed');
	};
	const check = () => {
		budget();
		if (content(sheet.serializeWorkbook()) !== baseline) throw new Error('Workbook changed during script; run it again');
	};
	check();
	if (!Array.isArray(result?.operations) || result.operations.length > scriptLimits.apiCalls) throw new Error('Invalid script result');
	const stage = adapter(request);
	// Reuse the accepted mutator in a detached main-thread replay, never on live workbook rows.
	// Native formula work cannot be preempted here. Trusted-local scripts only; see docs.
	for (const { rect, matrix } of result.operations) { budget(); stage.write(rect, matrix); }
	budget();
	if (content(stage.draft.serializeWorkbook()) === baseline) return false;
	const calculation = validate(stage.draft);
	const workbook = stage.draft.serializeWorkbook();
	check(); // Immediately before synchronous publication, after every calculation/validation.
	sheet.restoreWorkbook(workbook, { ...calculation, workbook });
	new HistoryManager().do(sheet);
	return true;
}
