export const configTemplate = `-- DataFlow init.lua (Lua 5.3). Reload with :source.
-- n = sheet normal, f = formula normal, i = insert, x = visual, o = operator-pending.
vim.g.mapleader = " "
vim.keymap.set({ "n", "f", "x" }, "<Leader>h", "0")
vim.keymap.set({ "n", "f", "x" }, "<Leader>l", "$")
vim.keymap.set("i", "jk", "<Esc>")
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
