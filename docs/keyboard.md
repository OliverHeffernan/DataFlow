# Keyboard reference

DataFlow translates Neovim's motion vocabulary into two contexts. It is not an embedded Neovim instance or a complete implementation of its editor, plugins, options, or Ex language.

## Two contexts keep the same keys useful

- **Sheet normal** (`-- NORMAL --`): a character is a cell, a line is a row, and the buffer is the sheet. `hjkl` moves between cells.
- **Formula normal** (`-- FORMULA NORMAL --`): press `Enter` on a cell. `h/l` move through its text; plain `j/k` (including counts) leave to sheet NORMAL and move down/up a cell. `gj/gk`, arrows, operators and visual selections retain text-line movement.
- **Insert**: `i/a` insert before/after the text cursor; `I/A` insert at the first nonblank/end of its text line. From the sheet these edit the selected cell, not the first/last cell in the row. Double-clicking a cell also starts insert.
- `Esc` cancels a pending command or visual selection, or commits insert and returns to formula normal. `Esc` again in formula normal returns to the sheet. `Ctrl-[` and `Ctrl-c` also escape. `Enter` commits insert directly to sheet NORMAL, on the same cell. `Shift-Enter` inserts a newline.

Type directly with the spreadsheet focused; there is no bottom input field. The read-only footer displays typed commands, pending keys and messages. It shows contextual shortcuts, including valid continuations after a prefix and Lua mapping descriptions. Click a cell or the footer to return focus to the workspace. Native inputs, file dialogs and editable controls receive their own keys. Uppercase keys mean Shift plus the letter. `<C-x>` below means Ctrl-x, and `<CR>` means Enter.

### Multiple sheets in one file

Each `.dflo` file is a workbook. Each pane's bottom bar shows its sheet name and one-based sheet number / total sheets, such as `1/2`. Type a command followed by Enter:

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

### Recovery without overwriting files

Recovery checkpoints typing even before Escape, independently of undo grouping. `:recover` opens a keyboard-only-capable list: `j/k` or arrows select, Enter restores a detached unsaved copy, `d` opens discard confirmation (Cancel focused), and Escape dismisses. `:recover 2` restores an entry directly; `:recoverdiscard 2` asks to discard it. `:autosave` reports status; `:autosave off/on` changes the session setting; `:autosave now` writes immediately. Recovery runs without a persistent status row; errors and requested status appear on the command line.

