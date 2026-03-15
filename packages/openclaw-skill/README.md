# PiggySentinel — OpenClaw Setup

Penny runs as an OpenClaw agent. OpenClaw handles all Telegram communication and AI reasoning. `SOUL.md` defines her personality and limits. `AGENTS.md` defines her step-by-step operating instructions.

## Architecture

```
User → Telegram → OpenClaw
                    │ reads SOUL.md + AGENTS.md
                    ↓ calls
       ${PIGGY_API_URL}/api/goals/*, /api/telegram/*, /api/chat

Separately — the notifier service pushes proactive alerts:
Penny → Telegram Bot API
(goal reached, circuit breaker fired, rebalance completed)
```

**OpenClaw = inbound** (user messages Penny).
**Notifier = outbound** (Penny messages user unprompted).
These are separate services.

## Setup

### 1. Install OpenClaw

```bash
npm install -g openclaw
```

Requires Node 22+.

### 2. Create a Telegram bot

Open Telegram → search `@BotFather` → `/newbot` → copy the token.

### 3. Configure OpenClaw

```bash
mkdir -p ~/.openclaw

# Copy config
cp packages/openclaw-skill/openclaw.json ~/.openclaw/openclaw.json

# Copy workspace (SOUL.md + AGENTS.md)
cp -r packages/openclaw-skill/workspace ~/.openclaw/workspace
```

Edit `~/.openclaw/openclaw.json` — replace `${TELEGRAM_BOT_TOKEN}` with your real token, or set the env var before starting.

Edit `~/.openclaw/workspace/AGENTS.md` — replace `${PIGGY_API_URL}` with your deployed API URL.

### 4. Set your Anthropic API key

OpenClaw needs an Anthropic API key to power Penny's reasoning:

```bash
openclaw onboard
# wizard will ask for your Anthropic API key
```

Or set it directly:

```bash
openclaw config set agents.defaults.apiKey sk-ant-...
```

**Note:** This key is separate from the `CLAUDE_API_KEY` in Piggy's `.env` (used for the `/api/chat` endpoint). Both can share the same key or use different ones.

### 5. Set environment variables

```
TELEGRAM_BOT_TOKEN=<from @BotFather>
OPENCLAW_API_KEY=<from OpenClaw dashboard>
PIGGY_API_URL=<PiggySentinel API base URL>
```

### 6. Start Penny

```bash
openclaw gateway
```

### 7. Start notifier service

In a separate terminal, from the piggy-sentinel root:

```bash
pnpm dev:notifier
```

Requires `TELEGRAM_BOT_TOKEN` set to the same token.

### 8. Test

DM your bot on Telegram. Try `/status` or just say hello.

## Workspace files

| File | Purpose |
|---|---|
| `openclaw.json` | OpenClaw config — copy to `~/.openclaw/openclaw.json` |
| `workspace/SOUL.md` | Who Penny is, how she speaks, what she will never do |
| `workspace/AGENTS.md` | Exact instructions for every message type she handles |

## Notes

- `dmPolicy: "open"` allows any Telegram user to DM Penny (needed for multi-user)
- Penny's session is per-sender — each user has isolated conversation history
- Proactive alerts (circuit breaker, goal completed, rebalance done) come from the notifier service, not OpenClaw
