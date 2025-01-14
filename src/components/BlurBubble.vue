<template>
<div :style="'background-color:' + colour + ';'" class="bubble" :id="colour"></div>

</template>
<script setup>
import { onMounted, defineProps } from 'vue';
const props = defineProps({
	colour: {
		type: String,
		required: true,
	}
});

let left = Math.random() * 100;
let top = Math.random() * 100;

let element;

onMounted(() => {
	element = document.getElementById(props.colour);

	console.log(element);
	//requestAnimationFrame(dvdmove);

	requestAnimationFrame(trigMove);

	console.log(element.style.top);
});


let dir = Math.random() * 2 * Math.PI;
let dirVel = Math.random() * 0.5;
let vel = 0.2;

const ul = 85;
const ll = 0;
const maxDeltaDir = 0.2;


function trigMove() {
 // Update direction
    dir += Math.random() * maxDeltaDir * 2 - maxDeltaDir;

    // Normalize direction to range [0, 2 * Math.PI]
    while (dir < 0) dir += 2 * Math.PI;
    while (dir >= 2 * Math.PI) dir -= 2 * Math.PI;

    // Calculate the next position
    const nextLeft = left + vel * Math.cos(dir);
    const nextTop = top + vel * Math.sin(dir);

    // Check bounds and adjust direction if needed
    if (nextLeft < ll || nextLeft > ul) {
        dir = Math.PI - dir; // Reflect horizontally
    }
    if (nextTop < ll || nextTop > ul) {
        dir = -dir; // Reflect vertically
    }

    // Recalculate position after potentially adjusting direction
    left += vel * Math.cos(dir);
    top += vel * Math.sin(dir);

    // Apply new position
    element.style.top = top + "%";
    element.style.left = left + "%";

    // Request next frame
    requestAnimationFrame(trigMove);
}

/*
let xv = 0.1;
let yv = 0.1;

let xd = 1;
let yd = 1;
function dvdmove() {
	left += xv * xd;
	top += yv * yd;

	if (top > 100) yd = -1;
	if (top < 0) yd = 1;
	if (left > 100) xd = -1;
	if (left < 0) xd = 1;

	console.log("kia ora");

	element.style.top = top + "%";
	element.style.left = left + "%";

	requestAnimationFrame(move);
}
*/


</script>

<style scoped>
.bubble {
	position: fixed;
	top: 0;
	left: 0;
	width: 100px;
	height: 100px;
	border-radius: 50%;
	filter: blur(100px);
}
</style>