Opening/recovering another workbook and supported native exits ask what to do with dirty work. Tab/Shift-Tab cycles the choices, Enter activates the focused choice, and Escape cancels. Native save failures report failure and never trigger downloads. Browser export remains explicit and retains recovery, since download completion cannot be verified. See [recovery behavior and platform limits](../README.md#automatic-recovery), including macOS Dock Quit and browser storage limitations.

### Split windows share data, not navigation

| Command / keys | Action |
| --- | --- |
| `:splitv` | Split the active window left/right; focus the new right window |
| `:splith` | Split the active window top/bottom; focus the new bottom window |
| `Ctrl-w h/j/k/l` | Focus the nearest window left/down/up/right; stay put at an outer edge |
| `:sheet 2` / `:sheet name` | Replace the active window's content with that sheet |
| `:cf` | Replace the active window's content with its sheet's conditional rules |
| `:close` / `Ctrl-w c` | Close the active window, keeping at least one window open |
| `:close!` | Close even with an unapplied rule draft, discarding that window's draft |

Splits nest in either direction. Drag a separator to resize it, or Tab to it and use Left/Right for a vertical separator, Up/Down for a horizontal separator. Escape returns keyboard focus to the workspace. In INSERT, Ctrl-w retains Vim's delete-word meaning; Escape to NORMAL before navigating windows.

Each window keeps its own cursor, scroll, keyboard navigation and rule draft. Several windows can show the same sheet; edits, styling, charts, spills and cross-sheet calculations update every view. Each sheet pane owns its formula bar, format controls and cell diagnostics; inactive panes show the formula and format at their own cursor. Format and completion popups stay inside that pane. The pane's title and sheet count sit at its bottom. Only the mode/command line and contextual shortcut helper are global. Window navigation also works in formula NORMAL, visual selections and rule text NORMAL. Registers, macros and Lua mappings remain shared, including when a macro changes windows.

Changing panes during sheet INSERT commits pending cells and dataset bounds together before moving focus, even between views of the same sheet. Returning retains INSERT, its caret and repeat recording. Unchanged content adds no undo step; rejected edits roll back, stay in the current pane and return to NORMAL. CF text drafts remain unapplied when switching panes.

FORMAT previews use the invoking sheet and range, appearing in every view of that sheet without affecting other sheets. Switching windows or publishing workbook data finishes confirmed FORMAT adjustments on the original target first, with one undo step. An unbound Ctrl-w outside FORMAT text input finishes the session and starts window navigation; explicit Lua FORMAT bindings and text inputs retain their keys. Conditional-rule windows cannot enter cell FORMAT.

Window splits, focus, cursors, scroll and unapplied drafts are session state: they are not saved in `.dflo` or restored by workbook undo. Undo rebinds windows to restored sheets by name and clamps cursors to the restored dimensions; a removed sheet falls back to the first sheet. Opening another workbook keeps the split layout and rebinds its views, but refuses to discard unapplied rule drafts.

For host integrations, `CheckCommand.captureWindowContext()` returns a detached `{windowId, sheetName, cursor: {row, col}, selection: {r0, c0, r1, c1}}` from a sheet window; rule windows reject capture. Capture once before an asynchronous picker/worker. Wrap subsequent **synchronous live publication** in `preserveWindows(publish)` to retain the currently focused window, not the invocation's old focus. The callback owns validation, calculation and history. Detached worker calculations must not use this UI wrapper. Both helpers leave window state outside workbook metadata.

### Conditional rules use the formula builder

Select a target rectangle, then type `:splitv`, `:cf`, and `a` to keep the sheet visible beside a new rule draft. The builder starts with the selected range. It is configuration text in the rules window, not a cell formula:

```text
=CF()
  .name("Overdue tasks")
  .range(A1:D6)
  .when(C{}="Overdue")
  .bg("#40381c")
  .fg("#f4d779")
```

Use Vim text editing in the draft: `i` inserts, `Esc` returns to text NORMAL, and Enter or `Shift-Enter` inserts a newline in INSERT. `Tab` completes builder methods, functions and backtick marks/columns; Up/Down selects suggestions when visible, otherwise moves between text lines while retaining the preferred column. Home/End moves to the current line's edges; Ctrl-Home/End moves to the draft's edges. Ctrl-h backspaces; Ctrl-u and Ctrl-w delete back to the current line's start or previous word. Plain `j/k` remain text-line motions here. `J` joins lines with spacing; `gJ` joins without adding spacing or removing indentation. `>>`/`<<` shifts lines by two spaces, with counts, motion targets and visual selections supported. Draft `u` / Ctrl-r restores text and edit locations, independently of workbook history.

Enter in text NORMAL or `:cf apply` applies the whole draft atomically; errors leave it open. Switching windows retains the draft. Apply or `:cf discard` before replacing it, closing normally, saving or opening a workbook. A draft whose sheet/rule changed in another view must be copied, discarded and reopened rather than overwriting that newer work. This remains DataFlow's custom Vim subset, not Neovim or its plugin/configuration runtime.

In the rule list, `j/k` selects, `a` creates, Enter or `i` edits, `x` deletes, and `J/K` moves a rule later/earlier. `u` / Ctrl-r uses chronological workbook undo/redo. Commands are also available for Lua mappings:

| Command | Action |
| --- | --- |
| `:cf` / `:cf list` | Show the rule list; `list` leaves an unchanged editor |
| `:cf new` | Start a rule using the last sheet selection in that window |
| `:cf edit [id]` | Edit the selected rule, or the displayed numeric ID |
| `:cf apply` / `:cf discard` | Apply or discard the window's draft |
| `:cf delete [id]` | Remove the selected rule or a specific ID |
| `:cf up` / `:cf down` | Move the selected rule earlier/later |

`.range()` takes one local absolute cell/rectangle with zero-based rows. `.when()` evaluates the existing formula language once per target cell, with that cell as the reference origin: `[]{}` reads that cell, `C{}` reads column C on its row, `[-1]{}` reads its left neighbour, and `A0` always reads A0. Cross-sheet coordinates keep the same origin on the target sheet. Backtick marks and dataset columns use the workbook's existing read-only descriptors. No Excel `$` anchoring or separate expression language is introduced.

Omit `.when()` to apply colours across the whole range, equivalent to `.when(TRUE)`. New drafts include an example condition; remove that line for an unconditional rule:

```text
=CF().range(A1:D6).bg("#40381c").fg("#f4d779")
```

The range and at least one colour are still required. An explicitly empty `.when()` is invalid. Omitted conditions save as written, though structural edits may rewrite them as `.when(TRUE)`. Older builds that require `.when()` cannot open rules saved without it; include `.when(TRUE)` when sharing with those builds.

Examples of conditions:

```text
AND(isNumeric([]{}), []{}>100)
AND([]{}<>"", COUNTIF(A1:A20, []{})>1)
SUM(`sales.amount)>`budget
```

