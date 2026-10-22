import { referenceSpans, resolveReference, toCellValue } from "./FormulaFunctions.js";
import { builderCalls } from './FormulaBuilder.js';
import { ChartType, NumberType, TextType, ReferenceType, union, parameter, defineFunction } from './FormulaTypes.js';

function text(arg) {
	if (!arg?.startsWith('"')) throw new Error("Text must be in double quotes");
	return JSON.parse(arg);
}

function dimension(arg, allowZero = false) {
	if (!/^\d+(?:\.\d+)?$/.test(arg)) throw new Error("Sizes and positions must be numbers in pixels");
	const value = Number(arg);
	if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
		throw new Error(allowZero ? "Positions must be nonnegative" : "Sizes must be positive");
	}
	return value;
}

function number(value, label) {
	if ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value))) {
		throw new Error(`${label} must contain finite numbers`);
	}
	return Number(value);
}

ChartType.methods = {
	...Object.fromEntries(['line', 'bar', 'scatter', 'pie'].map(kind => [kind, defineFunction({ parameters: [], returns: ChartType,
		description: `Select a ${kind} chart; later type calls override earlier ones. ${kind === 'pie' ? 'Requires exactly one series with nonnegative values. Zero/blank values create no slice.' : kind === 'scatter' ? 'Requires finite numeric x-values; points retain source order.' : 'Blank y-values leave gaps; zero and negative values are supported.'}`,
		examples: [`CHART().${kind}().series(B0:B3)`], run: ({ chart }) => { chart.type = kind; } })])),
	x: defineFunction({ parameters: [parameter('labelRange', ReferenceType)], returns: ChartType,
		description: 'Set shared labels or scatter x-values from an ascending single row/column/cell reference. Relative, cross-sheet and named references work. Length must match every series. Default: point numbers starting at 1.', errors: ['Invalid reference/shape, mismatched length, or nonnumeric scatter x-value.'], examples: ['CHART().bar().x(A0:A3).series(B0:B3)'], run: (state, [range]) => { state.xRange = range; } }),
	series: defineFunction({ parameters: [parameter('valueRange', ReferenceType), parameter('name', TextType, { optional: true, help: '["name"]' })], returns: ChartType,
		description: 'Append a series from an ascending single row/column/cell reference. Names are double-quoted text literals, defaulting to Series 1, Series 2, …. All series must have the same length; finite numeric data is required and blanks create gaps. Pie permits one nonnegative series. Source edits recalculate the chart.', errors: ['Invalid/nonfinite data, invalid reference, unequal lengths or invalid pie data.'], examples: ['CHART().line().series(B0:B3,"Revenue")'], run: ({ chart, seriesRanges }, [range, name]) => {
		seriesRanges.push(range); chart.series.push({ name: name === undefined ? `Series ${chart.series.length + 1}` : text(name) });
	} }),
	...Object.fromEntries(['title', 'xLabel', 'yLabel'].map(name => [name, defineFunction({ parameters: [parameter('text', TextType, { help: '"text"' })], returns: ChartType,
		description: `Set ${name} using a double-quoted text literal, not a formula expression. Defaults to empty text. Axis labels are ignored by pie charts. Text is displayed literally, never as HTML.`, examples: [`CHART().line().series(B0:B3).${name}("Revenue")`], run: ({ chart }, [value]) => { chart[name] = text(value); } })])),
	size: defineFunction({ parameters: [parameter('width', NumberType), parameter('height', NumberType)], returns: ChartType,
		description: 'Set overall pixel dimensions using positive numeric literals. Defaults to 320 × 200; does not change cell sizes. Later size/width/height calls override the relevant dimensions.', errors: ['Nonpositive or nonliteral dimensions.'], examples: ['CHART().line().series(B0:B3).size(360,220)'], run: ({ chart }, args) => { [chart.width, chart.height] = args.map(arg => dimension(arg)); } }),
	...Object.fromEntries(['width', 'height'].map(name => [name, defineFunction({ parameters: [parameter('pixels', NumberType)], returns: ChartType,
		description: `Set ${name} in pixels using a positive numeric literal. Defaults to ${name === 'width' ? 320 : 200}. Later calls override earlier settings without resizing cells.`, errors: ['Nonpositive or nonliteral dimension.'], examples: [`CHART().line().series(B0:B3).${name}(240)`], run: ({ chart }, [value]) => { chart[name] = dimension(value); } })])),
	position: defineFunction({ parameters: [parameter('x', NumberType), parameter('y', NumberType)], returns: ChartType,
		description: 'Set nonnegative pixel offsets from the formula cell, using numeric literals. Defaults to (0,0). The chart moves with its cell; no drag-positioning or cell-size changes.', errors: ['Negative or nonliteral position.'], examples: ['CHART().line().series(B0:B3).position(12,8)'], run: ({ chart }, args) => { const [x, y] = args.map(arg => dimension(arg, true)); chart.position = { x, y }; } }),
};

