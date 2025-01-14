<template>
	<FirstLaunchScreen v-if="launchManager.displayed" />
	<FormulaBar />
	<CommandLine />
	<table>
		<thead>
			<tr>
				<th class="rowLabelType rowLabels">abs</th>
				<th class="rowLabelType relRow">rel</th>
				<th v-for="(cell, index) in sheetManager.numOfRows" :key="index" class="labels colLabels">{{ String.fromCharCode(index + 65) }}</th>
			</tr>
		</thead>
		<tbody>
			<SheetRow
				v-for="(row, index) in sheetManager.rows"
				:key="index"
				:row="row"
				:rowNo="index"
			/>
		</tbody>
	</table>

</template>

<script setup>
	import { ref } from 'vue';
	import SheetManager from './classes/SheetManager.js';
	import SheetRow from './components/SheetRow.vue';
	import FormulaBar from './components/FormulaBar.vue';
	import CommandLine from './components/CommandLine.vue';
	import FirstLaunchScreen from './components/FirstLaunchScreen.vue';

	import LaunchManager from './classes/LaunchManager.js';

	const launchManager = ref(new LaunchManager());

	const sheetManager = ref(new SheetManager());

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
	scrollbar-color: red orange;
}

body {
	margin: 0;
	padding: 0;
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
	margin-top: 24px;
}

.labels {
	color: rgba(255,255,255,0.5);
	padding: 0 10px;
	background-color: #15202E;
	/*border: 1px solid #091119;*/
	border: none;
	z-index: 2;
}

.colLabels {
	position: sticky;
	top: 24px;
}

.rowLabels {
	position: sticky;
	left: 0;
}

.relRow {
	position: sticky;
	left: 38px;
}

.rowLabelType {
	z-index: 3;
	top: 24px;
	background-color: #091119;
}
</style>
