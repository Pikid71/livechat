require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs').promises;
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB for file uploads
});

// ============================================
// 🔐 ENVIRONMENT VARIABLES
// ============================================
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'A@sh1shlivechat';
const PORT = process.env.PORT || 3000;
const OWNER_USERNAME = 'Pi_Kid71';

console.log('\n' + '='.repeat(70));
console.log('🚀 BLACK HOLE CHAT V2 - SERVER STARTING');
console.log('='.repeat(70));
console.log(`📡 Port: ${PORT}`);
console.log(`👑 Owner: ${OWNER_USERNAME}`);
console.log(`🔑 Admin Password: ${ADMIN_PASSWORD ? '****' : 'default'}`);
console.log('='.repeat(70) + '\n');

// ============================================
// 📁 FILE UPLOAD CONFIGURATION - FIXED
// ============================================
const uploadDir = path.join(__dirname, 'uploads');
console.log(`📁 Upload directory: ${uploadDir}`);

// Create uploads directory if it doesn't exist
(async () => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    console.log('✅ Uploads directory ready');
  } catch (err) {
    console.error('❌ Failed to create uploads directory:', err.message);
  }
})();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 
    'application/pdf', 'text/plain', 'audio/mpeg', 'audio/wav',
    'audio/mp3', 'video/mp4', 'video/webm', 'application/json',
    'application/javascript', 'text/css', 'text/html'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: fileFilter
});

// Serve uploaded files with proper headers
app.use('/uploads', express.static(uploadDir, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));

// ============================================
// 🔌 MONGODB CONNECTION
// ============================================
let isMongoConnected = false;

// MongoDB connection options
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  family: 4,
  maxPoolSize: 10
};

// Define schemas
let User, Room, Message, Ban, Session, PrivateMessage, FileModel;

async function connectToMongoDB() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not provided - running without database');
    return false;
  }

  try {
    console.log('🔌 Attempting to connect to MongoDB...');
    await mongoose.connect(MONGODB_URI, mongooseOptions);
    
    isMongoConnected = true;
    console.log('✅✅✅ MONGODB ATLAS CONNECTED SUCCESSFULLY!');
    
    initializeModels();
    setTimeout(() => initializeDefaultData(), 2000);
    
    return true;
  } catch (err) {
    console.error('❌❌❌ MONGODB CONNECTION FAILED:', err.message);
    console.log('⚠️ Server will run in MEMORY-ONLY mode');
    return false;
  }
}

function initializeModels() {
  if (!isMongoConnected) return;

  try {
    const UserSchema = new mongoose.Schema({
      username: { type: String, required: true, unique: true },
      password: { type: String, required: true },
      rank: { type: String, enum: ['owner', 'admin', 'moderator', 'vip', 'member'], default: 'member' },
      createdAt: { type: Date, default: Date.now },
      lastLogin: { type: Date },
      isBanned: { type: Boolean, default: false },
      avatar: { type: String, default: null },
      theme: { type: String, default: 'default' }
    });

    const RoomSchema = new mongoose.Schema({
      name: { type: String, required: true, unique: true },
      password: { type: String, default: '' },
      isDefault: { type: Boolean, default: false },
      createdBy: { type: String },
      createdAt: { type: Date, default: Date.now },
      theme: { type: String, default: 'default' }
    });

    const MessageSchema = new mongoose.Schema({
      roomName: { type: String, required: true, index: true },
      username: { type: String, required: true },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      isSystem: { type: Boolean, default: false },
      isPrivate: { type: Boolean, default: false },
      recipient: { type: String, default: null },
      senderRank: { type: String, default: 'member' },
      fileUrl: { type: String, default: null },
      fileName: { type: String, default: null },
      fileType: { type: String, default: null },
      fileSize: { type: Number, default: null }
    });

    const BanSchema = new mongoose.Schema({
      roomName: { type: String, required: true, index: true },
      username: { type: String, required: true },
      bannedBy: { type: String, required: true },
      bannedByRank: { type: String, default: 'admin' },
      bannedAt: { type: Date, default: Date.now },
      expiresAt: { type: Date, required: true },
      isActive: { type: Boolean, default: true }
    });

    const SessionSchema = new mongoose.Schema({
      socketId: { type: String, required: true, unique: true },
      username: { type: String, required: true },
      userRank: { type: String, default: 'member' },
      roomName: { type: String },
      connectedAt: { type: Date, default: Date.now },
      lastActivity: { type: Date, default: Date.now }
    });

    const PrivateMessageSchema = new mongoose.Schema({
      from: { type: String, required: true },
      to: { type: String, required: true },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      read: { type: Boolean, default: false },
      fromRank: { type: String, default: 'member' }
    });

    const FileModelSchema = new mongoose.Schema({
      filename: { type: String, required: true },
      originalName: { type: String, required: true },
      uploadedBy: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now },
      fileSize: { type: Number, required: true },
      fileType: { type: String, required: true },
      roomName: { type: String, default: null },
      recipient: { type: String, default: null }
    });

    User = mongoose.model('User', UserSchema);
    Room = mongoose.model('Room', RoomSchema);
    Message = mongoose.model('Message', MessageSchema);
    Ban = mongoose.model('Ban', BanSchema);
    Session = mongoose.model('Session', SessionSchema);
    PrivateMessage = mongoose.model('PrivateMessage', PrivateMessageSchema);
    FileModel = mongoose.model('File', FileModelSchema);

    console.log('✅ MongoDB models initialized');
    
  } catch (err) {
    console.error('❌ Failed to initialize models:', err.message);
  }
}

