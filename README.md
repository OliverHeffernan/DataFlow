# DataFlow
DataFlow is a spreadsheet app with keyboard commands, similar to Vim/Neovim. This allows for fast manipulation of your spreadsheets.

## Installation
### MacOS:
You can clone this repository, and compile the app using the terminal command, `npm run tauri build`.

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