Predicates read precise calculated values **before display formatting**, not rendered text or chart labels. Numeric cell text is numeric; blank cells are `""`, so guard numeric thresholds with `isNumeric`. Spill sources and children read their individual displayed elements, retaining numeric precision. Actual errors propagate into a per-rule diagnostic and add no conditional colour for that target; error-looking text stays text. Lazy `IF` and `IFERROR` work as in cells, including uncatchable circular errors. An independent true condition can colour an error cell without reading the error. Chart targets are skipped; reading a chart in a predicate is an error.

Only foreground/background colours are supported initially, using hex or CSS named colours. A matching rule overrides direct `:hi` styling; later matching rules win independently for each colour channel. Nonmatching rules restore the underlying direct colours automatically. Rules do not mutate stored styles, values, wrapping, alignment, number formats or geometry. Colour scales, icons and data bars are not included. Predicates run after a settled workbook calculation and can only read it; random functions, assignments, callbacks and evaluator/configuration capabilities are rejected, even in unused branches.

Rule target rectangles shift when rows/columns are inserted before them, expand for insertions inside, and shrink/drop on deletion. Literal coordinates inside predicates stay positional, like ordinary cell formulas; named references follow their own structural rules. Sheet/mark/column renames rewrite real predicate references without changing quoted labels; forced deletion permanently invalidates those references. Creating, editing, reordering and deleting rules each creates one workbook undo step. Rules save as sheet metadata in v3 `.dflo`, duplicate independently, and recalculate after load/undo or any source edit. Invalid saved rules reject the entire open without replacing live data. `:clear` removes rules on the cleared sheet; undo restores them with its cells/styles.

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
- Array formulas spill into empty cells. The selected spill has a dashed boundary and source label. `i/a/I/A` or Enter on a spill child edits the source, not an independent output. Error explanations appear in the pane's bottom bar and cell tooltip. See the [formula reference](../README.md#nested-formulas-and-dynamic-arrays).

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

### Fill and numeric series

These commands operate only in the **sheet**, not formula normal or insert. They overwrite targeted contents, including occupied cells, without copying styles or changing registers/clipboard. A blank fill seed clears destinations. They never insert rows/columns or grow the sheet.

| Keys / command | Action |
| --- | --- |
| `[count]gJ`, `gL`, `gK`, `gH` | Fill down, right, up, left |
| `:fill <down\|right\|up\|left> [count]` | Same fill using an Ex command |
| `:series <down\|right\|up\|left> [count] [step <number>]` | Generate numeric literals; default step is +1 |

**Normal:** the current cell is the source; count is the number of additional destinations (default one, maximum 10,000). From B0, `4gJ` copies B0 into B1:B4. `:series down 4 step 2` from seed `10` writes `12, 14, 16, 18` below it. A positive step increases values in travel order even when going up/left; use a negative step to decrease.

**Visual:** select the complete source-plus-destination rectangle, then omit count. Down uses its top row as sources, up its bottom row, right its left column, and left its right column. Other rows/columns are destinations, each lane independent. `v4jgJ` fills five selected cells from the top one; `vl4j:series down step 0.1<CR>` generates two independent columns from their top seeds. Reversing the selection or swapping corners with `o` does not change the source edge. Ctrl-v works identically; `V` includes every allocated column, without inserting rows. Additional command counts are rejected. A selection with no destination does nothing.

