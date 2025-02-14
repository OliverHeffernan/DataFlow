# DataFlow
DataFlow is a spreadsheet app with keyboard commands, similar to Vim/Neovim. This allows for fast manipulation of your spreadsheets. You can access the web app <a href="https://oliverheffernan.github.io/DataFlow/">here</a>.

## Local Installation
### MacOS:
If you want a local version of the app, you can clone this repository, and compile the app using the terminal command, `npm run tauri build`. The only feature that is in the desktop version that is not available in the web version is improved file management. In the desktop version, when you save a file, you can choose where it is saved, whereas in the web version, it will just be downloaded to the downloads folder.

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

### Motions
Motions are standard vim motions (hjkl), supporting quantified motions for most commands (e.g. 5k to move up 5 rows).

You can also use arrow keys to move around. If you are typing anything in either the command line, you can still use the arrow keys to move across your command or formula, but if you are not, the arrow keys will be used to move the selection cursor. Arrow key movement ignores amount commands, i.e. you can't press 5 then the right arrow key to move right five times.

### Visual Mode `v`:
To enter visual mode, use the command `v`. This mode is used to make a selection of multiple cells in a rectangle. AFter making the selection, there are several commands you can use to manipulate the selection.

 - `d`: Will clear the cells, leaving them blank, and exiting visual mode.
 - `yf`: yank/copy the formula of all cells in the selection.
 - `ys`: yank/copy the value of all cells in the selection.

### paste `p`:
To paste the copy buffer directly into preexisting cells, use the `p` command. This will paste the buffer starting at the currently selected cell.

Keep in mind this may overwrite the values of preexisting cells. If you want to create a gap to paste into, use the next command.

### paste into gap `P{motion}`:
If you want to paste the copy buffer between preexisting cells, you can use the `P` command, then specify the direction that they should be pasted into.

- `Pj`: paste below, creating new rows for the copy buffer to paste into.
- `Pk`: paste above, creating new rows for the copy buffer to paste into.
- `Pl`: paste to the right, creating new columns for the copy buffer to paste into.
- `Ph`: paste to the left, creating new columns for the copy buffer to paste into.

### Macros `q`:
A macro is a recorded set of commands that can be repeated at any time.

To start recording a macro press `q` in normal mode, then press a key to assign the macro to.

For example, if I wanted assign a macro to `w`, I would type `qw`.

Then execute the commands that you want in the macro.

Then to end the recording, press `q` again.

To use the macro, type `@` then the key that you assigned the macro to. In our example, we would type `@w`.
## Motions within formula bar
### Left and right`H` `L`:
To move around in the formula bar, you can use the `H` command to move left, and the `L` command to move right. I am not set on this particular keymap, so if you have any suggestions for this command, please let me know. The struggle is how to differentiate it from the hjkl commands. I though to use control h and control l, but I personally have these mapped to something else on the system level, and I thought many others would have similar mappings. So I am open to suggestions, and am also looking to implement configuration, so that the user can change their keymaps.

### Insert `i`:
To enter insert mode, press `i`. This will place the insert cursor on the left side of the box cursor that is displayed in the formula bar.

### Append `a`:
Another way to enter insert mode is by using the `a` command. The difference is that this will place the insert cursor on the right side of the box cursor.

### Replace currently selected cell's formula `c`:
Similar to a and i commands, except it clears the formula, so that you can replace it with a new one.

### Insert at start of row `I`:
Enter this command in the command line to edit the first cell in the currently selected row.

### Move to first cell in row `gh`:
Enter this command to select the first cell in the currently selected row, without editing it.

### Move to end of row `gl`:
Enter this command to select the last cell in the currently selected row, without editing it.

### Move cursor to end of cell `$`:
To move the cursor to the end of the cell, use the `$` command.

## Move cursor to beginning of cell `^`:
Similarly, you can use the `^` command to move the cursor to the beginning of the cell.

### Move to row 0 `gg`:
Enter this command to select the first cell in the currently selected column.

### Move to final row `G`:
Enter this command to select the final cell in the currently selected column.

### Replace currently selected cell's formula `c`:
Enter this command to replace the formula of the currently selected cell.

### Cell Selector `g{ref}`:
To select a specific cell, type `g`, then the cell reference e.g. `A3`, then press enter.

** Macros not yet supported for this command.

### Center the selection `zz`:
To center the viewport around your selection, enter `zz` into the command line.

### Insert Row/column:
To insert a row or column, enter `o` in the command line, then use standard vim motions to show where the new row/column will be created. All 4 of these commands are detailed below.

`oh`: Insert column left.

`oj`: Insert row below.

`ok`: Insert row above.

`ol`: Insert column right.

### Yank `y`:
When yanking (copying), you can specify whether to yank the formula, or the value.

`yf`: Yank formula.

`ys`: Yank value.

### Delete row `dd`:

### Delete column `dc`:

## Motions within formula bar
### Left and right `H` `L`:
To move around in the formula bar, you can use the `H` command to move left, and the `L` command to move right. I am not set on this particular keymap, so if you have any suggestions for this command, please let me know. The struggle is how to differentiate it from the hjkl commands. I though to use control h and control l, but I personally have these mapped to something else on the system level, and I thought many others would have similar mappings. So I am open to suggestions, and am also looking to implement configuration, so that the user can change their keymaps.

### Jump by word `w`:
To jump to the start of the next word, type `w`.

## Jump back by word `b`:
To jump to the start of the current/next word, type `b`.

### Jump to end of word:
To jump to the end of the current/next word, type `e`.

### Jump by white space `W`:
To jump to the start of the next block of text (jumps to the character after the next space), type `W`.

### Jump back by white space `B`:
To jump back by white space, type `B`.

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

