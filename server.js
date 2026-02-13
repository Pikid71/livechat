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
  maxHttpBufferSize: 10 * 1024 * 1024 // 10MB for file uploads
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
console.log(`💾 MongoDB URI: ${MONGODB_URI ? MONGODB_URI.replace(/:[^:@]*@/, ':****@') : 'NOT SET'}`);
console.log('='.repeat(70) + '\n');

// ============================================
// 📁 FILE UPLOAD CONFIGURATION
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
    'video/mp4', 'application/json'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: images, PDF, text, audio, video, JSON'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: fileFilter
});

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));

// ============================================
// 🔌 MONGODB CONNECTION WITH AUTO-RECONNECT
// ============================================
let isMongoConnected = false;
let dbReady = false;

// MongoDB connection options
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  family: 4, // Use IPv4, skip IPv6
  autoIndex: true,
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 10000,
  waitQueueTimeoutMS: 10000
};

// Define schemas
let User, Room, Message, Ban, Session, PrivateMessage, FileModel;

// Connect to MongoDB
async function connectToMongoDB() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not provided - running without database');
    return false;
  }

  try {
    console.log('🔌 Attempting to connect to MongoDB...');
    await mongoose.connect(MONGODB_URI, mongooseOptions);
    
    isMongoConnected = true;
    dbReady = true;
    console.log('✅✅✅ MONGODB ATLAS CONNECTED SUCCESSFULLY!');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`📡 Host: ${mongoose.connection.host}`);
    
    // Initialize models after connection
    initializeModels();
    
    // Initialize default data
    setTimeout(() => initializeDefaultData(), 2000);
    
    return true;
  } catch (err) {
    console.error('❌❌❌ MONGODB CONNECTION FAILED:');
    console.error(`   Error: ${err.message}`);
    
    if (err.message.includes('Authentication failed')) {
      console.error('   🔑 FIX: Check username/password in connection string');
      console.error('      Make sure password has %40 instead of @');
    }
    if (err.message.includes('getaddrinfo')) {
      console.error('   🌐 FIX: Check cluster name in connection string');
      console.error('      Should be: cluster0.j2qik61.mongodb.net');
    }
    if (err.message.includes('timed out')) {
      console.error('   🔓 FIX: Add 0.0.0.0/0 to MongoDB Atlas Network Access');
      console.error('      Go to: https://cloud.mongodb.com → Network Access');
    }
    
    console.log('⚠️ Server will run in MEMORY-ONLY mode - data will NOT persist!');
    
    // Set up reconnection attempt
    setTimeout(() => {
      console.log('🔄 Attempting to reconnect to MongoDB...');
      connectToMongoDB();
    }, 30000); // Try again in 30 seconds
    
    return false;
  }
}

// Initialize Mongoose models
function initializeModels() {
  if (!isMongoConnected) return;

  try {
    // User Schema with Ranks
    const UserSchema = new mongoose.Schema({
      username: { type: String, required: true, unique: true },
      password: { type: String, required: true },
      rank: { 
        type: String, 
        enum: ['owner', 'admin', 'moderator', 'vip', 'member'],
        default: 'member'
      },
      createdAt: { type: Date, default: Date.now },
      lastLogin: { type: Date },
      isBanned: { type: Boolean, default: false },
      avatar: { type: String, default: null },
      theme: { type: String, default: 'default' }
    });

    // Room Schema
    const RoomSchema = new mongoose.Schema({
      name: { type: String, required: true, unique: true },
      password: { type: String, default: '' },
      isDefault: { type: Boolean, default: false },
      createdBy: { type: String },
      createdAt: { type: Date, default: Date.now },
      theme: { type: String, default: 'default' }
    });

    // Message Schema
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
      fileType: { type: String, default: null }
    });

    // Ban Schema
    const BanSchema = new mongoose.Schema({
      roomName: { type: String, required: true, index: true },
      username: { type: String, required: true },
      bannedBy: { type: String, required: true },
      bannedByRank: { type: String, default: 'admin' },
      bannedAt: { type: Date, default: Date.now },
      expiresAt: { type: Date, required: true },
      isActive: { type: Boolean, default: true }
    });

    // Session Schema
    const SessionSchema = new mongoose.Schema({
      socketId: { type: String, required: true, unique: true },
      username: { type: String, required: true },
      userRank: { type: String, default: 'member' },
      roomName: { type: String },
      connectedAt: { type: Date, default: Date.now },
      lastActivity: { type: Date, default: Date.now }
    });

    // Private Message Schema
    const PrivateMessageSchema = new mongoose.Schema({
      from: { type: String, required: true },
      to: { type: String, required: true },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      read: { type: Boolean, default: false },
      fromRank: { type: String, default: 'member' }
    });

    // File Schema
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

    // Create models
    User = mongoose.model('User', UserSchema);
    Room = mongoose.model('Room', RoomSchema);
    Message = mongoose.model('Message', MessageSchema);
    Ban = mongoose.model('Ban', BanSchema);
    Session = mongoose.model('Session', SessionSchema);
    PrivateMessage = mongoose.model('PrivateMessage', PrivateMessageSchema);
    FileModel = mongoose.model('File', FileModelSchema);

    console.log('✅ MongoDB models initialized');
    
    // Create indexes
    User.createIndexes();
    Room.createIndexes();
    Message.createIndexes();
    Ban.createIndexes();
    
  } catch (err) {
    console.error('❌ Failed to initialize models:', err.message);
  }
}