**Formula text stays literal**, exactly as for put. `=A0` still reads A0 after fill. `=[-1]{}` reads one column left of each destination, and `=A{}` keeps column A but follows the destination row. Calculated coordinates remain expressions: `[1]` is absolute column index 1, whereas `[+1]` is an offset. `=Inputs!A0` keeps its target; `=Inputs![-1]{}` uses each destination's coordinates as origin on Inputs. Fill does not rewrite references or quoted text. F4 explicitly changes reference notation. To repeat an evaluated result instead of a formula, `yiv`, put that literal value, then fill it.

Numeric series accept finite literal numeric seeds and decimal/scientific steps, using the formula engine's 64-digit decimal arithmetic. They reject formula, blank, date-like and other text seeds; there is no two-seed pattern inference or date series. Generated numbers are stored as numeric text; destination styling stays in place.

The entire operation is rejected if any target is outside the allocated sheet or any source/target belongs to a live array spill, **including its owner**. There is no `!` bypass, clipping, or partial write. Copied formulas may calculate new arrays; normal spill rules apply, so blockers are never overwritten and edge/overlap errors display `#SPILL!`. Formula errors are calculation results, not command rollback.

Each changed invocation is **one `u` / Ctrl-r step in chronological workbook history**, including any dataset growth. Failed or unchanged commands preserve history, selection, cursor, and the previous repeat. Success exits visual mode; the cursor ends at the far destination in the first lane (bottom-left for down, top-right for right, top-left for up/left). `gv` restores the original visual selection. `.` repeats the direction, shape, and step from the new cursor, reading fresh seeds on the active sheet rather than retaining copied data. `3.` performs three invocations, not one combined undo step. Macros record selection motions and commands through the same path; a macro is not an atomic transaction.

Lua mappings can use the native keys or Ex forms without additional APIs:

```lua
vim.keymap.set({ "n", "x" }, "<Leader>fd", "gJ", { desc = "Fill down" })
vim.keymap.set("n", "<Leader>sn", ":series down 9<CR>", { desc = "Next nine numbers" })
```

### Scrolling

- Ctrl-e/y scroll a row/line, keeping the cursor visible.
- Ctrl-d/u scroll half a viewport; an explicit count sets the line amount used by later half-page scrolls.
- Ctrl-f/b and PageDown/PageUp scroll pages with a two-line overlap.
- `zz/zt/zb` center/top/bottom the cursor; `z.`, `z<CR>`, `z-` also move to first nonblank.
- `zh/zl` scroll columns/characters; `zH/zL` scroll half a viewport horizontally; `zs/ze` align the cursor with the left/right edge.

Formula scrolling applies to the formula bar, sheet scrolling to the grid. Physical content boundaries limit scrolling.

## Cell formats preview in their own mode

The rounded badge at the formula field's right edge describes the current cell or sheet visual selection. Different effective formats show **Mixed**. Click it or press **`gF`** in sheet NORMAL/VISUAL or formula NORMAL to enter **FORMAT**. Formula text selections and INSERT are not cell-format targets. The panel stays compact, leaves the sheet visible, and outlines its fixed target range; `V` targets complete allocated rows, and `gv` can restore the original selection afterward.

The following are defaults, not fixed UI labels. All panel keycaps and FORMAT footer hints resolve the current Lua keymap:

| Default | Action token (RHS) | Behavior |
| --- | --- | --- |
| `gF` | `<FormatOpen>` | Open the panel (`n`, `f`, `x` modes) |
| `j` / Down, `k` / Up | `<FormatNext>`, `<FormatPrevious>` | Move through fields or an open picker |
| Enter | `<FormatSelect>` | Open/edit a field or confirm its picker/input |
| `f` | `<FormatType>` | Pick General, Number, Currency, Date or Time |
| `%` | `<FormatPercent>` | Toggle Number ↔ Percent (same type, unchanged stored value) |
| `d` | `<FormatDigits>` | Enter decimal places (0–64), or pick a Date display style |
| `+`, `-` | `<FormatIncrease>`, `<FormatDecrease>` | Adjust decimal places by one |
| `,` | `<FormatGroup>` | Toggle thousands separators |
| `c` | `<FormatCurrency>` | Enter a three-letter currency label, default NZD (no conversion) |
| `t`, `s` | `<FormatTime>`, `<FormatSeconds>` | Include time in Date; show seconds in clock displays |
| `z` | `<FormatZone>` | Enter UTC or an Intl-supported IANA timezone |
| `u` | `<FormatRevert>` | Restore all opening formats without leaving FORMAT |
| Backspace / Delete | `<FormatBackspace>` | Erase input text |
| Escape | `<FormatDone>` | Return to sheet NORMAL; keep confirmed adjustments, discard unfinished input/picker |

