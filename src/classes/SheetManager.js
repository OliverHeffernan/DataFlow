//import { ref } from "vue";
import { create, all } from 'mathjs'
const config = { }
const math = create(all, config)
export default class SheetManager
{
	constructor()
	{
		if (SheetManager.instance)
		{
			return SheetManager.instance;
		}

		//this.rows = ref([]);
		this.rows = [];

		this.numOfRows = 50;
		this.numOfCols = 50;
		this.selRow = 0;
		this.selCol = 0;

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

	getFormula(row, col)
	{
		try {
			return this.rows[row][col];
		}
		catch(e) {
			console.log(e.message);
			return '';
		}
	}

	getValue(row, col)
	{
		let expr = this.getFormula(row, col);
		if (expr[0] !== "=")
		{
			return expr;
		}
		expr = expr.substring(1);

		//const matches = [...expr.matchAll(/\b([A-Z]+\d+):([A-Z]+\d+)\b/g)];

		expr = expr.replace(/\b([A-Z]+\d+):([A-Z]+\d+)\b/g, (match, start, end) => {
			const startCol = start.match(/[A-Z]+/)[0].charCodeAt(0) - 65;
			const startRow = parseInt(start.match(/\d+/)[0]);
			const endCol = end.match(/[A-Z]+/)[0].charCodeAt(0) - 65;
			const endRow = parseInt(end.match(/\d+/)[0]);
			let sum = 0;
			let string = "";
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
			console.log("sum: " + sum);
			return JSON.stringify({
				SUM: sum,
				ARRAY: JSON.parse(string)
			});
		});

		// replacing SUM with its value
		expr = expr.replace(/SUM\((.*)\)/g, (match, array) => {
			console.log("match: " + match);
			console.log("array: " + array);
			return JSON.parse(array).SUM;
		});
		console.log("expr: " + expr);
		
		// replacing cell references with their values
		expr = expr.replace(/([A-Z])(\d+)/g, (match, letter, number) => {
			return this.getValue(number, letter.charCodeAt(0) - 65);
		});

		try {
			return math.evaluate(expr);
		}
		catch(e) {
			return e.message;
		}
	}

	selectCell(row, col)
	{
		try {
			this.selRow = row;
			this.selCol = col;
			let bar = document.getElementById("formulaBar");
			//bar.focus();
			bar.value = this.getFormula(row, col);
			if (this.getSelectedCell() !== undefined)
			{
				this.getSelectedCell().className = "cell";
			}
			document.getElementById("cellPicker").value = String.fromCharCode(col + 65) + (row);
			this.getCell(row, col).className = "focussed cell";
			this.updateRelRows();
		}
		catch(e) {
			console.log(e.message);
		}
	}
	
	setFormula()
	{
		this.rows[this.selRow][this.selCol] = document.getElementById("formulaBar").value;
		document.getElementById("formulaBar").value = "";


		this.getCell(this.selRow, this.selCol).innerText = this.getValue(this.selRow, this.selCol);
	}

	getCell(row, col)
	{
		return document.getElementById(col + ":" + row);
	}

	getSelectedCell()
	{
		return document.getElementsByClassName("focussed")[0];
	}

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

	updateRelRows()
	{
		let labels = document.getElementsByClassName("relRow");
		for (let i = 0; i < labels.length; i++)
		{
			labels[i].innerText = Math.abs(this.selRow - i);
		}
	}
}