// Initialize default data (rooms, owner account)
async function initializeDefaultData() {
  if (!isMongoConnected || !User || !Room) {
    console.log('⚠️ MongoDB not connected - skipping default data initialization');
    return;
  }

  try {
    console.log('🏗️ Initializing default data...');
    
    // Create default Main room
    let defaultRoom = await Room.findOne({ name: 'Main' });
    if (!defaultRoom) {
      defaultRoom = await Room.create({
        name: 'Main',
        password: '',
        isDefault: true,
        createdBy: 'System',
        theme: 'default'
      });
      console.log('✅ Default "Main" room created');
    } else {
      console.log('✅ Default "Main" room exists');
    }

    // Create owner account (Pi_Kid71)
    let owner = await User.findOne({ username: OWNER_USERNAME });
    if (!owner) {
      owner = await User.create({
        username: OWNER_USERNAME,
        password: ADMIN_PASSWORD,
        rank: 'owner',
        lastLogin: new Date(),
        theme: 'dark'
      });
      console.log(`✅ Owner account created: ${OWNER_USERNAME}`);
    } else {
      // Ensure owner has correct rank
      if (owner.rank !== 'owner') {
        owner.rank = 'owner';
        await owner.save();
        console.log(`✅ Owner rank updated for ${OWNER_USERNAME}`);
      } else {
        console.log(`✅ Owner account exists: ${OWNER_USERNAME}`);
      }
    }

    // Create default admin account
    let admin = await User.findOne({ username: 'admin' });
    if (!admin) {
      admin = await User.create({
        username: 'admin',
        password: ADMIN_PASSWORD,
        rank: 'admin',
        lastLogin: new Date()
      });
      console.log('✅ Default admin account created');
    } else {
      console.log('✅ Admin account exists');
    }

    console.log('✅ Default data initialization complete');
    
  } catch (err) {
    console.error('❌ Error initializing default data:', err.message);
  }
}

// Start MongoDB connection
connectToMongoDB();

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
  isMongoConnected = false;
  dbReady = false;
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
  isMongoConnected = false;
  dbReady = false;
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
  isMongoConnected = true;
  dbReady = true;
});

// ============================================
// 🚀 EXPRESS MIDDLEWARE
// ============================================
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

// ============================================
// 📁 FILE UPLOAD ENDPOINT
// ============================================
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`📤 File upload: ${req.file.originalname} (${req.file.size} bytes)`);

    // Optimize image if it's an image
    let finalPath = req.file.path;
    let fileSize = req.file.size;

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
        console.log(`🖼️ Image optimized: ${fileSize} bytes`);
      } catch (imgErr) {
        console.error('Image optimization error:', imgErr.message);
        // Continue with original file
      }
    }

    const fileUrl = `/uploads/${path.basename(finalPath)}`;
    
    // Save to database if connected
    if (isMongoConnected && FileModel) {
      try {
        await FileModel.create({
          filename: path.basename(finalPath),
          originalName: req.file.originalname,
          uploadedBy: req.body.username || 'anonymous',
          fileSize: fileSize,
          fileType: req.file.mimetype,
          roomName: req.body.roomName || null,
          recipient: req.body.recipient || null
        });
      } catch (dbErr) {
        console.error('Failed to save file metadata to DB:', dbErr.message);
      }
    }
    
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: fileSize
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ============================================
// 📊 API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: isMongoConnected ? 'connected' : 'disconnected',
    memory: process.memoryUsage(),
    version: '2.0.0'
  });
});

