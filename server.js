require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ============================================
// 🔐 ENVIRONMENT VARIABLES (NO PASSWORDS IN CODE!)
// ============================================
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;

// Validate environment variables
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set in .env file!');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error('❌ ADMIN_PASSWORD not set in .env file!');
  process.exit(1);
}

// ============================================
// 🔌 CONNECT TO MONGODB ATLAS
// ============================================
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅✅✅ MONGODB ATLAS CONNECTED SUCCESSFULLY!');
})
.catch(err => {
  console.error('❌❌❌ MONGODB CONNECTION FAILED:', err.message);
  process.exit(1);
});

// ============================================
// 📊 MONGODB SCHEMAS
// ============================================

// User Schema (with admin flag)
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  isAdmin: { type: Boolean, default: false }, // NEW: Admin flag
  isBanned: { type: Boolean, default: false }
});

// Room Schema
const RoomSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  password: { type: String, default: '' },
  isDefault: { type: Boolean, default: false },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Message Schema
const MessageSchema = new mongoose.Schema({
  roomName: { type: String, required: true, index: true },
  username: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isSystem: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false } // NEW: Admin badge
});

// Ban Schema
const BanSchema = new mongoose.Schema({
  roomName: { type: String, required: true, index: true },
  username: { type: String, required: true },
  bannedBy: { type: String, required: true },
  bannedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true }
});

// Session Schema
const SessionSchema = new mongoose.Schema({
  socketId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  roomName: { type: String },
  connectedAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now }
});

// ============================================
// 📁 MODELS
// ============================================
const User = mongoose.model('User', UserSchema);
const Room = mongoose.model('Room', RoomSchema);
const Message = mongoose.model('Message', MessageSchema);
const Ban = mongoose.model('Ban', BanSchema);
const Session = mongoose.model('Session', SessionSchema);

