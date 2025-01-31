const config = { }
import { create, all } from 'mathjs'
const math = create(all, config)
export default class Formulas {
	constructor() {
		Formulas.instance = this;
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
		expr = expr.replace(/([A-Z])(\d+)/g, (match, letter, number) => {
			return sheetManager.getValue(number, letter.charCodeAt(0) - 65);
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
				console.error(`Error evaluating expression "${expression}":`, error);
				console.error(error.message);
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
				return String.fromCharCode(65 + result);
			}
			catch (error) {
				console.error(`Error evaluating expression "${expression}":`, error);
				console.error(error.message);
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
					try {
						const value = Number(sheetManager.getValue(i, j)); // Assume this.getValue retrieves cell value
						sum += value;
						//values.push(value);
					} catch {
						const nonNumericValue = sheetManager.getValue(i, j);
						//values.push(`'${nonNumericValue}'`);
					}
					values.push(sheetManager.getValue(i, j));
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
