import Formulas from "./FormulaFunctions.js";

const formulas = new Formulas();

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
		let quoted = false;
		let start = 0;
		let end = -1;
		for (let i = 0; i < rest.length; i++) {
			const char = rest[i];
			if (quoted) {
				if (char === "\\") i++;
				else if (char === '"') quoted = false;
				continue;
			}
			if (char === '"') quoted = true;
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

export function evaluateChart(source, row, col, sheet) {
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
		let ref = formulas.replaceVariables(arg, row, col);
		ref = formulas.evaluateRefCalcs(ref, sheet);
		ref = formulas.evaluateLetterRefCalcs(ref, sheet).replace(/\s/g, "");
		const match = ref.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
		if (!match) throw new Error(`Invalid range: ${arg}`);
		const column = letters => [...letters].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
		const c0 = column(match[1]);
		const r0 = Number(match[2]);
		const c1 = column(match[3] ?? match[1]);
		const r1 = Number(match[4] ?? match[2]);
		if (r1 < r0 || c1 < c0 || (r0 !== r1 && c0 !== c1)) {
			throw new Error(`Use a single row or column in ascending order: ${arg}`);
		}
		if (r1 >= sheet.rows.length || c1 >= sheet.rows[0].length) throw new Error(`Range outside sheet: ${arg}`);
		const values = [];
		for (let r = r0; r <= r1; r++) {
			for (let c = c0; c <= c1; c++) {
				const value = sheet.getElementValue(r, c);
				if (value?.kind === "chart") throw new Error("A chart cannot be used as chart data");
				values.push(value);
			}
		}
		return values;
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
