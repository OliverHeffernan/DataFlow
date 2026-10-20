# Keyboard reference

DataFlow translates Neovim's motion vocabulary into two contexts. It is not an embedded Neovim instance or a complete implementation of its editor, plugins, options, or Ex language.

## Two contexts keep the same keys useful

- **Sheet normal** (`-- NORMAL --`): a character is a cell, a line is a row, and the buffer is the sheet. `hjkl` moves between cells.
- **Formula normal** (`-- FORMULA NORMAL --`): press `Enter` on a cell. `h/l` move through its text; plain `j/k` (including counts) leave to sheet NORMAL and move down/up a cell. `gj/gk`, arrows, operators and visual selections retain text-line movement.
- **Insert**: `i/a` insert before/after the text cursor; `I/A` insert at the first nonblank/end of its text line. From the sheet these edit the selected cell, not the first/last cell in the row. Double-clicking a cell also starts insert.
- `Esc` cancels a pending command or visual selection, or commits insert and returns to formula normal. `Esc` again in formula normal returns to the sheet. `Ctrl-[` and `Ctrl-c` also escape. `Enter` commits insert directly to sheet NORMAL, on the same cell. `Shift-Enter` inserts a newline.

Type directly with the spreadsheet focused; there is no bottom input field. The read-only footer displays typed commands, pending keys and messages. It shows contextual shortcuts, including valid continuations after a prefix and Lua mapping descriptions. Click a cell or the footer to return focus to the workspace. Native inputs, file dialogs and editable controls receive their own keys. Uppercase keys mean Shift plus the letter. `<C-x>` below means Ctrl-x, and `<CR>` means Enter.

### Multiple sheets in one file

Each `.dflo` file is a workbook. The footer lists its numbered sheets and highlights the active one. Type a command followed by Enter:

| Command | Action |
| --- | --- |
| `:sheetnew [name]` | Create and switch to a blank 50 × 50 sheet; omitted names use the next available Sheet1, Sheet2, … |
| `:sheetrename name` | Rename the current sheet and update references throughout the workbook |
| `:sheet name` / `:sheet 2` | Switch by name or one-based sheet number |
| `:sheetnext` / `:sheetprev` | Switch to the next/previous sheet, wrapping at the ends |
| `:sheets` / `:sheet` | List numbered sheets; `*` marks the active sheet |
| `:sheetduplicate [name]` | Copy the current sheet's stored formulae and styles into a new sheet; explicit sheet references still point to their original targets |
| `:sheetmove 2` | Move the current sheet to this one-based position |
| `:sheetdelete [name or number]` | Delete the target (current sheet if omitted), only if it is empty, unstyled, and unreferenced |
| `:sheetdelete! [name or number]` | Delete even a populated/referenced sheet; references to it become `#REF!`. Undo restores the sheet and its references together. The last sheet cannot be deleted |

Names are case-insensitively unique and may contain spaces: `:sheetnew Sales 2026`, then `:sheet Sales 2026`. Use the whole name without surrounding quotes in commands. All-digit switch/delete arguments mean sheet numbers. Invalid names, targets, and positions leave the workbook unchanged.

Each sheet retains its cursor position, dimensions, data and styling while switching. Undo/redo is chronological across the workbook: `u` undoes the latest edit regardless of the visible sheet. Sheet creation, renaming, reordering, deletion and `:clear` are undoable; references and workbook/sheet metadata restore together. Switching sheets and moving the cursor do not create history entries. Undo keeps the visible sheet/cursor where possible, clamping to restored dimensions. History is session-only, retaining at most 50 snapshots with a 64 MiB estimated serialized-data budget (a single oversized current state remains usable). Opening a workbook starts new history.

Sheet-switch commands reset transient navigation marks, jumps, searches, and visual selections. Persistent workbook marks remain available on every sheet. Registers, macros, mappings, and repeat edits remain session-wide; yanking on one sheet and putting on another works. `:clear` clears only the current sheet and resets transient navigation, not workbook undo history.

`:w` saves **all sheets**, their names, styles, and the active sheet; `:wa` saves the workbook as another file. Browser saves download the same workbook format as desktop saves. `:o` still reads old single-sheet `{rows, styles}` `.dflo` files and rows-only JSON arrays (including `.heff` files); each becomes Sheet1 with default styling where absent. Saving upgrades to the workbook format; older app versions do not understand new workbook files. Invalid files do not replace the current workbook.

### Cross-sheet formula references

Unqualified references still address the sheet containing the formula. Add a sheet name and `!` to read another sheet, using the existing zero-based row labels:

