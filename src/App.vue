<template>
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

	const sheetManager = ref(new SheetManager());
</script>

<style>
#app {
	font-family: Avenir, Helvetica, Arial, sans-serif;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	color: #2c3e50;
	background-color: #091119;
}

body {
	margin: 0;
	padding: 0;
	background-color: #091119;
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
