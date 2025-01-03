<template>
	<div id="menuBar">
		<div class="subMenu">
			<div class="subMenuBtn">File</div>
			<div class="dropdown-content">
				<button>Save as</button>
			</div>
		</div>
	</div>
</template>
<script setup>
import { invoke } from '@tauri-apps/api';

/*
function FileDialog() {
	 invoke('read_thing')
		.then((response) => {
		  console.log('Success:', response);
		})
		.catch((error) => {
		  console.error('Error invoking read:', error);
		}
	);
}
*/
</script>
<style scoped>
#menuBar {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	display: flex;
	z-index: 50;
	background-color: #091119;
	color: white;
	font-size: 13px;
}

.subMenuBtn {
	padding: 5px 10px;
	margin: 1px;
	border-radius: 3px;
	cursor: pointer;
}

.subMenuBtn:hover {
	background-color: #15202E;
}

.subMenu {
	position: relative;
	display: inline-block;
}

.dropdown-content {
	display: none;
	position: absolute;
	background-color: #15202E;
	padding: 5px;
	min-width: 140px;
}

.subMenu:hover .dropdown-content {
	display: block;
}

.dropdown-content button {
	text-decoration: none;
	color: white;
	display: block;
	background: none;
	border: none;
}
</style>