```text
=Sheet2!A0 + A0
=SUM('Sales 2026'!B0:B5)
=FILTER('Sales 2026'!A0:C5, 'Sales 2026'!C0:C5 > 0)
=Sheet2![-1]{-2}
=CHART().bar().series('Sales 2026'!B0:B5).x('Sales 2026'!A0:A5)
```

Bare sheet names use letters, digits, and underscores, starting with a letter or underscore. Single-quote other names; double an apostrophe inside a name (`'O''Brien'!A0`). Names match case-insensitively. A range's prefix applies to both endpoints (`Sheet2!A0:B5`); ranges spanning several sheets are not supported. Relative coordinates use the formula cell's row/column as origin on the target sheet; calculations inside those coordinates also read that target sheet.

Cross-sheet references support arithmetic, functions, ranges, spill sources/children, and charts, and recalculate when their source changes. Missing sheets or out-of-bounds references produce `#REF!`; circular dependencies are detected across sheets, including chart/spill dependencies. Renaming a sheet rewrites its references without changing quoted text or chart titles. Deleting a sheet invalidates its references permanently, even if a new sheet later reuses its name. Formula references are colored; foreign references do not outline unrelated cells in the current grid. F4 preserves the sheet qualifier when toggling absolute/relative notation.

Every sheet command can be mapped with the existing Lua API. Include `<CR>` to run immediately; omit it to leave a command ready for a name:

```lua
vim.keymap.set({ "n", "f" }, "]s", ":sheetnext<CR>", { desc = "Next sheet" })
vim.keymap.set({ "n", "f" }, "[s", ":sheetprev<CR>", { desc = "Previous sheet" })
vim.keymap.set("n", "<Leader>sn", ":sheetnew<CR>", { desc = "New sheet" })
vim.keymap.set("n", "<Leader>sr", ":sheetrename ", { desc = "Rename sheet" })
vim.keymap.set("n", "<Leader>ss", ":sheet ", { desc = "Switch sheet" })
```

### Persistent marks name inputs and ranges

In sheet NORMAL, `ma` marks the current cell; in sheet VISUAL, `ma` marks the selected rectangle. Backtick followed by `a` jumps to its top-left cell, including on another sheet; `'a` jumps to the first nonblank cell in that row. Ctrl-o / Ctrl-i returns through these cross-sheet jumps. `g` before either mark motion omits the jump-list entry. Visual/operator ranges cannot cross sheets.

Long names use the same registry and formula syntax:

```text
:mark tax_rate B0
:mark expenses B1:B8
:mark source 'Sales 2026'!A0:C8
:markgoto expenses
:marks
:markrename tax_rate vat_rate
:delmarks expenses
:delmarks! expenses
```

Omit the absolute reference to use the current cell/visual rectangle. Names are workbook-wide identifiers (`[A-Za-z_][A-Za-z0-9_]*`), case-insensitively unique; `a` and `A` are the same mark, unlike Neovim's local/global distinction. Backticks distinguish marks from coordinates and function names, so `A0` and `SUM` are valid mark names. There is no sheet-qualified mark namespace. Resetting an existing static mark deliberately retargets its formula consumers; a dataset cannot be replaced this way.

```text
=`tax_rate * B3
=SUM(`expenses)
=FILTER(`source, `source > 0)
```

A cell mark reads a scalar or its source's complete shaped spill; an explicitly marked rectangle (even `B0:B0`) reads displayed elements within its bounds. Marks are fixed rectangles, not formula definitions. They share existing precision, lazy `IF`/`IFERROR`, cross-sheet calculation and circular-reference detection. F4 leaves named references named; completion after a backtick inserts a mark without parentheses. Named and ordinary references to the same visible rectangle share highlighting; foreign references do not outline unrelated cells.

Rename rewrites real reference tokens throughout the workbook, including chart arguments and calculations inside relative coordinates, but not strings or chart labels. Deleting a referenced mark requires `:delmarks!`; old references become `#REF!` and do not revive if that name is recreated. Ordinary deletion removes only the definition, never its cell data. Undo restores definitions and rewritten formulae together.

Static marks move when rows/columns are inserted before them, grow when inserted inside them, and shrink when part is deleted. Deleting every marked cell leaves an invalid `#REF!` definition rather than silently selecting another cell. Clearing values preserves static marks. Sheet rename keeps their targets; forced sheet deletion invalidates consumers and removes owned definitions. Duplicating a sheet copies its cells/metadata, not the workbook-wide mark definitions: named references still target their original marks.

### Datasets add bounded records and a header schema

Select a header and its existing records, then use `:dataset sales`, or supply `:dataset sales A0:B2`. Each header must be a literal identifier, unique ignoring case within that dataset; formula/blank/duplicate headers are rejected. Different datasets may reuse column names but cannot overlap. Their columns stay fixed until the definition is removed. The header cells remain ordinary stored cells, protected from raw editing; use `:datasetcolumnrename sales amount total` to rename a header and rewrite its column references atomically.

```text
=SUM(`sales.amount)
=FILTER(`sales, `sales.amount > 10)
=CHART().bar().series(`sales.amount).x(`sales.item)
:datasetappend sales
:datasetappend sales 3
```

The bare dataset returns only its body rectangle; `.amount` returns that body column, never the header. Matching is case-insensitive. A header-only dataset has zero records; trying to materialize its body gives `#CALC!` (catchable with `IFERROR`), rather than inventing a row of zeroes.

