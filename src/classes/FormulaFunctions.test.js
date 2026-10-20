import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import SheetManager from "./SheetManager.js";

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

test("existing arithmetic, mathjs functions, aggregates and relative notation keep working", () => {
	for (const [formula, expected] of [
		["=2+3*4", 14], ["=2^3 mod 5", 3], ["=sqrt(16) + max(B0:B3)", 13], ["=round(pi, 2)", 3.14],
		["=SUM(B0:B4)", 18], ["=AVG(B0:B4)", 3.6], ["=MEAN(B0:B3)", 4.5], ["=COUNT(B0:B4)", 5],
		["= SUM( B0 : B3 ) + 1", 19], ["=B4 + 1", 1], ["=[1]{max(0, 1) - 1} * 2", 10], ["=B{B1}", 1],
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
