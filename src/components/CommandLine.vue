<template>
	<div id="statusBar" @click="checkCommand.focus()">
		<div class="sheet-strip">
			<ol class="sheet-list" aria-label="Workbook sheets">
				<li v-for="(sheet, index) in sheetManager.sheets" :key="sheet.name" :aria-current="index === sheetManager.workbook.activeSheetIndex ? 'true' : undefined"><span class="sheet-number">{{ index + 1 }}</span>{{ sheet.name }}</li>
			</ol>
			<span class="sheet-help"><kbd>:sheet</kbd> switch · <kbd>:sheetnew</kbd> create</span>
		</div>
		<div class="status-context" v-if="ui.error || ui.spill" :class="{ 'cell-error': ui.error }" role="status">{{ ui.error || ui.spill }}</div>
		<div class="command-status">
			<div id="modeDisplay">-- NORMAL --</div>
			<div id="commandLine" aria-label="Commands and messages" aria-live="polite" data-message="Type : for commands · i to edit"></div>
		</div>
		<div id="shortcutBar" aria-label="Available keyboard shortcuts">
			<span v-for="(hint, index) in ui.hints" :key="index" class="shortcut"><kbd>{{ hint.key }}</kbd><span>{{ hint.description }}</span></span>
		</div>
	</div>
	<input id="luaConfigInput" type="file" accept=".lua" hidden @change="checkCommand.importConfig($event.target.files[0])" />
	<ScriptDialog />
	<div id="webFileUpload" role="dialog" aria-label="Open spreadsheet">
		<input id="fileInput" type="file" accept=".dflo,.heff,.json" />
		<button id="readFileBtn" @click="openFileWeb()">Read File</button>
		<button id="cancelButton" @click="closeWebFilePick()">Cancel</button>
	</div>
</template>

<script setup>
	import { onMounted, onUnmounted } from 'vue';
	import ScriptDialog from './ScriptDialog.vue';
	import SheetManager from '../classes/SheetManager.js';
	const sheetManager = new SheetManager();

	import CheckCommand from '../classes/CheckCommand.js';
	import FileManager from '../classes/FileManager.js';
	const checkCommand = new CheckCommand();
	const ui = checkCommand.ui;
	let disconnect;
	const resize = new ResizeObserver(() => {
		document.documentElement.style.setProperty('--status-bar-height', `${document.getElementById('statusBar').offsetHeight}px`);
	});
	onMounted(() => { disconnect = checkCommand.connectInput(); resize.observe(document.getElementById('statusBar')); window.addEventListener('resize', refresh); });
	onUnmounted(() => { disconnect?.(); resize.disconnect(); window.removeEventListener('resize', refresh); });
	function refresh() { checkCommand.render(); }

	function closeWebFilePick() {
		document.getElementById("webFileUpload").style.display = "none";
		checkCommand.focus();
	}

	function openFileWeb() {
		const fileInput = document.getElementById('fileInput');
		const file = fileInput.files[0];
		if (!file) return;

		const reader = new FileReader();

		reader.onload = async function(e) {
			try {
				await new FileManager(() => checkCommand.newSheet()).loadFile(e.target.result);
			} catch (error) { checkCommand.setPhMessage(`Open: ${error.message}`); }
		}

		reader.readAsText(file);


		closeWebFilePick();
	}
</script>
<style>
#statusBar {
	position: fixed;
	width: 100%;
	bottom: 0;
	color: #dbe6f3;
	background: #111d2a;
	z-index: 50;
	border-top: 1px solid #2a3d51;
	font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sheet-strip { display: flex; align-items: center; gap: 20px; padding: 0 12px; border-bottom: 1px solid #2a3d51; }
.sheet-list { display: flex; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; list-style: none; margin: 0; padding: 0; }
.sheet-list li { display: flex; gap: 8px; align-items: center; padding: 6px 10px; white-space: nowrap; color: #9aaec3; border-bottom: 2px solid transparent; }
.sheet-list li[aria-current="true"] { color: #75e2bc; background: #192c3a; border-bottom-color: #75e2bc; }
.sheet-number { color: #9aaec3; font-size: 10px; }
.sheet-help { color: #9aaec3; flex-shrink: 0; }

.command-status { display: flex; align-items: center; min-height: 28px; padding: 0 12px; gap: 16px; }
#commandLine {
	flex: 1;
	min-width: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
#commandLine:empty::before { content: attr(data-message); color: #9aaec3; }
#commandLine.typing-command::after { content: '▏'; color: #75e2bc; }
#modeDisplay { flex-shrink: 0; color: #75e2bc; font-size: 11px; white-space: nowrap; }
#shortcutBar { display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 7px 12px; border-top: 1px solid #213247; max-height: 25vh; overflow: auto; }
.shortcut { display: inline-flex; align-items: center; gap: 7px; color: #9aaec3; white-space: nowrap; }
kbd { color: #dbe6f3; font: inherit; }
.shortcut kbd { color: #9fd6ff; }
.status-context { padding: 5px 12px; border-bottom: 1px solid #213247; color: #afc5df; }
.status-context.cell-error { color: #ffb5a2; }

#webFileUpload {
	display: none;
	position: fixed;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);

	background-color: #15202E;
	border-radius: 20px;
	padding: 20px;
	box-shadow: black 0px 0px 50px;
	z-index: 80;
}

#fileInput {
	color: white;
}

#cancelButton {
	margin-left: 5px;
}
@media (max-width: 600px) { .sheet-help { display: none; } .command-status { gap: 8px; } #shortcutBar { gap: 6px 14px; font-size: 11px; } }
</style>
