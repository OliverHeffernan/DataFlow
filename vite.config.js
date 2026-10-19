import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
	// Replace Fengari's Node configuration read at bundle time. A dev-server
	// global process shim would incorrectly select its Node-only libraries.
	define: command === 'build' ? { 'process.env.FENGARICONF': '""' } : {},
	optimizeDeps: { esbuildOptions: { define: { 'process.env.FENGARICONF': '""' } } },
	plugins: [
		vue(),
		vueDevTools(),
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		},
	},
	//base: '/DataFlow/',
}))
