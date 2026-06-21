const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── IN-MEMORY STATE ──
const queue = [];           // solo matchmaking queue
const squadQueue = [];      // squad matchmaking queue
const rooms = {};           // active debate rooms
const squads = {};          // squad code → { members: [], ready: false }
const leaderboard = {};     // playerId → { name, wins, losses, xp, streak }

function getOnlineCount() {
  return io.engine.clientsCount;
}

function broadcastStats() {
  io.emit('stats', { online: getOnlineCount(), activeRooms: Object.keys(rooms).length });
}

// ── TOPICS ──
const TOPICS = [
  "Pineapple on Pizza — yes or no?",
  "Cats vs Dogs — which is better?",
  "What's the greatest sport of all time?",
  "Is social media doing more harm than good?",
  "Should schools ban homework?",
  "Is a hot dog a sandwich?",
  "Mornings vs Nights — which is more productive?",
  "Fast food vs home cooking?",
  "Should video games be considered a sport?",
  "Is space exploration worth the cost?",
  "Marvel vs DC — who wins?",
  "Should TikTok be banned?",
  "Is college worth it anymore?",
  "AI: friend or threat to humanity?",
];

function randomTopic() {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

// ── SOCKET LOGIC ──
io.on('connection', (socket) => {
  console.log(`+ connected: ${socket.id}`);
  broadcastStats();

  // Send current leaderboard on connect
  socket.emit('leaderboard', buildLeaderboard());

  // ── SOLO MATCHMAKING ──
  socket.on('join_queue', ({ name }) => {
    socket.playerName = name || 'Debater';
    socket.playerId = socket.id;

    // Init leaderboard entry
    if (!leaderboard[socket.id]) {
      leaderboard[socket.id] = { name: socket.playerName, wins: 0, losses: 0, xp: 0, streak: 0 };
    } else {
      leaderboard[socket.id].name = socket.playerName;
    }

    // Remove from queue if already in it
    const existing = queue.findIndex(s => s.id === socket.id);
    if (existing !== -1) queue.splice(existing, 1);

    if (queue.length > 0) {
      const opponent = queue.shift();
      const roomId = uuidv4();
      const topic = randomTopic();

      rooms[roomId] = {
        id: roomId,
        players: [opponent.id, socket.id],
        topic,
        round: 1,
        extendCount: { [opponent.id]: 0, [socket.id]: 0 },
        votes: {},
        timer: null,
        secsLeft: 120,
      };

      socket.join(roomId);
      opponent.join(roomId);

      socket.roomId = roomId;
      opponent.roomId = roomId;

      io.to(roomId).emit('match_found', {
        roomId,
        topic,
        players: [
          { id: opponent.id, name: opponent.playerName },
          { id: socket.id,   name: socket.playerName },
        ],
        speakingFirst: opponent.id,
      });

      startRoomTimer(roomId);
      broadcastStats();
    } else {
      queue.push(socket);
      socket.emit('waiting', { position: queue.length });
    }
  });

  // ── SQUAD: CREATE ──
  socket.on('create_squad', ({ name, squadName }) => {
    socket.playerName = name || 'Debater';
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    squads[code] = { code, name: squadName || 'Squad', members: [socket], ready: false };
    socket.squadCode = code;
    socket.emit('squad_created', { code, squadName: squads[code].name });
  });

  // ── SQUAD: JOIN ──
  socket.on('join_squad', ({ name, code }) => {
    socket.playerName = name || 'Debater';
    const sq = squads[code.toUpperCase()];
    if (!sq) { socket.emit('squad_error', 'Squad code not found.'); return; }
    if (sq.members.length >= 2) { socket.emit('squad_error', 'Squad is full.'); return; }
    sq.members.push(socket);
    socket.squadCode = code.toUpperCase();
    // Notify both members
    sq.members.forEach(m => m.emit('squad_updated', {
      code: sq.code,
      members: sq.members.map(s => ({ id: s.id, name: s.playerName })),
      full: sq.members.length === 2,
    }));
    // If squad is full, add to squad queue
    if (sq.members.length === 2) {
      sq.ready = true;
      squadQueue.push(sq);
      tryMatchSquads();
    }
  });

  // ── WebRTC SIGNALING ──
  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  // ── EXTEND TIMER ──
  socket.on('extend_timer', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const used = room.extendCount[socket.id] || 0;
    if (used >= 2) { socket.emit('extend_denied', 'Max 2 extensions per round.'); return; }
    room.extendCount[socket.id] = used + 1;
    room.secsLeft += 30;
    io.to(roomId).emit('timer_extended', {
      by: socket.playerName,
      secsLeft: room.secsLeft,
      extendsUsed: room.extendCount[socket.id],
    });
  });

  // ── VOTE ──
  socket.on('vote', ({ votedFor }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.votes[socket.id]) return; // already voted
    room.votes[socket.id] = votedFor;

    // Tally once both players voted
    const players = room.players;
    if (Object.keys(room.votes).length === players.length) {
      const tally = {};
      players.forEach(pid => { tally[pid] = 0; });
      Object.values(room.votes).forEach(vid => { if (tally[vid] !== undefined) tally[vid]++; });
      const winnerId = players.reduce((a, b) => tally[a] >= tally[b] ? a : b);

      // Update leaderboard
      players.forEach(pid => {
        if (!leaderboard[pid]) leaderboard[pid] = { name: pid, wins: 0, losses: 0, xp: 0, streak: 0 };
        if (pid === winnerId) {
          leaderboard[pid].wins++;
          leaderboard[pid].streak++;
          leaderboard[pid].xp += 150;
        } else {
          leaderboard[pid].losses++;
          leaderboard[pid].streak = 0;
          leaderboard[pid].xp += 25;
        }
      });

      io.to(roomId).emit('vote_result', { tally, winnerId, leaderboard: buildLeaderboard() });
      io.emit('leaderboard', buildLeaderboard());

      clearRoomTimer(roomId);
      delete rooms[roomId];
      broadcastStats();
    }
  });

  // ── CHAT ──
  socket.on('chat', ({ text }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    io.to(roomId).emit('chat', { from: socket.id, name: socket.playerName, text });
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    console.log(`- disconnected: ${socket.id}`);

    // Remove from solo queue
    const qi = queue.findIndex(s => s.id === socket.id);
    if (qi !== -1) queue.splice(qi, 1);

    // Notify room partner
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      clearRoomTimer(socket.roomId);
      io.to(socket.roomId).emit('opponent_left', { name: socket.playerName });
      delete rooms[socket.roomId];
    }

    // Clean up squad
    if (socket.squadCode && squads[socket.squadCode]) {
      const sq = squads[socket.squadCode];
      sq.members = sq.members.filter(m => m.id !== socket.id);
      if (sq.members.length === 0) delete squads[socket.squadCode];
    }

    broadcastStats();
  });
});

