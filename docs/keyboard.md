# Keyboard reference

DataFlow translates Neovim's motion vocabulary into two contexts. It is not an embedded Neovim instance or a complete implementation of its editor, plugins, options, or Ex language.

## Two contexts keep the same keys useful

- **Sheet normal** (`-- NORMAL --`): a character is a cell, a line is a row, and the buffer is the sheet. `hjkl` moves between cells.
- **Formula normal** (`-- FORMULA NORMAL --`): press `Enter` on a cell. Motions now operate on its literal formula text, including multiline text. `hjkl` moves by Unicode code point or text line, never to another cell.
- **Insert**: `i/a` insert before/after the text cursor; `I/A` insert at the first nonblank/end of its text line. From the sheet these edit the selected cell, not the first/last cell in the row. Double-clicking a cell also starts insert.
- `Esc` cancels a pending command or visual selection, or commits insert and returns to formula normal. `Esc` again in formula normal returns to the sheet. `Ctrl-[` and `Ctrl-c` also escape. `Enter` commits insert rather than inserting a newline; use `Ctrl-j` for a newline.

Type into the bottom command field, or click a cell to focus it. Uppercase keys mean Shift plus the letter. `<C-x>` below means Ctrl-x, and `<CR>` means Enter.

## Motion coverage

Counts precede a motion: `12j`, `3w`, `2f,`. `0` is a motion unless it is part of a count. Counts also apply to arrow keys. Boundaries clamp to existing cells/text; motions do not create data or wrap `h/l` across rows.

