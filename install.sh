#!/bin/bash
set -e

# Bun installs to ~/.bun/bin; make sure it's reachable even if the user's
# shell hasn't exported it yet (covers "bun installed but not on PATH").
export PATH="$HOME/.bun/bin:$PATH"

# ─────────────────────────────────────────────
#  Bytebell — one-command setup (V1 / git-clone path)
#  Usage: curl -fsSL https://raw.githubusercontent.com/ByteBell/open-ir/main/install.sh | bash
# ─────────────────────────────────────────────

REPO_URL="https://github.com/ByteBell/open-ir"

# ── helpers ──────────────────────────────────

print_step() { echo ""; echo "▶  $1"; }
print_ok()   { echo "  ✓  $1"; }
print_err()  { echo ""; echo "  ✗  ERROR: $1" >&2; }
print_info() { echo "  •  $1"; }

# ── what this will do ────────────────────────

echo ""
echo "This installer will:"
echo "  • clone Bytebell into ./open-ir (the current directory)"
echo "  • add a global 'bytebell' command"
echo "  • install project dependencies"
echo ""
echo "Recommended default: embedded mode — runs from local files, no Docker required."

# ── 1. prerequisite checks ───────────────────

print_step "Checking prerequisites"

if ! command -v bun &>/dev/null; then
  print_err "Bun is not installed."
  echo ""
  echo "  Install it with:"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo "  then re-run this script."
  exit 1
fi
print_ok "Bun $(bun --version)"

# Docker is OPTIONAL. The recommended default (embedded mode: SQLite + Ladybug +
# Honker) runs entirely from local files under ~/.bytebell and needs no Docker.
# Docker is only required if you later pick the "Docker" infra mode (Mongo +
# Neo4j + Redis). So we probe for it but never block the install on it.

# `docker info` can hang if the daemon is wedged or mid-start, so cap it.
# Prefer GNU `timeout`/`gtimeout`; fall back to a plain call where neither exists.
check_docker_running() {
  if command -v timeout &>/dev/null; then
    timeout 10 docker info >/dev/null 2>&1
  elif command -v gtimeout &>/dev/null; then
    gtimeout 10 docker info >/dev/null 2>&1
  else
    docker info >/dev/null 2>&1
  fi
}

if command -v docker &>/dev/null && check_docker_running; then
  print_ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') — available if you choose Docker mode"
elif command -v docker &>/dev/null; then
  print_info "Docker is installed but not running — fine, the default embedded mode needs no Docker."
  print_info "Start Docker Desktop only if you want the optional Docker infra mode."
else
  print_info "Docker not found — fine, the recommended embedded mode needs no Docker."
  print_info "Install Docker Desktop later only if you want the optional Docker infra mode."
fi

if ! command -v git &>/dev/null; then
  print_err "git is not installed. Install it and retry."
  exit 1
fi
print_ok "git $(git --version | awk '{print $3}')"

# ── 2. clone ─────────────────────────────────

print_step "Cloning Bytebell"

if [ -d "open-ir/.git" ]; then
  print_info "existing install detected at open-ir/ — leaving it untouched (no git pull)"
else
  git clone "$REPO_URL"
fi
cd open-ir
REPO_DIR="$(pwd)"
print_ok "Repository ready"

# ── 3. install dependencies ───────────────────

print_step "Installing dependencies"
bun install --frozen-lockfile
print_ok "Dependencies installed"

# ── 4. wire the bytebell binary ──────────────
#  Symlinking the .ts entry directly is fragile — it relies on the shebang,
#  the executable bit, and bun's PATH resolution all lining up. A tiny wrapper
#  that execs `bun run` against the absolute entry path is reliable from any cwd.

print_step "Wiring bytebell binary"
BUN_PATH="$(command -v bun)"
BIN_DIR="$(dirname "$BUN_PATH")"
ENTRY="$REPO_DIR/packages/cli/src/index.ts"
cat > "$BIN_DIR/bytebell" <<EOF
#!/bin/bash
exec "$BUN_PATH" run "$ENTRY" "\$@"
EOF
chmod +x "$BIN_DIR/bytebell"
print_ok "bytebell → $ENTRY"

if command -v bytebell >/dev/null 2>&1; then
  print_ok "bytebell command available"
else
  print_info "bytebell isn't on your PATH yet — add this line to your shell profile:"
  echo "    export PATH=\"$BIN_DIR:\$PATH\""
fi

# ── 5. done ───────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "  Bytebell installed!"
echo ""
echo "  Run the setup wizard to configure your LLM provider and boot:"
echo ""
echo "    bytebell setup"
echo ""
echo "  Commands reference:"
echo "    https://github.com/ByteBell/open-ir/blob/main/docs/commands.md"
echo "════════════════════════════════════════"
echo ""
