import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
	// Replace Fengari's Node configuration read at bundle time. A dev-server
	// global process shim would incorrectly select its Node-only libraries.
	define: command === 'build' ? { 'process.env.FENGARICONF': '""' } : {},
	optimizeDeps: { rolldownOptions: { transform: { define: { 'process.env.FENGARICONF': '""' } } } },
	plugins: [vue()],
	// Preserve Vite 6's browser/WebView targets rather than raising them on upgrade.
	build: { target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'] },
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		},
	},
	//base: '/DataFlow/',
}))
