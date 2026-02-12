const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  }
});

const dataFilePath = path.join(__dirname, 'chat_data.json');

let users = {};
let rooms = {};
let userSessions = {};
let userRooms = {};

// Create default "Main" room
rooms['Main'] = {
  password: '',
  members: [],
  messages: [],
  isDefault: true,
  bans: []
};

// Load data from file on server start
async function loadData() {
  try {
    await fs.access(dataFilePath);
    const data = JSON.parse(await fs.readFile(dataFilePath, 'utf-8'));
    users = data.users || {};
    
    // Merge saved rooms with default Main room
    if (data.rooms) {
      rooms = { ...rooms, ...data.rooms };
      // Ensure Main room always has isDefault flag
      if (rooms['Main']) {
        rooms['Main'].isDefault = true;
      }
    }
    
    console.log('✅ Data loaded successfully');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, create it
      await saveData();
      console.log('📁 Created new data file');
    } else {
      console.error('❌ Error reading data file:', err);
    }
  }
}

// Save data to file
async function saveData(retries = 3) {
  const data = { 
    users: users, 
    rooms: rooms 
  };
  
  for (let i = 0; i < retries; i++) {
    try {
      await fs.writeFile(dataFilePath, JSON.stringify(data, null, 2));
      return;
    } catch (err) {
      console.error(`Error writing data file (attempt ${i + 1}/${retries}):`, err);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Periodic save
setInterval(async () => {
  try {
    await saveData();
    console.log('💾 Auto-saved data');
  } catch (err) {
    console.error('Auto-save failed:', err);
  }
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, saving data...');
  await saveData();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, saving data...');
  await saveData();
  process.exit(0);
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.CODESPACES ? 'codespaces' : process.env.NODE_ENV || 'development'
  });
});

// Route for index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Load data on startup
loadData().catch(err => {
  console.error('Failed to load data on startup:', err);
});

io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);
  
  // Register new user
  socket.on('register', async (data) => {
    const { username, password } = data;
    
    if (!username || !password) {
      socket.emit('auth_error', { message: 'Username and password required' });
      return;
    }
    
    if (username.length < 3) {
      socket.emit('auth_error', { message: 'Username must be at least 3 characters' });
      return;
    }
    
    if (password.length < 4) {
      socket.emit('auth_error', { message: 'Password must be at least 4 characters' });
      return;
    }
    
    if (users[username]) {
      socket.emit('auth_error', { message: 'Username already exists' });
      return;
    }
    
    // Create user
    users[username] = password;
    userSessions[socket.id] = username;
    
    // Save to file
    try {
      await saveData();
    } catch (err) {
      console.error('Failed to save user data:', err);
    }
    
    socket.emit('auth_success', { username, message: 'Registration successful!' });
    console.log('✅ User registered:', username);
  });
  
  // Login user
  socket.on('login', (data) => {
    const { username, password } = data;
    
    if (!username || !password) {
      socket.emit('auth_error', { message: 'Username and password required' });
      return;
    }
    
    if (!users[username]) {
      socket.emit('auth_error', { message: 'Username not found' });
      return;
    }
    
    if (users[username] !== password) {
      socket.emit('auth_error', { message: 'Incorrect password' });
      return;
    }
    
    userSessions[socket.id] = username;
    socket.emit('auth_success', { username, message: 'Login successful!' });
    console.log('✅ User logged in:', username);
  });
  
  // Check current authentication status
  socket.on('check_auth', () => {
    const username = userSessions[socket.id];
    if (username) {
      socket.emit('auth_status', { authenticated: true, username });
    } else {
      socket.emit('auth_status', { authenticated: false });
    }
  });
  
  // Broadcast user banned notification
  socket.on('user_banned', (data) => {
    const { roomName, bannedUser, bannerName } = data;
    io.to(roomName).emit('chat message', {
      username: 'System',
      message: `⛔ ${bannedUser} has been banned by ${bannerName}`
    });
  });

  // Ban a user with duration
  socket.on('ban_user', async (data) => {
    const { roomName, bannedUser, duration, bannerName } = data;
    
    if (!rooms[roomName]) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }

    // Parse duration
    let durationMs = 10 * 60 * 1000; // default 10 minutes
    if (duration) {
      const match = duration.match(/^(\d+)([hmd]?)$/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2] || 'm';
        
        if (unit === 'h') durationMs = value * 60 * 60 * 1000;
        else if (unit === 'm') durationMs = value * 60 * 1000;
        else if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;
      }
    }

    const expiresAt = Date.now() + durationMs;
    
    if (!rooms[roomName].bans) {
      rooms[roomName].bans = [];
    }

    // Remove existing ban if any
    rooms[roomName].bans = rooms[roomName].bans.filter(b => b.user !== bannedUser);
    
    // Add new ban
    rooms[roomName].bans.push({ 
      user: bannedUser, 
      expiresAt,
      bannedBy: bannerName,
      bannedAt: Date.now()
    });

    // Save to file
    try {
      await saveData();
    } catch (err) {
      console.error('Failed to save ban data:', err);
    }

    // Notify all clients about the ban
    io.to(roomName).emit('user_banned', { 
      bannedUser, 
      duration: duration || '10m',
      bannerName
    });

    // Also send a system message
    io.to(roomName).emit('chat message', {
      username: 'System',
      message: `⛔ ${bannedUser} has been banned from the room for ${duration || '10m'}`
    });

    // Auto-unban after duration expires
    setTimeout(async () => {
      if (rooms[roomName] && rooms[roomName].bans) {
        rooms[roomName].bans = rooms[roomName].bans.filter(b => b.user !== bannedUser);
        try {
          await saveData();
        } catch (err) {
          console.error('Failed to save unban data:', err);
        }
        io.to(roomName).emit('user_unbanned', { 
          unbannedUser: bannedUser, 
          unbannerName: 'System (Auto)'
        });
        io.to(roomName).emit('chat message', {
          username: 'System',
          message: `✅ Ban expired: ${bannedUser} has been automatically unbanned`
        });
      }
    }, durationMs);

    console.log(`🔨 User ${bannedUser} banned from ${roomName} for ${duration || '10m'}`);
  });

  // Unban a user
  socket.on('unban_user', async (data) => {
    const { roomName, unbannedUser, unbannerName } = data;
    
    if (!rooms[roomName]) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }

    if (!rooms[roomName].bans) {
      rooms[roomName].bans = [];
    }

    // Remove ban
    rooms[roomName].bans = rooms[roomName].bans.filter(b => b.user !== unbannedUser);

    // Save to file
    try {
      await saveData();
    } catch (err) {
      console.error('Failed to save unban data:', err);
    }

    // Notify all clients about the unban
    io.to(roomName).emit('user_unbanned', { 
      unbannedUser, 
      unbannerName
    });

    // Send system message
    io.to(roomName).emit('chat message', {
      username: 'System',
      message: `✅ ${unbannedUser} has been unbanned by ${unbannerName}`
    });

    console.log(`✅ User ${unbannedUser} unbanned from ${roomName}`);
  });

  // Clear messages from room
  socket.on('clear_messages', async (data) => {
    const { roomName, password } = data;
    
    if (password === 'A@sh1shlivechat' && rooms[roomName]) {
      rooms[roomName].messages = [];
      
      try {
        await saveData();
      } catch (err) {
        console.error('Failed to save after clearing messages:', err);
      }
      
      io.to(roomName).emit('messages_cleared', { roomName });
    }
  });

  // Leave room
  socket.on('leave_room', async (data) => {
    const { roomName } = data;
    const username = userSessions[socket.id];
    
    if (roomName && rooms[roomName] && username) {
      // Remove user from room members
      rooms[roomName].members = rooms[roomName].members.filter(m => m.id !== socket.id);
      
      // Notify remaining members
      io.to(roomName).emit('user_left', {
        username,
        members: rooms[roomName].members.length
      });
      
      socket.leave(roomName);
      
      // Delete empty non-default rooms
      if (rooms[roomName].members.length === 0 && !rooms[roomName].isDefault) {
        delete rooms[roomName];
        try {
          await saveData();
        } catch (err) {
          console.error('Failed to save after room deletion:', err);
        }
        io.emit('room_deleted', { name: roomName });
      } else {
        // Save even if just member left
        try {
          await saveData();
        } catch (err) {
          console.error('Failed to save after member left:', err);
        }
      }
    }
    delete userRooms[socket.id];
  });

  // Logout user
  socket.on('logout', () => {
    const username = userSessions[socket.id];
    
    if (username) {
      delete userSessions[socket.id];
      socket.emit('logged_out');
      console.log('👋 User logged out:', username);
    }
  });
  
  // Get list of available rooms (without passwords)
  socket.on('get_rooms', () => {
    const username = userSessions[socket.id];
    if (!username) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }
    
    const roomList = Object.keys(rooms).map(roomName => ({
      name: roomName,
      hasPassword: rooms[roomName].password ? true : false,
      members: rooms[roomName].members.length
    }));
    socket.emit('rooms_list', roomList);
  });

  // Create a new room
  socket.on('create_room', async (data) => {
    const username = userSessions[socket.id];
    if (!username) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }
    
    const { roomName, password } = data;
    
    if (!roomName || roomName.trim() === '') {
      socket.emit('error', { message: 'Room name cannot be empty' });
      return;
    }

    if (rooms[roomName]) {
      socket.emit('error', { message: 'Room already exists' });
      return;
    }

    // Create room
    rooms[roomName] = {
      password: password || '',
      members: [{ id: socket.id, username }],
      messages: [],
      bans: [],
      createdBy: username,
      createdAt: Date.now(),
      isDefault: false
    };

    // Save to file
    try {
      await saveData();
    } catch (err) {
      console.error('Failed to save new room data:', err);
    }

    userRooms[socket.id] = roomName;
    socket.join(roomName);
    socket.emit('joined_room', { roomName, username });
    
    // Notify room members
    io.to(roomName).emit('user_joined', {
      username,
      members: rooms[roomName].members.length
    });

    // Send welcome message
    io.to(roomName).emit('chat message', {
      username: 'System',
      message: `🎉 Room "${roomName}" created by ${username}`
    });

    // Notify all clients about new room
    io.emit('room_created', { 
      name: roomName, 
      hasPassword: !!password,
      members: 1
    });

    console.log('🏠 Room created:', roomName, 'by', username);
  });

  // Join existing room
  socket.on('join_room', async (data) => {
    const username = userSessions[socket.id];
    if (!username) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }
    
    const { roomName, password } = data;

    if (!rooms[roomName]) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }

    const room = rooms[roomName];
    
    // Check if user is banned
    if (room.bans) {
      const ban = room.bans.find(b => b.user === username && b.expiresAt > Date.now());
      if (ban) {
        socket.emit('error', { message: '❌ You are banned from this room' });
        return;
      }
    }

    // Check password
    if (room.password && room.password !== password) {
      socket.emit('error', { message: 'Incorrect password' });
      return;
    }

    // Check if already in room
    if (room.members.some(m => m.id === socket.id)) {
      socket.emit('error', { message: 'Already in this room' });
      return;
    }

    // Add user to room
    room.members.push({ id: socket.id, username });
    userRooms[socket.id] = roomName;
    socket.join(roomName);

    // Send room history and current members
    socket.emit('joined_room', { roomName, username });
    socket.emit('room_history', { messages: room.messages });

    // Notify room members
    io.to(roomName).emit('user_joined', {
      username,
      members: room.members.length
    });

    // Send welcome message
    io.to(roomName).emit('chat message', {
      username: 'System',
      message: `👋 ${username} joined the room`
    });

    // Save to file
    try {
      await saveData();
    } catch (err) {
      console.error('Failed to save after user joined:', err);
    }

    console.log(`🚪 ${username} joined room:`, roomName);
  });

  // Handle chat messages
  socket.on('chat message', async (msg) => {
    const roomName = userRooms[socket.id];
    if (!roomName || !rooms[roomName]) return;

    const username = msg.username;

    // Check if user is banned
    if (rooms[roomName].bans) {
      const ban = rooms[roomName].bans.find(b => b.user === username && b.expiresAt > Date.now());
      if (ban) {
        socket.emit('error', { message: '❌ You are currently banned from this room' });
        return;
      }
    }

    const messageData = {
      username: msg.username,
      message: msg.message,
      timestamp: new Date().toLocaleTimeString(),
      id: Date.now() + Math.random().toString(36).substr(2, 9)
    };

    // Store message in room
    rooms[roomName].messages.push(messageData);
    if (rooms[roomName].messages.length > 100) {
      rooms[roomName].messages.shift();
    }

    // Save to file (throttle to reduce I/O)
    try {
      if (rooms[roomName].messages.length % 10 === 0) {
        await saveData();
      }
    } catch (err) {
      console.error('Failed to save message data:', err);
    }

    // Broadcast to everyone in the room EXCEPT sender
    socket.broadcast.to(roomName).emit('chat message', messageData);
  });

  // Delete room with password verification
  socket.on('delete_room', async (data) => {
    const { roomName, password } = data;
    
    // Prevent deletion of default "Main" room
    if (roomName === 'Main') {
      socket.emit('error', { message: 'Cannot delete the Main room' });
      return;
    }
    
    if (!rooms[roomName]) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }

    // Verify deletion password
    if (password !== 'A@sh1shdeleteroom') {
      socket.emit('error', { message: 'Incorrect deletion password' });
      return;
    }

    // Delete the room
    delete rooms[roomName];

    // Save to file
    try {
      await saveData();
    } catch (err) {
      console.error('Failed to save after room deletion:', err);
    }

    // Notify all members in the room to leave
    io.to(roomName).emit('room_deleted_by_owner', { roomName });
    
    // Broadcast room deletion to all clients
    io.emit('room_deleted', { name: roomName });
    
    console.log('🗑️ Room deleted:', roomName);
  });

  socket.on('disconnect', async () => {
    const username = userSessions[socket.id];
    const roomName = userRooms[socket.id];
    
    if (roomName && rooms[roomName]) {
      // Remove user from room
      rooms[roomName].members = rooms[roomName].members.filter(m => m.id !== socket.id);

      // Notify room members
      io.to(roomName).emit('user_left', {
        username,
        members: rooms[roomName].members.length
      });

      // Send leave message
      if (username) {
        io.to(roomName).emit('chat message', {
          username: 'System',
          message: `👋 ${username} left the room`
        });
      }

      // Delete empty non-default rooms
      if (rooms[roomName].members.length === 0 && !rooms[roomName].isDefault) {
        delete rooms[roomName];
        try {
          await saveData();
        } catch (err) {
          console.error('Failed to save after room deletion on disconnect:', err);
        }
        io.emit('room_deleted', { name: roomName });
      } else {
        // Save even if just member left
        try {
          await saveData();
        } catch (err) {
          console.error('Failed to save after member disconnect:', err);
        }
      }
    }
    
    delete userRooms[socket.id];
    delete userSessions[socket.id];
    
    if (username) {
      console.log('👋 User disconnected:', username, socket.id);
    } else {
      console.log('👋 Anonymous disconnected:', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 BLACK HOLE CHAT SERVER');
  console.log('='.repeat(60));
  console.log(`\n📡 Server running on port ${PORT}`);
  console.log(`⚡ Mode: ${process.env.CODESPACES ? 'CODESPACES' : process.env.NODE_ENV || 'development'}`);
  
  // Codespaces specific instructions
  if (process.env.CODESPACES === 'true') {
    const codespaceName = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'preview.app.github.dev';
    const url = `https://${codespaceName}-${PORT}.${domain}`;
    
    console.log('\n' + '🔴 CODESPACES DETECTED');
    console.log('\n' + '📋 QUICK SETUP:');
    console.log('   1. Look at the BOTTOM PANEL of your VS Code window');
    console.log('   2. Click the "PORTS" tab (next to Terminal)');
    console.log('   3. Find port ' + PORT + ' in the list');
    console.log('   4. Right-click it → "Port Visibility" → "Public"');
    console.log('   5. Click the 🌐 globe icon to open in browser');
    
    console.log('\n' + '🔗 OR USE THIS LINK:');
    console.log('   ' + url);
    
    console.log('\n' + '⚠️  If the link doesn\'t work:');
    console.log('   • Wait 10 seconds for port forwarding to initialize');
    console.log('   • Check that port ' + PORT + ' is listed in the Ports tab');
    console.log('   • Make sure it\'s set to "Public"');
  } else {
    console.log(`\n📱 Local access: http://localhost:${PORT}`);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
});

module.exports = { app, server, io };