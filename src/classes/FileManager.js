import SheetManager from "../classes/SheetManager.js";
const sheetManager = new SheetManager();

import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke, isTauri } from "@tauri-apps/api/core";

export default class FileManager {
	constructor(onOpen, beforeOpen, io = {}) {
		this.onOpen = onOpen;
		this.io = { native: isTauri(), save, open, readTextFile, invoke, ...io };
		this.beforeOpen = beforeOpen;
		FileManager.instance = this;
	}

	async saveFile(saveAs = false) {
		// One manual write at a time, including across short-lived FileManagers.
		if (sheetManager.saving) return sheetManager.saving;
		const operation = this.writeWorkbook(saveAs);
		sheetManager.saving = operation;
		try { return await operation; }
		finally { sheetManager.saving = null; }
	}

	async writeWorkbook(saveAs) {
		const recovery = sheetManager.recovery;
		try {
			const captured = recovery?.capture() ?? { content: JSON.stringify(sheetManager.serializeWorkbook()) };
			if (!this.io.native) {
				const name = recovery?.state.name === 'Untitled' ? 'sheet.dflo' : recovery?.state.name || 'sheet.dflo';
				this.downloadFile(captured.content, name);
				await recovery?.saved(captured, name, true);
				this.setPhMessage(`Download requested: ${name}; browser recovery retained`);
				return { status: 'exported' };
			}
			const path = sheetManager.path != null && !saveAs ? sheetManager.path : await this.io.save({
				defaultPath: recovery?.state.name === 'Untitled' ? 'sheet.dflo' : recovery?.state.name,
				filters: [{ name: 'DataFlow workbook', extensions: ['dflo'] }],
			});
			if (!path) return { status: 'cancelled' };
			if (recovery && captured.document !== recovery.document) return { status: 'cancelled' };
			const destination = await this.io.invoke('write_file', { path, content: captured.content });
			if (recovery) await recovery.saved(captured, destination);
			else sheetManager.path = destination;
			this.setPhMessage(`Saved workbook to ${destination}`);
			return { status: 'saved', path: destination };
		} catch (e) {
			const error = e.message || String(e);
			if (recovery) recovery.state.error = `Save: ${error}`;
			this.setPhMessage(`Save failed: ${error}. Work and recovery retained.`);
			return { status: 'failed', error };
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
		if (!this.io.native) {
			document.getElementById("webFileUpload").style.display = "block";
			return;
		}
		try {
			const path = await this.io.open({
				filters: [
					{
						name: "DataFlow workbook (including legacy files)",
						extensions: ["dflo", "heff"],
					},
				],
			});

			if (!path) return;
			return await this.loadFile(await this.io.readTextFile(path), path);
		} catch (e) {
			this.setPhMessage(`Open: ${e.message || String(e)}`);
		}
	}

	async loadFile(content, path = null) {
		const data = JSON.parse(content);
		sheetManager.validateWorkbook(data);
		if (sheetManager.saving) await sheetManager.saving;
		this.beforeOpen?.();
		if (sheetManager.recovery && !await sheetManager.recovery.guard()) return false;
		sheetManager.loadWorkbook(data, path);
		await this.onOpen?.();
		this.setPhMessage(path ? `Opened file from ${path} successfully` : 'Opened workbook successfully');
		return true;
	}

	setPhMessage(mg) {
		const display = document.getElementById('commandLine');
		if (display) display.dataset.message = mg;
	}
}
