import SheetManager from '../classes/SheetManager.js';
const sheetManager = new SheetManager();

import { save, open } from '@tauri-apps/plugin-dialog';
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
export default class FileManager {
	constructor() {
		FileManager.instance = this;
	}

	async saveFile(saveAs = false) {
		try {
			let path;
			if (sheetManager.path == null || saveAs) {
				path = await save ({
					filters: [
						{
						  name: 'My Filter',
						  extensions: ['.dflo'],
						},
					]
				});
				sheetManager.path = path;
			}
			else {
				path = sheetManager.path;
			}

			let object = {
				rows: sheetManager.rows,
				styles: sheetManager.styles
			};

			let content = JSON.stringify(object);
			await invoke('write_file', { path: path, content: content });
			setPhMessage("Saved file to " + path + " successfully");
		}
		catch(e) {
			console.log(e.message);
			this.downloadFile(JSON.stringify(sheetManager.rows), "sheet.dflo");
		}
	}

	downloadFile(content, filename) {
		// Create a Blob object with the text content
		const blob = new Blob([content], { type: 'text/plain' });

		// Create an object URL for the Blob
		const url = URL.createObjectURL(blob);

		// Create an anchor element and set the download link
		const a = document.createElement('a');
		a.href = url;
		a.download = filename; // Specify the filename
		a.click(); // Programmatically click the anchor element to trigger the download

		// Clean up by revoking the object URL
		URL.revokeObjectURL(url);
	}

	async openFile() {
		try {
			const path = await open
			(
				{
					filters:
					[
						{
						  name: 'My Filter',
						  extensions: ['.dflo'],
						},
					]
				}
			);

			const file = await readTextFile(path);

			if (path.split('.').pop() == "dflo") {
				const object = JSON.parse(file);
				sheetManager.rows = object.rows;
				sheetManager.styles = object.styles;
				//sheetManager.loadStyles();
				let prevNumOfRows = sheetManager.numOfRows.value;
				let prevNumOfCols = sheetManager.numOfRows.value;
				sheetManager.numOfRows.value = sheetManager.rows.length;
				sheetManager.numOfCols.value = sheetManager.rows[0].length;
				sheetManager.loadAllCells(prevNumOfRows, prevNumOfCols);
				sheetManager.path = path;

				setPhMessage("Opened file from " + path + " successfully");
			}
			else if (path.split('.').pop() == "heff") {
				sheetManager.rows = JSON.parse(file);
				sheetManager.numOfRows.value = sheetManager.rows.length;
				sheetManager.numOfCols.value = sheetManager.rows[0].length;
				sheetManager.loadAllCells();

				sheetManager.path = path;

				setPhMessage("Opened file from " + path + " successfully");
			}
			else {
				console.log("Invalid file type");
			}
			//await file.close();
			//const file = await open(path)
		}
		catch (e) {
			console.log(e.message);
			document.getElementById("webFileUpload").style.display = "block";
		}
	}
}
