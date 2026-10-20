<template>
	<div :inert="recovery.state.dialog || recovery.state.locked ? true : undefined">
	<FirstLaunchScreen v-if="launchManager.displayed" />
	<CommandLine />
	<RightClickMenu />
	<main id="windows" aria-label="Workspace windows"><WindowNode :node="check.windows.state.root" /></main>
	</div>
	<RecoveryDialog :manager="recovery" />
</template>

<script setup>
	import "./styling/syntaxHighlighting.css";
	import { ref, watch, onMounted, onUnmounted } from 'vue';
	import SheetManager from './classes/SheetManager.js';
	import WindowNode from './components/WindowNode.vue';
	import CommandLine from './components/CommandLine.vue';
	import FirstLaunchScreen from './components/FirstLaunchScreen.vue';
	import RightClickMenu from './components/RightClickMenu.vue';
	import RecoveryDialog from './components/RecoveryDialog.vue';
	import RecoveryManager from './classes/RecoveryManager.js';
	import CheckCommand from './classes/CheckCommand.js';
	import FileManager from './classes/FileManager.js';

	import LaunchManager from './classes/LaunchManager.js';

	const launchManager = ref(new LaunchManager());
	const check = new CheckCommand();
	const recovery = new RecoveryManager(new SheetManager());
	check.sheet.recovery = recovery;
	recovery.beforeLeave = () => check.guardDrafts();
	recovery.hasDrafts = () => check.windows.windows.some(pane => pane.rules?.dirty);
	recovery.save = () => new FileManager().saveFile();
	recovery.focus = () => check.focus();
	recovery.report = text => check.setPhMessage(text);
	recovery.onOpen = async () => { new LaunchManager().hide(); await check.newSheet(false); };
	watch(() => recovery.state.error, error => { if (error) check.setPhMessage(error); });
	onMounted(() => { recovery.start().catch(error => { recovery.state.error = error.message || String(error); }); });
	onUnmounted(() => { recovery.close().catch(() => {}); });

	let firstTime;
	const testing = true;

	if (localStorage.getItem("launched") && !testing) firstTime = false;
	else {
		firstTime = true;
		localStorage.setItem("launched", "launched");
	}
</script>

<style>
#app {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	color: #2c3e50;
	background-color: #091119;
	outline: none;
}

body {
	margin: 0;
	padding: 0;
	overflow: hidden;
	background-color: #091119;

}

::-webkit-scrollbar {
	background: #0A0C0F;
}

::-webkit-scrollbar-thumb {
	background: #1E2227;
	border: 2px #28374A solid;
	border-radius: 5px;
}

html {
	scrollbar-color: #1E2227 #0A0C0F;
	scrollbar-width: thin;
}

table {
	border-collapse: collapse;
	z-index: 10;
}

#windows { position: fixed; inset: 0 0 var(--status-bar-height, 64px); display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-width: 0; min-height: 0; }
.reference-outline, .spill-outline { position: absolute; box-sizing: border-box; border: 2px solid var(--reference-color); pointer-events: none; }
.reference-outline { background: color-mix(in srgb, var(--reference-color) 9%, transparent); }
.spill-outline { border-style: dashed; }
.formula-string { color: #c9d7bd; }

.labels {
	color: rgba(255,255,255,0.5);
	padding: 0 10px;
	background-color: #15202E;
	/*border: 1px solid #091119;*/
	border: none;
	/*z-index: 2;*/
}

.colLabels {
	position: sticky;
	top: 0;
	z-index: 30;
}

.rowLabels {
	position: sticky;
	left: 0;
	z-index: 30;
}

.relRow {
	position: sticky;
	left: 38px;
	z-index: 30;
}

.rowLabelType {
	z-index: 40;
	top: 0;
	background-color: #091119;
}

kbd { flex-shrink: 0; display: inline-block; border: 1px solid #3a526a; border-radius: 4px; padding: 0 5px; font: inherit; color: #b3cfe6; background: #21364b; white-space: nowrap; }
</style>