async function initializeDefaultData() {
  if (!isMongoConnected || !User || !Room) return;

  try {
    const defaultRoom = await Room.findOne({ name: 'Main' });
    if (!defaultRoom) {
      await Room.create({
        name: 'Main',
        password: '',
        isDefault: true,
        createdBy: 'System',
        theme: 'default'
      });
      console.log('✅ Default "Main" room created');
    }

    const owner = await User.findOne({ username: OWNER_USERNAME });
    if (!owner) {
      await User.create({
        username: OWNER_USERNAME,
        password: ADMIN_PASSWORD,
        rank: 'owner',
        lastLogin: new Date(),
        theme: 'dark'
      });
      console.log(`✅ Owner account created: ${OWNER_USERNAME}`);
    }

    const admin = await User.findOne({ username: 'admin' });
    if (!admin) {
      await User.create({
        username: 'admin',
        password: ADMIN_PASSWORD,
        rank: 'admin',
        lastLogin: new Date()
      });
      console.log('✅ Default admin account created');
    }

  } catch (err) {
    console.error('❌ Error initializing default data:', err.message);
  }
}

connectToMongoDB();

// ============================================
// 🚀 EXPRESS MIDDLEWARE
// ============================================
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// 📁 FILE UPLOAD ENDPOINT - FIXED
// ============================================
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`📤 File upload: ${req.file.originalname} (${req.file.size} bytes)`);

    // Process image optimization
    let finalPath = req.file.path;
    let fileSize = req.file.size;
    let fileType = req.file.mimetype;

    if (req.file.mimetype.startsWith('image/')) {
      try {
        const optimizedPath = path.join(uploadDir, 'opt-' + req.file.filename);
        await sharp(req.file.path)
          .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toFile(optimizedPath);
        
        await fs.unlink(req.file.path).catch(() => {});
        finalPath = optimizedPath;
        const stats = await fs.stat(optimizedPath);
        fileSize = stats.size;
        fileType = 'image/jpeg';
        console.log(`🖼️ Image optimized: ${fileSize} bytes`);
      } catch (imgErr) {
        console.error('Image optimization error:', imgErr.message);
      }
    }

    // Generate file URL
    const fileUrl = `/uploads/${path.basename(finalPath)}`;
    
    // Save to database if connected
    if (isMongoConnected && FileModel) {
      try {
        await FileModel.create({
          filename: path.basename(finalPath),
          originalName: req.file.originalname,
          uploadedBy: req.body.username || 'anonymous',
          fileSize: fileSize,
          fileType: fileType,
          roomName: req.body.roomName || null,
          recipient: req.body.recipient || null
        });
      } catch (dbErr) {
        console.error('Failed to save file metadata to DB:', dbErr.message);
      }
    }
    
    // Return file data with actual file URL
    res.json({
      success: true,
      fileUrl: fileUrl,
      fileName: req.file.originalname,
      fileType: fileType,
      fileSize: fileSize,
      message: `📁 File uploaded: ${req.file.originalname}`
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// File download endpoint
app.get('/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(uploadDir, filename);
    
    const exists = await fs.access(filepath).then(() => true).catch(() => false);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.sendFile(filepath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 📊 API ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: isMongoConnected ? 'connected' : 'disconnected',
    version: '2.0.0'
  });
});

