<template>
	<FirstLaunchScreen v-if="launchManager.displayed" />
	<FormulaBar v-if="check.windows.active.content === 'sheet'" />
	<div v-else id="topBar" class="rules-topbar">Conditional formatting · {{ check.windows.active.sheet.name }}<span>Ctrl-w h/j/k/l · Switch window</span></div>
	<CommandLine />
	<RightClickMenu />
	<main id="windows" aria-label="Workspace windows"><WindowNode :node="check.windows.state.root" /></main>

</template>

<script setup>
	import "./styling/syntaxHighlighting.css";
	import { ref } from 'vue';
	import WindowNode from './components/WindowNode.vue';
	import CheckCommand from './classes/CheckCommand.js';
	import FormulaBar from './components/FormulaBar.vue';
	import CommandLine from './components/CommandLine.vue';
	import FirstLaunchScreen from './components/FirstLaunchScreen.vue';
	import RightClickMenu from './components/RightClickMenu.vue';

	import LaunchManager from './classes/LaunchManager.js';

	const launchManager = ref(new LaunchManager());
	const check = new CheckCommand();

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
	font-family: Avenir, Helvetica, Arial, sans-serif;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	color: #2c3e50;
	background-color: #091119;
	outline: none;
	scrollbar-color: red orange;
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

table {
	border-collapse: collapse;
	z-index: 10;
}

#windows { position: fixed; inset: var(--formula-bar-height, 24px) 0 var(--status-bar-height, 64px); display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-width: 0; min-height: 0; }
.rules-topbar { position: fixed; inset: 0 0 auto; display: flex; box-sizing: border-box; padding: 4px 10px; gap: 20px; font: 12px/20px ui-monospace, monospace; color: #dbe6f3; background: #15202e; }
.rules-topbar span { color: #9aaec3; margin-left: auto; }
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
	top: var(--formula-bar-height, 24px);
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
	top: var(--formula-bar-height, 24px);
	background-color: #091119;
}
</style>
