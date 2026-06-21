# 🎤 Debate Arena

Real-time 2-minute video debates with strangers. Built with Node.js, Socket.io, and WebRTC.

---

## What's Real
- ✅ Real player count (live online users)
- ✅ Real matchmaking queue (matched with actual strangers)
- ✅ Real video calls (WebRTC peer-to-peer)
- ✅ Real leaderboard (wins/losses tracked per session)
- ✅ Real timer synced server-side (both players see same clock)
- ✅ Real squad codes (invite a teammate)
- ✅ +30s extensions broadcast to both players

---

## Deploy to Railway (FREE, 5 minutes)

### Step 1 — Create a GitHub repo
1. Go to github.com → New repository → name it `debate-arena`
2. Upload ALL files in this folder (drag & drop works)
3. Make sure the structure looks like:
   ```
   debate-arena/
   ├── server.js
   ├── package.json
   ├── railway.toml
   └── public/
       └── index.html
   ```

### Step 2 — Deploy on Railway
1. Go to **railway.app** and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `debate-arena` repo
4. Railway auto-detects Node.js and deploys
5. Click **Settings → Networking → Generate Domain**
6. You get a live URL like `debate-arena-production.up.railway.app`

### Step 3 — Share it
Send your Railway URL to friends. That's it — real video debates.

---

## Run Locally (for testing)

```bash
cd debate-arena
npm install
node server.js
```

Then open http://localhost:3000 in TWO different browser tabs to test matchmaking.

---

## File Structure

| File | What it does |
|------|-------------|
| `server.js` | Node.js backend — matchmaking, timer, WebRTC signaling, leaderboard |
| `public/index.html` | Full frontend — all UI, WebRTC video, Socket.io client |
| `package.json` | Dependencies (express, socket.io, uuid) |
| `railway.toml` | Railway deployment config |

---

## Notes
- Video is peer-to-peer (WebRTC) — Debate Arena server never sees your video
- Leaderboard resets when server restarts (add a database like Supabase for persistence)
- For production, add a TURN server for users behind strict firewalls
