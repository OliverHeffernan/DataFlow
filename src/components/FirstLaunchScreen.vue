<template>
	<div id="splashScreen">
		<h1> Welcome to DataFlow </h1>

		<img src="../assets/128x128.png" />

		<h2> Harness the speed of light </h2>
		<h2> Commands are entered into the input field at the bottom of the screen.</h2>
		<h2>Commands</h2>
		<h3><span class="keystroke">:clear</span> to create a blank spreadsheet.</h3>
		<h3><span class="keystroke">:help</span> to open the documentation.</h3>
		<h3><span class="keystroke">:o</span> to open a file.</h3>
		<h3><span class="keystroke">:w</span> to save a file.</h3>
		<h3><span class="keystroke">:wa</span> to save a file as.</h3>
		<!--<div class="circle"></div>-->

		<div id="fadeIn"></div>

		<BlurBubble v-for="colour in colours" :colour="colour" />
	</div>
</template>

<script setup>
const colours = [
	"blue",
	"lightblue",
	"white"
];
import BlurBubble from './BlurBubble.vue';

</script>

<style scoped>
#splashScreen {
	position: fixed;
	top: 0;
	bottom: 0;
	right: 0;
	left: 0;
	background-color: #0B1118;
	z-index: 20;
	color: white;
	text-align: center;
}

h2 {
	opacity: 20%;
}

.keystroke {
	padding: 5px;
	background-color: #202020;
	border-radius: 5px;
}

#fakeComLine {
	position: fixed;
	bottom: 0;
	left: 0;
	right: 0;
	border: none;
	background-color: #15202E;
}

@keyframes circle {
	0% {
		top: 0;
		left: 0;
	}
	50% {
		top: 70%;
		left: 70%;
	}
	100% {
		top: 0;
		left: 0;
	}
}

.circle {
	position: fixed;
	width: 400px;
	height: 400px;
	border-radius: 50%;
	background-color: #73DBF3;
	filter: blur(300px);
	opacity: 50%;

	animation-name: circle;
	animation-duration: 30s;
	animation-iteration-count: infinite;
}

@keyframes fadeIn {
	from {
		opacity: 100%;
	}
	to {
		opacity: 0%;
	}
}

#fadeIn {
	position: fixed;
	top: 0;
	bottom: 0;
	right: 0;
	left: 0;
	background-color: black;
	opacity: 0%;

	animation-name: fadeIn;
	animation-duration: 3s;
}

@keyframes logo {
	from {
		/*transform: scale(2);*/
		transform: translate(0, -150px);
	}
	to {
		/*transform: scale(1);*/
		transform: translate(0,0);
	}
}

img {
	animation-name: logo;
	animation-duration: 3s;
}

</style>
