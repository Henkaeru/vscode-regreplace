# regreplace README

Reg Replace is a plugin for Visual Studio Code that allows the creating of commands consisting of sequences of find and replace instructions.

It is heavily inspired from [Reg Replace for Sublime Text](https://github.com/facelessuser/RegReplace)

Often linters and code formatters cannot do this easily.
![usage](assets/usage.gif)

## Features

- Create find and replace rules that can then be used to create VSCode Commands to call at any time.
- Chain multiple regex find and replace rules together.
- Create rules that can filter regex results by filename or language.
- Create rules that run on save.
- Run rules on the current file, a folder, or the entire workspace.
- Pick all rules or a subset when running bulk operations.
- Skip cache folders, binary files, and non-text content during bulk runs.

## Commands

| Command                                | Description                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| **RegReplace: Run all**                | Apply all matching rules to the current file                                                 |
| **RegReplace: Run selected rules**     | Pick one or more rules, apply to the current file                                            |
| **RegReplace: Run on workspace...**    | Run on all workspace files (pick all or selected rules; confirm with Run or Run and save)    |
| **RegReplace: Run on folder...**       | Same as workspace, scoped to a folder (also available from the explorer folder context menu) |
| **RegReplace: Save without replacing** | Save the current file without triggering on-save rules                                       |

## Extension Settings

All settings use the `regreplace.` prefix in `settings.json`.

### General

* `regreplace.on-save` - defaults to `true`, run commands on save.
* `regreplace.suppress-warnings` - defaults to `false`, suppress warnings when regreplace fails.

### Bulk operations

These settings apply to **Run on workspace...** and **Run on folder...**. Defaults are pre-filled so common cache folders, binaries, and non-text files are skipped out of the box.

* `regreplace.bulk-include` - glob for files to include. Default: `"**/*"`.
* `regreplace.bulk-exclude-globs` - array of path globs to exclude. Defaults include `node_modules`, `.git`, `dist`, `out`, `build`, `.next`, `__pycache__`, `.venv`, `target`, `.turbo`, `.cache`, and other common cache/build/dependency folders.
* `regreplace.bulk-exclude-extensions` - array of file extensions to skip (include the dot). Defaults include image, audio, video, archive, font, and compiled binary extensions such as `.png`, `.pdf`, `.zip`, `.exe`, `.woff2`, `.wasm`.
* `regreplace.bulk-exclude-mime-types` - array of mime patterns to skip. Supports wildcards. Defaults include `image/*`, `audio/*`, `video/*`, `font/*`, `application/pdf`, `application/zip`, and `application/octet-stream`.
* `regreplace.bulk-text-only` - defaults to `true`. Skips files that look binary (contain null bytes). Catches unknown non-text files that don't match an extension or mime rule.
* `regreplace.bulk-exclude` - legacy glob exclude string, merged with `bulk-exclude-globs`. Prefer `bulk-exclude-globs`.

Bulk filtering runs in this order:

1. Path globs (`bulk-exclude-globs`, plus legacy `bulk-exclude`)
2. File extension blocklist
3. Mime type blocklist (inferred from extension)
4. Binary sniff when `bulk-text-only` is enabled

### Rules

* `regreplace.commands` - array of rules that run on save or when invoked manually.
  * `name` - rule name for debugging and the rule picker.
  * `match` - regex for matching files to run on. e.g. `"\\.(ts|js|tsx)$"` or `["\\.(ts|js|tsx)$"]`
  * `exclude` - regex for files *not* to run on. e.g. `"^\\.$"` to exclude dot files.
  * `language` - used instead of `match`; `exclude` still applies. e.g. `"typescript"`
  * `priority` - execution order (lower runs first).
  * `find` - simple literal find. e.g. `"** what"`
  * `regexp` - regexp find (needs escaping). e.g. `"(\\n)*"`
  * `replace` - replacement text. Supports groups. e.g. `"$2\n$1"`
  * `flags` - regexp flags. Defaults to `"g"`.
  * `global` - legacy option.

### Sample Config

Replace single quotes with double quotes in HTML files:

```json
"regreplace.commands": [
  {
    "name": "single to double quote",
    "match": "\\.html?$",
    "regexp": "(')(.*?)(')",
    "replace": "\"$2\""
  }
]
```

Classname helper for React:

```json
{
  "name": "classname helper",
  "language": "typescriptreact",
  "regexp": "className=\"(.+)\"",
  "replace": "className={styles.$1}"
}
```

Custom bulk exclusions:

```json
"regreplace.bulk-exclude-globs": [
  "**/node_modules/**",
  "**/my-cache/**"
],
"regreplace.bulk-exclude-extensions": [".png", ".lock"],
"regreplace.bulk-exclude-mime-types": ["image/*", "application/pdf"],
"regreplace.bulk-text-only": true
```

## CLI (Linux)

A standalone Python CLI applies the same rules to a folder without VS Code.

Install to `~/.local/bin`:

```bash
./cli/install-local.sh
```

Config lives at `~/.config/regreplace/config.json`. Rules use the same format as the extension (`commands` array with `match`, `regexp`, `find`, `replace`, `flags`, `priority`, `language`, `exclude`). You can copy `regreplace.commands` from VS Code settings into `"commands"`.

```bash
regreplace --init              # create default config
regreplace edit                # open config in $EDITOR (same as -e)
regreplace -e                  # edit config
regreplace -p ./src            # preview changes (per line)
regreplace ./src               # apply changes
regreplace -r "rule name" .     # run only named rules
regreplace -c ~/my-rules.json . # custom config path
```

Bulk exclusions (`bulk-exclude-globs`, `bulk-exclude-extensions`, `bulk-text-only`) match the extension defaults. Cache folders, binaries, and common media extensions are skipped automatically.

## Local install (VS Code extension)

To build and install this fork into VS Code (replacing any prior version):

```bash
./install-to-vscode.sh
```

Then reload VS Code (`Developer: Reload Window`).

## Known Issues

## Release Notes

### 1.4.0
- Add bulk operations: run on workspace or folder, with all rules or selected rules
- Add bulk file filtering: exclude globs, extensions, mime types, and binary files
- Simplify command palette (removed duplicate save/scope commands)
- Add `install-to-vscode.sh` for local VS Code install

### 1.3.0
- Use diff patching, so we can keep the cursor position
- Fix typos in readme, thanks @atnbueno
- Add language config, thanks @atnbueno
- Adding `RegReplace: Run single rule`, thanks @iammoen

### 1.2.0
- Fix readme

### 1.1.0
- Breaking Change: Renaming command `Run RegReplace` to `RegReplace: Run`
- Adding `RegReplace: Save without replacing`

### 1.0.0
- Initial release of regreplace.--------------------------------------------------------------------------------------------------------

## Licence
MIT License
