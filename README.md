# DataFlow
DataFlow is a spreadsheet app with keyboard commands, similar to Vim/Neovim. This allows for fast manipulation of your spreadsheets.

## Commands
Commands are entered into the command line at the bottom of the window.

### Motions
Motions are standard vim motions (hjkl), supporting quantified motions for most commands (e.g. 5k to move up 5 rows).

### Insert `i`:
Use this command to edit the formula of the currently selected cell. Then to go back to the command line, press `esc`.

### Insert at start of row `I`:
Enter this command in the command line to edit the first cell in the currently selected row.

### Move to first cell in row `^`:
Enter this command to select the first cell in the currently selected row, without editing it.

### Move to end of row `$`:
Enter this command to select the last cell in the currently selected row, without editing it.

### Replace currently selected cell's formula `c`:
Enter this command to replace the formula of the currently selected cell.

### Cell Selector `;`:
To choose a specic cell to select, press `;` in the command line, then type the reference for the cell you would like to select, for example "B23", then press `enter`.

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

### Read/Open file `:o`:
To open a preexisting file, enter `:o` into the command line, then press `enter`, you will be prompted with a open file dialog, simply choose the file you would like to open.

### Write/Save file `:w`:
To save/write the current file, type `:w` into the command line, then press `enter`. If the file is has not already been saved to the harddrive, you will be prompted with a save file dialog, simply choose the location of the file. If the file has previously been saved, it will be replaced.

### Save as `:wa`:
To save a file to a new location, enter the command `:wa` into the command line, then press `enter`, and choose where you would like to save it.

This is useful when you want to have a template file to duplicate, for example, a monthly budget template.

# Setup stuff from Tauri
This template should help get you started developing with Vue 3 in Vite.
## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```
