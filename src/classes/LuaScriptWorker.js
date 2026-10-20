import { executeWorkbookScript } from './WorkbookScript.js';

self.onmessage = ({ data }) => {
	try { self.postMessage({ result: executeWorkbookScript(data) }); }
	catch (error) { self.postMessage({ error: String(error.message || error).slice(0, 8192) }); }
};
