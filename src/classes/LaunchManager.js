import { ref } from "vue";
export default class LaunchManager {
	constructor() {
		if (LaunchManager.instance) {
			return LaunchManager.instance;
		}

		this.displayed = ref(true);

		LaunchManager.instance = this;
	}

	hide() {
		this.displayed.value = false;
	}
}
