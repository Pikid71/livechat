const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

/* =========================
   DATA & PERSISTENCE
========================= */

const dataFilePath = path.join(__dirname, 'chat_data.json');

let users = {};        // username -> password
let rooms = {};        // roomName -> room object
let userSessions = {}; // socket.id -> username
let userRooms = {};    // socket.id -> roomName

function loadData() {
  try {
    if (!fs.existsSync(dataFilePath)) {
      console.log('chat_data.json not found, creating...');
      saveData();
      return;
    }

    const raw = fs.readFileSync(dataFilePath, 'utf-8');
    if (!raw.trim()) return;

    const data = JSON.parse(raw);
    users = data.users || {};
    rooms = data.rooms || {};
    console.log('Chat data loaded');
  } catch (err) {
    console.error('Failed to load data:', err);
    users = {};
    rooms = {};
  }
}

function saveData() {
  try {
    const tmp = dataFilePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ users, rooms }, null, 2));
    fs.renameSync(tmp, dataFilePath);
  } catch (err) {
    console.error('Failed to save data:', err);
  }
}

/* =========================
   STARTUP INIT
========================= */

loadData();

// Ensure Main room exists
if (!rooms['Main']) {
  rooms['Main'] = {
    password: '',
    members: [],
    messages: [],
    bans: [],
    isDefault: true
  };
}

// Clear members on restart (sockets don't persist)
for (const room of Object.values(rooms)) {
  room.members = [];
}

/* =========================
   STATIC FILES
========================= */

app.use(express.static(__dirname));

/* =========================
   SOCKET.IO LOGIC
========================= */

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  /* ---------- REGISTER ---------- */
  socket.on('register', ({ username, password }, cb) => {
    if (users[username]) {
      return cb({ ok: false, error: 'Username already exists' });
    }
    users[username] = password;
    saveData();
    cb({ ok: true });
  });

  /* ---------- LOGIN ---------- */
  socket.on('login', ({ username, password }, cb) => {
    if (users[username] !== password) {
      return cb({ ok: false, error: 'Invalid credentials' });
    }
    userSessions[socket.id] = username;
    cb({ ok: true, rooms: Object.keys(rooms) });
  });

  /* ---------- CREATE ROOM ---------- */
  socket.on('createRoom', ({ roomName, password }, cb) => {
    if (rooms[roomName]) {
      return cb({ ok: false, error: 'Room already exists' });
    }

    rooms[roomName] = {
      password: password || '',
      members: [],
      messages: [],
      bans: []
    };

    saveData();
    io.emit('roomList', Object.keys(rooms));
    cb({ ok: true });
  });

  /* ---------- JOIN ROOM ---------- */
  socket.on('joinRoom', ({ roomName, password }, cb) => {
    const username = userSessions[socket.id];
    const room = rooms[roomName];

    if (!room) return cb({ ok: false, error: 'Room not found' });

    // Check ban
    const now = Date.now();
    room.bans = room.bans.filter(b => b.expiresAt > now);

    if (room.bans.find(b => b.user === username)) {
      return cb({ ok: false, error: 'You are banned from this room' });
    }

    if (room.password && room.password !== password) {
      return cb({ ok: false, error: 'Wrong room password' });
    }

    socket.join(roomName);
    room.members.push(username);
    userRooms[socket.id] = roomName;

    cb({ ok: true, messages: room.messages });
  });

  /* ---------- MESSAGE ---------- */
  socket.on('message', (text) => {
    const username = userSessions[socket.id];
    const roomName = userRooms[socket.id];
    if (!username || !roomName) return;

    const msg = {
      user: username,
      text,
      time: Date.now()
    };

    rooms[roomName].messages.push(msg);

    if (rooms[roomName].messages.length > 100) {
      rooms[roomName].messages.shift();
    }

    saveData();
    io.to(roomName).emit('message', msg);
  });

  /* ---------- BAN USER ---------- */
  socket.on('banUser', ({ roomName, target, durationMs }) => {
    if (!rooms[roomName]) return;

    rooms[roomName].bans.push({
      user: target,
      expiresAt: Date.now() + durationMs
    });

    saveData();
  });

  /* ---------- UNBAN USER ---------- */
  socket.on('unbanUser', ({ roomName, target }) => {
    if (!rooms[roomName]) return;

    rooms[roomName].bans =
      rooms[roomName].bans.filter(b => b.user !== target);

    saveData();
  });

  /* ---------- CLEAR MESSAGES ---------- */
  socket.on('clearMessages', (roomName) => {
    if (!rooms[roomName]) return;
    rooms[roomName].messages = [];
    saveData();
    io.to(roomName).emit('cleared');
  });

  /* ---------- DELETE ROOM ---------- */
  socket.on('deleteRoom', (roomName) => {
    if (!rooms[roomName] || rooms[roomName].isDefault) return;

    delete rooms[roomName];
    saveData();
    io.emit('roomList', Object.keys(rooms));
  });

  /* ---------- DISCONNECT ---------- */
  socket.on('disconnect', () => {
    const roomName = userRooms[socket.id];
    const username = userSessions[socket.id];

    if (roomName && rooms[roomName]) {
      rooms[roomName].members =
        rooms[roomName].members.filter(u => u !== username);
    }

    delete userSessions[socket.id];
    delete userRooms[socket.id];

    console.log('User disconnected:', socket.id);
  });
});

/* =========================
   SHUTDOWN SAFETY
========================= */

process.on('SIGINT', () => {
  console.log('\nSaving data before shutdown...');
  saveData();
  process.exit();
});

/* =========================
   START SERVER
========================= */

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
