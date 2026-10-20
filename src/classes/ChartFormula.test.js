import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import SheetManager from "./SheetManager.js";
import VimKeyboard from "./VimKeyboard.js";
import { keyboardHints } from "./KeyboardHints.js";

const sheet = new SheetManager();
beforeEach(() => {
	sheet.rows = Array.from({ length: 10 }, () => Array(30).fill(""));
	for (const [i, [label, value, other]] of [
		["Jan", "-8", "14"], ["Feb", "0", "3"], ["Mar", "", "9"], ["Apr", "=2*7", "-5"],
	].entries()) {
		sheet.rows[i][0] = label;
		sheet.rows[i][1] = value;
		sheet.rows[i][2] = other;
	}
});

function chart(formula) {
	sheet.rows[6][4] = formula;
	return sheet.getValue(6, 4);
}

test("CHART builds multiple series, preserves quoted text and applies sizing in call order", () => {
	const title = 'A0: SUM(x), [brackets] {THISROW} < & /50 "quoted"';
	const result = chart(`= CHART().size(360, 220).height(280).position(12, 8).x(A0:A3).series(B0:B3, "Revenue").bar().title(${JSON.stringify(title)}).series(C0:C3).xLabel("Month").yLabel("NZD")`);
	assert.equal(result.kind, "chart");
	assert.equal(result.type, "bar");
	assert.equal(result.title, title);
	assert.deepEqual([result.width, result.height, result.position], [360, 280, { x: 12, y: 8 }]);
	assert.deepEqual(result.x, ["Jan", "Feb", "Mar", "Apr"]);
	assert.deepEqual(result.series, [
		{ name: "Revenue", values: [-8, 0, null, 14] },
		{ name: "Series 2", values: [14, 3, 9, -5] },
	]);
	assert.equal(result.xLabel, "Month");
	assert.equal(result.yLabel, "NZD");
});

test("charts remain blank until an explicit type is supplied, including when removing a saved type", () => {
	for (const builder of ['=CHART()', '=CHART().title("Pending")', '=CHART().series(B0:B3)']) {
		assert.equal(chart(builder), "");
		assert.equal(sheet.rows[6][4], builder);
	}
	for (const type of ['line', 'bar', 'scatter', 'pie']) {
		assert.equal(chart(`=CHART().series(C0:C2).${type}()`).type, type);
	}
	chart('=CHART().pie().series(C0:C2)');
	sheet.recalculate();
	assert.equal(sheet.getElementValue(6, 4).type, 'pie');
	sheet.rows[6][4] = '=CHART().series(C0:C2)';
	sheet.recalculate();
	assert.equal(sheet.getElementValue(6, 4), '');
});

test("minimal typed charts default to point numbers, 320 × 200 and no offset", () => {
	const result = chart("=CHART().line().series(B0:B3)");
	assert.deepEqual([result.type, result.width, result.height, result.position], ["line", 320, 200, { x: 0, y: 0 }]);
	assert.deepEqual(result.x, [1, 2, 3, 4]);
	assert.deepEqual(result.series[0].values, [-8, 0, null, 14]);
	assert.deepEqual(chart("=CHART().line().width(190).size(410,230).width(380).series(B0:B3)").width, 380);
});

test("range arguments support horizontal, single-cell, multi-letter and relative references", () => {
	assert.deepEqual(chart("=CHART().line().series(B0:C0)").series[0].values, [-8, 14]);
	assert.deepEqual(chart("=CHART().line().series(B0)").series[0].values, [-8]);
	sheet.rows[0][26] = "17";
	sheet.rows[1][26] = "23";
	assert.deepEqual(chart("=CHART().line().series(AA0:AA1)").series[0].values, [17, 23]);
	const relative = chart("=CHART().line().series([-3]{-6}:[-3]{-3})");
	assert.deepEqual(relative.series[0].values, [-8, 0, null, 14]);
	assert.deepEqual(chart("=CHART().line().series([1]{max(0, 1)-1}:[1]{1+2})").series[0].values, [-8, 0, null, 14]);
});

