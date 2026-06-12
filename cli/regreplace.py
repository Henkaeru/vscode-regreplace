#!/usr/bin/env python3
"""RegReplace CLI - apply regex rules from a config file to a folder."""

from __future__ import annotations

import argparse
import difflib
import json
import os
try:
    import regex as re
except ImportError:
    import re  # type: ignore[no-redef]
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "regreplace" / "config.json"

DEFAULT_EXCLUDE_DIRS = {
    ".git", ".svn", ".hg", "node_modules", "dist", "out", "build", ".next", ".nuxt",
    ".svelte-kit", ".angular", ".docusaurus", ".cache", ".parcel-cache", ".vite",
    ".turbo", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
    ".venv", "venv", ".npm", ".yarn", ".pnpm-store", "bower_components", "target",
    ".gradle", ".idea", ".vs", "coverage", ".nyc_output", ".terraform", ".serverless",
}

DEFAULT_EXCLUDE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tif", ".tiff",
    ".heic", ".avif", ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".avi", ".mov",
    ".mkv", ".flac", ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".bz2", ".xz",
    ".jar", ".war", ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".wasm",
    ".class", ".pyc", ".pyo", ".o", ".a", ".lib", ".obj", ".woff", ".woff2",
    ".ttf", ".otf", ".eot", ".sqlite", ".sqlite3", ".db",
}

EXT_TO_LANGUAGE = {
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".jsx": "javascriptreact", ".ts": "typescript", ".tsx": "typescriptreact",
    ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java",
    ".html": "html", ".htm": "html", ".css": "css", ".scss": "scss",
    ".json": "json", ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
    ".sh": "shellscript", ".bash": "shellscript", ".xml": "xml",
    ".vue": "vue", ".svelte": "svelte",
}


@dataclass
class Change:
    path: Path
    line: int
    action: str
    old: str
    new: str


def config_dir() -> Path:
    return DEFAULT_CONFIG.parent


def default_config_text() -> str:
    example = Path(__file__).with_name("config.example.json")
    if example.is_file():
        return example.read_text(encoding="utf-8")
    return '{\n  "commands": []\n}\n'


def ensure_config(path: Path) -> Path:
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(default_config_text(), encoding="utf-8")
    return path


def load_config(path: Path) -> dict[str, Any]:
    ensure_config(path)
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    commands = data.get("commands") or data.get("regreplace.commands") or []
    if not isinstance(commands, list):
        raise SystemExit("Config error: commands must be an array")

    return {
        "commands": commands,
        "exclude_dirs": set(DEFAULT_EXCLUDE_DIRS),
        "exclude_extensions": set(
            ext.lower() if ext.startswith(".") else f".{ext.lower()}"
            for ext in (data.get("bulk-exclude-extensions") or data.get("regreplace.bulk-exclude-extensions") or DEFAULT_EXCLUDE_EXTENSIONS)
        ),
        "exclude_globs": data.get("bulk-exclude-globs") or data.get("regreplace.bulk-exclude-globs") or [],
        "text_only": data.get("bulk-text-only", data.get("regreplace.bulk-text-only", True)),
    }


def glob_part_excluded(path: Path, globs: list[str]) -> bool:
    parts = path.parts
    for pattern in globs:
        p = pattern.strip()
        if not p:
            continue
        p = p.removeprefix("**/").removesuffix("/**").strip("/")
        if p.startswith("*."):
            if path.name.endswith(p[1:]):
                return True
        elif p in parts:
            return True
    return False


def should_process(path: Path, cfg: dict[str, Any]) -> bool:
    if not path.is_file():
        return False
    if path.suffix.lower() in cfg["exclude_extensions"]:
        return False
    if any(part in cfg["exclude_dirs"] for part in path.parts):
        return False
    if glob_part_excluded(path, cfg["exclude_globs"]):
        return False
    if cfg["text_only"] and looks_binary(path):
        return False
    return True


def looks_binary(path: Path, sample_size: int = 8192) -> bool:
    with path.open("rb") as fh:
        chunk = fh.read(sample_size)
    return b"\0" in chunk


def language_for(path: Path) -> str:
    return EXT_TO_LANGUAGE.get(path.suffix.lower(), "plaintext")


def file_matches(pattern: str, path: Path) -> bool:
    return bool(re.search(pattern, str(path)))


def rule_applies(rule: dict[str, Any], path: Path) -> bool:
    exclude = rule.get("exclude") or ""
    if isinstance(exclude, list):
        if any(file_matches(p, path) for p in exclude if p):
            return False
    elif exclude and file_matches(exclude, path):
        return False

    language = rule.get("language")
    if language is not None:
        lang = language_for(path)
        if isinstance(language, list):
            return lang in language
        return lang == language

    match = rule.get("match") or ""
    if isinstance(match, list):
        return any(not p or file_matches(p, path) for p in match)
    return not match or file_matches(match, path)


