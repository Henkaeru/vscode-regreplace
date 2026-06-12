#!/usr/bin/env bash
# Install regreplace CLI to ~/.local/bin
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/share/regreplace"
BIN_DIR="${HOME}/.local/bin"
BIN="${BIN_DIR}/regreplace"

if not command -v python3 >/dev/null 2>&1; then
	echo "Error: python3 is required." >&2
	exit 1
fi

if ! python3 -c "import regex" >/dev/null 2>&1; then
	echo "Installing python 'regex' package (needed for \\\\p{...} emoji rules)..."
	pip install --user regex
fi

cp "${SCRIPT_DIR}/regreplace.py" "${INSTALL_DIR}/regreplace.py"
cp "${SCRIPT_DIR}/config.example.json" "${INSTALL_DIR}/config.example.json"
chmod +x "${INSTALL_DIR}/regreplace.py"

cat > "$BIN" <<EOF
#!/usr/bin/env bash
exec python3 "${INSTALL_DIR}/regreplace.py" "\$@"
EOF
chmod +x "$BIN"

if ! echo ":$PATH:" | grep -q ":${BIN_DIR}:"; then
	echo "Note: add ${BIN_DIR} to your PATH if needed."
fi

echo "Installed: ${BIN}"
echo "Config:    \${XDG_CONFIG_HOME:-\$HOME/.config}/regreplace/config.json"
echo ""
echo "Usage:"
echo "  regreplace --init          # create default config"
echo "  regreplace edit            # edit config (\$EDITOR)"
echo "  regreplace -e              # same as edit"
echo "  regreplace -p .            # preview changes in current folder"
echo "  regreplace ./src           # run on a folder"
