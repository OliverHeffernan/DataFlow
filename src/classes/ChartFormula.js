import { referenceSpans, resolveReference, toCellValue } from "./FormulaFunctions.js";

// Read only builder calls and their arguments, never executable JavaScript.
function calls(source) {
	let rest = source.replace(/^=\s*CHART\s*\(\s*\)/, "");
	if (rest === source) throw new Error("Start with CHART()");
	const result = [];
	while (rest.trim()) {
		const method = rest.match(/^\s*\.\s*([A-Za-z]+)\s*\(/);
		if (!method) throw new Error("Expected a builder method such as .series(B1:B6)");
		rest = rest.slice(method[0].length);
		const args = [];
		const stack = [];
		let quoted = null;
		let start = 0;
		let end = -1;
		for (let i = 0; i < rest.length; i++) {
			const char = rest[i];
			if (quoted) {
				if (char === "\\") i++;
				else if (char === "'" && quoted === "'" && rest[i + 1] === "'") i++;
				else if (char === quoted) quoted = null;
				continue;
			}
			if (char === '"' || char === "'") quoted = char;
			else if ("([{".includes(char)) stack.push(char);
			else if (char === ")" && stack.length === 0) {
				const arg = rest.slice(start, i).trim();
				if (arg || args.length) args.push(arg);
				end = i;
				break;
			} else if (")]}".includes(char)) {
				const expected = { ")": "(", "]": "[", "}": "{" }[char];
				if (stack.pop() !== expected) throw new Error("Mismatched brackets");
			} else if (char === "," && stack.length === 0) {
				args.push(rest.slice(start, i).trim());
				start = i + 1;
			}
		}
		if (end < 0) throw new Error("Unclosed method or quoted string");
		result.push({ method: method[1], args });
		rest = rest.slice(end + 1);
	}
	return result;
}

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

export function evaluateChart(source, row, col, ctx) {
	const chart = {
		kind: "chart", type: null, width: 320, height: 200,
		position: { x: 0, y: 0 }, title: "", xLabel: "", yLabel: "", series: [],
	};
	let xRange;
	const seriesRanges = [];
	for (const { method, args } of calls(source)) {
		const arity = {
			line: [0], bar: [0], scatter: [0], pie: [0], x: [1], series: [1, 2],
			title: [1], xLabel: [1], yLabel: [1], size: [2], width: [1], height: [1], position: [2],
		};
		if (!Object.hasOwn(arity, method)) throw new Error(`Unknown method .${method}()`);
		if (!arity[method].includes(args.length) || args.some(arg => !arg)) {
			throw new Error(`Wrong arguments for .${method}()`);
		}
		switch (method) {
			case "line": case "bar": case "scatter": case "pie": chart.type = method; break;
			case "title": case "xLabel": case "yLabel": chart[method] = text(args[0]); break;
			case "width": case "height": chart[method] = dimension(args[0]); break;
			case "size": [chart.width, chart.height] = args.map(arg => dimension(arg)); break;
			case "position": {
				const [x, y] = args.map(arg => dimension(arg, true));
				chart.position = { x, y };
				break;
			}
			case "x": xRange = args[0]; break;
			case "series":
				seriesRanges.push(args[0]);
				chart.series.push({ name: args.length === 2 ? text(args[1]) : `Series ${chart.series.length + 1}` });
				break;
		}
	}
	if (!chart.type) return "";
	if (!chart.series.length) throw new Error("Add at least one .series(range)");

	function range(arg) {
		// Resolve references only in range arguments, never inside titles or names.
		const span = referenceSpans(arg)[0];
		if (!span || span.start !== 0 || span.end !== arg.length) throw new Error(`Invalid range: ${arg}`);
		if (span.prefix === '#REF!') throw new Error('Referenced sheet was deleted');
		const target = span.sheetName === undefined ? ctx : ctx.sheet(span.sheetName);
		const { r0, c0, r1, c1 } = resolveReference(span.reference, row, col, target);
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
	chart.x = xRange ? range(xRange) : Array.from({ length }, (_, i) => i + 1);
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