Committing nonblank content immediately below the body expands it through the contiguous rows written in that edit, only when all destinations are confined to its columns. An explicit multirow put retains trailing blank records. Growth requires every newly included cell to have been blank and not spill-covered; it cannot absorb existing data, another dataset, an unwritten gap, or cells beyond the finite sheet. Distant edits and edits spanning outside the columns do not grow the definition. Unchanged/blank-only writes do not append records; `:datasetappend` explicitly includes blank trailing rows, subject to the same blank/bounds checks. Clear body cells without removing records; delete body rows to shrink it.

Row insertion/deletion within the body changes its extent. Inserting before its header or columns shifts the entire definition. Deleting the header, deleting a dataset column, or inserting inside its columns is rejected; remove the definition first to reshape the schema. Array spills cannot originate inside or spill into datasets. Scalar formulas remain supported; formulas outside a dataset can read and spill its body. Nothing auto-copies formulas or styles into new records. There is no record validation, sorting/filtering in place, grouping, or totals-row behavior.

`:delmarks sales` removes the dataset definition but leaves the grid intact (requires `!` when referenced). `:clear` removes datasets on the cleared sheet and invalidates their consumers, because their header schemas are gone. Dataset creation, growth, schema rename, deletion and structural edits each undo with their cell/formula changes. Saving writes v3 `.dflo` with marks plus existing workbook/sheet metadata; old single-sheet and v1/v2 workbooks remain readable, but older DataFlow versions cannot read v3. History, navigation marks, jumps and formula-text marks are not saved.

For other features, `SheetManager.resolveMark(name, column?)` returns a detached `{name, sheetName, mode: 'cell'|'range', r0, c0, r1, c1, height, width}` descriptor. `describeDataset(name)` adds `header`, ordered `columns: [{name, col}]`, and `rowCount`. Bounds are inclusive, zero-based, finite; an empty body has `height: 0` and `r1: r0 - 1`. These methods resolve metadata, not values, and do not mutate history or navigation. Staged writers can call the pure `prepareMarkWrites(writes)` against untouched rows after validating the payload and current spills, then publish returned marks with the writes and one caller-owned history commit. It is not itself a general mutation API.

### Formula insert assistance

