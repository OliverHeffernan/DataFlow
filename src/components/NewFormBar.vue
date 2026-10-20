<template>
	<div class="formula-editor">
		<div id="newFormBar" @click="checkCommand.focus()" aria-label="Formula text">
			<div id="formSelection" aria-hidden="true"></div>
			<div id="formCursor" class="n" aria-hidden="true"></div>
			<div id="formText"></div>
		</div>
		<div class="formula-signature" v-if="ui.assist.signature" aria-label="Function signature">
			<span class="signature-name">{{ ui.assist.signature.name }}</span>(<template v-for="(arg, index) in ui.assist.signature.args" :key="index"><span v-if="index">, </span><strong v-if="index === Math.min(ui.assist.signature.argument, ui.assist.signature.args.length - 1)">{{ arg }}</strong><span v-else>{{ arg }}</span></template>)
		</div>
		<div class="formula-completions" v-if="ui.assist.inserting && ui.assist.suggestions.length" aria-label="Function suggestions">
			<div class="completion-caption">{{ ui.assist.prefix.startsWith('.') ? 'CHART METHODS' : 'FUNCTIONS' }} <span>↑ ↓ choose · Tab insert</span></div>
			<button v-for="(name, index) in ui.assist.suggestions" :key="name" :class="{ selected: index === ui.assist.selected % ui.assist.suggestions.length }" @mousedown.prevent @click="complete(index)">
				<b>{{ name }}</b><span>({{ functionHelp[name].join(', ') }})</span>
			</button>
		</div>
	</div>
</template>

<script setup>
import CheckCommand from '../classes/CheckCommand.js';
import { functionHelp } from '../classes/FormulaEditing.js';
const checkCommand = new CheckCommand(), ui = checkCommand.ui;
function complete(index) { checkCommand.keyboard.completionIndex = index; checkCommand.keyboard.key('<Tab>'); checkCommand.focus(); }
</script>

<style scoped>
.formula-editor { flex: 1; min-width: 0; position: relative; }
.formula-signature { color: #9aaec3; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 3px 8px; border-top: 1px solid #26394c; overflow-wrap: anywhere; }
.signature-name { color: #75e2bc; }
.formula-signature strong { color: #f4d779; font-weight: 500; background: #28384a; border-radius: 3px; padding: 1px 3px; }
.formula-completions { position: absolute; top: 100%; left: 0; width: min(440px, calc(100vw - 90px)); color: #dbe6f3; background: #142233; border: 1px solid #334a62; box-shadow: 0 8px 24px #0007; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.completion-caption { display: flex; justify-content: space-between; padding: 7px 10px; font-size: 10px; color: #9aaec3; border-bottom: 1px solid #26394c; }
.formula-completions button { display: flex; gap: 8px; text-align: left; width: 100%; padding: 7px 10px; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.formula-completions button span { color: #9aaec3; }
.formula-completions button.selected, .formula-completions button:hover { background: #263e56; }
#newFormBar {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	position: relative;
	flex: 1;
	min-width: 0;
	min-height: 20px;
	max-height: 30vh;
	overflow: auto;
	line-height: 20px;
	z-index: 300;
	background-color: #15202E;
}

#formCursor {
	position: absolute;
	height: 20px;
	width: 1ch;
	z-index: 305;
	pointer-events: none;
}

#formSelection :deep(span) {
	position: absolute;
	background: rgba(160, 254, 255, 0.3);
	pointer-events: none;
}

#formCursor.n {
	opacity: 0.3;
	background-color: white;
}

#formCursor.v {
	opacity: 0.3;
	background-color: white;
}

#formCursor.V {
	opacity: 0.3;
	background-color: white;
}

#formCursor.i {
	border-left: 1px white solid;
}

#formText {
	/*white-space: nowrap;*/
	white-space: pre;
	background-color: #15202E;
}
</style>
