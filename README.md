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

#### IF: `SUMIF(conditionRange, criteria, valueRange)`
SUMIF allows you to filter through the range, valueRange, adding it if a corresponding cell is equal to the criteria. This is useful for things like budgets, where you may want to see a sum of your spending in certain categories.

criteria is of format =3

below is an example of a SUMIF function being used.

`=SUMIF(A0:A10,=5,B0:B10)`

The above function would return a sum of all values on column B, within rows 0 and 10, where the corresponding value in column A is 5.

There is currently only support for = criterion.

There is currently no support for cell ranges being provided in the criteria.

There are more IF functions below:
`COUNTIF`: count if
`AVGIF`: average if
`SUMIF`: sum if

All of the above if functions take the same parameters as SUMIF.

### Formula-defined charts: `CHART()`

Enter a chart builder as a cell formula. Commit it with Enter to render an SVG chart over the grid, anchored to the formula's cell. The chart can cover multiple cells without changing any row heights or column widths. Click the chart to select its formula cell, or double-click to edit its original formula. No `.build()` call is needed.

```
=CHART().line().x(A1:A6).series(B1:B6, "Revenue").series(C1:C6, "Costs").title("Monthly performance").xLabel("Month").yLabel("NZD").size(360, 220).position(12, 8)
```

For a minimal chart, use `=CHART().series(B1:B6)`.

| Builder method | Meaning |
| --- | --- |
| `.line()`, `.bar()`, `.scatter()` | Choose the chart type. Defaults to line; bars are grouped by series. |
| `.x(range)` | Shared x-labels or x-values. Defaults to point numbers starting at 1. |
| `.series(range, "name")` | Add a series. Repeat for multiple series; the name is optional. |
| `.title("text")` | Set the title. |
| `.xLabel("text")`, `.yLabel("text")` | Set axis labels. |
| `.size(width, height)` | Overall chart dimensions in pixels, including title and axes. Defaults to 320 × 200. |
| `.width(width)`, `.height(height)` | Set either dimension independently. |
| `.position(x, y)` | Nonnegative pixel offsets from the formula cell's top-left corner. Defaults to (0, 0); larger offsets can place the chart over other cells. |

Methods can appear in any order. Later configuration calls override earlier settings; `.series()` always adds another series. For example, `.size(360, 220).height(280)` produces a 360 × 280 chart. Sizes must be positive numeric literals; positions must be nonnegative numeric literals. Chart dimensions and offsets never change cell sizes. Charts move with their formula cells when the sheet scrolls. Very small charts scale their contents down to fit.

Ranges must be a single row, a single column, or a single cell, in ascending order and within the sheet. Rows remain zero-based. Existing relative-reference notation works too: a chart in D6 can use `.series([-2]0:[-2]{-1})` to plot B0:B5. Source cells may contain numeric formulas; source edits update the chart automatically.

Every series and the explicit x-range must have the same length. Line and bar charts space labels evenly; scatter charts require finite numeric x-values and position points by their numeric values. Blank y-values leave gaps (or omit bars/points) without shifting other values. Zero and negative y-values are supported; other nonnumeric or infinite y-values produce a cell error. A chart with no nonblank y-values displays “No data”.

Text arguments use double quotes; escape embedded quotes as `\"` and backslashes as `\\`. Labels are displayed as text, never HTML. Malformed builders, invalid data, and circular references display readable errors in the cell. Chart cells cannot be used as numeric inputs to other formulas or charts.

The builder text is stored in the existing sheet format, so charts survive save/load, undo/redo, and copy/paste. Copying a chart's value also copies its builder formula; the pasted chart is anchored to its new cell. There is no image export, drag-resizing, or drag-positioning in this version; use builder methods to size and position charts.

## Commands
Commands are entered into the command line at the bottom of the window.

**Sheet normal:** `hjkl` and counted arrows move between cells. `0`, `^`, `$`, `g_`, words, searches, marks, viewport motions and operators use spreadsheet meanings.

**Formula normal:** press `Enter` to navigate the selected cell's text with the same motion vocabulary. `i/a/I/A` enter insert mode. `Esc` leaves insert mode; another `Esc` returns to the sheet. `Enter` commits an insert; `Ctrl-j` inserts a newline.

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