export const chartFunction = defineFunction({ parameters: [], returns: union(ChartType, TextType), description: 'Begin a declarative Chart builder. No build() terminal is needed: a selected chart type renders over the grid. Without a type the cell displays blank. A typed chart requires at least one series; configurations apply in call order. Readable errors are prefixed Chart:.', errors: ['Malformed builder, invalid data or circular source references.'], examples: ['CHART().line().series(B0:B3)'], run: evaluateChart });

export function evaluateChart(source, row, col, ctx) {
	const chart = {
		kind: "chart", type: null, width: 320, height: 200,
		position: { x: 0, y: 0 }, title: "", xLabel: "", yLabel: "", series: [],
	};
	const seriesRanges = [];
	const state = { chart, seriesRanges, xRange: undefined };
	for (const { method, args } of builderCalls(source, 'CHART')) {
		const definition = ChartType.method(method);
		if (!definition) throw new Error(`Unknown method .${method}()`);
		if (args.length < definition.min || args.length > definition.max || args.some(arg => !arg)) {
			throw new Error(`Wrong arguments for .${method}()`);
		}
		definition.run(state, args);
	}
	if (!chart.type) return "";
	if (!chart.series.length) throw new Error("Add at least one .series(range)");

	function range(arg) {
		// Resolve references only in range arguments, never inside titles or names.
		const span = referenceSpans(arg)[0];
		if (!span || span.start !== 0 || span.end !== arg.length) throw new Error(`Invalid range: ${arg}`);
		if (span.prefix === '#REF!') throw new Error('Referenced sheet or mark was deleted');
		let target = span.sheetName === undefined ? ctx : ctx.sheet(span.sheetName);
		const resolved = resolveReference(span.kind === 'mark' ? arg : span.reference, row, col, target);
		const { r0, c0, r1, c1 } = resolved;
		if (resolved.sheetName) target = ctx.sheet(resolved.sheetName);
		if (resolved.height === 0) throw new Error('Dataset has no records');
		if (r1 < r0 || c1 < c0 || (r0 !== r1 && c0 !== c1)) {
			throw new Error(`Use a single row or column in ascending order: ${arg}`);
		}
		try {
			const values = [];
			for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) values.push(toCellValue(target.element(r, c)));
			return values;
		} catch (error) {
			if (error.message === '#REF!') throw new Error(`Range outside sheet: ${arg}`);
			throw error;
		}
	}

	for (const [i, series] of chart.series.entries()) {
		series.values = range(seriesRanges[i]).map(value =>
			String(value).trim() === "" ? null : number(value, seriesRanges[i]));
	}
	const length = chart.series[0].values.length;
	chart.x = state.xRange ? range(state.xRange) : Array.from({ length }, (_, i) => i + 1);
	if (chart.x.length !== length || chart.series.some(series => series.values.length !== length)) {
		throw new Error("X range and every series must have the same length");
	}
	if (chart.type === "scatter") {
		chart.x = chart.x.map(value => {
			if (String(value).trim() === "") throw new Error("Scatter x-values must contain finite numbers");
			return number(value, "Scatter x-values");
		});
	}
	if (chart.type === "pie") {
		if (chart.series.length !== 1) throw new Error("Pie charts require exactly one .series(range)");
		if (chart.series[0].values.some(value => value !== null && value < 0)) {
			throw new Error("Pie values must be nonnegative");
		}
	}
	return chart;
}