// ── SQUAD MATCHING ──
function tryMatchSquads() {
  while (squadQueue.length >= 2) {
    const sq1 = squadQueue.shift();
    const sq2 = squadQueue.shift();
    const roomId = uuidv4();
    const topic = randomTopic();
    const allPlayers = [...sq1.members, ...sq2.members];

    rooms[roomId] = {
      id: roomId,
      players: allPlayers.map(s => s.id),
      topic,
      round: 1,
      extendCount: {},
      votes: {},
      timer: null,
      secsLeft: 120,
      squad: true,
      squads: [sq1.code, sq2.code],
    };

    allPlayers.forEach(s => {
      s.join(roomId);
      s.roomId = roomId;
    });

    io.to(roomId).emit('match_found', {
      roomId,
      topic,
      players: allPlayers.map(s => ({ id: s.id, name: s.playerName })),
      speakingFirst: sq1.members[0].id,
      squad: true,
      squads: [
        { code: sq1.code, name: sq1.name, members: sq1.members.map(s => ({ id: s.id, name: s.playerName })) },
        { code: sq2.code, name: sq2.name, members: sq2.members.map(s => ({ id: s.id, name: s.playerName })) },
      ],
    });

    startRoomTimer(roomId);
    broadcastStats();
  }
}

// ── ROOM TIMER ──
function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.secsLeft = 120;
  room.extendCount = {};
  room.players.forEach(pid => room.extendCount[pid] = 0);

  room.timer = setInterval(() => {
    if (!rooms[roomId]) { clearInterval(room.timer); return; }
    room.secsLeft--;
    io.to(roomId).emit('timer_tick', { secsLeft: room.secsLeft, round: room.round });

    if (room.secsLeft <= 0) {
      if (room.round === 1) {
        room.round = 2;
        room.secsLeft = 120;
        room.players.forEach(pid => room.extendCount[pid] = 0);
        io.to(roomId).emit('round_change', {
          round: 2,
          speakingNow: room.players[1],
          secsLeft: 120,
        });
      } else {
        clearInterval(room.timer);
        io.to(roomId).emit('go_vote');
      }
    }
  }, 1000);
}

function clearRoomTimer(roomId) {
  if (rooms[roomId] && rooms[roomId].timer) {
    clearInterval(rooms[roomId].timer);
  }
}

// ── LEADERBOARD ──
function buildLeaderboard() {
  return Object.entries(leaderboard)
    .map(([id, d]) => ({ id, ...d, wr: d.wins + d.losses > 0 ? Math.round(d.wins / (d.wins + d.losses) * 100) : 0 }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 20);
}

// ── START ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Debate Arena live on http://localhost:${PORT}`));
