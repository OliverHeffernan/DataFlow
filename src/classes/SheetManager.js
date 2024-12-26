//import { ref } from "vue";
import { create, all } from 'mathjs'
const config = { }
const math = create(all, config)
export default class SheetManager
{
	constructor()
	{
		// make sure there is only one instance of SheetManager
		if (SheetManager.instance)
		{
			return SheetManager.instance;
		}

		this.rows = [];

		this.numOfRows = 50;
		this.numOfCols = 50;
		this.selRow = 0;
		this.selCol = 0;

		// create a 2D array of empty strings
		for (let i = 0; i < this.numOfRows; i++)
		{
			let row = [];
			for (let j = 0; j < this.numOfCols; j++)
			{
				row.push("");
			}
			this.rows.push(row);
		}
		SheetManager.instance = this;
	}

	// function to get the formula for a specific cell
	getFormula(row, col)
	{
		// tries to get the formula, if it fails, it returns blank and logs the error
		try {
			return this.rows[row][col];
		}
		catch(e) {
			console.log(e.message);
			return '';
		}
	}

	// get the value of a specific cell
	getValue(row, col)
	{
		let expr = this.getFormula(row, col);

		// if the cell is not a formula, return the expression with no changes
		if (expr[0] !== "=")
		{
			return expr;
		}

		// remove the equals sign from the expression
		expr = expr.substring(1);


		// replacing cell ranges with string objects containing the sum and array.
		expr = expr.replace(/\b([A-Z]+\d+):([A-Z]+\d+)\b/g, (match, start, end) => {
			const startCol = start.match(/[A-Z]+/)[0].charCodeAt(0) - 65;
			const startRow = parseInt(start.match(/\d+/)[0]);
			const endCol = end.match(/[A-Z]+/)[0].charCodeAt(0) - 65;
			const endRow = parseInt(end.match(/\d+/)[0]);
			let sum = 0;
			let string = "";

			// iterate through cells that are within the range, adding them to the sun and string
			for (let i = startRow; i <= endRow; i++)
			{
				for (let j = startCol; j <= endCol; j++)
				{
					sum += Number(this.getValue(i, j));
					string += this.getValue(i, j);
					string += ",";
				}
			}

			// removing the last comma
			string = string.substring(0, string.length - 1);

			// wrapping the string in square brackets to make it a valid JSON array
			string = "[" + string + "]";

			// returning it as a string so that it can be parsed later
			return JSON.stringify({
				SUM: sum,
				ARRAY: JSON.parse(string)
			});
		});

		// replacing SUM with its value
		expr = expr.replace(/SUM\((.*)\)/g, (match, array) => {
			return JSON.parse(array).SUM;
		});

		// replacing cell references with their values
		expr = expr.replace(/([A-Z])(\d+)/g, (match, letter, number) => {
			return this.getValue(number, letter.charCodeAt(0) - 65);
		});

		// try to evaluate the expreession, if it fails, return the error message.
		try {
			return math.evaluate(expr);
		}
		catch(e) {
			return e.message;
		}
	}

	// function to select a specific cell
	selectCell(row, col)
	{
		// tries to select the cell, if it fails, it logs the error
		try {
			this.selRow = row;
			this.selCol = col;
			// display the formula of the new selected cell in the formula bar
			let bar = document.getElementById("formulaBar");
			bar.value = this.getFormula(row, col);

			// if it is defined, remove the focussed class from the previously selected cell
			if (this.getSelectedCell() !== undefined)
			{
				this.getSelectedCell().className = "cell";
			}

			// update the cell picker value
			document.getElementById("cellPicker").value = String.fromCharCode(col + 65) + (row);

			// add the focussed class to the new selected cell
			this.getCell(row, col).className = "focussed cell";

			// update the relative row numbers
			this.updateRelRows();
		}
		catch(e) {
			console.log(e.message);
		}
	}
	
	// function to set the formula of the selected cell
	setFormula()
	{
		// set the formula from the formula bar to the selected cell
		this.rows[this.selRow][this.selCol] = document.getElementById("formulaBar").value;

		// update the value of the selected cell
		this.getCell(this.selRow, this.selCol).innerText = this.getValue(this.selRow, this.selCol);
	}

	// function to get the element of a specific cell
	getCell(row, col)
	{
		return document.getElementById(col + ":" + row);
	}

	// returns the currently selected cell based on the className "focusssed"
	getSelectedCell()
	{
		return document.getElementsByClassName("focussed")[0];
	}

	// navigation functions
	moveLeft(amount)
	{
		for (let i = 0; i < amount; i++)
		{
			if (this.selCol > 0)
			{
				this.selectCell(this.selRow, this.selCol - 1);
			}
		}
		this.updateRelRows();
	}

	moveRight(amount)
	{
		for (let i = 0; i < amount; i++)
		{
			if (this.selCol < this.numOfCols - 1)
			{
				this.selectCell(this.selRow, this.selCol + 1);
			}
		}
	}

	moveUp(amount)
	{
		for (let i = 0; i < amount; i++)
		{
			if (this.selRow > 0)
			{
				this.selectCell(this.selRow - 1, this.selCol);
			}
		}
	}

	moveDown(amount)
	{
		for (let i = 0; i < amount; i++)
		{
			if (this.selRow < this.numOfRows - 1)
			{
				this.selectCell(this.selRow + 1, this.selCol);
			}
		}
	}

	// function to update the relative row numbers
	updateRelRows()
	{
		let labels = document.getElementsByClassName("relRow");
		for (let i = 0; i < labels.length; i++)
		{
			labels[i].innerText = Math.abs(this.selRow - i);
		}
	}
}
