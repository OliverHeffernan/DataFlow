<template>
	<div :inert="recovery.state.dialog || recovery.state.locked ? true : undefined">
	<FirstLaunchScreen v-if="launchManager.displayed" />
	<FormulaBar />
	<CommandLine />
	<RightClickMenu />
	<table>
		<thead>
			<tr>
				<th class="rowLabelType rowLabels">abs</th>
				<th class="rowLabelType relRow">rel</th>
				<th v-for="(cell, index) in sheetManager.numOfCols" :key="index" class="labels colLabels">{{ sheetManager.columnLabel(index) }}</th>
			</tr>
		</thead>
		<tbody>
			<SheetRow
				v-for="index in sheetManager.numOfRows"
				:key="index - 1"
				:row="sheetManager.rows[index - 1]"
				:rowNo="index - 1"
			/>
		</tbody>
	</table>
	<div id="gridOverlays" aria-hidden="true"></div>
	</div>
	<RecoveryDialog :manager="recovery" />
</template>

<script setup>
	import "./styling/syntaxHighlighting.css";
	import { ref, onMounted, onUnmounted } from 'vue';
	import SheetManager from './classes/SheetManager.js';
	import SheetRow from './components/SheetRow.vue';
	import FormulaBar from './components/FormulaBar.vue';
	import CommandLine from './components/CommandLine.vue';
	import FirstLaunchScreen from './components/FirstLaunchScreen.vue';
	import RightClickMenu from './components/RightClickMenu.vue';
	import RecoveryDialog from './components/RecoveryDialog.vue';
	import RecoveryManager from './classes/RecoveryManager.js';
	import CheckCommand from './classes/CheckCommand.js';
	import FileManager from './classes/FileManager.js';

	import LaunchManager from './classes/LaunchManager.js';

	const launchManager = ref(new LaunchManager());

	const sheetManager = ref(new SheetManager());
	const recovery = new RecoveryManager(new SheetManager());
	sheetManager.value.recovery = recovery;
	recovery.save = () => new FileManager().saveFile();
	recovery.focus = () => new CheckCommand().focus();
	recovery.report = text => new CheckCommand().setPhMessage(text);
	recovery.onOpen = async () => { new LaunchManager().hide(); await new CheckCommand().newSheet(false); };
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
	padding: 0 0 var(--status-bar-height, 64px);
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
	margin-top: var(--formula-bar-height, 24px);
	z-index: 10;
}

.cell { scroll-margin-top: calc(var(--formula-bar-height, 24px) + 28px); scroll-margin-bottom: calc(var(--status-bar-height, 64px) + 24px); }
#gridOverlays { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 25; }
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