test("scatter uses numeric x-values without sorting or compacting gaps", () => {
	["5", "1", "20", "9"].forEach((value, i) => { sheet.rows[i][0] = value; });
	const result = chart("=CHART().scatter().series(B0:B3).x(A0:A3)");
	assert.equal(result.type, "scatter");
	assert.deepEqual(result.x, [5, 1, 20, 9]);
	assert.deepEqual(result.series[0].values, [-8, 0, null, 14]);
	sheet.rows[2][0] = "";
	assert.match(chart("=CHART().scatter().x(A0:A3).series(B0:B3)"), /Scatter x-values.*finite numbers/);
});

test("pie charts use one nonnegative series with labels, blanks and zeros preserved", () => {
	["6", "0", "", "=2+1"].forEach((value, i) => { sheet.rows[i][1] = value; });
	const result = chart('=CHART().pie().x(A0:A3).series(B0:B3,"Sales").title("Share")');
	assert.equal(result.type, "pie");
	assert.deepEqual(result.x, ["Jan", "Feb", "Mar", "Apr"]);
	assert.deepEqual(result.series, [{ name: "Sales", values: [6, 0, null, 3] }]);
	assert.deepEqual(chart("=CHART().series(B1:B2).pie()").series[0].values, [0, null]);
	assert.deepEqual(chart("=CHART().pie().series(B3)").x, [1]);
	assert.match(chart("=CHART().pie().series(B0:B3).series(C0:C3)"), /exactly one/);
	sheet.rows[0][1] = "-1";
	assert.match(chart("=CHART().pie().series(B0:B3)"), /nonnegative/);
	assert.equal(chart("=CHART().pie().series(B0:B3).bar()").type, "bar");
});

test("invalid builders and data return readable cell errors instead of executing code", () => {
	const cases = [
		["=CHART().line()", /Add at least one/],
		["=CHART(1).series(B0:B3)", /Start with CHART/],
		["=CHART().pie(1).series(B0:B3)", /Wrong arguments/],
		["=CHART().constructor().series(B0:B3)", /Unknown method/],
		["=CHART().series(B0:B3);globalThis.executed=true", /Expected a builder method/],
		["=CHART().series(B0:B3,)", /Wrong arguments/],
		['=CHART().series(B0:B3).title("unclosed)', /Unclosed/],
		['=CHART().series(B0:B3).title("valid", "extra")', /Wrong arguments/],
		['=CHART().series(B0:B3).title(notQuoted)', /double quotes/],
		["=CHART().series(B0:B3).size(0,200)", /Sizes must be positive/],
		["=CHART().series(B0:B3).position(-1,5)", /numbers in pixels/],
		["=CHART().line().series(B0:C3)", /single row or column/],
		["=CHART().line().series(B3:B0)", /ascending/],
		["=CHART().line().series(B0:B100)", /outside sheet/],
		["=CHART().line().series(B0:B3).x(A0:A2)", /same length/],
		["=CHART().line().series(B0:B3).series(C0:C1)", /same length/],
		["=CHART().line().series(A0:A3)", /finite numbers/],
	];
	for (const [formula, expected] of cases) {
		const error = chart(formula);
		assert.equal(typeof error, "string", formula);
		assert.match(error, /^Chart: /, formula);
		assert.match(error, expected, formula);
	}
	assert.equal(globalThis.executed, undefined);
	sheet.rows[0][1] = "Infinity";
	assert.match(chart("=CHART().line().series(B0:B3)"), /finite numbers/);
});