Adjustments preview every targeted cell immediately without recalculating formulas. A field edit preserves each cell's other settings; a mixed boolean becomes On, and mixed decimal counts require an explicit count before `+`/`-`. Choosing a type resets its settings to defaults; choosing General removes only format metadata. One completed session is one chronological workbook undo step; reverted/unchanged sessions add none. Clicking outside finishes before the next action. Formats persist in `.dflo` files, including empty coordinates and independently formatted spill children. Colour resets preserve formats and layout metadata. Keyboard adjustments record/replay through existing macros; formatting does not replace the last dot-repeat edit.

Number displays use decimal half-up rounding (ties away from zero), a decimal point, optional comma grouping, and a `%` suffix or explicit currency code. Rounded negative zero displays as zero. Very large fixed expansions fall back to bounded scientific notation with a warning. **Stored text, formulas, 64-significant-digit calculation, existing evaluated-value copies and chart inputs do not change.** General retains the existing display, including native-number formula presentation; formatting may reveal more precise formula digits than General. Put/fill keep destination styles rather than copying formats.

Dates/times remain **strict ISO text**, never Excel serial numbers or implicitly converted input: `YYYY-MM-DD`, `HH:mm[:ss[.SSS]]`, or `YYYY-MM-DDTHH:mm[:ss[.SSS]]Z` / an explicit `±HH:mm` offset. Validate actual Gregorian dates in years 0001–9999; ambiguous day/month text, invalid dates, offset-free timestamps, leap seconds and 24:00 are not interpreted. Date styles are ISO, `20/10/2026`, and `20 Oct 2026`; clocks are 24-hour, with optional seconds (fractions are not displayed). Timestamp presentation defaults to UTC, independent of machine timezone/locale; an explicit zone observes its timezone database/DST and displays its offset when time is included. Civil dates and clocks never shift zones, invent midnight or acquire a date. Incompatible values and unsupported saved settings keep the General display with a tooltip/footer/panel explanation, not a new calculation error.

Remap any action in **`format`** mode. RHS tokens are stable even if the default key is disabled; native key RHS aliases also work nonrecursively. As elsewhere, `<Nop>` hides a disabled shortcut and `vim.keymap.del` reveals its default. Labels prefer a usable custom action mapping and omit ambiguous/unbound keys. Inside a text field, only confirm, Done and erase mappings are active; other characters are literal (use control chords for these input actions if you need their letters). Escape is remappable in FORMAT, unlike the normal/formula modes:

```lua
vim.keymap.set({ "n", "f", "x" }, "<Leader>F", "<FormatOpen>")
vim.keymap.set("format", "p", "<FormatPercent>")
vim.keymap.set("format", "%", "<Nop>")
vim.keymap.set("format", "e", "<FormatDigits>")
vim.keymap.set("format", "<C-q>", "<FormatDone>")
vim.keymap.set("format", "<Esc>", "<Nop>")
```

Implementation contract: flat primitive `styles[r][c]` keys are `formatKind`, `formatDigits`, `formatPercent`, `formatGroup`, `formatCurrency`, `formatPreset`, `formatIncludeTime`, `formatSeconds`, `formatTimeZone`. Missing fields mean defaults; no file-schema migration is needed. `presentCell(preciseValue, flatStyle, legacyDisplayText)` returns `{text, warning}` without mutating inputs; formula passes expose a separate `typed` grid, including spills. `cellPresentation` and `formatPreview` are derived/session-only, not file/history data. Conditional colours and layout fields must remain independent of these format keys.

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

Key notation: `<Esc>`, `<CR>` / `<Enter>`, `<S-CR>`, `<BS>`, `<Del>`, `<Tab>`, `<Space>`, `<lt>`, `<Nop>`, `<F4>`, arrows, Home/End, PageUp/PageDown, `<C-x>`, `<C-S-x>` and Shift-arrows. Use the shown capitalization; Ctrl-letter names use lowercase. Leader/localleader expand when a mapping is defined. Escape always cancels and cannot be remapped except in FORMAT. Mapping `desc` values appear in the shortcut bar, and `<Nop>` mappings hide their disabled default shortcuts.

