import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import SheetManager from "./SheetManager.js";
import { evaluateFormula } from "./FormulaFunctions.js";

const sheet = new SheetManager();

function cell(ref) {
	const [, letters, row] = ref.match(/^([A-Z]+)(\d+)$/);
	const col = [...letters].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
	return [Number(row), col];
}
function set(ref, value) {
	const [row, col] = cell(ref);
	sheet.rows[row][col] = value;
}
function value(ref) {
	return sheet.getValue(...cell(ref));
}
function evaluate(formula, at = "Z0") {
	set(at, formula);
	return value(at);
}
const shown = ref => sheet.cellValues.value[cell(ref)[0]][cell(ref)[1]];
const error = ref => sheet.cellErrors.get(cell(ref).join(":"));
const spill = ref => sheet.spillCells.get(cell(ref).join(":"));

// Every cell read on its own (a fresh evaluation rooted at that cell) matches the full recalculation.
function assertOrderIndependent() {
	const values = sheet.recalculate();
	values.forEach((line, row) => line.forEach((shownValue, col) => {
		assert.deepEqual(sheet.getElementValue(row, col), shownValue, `cell ${row}:${col}`);
	}));
}

beforeEach(() => {
	sheet.rows = Array.from({ length: 12 }, () => Array(30).fill(""));
	[
		["Jan", "5", "New York"], ["Feb", "1", "Paris"], ["Mar", "9", "New York"],
		["Apr", "3", "Oslo"], ["May", "", "Paris"],
	].forEach((row, i) => row.forEach((text, j) => { sheet.rows[i][j] = text; }));
});

