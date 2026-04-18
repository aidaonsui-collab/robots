# OpenClaw Bridge Setup

## Quick Start

### 1. Install Dependencies
```bash
cd theodyssey2
npm install express cors dotenv --save-dev
```

### 2. Start OpenClaw (Terminal 1)
```bash
openclaw dev
```

### 3. Start Bridge (Terminal 2)
```bash
cd theodyssey2
./scripts/start-bridge.sh
# Or: node scripts/odyssey-openclaw-bridge.js
```

### 4. Test It
```bash
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "hello", "agentId": "test"}'
```

## How It Works

```
Dashboard → /api/agents/:id/chat → Bridge (port 3001) → OpenClaw CLI → AI Response
```

The bridge:
- Listens on `http://localhost:3001`
- Receives messages from dashboard
- Calls OpenClaw via CLI or falls back to smart responses
- Returns responses to dashboard

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /chat | Send a message, get response |
| GET | /status | Check if bridge is running |
| POST | /spawn | Start an agent session |
| DELETE | /stop/:id | Stop an agent session |

## Troubleshooting

**"openclaw not found"**
- Install: `npm install -g openclaw`

**Response is slow**
- The bridge has a 30s timeout
- Falls back to smart responses if OpenClaw is slow

**No response**
- Make sure both OpenClaw and bridge are running
- Check port 3001 is not in use

## For Production

To make this work in production:
1. Deploy bridge to a server (Railway, VPS, etc.)
2. Keep OpenClaw running on that server (use PM2)
3. Point the dashboard API to your bridge URL
4. Or use OpenClaw's hosted version if available