**Invalid shortcuts:** In sheet/formula NORMAL, visual and operator-pending modes, a key that cannot continue a buffered mapping discards the entire attempt, including any pending count/operator, and displays `Invalid shortcut` in the command field. No shorter mapping runs and no buffered keys become standalone commands. For example, `<Space>s>` does nothing when only `<Space>sn` is mapped. Insert mode and the `:`/search command line retain literal-text fallback on mismatch so ordinary typing still works.

**Mapping timeout:** `vim.opt.timeoutlen` sets the wait after each mapping-prefix key in milliseconds (default **500**). It accepts an integer from 0 to 2147483647; 0 cancels without waiting for another key. On timeout, the whole buffered sequence is discarded: no shorter mapping runs, no buffered characters become standalone commands or inserted text, and any pending count/operator is cancelled. For example, `<Leader>s` waiting for `<Leader>sn` does nothing when it times out. This also applies in insert mode (a timed-out `j` from a `jk` mapping is not inserted). Built-in commands such as `g` and `d` do not time out unless waiting on a custom mapping.

Reload is atomic: syntax/runtime/API errors keep the previous mappings, group labels and timeout active and report an error in the command field. Omitting `vim.opt.timeoutlen` restores the 500 ms default on reload. Configurations cannot access OS, filesystem, package loading, JavaScript, debug, coroutines, dynamic Lua loading, or protected calls. Limits: 128 KiB source, 1,000 mappings and group labels combined, 128-character LHS, 4,096-character RHS, an instruction budget and a 2-second worker timeout. Use this as a keymap configuration API, not a general-purpose Lua automation environment.

## Deliberately run workbook scripts

In sheet context, type **`:luarun`**, choose a local `.lua` file, inspect its source, then press **Run script**. Escape/Cancel closes the dialog and terminates an in-flight worker without publishing its draft. The dialog owns keyboard/mouse input. Config loading never runs workbook scripts: `init.lua` has no `df` API, and scripts have no `vim` API. A keymap may open `:luarun`, but recording/playback of macros cannot launch it; scripts are not recorded as repeat edits. Workbook files never contain executable scripts. Choosing a script reads only that explicitly selected file; the script itself receives no file capability.

Close or cancel the Lua script dialog before saving, replacing the workbook, quitting, or installing an update. Recovery checkpoints contain only published workbook data, never an in-flight script draft.

The invoking sheet and selection are captured **before** choosing a file, not from focus when the worker finishes. The data snapshot is captured when Run is pressed. Edits to workbook content/metadata during execution reject the result; changing the visible sheet/cursor does not redirect writes. A successful changed run makes one chronological workbook undo step. No-op, failed, stale, timed-out and cancelled runs preserve content, metadata, undo and redo. Saving remains an explicit `:w` operation.

### A small range API

Rows follow DataFlow's **zero-based** addresses (`A0`, not `A1` for the first cell). Lua tables and `df.sheets()` are one-based. Sheet and mark names match case-insensitively. Handles capture their target rectangle; editing their Lua metadata does not redirect them.

| Lua API | Result |
| --- | --- |
| `df.sheets()` / `df.sheet("Inputs")` / `df.active_sheet()` | Sheet handles with `name`, `rows`, `cols`; active means the invoking sheet |
| `sheet:range("A0:C2")` | Bounded absolute ascending rectangle; no implicit grid expansion |
| `df.selection()` | Captured selection, including full-row visual selections |
| `df.named("sales")` / `df.named("sales.amount")` | Existing persistent mark, dataset body or dataset column; optional leading backtick; empty bodies reject materialization |
| `range:read_raw()` / `range:write_raw(matrix)` | Stored strings, including leading `=` formulas; exact shape required |
| `range:read_values()` / `range:write_values(matrix)` | Tagged computed cells; exact shape required |
| `df.log("message")` | Bounded diagnostics, shown after a successful run |

Ranges expose `rows`, `cols`, `sheet`, `address`. Raw formula copying does **not** shift references. Typed cells are `{kind="number", decimal="9007199254740993.125"}`, `{kind="text", text="=literal text"}`, `{kind="boolean", value=false}`, or `{kind="blank"}`. Numbers cross the boundary as exact decimal strings, before UI rounding. Text writes quote their contents as a formula string so numeric-looking text and leading `=` remain text. Native Lua arithmetic is not decimal-exact: write a DataFlow formula for decimal calculations instead of converting the decimal string with `tonumber`.

