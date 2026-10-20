import fengari from 'fengari';
import { scriptValueToRaw } from './ScriptValues.js';
import { cellLabel, columnIndex } from './FormulaFunctions.js';

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
export const scriptLimits = Object.freeze({
	sourceBytes: 128 * 1024,
	cellBytes: 16 * 1024,
	transferBytes: 8 * 1024 * 1024,
	transferCells: 100000,
	apiCalls: 1000,
	instructions: 1000000,
	timeoutMs: 5000,
	logBytes: 8192,
	logMessages: 100,
});

// Trusted local scripts only: hooks do not count native-library work, and Fengari has no hard
// heap quota. Even without string.rep/format, Lua concatenation and tables can exhaust memory.
// access = { sheets: [{name, rows, cols}], activeSheet, selection?, resolve?(name),
//            read(rect, computed), write(rect, rawStringMatrix) }.
// Rectangles are {sheet: zeroBasedSheetIndex, r0, c0, r1, c1}; reads return raw/typed matrices.
// Callbacks are synchronous and own detached reads/staging, never live publication. The caller
// discards its entire draft on failure. No live SheetManager or JS object enters Lua.
export function executeLuaScript(source, access) {
	if (typeof source !== 'string' || source.length > scriptLimits.sourceBytes) throw new Error('Script exceeds 128 KiB');
	const bytes = to_luastring(source);
	if (bytes.length > scriptLimits.sourceBytes) throw new Error('Script exceeds 128 KiB');
	const L = lauxlib.luaL_newstate();
	let calls = 0, cells = 0, transferred = 0, logBytes = 0;
	const logs = [];
	const fail = message => { throw new Error(message); };
	const tick = () => { if (++calls > scriptLimits.apiCalls) fail('Script API call limit exceeded'); };
	const string = (index, max = scriptLimits.cellBytes) => {
		if (lua.lua_type(L, index) !== lua.LUA_TSTRING) fail('Expected a string');
		const value = lua.lua_tolstring(L, index);
		if (value.length > max) fail('Script string limit exceeded');
		return to_jsstring(value);
	};
	const push = value => {
		if (typeof value === 'string') {
			const encoded = to_luastring(value);
			if (encoded.length > scriptLimits.cellBytes) fail('Script cell limit exceeded');
			transferred += encoded.length;
			if (transferred > scriptLimits.transferBytes) fail('Script transfer limit exceeded');
			lua.lua_pushstring(L, encoded);
		} else if (typeof value === 'boolean') lua.lua_pushboolean(L, value);
		else if (typeof value === 'number') lua.lua_pushinteger(L, value);
		else {
			lua.lua_newtable(L);
			for (const [key, item] of Object.entries(value)) {
				push(item);
				if (Array.isArray(value)) lua.lua_rawseti(L, -2, Number(key) + 1);
				else lua.lua_setfield(L, -2, to_luastring(key));
			}
		}
	};
	const method = (name, fn) => {
		lua.lua_pushjsfunction(L, () => {
			let result, error;
			try { tick(); result = fn(); } catch (caught) { error = caught.message || 'Script API failed'; }
			if (error) return lauxlib.luaL_error(L, to_luastring('%s'), to_luastring(error.slice(0, scriptLimits.logBytes)));
			return result ?? 0;
		});
		lua.lua_setfield(L, -2, to_luastring(name));
	};
	const field = (index, key, read) => {
		index = lua.lua_absindex(L, index);
		lua.lua_pushstring(L, to_luastring(key)); lua.lua_rawget(L, index);
		const value = read(-1);
		lua.lua_pop(L, 1);
		return value;
	};
	const array = (index, length, read) => {
		if (lua.lua_type(L, index) !== lua.LUA_TTABLE) fail('Expected a rectangular matrix');
		index = lua.lua_absindex(L, index);
		let count = 0;
		lua.lua_pushnil(L);
		while (lua.lua_next(L, index)) {
			const key = lua.lua_tonumber(L, -2);
			if (!lua.lua_isinteger(L, -2) || key < 1 || key > length || ++count > length) fail('Matrix must exactly match the destination');
			lua.lua_pop(L, 1);
		}
		if (count !== length) fail('Matrix must exactly match the destination');
		return Array.from({ length }, (_, i) => {
			lua.lua_rawgeti(L, index, i + 1);
			const value = read(-1);
			lua.lua_pop(L, 1);
			return value;
		});
	};
	const typedCell = index => {
		if (lua.lua_type(L, index) !== lua.LUA_TTABLE) fail('Computed cells require a kind tag; numbers require decimal strings');
		index = lua.lua_absindex(L, index);
		const kind = field(index, 'kind', string);
		const key = kind === 'number' ? 'decimal' : kind === 'text' ? 'text' : kind === 'boolean' ? 'value' : null;
		const cell = { kind };
		if (key) cell[key] = field(index, key, at => {
			if (kind !== 'boolean') return string(at);
			if (lua.lua_type(L, at) !== lua.LUA_TBOOLEAN) fail('Expected a boolean cell value');
			return lua.lua_toboolean(L, at);
		});
		let count = 0;
		lua.lua_pushnil(L);
		while (lua.lua_next(L, index)) {
			const name = string(-2);
			if ((name !== 'kind' && name !== key) || ++count > 2) fail('Unexpected computed cell field');
			lua.lua_pop(L, 1);
		}
		return scriptValueToRaw(cell);
	};
	const checkRange = range => {
		const sheet = access.sheets[range?.sheet];
		if (!sheet || !Number.isSafeInteger(range.sheet) || ![range.r0, range.c0, range.r1, range.c1].every(Number.isSafeInteger)
			|| range.r0 < 0 || range.c0 < 0 || range.r1 < range.r0 || range.c1 < range.c0
			|| range.r1 >= sheet.rows || range.c1 >= sheet.cols) fail('Range extends outside the sheet');
		return { ...range };
	};
	const chargeRange = range => {
		cells += (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
		if (cells > scriptLimits.transferCells) fail('Script cell transfer limit exceeded');
	};
	const rangeHandle = input => {
		const range = checkRange(input), rows = range.r1 - range.r0 + 1, cols = range.c1 - range.c0 + 1;
		push({ rows, cols, sheet: access.sheets[range.sheet].name, address: `${cellLabel(range.r0, range.c0)}:${cellLabel(range.r1, range.c1)}` });
		for (const computed of [false, true]) {
			method(computed ? 'read_values' : 'read_raw', () => {
				chargeRange(range); push(access.read(range, computed)); return 1;
			});
			method(computed ? 'write_values' : 'write_raw', () => {
				chargeRange(range);
				const matrix = array(2, rows, index => array(index, cols, computed ? typedCell : string));
				for (const row of matrix) for (const raw of row) {
					const size = to_luastring(raw).length;
					if (size > scriptLimits.cellBytes) fail('Script cell limit exceeded');
					transferred += size;
				}
				if (transferred > scriptLimits.transferBytes) fail('Script transfer limit exceeded');
				access.write(range, matrix);
			});
		}
		return 1;
	};
	const sheetHandle = index => {
		const sheet = access.sheets[index];
		if (!sheet) fail('Unknown sheet');
		push({ name: sheet.name, rows: sheet.rows, cols: sheet.cols });
		method('range', () => {
			const match = string(2, 128).toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
			if (!match) fail('Use an absolute cell or ascending rectangle, such as A0:B2');
			return rangeHandle({ sheet: index, r0: Number(match[2]), c0: columnIndex(match[1]), r1: Number(match[4] ?? match[2]), c1: columnIndex(match[3] ?? match[1]) });
		});
		return 1;
	};
	try {
		// Open libraries selectively, then remove unapproved functions from the original tables
		// as well (string methods resolve through the library's original metatable).
		for (const [name, open, allowed] of [
			['_G', lualib.luaopen_base, ['_G', '_VERSION', 'assert', 'error', 'ipairs', 'pairs', 'next', 'select', 'tonumber', 'tostring', 'type']],
			['math', lualib.luaopen_math, ['abs', 'ceil', 'floor', 'sqrt', 'log', 'exp', 'sin', 'cos', 'tan', 'max', 'min', 'pi', 'huge', 'type', 'tointeger']],
			['string', lualib.luaopen_string, ['len', 'sub', 'lower', 'upper']],
		]) {
			lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
			const remove = [];
			lua.lua_pushnil(L);
			while (lua.lua_next(L, -2)) {
				const key = to_jsstring(lua.lua_tostring(L, -2));
				if (!allowed.includes(key)) remove.push(key);
				lua.lua_pop(L, 1);
			}
			for (const key of remove) { lua.lua_pushnil(L); lua.lua_setfield(L, -2, to_luastring(key)); }
			if (name === 'string') for (const key of allowed) {
				lua.lua_getfield(L, -1, to_luastring(key));
				const native = lua.lua_tocfunction(L, -1); lua.lua_pop(L, 1);
				method(key, () => { string(1); return native(L); });
			}
			lua.lua_pop(L, 1);
		}
		lua.lua_newtable(L);
		method('sheet', () => {
			const name = string(1);
			return sheetHandle(access.sheets.findIndex(sheet => sheet.name.toLowerCase() === name.toLowerCase()));
		});
		method('active_sheet', () => sheetHandle(access.activeSheet));
		method('sheets', () => {
			lua.lua_newtable(L);
			access.sheets.forEach((_, i) => { sheetHandle(i); lua.lua_rawseti(L, -2, i + 1); });
			return 1;
		});
		method('selection', () => {
			if (!access.selection) fail('No sheet selection was captured; use an explicit range');
			return rangeHandle(access.selection);
		});
		method('named', () => {
			if (!access.resolve) fail('Persistent reference resolution is unavailable');
			return rangeHandle(access.resolve(string(1)));
		});
		method('log', () => {
			const message = string(1, scriptLimits.logBytes);
			logBytes += to_luastring(message).length;
			if (logs.length >= scriptLimits.logMessages || logBytes > scriptLimits.logBytes) fail('Script diagnostic limit exceeded');
			logs.push(message);
		});
		lua.lua_setglobal(L, to_luastring('df'));
		let budget = scriptLimits.instructions / 1000;
		lua.lua_sethook(L, state => {
			if (--budget <= 0) lauxlib.luaL_error(state, to_luastring('Script instruction limit exceeded'));
		}, lua.LUA_MASKCOUNT, 1000);
		const status = lauxlib.luaL_loadbufferx(L, bytes, bytes.length, to_luastring('workbook.lua'), to_luastring('t'));
		if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
			const error = lua.lua_tostring(L, -1);
			throw new Error(error ? new TextDecoder().decode(error.subarray(0, scriptLimits.logBytes)) : 'Lua script failed');
		}
		return { logs };
	} finally { lua.lua_close(L); }
}

// The worker's workbook adapter must validate its result before live publication. This wrapper
// owns only execution lifetime: one reply, watchdog, cancellation, and unconditional termination.
export function runScriptWorker(worker, request, signal) {
	return new Promise((resolve, reject) => {
		let settled = false, timer;
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', cancel);
			worker.onmessage = worker.onerror = worker.onmessageerror = null;
			worker.terminate();
			error ? reject(error) : resolve(result);
		};
		const cancel = () => finish(new DOMException('Script cancelled', 'AbortError'));
		if (signal?.aborted) { cancel(); return; }
		signal?.addEventListener('abort', cancel, { once: true });
		timer = setTimeout(() => finish(new Error('Script execution timed out')), scriptLimits.timeoutMs);
		worker.onmessage = ({ data }) => {
			if (data && Object.keys(data).length === 1 && Object.hasOwn(data, 'result')) finish(null, data.result);
			else finish(new Error(typeof data?.error === 'string' ? data.error : 'Invalid script worker response'));
		};
		worker.onerror = event => finish(new Error(event.message || 'Script worker failed'));
		worker.onmessageerror = () => finish(new Error('Invalid script worker message'));
		try { worker.postMessage(request); } catch (error) { finish(error); }
	});
}