// Stats
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
      stats.privateMessages = await PrivateMessage.countDocuments();
      stats.activeSessions = await Session.countDocuments();
      stats.files = await FileModel.countDocuments();
    } catch (err) {
      stats.error = err.message;
    }
  }

  res.json(stats);
});

// List files
app.get('/files', async (req, res) => {
  if (!isMongoConnected || !FileModel) {
    return res.json({ files: [] });
  }
  
  try {
    const files = await FileModel.find().sort({ uploadedAt: -1 }).limit(50);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 🔧 UTILITY FUNCTIONS
// ============================================

// In-memory storage for when MongoDB is not available
const memoryStore = {
  users: new Map(),
  rooms: new Map([['Main', { 
    name: 'Main', 
    password: '', 
    isDefault: true, 
    members: [], 
    messages: [],
    theme: 'default'
  }]]),
  sessions: new Map(),
  bans: new Map()
};

// Add default users to memory store
memoryStore.users.set(OWNER_USERNAME, { 
  username: OWNER_USERNAME, 
  password: ADMIN_PASSWORD, 
  rank: 'owner',
  theme: 'dark'
});
memoryStore.users.set('admin', { 
  username: 'admin', 
  password: ADMIN_PASSWORD, 
  rank: 'admin',
  theme: 'default'
});

// ============================================
// 🔌 SOCKET.IO HANDLERS
// ============================================

// Rank permissions
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
  
  // Login
  socket.on('login', async (data) => {
    try {
      const { username, password } = data;
      console.log(`🔑 Login attempt: ${username}`);
      
      if (!username || !password) {
        return socket.emit('auth_error', { message: 'Username and password required' });
      }
      
      // Check if using MongoDB
      if (isMongoConnected && User) {
        try {
          const user = await User.findOne({ username });
          
          if (!user) {
            return socket.emit('auth_error', { message: 'Username not found' });
          }
          
          if (user.password !== password) {
            return socket.emit('auth_error', { message: 'Incorrect password' });
          }
          
          user.lastLogin = new Date();
          await user.save();
          
          currentUser = username;
          userRank = user.rank;
          
          // Create session in DB
          try {
            await Session.create({
              socketId: socket.id,
              username,
              userRank: user.rank
            });
          } catch (sessionErr) {
            console.error('Session creation error:', sessionErr.message);
          }
          
          socket.emit('auth_success', { 
            username, 
            rank: user.rank,
            theme: user.theme || 'default',
            message: 'Login successful!'
          });
          
          console.log(`✅ User logged in (DB): ${username} (${user.rank})`);
          return;
          
        } catch (dbErr) {
          console.error('DB login error:', dbErr.message);
          // Fall through to memory store
        }
      }
      
      // Memory store fallback
      if (memoryStore.users.has(username)) {
        const user = memoryStore.users.get(username);
        if (user.password === password) {
          currentUser = username;
          userRank = user.rank;
          memoryStore.sessions.set(socket.id, { username, rank: userRank });
          
          socket.emit('auth_success', { 
            username, 
            rank: userRank,
            theme: user.theme || 'default',
            message: 'Login successful! (Memory mode)'
          });
          
          console.log(`✅ User logged in (Memory): ${username} (${userRank})`);
          return;
        }
      }
      
      // Special case: Owner always works
      if (username === OWNER_USERNAME && password === ADMIN_PASSWORD) {
        currentUser = username;
        userRank = 'owner';
        memoryStore.sessions.set(socket.id, { username, rank: 'owner' });
        
        socket.emit('auth_success', { 
          username, 
          rank: 'owner',
          theme: 'dark',
          message: 'Welcome Owner!'
        });
        
        console.log(`✅ Owner logged in: ${username}`);
        return;
      }
      
      // Special case: Admin with correct password
      if (username === 'admin' && password === ADMIN_PASSWORD) {
        currentUser = username;
        userRank = 'admin';
        memoryStore.sessions.set(socket.id, { username, rank: 'admin' });
        
        socket.emit('auth_success', { 
          username, 
          rank: 'admin',
          theme: 'default',
          message: 'Welcome Admin!'
        });
        
        console.log(`✅ Admin logged in: ${username}`);
        return;
      }
      
      // For testing: accept any username/password
      currentUser = username;
      userRank = 'member';
      memoryStore.sessions.set(socket.id, { username, rank: 'member' });
      
      socket.emit('auth_success', { 
        username, 
        rank: 'member',
        theme: 'default',
        message: 'Login successful! (Test mode)'
      });
      
      console.log(`✅ User logged in (Test): ${username}`);
      
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth_error', { message: 'Server error during login' });
    }
  });
  
  // Register
  socket.on('register', async (data) => {
    try {
      const { username, password } = data;
      
      if (!username || !password) {
        return socket.emit('auth_error', { message: 'Username and password required' });
      }
      
      if (username.length < 3) {
        return socket.emit('auth_error', { message: 'Username must be at least 3 characters' });
      }
      
      if (password.length < 4) {
        return socket.emit('auth_error', { message: 'Password must be at least 4 characters' });
      }
      
      // Reserved usernames
      if (username === OWNER_USERNAME || username === 'admin') {
        return socket.emit('auth_error', { message: 'Username reserved' });
      }
      
      // Try MongoDB first
      if (isMongoConnected && User) {
        try {
          const existing = await User.findOne({ username });
          if (existing) {
            return socket.emit('auth_error', { message: 'Username already exists' });
          }
          
          await User.create({
            username,
            password,
            rank: 'member',
            lastLogin: new Date()
          });
          
          currentUser = username;
          userRank = 'member';
          
          socket.emit('auth_success', { 
            username, 
            rank: 'member',
            message: 'Registration successful!'
          });
          
          console.log(`✅ User registered (DB): ${username}`);
          return;
          
        } catch (dbErr) {
          console.error('DB registration error:', dbErr.message);
        }
      }
      
      // Memory store fallback
      if (memoryStore.users.has(username)) {
        return socket.emit('auth_error', { message: 'Username already exists' });
      }
      
      memoryStore.users.set(username, { username, password, rank: 'member', theme: 'default' });
      memoryStore.sessions.set(socket.id, { username, rank: 'member' });
      
      currentUser = username;
      userRank = 'member';
      
      socket.emit('auth_success', { 
        username, 
        rank: 'member',
        message: 'Registration successful! (Memory mode)'
      });
      
      console.log(`✅ User registered (Memory): ${username}`);
      
    } catch (err) {
      console.error('Registration error:', err);
      socket.emit('auth_error', { message: 'Server error during registration' });
    }
  });
  
  // Logout
  socket.on('logout', async () => {
    try {
      if (currentUser) {
        console.log(`👋 Logout: ${currentUser}`);
        
        // Remove from DB if connected
        if (isMongoConnected && Session) {
          await Session.deleteOne({ socketId: socket.id }).catch(() => {});
        }
        
        // Remove from memory
        memoryStore.sessions.delete(socket.id);
        
        // Leave current room
        if (currentRoom) {
          socket.leave(currentRoom);
        }
      }
      
      socket.emit('logged_out');
      currentUser = null;
      currentRoom = null;
      
    } catch (err) {
      console.error('Logout error:', err);
      socket.emit('logged_out');
    }
  });
  
  // ========== ROOMS ==========
  
  // Get rooms list
  socket.on('get_rooms', async () => {
    try {
      const roomsList = [];
      
      // Try DB first
      if (isMongoConnected && Room) {
        try {
          const rooms = await Room.find();
          for (const room of rooms) {
            const sessions = isMongoConnected && Session 
              ? await Session.countDocuments({ roomName: room.name })
              : 0;
            
            roomsList.push({
              name: room.name,
              hasPassword: !!room.password,
              members: sessions,
              isDefault: room.isDefault || false,
              theme: room.theme || 'default'
            });
          }
          
          return socket.emit('rooms_list', roomsList);
        } catch (dbErr) {
          console.error('DB get_rooms error:', dbErr.message);
        }
      }
      
      // Memory store fallback
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
  
  // Create room
  socket.on('create_room', async (data) => {
    try {
      if (!currentUser) {
        return socket.emit('error', { message: 'Not authenticated' });
      }
      
      const { roomName, password, theme = 'default' } = data;
      
      if (!roomName || roomName.trim() === '') {
        return socket.emit('error', { message: 'Room name cannot be empty' });
      }
      
      // Try DB first
      if (isMongoConnected && Room) {
        try {
          const existing = await Room.findOne({ name: roomName });
          if (existing) {
            return socket.emit('error', { message: 'Room already exists' });
          }
          
          await Room.create({
            name: roomName,
            password: password || '',
            createdBy: currentUser,
            isDefault: false,
            theme
          });
          
          // Join room
          currentRoom = roomName;
          socket.join(roomName);
          
          socket.emit('joined_room', { roomName, username: currentUser, rank: userRank, theme });
          
          // Notify others
          io.to(roomName).emit('user_joined', {
            username: currentUser,
            rank: userRank,
            members: 1
          });
          
          io.emit('room_created', { name: roomName, hasPassword: !!password, theme });
          
          console.log(`🏠 Room created (DB): ${roomName} by ${currentUser}`);
          return;
          
        } catch (dbErr) {
          console.error('DB create_room error:', dbErr.message);
        }
      }
      
      // Memory store fallback
      if (memoryStore.rooms.has(roomName)) {
        return socket.emit('error', { message: 'Room already exists' });
      }
      
      memoryStore.rooms.set(roomName, {
        name: roomName,
        password: password || '',
        isDefault: false,
        createdBy: currentUser,
        theme,
        members: [],
        messages: []
      });
      
      // Join room
      currentRoom = roomName;
      socket.join(roomName);
      
      const session = memoryStore.sessions.get(socket.id);
      if (session) session.roomName = roomName;
      
      socket.emit('joined_room', { roomName, username: currentUser, rank: userRank, theme });
      
      io.to(roomName).emit('user_joined', {
        username: currentUser,
        rank: userRank,
        members: 1
      });
      
      io.emit('room_created', { name: roomName, hasPassword: !!password, theme });
      
      console.log(`🏠 Room created (Memory): ${roomName} by ${currentUser}`);
      
    } catch (err) {
      console.error('create_room error:', err);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });
  
  // Join room
  socket.on('join_room', async (data) => {
    try {
      if (!currentUser) {
        return socket.emit('error', { message: 'Not authenticated' });
      }
      
      const { roomName, password } = data;
      
      // Try DB first
      if (isMongoConnected && Room) {
        try {
          const room = await Room.findOne({ name: roomName });
          if (!room) {
            return socket.emit('error', { message: 'Room does not exist' });
          }
          
          if (room.password && room.password !== password) {
            return socket.emit('error', { message: 'Incorrect password' });
          }
          
          // Check bans
          if (Ban) {
            const activeBan = await Ban.findOne({
              roomName,
              username: currentUser,
              isActive: true,
              expiresAt: { $gt: new Date() }
            });
            
            if (activeBan) {
              return socket.emit('error', { message: '❌ You are banned from this room' });
            }
          }
          
          // Leave old room if exists
          if (currentRoom) {
            socket.leave(currentRoom);
          }
          
          // Join new room
          currentRoom = roomName;
          socket.join(roomName);
          
          // Update session
          if (Session) {
            await Session.updateOne(
              { socketId: socket.id },
              { roomName, lastActivity: new Date() }
            );
          }
          
          socket.emit('joined_room', { roomName, username: currentUser, rank: userRank, theme: room.theme || 'default' });
          
          // Get message history
          const recentMessages = await Message.find({ roomName })
            .sort({ timestamp: -1 })
            .limit(50)
            .sort({ timestamp: 1 });
          
          socket.emit('room_history', {
            messages: recentMessages.map(msg => ({
              username: msg.username,
              message: msg.message,
              timestamp: msg.timestamp.toLocaleTimeString(),
              rank: msg.senderRank,
              isPrivate: msg.isPrivate,
              fileUrl: msg.fileUrl,
              fileName: msg.fileName
            }))
          });
          
          // Notify room
          const memberCount = await Session.countDocuments({ roomName });
          io.to(roomName).emit('user_joined', {
            username: currentUser,
            rank: userRank,
            members: memberCount
          });
          
          console.log(`🚪 ${currentUser} joined room (DB): ${roomName}`);
          return;
          
        } catch (dbErr) {
          console.error('DB join_room error:', dbErr.message);
        }
      }
      
      // Memory store fallback
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
      
      console.log(`🚪 ${currentUser} joined room (Memory): ${roomName}`);
      
    } catch (err) {
      console.error('join_room error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Leave room
  socket.on('leave_room', async () => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const roomName = currentRoom;
      
      // Try DB
      if (isMongoConnected && Session) {
        try {
          await Session.updateOne(
            { socketId: socket.id },
            { roomName: null }
          );
        } catch (dbErr) {
          console.error('DB leave_room error:', dbErr.message);
        }
      }
      
      // Memory store
      const session = memoryStore.sessions.get(socket.id);
      if (session) session.roomName = null;
      
      socket.leave(roomName);
      
      // Get member count
      let memberCount = 0;
      if (isMongoConnected && Session) {
        memberCount = await Session.countDocuments({ roomName });
      } else {
        memberCount = Array.from(memoryStore.sessions.values())
          .filter(s => s.roomName === roomName).length;
      }
      
      io.to(roomName).emit('user_left', {
        username: currentUser,
        rank: userRank,
        members: memberCount
      });
      
      // System message
      const systemMsg = {
        username: 'System',
        message: `👋 ${currentUser} left the room`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      
      // Save system message
      if (isMongoConnected && Message) {
        await Message.create({
          roomName,
          username: 'System',
          message: `👋 ${currentUser} left the room`,
          isSystem: true,
          senderRank: 'system'
        }).catch(() => {});
      } else if (memoryStore.rooms.has(roomName)) {
        const room = memoryStore.rooms.get(roomName);
        if (!room.messages) room.messages = [];
        room.messages.push(systemMsg);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      // Delete empty non-default rooms
      if (memberCount === 0) {
        if (isMongoConnected && Room) {
          const room = await Room.findOne({ name: roomName });
          if (room && !room.isDefault) {
            await Room.deleteOne({ name: roomName });
            await Message.deleteMany({ roomName });
            await Ban.deleteMany({ roomName });
            io.emit('room_deleted', { name: roomName });
            console.log(`🗑️ Empty room deleted (DB): ${roomName}`);
          }
        } else if (memoryStore.rooms.has(roomName)) {
          const room = memoryStore.rooms.get(roomName);
          if (!room.isDefault) {
            memoryStore.rooms.delete(roomName);
            io.emit('room_deleted', { name: roomName });
            console.log(`🗑️ Empty room deleted (Memory): ${roomName}`);
          }
        }
      }
      
      currentRoom = null;
      console.log(`🚪 ${currentUser} left room: ${roomName}`);
      
    } catch (err) {
      console.error('leave_room error:', err);
    }
  });
  
  // ========== MESSAGES ==========
  
  // Chat message
  socket.on('chat message', async (msg) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const messageData = {
        username: currentUser,
        message: msg.message,
        timestamp: new Date().toLocaleTimeString(),
        rank: userRank
      };
      
      // Save to DB
      if (isMongoConnected && Message) {
        await Message.create({
          roomName: currentRoom,
          username: currentUser,
          message: msg.message,
          isSystem: false,
          senderRank: userRank
        }).catch(() => {});
      } else if (memoryStore.rooms.has(currentRoom)) {
        const room = memoryStore.rooms.get(currentRoom);
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
  
  // Private message
  socket.on('private_message', async (data) => {
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
      
      // Save to DB
      if (isMongoConnected && PrivateMessage) {
        await PrivateMessage.create({
          from: currentUser,
          to: recipient,
          message,
          fromRank: userRank
        }).catch(() => {});
      }
      
      // Find recipient socket
      let recipientSocketId = null;
      
      if (isMongoConnected && Session) {
        const session = await Session.findOne({ username: recipient });
        if (session) recipientSocketId = session.socketId;
      } else {
        for (const [sid, sess] of memoryStore.sessions) {
          if (sess.username === recipient) {
            recipientSocketId = sid;
            break;
          }
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
        io.to(currentRoom).emit('admin_private_message_log', {
          from: currentUser,
          to: recipient,
          message,
          timestamp: messageData.timestamp
        });
      }
      
      console.log(`💌 PM: ${currentUser} -> ${recipient}`);
      
    } catch (err) {
      console.error('private message error:', err);
    }
  });
  
  // File share
  socket.on('share_file', async (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const { fileUrl, fileName, fileType } = data;
      
      const messageData = {
        username: currentUser,
        message: `📁 Shared file: ${fileName}`,
        fileUrl,
        fileName,
        fileType,
        timestamp: new Date().toLocaleTimeString(),
        rank: userRank
      };
      
      // Save to DB
      if (isMongoConnected && Message) {
        await Message.create({
          roomName: currentRoom,
          username: currentUser,
          message: `📁 Shared file: ${fileName}`,
          fileUrl,
          fileName,
          fileType,
          senderRank: userRank
        }).catch(() => {});
      } else if (memoryStore.rooms.has(currentRoom)) {
        const room = memoryStore.rooms.get(currentRoom);
        if (!room.messages) room.messages = [];
        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      io.to(currentRoom).emit('chat message', messageData);
      console.log(`📁 File shared by ${currentUser}: ${fileName}`);
      
    } catch (err) {
      console.error('share_file error:', err);
    }
  });
  
  // ========== ADMIN COMMANDS ==========
  
  // Clear messages
  socket.on('clear_messages', async (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canClear) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { password } = data;
      
      // Verify password for non-admins
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Clear messages
      if (isMongoConnected && Message) {
        await Message.deleteMany({ roomName: currentRoom });
      } else if (memoryStore.rooms.has(currentRoom)) {
        const room = memoryStore.rooms.get(currentRoom);
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
      
      // Save system message
      if (isMongoConnected && Message) {
        await Message.create({
          roomName: currentRoom,
          username: 'System',
          message: `🧹 Messages cleared by ${currentUser}`,
          isSystem: true,
          senderRank: 'system'
        }).catch(() => {});
      } else if (memoryStore.rooms.has(currentRoom)) {
        const room = memoryStore.rooms.get(currentRoom);
        if (!room.messages) room.messages = [];
        room.messages.push(systemMsg);
      }
      
      console.log(`🧹 Messages cleared by ${currentUser} in ${currentRoom}`);
      
    } catch (err) {
      console.error('clear_messages error:', err);
    }
  });
  
  // Ban user
  socket.on('ban_user', async (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canBan) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { bannedUser, duration = '10m', password } = data;
      
      if (!bannedUser) return;
      
      // Verify password for moderators
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
      
      const expiresAt = new Date(Date.now() + durationMs);
      
      // Save ban
      if (isMongoConnected && Ban) {
        await Ban.updateMany(
          { roomName: currentRoom, username: bannedUser, isActive: true },
          { isActive: false }
        );
        
        await Ban.create({
          roomName: currentRoom,
          username: bannedUser,
          bannedBy: currentUser,
          bannedByRank: userRank,
          expiresAt,
          isActive: true
        });
      }
      
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
      if (isMongoConnected && Session) {
        const session = await Session.findOne({ username: bannedUser, roomName: currentRoom });
        if (session) bannedSocketId = session.socketId;
      } else {
        for (const [sid, sess] of memoryStore.sessions) {
          if (sess.username === bannedUser && sess.roomName === currentRoom) {
            bannedSocketId = sid;
            break;
          }
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
  
  // Unban user
  socket.on('unban_user', async (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUnban) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { unbannedUser, password } = data;
      
      if (!unbannedUser) return;
      
      // Verify password for moderators
      if (userRank === 'moderator' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Remove ban
      if (isMongoConnected && Ban) {
        await Ban.updateMany(
          { roomName: currentRoom, username: unbannedUser, isActive: true },
          { isActive: false }
        );
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
  
  // Delete room
  socket.on('delete_room', async (data) => {
    try {
      if (!currentUser) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canDeleteRoom) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { roomName, password } = data;
      
      if (!roomName) return;
      
      // Verify password for non-admins
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Prevent deleting Main
      if (roomName === 'Main') {
        return socket.emit('error', { message: 'Cannot delete Main room' });
      }
      
      // Delete room
      if (isMongoConnected && Room) {
        const room = await Room.findOne({ name: roomName });
        if (room && !room.isDefault) {
          await Room.deleteOne({ name: roomName });
          await Message.deleteMany({ roomName });
          await Ban.deleteMany({ roomName });
        }
      } else {
        const room = memoryStore.rooms.get(roomName);
        if (room && !room.isDefault) {
          memoryStore.rooms.delete(roomName);
        }
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
  
  // Grant rank
  socket.on('grant_rank', async (data) => {
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
      
      // Verify password for non-owners
      if (userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      // Update rank
      if (isMongoConnected && User) {
        const user = await User.findOne({ username: targetUser });
        if (user) {
          user.rank = newRank;
          await user.save();
          
          // Notify user if online
          const session = await Session.findOne({ username: targetUser });
          if (session) {
            io.to(session.socketId).emit('rank_changed', { newRank, grantedBy: currentUser });
          }
        }
      } else if (memoryStore.users.has(targetUser)) {
        const user = memoryStore.users.get(targetUser);
        user.rank = newRank;
        
        // Notify user if online
        for (const [sid, sess] of memoryStore.sessions) {
          if (sess.username === targetUser) {
            io.to(sid).emit('rank_changed', { newRank, grantedBy: currentUser });
            sess.rank = newRank;
            break;
          }
        }
      }
      
      socket.emit('command_success', { message: `✅ ${targetUser} is now ${newRank}` });
      console.log(`👑 ${currentUser} granted ${targetUser} rank ${newRank}`);
      
    } catch (err) {
      console.error('grant_rank error:', err);
      socket.emit('error', { message: 'Failed to grant rank' });
    }
  });
  
  // Effect command
  socket.on('effect_command', async (data) => {
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
  
  // Theme change
  socket.on('change_theme', async (data) => {
    try {
      if (!currentUser) return;
      
      const { theme, scope } = data;
      
      const validThemes = ['default', 'dark', 'light', 'neon', 'midnight', 'sunset', 'forest', 'ocean', 'cyberpunk', 'vintage'];
      
      if (!validThemes.includes(theme)) {
        return socket.emit('error', { message: '❌ Invalid theme' });
      }
      
      if (scope === 'personal') {
        if (isMongoConnected && User) {
          await User.updateOne({ username: currentUser }, { theme });
        } else if (memoryStore.users.has(currentUser)) {
          const user = memoryStore.users.get(currentUser);
          user.theme = theme;
        }
        
        socket.emit('theme_applied', { theme, scope: 'personal' });
        
      } else if (scope === 'room' && currentRoom) {
        if (isMongoConnected && Room) {
          await Room.updateOne({ name: currentRoom }, { theme });
        } else if (memoryStore.rooms.has(currentRoom)) {
          const room = memoryStore.rooms.get(currentRoom);
          room.theme = theme;
        }
        
        io.to(currentRoom).emit('theme_applied', { theme, scope: 'room', changedBy: currentUser });
      }
      
      console.log(`🎨 Theme changed: ${theme} (${scope}) by ${currentUser}`);
      
    } catch (err) {
      console.error('theme change error:', err);
    }
  });
  
  // ========== DISCONNECT ==========
  
  socket.on('disconnect', async () => {
    try {
      console.log(`👋 Disconnect: ${socket.id} (${currentUser || 'anonymous'})`);
      
      if (currentUser && currentRoom) {
        // Notify room
        io.to(currentRoom).emit('user_left', {
          username: currentUser,
          rank: userRank,
          members: 0 // Will be updated
        });
        
        // System message
        io.to(currentRoom).emit('chat message', {
          username: 'System',
          message: `👋 ${currentUser} disconnected`,
          timestamp: new Date().toLocaleTimeString(),
          rank: 'system'
        });
      }
      
      // Remove session
      if (isMongoConnected && Session) {
        await Session.deleteOne({ socketId: socket.id }).catch(() => {});
      }
      memoryStore.sessions.delete(socket.id);
      
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
  console.log(`🔑 Admin Password: ${ADMIN_PASSWORD ? '****' : 'default'}`);
  console.log(`💾 MongoDB: ${isMongoConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
  console.log(`📁 Uploads: ${uploadDir}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log('\n' + '='.repeat(70) + '\n');
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await mongoose.connection.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await mongoose.connection.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };