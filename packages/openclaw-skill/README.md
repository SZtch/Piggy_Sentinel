# Piggy Sentinel — OpenClaw Setup

Penny runs as an OpenClaw agent. OpenClaw handles all Telegram communication.
The notifier service (`services/notifier/`) pushes proactive alerts separately via Telegram Bot API.

## Architecture

```
User → Telegram → OpenClaw (reads SOUL.md + AGENTS.md)
                      ↓ calls Piggy API
              /api/goals/*, /api/chat
                      ↑
         Notifier service → Telegram Bot API (proactive alerts)
```

---

## Setup

### 1. Install OpenClaw

```bash
npm install -g openclaw

# Or via installer script
curl -fsSL https://openclaw.ai/install.sh | bash
```

Requires Node 22+.

### 2. Create Telegram bot

1. Open Telegram → search `@BotFather` → `/newbot`
2. Copy the bot token

### 3. Configure OpenClaw

```bash
mkdir -p ~/.openclaw

# Copy config
cp packages/openclaw-skill/openclaw.json ~/.openclaw/openclaw.json

# Copy Penny's workspace files
cp -r packages/openclaw-skill/workspace ~/.openclaw/workspace
```

Edit `~/.openclaw/openclaw.json` and replace `${TELEGRAM_BOT_TOKEN}` with your real token,
or set the env var `TELEGRAM_BOT_TOKEN` before starting.

Edit `~/.openclaw/workspace/AGENTS.md` and replace `${PIGGY_API_URL}` with your deployed API URL.

### 4. Set CLAUDE_API_KEY for OpenClaw

OpenClaw needs an Anthropic API key to power Penny's reasoning:

```bash
openclaw onboard
# wizard will ask for your Anthropic API key
```

Or set it directly:
```bash
openclaw config set agents.defaults.apiKey sk-ant-...
```

### 5. Start OpenClaw gateway

```bash
openclaw gateway
```

Test it: DM your bot on Telegram and say "hello".

### 6. Start notifier service

In a separate terminal, from the piggy-sentinel root:

```bash
pnpm dev:notifier
```

Required env var:
```
TELEGRAM_BOT_TOKEN=<same token>
```

---

## Files

| File | Purpose |
|---|---|
| `openclaw.json` | OpenClaw config — copy to `~/.openclaw/openclaw.json` |
| `workspace/SOUL.md` | Penny's persona and values |
| `workspace/AGENTS.md` | Operating instructions + Piggy API reference |

---

## Notes

- `dmPolicy: "open"` allows any Telegram user to DM Penny (needed for multi-user)
- Penny's session is per-sender — each user has isolated conversation history
- `CLAUDE_API_KEY` in Piggy's `.env` is separate from OpenClaw's API key
  - OpenClaw uses it for Penny's Telegram reasoning
  - Piggy uses it for the `/api/chat` endpoint
- Both can share the same key or use different ones