test("source edits and saved builder text reconstruct charts, including copy-as-value", () => {
	const formula = '=CHART().line().series(B0:B3, "Net").size(345,215).position(7,19)';
	const before = chart(formula);
	sheet.rows[3][1] = "31";
	assert.deepEqual(sheet.getValue(6, 4).series[0].values, [-8, 0, null, 31]);
	assert.equal(sheet.getCopyValue(6, 4), formula);
	assert.equal(sheet.getCopyValue(0, 1), "-8");
	sheet.rows = JSON.parse(JSON.stringify(sheet.rows));
	const restored = sheet.getValue(6, 4);
	assert.deepEqual([restored.width, restored.height, restored.position], [345, 215, { x: 7, y: 19 }]);
	assert.equal(before.series[0].values[3], 14);

	sheet.rows[7][4] = "=2+3*4";
	const keyboard = new VimKeyboard(sheet);
	keyboard.operate("y", { start: { row: 6, col: 4 }, end: { row: 7, col: 4 }, values: true });
	assert.equal(keyboard.register.text, `${formula}\n14`);
	keyboard.move({ row: 0, col: 8 });
	keyboard.feed("p");
	assert.equal(sheet.rows[0][8], formula);
	assert.equal(sheet.rows[1][8], "14");
	assert.deepEqual(sheet.getValue(0, 8), restored);
});

test("value objects reject chart cells and chart-containing selections without editing or replacing the register", () => {
	const builder = '=CHART().pie().series(C0:C2)';
	chart(builder); sheet.recalculate();
	const keyboard = new VimKeyboard(sheet);
	keyboard.move({ row: 6, col: 4 });
	assert.ok(!keyboardHints(keyboard).some(hint => hint.key === 'yiv'));
	keyboard.feed('y');
	assert.ok(keyboardHints(keyboard).some(hint => hint.key === 'ic'));
	assert.ok(!keyboardHints(keyboard).some(hint => hint.key === 'iv'));
	keyboard.feed('ic'); assert.equal(keyboard.register.text, builder);
	for (const keys of ['yiv', 'div', 'civ', 'viv']) {
		keyboard.feed(keys);
		assert.equal(keyboard.register.text, builder, keys);
		assert.equal(sheet.rows[6][4], builder, keys);
		assert.deepEqual([keyboard.context, keyboard.mode], ['sheet', keys === 'viv' ? 'v' : 'n'], keys);
	}
	sheet.rows[6][3] = '=2+3*4';
	for (const keys of ['y2iv', 'd2iv', 'c2iv', 'vivly', 'vivld', 'vivlc', 'vivVy']) {
		keyboard.feed('<Esc>'); keyboard.move({ row: 6, col: 3 });
		keyboard.feed(keys);
		assert.equal(keyboard.register.text, builder, keys);
		assert.deepEqual(sheet.rows[6].slice(3, 5), ['=2+3*4', builder], keys);
		assert.equal(keyboard.context, 'sheet', keys);
	}
	keyboard.feed('<Esc>yiv'); assert.equal(keyboard.register.text, '14');
});

test("chart cells reject scalar and range arithmetic and detect indirect cycles", () => {
	chart("=CHART().line().series(B0:B3)");
	sheet.rows[7][4] = "=E6+1";
	assert.match(sheet.getValue(7, 4), /Chart cells cannot be used in numeric formulas/);
	sheet.rows[7][4] = "=SUM(E5:E6)";
	assert.match(sheet.getValue(7, 4), /Chart cells cannot be used in numeric formulas/);
	assert.match(chart("=CHART().line().series(E6:E7)"), /circular logic detected/);
	sheet.rows[0][1] = "=E6+1";
	assert.match(chart("=CHART().line().series(B0:B3)"), /circular logic detected/);
	sheet.rows[0][1] = "-8";
	assert.equal(chart("=CHART().line().series(B0:B3)").kind, "chart");
	sheet.rows[7][4] = "=CHART().line().series(E6)";
	assert.match(sheet.getValue(7, 4), /chart cannot be used as chart data/);
});

test("existing numeric formulas still evaluate", () => {
	for (const [formula, expected] of [
		["=2+3*4", 14], ["=SUM(C0:C3)", 21], ["=AVG(C0:C3)", 5.25],
		["=COUNT(C0:C3)", 4], ["=SUMIF(C0:C3,=14,B0:B3)", -8],
		["=[-2]{-6}+[-2]{-5}", 17],
	]) {
		assert.equal(chart(formula), expected, formula);
	}
});
