import { compileConfig } from './LuaConfig.js';
self.onmessage = ({ data }) => {
	try { self.postMessage({ mappings: compileConfig(data) }); }
	catch (error) { self.postMessage({ error: error.message }); }
};
