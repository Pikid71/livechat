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
// 🔥 YOUR MONGODB ATLAS CONNECTION STRING
// ============================================
const MONGODB_URI = 'mongodb+srv://livechatdb:A%40sh1shmongodb@cluster0.j2qik61.mongodb.net/blackholechat?retryWrites=true&w=majority';

// Admin password (same for all admin functions)
const ADMIN_PASSWORD = 'A@sh1shlivechat';

// ============================================
// 🔌 CONNECT TO MONGODB ATLAS
// ============================================
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅✅✅ MONGODB ATLAS CONNECTED SUCCESSFULLY!');
  console.log('💾 Database: blackholechat');
  console.log('🌍 Cluster: cluster0.j2qik61.mongodb.net');
})
.catch(err => {
  console.error('❌❌❌ MONGODB CONNECTION FAILED:', err.message);
  console.log('⚠️  Server will continue but data will NOT persist!');
});

// ============================================
// 📊 MONGODB SCHEMAS
// ============================================

// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
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
  isSystem: { type: Boolean, default: false }
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
      rooms: await Room.countDocuments(),
      messages: await Message.countDocuments(),
      activeBans: await Ban.countDocuments({ isActive: true, expiresAt: { $gt: new Date() } }),
      activeSessions: await Session.countDocuments(),
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
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
      console.log('🏠 Default "Main" room created in MongoDB');
    } else {
      console.log('🏠 Default "Main" room already exists');
    }
  } catch (err) {
    console.error('Error creating default room:', err);
  }
}