def js_replace_to_python(replace: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(replace):
        ch = replace[i]
        if ch != "$":
            out.append(ch)
            i += 1
            continue
        if i + 1 < len(replace) and replace[i + 1] == "$":
            out.append("$")
            i += 2
            continue
        if i + 1 < len(replace) and replace[i + 1] == "&":
            out.append(r"\g<0>")
            i += 2
            continue
        if i + 1 < len(replace) and replace[i + 1].isdigit():
            j = i + 1
            while j < len(replace) and replace[j].isdigit():
                j += 1
            out.append(f"\\g<{replace[i + 1:j]}>")
            i = j
            continue
        out.append("$")
        i += 1
    return "".join(out)


def compile_flags(flags: str) -> int:
    value = 0
    if "i" in flags:
        value |= re.IGNORECASE
    if "m" in flags:
        value |= re.MULTILINE
    if "s" in flags:
        value |= re.DOTALL
    if "u" in flags and hasattr(re, "UNICODE"):
        value |= re.UNICODE
    return value


def apply_substitution(pattern: str, replace: str, text: str, flags_str: str) -> str:
    flags = compile_flags(flags_str or "g")
    count = 0 if "g" in (flags_str or "g") else 1
    if "\\p{" in pattern and re.__name__ == "re":
        raise re.error(
            "Unicode property classes (\\p{...}) require the 'regex' package: pip install regex"
        )
    return re.sub(pattern, js_replace_to_python(replace), text, count=count, flags=flags)


def apply_rules(text: str, rules: list[dict[str, Any]]) -> str:
    result = text
    for rule in rules:
        if rule.get("regexp"):
            pattern = rule["regexp"]
        elif rule.get("find"):
            pattern = re.escape(rule["find"])
        else:
            continue

        replace = rule.get("replace")
        if replace is None:
            continue

        flags_str = rule.get("flags") or "g"
        try:
            result = apply_substitution(pattern, replace, result, flags_str)
        except re.error as exc:
            name = rule.get("name") or "unnamed rule"
            raise SystemExit(f"Regex error in rule '{name}': {exc}") from exc
    return result


def active_rules(cfg: dict[str, Any], path: Path, only: set[str] | None) -> list[dict[str, Any]]:
    rules = [r for r in cfg["commands"] if rule_applies(r, path)]
    if only:
        rules = [r for r in rules if (r.get("name") or "") in only]
    rules.sort(key=lambda r: r.get("priority") or 0)
    return rules


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in DEFAULT_EXCLUDE_DIRS]
        for name in filenames:
            files.append(Path(dirpath) / name)
    return files


def diff_changes(path: Path, old: str, new: str) -> list[Change]:
    if old == new:
        return []

    old_lines = old.splitlines()
    new_lines = new.splitlines()
    changes: list[Change] = []
    line = 1

    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old_lines, new_lines).get_opcodes():
        if tag == "equal":
            line += i2 - i1
            continue
        if tag == "replace":
            for offset in range(max(i2 - i1, j2 - j1)):
                old_text = old_lines[i1 + offset] if i1 + offset < i2 else ""
                new_text = new_lines[j1 + offset] if j1 + offset < j2 else ""
                changes.append(Change(path, line + offset, "replace", old_text, new_text))
            line += i2 - i1
        elif tag == "delete":
            for idx in range(i1, i2):
                changes.append(Change(path, line, "delete", old_lines[idx], ""))
                line += 1
        elif tag == "insert":
            for idx in range(j1, j2):
                changes.append(Change(path, line, "insert", "", new_lines[idx]))

    return changes


def print_changes(changes: list[Change]) -> None:
    current: Path | None = None
    for ch in changes:
        if ch.path != current:
            current = ch.path
            print(f"\n{ch.path}")
        print(f"  L{ch.line} {ch.action}")
        if ch.action in ("replace", "delete") and ch.old:
            print(f"    - {ch.old}")
        if ch.action in ("replace", "insert") and ch.new:
            print(f"    + {ch.new}")


def edit_config(path: Path) -> int:
    ensure_config(path)
    editor = os.environ.get("EDITOR") or os.environ.get("VISUAL") or "nano"
    return subprocess.call([editor, str(path)])


def run(root: Path, config_path: Path, preview: bool, only: set[str] | None) -> int:
    cfg = load_config(config_path)
    if not cfg["commands"]:
        print(f"No rules in {config_path}", file=sys.stderr)
        return 1

    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 1

    all_changes: list[Change] = []
    changed_files = 0
    scanned = 0

    for path in iter_files(root):
        if not should_process(path, cfg):
            continue
        rules = active_rules(cfg, path, only)
        if not rules:
            continue

        scanned += 1
        try:
            old = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        new = apply_rules(old, rules)
        if old == new:
            continue

        file_changes = diff_changes(path, old, new)
        all_changes.extend(file_changes)
        if not preview:
            path.write_text(new, encoding="utf-8")
        changed_files += 1

    if preview:
        if not all_changes:
            print("No changes.")
            return 0
        print_changes(all_changes)
        print(f"\n{changed_files} file(s) would change ({scanned} scanned).")
        return 0

    print(f"Done: {changed_files} file(s) changed ({scanned} scanned).")
    return 0


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    if argv and argv[0] == "edit":
        config = Path(DEFAULT_CONFIG)
        i = 1
        while i < len(argv):
            if argv[i] in ("-c", "--config") and i + 1 < len(argv):
                config = Path(argv[i + 1])
                i += 2
            else:
                i += 1
        return edit_config(config)

    parser = argparse.ArgumentParser(
        prog="regreplace",
        description="Apply regreplace rules from a config file to a folder.",
    )
    parser.add_argument("folder", nargs="?", type=Path, help="Folder to process (default: current directory)")
    parser.add_argument("-c", "--config", type=Path, default=DEFAULT_CONFIG, help=f"Config file (default: {DEFAULT_CONFIG})")
    parser.add_argument("-e", "--edit", action="store_true", help="Edit the config file with $EDITOR")
    parser.add_argument("-p", "--preview", action="store_true", help="Preview changes without writing files")
    parser.add_argument("-r", "--rule", action="append", dest="rules", metavar="NAME", help="Run only rules with this name (repeatable)")
    parser.add_argument("--init", action="store_true", help="Create default config and exit")

    args = parser.parse_args(argv)

    if args.init:
        path = ensure_config(args.config)
        print(f"Config ready at {path}")
        return 0

    if args.edit:
        return edit_config(args.config)

    root = args.folder or Path.cwd()
    only = set(args.rules) if args.rules else None
    return run(root, args.config, args.preview, only)


if __name__ == "__main__":
    raise SystemExit(main())
