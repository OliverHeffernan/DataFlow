import fengari from 'fengari';
import { tokenize } from './LuaKeybindings.js';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

// Compile in a fresh VM. Nothing is installed until the entire file succeeds.
export function compileConfig(source) {
	if (source.length > 128 * 1024) throw new Error('init.lua exceeds 128 KiB');
	const L = lauxlib.luaL_newstate();
	const mappings = new Map();
	try {
		for (const [name, open] of [['_G', lualib.luaopen_base], ['table', lualib.luaopen_table], ['string', lualib.luaopen_string], ['math', lualib.luaopen_math], ['utf8', lualib.luaopen_utf8]]) {
			lauxlib.luaL_requiref(L, to_luastring(name), open, 1); lua.lua_pop(L, 1);
		}
		// No filesystem, package loader, OS, JS bridge, coroutine, or debug library.
		for (const name of ['dofile', 'loadfile', 'load', 'print', 'collectgarbage', 'pcall', 'xpcall']) {
			lua.lua_pushnil(L); lua.lua_setglobal(L, to_luastring(name));
		}
		const prelude = `
vim = { g = { mapleader = "\\\\", maplocalleader = "\\\\" }, keymap = {} }
local function setKeymap(modes, lhs, rhs, opts, group)
  assert(type(lhs) == "string" and #lhs > 0, "lhs must be a non-empty string")
  assert(type(rhs) == "string", "rhs must be a key sequence, not a callback")
  opts = opts or {}
  for k, v in pairs(opts) do
    assert(k == "desc" or k == "silent" or (k == "remap" and v == false) or (k == "noremap" and v == true), "unsupported keymap option: " .. k)
  end
  assert(opts.desc == nil or type(opts.desc) == "string", "desc must be a string")
  if type(modes) == "string" then modes = { modes } end
  assert(type(modes) == "table", "mode must be a string or list")
  for _, mode in ipairs(modes) do
    assert(mode == "n" or mode == "f" or mode == "i" or mode == "v" or mode == "x" or mode == "o" or mode == "c", "unsupported mode: " .. tostring(mode))
    local function expand(s)
      s = s:gsub("<[Ll]eader>", function() return vim.g.mapleader end)
      return s:gsub("<[Ll]ocal[Ll]eader>", function() return vim.g.maplocalleader end)
    end
    _map(mode, expand(lhs), expand(rhs), opts.desc, group)
  end
end
function vim.keymap.set(modes, lhs, rhs, opts)
  setKeymap(modes, lhs, rhs, opts, false)
end
function vim.keymap.group(modes, lhs, label)
  assert(type(label) == "string" and #label > 0, "group label must be a non-empty string")
  setKeymap(modes, lhs, "", { desc = label }, true)
end
function vim.keymap.del(modes, lhs)
  if type(modes) == "string" then modes = { modes } end
  for _, mode in ipairs(modes) do
    local expanded = lhs:gsub("<[Ll]eader>", function() return vim.g.mapleader end)
    _map(mode, expanded:gsub("<[Ll]ocal[Ll]eader>", function() return vim.g.maplocalleader end), nil)
  end
end
`;
		lua.lua_pushjsfunction(L, state => {
			const mode = to_jsstring(lauxlib.luaL_checkstring(state, 1));
			const lhs = to_jsstring(lauxlib.luaL_checkstring(state, 2));
			const group = lua.lua_toboolean(state, 5);
			const key = `${group ? 'group:' : ''}${mode === 'v' ? 'x' : mode}:${JSON.stringify(tokenize(lhs))}`;
			if (lua.lua_isnil(state, 3)) mappings.delete(key);
			else {
				const rhs = to_jsstring(lauxlib.luaL_checkstring(state, 3));
				if (lhs.length > 128 || rhs.length > 4096 || mappings.size >= 1000) return lauxlib.luaL_error(state, to_luastring('keymap limit exceeded'));
				const desc = lua.lua_isnoneornil(state, 4) ? '' : to_jsstring(lauxlib.luaL_checkstring(state, 4));
				mappings.set(key, { mode: mode === 'v' ? 'x' : mode, lhs: tokenize(lhs), rhs: tokenize(rhs), desc, ...(group ? { group: true } : {}) });
			}
			return 0;
		});
		lua.lua_setglobal(L, to_luastring('_map'));
		let budget = 200;
		lua.lua_sethook(L, state => { if (--budget <= 0) lauxlib.luaL_error(state, to_luastring('init.lua instruction limit exceeded')); }, lua.LUA_MASKCOUNT, 1000);
		for (const code of [prelude, source]) {
			if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring('init.lua')) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
				throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
			}
		}
		return [...mappings.values()];
	} finally { lua.lua_close(L); }
}
