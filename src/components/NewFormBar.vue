<template>
	<div id="newFormBar">
		<div id="formCursor" class="n"></div>
		<div id="formText"></div>
	</div>
</template>

<style scoped>
#newFormBar {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	z-index: 300;
	background-color: #15202E;
}

#formCursor {
	position: absolute;
	height: 25px;
	width: 1ch;
	z-index: 305;
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
