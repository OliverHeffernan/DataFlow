# DataFlow
DataFlow is a spreadsheet app with keyboard commands, similar to Vim/Neovim. This allows for fast manipulation of your spreadsheets.

## Installation
### MacOS:
Once the first release is published, install the latest Intel or Apple Silicon build with:

```sh
curl -fsSL https://raw.githubusercontent.com/OliverHeffernan/DataFlow/main/install.sh | bash
```

Open `~/Applications/Dataflow.app`. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway**; builds are ad-hoc signed, not Apple-notarized.

For updates, choose **Dataflow → Check for Updates…** in the menu bar. Save your work before installing: the app restarts to finish the update. Each push to `main` automatically builds and publishes a new version after both Mac builds succeed.

**Maintainers:** complete the [one-time signing-key setup](docs/releases.md#one-time-maintainer-setup) before the first release. The same guide covers releases, update behavior, and limitations. To build locally instead, clone the repository, run `npm ci`, then `npm run tauri build`.

### Amp orbs
Executable `.agents/setup` prepares Debian orbs with Tauri's Linux libraries, a minimal stable Rust toolchain, and dependencies from both lockfiles. It uses the orb's Node/npm and caches Rust crates for the Linux host without compiling the app or starting servers. Amp can reuse the prepared environment in project snapshots; rerunning setup skips installed system packages and reuses package caches.

`.agents/resume` only checks that the toolchains are available; it never reinstalls dependencies. No database or secrets are required.

After setup, use `npm run build` for the frontend or `cargo check --locked --manifest-path src-tauri/Cargo.toml` for the native backend. Native macOS builds still require a Mac.

## Dependency maintenance

Use Node.js 22.12+ (or another version accepted by `package.json`) and Rust 1.90+. Install with `npm ci`; keep both `package-lock.json` and `src-tauri/Cargo.lock` committed. Run `npm test`, `npm run build`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml` after upgrades. Check advisories with `npm audit` and, with [cargo-audit](https://crates.io/crates/cargo-audit) installed, `cargo audit --file src-tauri/Cargo.lock`.

Known upstream findings as of October 2026:

- Fengari, required for Lua keybindings, depends on `sprintf-js`, which has an [unpatched denial-of-service advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). npm reports two moderate findings for this one dependency chain. Only import Lua configurations you trust; the worker timeout does not guarantee protection against memory exhaustion.
- Tauri's Linux GTK dependencies retain an [unsoundness warning for `glib` 0.18](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and an [unmaintained warning for `proc-macro-error`](https://rustsec.org/advisories/RUSTSEC-2024-0370.html). They are not compiled into macOS builds. Resolving them requires compatible upstream GTK/Tauri changes, not a breaking transitive-version override.

The updater's unused legacy Windows ZIP support is disabled; macOS `.app.tar.gz` updates, TLS, and system-proxy support remain enabled. Vue's optional in-app devtools plugin was removed to reduce development dependencies; the Vue Devtools browser extension can still be used.

## Functions
Functions are entered in the formula bar at the top of the screen. These are used to set the value of a cell mathematically.

To use a function, begin the formula with `=`, so that DataFlow knows it is a formula, and not just text.
### Mathjs
Many functions are provided through the Mathjs library, including round, sin, tan and many more. If you want to see more detail on mathjs functions view there documentation at <a href="https://mathjs.org/index.html">math js documentation</a>.

### DataFlow Functions
In this section are functions that make it easier to collate data from throughout your spreadsheets, allowing you to collate your meaningless numbers into understandable sums, averages and counts.

#### Absolute cell references
To include a cell's value in a formula for another cell, type the reference for the cell, e.g. A0.

#### Relative cell references
To get a relative cell reference, (e.g. get the value of the cell two rows up and one column to the left), you can use square brackets to calculate the column and curly brackets for the row. An example is below.

```
= [-3]{+5}
```
The formula above would return the value of the cell 3 columns to the left, and 5 rows down. This is useful when creating formulas that will be used in several places, as it means that you can copy them over without worrying about readjusting the formula for the new location. It is also useful for getting sums.

For example, if you had a column of values that you wanted a sum for, you could place the following formula at the bottom of it.
```
= SUM([]0:[]{-1})
```
This gets the sum from row 0, to the previous row, meaning that if you add any more values in between, it will update immediately without needing to readjust the range. This applies for AVG, COUNT, and can also be utilised in SUMIF, AVGIF, and COUNTIF functions.

As shown in the above code, to get the current column, you can type []. You can also use {} to get the current row.
#### SUM: `SUM(range)`
SUM provides a sum of all the values in the given range.

The range is of format A0:B15, which selects all cells within a rectangle starting at A0 and ending at B15.

#### AVG/MEAN: `AVG(range)`
AVG averages all values given in a range.

#### COUNT: `COUNT(range)`
Returns the number of cells in the range.

#### SUMIF: `SUMIF(conditionRange, criteria, valueRange)`
SUMIF allows you to filter through the range, valueRange, adding it if a corresponding cell is equal to the criteria. This is useful for things like budgets, where you may want to see a sum of your spending in certain categories.

criteria is of format =3

below is an example of a SUMIF function being used.

`=SUMIF(A0:A10,=5,B0:B10)`

The above function would return a sum of all values on column B, within rows 0 and 10, where the corresponding value in column A is 5.

Criteria support `=`, `<>` / `!=` / `!`, `<`, `>`, `<=`, and `>=`. Criteria may be quoted (e.g. `">5"`) or use the existing unquoted syntax (e.g. `>5`).

There is currently no support for cell ranges being provided in the criteria.

There are more IF functions below:
`COUNTIF`: count if
`AVGIF`: average if
`SUMIF`: sum if

All of the above if functions take the same parameters as SUMIF.

### Nested formulas and dynamic arrays

Functions accept other functions as arguments. Ranges and array results retain their rectangular shape:

```text
=IF(C1>0, "Profit", "Loss")
=VSTACK(FILTER(A1:C6, C1:C6>100), FILTER(A1:C6, C1:C6<40))
=SUM(FILTER(C1:C6, B1:B6="North"))
=SORT(UNIQUE(FILTER(A1:C6, C1:C6>0)), 2, -1)
```

| Function | Behavior |
| --- | --- |
| `IF(condition, whenTrue, [whenFalse])` | Evaluate only the selected branch; the condition must be scalar. Omitted `whenFalse` defaults to FALSE. |
| `IFERROR(value, fallback)` | Use the fallback if evaluating the value fails. Literal error-looking strings are still text; circular references remain errors. |
| `FILTER(array, include, [ifEmpty])` | Keep rows whose corresponding mask is true. The mask must have one value per row. No matches returns `ifEmpty`, or `#CALC!` if omitted. |
| `VSTACK(array, …)` | Stack arrays vertically. All inputs must have the same width. |
| `HSTACK(array, …)` | Stack arrays horizontally. All inputs must have the same height. |
| `SORT(array, [columnIndex], [sortOrder])` | Sort rows by a **zero-based** column within the input array (default 0), ascending (1) or descending (-1). Blanks sort last. |
| `UNIQUE(array)` | Keep distinct rows, in their original order. |
| `AND(condition, …)`, `OR(condition, …)`, `NOT(condition)` | Combine scalar conditions or elementwise array masks. |

Comparisons accept `=`, `<>`, `<`, `>`, `<=`, `>=`, and mathjs `==`/`!=`. Comparisons and arithmetic apply elementwise to ranges; scalars broadcast, while two arrays must have the same dimensions. Text is case-sensitive. Numeric cell text is treated as numbers; quoted text remains text. Existing `SUM`, `AVG`/`MEAN`, and `COUNT` work on nested array results. For compatibility, COUNT counts cells (including blanks/text) and AVG divides the numeric sum by that cell count.

Real-number formulas use 64-significant-digit decimal arithmetic, including intermediate references and spilled values. This avoids binary floating-point artifacts such as `0.1 + 0.2` displaying `0.30000000000000004`. Results are not rounded to a fixed number of decimal places. Display, chart and clipboard values still use native-number precision (about 16 significant digits); functions that only support native numbers use that precision too. Repeating fractions and irrational numbers remain finite-precision approximations.

An array formula **spills** into empty cells below and to its right. A dashed outline identifies the selected spill and the footer names its source. Press `i` or Enter on a spill child to edit its source formula. Outputs are derived, not independently stored. Source changes, undo/redo and reopening a sheet rebuild them. A single reference to an array source passes the full array to another formula; a range reads each displayed element. Charts can read spilled values too.

Occupied destinations, overlapping spills and sheet edges produce `#SPILL!` without overwriting anything. The footer and the cell tooltip explain errors. A FILTER mask or stack dimension mismatch gives `#VALUE!`; out-of-sheet references give `#REF!`. This is a focused array-function set, not complete Excel formula compatibility: FILTER filters rows, IF conditions are scalar, and stacks reject incompatible dimensions instead of padding them.

### Lookups and joins

Use `LOOKUP` to attach one unambiguous record per key, or `JOIN` to return every matching pair. Both accept rectangular ranges or array expressions, including references to other sheets and whole spill sources. Results use the usual spill protection; source data is never modified. Headers are ordinary rows, so leave them out of the input ranges when they are not data. Row references and row offsets in error explanations remain **zero-based**.

#### `LOOKUP(queryKeys, sourceKeys, values, [ifMissing])`

Each row of `queryKeys` is one query. `sourceKeys` and `values` must have the same number of rows; the two key arrays must have the same number of columns. Return the corresponding values row for each query, keeping query order and repeated queries. The result has one row per query and the same width as `values`. A 1×1 result becomes a scalar.

No match gives `#N/A`, failing the whole formula unless `ifMissing` is supplied. A scalar default fills all returned columns; alternatively supply a single row with exactly the width of `values`. The default is evaluated at most once per invocation, only when a query is missing. Multiple source matches for a queried key give `#VALUE!`, even if their values are identical; unrelated duplicate keys are allowed. Matched duplicates are rejected before evaluating the missing-key default.

For example, if `Products!A0:C2` contains `P1, Screw, 0.10`, `P2, Bolt, 0.20`, and `P3, Nut, 0.30`, and `Sales!A0:A3` contains `P2`, `P1`, `P9`, `P2`:

```text
=LOOKUP(Sales!A0:A3, Products!A0:A2, Products!B0:C2, HSTACK("Unknown", 0))
```

The 4×2 result is `Bolt, 0.20`; `Screw, 0.10`; `Unknown, 0`; `Bolt, 0.20`.

#### `JOIN(left, leftKeys, right, rightKeys, [kind = "left"])`

Each data array must have the same row count as its own keys, and both key arrays must have the same width. Return all supplied left columns followed by all supplied right columns. Keys need not be part of the returned data; select columns with ranges or `HSTACK` before joining. If both supplied data arrays contain key columns, both remain in the result.

Duplicate keys produce every matching pair, in left-row order, then right-row order within each left row. The default `"left"` join keeps unmatched left rows and pads the right columns with blanks. `"inner"` omits unmatched rows; no output rows gives `#CALC!`. These are the only accepted kinds, spelled exactly as shown. The functions do not sort or deduplicate.

```text
=JOIN(Sales!A0:B3, Sales!A0:A3, Products!B0:C2, Products!A0:A2)
=JOIN(Sales!A0:B3, Sales!A0:A3, Products!B0:C2, Products!A0:A2, "inner")
```

The first formula appends descriptions and prices while retaining the unknown P9 sale with blank product fields; the second omits that sale. Adding another P2 product makes `LOOKUP` ambiguous, whereas `JOIN` returns both products for each P2 sale. Include the right key in the returned columns if you need to distinguish a missing match from a matched record whose payload is all blank.

#### Exact keys and composite keys

Key matching is stricter than ordinary spreadsheet comparisons. Text matches exactly, including case, whitespace, and Unicode representation. Booleans match only the same boolean. Finite real numbers match exactly at their represented decimal precision, without comparison tolerance or native-number conversion: `1.00` matches `1`, and `0.1+0.2` matches `0.3`. Numeric cell text is already converted to numbers by the evaluator (`001` becomes 1); quoted formula text such as `"001"` stays text and does not match numeric 1. Returned decimals also retain their precision through subsequent formulas and spills; display/API precision is unchanged.

Blank keys (`""`) never match, even other blanks or zero. Any blank component makes a composite key unmatched. A space is text, not a blank. Nonfinite numbers, units, complex numbers, and other unsupported key objects give `#VALUE!`.

Multiple key columns form a composite key; every component must match. A horizontal row is one composite key, not multiple queries. Scalars are 1×1 inputs; key arrays are never flattened, transposed, or broadcast. Use `VSTACK` for multiple queries and `HSTACK` for composite keys:

```text
=LOOKUP(HSTACK("P2", "NZ"), HSTACK(Products!A0:A2, Products!D0:D2), Products!C0:C2)
```

All required input expressions evaluate normally, including unmatched values rows. Source errors, invalid dimensions, and ambiguous matches are not missing keys and are not caught by `ifMissing`. An unused default may contain invalid runtime references, but the complete formula must still parse. Actual formula errors propagate; error-looking strings remain ordinary text. Circular references cannot be hidden by defaults or `IFERROR`. Both functions reject outputs exceeding **1,000,000 cells** with `#CALC!` before constructing result rows; they never silently truncate. This limit does not bound the memory used by their input expressions.

### Editing formulas with the keyboard

In FORMULA INSERT, **Ctrl-h/j/k/l** inserts a relative reference to a nearby cell. Further presses adjust that reference. **Shift-h/j/k/l** extends the active reference into a rectangular range, anchored at the current reference. Start with Ctrl-direction, then use Shift-direction to extend. Normal typing or moving the text caret finishes the reference; shifted letters outside a reference session remain text so function names are typeable. The next Ctrl-direction shortcut starts from the edited cell again.

For example, editing D5: Ctrl-h inserts `[-1]{}` (C5), another Ctrl-h changes it to `[-2]{}` (B5), and Shift-k changes it to `[-2]{-1}:[-2]{}` (B4:B5). All offsets remain relative when the formula is copied elsewhere. Movement stops at sheet edges.

While editing, absolute references, `[]{}` relative references, calculated references, and ranges are colored to match their grid outlines. Repeated references to the same cells share a color. Quoted text is never treated as a reference. Invalid/incomplete references do not highlight unrelated cells.

Type a function prefix and press **Tab** to complete its name and parentheses; use Up/Down to choose a suggestion. Signature help highlights the current argument, including inside nested calls. **F4** toggles the reference under or immediately before the caret between ordinary coordinates and DataFlow-relative notation. On keyboards that reserve function keys, use Fn-F4 or remap `<F4>` in Lua.

### Formula-defined charts: `CHART()`

Enter a chart builder as a cell formula. Commit it with Enter to render an SVG chart over the grid, anchored to the formula's cell. The chart can cover multiple cells without changing any row heights or column widths. Click the chart to select its formula cell, or double-click to edit its original formula. No `.build()` call is needed.

```
=CHART().line().x(A1:A6).series(B1:B6, "Revenue").series(C1:C6, "Costs").title("Monthly performance").xLabel("Month").yLabel("NZD").size(360, 220).position(12, 8)
```

For a minimal chart, use `=CHART().line().series(B1:B6)`. A chart type is required: `=CHART()` and builders without a type display a blank cell. While editing, type a dot or method prefix after `CHART()` for builder suggestions; Tab inserts the method and parentheses. Signature help highlights the current method argument.

| Builder method | Meaning |
| --- | --- |
| `.line()`, `.bar()`, `.scatter()`, `.pie()` | Required chart type; there is no default. Bars are grouped by series. |
| `.x(range)` | Shared x-labels, scatter x-values, or pie slice labels. Defaults to point numbers starting at 1. |
| `.series(range, "name")` | Add a series. Repeat for multiple series (except pie); the name is optional. |
| `.title("text")` | Set the title. |
| `.xLabel("text")`, `.yLabel("text")` | Set axis labels (ignored for pie charts). |
| `.size(width, height)` | Overall chart dimensions in pixels, including title and axes. Defaults to 320 × 200. |
| `.width(width)`, `.height(height)` | Set either dimension independently. |
| `.position(x, y)` | Nonnegative pixel offsets from the formula cell's top-left corner. Defaults to (0, 0); larger offsets can place the chart over other cells. |

Methods can appear in any order. Later configuration calls override earlier settings; `.series()` always adds another series. For example, `.size(360, 220).height(280)` produces a 360 × 280 chart. Sizes must be positive numeric literals; positions must be nonnegative numeric literals. Chart dimensions and offsets never change cell sizes. Charts move with their formula cells when the sheet scrolls. Very small charts scale their contents down to fit.

Ranges must be a single row, a single column, or a single cell, in ascending order and within the sheet. Rows remain zero-based. Existing relative-reference notation works too: a chart in D6 can use `.series([-2]0:[-2]{-1})` to plot B0:B5. Source cells may contain numeric formulas; source edits update the chart automatically.

Every series and the explicit x-range must have the same length. Line and bar charts space labels evenly; scatter charts require finite numeric x-values and position points by their numeric values. Blank y-values leave gaps (or omit bars/points) without shifting other values. Zero and negative y-values are supported; other nonnumeric or infinite y-values produce a cell error. A chart with no nonblank y-values displays “No data”.

Pie charts require **exactly one series of nonnegative values**. For example: `=CHART().pie().x(A1:A6).series(B1:B6, "Sales").title("Sales share")`. Each positive value becomes a slice; colors match the category legend, which includes values and percentages. Hover a slice or legend entry for its full label. Blanks and zeros produce no slice; an all-blank/all-zero pie displays “No data”. Negative values produce a cell error.

Text arguments use double quotes; escape embedded quotes as `\"` and backslashes as `\\`. Labels are displayed as text, never HTML. Malformed builders, invalid data, and circular references display readable errors in the cell. Chart cells cannot be used as numeric inputs to other formulas or charts.

The builder text is stored in the existing sheet format, so charts survive save/load, undo/redo, and copy/paste. Copying a chart's value also copies its builder formula; the pasted chart is anchored to its new cell. There is no image export, drag-resizing, or drag-positioning in this version; use builder methods to size and position charts.

## Commands
Type commands directly while the spreadsheet is focused. The bottom bar is a read-only display of commands, pending keys and messages, not an input field. Available shortcuts change with the current mode and prefix, including descriptions from Lua mappings. Native text controls such as the cell picker keep their own input behavior.

**Sheet normal:** `hjkl` and counted arrows move between cells. `0`, `^`, `$`, `g_`, words, searches, marks, viewport motions and operators use spreadsheet meanings.

**Formula normal:** press `Enter` to navigate the selected cell's text. `i/a/I/A` enter insert mode. Plain `j/k` leave formula normal and move down/up a cell; `gj/gk` navigate formula text lines. `Esc` leaves insert for formula normal; another `Esc` returns to the sheet. `Enter` commits insert directly to sheet NORMAL without moving cells; `Shift-Enter` inserts a newline.

`v` selects a cell rectangle, `V` selects whole rows, and `Ctrl-v` selects a block. Use `d/c/y` with a motion or selection, `dd/cc/yy` for rows, `p/P` to put, `u/Ctrl-r` to undo/redo, and `.` to repeat an edit. `qa … q` records a macro; `@a` plays it.

**Lua configuration:** `:configcreate` creates an `init.lua` template. Edit it and use `:source` to reload. In a browser, download the template, edit it, and import it with `:config`; valid configurations persist in browser storage.

See the [keyboard reference](docs/keyboard.md) for the complete motion coverage matrix, spreadsheet translations, Lua API, limitations, and migration from the old shortcuts.

## Reading and Writing
### Read/Open file `:o`:
To open a preexisting file, enter `:o` into the command line, then press `enter`, you will be prompted with a open file dialog, simply choose the file you would like to open.

### Write/Save file `:w`:
To save/write the current file, type `:w` into the command line, then press `enter`. If the file is has not already been saved to the harddrive, you will be prompted with a save file dialog, simply choose the location of the file. If the file has previously been saved, it will be replaced.

### Save as `:wa`:
To save a file to a new location, enter the command `:wa` into the command line, then press `enter`, and choose where you would like to save it.

This is useful when you want to have a template file to duplicate, for example, a monthly budget template.

### Clear sheet/new file `:clear`:
If you want to clear the screen, or you want a new file (make sure you have saved the current file before doing this), type the above command and press enter.

### Styling `:hi`
Let's say I want to style a cell with a lightblue background, and a black font colour. To achieve this, I would select the desired cell, and type the following command.
```
:hi bg lightblue fg black
```
Then press `enter`.

If I wanted to keep the background the same, but change the foreground/font color, I could type this.
```
:hi fg black
```
This has support for all CSS colors, including hex values, named colors, and rgb values. But when typing rgb values, make sure not to include any spaces between values.

When using rgb values, do this:
```
:hi fg rgb(0,0,0)
```
Don't do this
```
:hi fg rgb(0, 0, 0)
```
### reset all styling `:resetallstyles`
To reset all styling to defaults, type the above command and press `enter`.

### force load styles `:forceloadstyles`:
If you encounter any issues with styling where it is not behaving as it should, you can try entering the above command and pressing `enter`.
