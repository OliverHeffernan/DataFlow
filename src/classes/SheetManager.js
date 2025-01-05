import { ref } from "vue";
//import { reactive } from "vue";
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

		this.numOfRows = ref(50);
		this.numOfCols = ref(50);
		this.selRow = 0;
		this.selCol = 0;
		this.prevRow = 0;
		this.prevCol = 0;
		this.copyBuffer = [[]];

		// create a 2D array of empty strings
		for (let i = 0; i < this.numOfRows.value; i++)
		{
			let row = [];
			for (let j = 0; j < this.numOfCols.value; j++)
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

		expr = expr.replaceAll("THISROW", row);
		expr = expr.replaceAll("THISCOL", col);
		expr = expr.replaceAll("PREVROW", row - 1);
		expr = expr.replaceAll("PREVCOL", col - 1);
		console.log(row - 1);
		// curly braces are used to put equations in place of cell row references
		expr = expr.replaceAll(/\{([^}]+)\}/g, (match, expression) => {
			try {
				// Evaluate the expression within the curly braces
				const result = math.evaluate(expression);
				return result; // Replace the match with the result
			} catch (error) {
				console.error(`Error evaluating expression "${expression}":`, error);
				return match; // If evaluation fails, return the original match
			}
		});

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
					try {
						sum += Number(this.getValue(i, j));
						string += this.getValue(i, j);
						string += ",";
					}
					catch {
						sum += 0;
						string += "'" + this.getValue(i, j) + "',";
					}
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
			let scrollCol = col;
			if (this.selCol < this.prevCol) {
				scrollCol = col > 1 ? col - 1 : 0;
			}
			let scrollRow = row;
			if (this.selRow > this.prevRow) {
				scrollRow = row < this.numOfRows.value - 1 ? row + 1 : this.numOfRows.value;
			}
			else if (this.selRow < this.prevRow) {
				scrollRow = row > 2 ? row - 2 : 0;
			}

			const cell = this.getCell(scrollRow, scrollCol);
			
			const initialPos = cell.getBoundingClientRect();

			this.getCell(scrollRow, scrollCol).scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});

			const finalPos = cell.getBoundingClientRect();

			const scrolled = initialPos.top !== finalPos.top || initialPos.left !== finalPos.left;

			// if scrolling to first col, then scroll all the way
			let scrollEdge = false;
			let left = window.scrollX;
			let top = window.scrollY;
			if (col == 0) {
				left = 0;
				scrollEdge = true;
			}

			// if scrolling to last row, then scroll all the way
			if (row == this.numOfRows.value - 1) {
				top = document.body.scrollHeight;
				scrollEdge = true;
			}

			// if scrolling to first row, then scroll all the way
			if (row < 2) {
				top = 0;
				scrollEdge = true;
			}

			if (scrollEdge) {
				window.scrollTo({
					left: left,
					top: top
				});
			}

			this.prevRow = this.selRow;
			this.prevCol = this.selCol;
		}
		catch(e) {
			console.log(e.message);
		}
		this.clearPlaceholder();
	}

	scrollToCenterSelCell()
	{
		let cell = this.getCell(this.selRow, this.selCol);

		cell.scrollIntoView({
			behavior: 'smooth',
			block: 'center',
			inline: 'center'
		});

	}
	
	// function to set the formula of the selected cell
	setFormula()
	{
		// set the formula from the formula bar to the selected cell
		this.rows[this.selRow][this.selCol] = document.getElementById("formulaBar").value;

		// update the value of the selected cell
		this.getCell(this.selRow, this.selCol).innerText = this.getValue(this.selRow, this.selCol);
		this.loadAllCells();
	}

	// called when the user yanks something
	yank(cells)
	{
		this.copyBuffer = cells;	
	}

	paste(amount)
	{
		for (let i = 0; i < amount; i++)
		{
			for (let y = 0; y < this.copyBuffer.length; y++)
			{
				for (let x = 0; x < this.copyBuffer[y].length; x++)
				{
					this.rows[this.selRow + y][this.selCol + x] = this.copyBuffer[y][x];
				}
			}
			this.loadAllCells();
			this.moveDown(1);
		}
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
			if (this.selCol < this.numOfCols.value - 1)
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
			if (this.selRow < this.numOfRows.value - 1)
			{
				this.selectCell(this.selRow + 1, this.selCol);
			}
		}
	}

	// function to update the relative row numbers
	updateRelRows()
	{
		let labels = document.getElementsByClassName("relRow");
		for (let i = 1; i < labels.length; i++)
		{
			labels[i].innerText = Math.abs(this.selRow - i);
		}
	}

	// functions for saving using strings, temporary before i work out backend
	saveSheetToClipboard()
	{
		let str = JSON.stringify(this.rows);
		navigator.clipboard.writeText(str);
		let commandLine = document.getElementById("commandLine");
	}

	loadFromClipboard()
	{
		let commandLine = document.getElementById("commandLine");
		//let str = navigator.clipboard.readText();
		let str = commandLine.value;

		if (str === "")
		{
			commandLine.placeholder = "Paste the JSON string here, then click 'Load from clipboard'";
			return;
		}
		console.log(str);
		let data = JSON.parse(str);
		this.rows = data;
		this.loadAllCells();
		commandLine.value = "";
		this.clearPlaceholder();
	}

	clearPlaceholder()
	{
		let commandLine = document.getElementById("commandLine");
		commandLine.placeholder = "";
	}

	setPlaceholder(str)
	{
		let commandLine = document.getElementById("commandLine");
		commandLine.placeholder = str;
	}


	loadAllCells()
	{
		for (let i = 0; i < this.numOfRows.value; i++)
		{
			for (let j = 0; j < this.numOfCols.value; j++)
			{
				try {
					this.getCell(i, j).innerText = this.getValue(i, j);
				}
				catch {
					console.log("cell not yet loaded");
				}
			}
		}
		this.clearPlaceholder();
	}

	removeColAtIndex(index)
	{
		console.log("index: " + index);
		for (let i = 0; i < this.rows.length; i++)
		{
			console.log('deleting cols');
			this.rows[i].splice(index, 1);
		}

		this.loadAllCells();
		this.selectCell(this.selRow, this.selCol);
	}

	deleteSelCol(amount)
	{
		for (let i = 0; i < amount; i++)
		{
			this.removeColAtIndex(this.selCol);
		}
	}

	removeRowAtIndex(index)
	{
		this.rows.splice(index, 1);
		this.loadAllCells();
	}

	deleteSelRow(amount)
	{
		for (let i = 0; i < amount; i++)
		{	
			this.removeRowAtIndex(this.selRow);
		}
	}

	insertRowAtIndex(index)
	{
		let row = [];
		for (let i = 0; i < this.numOfCols.value; i++)
		{
			row.push("");
		}
		this.rows.splice(index, 0, row);
		this.numOfRows.value++;
		this.loadAllCells();

		this.selectCell(this.selRow, this.selCol);
	}

	insertColumnAtIndex(index)
	{
		for (let i = 0; i < this.numOfRows.value; i++)
		{
			this.rows[i].splice(index, 0, "");
		}
		this.numOfCols.value++;
		this.loadAllCells();

		this.selectCell(this.selRow, this.selCol);
	}

	insertRowBelow()
	{
		this.insertRowAtIndex(this.selRow + 1);
		this.moveDown(1);
	}

	insertRowAbove()
	{
		this.insertRowAtIndex(this.selRow);
		//this.moveUp(1);
	}

	insertColRight()
	{
		this.insertColumnAtIndex(this.selCol + 1);
		this.moveRight(1);
	}

	insertColLeft()
	{
		this.insertColumnAtIndex(this.selCol);
		//this.moveLeft(1);
	}
}
