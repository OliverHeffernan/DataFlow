export const defaultTimeoutlen = 500;

export const configTemplate = `-- DataFlow init.lua (Lua 5.3). Reload with :source.
-- n = sheet normal, f = formula normal, i = insert, x = visual, o = operator-pending.
vim.g.mapleader = " "
vim.opt.timeoutlen = ${defaultTimeoutlen} -- milliseconds before discarding an incomplete mapping
vim.keymap.set({ "n", "f", "x" }, "<Leader>h", "0")
vim.keymap.set({ "n", "f", "x" }, "<Leader>l", "$")
vim.keymap.set("i", "jk", "<Esc>")
-- Sheet commands work in mappings too. Omit <CR> to type a name before running.
-- Label custom mapping branches without binding a command to the prefix.
-- vim.keymap.group({ "n", "f" }, "<Leader>", "Actions")
-- vim.keymap.group({ "n", "f" }, "<Leader>s", "Sheets")
-- vim.keymap.set({ "n", "f" }, "<Leader>sn", ":sheetnew<CR>", { desc = "New sheet" })
-- vim.keymap.set({ "n", "f" }, "<Leader>sr", ":sheetrename ", { desc = "Rename sheet" })
-- vim.keymap.set({ "n", "f" }, "]s", ":sheetnext<CR>", { desc = "Next sheet" })
-- vim.keymap.set({ "n", "f" }, "[s", ":sheetprev<CR>", { desc = "Previous sheet" })
-- vim.keymap.set("n", "J", "5j", { desc = "Five rows down" })
-- vim.keymap.del("n", "<Leader>h") -- remove a custom mapping
-- vim.keymap.set("n", "Q", "<Nop>") -- disable a default key
`;

export function tokenize(keys) {
	return keys.match(/<(?:C-[^>]+|S-[^>]+|F\d+|Esc|CR|Enter|BS|Del|Tab|Space|lt|Nop|Left|Right|Up|Down|Home|End|PageUp|PageDown)>|[^]/gu)?.map(key => {
		const aliases = { '<Enter>': '<CR>', '<Space>': ' ', '<lt>': '<', '<C-[>': '<Esc>', '<C-m>': '<CR>' };
		return aliases[key] || key;
	}) || [];
}