test('repeated syntax reads fresh reference contexts and still enforces pure evaluation', () => {
	const run = (formula, ctx) => evaluateFormula(formula, 0, 0, ctx);
	assert.equal(String(run('=A0 * 3 + 1', { ref: () => 7 })), '22');
	assert.equal(String(run('=A0 * 3 + 1', { ref: () => 11 })), '34');
	assert.equal(typeof run('=random()', {}), 'number');
	assert.throws(() => run('=random()', { pure: true }), /#NAME\?/);
});

test("existing arithmetic, mathjs functions, aggregates and relative notation keep working", () => {
	for (const [formula, expected] of [
		["=2+3*4", 14], ["=2^3 mod 5", 3], ["=sqrt(16) + max(B0:B3)", 13], ["=round(pi, 2)", 3.14],
		["=SUM(B0:B4)", 18], ["=AVG(B0:B4)", 3.6], ["=MEAN(B0:B3)", 4.5], ["=COUNT(B0:B4)", 5],
		["= SUM( B0 : B3 ) + 1", 19], ["=B4 + 1", 1], ["=[1]{max(0, 1) - 1} * 2", 10], ["=B{B1}", 1],
		["=A{B1:B1}", "Feb"],
	]) {
		assert.equal(evaluate(formula), expected, formula);
	}
	// relative to H9: [] is this column (7), {} this row (9)
	for (const [formula, expected] of [
		["=THISROW + THISCOL", 16], ["=[-6]{-9}+[-6]{-8}", 6], ["={-9}", 0], ["=SUM([-6]{-9}:[-6]{-6})", 18],
		["=[-6]{-9} + [-6]{+1-10}", 10],
	]) {
		assert.equal(evaluate(formula, "H9"), expected, formula);
	}
	set("AB1", "17");
	set("AA0", "=AB1 + 1");
	assert.equal(evaluate("=AA0 * 2"), 36);
	assert.equal(evaluate("=SUM(AA0:AB1)"), 35);
});

test("decimal arithmetic stays decimal through aggregates, references and spills", () => {
	set("C1", "10704.20"); set("C2", "-549"); set("C4", "9000");
	assert.equal(evaluate("=-(SUM(C1:[]{-1})-[]{+1})", "C3"), -1155.2);
	assert.equal(evaluate("=C3/10", "B3"), -115.52);
	assert.equal(evaluate("=C3+1155.2"), 0);
	for (const [formula, expected] of [
		["=0.1+0.2", 0.3], ["=0.3-0.1", 0.2], ["=0.1*0.2", 0.02], ["=0.3/0.2", 1.5],
		["=(0.1+0.2)=0.3", true], ["=SUM(0.1,0.2)-0.3", 0], ["=AVG(0.1,0.2)", 0.15],
		["=(1/3)*3", 1], ["=1e-20+2e-20", 3e-20], ["=1.234567890123456", 1.234567890123456],
		["=1000000000000000.1-1000000000000000", 0.1],
		["=1e-100/1e-100", 1], ["=1e-100=0", false], ["=1e-100<2e-100", true], ["=floor(-1e-100)", -1],
	]) assert.equal(evaluate(formula), expected, formula);
	// Decimal precision survives cell boundaries, not just the expression being displayed.
	set("E0", "=1000000000000000.1");
	assert.equal(evaluate("=E0-1000000000000000"), 0.1);
	set("E1", "=0.1+0.2"); set("E2", "0.3");
	assert.equal(evaluate("=SUMIF(E1:E2,0.3)"), 0.6);
	assert.equal(evaluate("=AVGIF(E1:E2,0.3)"), 0.3);
	assert.deepEqual(evaluate("=FILTER(E1:E2,E1:E2=0.3)"), [[0.3], [0.3]]);
	set("H0", "=VSTACK(0.1+0.2,0.3-0.1)");
	assert.equal(evaluate("=H1-0.2"), 0);
	assert.equal(evaluate("=SORT(A0:B3,0.999999999999999999)"), "#VALUE!");
	assert.equal(evaluate("=A{0.999999999999999999}"), "#REF!");
	sheet.recalculate();
	assert.equal(shown("C3"), -1155.2);
	assert.equal(shown("H0"), 0.3);
	assert.equal(shown("H1"), 0.2);
});

test("legacy unquoted SUMIF/COUNTIF/AVGIF criteria and quoted criteria", () => {
	for (const [formula, expected] of [
		["=SUMIF(C0:C4,=New York,B0:B4)", 14], ["=SUMIF(C0:C4, =Paris, B0:B4)", 1],
		["=SUMIF(B0:B3,>2,B0:B3)", 17], ["=SUMIF(B0:B3,<5,B0:B3)", 4], ["=SUMIF(C0:C4,!Paris,B0:B4)", 17],
		['=SUMIF(C0:C4, "<>Paris", B0:B4)', 17], ["=COUNTIF(C0:C4,=New York)", 2],
		["=COUNTIF(C0:C4,=Paris,B0:B4)", 2], ["=AVGIF(C0:C4,=New York,B0:B4)", 7], ['=COUNTIF(B0:B3, 9)', 1],
	]) {
		assert.equal(evaluate(formula), expected, formula);
	}
	assert.equal(evaluate("=AVGIF(C0:C4,=Rome,B0:B4)"), "#DIV/0!");
});

test("strings, spreadsheet and mathjs comparisons stay intact", () => {
	assert.equal(evaluate('="a = b <> c,  d"'), "a = b <> c,  d");
	assert.equal(evaluate("='single = quoted'"), "single = quoted");
	assert.equal(evaluate('=C0 = "New York"'), true);
	assert.equal(evaluate('=C0 == "New York"'), true);
	assert.equal(evaluate('=C0 <> "New York"'), false);
	assert.equal(evaluate("=B0 != 5"), false);
	assert.equal(evaluate("=B0 >= 5"), true);
	assert.equal(evaluate("=C0"), "New York");
	assert.deepEqual(evaluate("=B0:B3 = 9"), [[false], [false], [true], [false]]);
});

test("FILTER uses boolean masks, AND/OR/NOT combine them and ifEmpty is optional", () => {
	assert.deepEqual(evaluate("=FILTER(A0:B4, B0:B4 > 2)"), [["Jan", 5], ["Mar", 9], ["Apr", 3]]);
	assert.deepEqual(evaluate('=FILTER(A0:A4, C0:C4 = "New York")'), [["Jan"], ["Mar"]]);
	assert.deepEqual(evaluate('=FILTER(A0:A4, AND(B0:B4 > 2, C0:C4 <> "Oslo"))'), [["Jan"], ["Mar"]]);
	assert.deepEqual(evaluate("=FILTER(A0:A4, OR(B0:B4 < 2, B0:B4 > 8))"), [["Feb"], ["Mar"], ["May"]]);
	assert.deepEqual(evaluate("=FILTER(C0:C4, NOT(B0:B4 > 2))"), [["Paris"], ["Paris"]]);
	assert.equal(evaluate("=AND(1, 2 > 1)"), true);
	assert.equal(evaluate('=FILTER(A0:A4, B0:B4 > 100, "none found")'), "none found");
	assert.equal(evaluate("=FILTER(A0:A4, B0:B4 > 100)"), "#CALC!");
	assert.equal(evaluate("=FILTER(A0:A4, B0:B2 > 1)"), "#VALUE!");
	sheet.recalculate();
	assert.match(error("Z0"), /one value per row: expected 5×1, got 3×1/);
});

test("VSTACK/HSTACK stack asymmetric nested FILTER results and report shape errors", () => {
	assert.deepEqual(evaluate('=VSTACK(FILTER(A0:B4, B0:B4 > 4), FILTER(A0:B4, C0:C4 = "Paris"), HSTACK("Total", SUM(B0:B4)))'),
		[["Jan", 5], ["Mar", 9], ["Feb", 1], ["May", ""], ["Total", 18]]);
	assert.deepEqual(evaluate('=HSTACK(FILTER(A0:A4, B0:B4 > 4), FILTER(C0:C4, B0:B4 > 4))'), [["Jan", "New York"], ["Mar", "New York"]]);
	set("H9", "=VSTACK(A0:B1, C0:C1)");
	set("H10", "=HSTACK(A0:A1, B0:B2)");
	set("H11", "=B0:B3 + B0:B1");
	sheet.recalculate();
	assert.equal(shown("H9"), "#VALUE!");
	assert.match(error("H9"), /VSTACK arrays must have the same number of columns \(got 2×2 and 2×1\)/);
	assert.match(error("H10"), /HSTACK arrays must have the same number of rows \(got 2×1 and 3×1\)/);
	assert.match(error("H11"), /Array sizes do not match: 4×1 and 2×1/);
});

test("SORT and UNIQUE work on rows", () => {
	assert.deepEqual(evaluate("=SORT(A0:B3, 0)"), [["Apr", 3], ["Feb", 1], ["Jan", 5], ["Mar", 9]]);
	assert.deepEqual(evaluate("=SORT(A0:B3)"), [["Apr", 3], ["Feb", 1], ["Jan", 5], ["Mar", 9]]);
	assert.deepEqual(evaluate("=SORT(A0:B3, 1)"), [["Feb", 1], ["Apr", 3], ["Jan", 5], ["Mar", 9]]);
	assert.deepEqual(evaluate("=SORT(A0:B3, 1, -1)"), [["Mar", 9], ["Jan", 5], ["Apr", 3], ["Feb", 1]]);
	assert.deepEqual(evaluate("=SORT(C0:C3)"), [["New York"], ["New York"], ["Oslo"], ["Paris"]]);
	assert.deepEqual(evaluate("=UNIQUE(C0:C4)"), [["New York"], ["Paris"], ["Oslo"]]);
	assert.deepEqual(evaluate("=UNIQUE(VSTACK(A0:B0, A0:B0, A1:B1))"), [["Jan", 5], ["Feb", 1]]);
	assert.equal(evaluate("=SORT(A0:B3, -1)"), "#VALUE!");
	assert.equal(evaluate("=SORT(A0:B3, 2)"), "#VALUE!");
	sheet.recalculate(); assert.match(error("Z0"), /column index 2 is outside 0\.\.1/);
	assert.equal(evaluate("=SORT(A0:B3, 1, 2)"), "#VALUE!");
});

test("LOOKUP preserves query order and columns, with lazy scalar or row defaults", () => {
	assert.deepEqual(evaluate('=LOOKUP(VSTACK("Apr", "Jan", "absent", "Apr"), A0:A4, B0:C4, HSTACK(0, "unknown"))'),
		[[3, "Oslo"], [5, "New York"], [0, "unknown"], [3, "Oslo"]]);
	assert.deepEqual(evaluate('=LOOKUP(VSTACK("absent", "Jan", "missing"), A0:A4, B0:C4, "none")'),
		[["none", "none"], [5, "New York"], ["none", "none"]]);
	assert.equal(evaluate('=LOOKUP("Jan", A0:A4, B0:B4, Z0)'), 5);
	assert.equal(evaluate('=LOOKUP("Jan", A0:A4, B0:B4, [-999]{})'), 5);
	assert.equal(evaluate('=LOOKUP("Jan", A0:A4, B0:B4, VSTACK(1, 2))'), 5);
	assert.equal(evaluate('=LOOKUP("May", A0:A4, B0:B4, 99)'), "");
	assert.equal(evaluate('=LOOKUP("absent", A0:A4, B0:B4)'), "#N/A");
	sheet.recalculate(); assert.match(error("Z0"), /query row 0.*no match/i);
	assert.equal(evaluate('=LOOKUP("absent", A0:A4, B0:B4, [-999]{})'), "#REF!");
	assert.equal(evaluate('=IFERROR(LOOKUP("absent", A0:A4, B0:B4, Z0), 9)'), "circular logic detected");
});

test("LOOKUP rejects matched duplicates and required-input errors instead of treating them as misses", () => {
	assert.equal(evaluate('=LOOKUP("Oslo", C0:C4, A0:A4)'), "Apr");
	assert.equal(evaluate('=LOOKUP(VSTACK("missing", "Paris"), C0:C4, A0:A4, Z99)'), "#VALUE!");
	sheet.recalculate(); assert.match(error("Z0"), /query row 1.*source rows 1, 4/i);
	assert.equal(evaluate('=LOOKUP("x", VSTACK("x", "x"), VSTACK(7, 7), 0)'), "#VALUE!");
	assert.equal(evaluate('=LOOKUP("Jan", A0:A4, VSTACK(5, 1/0, 9, 3, 0), 99)'), "#DIV/0!");
	assert.equal(evaluate('=LOOKUP("missing", A0:A4, B0:B3, 99)'), "#VALUE!");
	assert.equal(evaluate('=LOOKUP("Jan", HSTACK(A0:A1, B0:B1), C0:C1)'), "#VALUE!");
	assert.equal(evaluate('=LOOKUP(HSTACK("Jan", "Feb"), A0:A1, B0:B1)'), "#VALUE!");
	assert.equal(evaluate('=LOOKUP("missing", A0:A4, B0:C4, VSTACK(1, 2))'), "#VALUE!");
	assert.equal(evaluate('=LOOKUP("missing", A0:A4, B0:C4, HSTACK(1, 2, 3))'), "#VALUE!");
	assert.equal(evaluate('=IFERROR(LOOKUP("#N/A", "#N/A", "#VALUE!"), "caught")'), "#VALUE!");
	assert.equal(evaluate('=LOOKUP(1, 1)'), "#N/A");
});

test("LOOKUP and JOIN use typed exact keys and never match blank key components", () => {
	const keys = 'VSTACK("", 0, FALSE, "0", "A", "a", " A", " ")';
	const values = 'VSTACK(10, 20, 30, 40, 50, 60, 70, 80)';
	assert.deepEqual(evaluate(`=LOOKUP(${keys}, ${keys}, ${values}, -1)`),
		[[-1], [20], [30], [40], [50], [60], [70], [80]]);
	assert.deepEqual(evaluate(`=JOIN(${values}, ${keys}, ${values}, ${keys}, "inner")`),
		[[20, 20], [30, 30], [40, 40], [50, 50], [60, 60], [70, 70], [80, 80]]);
	assert.equal(evaluate('=LOOKUP("", "", 1)'), "#N/A");
	set("D0", "001"); set("D1", '="001"');
	assert.deepEqual(evaluate('=LOOKUP(VSTACK(1, "001"), D0:D1, VSTACK(11, 22))'), [[11], [22]]);
	const composite = 'VSTACK(HSTACK("a|b", "c"), HSTACK("a", "b|c"), HSTACK("a", ""))';
	assert.deepEqual(evaluate(`=LOOKUP(${composite}, ${composite}, VSTACK(1, 2, 3), 9)`), [[1], [2], [9]]);
	assert.deepEqual(evaluate(`=JOIN(VSTACK(1, 2, 3), ${composite}, VSTACK(4, 5, 6), ${composite})`),
		[[1, 4], [2, 5], [3, ""]]);
	for (const key of ['Infinity', 'NaN', 'i', 'unit("2 m")']) {
		assert.equal(evaluate(`=LOOKUP(1, VSTACK(1, ${key}), VSTACK(7, 8), 0)`), "#VALUE!", key);
		assert.equal(evaluate(`=JOIN(7, ${key}, 8, 1)`), "#VALUE!", key);
	}
});

test("lookup and join keys and values retain decimal precision through formulas and spills", () => {
	set("D0", "9007199254740992"); set("D1", "9007199254740993");
	assert.equal(evaluate('=LOOKUP(9007199254740993, D0:D1, VSTACK(7, 8))'), 8);
	assert.equal(evaluate('=LOOKUP(0.1+0.2, 0.3, 1000000000000000.1)-1000000000000000'), 0.1);
	assert.equal(evaluate('=LOOKUP(-0, 0.00, 7)'), 7);
	set("D0", "1"); set("D1", `1.${"0".repeat(63)}1`);
	assert.equal(evaluate('=LOOKUP(D1, D0:D1, VSTACK(7, 8))'), 8);
	assert.deepEqual(evaluate('=JOIN(VSTACK(7, 8), D0:D1, VSTACK(9, 10), D0:D1)'), [[7, 9], [8, 10]]);
	set("E0", '=LOOKUP(VSTACK(2, 1), VSTACK(1, 2), VSTACK(1000000000000000.1, 0.1+0.2))');
	set("H0", '=JOIN(1000000000000000.1, 0.1+0.2, 1000000000000000.2, 0.3)');
	assert.equal(evaluate('=E1-1000000000000000'), 0.1);
	assert.equal(evaluate('=E0:E0-0.3'), 0);
	assert.equal(evaluate('=I0-H0:H0'), 0.1);
});

test("JOIN emits all matching pairs in left then right order, and pads only left-join misses", () => {
	const left = '["l0", 10; "l1", 20; "l2", 30; "l3", 40]';
	const leftKeys = 'VSTACK("b", "a", "b", "missing")';
	const right = '["r0", 8; "r1", 6; "r2", 4; "r3", 2]';
	const rightKeys = 'VSTACK("b", "b", "a", "b")';
	const pairs = [["l0", 10, "r0", 8], ["l0", 10, "r1", 6], ["l0", 10, "r3", 2],
		["l1", 20, "r2", 4], ["l2", 30, "r0", 8], ["l2", 30, "r1", 6], ["l2", 30, "r3", 2]];
	assert.deepEqual(evaluate(`=JOIN(${left}, ${leftKeys}, ${right}, ${rightKeys})`), [...pairs, ["l3", 40, "", ""]]);
	assert.deepEqual(evaluate(`=JOIN(${left}, ${leftKeys}, ${right}, ${rightKeys}, "inner")`), pairs);
	assert.deepEqual(evaluate('=JOIN(7, "missing", HSTACK(8, 9), "key")'), [[7, "", ""]]);
	assert.equal(evaluate('=JOIN(7, "missing", 8, "key", "inner")'), "#CALC!");
	assert.equal(evaluate('=JOIN(7, 1, 8, 1, "INNER")'), "#VALUE!");
	assert.equal(evaluate('=JOIN(7, VSTACK(1, 2), 8, 1)'), "#VALUE!");
	assert.equal(evaluate('=JOIN(7, 1, VSTACK(8, 9), 1)'), "#VALUE!");
	assert.equal(evaluate('=JOIN(7, HSTACK(1, 2), 8, VSTACK(1, 2))'), "#VALUE!");
	assert.equal(evaluate('=JOIN(7, 1, 8)'), "#N/A");
});

test("lookup and join reject oversized results before expanding matching rows", () => {
	// A small source would otherwise expand past a million result cells.
	const tables = [[[1]], Array.from({ length: 1001 }, () => [1]), [Array(1000).fill("value")]];
	const ctx = { ref: (_, col) => tables[col] };
	for (const formula of ['LOOKUP(B0, A0, C0)', 'JOIN(B0, B0, C0, A0)']) {
		assert.throws(() => evaluateFormula(formula, 0, 3, ctx),
			error => error.message === "#CALC!" && /1,000,000 cells/.test(error.explanation), formula);
	}
});

test("lookup and join spills stay derived, shrink on edits, and protect occupied destinations", () => {
	set("E0", '=LOOKUP(VSTACK("Jan", "Apr"), A0:A4, B0:C4)');
	set("H0", '=JOIN(VSTACK(1, 2), VSTACK("Paris", "Oslo"), A0:B4, C0:C4)');
	set("L0", '=E1+1'); set("L1", '=COUNT(H0)'); set("L2", '=SUM(E0)');
	const stored = JSON.stringify(sheet.rows);
	assertOrderIndependent();
	assert.equal(JSON.stringify(sheet.rows), stored);
	assert.deepEqual(value("E0"), [[5, "New York"], [3, "Oslo"]]);
	assert.deepEqual(value("H0"), [[1, "Feb", 1], [1, "May", ""], [2, "Apr", 3]]);
	assert.deepEqual([shown("L0"), shown("L1"), shown("L2")], [4, 9, 8]);
	set("C4", "Rome"); set("E0", '=LOOKUP("Jan", A0:A4, B0:C4)');
	assertOrderIndependent();
	assert.equal(shown("E1"), ""); assert.equal(spill("E1"), undefined);
	assert.equal(shown("H2"), ""); assert.equal(spill("H2"), undefined);
	set("F0", "keep lookup"); set("I1", "keep join");
	set("L3", '=LOOKUP("Jan", A0:A4, H0, 99)');
	set("AC11", '=JOIN(1, 1, 2, 1)');
	assertOrderIndependent();
	assert.equal(shown("E0"), "#SPILL!"); assert.equal(shown("F0"), "keep lookup");
	assert.equal(shown("H0"), "#SPILL!"); assert.equal(shown("I1"), "keep join");
	assert.equal(shown("L3"), "#SPILL!");
	assert.match(error("E0"), /blocked by non-empty cell F0/);
	assert.match(error("H0"), /blocked by non-empty cell I1/);
	assert.equal(shown("AC11"), 1);
	set("AC11", ""); set("AD11", '=JOIN(1, 1, 2, 1)');
	sheet.recalculate();
	assert.equal(shown("AD11"), "#SPILL!");
	assert.match(error("AD11"), /extends beyond the edge/);
});

test("IF is lazy and IFERROR catches real errors only", () => {
	assert.equal(evaluate('=IF(B0 > 2, "big  one", Z0)'), "big  one");
	assert.equal(evaluate('=IF(B1 > 2, Z0, "small")'), "small");
	assert.equal(evaluate("=IF(B1 > 2, 1)"), false);
	assert.equal(evaluate("=IF(B0:B3 > 2, 1, 0)"), "#VALUE!");
	assert.equal(evaluate("=IFERROR(A0 + 1, -1)"), -1);
	assert.equal(evaluate("=IFERROR(Z99, 7)"), 7);
	assert.equal(evaluate("=IFERROR(FILTER(A0:A4, B0:B4 > 100), 0)"), 0);
	assert.equal(evaluate("=IFERROR(nosuchfunction(1), 2)"), 2);
	assert.equal(evaluate('=IF(TRUE, 1, [-999]{})'), 1);
	assert.equal(evaluate('=IF(FALSE, B{Z0}, 3)'), 3);
	assert.equal(evaluate('=IFERROR([-999]{}, 7)'), 7);
	assert.equal(evaluate('=IF(TRUE, 4, [1, [-999]{}])'), 4);
	assert.equal(evaluate('=IFERROR(SUM([1, [-999]{}]), 8)'), 8);
	assert.equal(evaluate('=SUM([2, [1]{0}; 3, [1]{2}])'), 19);
	assert.equal(evaluate('=IFERROR(1/0, 7)'), 7);
	assert.equal(evaluate('=IFERROR("#N/A", 7)'), "#N/A");
	assert.equal(evaluate("=IFERROR(B0, 7)"), 5);
	set("G0", "=IFERROR(G1, 0)");
	set("G1", "=G0 + 1");
	assert.equal(value("G0"), "circular logic detected");
	assert.equal(value("G1"), "circular logic detected");
});

test("invalid references, cycles and formula errors are explained", () => {
	set("G0", "=Z99");
	set("G1", "=G1 + 1");
	set("G2", "=Jan + 1");
	set("G3", "=A0 * 2");
	set("G4", "=SUM(A0:A40)");
	sheet.recalculate();
	assert.equal(shown("G0"), "#REF!");
	assert.match(error("G0"), /Z99 is outside the sheet/);
	assert.equal(shown("G1"), "circular logic detected");
	assert.match(error("G2"), /Undefined symbol Jan/);
	assert.match(error("G3"), /Text "Jan" cannot be used as a number/);
	assert.match(error("G4"), /outside the sheet/);
});

test("array formulas spill derived values without changing sheet.rows", () => {
	set("E0", '=FILTER(A0:B4, B0:B4 > 2)');
	set("H0", "=F2 * 10");
	set("H1", "=SUM(E0:F2)");
	set("H2", "=E0");
	set("I0", "=SUM(E0)");
	const stored = JSON.stringify(sheet.rows);
	assertOrderIndependent();
	assert.equal(JSON.stringify(sheet.rows), stored);
	assert.deepEqual([shown("E0"), shown("F0"), shown("E2"), shown("F2")], ["Jan", 5, "Apr", 3]);
	assert.deepEqual(spill("E0"), { row: 0, col: 4, rows: 3, cols: 2 });
	assert.deepEqual(spill("F2"), { row: 0, col: 4, rows: 3, cols: 2 });
	assert.equal(spill("E3"), undefined);
	assert.equal(sheet.spillCells.size, 6 + 6);
	assert.deepEqual(value("E0"), [["Jan", 5], ["Mar", 9], ["Apr", 3]]);
	assert.equal(value("F1"), 9);
	assert.equal(shown("H0"), 30);
	assert.equal(shown("H1"), 17);
	assert.deepEqual(value("H2"), [["Jan", 5], ["Mar", 9], ["Apr", 3]]);
	assert.deepEqual(spill("I2"), { row: 2, col: 7, rows: 3, cols: 2 });
	assert.equal(shown("I0"), 17);
	assert.equal(sheet.getCopyValue(0, 4), "Jan");
});

test("references to spill children are order independent and never stale", () => {
	// readers above/left of the owner and chains through two spills
	set("A9", "=D11 + 1");
	set("D9", "=VSTACK(10, 20, 30)");
	set("E9", "=VSTACK(D10 * 2, 1)");
	set("A10", "=SUM(E9:E10)");
	assertOrderIndependent();
	assert.deepEqual([shown("A9"), shown("D11"), shown("E9"), shown("E10"), shown("A10")], [31, 30, 40, 1, 41]);
	assert.equal(value("A9"), 31);
	assert.equal(value("A10"), 41);

	// direct edits are seen immediately without recalculate()
	set("D9", "=VSTACK(1, 2, 3)");
	assert.equal(value("A9"), 4);
	assert.equal(value("A10"), 5);
	set("D9", "=VSTACK(1, 2)");
	assert.equal(value("D11"), "");
	assert.equal(value("A9"), 1);
});

test("blocked spills show #SPILL!, explain why and never overwrite data", () => {
	set("E0", "=VSTACK(1, 2, 3)");
	set("E1", "keep me");
	set("G10", "=VSTACK(1, 2, 3)");
	set("H0", "=HSTACK(1, 2, 3)");
	set("G2", "=VSTACK(7, 8, 9)");
	set("F5", "=E0 + 1");
	const stored = JSON.stringify(sheet.rows);
	assertOrderIndependent();
	assert.equal(JSON.stringify(sheet.rows), stored);
	assert.equal(shown("E0"), "#SPILL!");
	assert.equal(shown("E1"), "keep me");
	assert.match(error("E0"), /Spill range E0:E2 is blocked by non-empty cell E1/);
	assert.equal(value("E0"), "#SPILL!");
	assert.equal(shown("G10"), "#SPILL!");
	assert.match(error("G10"), /extends beyond the edge of the sheet/);
	assert.equal(shown("F5"), "#SPILL!");
	assert.match(error("F5"), /E0 cannot spill/);
	assert.equal(shown("H0"), 1);
	assert.equal(shown("G2"), 7);

	set("G2", "=VSTACK(7, 8, 9)");
	set("H1", "=HSTACK(4, 5, 6)");
	set("G0", "");
	set("H0", "");
	set("I0", "=VSTACK(1, 2)");
	assertOrderIndependent();
	assert.equal(shown("I0"), "#SPILL!");
	assert.equal(shown("H1"), "#SPILL!");
	assert.match(error("I0"), /overlaps the spill range of H1/);
	assert.match(error("H1"), /overlaps the spill range of I0/);
	assert.equal(shown("I1"), "");
	assert.equal(spill("I1"), undefined);
	assert.equal(shown("G2"), 7);
});

test("spill cycles are rejected and spill outputs shrink or move on recalculation", () => {
	set("E0", "=VSTACK(1, E2)");
	set("G0", "=VSTACK(1, 2, I0)");
	set("I0", "=G2 + 1");
	sheet.recalculate();
	assert.equal(shown("E0"), 1);
	set("E0", "=VSTACK(1, 2, E2)");
	assertOrderIndependent();
	assert.equal(shown("E0"), "#SPILL!");
	assert.match(error("E0"), /depends on its own output/);
	assert.equal(spill("E1"), undefined);
	assert.equal(shown("G0"), "#SPILL!");
	assert.match(error("G0"), /spill cycle/);
	assert.equal(shown("I0"), 1);

	set("E0", "=FILTER(A0:A4, B0:B4 > 0)");
	sheet.recalculate();
	assert.deepEqual([shown("E0"), shown("E3"), spill("E3")?.rows], ["Jan", "Apr", 4]);
	set("B3", "0");
	sheet.recalculate();
	assert.deepEqual([shown("E2"), shown("E3"), spill("E3")], ["Mar", "", undefined]);
	assert.equal(error("E0"), undefined);
	set("E0", "");
	sheet.recalculate();
	assert.equal([...sheet.spillCells.keys()].some(key => key.endsWith(":4")), false);
});

function streamData() {
	[
		['name', 'lastName', 'age'], ['John', 'Smith', '23'], ['Mary', 'Jones', '41'], ['John', 'Doe', '19'],
	].forEach((row, i) => row.forEach((text, j) => { sheet.rows[i][j] = text; }));
}

test('row streams preserve headings and project named objects, scalar columns and positional rows', () => {
	streamData();
	assert.deepEqual(evaluate('=rowstream(A0:C3).toTable()'), evaluate('=FILTER(A0:C3, A0:A3=A0:A3)'));
	const projected = '=rowstream(A0:C3).filter(a->a.name="John").map(a->{name:a.name+" "+a.lastName,age:a.age}).toTable()';
	assert.deepEqual(evaluate(projected), [['name', 'age'], ['John Smith', 23], ['John Doe', 19]]);
	assert.deepEqual(evaluate('=rowstream(A0:C3).map(a->a.lastName).toTable("surname")'), [['surname'], ['Smith'], ['Jones'], ['Doe']]);
	assert.deepEqual(evaluate('=rowstream(A0:C3).map(a->[a.lastName,a.age+1]).limit(2).toTable("surname","nextAge")'),
		[['surname', 'nextAge'], ['Smith', 24], ['Jones', 42]]);
	assert.deepEqual(evaluate('=rowstream(A0:C3).filter(a->FALSE).map(a->{name:a.name,age:a.age}).toTable()'), [['name', 'age']]);
	assert.deepEqual(evaluate('=rowstream(A0:C0).toTable()'), [['name', 'lastName', 'age']]);
	assert.deepEqual(evaluate('=rowstream(A0:C3).limit(1).map(a->{A0:C1,THISROW:a.name}).toTable()'), [['A0', 'THISROW'], [23, 'John']]);
	set('B0', 'Last Name');
	assert.equal(evaluate('=rowstream(A0:C3).map(a->a["Last Name"]).findFirst().orElseThrow()'), 'Smith');
});

test('stream pipelines preserve operation order, stable sorting and typed structural distinctness', () => {
	streamData();
	assert.deepEqual(evaluate('=rowstream(A0:C3).sorted((a,b)->b.age-a.age).skip(1).limit(1).map(a->{who:a.lastName}).toTable()'), [['who'], ['Smith']]);
	assert.equal(evaluate('=rowstream(A0:C3).map(a->a.name).distinct().reduce("",(a,b)->a+","+b)'), ',John,Mary');
	assert.equal(evaluate('=rowstream(A0:C3).map(a->{name:a.name}).distinct().count()'), 2);
	assert.equal(evaluate('=rowstream(VSTACK("n",1,"1",TRUE,1.00)).map(a->a.n).distinct().count()'), 3);
	assert.deepEqual(evaluate('=rowstream(A0:C3).sorted((a,b)->0).toTable()'),
		[['name', 'lastName', 'age'], ['John', 'Smith', 23], ['Mary', 'Jones', 41], ['John', 'Doe', 19]]);
});

test('numeric stream terminals and reducers retain decimal precision and define empty results', () => {
	streamData();
	for (const [method, expected] of [['sum', 83], ['min', 19], ['max', 41], ['average', 83 / 3]]) {
		assert.equal(evaluate(`=rowstream(A0:C3).map(a->a.age).${method}()${method === 'sum' ? '' : '.orElseThrow()'}`), expected);
	}
	assert.equal(evaluate('=rowstream(A0:C3).map(a->-a.age).max().orElseThrow()'), -19);
	assert.equal(evaluate('=rowstream(A0:C3).map(a->a.age).reduce(100,(a,b)->a-b)'), 17);
	assert.equal(evaluate('=rowstream(VSTACK("n",1000000000000000.1,0.2)).map(a->a.n).sum()-1000000000000000'), 0.3);
	assert.equal(evaluate('=rowstream(VSTACK("n",0.1,0.2)).map(a->a.n).average().orElseThrow()-0.15'), 0);
	assert.equal(evaluate('=rowstream(VSTACK("n",9007199254740993,9007199254740992)).map(a->a.n).min().orElseThrow()-9007199254740992'), 0);
	for (const [terminal, expected] of [['sum()', 0], ['count()', 0], ['reduce(7,(a,b)->a+b.age)', 7]]) {
		assert.equal(evaluate(`=rowstream(A0:C3).filter(a->FALSE).${terminal}`), expected);
	}
	for (const terminal of ['min', 'max', 'average', 'findFirst']) {
		const empty = `=rowstream(A0:C3).filter(a->FALSE).${terminal}()`;
		assert.equal(evaluate(empty + '.isEmpty()'), true);
		assert.equal(evaluate(empty + '.orElse(-7)'), -7);
		assert.equal(evaluate(empty + '.orElseThrow()'), '#N/A');
	}
	assert.deepEqual(evaluate('=rowstream(A0:C3).reduce({total:0},(a,b)->{total:a.total+b.age})'), [['total'], [83]]);
});

test('Optionals distinguish absence from zero, FALSE and blank, and lazily resolve defaults', () => {
	for (const [item, expected] of [['0', 0], ['FALSE', false], ['""', '']]) {
		const present = `=rowstream(VSTACK("n",${item})).map(a->a.n).findFirst()`;
		assert.equal(evaluate(present + '.isPresent()'), true);
		assert.equal(evaluate(present + '.isEmpty()'), false);
		assert.equal(evaluate(present + '.orElse(1/0)'), expected);
	}
	const empty = '=rowstream(VSTACK("n",5)).limit(0).findFirst()';
	assert.equal(evaluate(empty + '.map(a->1/0).filter(a->1/0).orElse(17)'), 17);
	assert.equal(evaluate(empty + '.flatMap(a->1/0).isEmpty()'), true);
	assert.equal(evaluate(empty + '.orElse(1/0)'), '#DIV/0!');
	assert.equal(evaluate('=rowstream(VSTACK("n",5)).findFirst().filter(a->a.n>8).orElse({n:11}).n'), 11);
});

test('Optional mapping retains records, supports nesting and flatMap, and preserves source errors', () => {
	streamData();
	const first = '=rowstream(A0:C3).findFirst()';
	assert.equal(evaluate(first + '.map(a->a.age+2).orElseThrow()'), 25);
	assert.deepEqual(evaluate(first + '.map(a->{full:a.name+" "+a.lastName,years:a.age}).orElseThrow()'),
		[['full', 'years'], ['John Smith', 23]]);
	assert.equal(evaluate(first + '.map(a->rowstream(VSTACK("n",a.age)).findFirst()).orElseThrow().map(b->b.n).orElseThrow()'), 23);
	assert.equal(evaluate(first + '.flatMap(a->rowstream(VSTACK("n",a.age)).findFirst()).map(b->b.n).orElseThrow()'), 23);
	assert.equal(evaluate(first + '.flatMap(a->rowstream(VSTACK("n",a.age)).limit(0).findFirst()).orElse(31)'), 31);
	assert.equal(evaluate(first + '.flatMap(a->a.age).orElse(0)'), '#VALUE!');
	assert.equal(evaluate(first + '.map(a->1/0).orElse(0)'), '#DIV/0!');
	assert.equal(evaluate('=rowstream(VSTACK("n","invalid")).map(a->a.n).min().orElse(0)'), '#VALUE!');
	set('C1', '=1/0');
	assert.equal(evaluate(first + '.isEmpty()'), '#DIV/0!');
	set('C1', '=Z0');
	assert.equal(evaluate('=IFERROR(rowstream(A0:C3).findFirst().orElse(0),99)'), 'circular logic detected');
});

test('expression-only values require resolution and reducer accumulators retain their type/schema', () => {
	streamData();
	const first = 'rowstream(A0:C3).findFirst()';
	for (const expression of [first, first + '+1', `SUM(${first})`, `IF(${first},1,0)`, `${first}.map(a->{value:rowstream(A0:C3).findFirst()}).orElseThrow()`, `${first}.map(a->a.age.constructor).orElse(0)`, `${first}.map((a,b)->a).orElse(0)`]) {
		assert.equal(evaluate('=' + expression), '#VALUE!', expression);
	}
	assert.equal(evaluate('=rowstream(A0:C3).reduce({total:0},(a,b)->{total:a.total+b.age}).total'), 83);
	assert.equal(evaluate('=rowstream(A0:C3).limit(0).reduce("seed",(a,b)->1/0)'), 'seed');
	for (const [seed, reducer] of [['0', '(a,b)->"changed"'], ['0', '(a,b)->{isBigNumber:TRUE}'], ['{total:0}', '(a,b)->{other:b.age}'], ['{total:0}', '(a,b)->{total:"text"}']]) {
		assert.equal(evaluate(`=rowstream(A0:C3).reduce(${seed},${reducer})`), '#VALUE!');
	}
});

test('stream short-circuit terminals do not read unused source rows, even at a limit boundary', () => {
	streamData(); set('C2', '=1/0');
	for (const [terminal, expected] of [['limit(1).count()', 1], ['limit(0).count()', 0], ['map(a->a.age).findFirst().orElseThrow()', 23], ['anyMatch(a->a.name="John")', true], ['allMatch(a->a.name="Mary")', false], ['noneMatch(a->a.name="John")', false]]) {
		assert.equal(evaluate(`=rowstream(A0:C3).${terminal}`), expected, terminal);
	}
	assert.equal(evaluate('=rowstream(A0:C3).limit(2).count()'), '#DIV/0!');
	assert.equal(evaluate('=rowstream(A0:C3).anyMatch(a->a.name="Mary")'), '#DIV/0!');
	for (const [terminal, expected] of [['anyMatch(a->TRUE)', false], ['allMatch(a->FALSE)', true], ['noneMatch(a->TRUE)', true]]) {
		assert.equal(evaluate(`=rowstream(A0:C0).${terminal}`), expected);
	}
});

test('stream lambdas have lexical scopes, ordinary formula functions and fresh relative references', () => {
	streamData(); set('D0', '10');
	assert.equal(evaluate('=rowstream(A0:C3).map(a->IF(a.age>20,round(a.age/2),0)).sum()'), 33);
	assert.equal(evaluate('=rowstream(A0:C3).limit(1).map(a->rowstream(A0:C3).map(b->a.age-b.age).sum()).sum()'), -14);
	assert.equal(evaluate('=rowstream(A0:C3).limit(1).map(a->a.age+[-22]{0}).sum()'), 33);
	assert.equal(evaluate('=rowstream(A0:C3).limit(1).map(a->"x, -> ) { age: " + a.name).findFirst().orElseThrow()'), 'x, -> ) { age: John');
	assert.equal(evaluate('=SUM(rowstream(A0:C3).map(a->a.age).sum(),1)'), 84);
	assert.equal(evaluate('=IF(FALSE,rowstream(A0:C3),7)'), 7);
	assert.equal(evaluate('=IFERROR(rowstream(A0:C3).map(a->1/0).sum(),99)'), 99);
	assert.throws(() => evaluateFormula('=IF(FALSE,rowstream(A0:C3).map(a->random()).count(),0)', 0, 0, { pure: true }), /#NAME\?/);
});

test('streams reject unfinished chains, invalid schemas and unsafe or non-lambda callbacks', () => {
	streamData();
	for (const expression of ['rowstream(A0:C3)', 'rowstream(A0:C3).map(a->a.age)', 'COUNT(rowstream(A0:C3))', 'rowstream(A0:C3)+1', 'IF(rowstream(A0:C3),1,0)']) {
		assert.equal(evaluate('=' + expression), '#VALUE!', expression);
	}
	for (const suffix of ['.count().map(a->a)', '.map(3).sum()', '.filter((a,b)->TRUE).count()', '.limit(-1).count()', '.skip(0.5).count()', '.map(a->a.missing).toTable()', '.map(a->a.constructor()).toTable()', '.map(a->a.age.constructor).toTable()', '.map(a->a["age"+"x"]).toTable()', '.toTable("x")', '.map(a->IF(a.age>20,{x:a.age},{y:a.age})).toTable()']) {
		assert.equal(evaluate('=rowstream(A0:C3)' + suffix), '#VALUE!', suffix);
	}
	assert.equal(evaluate('=rowstream(A0:C3).map(a->{x:a.name,x:a.age}).toTable()'), '#VALUE!');
	assert.equal(evaluate('=rowstream(A0:C3).map(a->{__proto__:a.name}).toTable()'), '#VALUE!');
	assert.equal(evaluate('=rowstream(A0:C3).madeUp()'), '#NAME?');
	set('B0', 'name'); assert.equal(evaluate('=rowstream(A0:C3).toTable()'), '#VALUE!');
	set('B0', ''); assert.equal(evaluate('=rowstream(A0:C3).count()'), '#VALUE!');
});

test('stream tables use ordinary protected spills and recalculate dependencies without stale rows', () => {
	streamData();
	set('E0', '=rowstream(A0:C3).filter(a->a.name="John").map(a->{name:a.lastName,age:a.age}).toTable()');
	set('H0', '=F2+1');
	const stored = JSON.stringify(sheet.rows);
	assertOrderIndependent();
	assert.equal(JSON.stringify(sheet.rows), stored);
	assert.deepEqual([shown('E0'), shown('E2'), shown('F1'), shown('H0')], ['name', 'Doe', 23, 20]);
	set('A3', 'Jane'); set('C1', '27');
	sheet.recalculate();
	assert.deepEqual([shown('F1'), shown('E2'), spill('E2')], [27, '', undefined]);
	set('E1', 'keep');
	assert.equal(value('E0'), '#SPILL!'); assert.equal(value('E1'), 'keep');
	set('E1', ''); set('C1', '=F1');
	assertOrderIndependent(); assert.equal(shown('E0'), '#SPILL!');
});