- **Ctrl-h/j/k/l** starts a reference next to the edited cell, using DataFlow-relative notation (e.g. `[-1]{}`). Consecutive shortcuts adjust the same reference. Typing or moving the text caret ends that reference session.
- These reference shortcuts apply in **INSERT**, not sheet/formula NORMAL. If only some directions fail, check custom `i` mappings in `init.lua` and OS/window-manager/browser shortcuts. DataFlow prevents browser defaults for key events it receives, but cannot override shortcuts intercepted before they reach the app. For an alternative, map `vim.keymap.set("i", "<C-Left>", "<C-h>")` and `vim.keymap.set("i", "<C-Right>", "<C-l>")`, then reload your config.
- **Shift-h/j/k/l** extends the active reference into a rectangular range with that reference as a fixed anchor. Start with Ctrl-direction first; Ctrl-direction can then also move the range endpoint. Ranges normalize to top-left/bottom-right and clamp at sheet edges. Outside an active reference session, shifted letters remain text (including in function names such as HSTACK and FILTER).
- Absolute references, relative/calculated references and ranges get matching colors in the formula text and grid. Repeated references to the same region share colors; quoted strings are ignored. Highlights disappear on returning to the sheet.
- **Tab** completes a function prefix with parentheses, including `CHART()` builder methods after a dot (e.g. `.se` → `.series()`). **Up/Down** selects suggestions; Enter always commits rather than accepting a completion. Signature help highlights the active argument of the innermost supported function or chart method.
- **F4** toggles the reference under or immediately before the caret between ordinary cell coordinates and `[]{}` relative notation. It works in formula normal and insert. Use Fn-F4 if the OS reserves F4, or remap `<F4>` in Lua.
- Array formulas spill into empty cells. The selected spill has a dashed boundary and source label. `i/a/I/A` or Enter on a spill child edits the source, not an independent output. Error explanations appear in the footer and cell tooltip. See the [formula reference](../README.md#nested-formulas-and-dynamic-arrays).

## Motion coverage

Counts precede a motion: `12j`, `3w`, `2f,`. `0` is a motion unless it is part of a count. Counts also apply to arrow keys. Boundaries clamp to existing cells/text; motions do not create data or wrap `h/l` across rows.

| Keys | Sheet translation | Formula translation |
| --- | --- | --- |
| `h j k l`, arrows, Space, Backspace, Ctrl-h/j/n/p | Adjacent cell; vertical movement keeps the column | Plain `j/k` in normal leave to adjacent sheet cells; other keys and operator/visual motions stay in text |
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
- **Sheet-only `ic` (cell formula)** selects the current cell, including when blank: `yic` yanks its complete raw formula/text, `dic` clears it without shifting cells, and `cic` clears it and enters INSERT. `vic` selects it in visual mode.
- **Sheet-only `iv` (cell value)** uses the evaluated/displayed value instead: `yiv` on `=2+3*4` copies `14`, while `yic` copies `=2+3*4`. `div` and `civ` clear/change the underlying cell but put its evaluated value in the register. `viv` selects values for a subsequent operator. The value object is unavailable on chart cells; counted or extended value selections containing any chart are rejected without changing cells or the register. Use `ic` to copy a chart's builder.
- Both objects accept counts for consecutive cells to the right, including blanks, clamped at the row edge (`y3ic`, `y3iv`); change edits the first cell. Neither object is available in formula NORMAL.
- Formula-only delimiter objects: `i/a` followed by `(`, `)`, `b`, `[`, `]`, `{`, `}`, `B`, `<`, `>`, `'`, `"`, or a backtick. `it/at` select paired tag content/tags. Counts choose enclosing pairs or successive words/paragraphs.

### Editing, registers and navigation history

`x/X` deletes forward/backward within the current row/line; `s` changes cells/characters; `S` changes rows/lines; `C/D` changes/deletes through row/line end. `o/O` opens a row below/above and edits its first cell; in formula normal it opens a text line. `r{char}` replaces formula characters.

`yic` and `yiv` yank the selected cell's raw formula/text or evaluated value into the unnamed register and system clipboard, without moving or editing it. `yf{char}` remains operator + find in both normal contexts.

`p/P` puts the unnamed register. Character/block sheet ranges overwrite existing cells from the selected cell, clipping at sheet edges; linewise registers insert complete rows below/above. Text registers insert into formula text. Copied formulae are literal; put does not rewrite relative references or copy styling. `:yankcell` and `:yankvalue` copy cell formulae or evaluated values, including a selection. Formula editing and row/column edits participate in `u` / Ctrl-r undo/redo (50 snapshots). `.` repeats an edit, and `qa … q`, `@a`, `@@` record/replay session macros; recursive replay is blocked.

`ma` in the sheet sets a persistent cell/range mark as described above. In formula NORMAL it still sets a session-only text mark local to that cell; these text coordinates do not track text insertions/deletions and reset when switching sheets. Special navigation marks remain transient, separate from persistent reference definitions. Ctrl-o / Ctrl-i (Tab) traverse jumps, including across sheet/formula contexts. `g;` / `g,` traverse changes. Opening or clearing a sheet resets transient navigation; only opening resets workbook undo history. Registers/macros/mappings remain available in the session.

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
vim.opt.timeoutlen = 1000 -- milliseconds to wait for the next mapping key (default: 500)

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

Use **`vim.keymap.group(modes, prefix, label)`** (a DataFlow extension) to label a custom mapping branch:

```lua
vim.keymap.group({ "n", "f" }, "<Leader>", "Actions")
vim.keymap.group({ "n", "f" }, "<Leader>s", "Sheets")
vim.keymap.set({ "n", "f" }, "<Leader>sn", ":sheetnew<CR>", { desc = "New sheet" })
```

With a Space leader, the helper shows `Space Actions …`, then `s Sheets …` after Space, then `n New sheet` after Space s. Labels follow the same modes and leader/localleader expansion as mappings; define the leader first. Labels are display-only: they do not bind keys, change prefix timeouts or fallback, or create branches without enabled child mappings. Unlabelled branches still show `…`. If a prefix also runs a command, that command's description takes precedence. Repeating a group declaration replaces its label; remove the declaration and reload to clear it.

Key notation: `<Esc>`, `<CR>` / `<Enter>`, `<S-CR>`, `<BS>`, `<Del>`, `<Tab>`, `<Space>`, `<lt>`, `<Nop>`, `<F4>`, arrows, Home/End, PageUp/PageDown, `<C-x>`, `<C-S-x>` and Shift-arrows. Use the shown capitalization; Ctrl-letter names use lowercase. Leader/localleader expand when a mapping is defined. Escape always cancels and cannot be remapped. Mapping `desc` values appear in the shortcut bar, and `<Nop>` mappings hide their disabled default shortcuts.

**Invalid shortcuts:** In sheet/formula NORMAL, visual and operator-pending modes, a key that cannot continue a buffered mapping discards the entire attempt, including any pending count/operator, and displays `Invalid shortcut` in the command field. No shorter mapping runs and no buffered keys become standalone commands. For example, `<Space>s>` does nothing when only `<Space>sn` is mapped. Insert mode and the `:`/search command line retain literal-text fallback on mismatch so ordinary typing still works.

**Mapping timeout:** `vim.opt.timeoutlen` sets the wait after each mapping-prefix key in milliseconds (default **500**). It accepts an integer from 0 to 2147483647; 0 cancels without waiting for another key. On timeout, the whole buffered sequence is discarded: no shorter mapping runs, no buffered characters become standalone commands or inserted text, and any pending count/operator is cancelled. For example, `<Leader>s` waiting for `<Leader>sn` does nothing when it times out. This also applies in insert mode (a timed-out `j` from a `jk` mapping is not inserted). Built-in commands such as `g` and `d` do not time out unless waiting on a custom mapping.

Reload is atomic: syntax/runtime/API errors keep the previous mappings, group labels and timeout active and report an error in the command field. Omitting `vim.opt.timeoutlen` restores the 500 ms default on reload. Configurations cannot access OS, filesystem, package loading, JavaScript, debug, coroutines, dynamic Lua loading, or protected calls. Limits: 128 KiB source, 1,000 mappings and group labels combined, 128-character LHS, 4,096-character RHS, an instruction budget and a 2-second worker timeout. Use this as a keymap configuration API, not a general-purpose Lua automation environment.

## Migration and explicit exclusions

| Old shortcut | Replacement / reason |
| --- | --- |
| `H/L` formula movement | `Enter`, then `h/l`; `H/M/L` now mean viewport rows |
| Bare `c` clears a cell | `s` changes a cell, or `cc` changes its row; `c` waits for a motion |
| `gh/gl` row edges | `0/$`, or `^/g_` for populated edges |
| `I` edits first cell | `0i`; `I` edits the selected formula's first nonblank |
| `gA3<CR>` cell jump | `:goto A3<CR>` (also supports AA, AB, … labels) |
| `yf/ys` | `yic` / `yiv`, or `:yankcell` / `:yankvalue`; `yf{char}` is a real operator + find |
| `oh/ol`, `dc` | `:insertleft` / `:insertright`, `:deletecol` |
| `oj/ok` | `o/O`, inserting a row and entering insert |
| `Pj/Pk/Ph/Pl` gap paste | `:putbelow` / `:putabove` / `:putleft` / `:putright`; `P` is put-before |

Coverage follows the families in [Neovim motion.txt](https://neovim.io/doc/user/motion.html), with the spreadsheet translations above. It does **not** claim byte-for-byte Neovim parity. Searches use JavaScript Unicode regular expressions, not Vim regex syntax or search offsets. Text motions count Unicode code points, not grapheme clusters or tab-expanded screen columns. Formula section/method/comment/tag/bracket navigation is lexical, without language parsing, nroff macros, configurable matchpairs, or matchit. Sheet marks are persistent workbook references; formula text/special navigation marks are session-local. Uppercase marks do not open other files and numbered ShaDa marks are unavailable.

Definition/declaration and tag motions (`gd/gD`, Ctrl-], `g]`, `g<C-]>`, Ctrl-t), file/include navigation (`gf`, `gF`, Ctrl-w variants, `[i/]i`), folds (`zj/zk`), diff (`[c/]c`), diagnostics (`[d/]d`), quickfix/location lists and Neovim window/buffer switching have no backing subsystem. Use the sheet commands above to switch workbook sheets. Unsupported motions are not silently redirected to unrelated cells. Neovim Select mode, named/numbered registers, arbitrary operators (`gq`, `=`, shell filters, folds), Ex ranges/scripts and full insert/replace-mode command parity are outside this implementation.

Run `npm test` for the keyboard/Lua contract tests, `npm run build` for the frontend, and `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` for native config-file creation/reload tests.
