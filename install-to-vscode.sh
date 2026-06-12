#!/usr/bin/env bash
# Build and install this extension into VS Code, replacing any prior version.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PUBLISHER="$(node -p "require('./package.json').publisher.toLowerCase()")"
NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
EXT_ID="${PUBLISHER}.${NAME}-${VERSION}"
TARGET="${SCRIPT_DIR}"
EXTENSIONS_DIR="${HOME}/.vscode/extensions"

usage() {
	cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build regreplace and install it into VS Code (~/.vscode/extensions),
removing any previous version first.

Options:
  --link          Symlink source tree (default, best for development)
  --copy          Copy built extension instead of symlinking
  --force-build   Run npm install even when node_modules exists
  --skip-build    Skip TypeScript compile (use existing out/ directory)
  -h, --help      Show this help

After install, reload VS Code (Command Palette -> "Developer: Reload Window").
EOF
}

INSTALL_METHOD="link"
FORCE_BUILD=0
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--link) INSTALL_METHOD="link" ;;
		--copy) INSTALL_METHOD="copy" ;;
		--force-build) FORCE_BUILD=1 ;;
		--skip-build) SKIP_BUILD=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
	esac
	shift
done

echo "==> Installing ${EXT_ID} into VS Code from ${TARGET}"

if ! command -v npm >/dev/null 2>&1; then
	echo "Error: npm is required but not found." >&2
	exit 1
fi

echo "==> Installing npm dependencies"
if [[ -d node_modules && "$FORCE_BUILD" -eq 0 ]]; then
	echo "    (node_modules present, skipping npm install - use --force-build to reinstall)"
else
	npm install
fi

echo "==> Compiling TypeScript"
if [[ "$SKIP_BUILD" -eq 1 ]]; then
	echo "    (--skip-build: using existing out/ directory)"
else
	npm run vscode:prepublish
fi

mkdir -p "$EXTENSIONS_DIR"

shopt -s nullglob
old_installs=( "${EXTENSIONS_DIR}/${PUBLISHER}.${NAME}"* )
shopt -u nullglob

if ((${#old_installs[@]})); then
	echo "==> Removing previous installs in ${EXTENSIONS_DIR}:"
	printf '    %s\n' "${old_installs[@]}"
	rm -rf "${old_installs[@]}"
fi

dest="${EXTENSIONS_DIR}/${EXT_ID}"

if [[ "$INSTALL_METHOD" == "link" ]]; then
	ln -sfn "$TARGET" "$dest"
	echo "==> Linked ${dest} -> ${TARGET}"
else
	rm -rf "$dest"
	mkdir -p "$dest"
	rsync -a \
		--exclude node_modules \
		--exclude .git \
		--exclude .vscode \
		--exclude test \
		"$TARGET"/ "$dest"/
	echo "==> Copied extension to ${dest}"
fi

cat <<EOF

Done. Installed ${EXT_ID} into VS Code.

Reload VS Code: Command Palette -> "Developer: Reload Window"
Then run "RegReplace" commands from the Command Palette.

EOF