// Run default room initialization
initializeDefaultRoom();

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
      
      // Create user in MongoDB
      await User.create({
        username,
        password,
        lastLogin: new Date()
      });
      
      // Create session
      await Session.create({
        socketId: socket.id,
        username
      });
      
      socket.emit('auth_success', { username, message: 'Registration successful!' });
      console.log('✅ User registered in MongoDB:', username);
      
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
      
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      
      // Create session
      await Session.create({
        socketId: socket.id,
        username
      });
      
      socket.emit('auth_success', { username, message: 'Login successful!' });
      console.log('✅ User logged in:', username);
      
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth_error', { message: 'Server error during login' });
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
        socket.emit('auth_status', { authenticated: true, username: session.username });
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
      
      socket.emit('joined_room', { roomName, username: session.username });
      
      // Notify others
      const roomSessions = await Session.find({ roomName });
      io.to(roomName).emit('user_joined', {
        username: session.username,
        members: roomSessions.length
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
      
      console.log('🏠 Room created in MongoDB:', roomName, 'by', session.username);
      
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
      
      // Join room
      session.roomName = roomName;
      await session.save();
      socket.join(roomName);
      
      socket.emit('joined_room', { roomName, username: session.username });
      
      // Send room history (last 50 messages)
      const recentMessages = await Message.find({ roomName })
        .sort({ timestamp: -1 })
        .limit(50)
        .sort({ timestamp: 1 });
      
      socket.emit('room_history', {
        messages: recentMessages.map(msg => ({
          username: msg.username,
          message: msg.message,
          timestamp: msg.timestamp.toLocaleTimeString()
        }))
      });
      
      // Notify others
      const roomSessions = await Session.find({ roomName });
      io.to(roomName).emit('user_joined', {
        username: session.username,
        members: roomSessions.length
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
  
  // Leave room
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
      
      // Notify others
      const roomSessions = await Session.find({ roomName });
      io.to(roomName).emit('user_left', {
        username: session.username,
        members: roomSessions.length
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
      
      // Delete empty non-default rooms
      if (roomSessions.length === 0) {
        const room = await Room.findOne({ name: roomName });
        if (room && !room.isDefault) {
          await Room.deleteOne({ name: roomName });
          await Message.deleteMany({ roomName });
          await Ban.deleteMany({ roomName });
          io.emit('room_deleted', { name: roomName });
          console.log('🗑️ Empty room deleted from MongoDB:', roomName);
        }
      }
      
    } catch (err) {
      console.error('Leave room error:', err);
    }
  });
  
  // Delete room (with admin password)
  socket.on('delete_room', async (data) => {
    try {
      const { roomName, password } = data;
      
      // Check admin password
      if (password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: 'Incorrect admin password' });
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
      
      // Delete room and all related data from MongoDB
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
      
      console.log('🗑️ Room deleted by admin from MongoDB:', roomName);
      
    } catch (err) {
      console.error('Delete room error:', err);
      socket.emit('error', { message: 'Failed to delete room' });
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
      
      // Save message to MongoDB
      const messageData = await Message.create({
        roomName,
        username,
        message: msg.message,
        isSystem: false
      });
      
      // Broadcast to others
      socket.broadcast.to(roomName).emit('chat message', {
        username,
        message: msg.message,
        timestamp: messageData.timestamp.toLocaleTimeString()
      });
      
      // Update session activity
      session.lastActivity = new Date();
      await session.save();
      
    } catch (err) {
      console.error('Message error:', err);
    }
  });
  
  // Clear messages (with admin password)
  socket.on('clear_messages', async (data) => {
    try {
      const { roomName, password } = data;
      
      if (password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: 'Incorrect admin password' });
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
        message: '🧹 All messages have been cleared by admin',
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log('🧹 Messages cleared from MongoDB:', roomName);
      
    } catch (err) {
      console.error('Clear messages error:', err);
    }
  });
  
  // ========== MODERATION ==========
  
  // Ban user (with admin password)
  socket.on('ban_user', async (data) => {
    try {
      const { roomName, bannedUser, duration = '10m', bannerName, password } = data;
      
      if (password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: 'Incorrect admin password' });
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
      
      // Create new ban in MongoDB
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
        message: `⛔ ${bannedUser} has been banned for ${duration}`,
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
      
      console.log(`🔨 ${bannedUser} banned from ${roomName} for ${duration} - saved to MongoDB`);
      
    } catch (err) {
      console.error('Ban error:', err);
      socket.emit('error', { message: 'Failed to ban user' });
    }
  });
  
  // Unban user (with admin password)
  socket.on('unban_user', async (data) => {
    try {
      const { roomName, unbannedUser, unbannerName, password } = data;
      
      if (password !== ADMIN_PASSWORD) {
        socket.emit('error', { message: 'Incorrect admin password' });
        return;
      }
      
      const room = await Room.findOne({ name: roomName });
      if (!room) {
        socket.emit('error', { message: 'Room does not exist' });
        return;
      }
      
      // Deactivate bans in MongoDB
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
        message: `✅ ${unbannedUser} has been unbanned by ${unbannerName}`,
        isSystem: true
      });
      
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: systemMessage.message,
        timestamp: systemMessage.timestamp.toLocaleTimeString()
      });
      
      console.log(`✅ ${unbannedUser} unbanned from ${roomName} - updated in MongoDB`);
      
    } catch (err) {
      console.error('Unban error:', err);
      socket.emit('error', { message: 'Failed to unban user' });
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
          // Notify room
          const roomSessions = await Session.find({ roomName });
          io.to(roomName).emit('user_left', {
            username,
            members: roomSessions.length - 1
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
          
          // Delete empty non-default rooms
          if (roomSessions.length <= 1) {
            const room = await Room.findOne({ name: roomName });
            if (room && !room.isDefault) {
              await Room.deleteOne({ name: roomName });
              await Message.deleteMany({ roomName });
              await Ban.deleteMany({ roomName });
              io.emit('room_deleted', { name: roomName });
              console.log('🗑️ Empty room deleted from MongoDB:', roomName);
            }
          }
        }
        
        // Delete session
        await Session.deleteOne({ socketId: socket.id });
      }
      
      console.log('👋 User disconnected:', socket.id);
      
    } catch (err) {
      console.error('Disconnect error:', err);
      await Session.deleteOne({ socketId: socket.id }).catch(() => {});
    }
  });
});

// ============================================
// 🚀 START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀🚀🚀 BLACK HOLE CHAT SERVER STARTED 🚀🚀🚀');
  console.log('='.repeat(60));
  console.log(`\n📡 Port: ${PORT}`);
  console.log(`💾 MongoDB: ${MONGODB_URI.replace(/:[^:@]*@/, ':****@')}`);
  console.log(`🔑 Admin Password: ${ADMIN_PASSWORD}`);
  console.log('\n' + '='.repeat(60) + '\n');
});

module.exports = { app, server, io };