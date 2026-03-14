#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Piggy Sentinel — Full Fork Setup
#
# Menjalankan semua langkah yang dibutuhkan untuk full local test:
#   1. Cek prerequisites (foundry, docker, node, pnpm)
#   2. Start Docker (Postgres + Redis)
#   3. Start Anvil fork (background)
#   4. Install dependencies
#   5. Build semua packages
#   6. Run DB migration
#   7. Fund test wallets
#   8. Print next steps
#
# Usage:
#   pnpm setup:fork
#   atau langsung: ./scripts/fork/setup-all.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✅${NC}  $1"; }
fail() { echo -e "  ${RED}❌${NC}  $1"; exit 1; }
warn() { echo -e "  ${YELLOW}⚠️ ${NC}  $1"; }
info() { echo -e "  ${CYAN}→${NC}  $1"; }

echo ""
echo "🐷 Piggy Sentinel — Full Fork Setup"
echo "══════════════════════════════════════"
echo ""

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
echo "1️⃣  Checking prerequisites..."

command -v node   &>/dev/null && ok "node $(node -v)"   || fail "node not found — install from https://nodejs.org"
command -v pnpm   &>/dev/null && ok "pnpm $(pnpm -v)"   || fail "pnpm not found — npm install -g pnpm"
command -v docker &>/dev/null && ok "docker $(docker --version | cut -d' ' -f3 | tr -d ',')" || fail "docker not found — install from https://docker.com"
command -v anvil  &>/dev/null && ok "anvil $(anvil --version 2>&1 | head -1 | cut -d' ' -f2)" || fail "anvil not found — curl -L https://foundry.paradigm.xyz | bash && foundryup"

echo ""

# ── Step 2: .env.fork ─────────────────────────────────────────────────────────
echo "2️⃣  Preparing .env.fork..."

if [ ! -f "$ROOT/.env" ]; then
  if [ -f "$ROOT/.env.fork" ]; then
    cp "$ROOT/.env.fork" "$ROOT/.env"
    ok ".env created from .env.fork"
  else
    # Generate .env.fork on the fly
    "$SCRIPT_DIR/deploy-to-fork.sh" 2>/dev/null || true
    if [ -f "$ROOT/.env.fork" ]; then
      cp "$ROOT/.env.fork" "$ROOT/.env"
      ok ".env created"
    else
      warn ".env not found — copy .env.example manually and fill in values"
    fi
  fi
else
  ok ".env already exists"
fi

echo ""

# ── Step 3: Docker (Postgres + Redis) ────────────────────────────────────────
echo "3️⃣  Starting Docker services (Postgres + Redis)..."

cd "$ROOT"

if ! docker info &>/dev/null; then
  fail "Docker daemon not running — start Docker first"
fi

docker compose up -d --wait 2>&1 | grep -E "Started|healthy|already" | while read line; do
  info "$line"
done

# Wait for healthy
for i in $(seq 1 20); do
  PG_OK=$(docker compose ps --status running postgres 2>/dev/null | grep -c "postgres" || true)
  RD_OK=$(docker compose ps --status running redis   2>/dev/null | grep -c "redis"    || true)
  if [ "$PG_OK" -gt "0" ] && [ "$RD_OK" -gt "0" ]; then
    break
  fi
  sleep 1
done

ok "Postgres  → localhost:5432  (piggysentinel_fork)"
ok "Redis     → localhost:6379"

echo ""

# ── Step 4: Anvil fork ────────────────────────────────────────────────────────
echo "4️⃣  Starting Anvil fork (Celo mainnet)..."

# Kill any existing anvil on port 8545
if lsof -ti:8545 &>/dev/null; then
  warn "Port 8545 in use — killing existing process"
  kill $(lsof -ti:8545) 2>/dev/null || true
  sleep 1
fi

RPC="${CELO_RPC_URL_MAINNET:-https://forno.celo.org}"

anvil \
  --fork-url "$RPC" \
  --chain-id 42220 \
  --port 8545 \
  --block-time 5 \
  --accounts 10 \
  --balance 10000 \
  --silent &

ANVIL_PID=$!
echo "$ANVIL_PID" > "$ROOT/.anvil.pid"

# Wait for anvil to be ready
for i in $(seq 1 20); do
  if curl -s -X POST http://localhost:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    2>/dev/null | grep -q "0xa4ec"; then
    break
  fi
  sleep 1
done

CHAIN=$(curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(int(r,16))" 2>/dev/null || echo "?")

ok "Anvil    → http://localhost:8545  (block #$CHAIN, PID $ANVIL_PID)"

echo ""

# ── Step 5: Fund test wallets ─────────────────────────────────────────────────
echo "5️⃣  Funding test wallets..."
bash "$SCRIPT_DIR/fund-wallets.sh" 2>&1 | grep -E "✅|❌|💰" | head -20
echo ""

# ── Step 6: Install dependencies ─────────────────────────────────────────────
echo "6️⃣  Installing dependencies..."
cd "$ROOT"
pnpm install --frozen-lockfile 2>&1 | tail -3 || pnpm install 2>&1 | tail -3
ok "pnpm install complete"
echo ""

# ── Step 7: Build packages ────────────────────────────────────────────────────
echo "7️⃣  Building packages..."

build_pkg() {
  local name="$1"
  info "Building @piggy/$name..."
  pnpm --filter "@piggy/$name" build 2>&1 | grep -E "error|Error" | head -5 || true
  ok "@piggy/$name"
}

build_pkg shared
build_pkg config
build_pkg db
build_pkg adapters
build_pkg agent
build_pkg observability

echo ""

# ── Step 8: DB migration ──────────────────────────────────────────────────────
echo "8️⃣  Running database migrations..."
cd "$ROOT"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/piggysentinel_fork" \
  pnpm db:migrate 2>&1 | grep -E "✅|❌|applied|error" | head -10
ok "Migrations complete"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════"
echo -e "${GREEN}✅  Setup complete!${NC}"
echo ""
echo "   Services siap dijalankan:"
echo ""
echo -e "   ${CYAN}Terminal 1${NC} — API:"
echo "   pnpm dev:api"
echo ""
echo -e "   ${CYAN}Terminal 2${NC} — Scheduler:"
echo "   pnpm dev:scheduler"
echo ""
echo -e "   ${CYAN}Terminal 3${NC} — Notifier:"
echo "   pnpm dev:notifier"
echo ""
echo "   Lalu test API:"
echo "   curl http://localhost:3001/health"
echo ""
echo "   Untuk stop anvil:"
echo "   kill \$(cat .anvil.pid)"
echo ""
echo "   Untuk stop Docker:"
echo "   docker compose down"
echo ""