Errors read as `{kind="error", message="…"}`, charts as `{kind="chart"}`, and non-scalar/Complex/Unit/nonfinite results as `{kind="unsupported", type="…"}`. These tags cannot be written through `write_values`; copy raw formula strings instead. An array source is unsupported as a computed scalar, while each spill child reads its scalar element. Existing valid rich values elsewhere in the workbook remain valid and keep their MathJS types.

```lua
-- Freeze selected computed values on a second sheet without losing decimal precision.
local selected = df.selection()
df.sheet("Report"):range("A0:B1"):write_values(selected:read_values())

-- Formula staging uses existing references/functions, not Lua floating-point arithmetic.
df.sheet("Report"):range("C0"):write_raw({{"=SUM(Inputs!A0:B1)"}})
df.log(df.sheet("Report"):range("C0"):read_values()[1][1].decimal)
```

Writes/readbacks run in order on a detached workbook and see earlier staged writes. Each range uses the accepted fill range mutator: reject duplicate/out-of-bounds destinations, spill owners/children and dataset header changes; preserve dataset contiguous-growth policy. A later failure discards **all** earlier writes, including cross-sheet writes and inferred dataset growth. Use one matrix for a contiguous batch, rather than one API call per cell. Recalculation batches a range's writes, occurs before each spill-sensitive write and computed read, and validates all sheets at the end, including disconnected inactive sheets. Any final formula/cycle/spill error blocks publication (even a pre-existing error); a script can repair errors in its draft before the final check. The API does not resize sheets, rename/create definitions, edit styles, sort/filter in place, invoke arbitrary Ex commands or save files.

Worker results contain ordered raw write batches, not live calculation objects. Main-thread detached replay rechecks the same mutation rules, then validates every sheet in one verified calculation session and installs the visible sheet's final cache with the workbook. Undo/redo and later normal recalculations still evaluate normally. Volatile functions such as `random()` can differ between reads, worker validation and final replay; copied computed values freeze the worker sample, not a promised future random value. A changed volatile spill shape may cause the final replay to reject safely. There is no deterministic replay guarantee.

### Limits reduce accidents, not hostile-code resource exhaustion

Source ≤128 KiB; individual transferred cell ≤16 KiB; aggregate reads/writes ≤100,000 cells and 8 MiB; ≤1,000 API calls; ≤10,000 distinct changed destinations; ≤100 diagnostics / 8 KiB; one million Lua instructions; five-second worker watchdog. The input/final serialized workbook (including styles/metadata) must fit 100,000 cells / 8 MiB. Every run gets a fresh VM/worker. Only selected base/math functions and bounded `string.len/sub/lower/upper` exist. No OS, filesystem, network, shell, Tauri, clipboard, JavaScript, packages, dynamic loading, coroutines or protected-call bridges are exposed.

**Trusted local scripts only.** Fengari has no enforceable heap quota. Lua table growth/concatenation and formula-native allocations can exhaust memory before a watchdog can act; instruction hooks do not count native library work. Main-thread validation/replay checks a separate five-second budget between batches and before publication, but cannot be interrupted inside a native formula call and can freeze the UI. Cancel/watchdog apply to the worker, not a currently executing synchronous publication validation. These are existing-runtime constraints, not a secure untrusted-code execution service. Never run a downloaded script without understanding it. No new dependencies or extra filesystem/network permissions are required.

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

Definition/declaration and tag motions (`gd/gD`, Ctrl-], `g]`, `g<C-]>`, Ctrl-t), file/include navigation (`gf`, `[i/]i`), folds (`zj/zk`), diff (`[c/]c`), diagnostics (`[d/]d`), quickfix/location lists and general Neovim buffer switching have no backing subsystem. `gF` opens DataFlow's format panel, not file navigation. DataFlow's sheet and split-window commands above are supported, not the full Neovim window API. Unsupported motions are not silently redirected to unrelated cells. Neovim Select mode, named/numbered registers, arbitrary operators (`gq`, `=`, shell filters, folds), Ex ranges/scripts and full insert/replace-mode command parity are outside this implementation.

Run `npm test` for the keyboard/Lua contract tests, `npm run build` for the frontend, and `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` for native config-file creation/reload tests.
