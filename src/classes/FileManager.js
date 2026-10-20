import SheetManager from "../classes/SheetManager.js";
const sheetManager = new SheetManager();

import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke, isTauri } from "@tauri-apps/api/core";

export default class FileManager {
	constructor(onOpen) {
		this.onOpen = onOpen;
		FileManager.instance = this;
	}

	async saveFile(saveAs = false) {
		if (!isTauri()) {
			this.downloadFile(JSON.stringify(sheetManager.serializeWorkbook()), "sheet.dflo");
			this.setPhMessage('Downloaded workbook as sheet.dflo');
			return;
		}
		try {
			let path;
			if (sheetManager.path == null || saveAs) {
				path = await save({
					filters: [
						{
							name: "DataFlow workbook",
							extensions: ["dflo"],
						},
					],
				});
			} else {
				path = sheetManager.path;
			}

			if (!path) return;
			let content = JSON.stringify(sheetManager.serializeWorkbook());
			await invoke("write_file", { path: path, content: content });
			sheetManager.path = path;
			this.setPhMessage("Saved file to " + path + " successfully");
		} catch (e) {
			this.setPhMessage(`Save: ${e.message || String(e)}`);
		}
	}

	downloadFile(content, filename) {
		// Create a Blob object with the text content
		const blob = new Blob([content], { type: "text/plain" });

		// Create an object URL for the Blob
		const url = URL.createObjectURL(blob);

		// Create an anchor element and set the download link
		const a = document.createElement("a");
		a.href = url;
		a.download = filename; // Specify the filename
		a.click(); // Programmatically click the anchor element to trigger the download

		// Clean up by revoking the object URL
		URL.revokeObjectURL(url);
	}

	async openFile() {
		if (!isTauri()) {
			document.getElementById("webFileUpload").style.display = "block";
			return;
		}
		try {
			const path = await open({
				filters: [
					{
						name: "DataFlow workbook (including legacy files)",
						extensions: ["dflo", "heff"],
					},
				],
			});

			if (!path) return;
			await this.loadFile(await readTextFile(path), path);
		} catch (e) {
			this.setPhMessage(`Open: ${e.message || String(e)}`);
		}
	}

	async loadFile(content, path = null) {
		sheetManager.loadWorkbook(JSON.parse(content), path);
		await this.onOpen?.();
		this.setPhMessage(path ? `Opened file from ${path} successfully` : 'Opened workbook successfully');
	}

	setPhMessage(mg) {
		document.getElementById("commandLine").dataset.message = mg;
	}
}