| Keys | Sheet translation | Formula translation |
| --- | --- | --- |
| `h j k l`, arrows, Space, Backspace, Ctrl-h/j/n/p | Adjacent cell; vertical movement keeps the column | Adjacent code point/line; vertical movement remembers the preferred column, including sticky `$` |
| `0`, Home | First column, including blanks | First character |
| `^` | First nonblank cell in this row | First nonblank character |
| `$`, End | Final allocated column, **not** last populated cell | Last character; a count also moves down count − 1 lines |
| `g_` | Last populated cell; count − 1 rows down | Last nonblank character; count − 1 lines down |
| `[count]\|` | One-based column number | One-based code-point column |
| `g0`, `g^`, `g$`, `gm`, `[count]gM` | Visible left edge, first populated visible cell, visible right edge, visible middle, percentage of row width | Equivalent positions in the horizontally scrolled, unwrapped formula bar |
| `g<End>` | Last populated visible cell | Last nonblank visible character |
| `gj`, `gk`; `g` + Up/Down/Home/End | Row/visible-edge movement | Text line/visible-edge movement; formula lines do not soft-wrap |
| `+`, `-`, `_` | Next/previous/count − 1 row, first populated cell | Corresponding text line, first nonblank character |
| `gg`, `G`, `[count]gg`, `[count]G`, Ctrl-Home | First/last/specified row, first populated cell | First/last/specified line, first nonblank character |
| Ctrl-End | Last/specified row, last column | Last/specified line, last character |
| `[count]%` | Percentage through allocated rows | Percentage through text lines |
| `[count]go` | One-based cell offset in row-major order | One-based UTF-8 byte offset |
| `w b e ge` | Next occupied cell, previous occupied cell, next cell end, previous cell end | Neovim-style word starts/ends; letters, digits and `_` are distinct from punctuation |
| `W B E gE` | Starts/ends of contiguous occupied runs, separated by blank cells or row boundaries | Whitespace-delimited WORD starts/ends |
| `f{char}`, `F{char}` | Next/previous cell in this row containing the character | Next/previous occurrence in the text line |
| `t{char}`, `T{char}` | Cell just before/after the target cell | Character just before/after the target character |
| `;`, `,` | Repeat last find/till, same/opposite direction | Same |
| `(`, `)` | Previous/next occupied run | Previous/next sentence, delimited by `.`, `!`, `?` and following whitespace |
| `{`, `}` | Previous/next blank-row separator | Previous/next empty-line paragraph boundary |
| `[[`, `]]`; `[]`, `][` | Previous/next populated block start; previous/next block end | Previous/next column-zero `{`; previous/next column-zero `}` |
| `[m`, `]m`; `[M`, `]M` | Previous/next populated block start/end | Previous/next opening/closing brace (lexical braced-block translation, not a Java parser) |
| `%` without count | Not applicable to cell coordinates; enter formula normal first | Match nested `()`, `[]`, `{}`; match `/* */` under the cursor; cycle C-style `#if/#elif/#else/#endif` |
| `[(`, `[{`, `])`, `]}` | Formula-only | Previous unmatched opening / next unmatched closing delimiter |
| `[*`, `[/`, `]*`, `]/` | Formula-only | Previous C comment start / next C comment end |
| `[#`, `]#` | Formula-only | Previous/next unmatched C-style conditional branch |
| `H M L` | Top/middle/bottom fully visible row, first populated cell | Top/middle/bottom visible formula line, first nonblank character |
| `'a`, `` `a `` | First populated cell of mark's row / exact marked cell | First nonblank of marked line / exact marked character |
| `g'a`, `` g`a `` | Same mark motions without adding a jump | Same |
| `['` / `]'`, `` [` `` / `` ]` `` | Previous/next lowercase marked row / marked cell | Previous/next lowercase marked line / character |
| `''`, two backticks | Location before the last jump | Same, within the current formula |
| `'[`, `']`, `'<`, `'>`, `'^`, `'.` and backtick equivalents | Operator/visual/change positions when set | Operator/visual/last-insert/change positions when set |
| Quote/backtick followed by `(`, `)`, `{`, `}` | Sentence/paragraph translation above | Sentence/paragraph translation above |
| `/pattern<CR>`, `?pattern<CR>`, `n`, `N` | Search literal cell formulae, row-major, wrapping at the sheet edge | Search formula text, wrapping at the text boundary |
| `*`, `#`, `g*`, `g#` | Search selected cell's text; bounded or substring matching | Search word under cursor, bounded or substring matching |
| `gn`, `gN` | Select current/next/previous matching cell | Select complete current/next/previous match; usable after `d/c/y` |
| Mouse click / Shift-click | Select cell / extend rectangular visual selection | Double-click begins formula editing |

`G` counts are **one-based**, as in Neovim: `1G` selects spreadsheet row 0. DataFlow's existing labels and formula references remain zero-based: `:goto C5` selects the displayed C5. `:12` acts like `12G`.

### Operators and text objects

Use `[count]d/c/y[count]{motion}`. Counts multiply (`2d3w` covers six words); doubled operators cover rows/lines (`3dd`, `2y3y`). Exclusive motions exclude their forward endpoint; `e`, `$`, forward finds and `%` include it. `cw/cW` changes through the word end without deleting following whitespace. Exclusive motions ending at column zero exclude the following line; operator-`w` at a line ending preserves its newline.

- On the **sheet**, non-linewise ranges are rectangles. Delete clears their contents, without shifting unrelated cells. Linewise delete removes whole rows, leaving at least one row. Change clears the range and edits its top-left cell; it does not broadcast typed text across the range.
- In **formula normal**, operators act on text, with characterwise, linewise and blockwise registers.
- `v`, `V`, `Ctrl-v` enter character/row/block visual modes. Sheet `v` and Ctrl-v both select rectangles; `V` covers full rows. `o` swaps the active corner, `gv` restores the last selection, and `d/c/y` acts on it. Shift-click also extends a sheet rectangle.
- After an operator, `v/V/Ctrl-v` forces characterwise/linewise/blockwise motion type.
- `iw/aw`, `iW/aW`, `ip/ap`, `is/as` select inner/around word, WORD, paragraph, sentence. In the sheet these mean cell, occupied run, populated block, and occupied run respectively.
- Formula-only delimiter objects: `i/a` followed by `(`, `)`, `b`, `[`, `]`, `{`, `}`, `B`, `<`, `>`, `'`, `"`, or a backtick. `it/at` select paired tag content/tags. Counts choose enclosing pairs or successive words/paragraphs.

### Editing, registers and navigation history

`x/X` deletes forward/backward within the current row/line; `s` changes cells/characters; `S` changes rows/lines; `C/D` changes/deletes through row/line end. `o/O` opens a row below/above and edits its first cell; in formula normal it opens a text line. `r{char}` replaces formula characters.

`p/P` puts the unnamed register. Character/block sheet ranges overwrite existing cells from the selected cell, clipping at sheet edges; linewise registers insert complete rows below/above. Text registers insert into formula text. Copied formulae are literal; put does not rewrite relative references or copy styling. `:yankcell` and `:yankvalue` copy cell formulae or evaluated values, including a selection. Formula editing and row/column edits participate in `u` / Ctrl-r undo/redo (50 snapshots). `.` repeats an edit, and `qa … q`, `@a`, `@@` record/replay session macros; recursive replay is blocked.

`ma` sets a session mark. Formula marks are local to their cell, separate from sheet marks; their text coordinates do not track text insertions/deletions. Sheet marks follow inserted/deleted rows and columns; marks in deleted rows/columns are removed. Marks are coordinates, not persistent spreadsheet references, and undo does not restore mark history. Ctrl-o / Ctrl-i (Tab) traverse jumps, including across sheet/formula contexts. `g;` / `g,` traverse changes. Opening or clearing a sheet resets marks, selections, jumps and undo history. Registers/macros/mappings remain available in the session.

### Scrolling

- Ctrl-e/y scroll a row/line, keeping the cursor visible.
- Ctrl-d/u scroll half a viewport; an explicit count sets the line amount used by later half-page scrolls.
- Ctrl-f/b and PageDown/PageUp scroll pages with a two-line overlap.
- `zz/zt/zb` center/top/bottom the cursor; `z.`, `z<CR>`, `z-` also move to first nonblank.
- `zh/zl` scroll columns/characters; `zH/zL` scroll half a viewport horizontally; `zs/ze` align the cursor with the left/right edge.

Formula scrolling applies to the formula bar, sheet scrolling to the grid. Physical content boundaries limit scrolling.

## Lua keybinding configuration

### Desktop

Run `:configcreate` once. It creates **init.lua in Tauri's app configuration directory** and prints the exact path. Existing files are never overwritten. Typical paths:

- macOS: `~/Library/Application Support/com.oliverheffernan.dataflow/init.lua`
- Linux: `$XDG_CONFIG_HOME/com.oliverheffernan.dataflow/init.lua` (normally `~/.config/...`)
- Windows: `%APPDATA%\com.oliverheffernan.dataflow\init.lua`

Edit that file in your editor. `:config` shows its location, and `:source` / `:configreload` reloads it. Startup loads it automatically; a missing file uses defaults. This is separate from your Neovim configuration.

### Browser

`:configcreate` downloads a template. Edit the file locally, then use `:config` / `:configload` to import it. Valid source is saved in this origin's local storage and loaded on the next visit. After editing the external file, **import it again**; browsers cannot watch it. `:source` reloads the stored copy. Importing an empty file restores defaults.

### Supported API

This is real Lua 5.3, executed by Fengari in a worker, not a line-based Lua parser. Variables, functions, loops, `ipairs`, and string/table/math/utf8 libraries can construct mappings:

```lua
vim.g.mapleader = " "
vim.g.maplocalleader = ","

vim.keymap.set({ "n", "f", "x" }, "<Leader>h", "0")
vim.keymap.set({ "n", "f", "x" }, "<Leader>l", "$")
vim.keymap.set("i", "jk", "<Esc>")
vim.keymap.set("n", "J", "5j", { desc = "Five rows down" })
vim.keymap.set("o", "q", "2w") -- dq deletes two words
vim.keymap.set("n", "<Leader>v", ":yankvalue<CR>")
vim.keymap.del("n", "J")       -- remove a custom mapping, revealing the default
vim.keymap.set("n", "Q", "<Nop>") -- disable a default key
```

Modes: `n` = sheet normal, **`f` = formula normal (DataFlow extension)**, `i` = insert, `x` / `v` = visual, `o` = operator-pending, `c` = command/search entry. Use a mode list to affect both normal contexts. Mapping RHS strings are nonrecursive; callbacks, expressions, recursive maps, buffer options, `vim.cmd`, plugins and the rest of Neovim's Lua API are not supported. Accepted options are `desc`, `silent`, `remap=false`, `noremap=true`.

Key notation: `<Esc>`, `<CR>` / `<Enter>`, `<BS>`, `<Del>`, `<Tab>`, `<Space>`, `<lt>`, `<Nop>`, arrows, Home/End, PageUp/PageDown, `<C-x>` and Shift-arrows. Use the shown capitalization; Ctrl-letter names use lowercase. Leader/localleader expand when a mapping is defined. Prefixes wait 500 ms for more keys; an unmatched prefix falls back to a complete shorter mapping or the original keys. Escape always cancels and cannot be remapped.

Reload is atomic: syntax/runtime/API errors keep the previous mappings active and report an error in the command field. Configurations cannot access OS, filesystem, package loading, JavaScript, debug, coroutines, dynamic Lua loading, or protected calls. Limits: 128 KiB source, 1,000 mappings, 128-character LHS, 4,096-character RHS, an instruction budget and a 2-second worker timeout. Use this as a keymap configuration API, not a general-purpose Lua automation environment.

## Migration and explicit exclusions

| Old shortcut | Replacement / reason |
| --- | --- |
| `H/L` formula movement | `Enter`, then `h/l`; `H/M/L` now mean viewport rows |
| Bare `c` clears a cell | `s` changes a cell, or `cc` changes its row; `c` waits for a motion |
| `gh/gl` row edges | `0/$`, or `^/g_` for populated edges |
| `I` edits first cell | `0i`; `I` edits the selected formula's first nonblank |
| `gA3<CR>` cell jump | `:goto A3<CR>` (also supports AA, AB, … labels) |
| `yf/ys` | `:yankcell` / `:yankvalue`; `yf{char}` is a real operator + find |
| `oh/ol`, `dc` | `:insertleft` / `:insertright`, `:deletecol` |
| `oj/ok` | `o/O`, inserting a row and entering insert |
| `Pj/Pk/Ph/Pl` gap paste | `:putbelow` / `:putabove` / `:putleft` / `:putright`; `P` is put-before |

Coverage follows the families in [Neovim motion.txt](https://neovim.io/doc/user/motion.html), with the spreadsheet translations above. It does **not** claim byte-for-byte Neovim parity. Searches use JavaScript Unicode regular expressions, not Vim regex syntax or search offsets. Text motions count Unicode code points, not grapheme clusters or tab-expanded screen columns. Formula section/method/comment/tag/bracket navigation is lexical, without language parsing, nroff macros, configurable matchpairs, or matchit. Marks are session-local; uppercase marks do not open other files and numbered ShaDa marks are unavailable.

Definition/declaration and tag motions (`gd/gD`, Ctrl-], `g]`, `g<C-]>`, Ctrl-t), file/include navigation (`gf`, `gF`, Ctrl-w variants, `[i/]i`), folds (`zj/zk`), diff (`[c/]c`), diagnostics (`[d/]d`), quickfix/location lists and window/buffer switching have no backing subsystem in this single-sheet app. They are not silently redirected to unrelated cells. Neovim Select mode, named/numbered registers, arbitrary operators (`gq`, `=`, shell filters, folds), Ex ranges/scripts and full insert/replace-mode command parity are outside this implementation.

Run `npm test` for the keyboard/Lua contract tests, `npm run build` for the frontend, and `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` for native config-file creation/reload tests.