app.get('/stats', async (req, res) => {
  const stats = {
    mongodb: isMongoConnected ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };

  if (isMongoConnected && User && Room) {
    try {
      stats.users = await User.countDocuments();
      stats.admins = await User.countDocuments({ rank: 'admin' });
      stats.owners = await User.countDocuments({ rank: 'owner' });
      stats.rooms = await Room.countDocuments();
      stats.messages = await Message.countDocuments();
    } catch (err) {
      stats.error = err.message;
    }
  }

  res.json(stats);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 🔧 IN-MEMORY STORAGE
// ============================================
const memoryStore = {
  users: new Map([
    [OWNER_USERNAME, { username: OWNER_USERNAME, password: ADMIN_PASSWORD, rank: 'owner', theme: 'dark' }],
    ['admin', { username: 'admin', password: ADMIN_PASSWORD, rank: 'admin', theme: 'default' }]
  ]),
  rooms: new Map([['Main', { 
    name: 'Main', 
    password: '', 
    isDefault: true, 
    members: new Map(), 
    messages: [],
    theme: 'default'
  }]]),
  sessions: new Map(),
  bans: new Map()
};

// ============================================
// 🔌 SOCKET.IO HANDLERS - FIXED
// ============================================

const PERMISSIONS = {
  owner: { level: 100, canBan: true, canUnban: true, canDeleteRoom: true, canClear: true, canGrant: ['admin', 'moderator', 'vip', 'member'], canUseEffects: true, canUpload: true, canVoice: true, canSeePrivate: true },
  admin: { level: 80, canBan: true, canUnban: true, canDeleteRoom: true, canClear: true, canGrant: ['moderator', 'vip', 'member'], canUseEffects: true, canUpload: true, canVoice: true, canSeePrivate: true },
  moderator: { level: 60, canBan: true, canUnban: false, canDeleteRoom: false, canClear: true, canGrant: [], canUseEffects: false, canUpload: true, canVoice: true, canSeePrivate: false },
  vip: { level: 40, canBan: false, canUnban: false, canDeleteRoom: false, canClear: false, canGrant: [], canUseEffects: false, canUpload: true, canVoice: true, canSeePrivate: false },
  member: { level: 20, canBan: false, canUnban: false, canDeleteRoom: false, canClear: false, canGrant: [], canUseEffects: false, canUpload: false, canVoice: true, canSeePrivate: false }
};

io.on('connection', (socket) => {
  console.log(`👤 New connection: ${socket.id} (Total: ${io.engine.clientsCount})`);
  
  let currentUser = null;
  let currentRoom = null;
  let userRank = 'member';
  
  // ========== AUTHENTICATION ==========
  
  socket.on('login', async (data) => {
    try {
      const { username, password } = data;
      console.log(`🔑 Login attempt: ${username}`);
      
      if (!username || !password) {
        return socket.emit('auth_error', { message: 'Username and password required' });
      }
      
      // Special case: Owner
      if (username === OWNER_USERNAME && password === ADMIN_PASSWORD) {
        currentUser = username;
        userRank = 'owner';
        memoryStore.sessions.set(socket.id, { username, rank: 'owner' });
        socket.emit('auth_success', { username, rank: 'owner', theme: 'dark', message: 'Welcome Owner!' });
        console.log(`✅ Owner logged in: ${username}`);
        return;
      }
      
      // Special case: Admin
      if (username === 'admin' && password === ADMIN_PASSWORD) {
        currentUser = username;
        userRank = 'admin';
        memoryStore.sessions.set(socket.id, { username, rank: 'admin' });
        socket.emit('auth_success', { username, rank: 'admin', theme: 'default', message: 'Welcome Admin!' });
        console.log(`✅ Admin logged in: ${username}`);
        return;
      }
      
      // Check memory store
      if (memoryStore.users.has(username)) {
        const user = memoryStore.users.get(username);
        if (user.password === password) {
          currentUser = username;
          userRank = user.rank;
          memoryStore.sessions.set(socket.id, { username, rank: userRank });
          socket.emit('auth_success', { username, rank: userRank, theme: user.theme || 'default', message: 'Login successful!' });
          console.log(`✅ User logged in: ${username} (${userRank})`);
          return;
        }
      }
      
      // Create new user automatically (for testing)
      if (!memoryStore.users.has(username)) {
        memoryStore.users.set(username, { username, password, rank: 'member', theme: 'default' });
        currentUser = username;
        userRank = 'member';
        memoryStore.sessions.set(socket.id, { username, rank: 'member' });
        socket.emit('auth_success', { username, rank: 'member', theme: 'default', message: 'Account created!' });
        console.log(`✅ New user created: ${username}`);
        return;
      }
      
      socket.emit('auth_error', { message: 'Invalid credentials' });
      
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth_error', { message: 'Server error' });
    }
  });
  
  socket.on('logout', () => {
    if (currentUser) {
      console.log(`👋 Logout: ${currentUser}`);
      if (currentRoom) {
        socket.leave(currentRoom);
      }
      memoryStore.sessions.delete(socket.id);
    }
    socket.emit('logged_out');
    currentUser = null;
    currentRoom = null;
  });
  
  // ========== ROOMS ==========
  
  socket.on('get_rooms', () => {
    try {
      const roomsList = [];
      for (const [name, room] of memoryStore.rooms) {
        const members = Array.from(memoryStore.sessions.values())
          .filter(s => s.roomName === name).length;
        
        roomsList.push({
          name,
          hasPassword: !!room.password,
          members,
          isDefault: room.isDefault || false,
          theme: room.theme || 'default'
        });
      }
      socket.emit('rooms_list', roomsList);
    } catch (err) {
      console.error('get_rooms error:', err);
      socket.emit('rooms_list', []);
    }
  });
  
  socket.on('get_room_users', (data) => {
    try {
      const { roomName } = data;
      const users = [];
      
      for (const [sid, session] of memoryStore.sessions) {
        if (session.roomName === roomName) {
          users.push({
            username: session.username,
            rank: session.rank || 'member'
          });
        }
      }
      
      socket.emit('room_users', { users });
    } catch (err) {
      console.error('get_room_users error:', err);
    }
  });
  
  socket.on('create_room', (data) => {
    try {
      if (!currentUser) {
        return socket.emit('error', { message: 'Not authenticated' });
      }
      
      const { roomName, password, theme = 'default' } = data;
      
      if (!roomName || roomName.trim() === '') {
        return socket.emit('error', { message: 'Room name cannot be empty' });
      }
      
      if (memoryStore.rooms.has(roomName)) {
        return socket.emit('error', { message: 'Room already exists' });
      }
      
      memoryStore.rooms.set(roomName, {
        name: roomName,
        password: password || '',
        isDefault: false,
        createdBy: currentUser,
        theme,
        members: new Map(),
        messages: []
      });
      
      // Join room
      if (currentRoom) {
        socket.leave(currentRoom);
      }
      currentRoom = roomName;
      socket.join(roomName);
      
      const session = memoryStore.sessions.get(socket.id);
      if (session) session.roomName = roomName;
      
      socket.emit('joined_room', { roomName, username: currentUser, rank: userRank, theme });
      
      // Notify room
      io.to(roomName).emit('user_joined', {
        username: currentUser,
        rank: userRank,
        members: 1
      });
      
      io.emit('room_created', { name: roomName, hasPassword: !!password, theme });
      console.log(`🏠 Room created: ${roomName} by ${currentUser}`);
      
    } catch (err) {
      console.error('create_room error:', err);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });
  
  socket.on('join_room', (data) => {
    try {
      if (!currentUser) {
        return socket.emit('error', { message: 'Not authenticated' });
      }
      
      const { roomName, password } = data;
      
      const room = memoryStore.rooms.get(roomName);
      if (!room) {
        return socket.emit('error', { message: 'Room does not exist' });
      }
      
      if (room.password && room.password !== password) {
        return socket.emit('error', { message: 'Incorrect password' });
      }
      
      // Leave old room
      if (currentRoom) {
        socket.leave(currentRoom);
        const oldSession = memoryStore.sessions.get(socket.id);
        if (oldSession) oldSession.roomName = null;
      }
      
      currentRoom = roomName;
      socket.join(roomName);
      
      const session = memoryStore.sessions.get(socket.id);
      if (session) session.roomName = roomName;
      
      socket.emit('joined_room', { roomName, username: currentUser, rank: userRank, theme: room.theme || 'default' });
      
      // Send message history
      socket.emit('room_history', {
        messages: room.messages || []
      });
      
      // Notify room
      const members = Array.from(memoryStore.sessions.values())
        .filter(s => s.roomName === roomName).length;
      
      io.to(roomName).emit('user_joined', {
        username: currentUser,
        rank: userRank,
        members
      });
      
      console.log(`🚪 ${currentUser} joined room: ${roomName}`);
      
    } catch (err) {
      console.error('join_room error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  socket.on('leave_room', () => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const roomName = currentRoom;
      
      const session = memoryStore.sessions.get(socket.id);
      if (session) session.roomName = null;
      
      socket.leave(roomName);
      
      // Get member count
      const members = Array.from(memoryStore.sessions.values())
        .filter(s => s.roomName === roomName).length;
      
      io.to(roomName).emit('user_left', {
        username: currentUser,
        rank: userRank,
        members
      });
      
      // System message
      const systemMsg = {
        username: 'System',
        message: `👋 ${currentUser} left the room`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      
      // Save to room history
      const room = memoryStore.rooms.get(roomName);
      if (room) {
        if (!room.messages) room.messages = [];
        room.messages.push(systemMsg);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      // Delete empty non-default rooms
      if (members === 0 && roomName !== 'Main') {
        memoryStore.rooms.delete(roomName);
        io.emit('room_deleted', { name: roomName });
        console.log(`🗑️ Empty room deleted: ${roomName}`);
      }
      
      currentRoom = null;
      console.log(`🚪 ${currentUser} left room: ${roomName}`);
      
    } catch (err) {
      console.error('leave_room error:', err);
    }
  });
  
  // ========== MESSAGES ==========
  
  socket.on('chat message', (msg) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const messageData = {
        username: currentUser,
        message: msg.message,
        timestamp: new Date().toLocaleTimeString(),
        rank: userRank
      };
      
      // Save to room history
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
        if (!room.messages) room.messages = [];
        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      // Broadcast to others
      socket.broadcast.to(currentRoom).emit('chat message', messageData);
      
    } catch (err) {
      console.error('message error:', err);
    }
  });
  
  // ========== FILE SHARING - FIXED ==========
  
  socket.on('share_file', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const { fileUrl, fileName, fileType, fileSize } = data;
      
      const messageData = {
        username: currentUser,
        message: `📁 Shared file: ${fileName}`,
        fileUrl: fileUrl,
        fileName: fileName,
        fileType: fileType,
        fileSize: fileSize,
        timestamp: new Date().toLocaleTimeString(),
        rank: userRank
      };
      
      // Save to room history
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
        if (!room.messages) room.messages = [];
        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      // Broadcast to all in room (including sender)
      io.to(currentRoom).emit('chat message', messageData);
      console.log(`📁 File shared by ${currentUser}: ${fileName}`);
      
    } catch (err) {
      console.error('share_file error:', err);
    }
  });
  
  // ========== PRIVATE MESSAGES ==========
  
  socket.on('private_message', (data) => {
    try {
      if (!currentUser) return;
      
      const { recipient, message } = data;
      
      if (!recipient || !message) return;
      
      const messageData = {
        from: currentUser,
        fromRank: userRank,
        message,
        timestamp: new Date().toLocaleTimeString()
      };
      
      // Find recipient socket
      let recipientSocketId = null;
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === recipient) {
          recipientSocketId = sid;
          break;
        }
      }
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private_message', messageData);
      }
      
      socket.emit('private_message_sent', {
        to: recipient,
        message,
        timestamp: messageData.timestamp
      });
      
      // Log for admins
      if (userRank === 'admin' || userRank === 'owner') {
        const adminLog = {
          username: 'System',
          message: `👮 ADMIN LOG: ${currentUser} → ${recipient}: ${message}`,
          timestamp: new Date().toLocaleTimeString(),
          rank: 'system'
        };
        
        if (currentRoom) {
          io.to(currentRoom).emit('chat message', adminLog);
        }
      }
      
      console.log(`💌 PM: ${currentUser} -> ${recipient}`);
      
    } catch (err) {
      console.error('private message error:', err);
    }
  });
  
  // ========== VOICE CHAT SIGNALING - FIXED ==========
  
  socket.on('join_voice', (data) => {
    try {
      const { roomName } = data;
      socket.join(`voice:${roomName}`);
      socket.to(`voice:${roomName}`).emit('user_joined_voice', {
        userId: socket.id,
        username: currentUser
      });
      console.log(`🎤 ${currentUser} joined voice in ${roomName}`);
    } catch (err) {
      console.error('join_voice error:', err);
    }
  });
  
  socket.on('leave_voice', (data) => {
    try {
      const { roomName } = data;
      socket.leave(`voice:${roomName}`);
      socket.to(`voice:${roomName}`).emit('user_left_voice', {
        userId: socket.id
      });
      console.log(`🎤 ${currentUser} left voice`);
    } catch (err) {
      console.error('leave_voice error:', err);
    }
  });
  
  socket.on('voice_offer', (data) => {
    try {
      const { target, offer, roomName } = data;
      io.to(target).emit('voice_offer', {
        from: socket.id,
        offer,
        roomName
      });
    } catch (err) {
      console.error('voice_offer error:', err);
    }
  });
  
  socket.on('voice_answer', (data) => {
    try {
      const { target, answer } = data;
      io.to(target).emit('voice_answer', {
        from: socket.id,
        answer
      });
    } catch (err) {
      console.error('voice_answer error:', err);
    }
  });
  
  socket.on('ice_candidate', (data) => {
    try {
      const { target, candidate } = data;
      io.to(target).emit('ice_candidate', {
        from: socket.id,
        candidate
      });
    } catch (err) {
      console.error('ice_candidate error:', err);
    }
  });
  
  // ========== ADMIN COMMANDS ==========
  
  socket.on('clear_messages', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canClear) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { password } = data;
      
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Clear messages
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
        room.messages = [];
      }
      
      io.to(currentRoom).emit('messages_cleared');
      
      const systemMsg = {
        username: 'System',
        message: `🧹 Messages cleared by ${currentUser}`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      if (room) {
        room.messages = [systemMsg];
      }
      
      console.log(`🧹 Messages cleared by ${currentUser} in ${currentRoom}`);
      
    } catch (err) {
      console.error('clear_messages error:', err);
    }
  });
  
  socket.on('ban_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canBan) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { bannedUser, duration = '10m', password } = data;
      
      if (!bannedUser) return;
      
      if (userRank === 'moderator' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Parse duration
      let durationMs = 10 * 60 * 1000;
      const match = duration.match(/^(\d+)([hmd])$/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        if (unit === 'h') durationMs = val * 60 * 60 * 1000;
        else if (unit === 'd') durationMs = val * 24 * 60 * 60 * 1000;
      }
      
      const expiresAt = Date.now() + durationMs;
      
      // Store ban in memory
      if (!memoryStore.bans.has(currentRoom)) {
        memoryStore.bans.set(currentRoom, new Map());
      }
      const roomBans = memoryStore.bans.get(currentRoom);
      roomBans.set(bannedUser, { expiresAt, bannedBy: currentUser });
      
      io.to(currentRoom).emit('user_banned', { bannedUser, duration, bannerName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `⛔ ${bannedUser} banned by ${currentUser} for ${duration}`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      // Kick user if in room
      let bannedSocketId = null;
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === bannedUser && session.roomName === currentRoom) {
          bannedSocketId = sid;
          break;
        }
      }
      
      if (bannedSocketId) {
        io.to(bannedSocketId).emit('force_leave', { roomName: currentRoom, reason: 'banned' });
      }
      
      console.log(`🔨 ${bannedUser} banned from ${currentRoom} by ${currentUser}`);
      
    } catch (err) {
      console.error('ban_user error:', err);
    }
  });
  
  socket.on('unban_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUnban) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { unbannedUser, password } = data;
      
      if (!unbannedUser) return;
      
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Remove ban
      const roomBans = memoryStore.bans.get(currentRoom);
      if (roomBans) {
        roomBans.delete(unbannedUser);
      }
      
      io.to(currentRoom).emit('user_unbanned', { unbannedUser, unbannerName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `✅ ${unbannedUser} unbanned by ${currentUser}`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      console.log(`✅ ${unbannedUser} unbanned from ${currentRoom} by ${currentUser}`);
      
    } catch (err) {
      console.error('unban_user error:', err);
    }
  });
  
  socket.on('delete_room', (data) => {
    try {
      if (!currentUser) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canDeleteRoom) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { roomName, password } = data;
      
      if (!roomName) return;
      
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      if (roomName === 'Main') {
        return socket.emit('error', { message: 'Cannot delete Main room' });
      }
      
      const room = memoryStore.rooms.get(roomName);
      if (room) {
        memoryStore.rooms.delete(roomName);
      }
      
      // Kick all users from room
      io.to(roomName).emit('room_deleted_by_owner', { roomName });
      
      // Notify all clients
      io.emit('room_deleted', { name: roomName });
      
      console.log(`🗑️ Room deleted: ${roomName} by ${currentUser}`);
      
    } catch (err) {
      console.error('delete_room error:', err);
      socket.emit('error', { message: 'Failed to delete room' });
    }
  });
  
  socket.on('effect_command', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUseEffects) {
        return socket.emit('error', { message: '❌ Only admins can use effects' });
      }
      
      const { effect } = data;
      
      const validEffects = ['glitch', 'flashbang', 'black', 'hack', 'matrix', 'rainbow', 'neon', 'firework', 'confetti'];
      
      if (!validEffects.includes(effect)) {
        return socket.emit('error', { message: '❌ Invalid effect' });
      }
      
      io.to(currentRoom).emit('room_effect', {
        effect,
        triggeredBy: currentUser,
        rank: userRank
      });
      
      console.log(`✨ Effect ${effect} triggered by ${currentUser} in ${currentRoom}`);
      
    } catch (err) {
      console.error('effect_command error:', err);
    }
  });
  
  socket.on('grant_rank', (data) => {
    try {
      if (!currentUser) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canGrant || permissions.canGrant.length === 0) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { targetUser, newRank, password } = data;
      
      if (!targetUser || !newRank) return;
      
      if (!permissions.canGrant.includes(newRank)) {
        return socket.emit('error', { message: `❌ Cannot grant ${newRank} rank` });
      }
      
      if (userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Update rank in memory
      if (memoryStore.users.has(targetUser)) {
        const user = memoryStore.users.get(targetUser);
        user.rank = newRank;
        
        // Update session if online
        for (const [sid, session] of memoryStore.sessions) {
          if (session.username === targetUser) {
            session.rank = newRank;
            io.to(sid).emit('rank_changed', { newRank, grantedBy: currentUser });
            break;
          }
        }
      }
      
      socket.emit('command_success', { message: `✅ ${targetUser} is now ${newRank}` });
      console.log(`👑 ${currentUser} granted ${targetUser} rank ${newRank}`);
      
    } catch (err) {
      console.error('grant_rank error:', err);
    }
  });
  
  // ========== DISCONNECT ==========
  
  socket.on('disconnect', () => {
    try {
      if (currentUser && currentRoom) {
        const roomName = currentRoom;
        
        // Notify room
        io.to(roomName).emit('user_left', {
          username: currentUser,
          rank: userRank,
          members: 0
        });
        
        // System message
        io.to(roomName).emit('chat message', {
          username: 'System',
          message: `👋 ${currentUser} disconnected`,
          timestamp: new Date().toLocaleTimeString(),
          rank: 'system'
        });
      }
      
      memoryStore.sessions.delete(socket.id);
      console.log(`👋 Disconnect: ${socket.id} (${currentUser || 'anonymous'})`);
      
    } catch (err) {
      console.error('disconnect error:', err);
    }
  });
});

// ============================================
// 🚀 START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(70));
  console.log('🚀🚀🚀 BLACK HOLE CHAT V2 - SERVER RUNNING 🚀🚀🚀');
  console.log('='.repeat(70));
  console.log(`\n📡 Port: ${PORT}`);
  console.log(`👑 Owner: ${OWNER_USERNAME}`);
  console.log(`💾 MongoDB: ${isMongoConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
  console.log(`📁 Uploads: ${uploadDir}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log('\n' + '='.repeat(70) + '\n');
});

module.exports = { app, server, io };