// ============================================
// 🚀 EXPRESS SETUP
// ============================================
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Stats endpoint
app.get('/stats', async (req, res) => {
  try {
    const stats = {
      users: await User.countDocuments(),
      admins: await User.countDocuments({ isAdmin: true }),
      rooms: await Room.countDocuments(),
      messages: await Message.countDocuments(),
      activeBans: await Ban.countDocuments({ isActive: true, expiresAt: { $gt: new Date() } }),
      activeSessions: await Session.countDocuments(),
      timestamp: new Date()
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 🏠 INITIALIZE DEFAULT ROOM
// ============================================
async function initializeDefaultRoom() {
  try {
    const defaultRoom = await Room.findOne({ name: 'Main' });
    if (!defaultRoom) {
      await Room.create({
        name: 'Main',
        password: '',
        isDefault: true,
        createdBy: 'System'
      });
      console.log('🏠 Default "Main" room created');
    }
  } catch (err) {
    console.error('Error creating default room:', err);
  }
}

// Create default admin user (for first time setup)
async function createDefaultAdmin() {
  try {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password: ADMIN_PASSWORD, // Use same password for default admin
        isAdmin: true,
        lastLogin: new Date()
      });
      console.log('👑 Default admin user created (username: admin)');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }
}

// Run initializations
initializeDefaultRoom();
createDefaultAdmin();

// ============================================
// 🧹 CLEANUP EXPIRED BANS
// ============================================
async function cleanupExpiredBans() {
  try {
    const result = await Ban.updateMany(
      { expiresAt: { $lt: new Date() }, isActive: true },
      { isActive: false }
    );
    if (result.modifiedCount > 0) {
      console.log(`🧹 Cleaned up ${result.modifiedCount} expired bans`);
    }
  } catch (err) {
    console.error('Error cleaning up bans:', err);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredBans, 60 * 60 * 1000);

// ============================================
// 🔌 SOCKET.IO HANDLERS
// ============================================
io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);
  
  // ========== AUTHENTICATION ==========
  
  // Register new user
  socket.on('register', async (data) => {
    try {
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
      
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        socket.emit('auth_error', { message: 'Username already exists' });
        return;
      }
      
      // Create user in MongoDB (non-admin by default)
      await User.create({
        username,
        password,
        isAdmin: false,
        lastLogin: new Date()
      });
      
      // Create session
      await Session.create({
        socketId: socket.id,
        username
      });
      
      socket.emit('auth_success', { username, message: 'Registration successful!' });
      console.log('✅ User registered:', username);
      
    } catch (err) {
      console.error('Registration error:', err);
      socket.emit('auth_error', { message: 'Server error during registration' });
    }
  });
  
  // Login user
  socket.on('login', async (data) => {
    try {
      const { username, password } = data;
      
      if (!username || !password) {
        socket.emit('auth_error', { message: 'Username and password required' });
        return;
      }
      
      const user = await User.findOne({ username });
      
      if (!user) {
        socket.emit('auth_error', { message: 'Username not found' });
        return;
      }
      
      if (user.password !== password) {
        socket.emit('auth_error', { message: 'Incorrect password' });
        return;
      }
      
      // Check if user is banned globally
      if (user.isBanned) {
        socket.emit('auth_error', { message: 'This account has been banned' });
        return;
      }
      
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      
      // Create session
      await Session.create({
        socketId: socket.id,
        username
      });
      
      // Send user data including admin status
      socket.emit('auth_success', { 
        username, 
        isAdmin: user.isAdmin,
        message: 'Login successful!' 
      });
      
      console.log('✅ User logged in:', username, user.isAdmin ? '(ADMIN)' : '');
      
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth_error', { message: 'Server error during login' });
    }
  });
  
  // /admin command - Make user admin (requires admin password)
  socket.on('make_admin', async (data) => {
    try {
      const { username, password } = data;
      
      if (password !== ADMIN_PASSWORD) {
        socket.emit('command_error', { message: '❌ Incorrect admin password' });
        return;
      }
      
      const user = await User.findOne({ username });
      if (!user) {
        socket.emit('command_error', { message: 'User not found' });
        return;
      }
      
      user.isAdmin = true;
      await user.save();
      
      // If user is online, notify them
      const userSession = await Session.findOne({ username });
      if (userSession) {
        io.to(userSession.socketId).emit('admin_granted', { 
          message: '👑 You are now an admin!' 
        });
      }
      
      socket.emit('command_success', { 
        message: `✅ ${username} is now an admin` 
      });
      
      console.log(`👑 Admin granted to: ${username}`);
      
    } catch (err) {
      console.error('Make admin error:', err);
      socket.emit('command_error', { message: 'Failed to make admin' });
    }
  });
  
  // Logout
  socket.on('logout', async () => {
    try {
      await Session.deleteOne({ socketId: socket.id });
      socket.emit('logged_out');
      console.log('👋 User logged out:', socket.id);
    } catch (err) {
      console.error('Logout error:', err);
    }
  });
  
  // Check authentication
  socket.on('check_auth', async () => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (session) {
        const user = await User.findOne({ username: session.username });
        socket.emit('auth_status', { 
          authenticated: true, 
          username: session.username,
          isAdmin: user ? user.isAdmin : false
        });
      } else {
        socket.emit('auth_status', { authenticated: false });
      }
    } catch (err) {
      socket.emit('auth_status', { authenticated: false });
    }
  });
  
  // ========== ROOMS ==========
  
  // Get rooms list
  socket.on('get_rooms', async () => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) {
        socket.emit('auth_error', { message: 'Not authenticated' });
        return;
      }
      
      const rooms = await Room.find();
      
      // Get member counts for each room
      const roomList = await Promise.all(rooms.map(async (room) => {
        const sessions = await Session.find({ roomName: room.name });
        return {
          name: room.name,
          hasPassword: !!room.password,
          members: sessions.length,
          isDefault: room.isDefault
        };
      }));
      
      socket.emit('rooms_list', roomList);
      
    } catch (err) {
      console.error('Get rooms error:', err);
      socket.emit('error', { message: 'Failed to get rooms' });
    }
  });
  
  // Create room
  socket.on('create_room', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) {
        socket.emit('auth_error', { message: 'Not authenticated' });
        return;
      }
      
      const { roomName, password } = data;
      
      if (!roomName || roomName.trim() === '') {
        socket.emit('error', { message: 'Room name cannot be empty' });
        return;
      }
      
      const existingRoom = await Room.findOne({ name: roomName });
      if (existingRoom) {
        socket.emit('error', { message: 'Room already exists' });
        return;
      }
      
      // Create room in MongoDB
      await Room.create({
        name: roomName,
        password: password || '',
        createdBy: session.username,
        isDefault: false
      });
      
      // Join room
      session.roomName = roomName;
      await session.save();
      socket.join(roomName);
      
      const user = await User.findOne({ username: session.username });
      
      socket.emit('joined_room', { 
        roomName, 
        username: session.username,
        isAdmin: user ? user.isAdmin : false
      });
      
      // Notify others
      const roomSessions = await Session.find({ roomName });
      io.to(roomName).emit('user_joined', {
        username: session.username,
        members: roomSessions.length,
        isAdmin: user ? user.isAdmin : false
      });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: `🎉 Room "${roomName}" created by ${session.username}`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      // Notify all clients about new room
      io.emit('room_created', { 
        name: roomName, 
        hasPassword: !!password,
        members: 1
      });
      
      console.log('🏠 Room created:', roomName, 'by', session.username);
      
    } catch (err) {
      console.error('Create room error:', err);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });
  
  // Join room
  socket.on('join_room', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) {
        socket.emit('auth_error', { message: 'Not authenticated' });
        return;
      }
      
      const { roomName, password } = data;
      
      const room = await Room.findOne({ name: roomName });
      if (!room) {
        socket.emit('error', { message: 'Room does not exist' });
        return;
      }
      
      // Check if banned
      const activeBan = await Ban.findOne({
        roomName,
        username: session.username,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });
      
      if (activeBan) {
        socket.emit('error', { message: '❌ You are banned from this room' });
        return;
      }
      
      // Check password
      if (room.password && room.password !== password) {
        socket.emit('error', { message: 'Incorrect password' });
        return;
      }
      
      // Check if already in room - FIX: Leave old room first
      if (session.roomName && session.roomName !== roomName) {
        const oldRoom = session.roomName;
        session.roomName = null;
        await session.save();
        socket.leave(oldRoom);
        
        // Notify old room
        const oldRoomSessions = await Session.find({ roomName: oldRoom });
        io.to(oldRoom).emit('user_left', {
          username: session.username,
          members: oldRoomSessions.length
        });
      }
      
      // Join new room
      session.roomName = roomName;
      await session.save();
      socket.join(roomName);
      
      const user = await User.findOne({ username: session.username });
      
      socket.emit('joined_room', { 
        roomName, 
        username: session.username,
        isAdmin: user ? user.isAdmin : false
      });
      
      // Send room history (last 50 messages)
      const recentMessages = await Message.find({ roomName })
        .sort({ timestamp: -1 })
        .limit(50)
        .sort({ timestamp: 1 });
      
      socket.emit('room_history', {
        messages: recentMessages.map(msg => ({
          username: msg.username,
          message: msg.message,
          timestamp: msg.timestamp.toLocaleTimeString(),
          isAdmin: msg.isAdmin
        }))
      });
      
      // Notify others
      const roomSessions = await Session.find({ roomName });
      io.to(roomName).emit('user_joined', {
        username: session.username,
        members: roomSessions.length,
        isAdmin: user ? user.isAdmin : false
      });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: `👋 ${session.username} joined the room`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log(`🚪 ${session.username} joined room:`, roomName);
      
    } catch (err) {
      console.error('Join room error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Leave room - FIX: Properly remove user and update counts
  socket.on('leave_room', async () => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) return;
      
      const roomName = session.roomName;
      if (!roomName) return;
      
      // Leave room
      session.roomName = null;
      await session.save();
      socket.leave(roomName);
      
      // Get updated member count
      const roomSessions = await Session.find({ roomName });
      const memberCount = roomSessions.length;
      
      // Notify others
      io.to(roomName).emit('user_left', {
        username: session.username,
        members: memberCount
      });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: `👋 ${session.username} left the room`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log(`🚪 ${session.username} left room: ${roomName} (${memberCount} members remain)`);
      
      // Delete empty non-default rooms
      if (memberCount === 0) {
        const room = await Room.findOne({ name: roomName });
        if (room && !room.isDefault) {
          await Room.deleteOne({ name: roomName });
          await Message.deleteMany({ roomName });
          await Ban.deleteMany({ roomName });
          io.emit('room_deleted', { name: roomName });
          console.log('🗑️ Empty room deleted:', roomName);
        }
      }
      
    } catch (err) {
      console.error('Leave room error:', err);
    }
  });
  
  // ========== MESSAGES ==========
  
  // Chat message
  socket.on('chat message', async (msg) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session || !session.roomName) return;
      
      const roomName = session.roomName;
      const username = msg.username;
      
      // Check if banned
      const activeBan = await Ban.findOne({
        roomName,
        username,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });
      
      if (activeBan) {
        socket.emit('error', { message: '❌ You are currently banned from this room' });
        return;
      }
      
      // Check if user is admin
      const user = await User.findOne({ username });
      const isAdmin = user ? user.isAdmin : false;
      
      // Save message to MongoDB
      const messageData = await Message.create({
        roomName,
        username,
        message: msg.message,
        isSystem: false,
        isAdmin: isAdmin
      });
      
      // Broadcast to others with admin badge
      socket.broadcast.to(roomName).emit('chat message', {
        username,
        message: msg.message,
        timestamp: messageData.timestamp.toLocaleTimeString(),
        isAdmin: isAdmin
      });
      
      // Update session activity
      session.lastActivity = new Date();
      await session.save();
      
    } catch (err) {
      console.error('Message error:', err);
    }
  });
  
  // ========== ADMIN COMMANDS ==========
  
  // /effect command - ONLY FOR ADMINS
  socket.on('effect_command', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) return;
      
      const user = await User.findOne({ username: session.username });
      
      // Check if user is admin
      if (!user || !user.isAdmin) {
        socket.emit('command_error', { message: '❌ This command is for admins only!' });
        return;
      }
      
      const { effect, roomName } = data;
      
      // List of valid effects
      const validEffects = ['glitch', 'flashbang', 'black', 'firework', 'gameroom', 'confetti'];
      
      if (!validEffects.includes(effect)) {
        socket.emit('command_error', { message: '❌ Invalid effect! Valid: glitch, flashbang, black, firework, gameroom, confetti' });
        return;
      }
      
      // Broadcast effect to the room
      io.to(roomName).emit('room_effect', {
        effect: effect,
        triggeredBy: session.username
      });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: `✨ Admin ${session.username} triggered effect: ${effect}`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log(`✨ Admin ${session.username} triggered effect: ${effect} in ${roomName}`);
      
    } catch (err) {
      console.error('Effect command error:', err);
      socket.emit('command_error', { message: 'Failed to trigger effect' });
    }
  });
  
  // /clear command - NO PASSWORD NEEDED FOR ADMINS
  socket.on('clear_messages', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) return;
      
      const { roomName, password } = data;
      
      // Check if user is admin
      const user = await User.findOne({ username: session.username });
      const isAdmin = user ? user.isAdmin : false;
      
      // If not admin, require password
      if (!isAdmin && password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: '❌ Incorrect admin password' });
        return;
      }
      
      const room = await Room.findOne({ name: roomName });
      if (!room) return;
      
      await Message.deleteMany({ roomName });
      
      io.to(roomName).emit('messages_cleared', { roomName });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: isAdmin ? 
          `🧹 Admin ${session.username} cleared all messages` : 
          '🧹 All messages have been cleared by admin',
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log(`🧹 Messages cleared in ${roomName} by ${session.username} ${isAdmin ? '(ADMIN)' : ''}`);
      
    } catch (err) {
      console.error('Clear messages error:', err);
    }
  });
  
  // /ban command - NO PASSWORD NEEDED FOR ADMINS
  socket.on('ban_user', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) return;
      
      const { roomName, bannedUser, duration = '10m', bannerName, password } = data;
      
      // Check if user is admin
      const user = await User.findOne({ username: session.username });
      const isAdmin = user ? user.isAdmin : false;
      
      // If not admin, require password
      if (!isAdmin && password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: '❌ Incorrect admin password' });
        return;
      }
      
      const room = await Room.findOne({ name: roomName });
      if (!room) {
        socket.emit('error', { message: 'Room does not exist' });
        return;
      }
      
      // Parse duration
      let durationMs = 10 * 60 * 1000;
      const match = duration.match(/^(\d+)([hmd]?)$/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2] || 'm';
        if (unit === 'h') durationMs = value * 60 * 60 * 1000;
        else if (unit === 'm') durationMs = value * 60 * 1000;
        else if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;
      }
      
      const expiresAt = new Date(Date.now() + durationMs);
      
      // Deactivate old bans
      await Ban.updateMany(
        { roomName, username: bannedUser, isActive: true },
        { isActive: false }
      );
      
      // Create new ban
      await Ban.create({
        roomName,
        username: bannedUser,
        bannedBy: bannerName,
        expiresAt,
        isActive: true
      });
      
      // Notify room
      io.to(roomName).emit('user_banned', { bannedUser, duration, bannerName });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: isAdmin ?
          `⛔ Admin ${bannerName} banned ${bannedUser} for ${duration}` :
          `⛔ ${bannedUser} has been banned for ${duration}`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      // Kick user if currently in room
      const bannedSession = await Session.findOne({ username: bannedUser, roomName });
      if (bannedSession) {
        bannedSession.roomName = null;
        await bannedSession.save();
        io.to(bannedSession.socketId).emit('force_leave', { roomName, reason: 'banned' });
      }
      
      console.log(`🔨 ${bannedUser} banned from ${roomName} for ${duration} by ${bannerName} ${isAdmin ? '(ADMIN)' : ''}`);
      
    } catch (err) {
      console.error('Ban error:', err);
      socket.emit('error', { message: 'Failed to ban user' });
    }
  });
  
  // /unban command - NO PASSWORD NEEDED FOR ADMINS
  socket.on('unban_user', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) return;
      
      const { roomName, unbannedUser, unbannerName, password } = data;
      
      // Check if user is admin
      const user = await User.findOne({ username: session.username });
      const isAdmin = user ? user.isAdmin : false;
      
      // If not admin, require password
      if (!isAdmin && password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: '❌ Incorrect admin password' });
        return;
      }
      
      const room = await Room.findOne({ name: roomName });
      if (!room) {
        socket.emit('error', { message: 'Room does not exist' });
        return;
      }
      
      // Deactivate bans
      await Ban.updateMany(
        { roomName, username: unbannedUser, isActive: true },
        { isActive: false }
      );
      
      // Notify room
      io.to(roomName).emit('user_unbanned', { unbannedUser, unbannerName });
      
      // System message
      const systemMessage = await Message.create({
        roomName,
        username: 'System',
        message: isAdmin ?
          `✅ Admin ${unbannerName} unbanned ${unbannedUser}` :
          `✅ ${unbannedUser} has been unbanned`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log(`✅ ${unbannedUser} unbanned from ${roomName} by ${unbannerName} ${isAdmin ? '(ADMIN)' : ''}`);
      
    } catch (err) {
      console.error('Unban error:', err);
      socket.emit('error', { message: 'Failed to unban user' });
    }
  });
  
  // /delete room command - NO PASSWORD NEEDED FOR ADMINS
  socket.on('delete_room', async (data) => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      if (!session) return;
      
      const { roomName, password } = data;
      
      // Check if user is admin
      const user = await User.findOne({ username: session.username });
      const isAdmin = user ? user.isAdmin : false;
      
      // If not admin, require password
      if (!isAdmin && password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: '❌ Incorrect admin password' });
        return;
      }
      
      const room = await Room.findOne({ name: roomName });
      if (!room) {
        socket.emit('error', { message: 'Room does not exist' });
        return;
      }
      
      // Prevent deletion of Main room
      if (room.isDefault) {
        socket.emit('error', { message: 'Cannot delete the Main room' });
        return;
      }
      
      // Delete room and all related data
      await Room.deleteOne({ name: roomName });
      await Message.deleteMany({ roomName });
      await Ban.deleteMany({ roomName });
      
      // Disconnect all users from room
      const roomSessions = await Session.find({ roomName });
      for (const session of roomSessions) {
        session.roomName = null;
        await session.save();
        io.to(session.socketId).emit('room_deleted_by_owner', { roomName });
      }
      
      // Notify all clients
      io.emit('room_deleted', { name: roomName });
      
      console.log(`🗑️ Room deleted: ${roomName} by ${session.username} ${isAdmin ? '(ADMIN)' : ''}`);
      
    } catch (err) {
      console.error('Delete room error:', err);
      socket.emit('error', { message: 'Failed to delete room' });
    }
  });
  
  // ========== DISCONNECT ==========
  
  socket.on('disconnect', async () => {
    try {
      const session = await Session.findOne({ socketId: socket.id });
      
      if (session) {
        const roomName = session.roomName;
        const username = session.username;
        
        if (roomName) {
          // Get updated member count AFTER removal
          await Session.deleteOne({ socketId: socket.id });
          const roomSessions = await Session.find({ roomName });
          const memberCount = roomSessions.length;
          
          // Notify room
          io.to(roomName).emit('user_left', {
            username,
            members: memberCount
          });
          
          // System message
          const systemMessage = await Message.create({
            roomName,
            username: 'System',
            message: `👋 ${username} disconnected`,
            isSystem: true
          });
          
          io.to(roomName).emit('chat message', {
            username: 'System',
            message: systemMessage.message,
            timestamp: systemMessage.timestamp.toLocaleTimeString()
          });
          
          console.log(`👋 ${username} disconnected from ${roomName} (${memberCount} members remain)`);
          
          // Delete empty non-default rooms
          if (memberCount === 0) {
            const room = await Room.findOne({ name: roomName });
            if (room && !room.isDefault) {
              await Room.deleteOne({ name: roomName });
              await Message.deleteMany({ roomName });
              await Ban.deleteMany({ roomName });
              io.emit('room_deleted', { name: roomName });
              console.log('🗑️ Empty room deleted:', roomName);
            }
          }
        } else {
          // Just delete the session if no room
          await Session.deleteOne({ socketId: socket.id });
          console.log('👋 User disconnected:', username);
        }
      } else {
        console.log('👋 Unknown user disconnected:', socket.id);
      }
      
    } catch (err) {
      console.error('Disconnect error:', err);
      await Session.deleteOne({ socketId: socket.id }).catch(() => {});
    }
  });
});

// ============================================
// 🚀 START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀🚀🚀 BLACK HOLE CHAT SERVER STARTED 🚀🚀🚀');
  console.log('='.repeat(60));
  console.log(`\n📡 Port: ${PORT}`);
  console.log(`💾 MongoDB: ${MONGODB_URI.replace(/:[^:@]*@/, ':****@')}`);
  console.log(`🔑 Admin Password: ${ADMIN_PASSWORD.replace(/./g, '*')} (hidden)`);
  console.log('\n' + '='.repeat(60) + '\n');
});

module.exports = { app, server, io };