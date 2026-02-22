require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const axios = require('axios');

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
let MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'Pi_Kid71';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'misha037@hsd.k12.or.us';
const OWNER_FULLNAME = process.env.OWNER_FULLNAME || 'Aashish Mishra';
const NODE_ENV = process.env.NODE_ENV || 'development';

// EmailJS Configuration
const EMAILJS_SERVICE_ID = 'blackchat_conformation';
const EMAILJS_TEMPLATE_ID = 'template_nngetk9';
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || 'your_public_key';
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || 'your_private_key';

console.log('\n' + '='.repeat(70));
console.log('🚀 BLACK HOLE CHAT V2 - SERVER STARTING');
console.log('='.repeat(70));
console.log(`📡 Port: ${PORT}`);
console.log(`👑 Owner: ${OWNER_USERNAME} (${OWNER_FULLNAME})`);
console.log(`📧 Owner Email: ${OWNER_EMAIL}`);
console.log(`📧 EmailJS Service: ${EMAILJS_SERVICE_ID}`);
console.log(`📧 EmailJS Template: ${EMAILJS_TEMPLATE_ID}`);
console.log(`🔑 Admin Password: ${ADMIN_PASSWORD ? '****' : 'default'}`);
console.log(`🌍 Environment: ${NODE_ENV}`);
console.log('='.repeat(70) + '\n');

// ============================================
// 📁 FILE UPLOAD CONFIGURATION
// ============================================
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
console.log(`📁 Upload directory: ${uploadDir}`);

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
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
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

const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  family: 4,
  maxPoolSize: 10
};

// Define schemas
let User, Room, Message, Ban, Session, PrivateMessage, FileModel, VerificationCode, MessageCount;

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
    setTimeout(() => {
      try {
        loadInitialData();
      } catch (err) {
        console.error('Error scheduling loadInitialData:', err.message);
      }
    }, 4000);
    
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
      fullName: { type: String, required: true },
      email: { type: String, required: true, unique: true },
      password: { type: String, required: true },
      rank: { 
        type: String, 
        enum: ['owner', 'admin', 'moderator', 'vip', 'member'],
        default: 'member'
      },
      createdAt: { type: Date, default: Date.now },
      lastLogin: { type: Date },
      isVerified: { type: Boolean, default: false },
      isBanned: { type: Boolean, default: false },
      avatar: { type: String, default: null },
      theme: { type: String, default: 'default' },
      deviceIds: [{ type: String }]
    });

    const RoomSchema = new mongoose.Schema({
      name: { type: String, required: true, unique: true },
      password: { type: String, default: '' },
      isDefault: { type: Boolean, default: false },
      createdBy: { type: String },
      createdAt: { type: Date, default: Date.now },
      theme: { type: String, default: 'default' },
      messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }]
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
      lastActivity: { type: Date, default: Date.now },
      deviceId: { type: String }
    });

    const PrivateMessageSchema = new mongoose.Schema({
      from: { type: String, required: true },
      fromRank: { type: String, default: 'member' },
      to: { type: String, required: true },
      toRank: { type: String, default: 'member' },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      read: { type: Boolean, default: false },
      visibleTo: [{ type: String }]
    });

    const FileModelSchema = new mongoose.Schema({
      filename: { type: String, required: true },
      originalName: { type: String, required: true },
      uploadedBy: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now },
      fileSize: { type: Number, required: true },
      fileType: { type: String, required: true },
      roomName: { type: String, default: null },
      recipient: { type: String, default: null },
      fileUrl: { type: String, required: true }
    });

    const VerificationCodeSchema = new mongoose.Schema({
      email: { type: String, required: true, index: true },
      code: { type: String, required: true },
      fullName: { type: String, required: true },
      username: { type: String, required: true },
      password: { type: String, required: true },
      createdAt: { type: Date, default: Date.now, expires: 600 } // 10 minutes expiry
    });

    const MessageCountSchema = new mongoose.Schema({
      username: { type: String, required: true, unique: true },
      count: { type: Number, default: 0 },
      resetTime: { type: Date, default: Date.now }
    });

    User = mongoose.model('User', UserSchema);
    Room = mongoose.model('Room', RoomSchema);
    Message = mongoose.model('Message', MessageSchema);
    Ban = mongoose.model('Ban', BanSchema);
    Session = mongoose.model('Session', SessionSchema);
    PrivateMessage = mongoose.model('PrivateMessage', PrivateMessageSchema);
    FileModel = mongoose.model('File', FileModelSchema);
    VerificationCode = mongoose.model('VerificationCode', VerificationCodeSchema);
    MessageCount = mongoose.model('MessageCount', MessageCountSchema);

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
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await User.create({
        username: OWNER_USERNAME,
        fullName: OWNER_FULLNAME,
        email: OWNER_EMAIL,
        password: hashedPassword,
        rank: 'owner',
        isVerified: true,
        lastLogin: new Date(),
        theme: 'dark'
      });
      console.log(`✅ Owner account created: ${OWNER_USERNAME} (${OWNER_EMAIL})`);
    }

    const admin = await User.findOne({ username: 'admin' });
    if (!admin) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await User.create({
        username: 'admin',
        fullName: 'Administrator',
        email: 'admin@hsd.k12.or.us',
        password: hashedPassword,
        rank: 'admin',
        isVerified: true,
        lastLogin: new Date()
      });
      console.log('✅ Default admin account created');
    }

  } catch (err) {
    console.error('❌ Error initializing default data:', err.message);
  }
}

async function loadInitialData() {
  if (!isMongoConnected) return;
  try {
    console.log('🔁 Loading initial data from MongoDB into memory store...');

    const users = await User.find({}).lean();
    users.forEach(u => {
      memoryStore.users.set(u.username, {
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        password: u.password,
        rank: u.rank || 'member',
        theme: u.theme || 'default',
        isVerified: u.isVerified || false,
        deviceIds: u.deviceIds || []
      });
    });

    const rooms = await Room.find({}).lean();
    for (const r of rooms) {
      const roomObj = {
        name: r.name,
        password: r.password || '',
        isDefault: !!r.isDefault,
        members: new Map(),
        messages: [],
        theme: r.theme || 'default'
      };
      
      if (r.messages && r.messages.length > 0) {
        const msgs = await Message.find({ _id: { $in: r.messages } }).sort({ timestamp: 1 }).lean();
        roomObj.messages = msgs.map(m => ({
          username: m.username,
          message: m.message,
          timestamp: m.timestamp,
          rank: m.senderRank || 'member',
          fileUrl: m.fileUrl || null,
          fileName: m.fileName || null,
          fileType: m.fileType || null,
          fileSize: m.fileSize || null
        }));
      }
      
      memoryStore.rooms.set(r.name, roomObj);
    }

    const files = await FileModel.find({}).lean();
    files.forEach(f => {
      if (!memoryStore.files.has(f.filename)) {
        memoryStore.files.set(f.filename, {
          filename: f.filename,
          originalName: f.originalName,
          uploadedBy: f.uploadedBy,
          uploadedAt: f.uploadedAt,
          fileSize: f.fileSize,
          fileType: f.fileType,
          roomName: f.roomName,
          recipient: f.recipient,
          fileUrl: f.fileUrl
        });
      }
    });

    const bans = await Ban.find({ isActive: true, expiresAt: { $gt: new Date() } }).lean();
    bans.forEach(b => {
      const roomBans = memoryStore.bans.get(b.roomName) || [];
      roomBans.push({ 
        username: b.username, 
        bannedBy: b.bannedBy, 
        expiresAt: b.expiresAt.getTime() 
      });
      memoryStore.bans.set(b.roomName, roomBans);
    });

    const pms = await PrivateMessage.find({}).sort({ timestamp: -1 }).limit(200).lean();
    memoryStore.privateMessages = pms.reverse().map(pm => ({
      from: pm.from,
      to: pm.to,
      message: pm.message,
      timestamp: pm.timestamp
    }));

    const msgCounts = await MessageCount.find({}).lean();
    msgCounts.forEach(mc => {
      memoryStore.messageCounts.set(mc.username, {
        count: mc.count,
        resetTime: mc.resetTime.getTime()
      });
    });

    console.log('✅ Initial data loaded into memory store');
    console.log(`   Users: ${memoryStore.users.size}`);
    console.log(`   Rooms: ${memoryStore.rooms.size}`);
    console.log(`   Files: ${memoryStore.files.size}`);
  } catch (err) {
    console.error('❌ loadInitialData error:', err.message);
  }
}

connectToMongoDB();

// ============================================
// 📧 EMAIL VERIFICATION WITH EMAILJS
// ============================================

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code, fullName, username) {
  try {
    console.log(`📧 Attempting to send verification email to ${email}...`);
    
    const now = new Date();
    const timeString = now.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit'
    });
    
    const response = await axios.post('https://api.emailjs.com/api/v1.0/email/send', {
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: {
        name: fullName,
        time: timeString,
        message: `Your verification code is: ${code}. Please enter this code to complete your registration. This code will expire in 10 minutes.`,
        to_email: email,
        from_name: 'Black Hole Chat V2',
        reply_to: 'noreply@blackholechat.com'
      }
    });

    if (response.status === 200) {
      console.log(`✅ Verification email sent successfully to ${email}`);
      return true;
    } else {
      console.error(`❌ EmailJS returned status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to send verification email:', error.message);
    if (error.response) {
      console.error('EmailJS Error Details:', error.response.data);
    }
    console.log(`⚠️ Email sending failed, but code ${code} generated for ${email}`);
    return false;
  }
}

// ============================================
// 🖼️ IMAGE GENERATION
// ============================================
const imageJobs = new Map();

app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, size = '512', model = '' } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const DEAPI_API_KEY = process.env.DEAPI_API_KEY;
    if (!DEAPI_API_KEY) {
      return res.status(500).json({ error: 'Image API key not configured' });
    }

    const width = parseInt(size) || 512;
    const height = width;

    const bodyObj = {
      prompt,
      seed: Math.floor(Math.random() * 1000000),
      width,
      height,
      steps: 20
    };
    if (model) bodyObj.model = model;

    const candidateModels = [];
    if (model) candidateModels.push(model);
    candidateModels.push('Flux1schnell', 'prodia/sdxl', 'sdxl', 'stabilityai/sdxl', 'stabilityai/stable-diffusion-3-5-large', 'black-forest-labs/flux-schnell');

    let data = null;
    let lastErr = null;

    for (const candidate of candidateModels) {
      try {
        const tryBody = { ...bodyObj, model: candidate };
        const resp = await fetch('https://api.deapi.ai/api/v1/client/txt2img', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${DEAPI_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(tryBody)
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          lastErr = errData;
          continue;
        }

        data = await resp.json();
        break;
      } catch (err) {
        lastErr = { message: err.message };
      }
    }

    if (!data) {
      return res.status(502).json({ error: 'Image provider error', details: lastErr || {} });
    }

    let imageUrl = null;
    if (data.data && data.data[0] && data.data[0].url) imageUrl = data.data[0].url;
    else if (data.images && data.images[0] && data.images[0].url) imageUrl = data.images[0].url;
    else if (data.output && data.output[0]) imageUrl = data.output[0];
    else if (data.url) imageUrl = data.url;
    else if (data.image) imageUrl = data.image;

    if (!imageUrl) return res.status(500).json({ error: 'Could not extract image from provider response', details: data });

    return res.json({ imageUrl });
  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/image-result/:id', async (req, res) => {
  const id = req.params.id;
  if (!imageJobs.has(id)) return res.status(404).json({ error: 'Unknown request id' });
  return res.json(imageJobs.get(id));
});

// ============================================
// 🏥 HEALTH CHECK ENDPOINT
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
      stats.verifiedUsers = await User.countDocuments({ isVerified: true });
      stats.admins = await User.countDocuments({ rank: 'admin' });
      stats.owners = await User.countDocuments({ rank: 'owner' });
      stats.rooms = await Room.countDocuments();
      stats.messages = await Message.countDocuments();
      stats.files = await FileModel.countDocuments();
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
// 📁 FILE UPLOAD ENDPOINT
// ============================================
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedBy = req.body.username || 'anonymous';
    const isOwner = uploadedBy === OWNER_USERNAME;
    
    console.log(`📤 File upload: ${req.file.originalname} (${req.file.size} bytes) by ${uploadedBy}${isOwner ? ' 👑' : ''}`);

    let finalPath = req.file.path;
    let fileSize = req.file.size;
    let fileType = req.file.mimetype;

    if (req.file.mimetype.startsWith('image/') && !isOwner) {
      try {
        const optimizedPath = path.join(uploadDir, 'opt-' + req.file.filename);
        
        await sharp(req.file.path)
          .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 75, progressive: true })
          .toFile(optimizedPath);
        
        await fs.unlink(req.file.path).catch(() => {});
        finalPath = optimizedPath;
        const stats = await fs.stat(optimizedPath);
        fileSize = stats.size;
        fileType = 'image/jpeg';
        console.log(`🖼️ Image optimized for regular user: ${fileSize} bytes`);
      } catch (imgErr) {
        console.error('Image optimization error:', imgErr.message);
      }
    }

    const fileUrl = `/uploads/${path.basename(finalPath)}`;
    
    if (isMongoConnected && FileModel) {
      try {
        const fileDoc = await FileModel.create({
          filename: path.basename(finalPath),
          originalName: req.file.originalname,
          uploadedBy: uploadedBy,
          fileSize: fileSize,
          fileType: fileType,
          roomName: req.body.roomName || null,
          recipient: req.body.recipient || null,
          fileUrl: fileUrl
        });
        
        memoryStore.files.set(path.basename(finalPath), {
          filename: path.basename(finalPath),
          originalName: req.file.originalname,
          uploadedBy: uploadedBy,
          uploadedAt: fileDoc.uploadedAt,
          fileSize: fileSize,
          fileType: fileType,
          roomName: req.body.roomName || null,
          recipient: req.body.recipient || null,
          fileUrl: fileUrl
        });
      } catch (dbErr) {
        console.error('Failed to save file metadata to DB:', dbErr.message);
      }
    }
    
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
// 🔧 IN-MEMORY STORAGE
// ============================================
const memoryStore = {
  users: new Map(),
  rooms: new Map([['Main', { 
    name: 'Main', 
    password: '', 
    isDefault: true, 
    members: new Map(), 
    messages: [],
    theme: 'default'
  }]]),
  sessions: new Map(),
  bans: new Map(),
  mutes: new Map(),
  deviceBans: new Map(),
  deviceMutes: new Map(),
  userDevices: new Map(),
  spam: new Map(),
  privateMessages: [],
  files: new Map(),
  messageCounts: new Map()
};

// ============================================
// 🔐 RANK LEVELS AND PERMISSIONS
// ============================================

const RANK_LEVELS = {
  'owner': 1,
  'admin': 2,
  'moderator': 3,
  'vip': 4,
  'member': 5
};

function getRankLevel(rank) {
  return RANK_LEVELS[rank] || 5;
}

function isUserMuted(username, roomName) {
  const muteKey = `${username}-${roomName}`;
  if (memoryStore.mutes.has(muteKey)) {
    const mute = memoryStore.mutes.get(muteKey);
    if (Date.now() < mute.expiresAt) {
      return true;
    } else {
      memoryStore.mutes.delete(muteKey);
      return false;
    }
  }
  return false;
}

function isDeviceBanned(deviceId) {
  if (!deviceId) return false;
  if (memoryStore.deviceBans.has(deviceId)) {
    const ban = memoryStore.deviceBans.get(deviceId);
    if (Date.now() < ban.expiresAt) {
      return true;
    } else {
      memoryStore.deviceBans.delete(deviceId);
      return false;
    }
  }
  return false;
}

function isDeviceMuted(deviceId) {
  if (!deviceId) return false;
  if (memoryStore.deviceMutes.has(deviceId)) {
    const mute = memoryStore.deviceMutes.get(deviceId);
    if (Date.now() < mute.expiresAt) {
      return true;
    } else {
      memoryStore.deviceMutes.delete(deviceId);
      return false;
    }
  }
  return false;
}

function recordMessage(username, text) {
  if (!memoryStore.spam.has(username)) {
    memoryStore.spam.set(username, []);
  }
  const now = Date.now();
  const arr = memoryStore.spam.get(username);
  while (arr.length && now - arr[0].time > 2 * 60 * 1000) {
    arr.shift();
  }
  arr.push({ text, time: now });
  const count = arr.filter(m => m.text === text).length;
  return count;
}

async function checkMessageLimit(username) {
  if (!isMongoConnected) return true;
  
  try {
    const user = await User.findOne({ username });
    if (user && user.isVerified) return true;
    
    const now = Date.now();
    let msgCount = memoryStore.messageCounts.get(username);
    
    if (!msgCount) {
      const dbCount = await MessageCount.findOne({ username });
      if (dbCount) {
        msgCount = {
          count: dbCount.count,
          resetTime: dbCount.resetTime.getTime()
        };
        memoryStore.messageCounts.set(username, msgCount);
      } else {
        msgCount = { count: 0, resetTime: now };
        memoryStore.messageCounts.set(username, msgCount);
        await MessageCount.create({ username, count: 0, resetTime: new Date(now) });
      }
    }
    
    if (now - msgCount.resetTime > 10 * 60 * 1000) {
      msgCount.count = 0;
      msgCount.resetTime = now;
      await MessageCount.updateOne(
        { username },
        { count: 0, resetTime: new Date(now) },
        { upsert: true }
      );
    }
    
    return msgCount.count < 5;
  } catch (err) {
    console.error('Error checking message limit:', err);
    return true;
  }
}

async function incrementMessageCount(username) {
  if (!isMongoConnected) return;
  
  try {
    let msgCount = memoryStore.messageCounts.get(username);
    const now = Date.now();
    
    if (!msgCount) {
      msgCount = { count: 0, resetTime: now };
      memoryStore.messageCounts.set(username, msgCount);
    }
    
    if (now - msgCount.resetTime > 10 * 60 * 1000) {
      msgCount.count = 0;
      msgCount.resetTime = now;
    }
    
    msgCount.count++;
    
    await MessageCount.updateOne(
      { username },
      { count: msgCount.count, resetTime: new Date(msgCount.resetTime) },
      { upsert: true }
    );
  } catch (err) {
    console.error('Error incrementing message count:', err);
  }
}

const NWORD_REGEX = /(nigga|nigger)/i;

function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([mhd])$/);
  if (!match) return 10 * 60 * 1000;
  
  const amount = parseInt(match[1]);
  const unit = match[2];
  
  switch(unit) {
    case 'm': return amount * 60 * 1000;
    case 'h': return amount * 60 * 60 * 1000;
    case 'd': return amount * 24 * 60 * 60 * 1000;
    default: return 10 * 60 * 1000;
  }
}

const PERMISSIONS = {
  owner: { 
    level: 1, 
    canBan: true, 
    canUnban: true, 
    canMute: true,
    canDeleteRoom: true, 
    canClear: true, 
    canGrant: ['admin', 'moderator', 'vip', 'member'], 
    canUseEffects: true, 
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: true,
    canBypassPassword: true,
    canDeleteAnyUser: true
  },
  admin: { 
    level: 2, 
    canBan: true, 
    canUnban: true, 
    canMute: true,
    canDeleteRoom: true, 
    canClear: false, // Only owner can clear
    canGrant: ['moderator', 'vip', 'member'], // CANNOT grant admin
    canUseEffects: true, 
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: false,
    canBypassPassword: false,
    canDeleteAnyUser: false // Cannot delete admins
  },
  moderator: { 
    level: 3, 
    canBan: true, 
    canUnban: false, 
    canMute: true,
    canDeleteRoom: false, 
    canClear: false, 
    canGrant: [], 
    canUseEffects: true,
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: false,
    canBypassPassword: false,
    canDeleteAnyUser: false
  },
  vip: { 
    level: 4, 
    canBan: false, 
    canUnban: false, 
    canMute: false,
    canDeleteRoom: false, 
    canClear: false, 
    canGrant: [], 
    canUseEffects: true,
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: false,
    canBypassPassword: false,
    canDeleteAnyUser: false
  },
  member: { 
    level: 5, 
    canBan: false, 
    canUnban: false, 
    canMute: false,
    canDeleteRoom: false, 
    canClear: false, 
    canGrant: [], 
    canUseEffects: false, 
    canUpload: false, 
    canVoice: true, 
    canVideo: false,
    canSeeAllPrivate: false,
    canBypassPassword: false,
    canDeleteAnyUser: false
  }
};

// ============================================
// 🔌 SOCKET.IO HANDLERS
// ============================================

io.on('connection', (socket) => {
  socket.on('ping', (cb) => {
    try {
      if (typeof cb === 'function') cb();
    } catch (err) {}
  });
  
  console.log(`👤 New connection: ${socket.id} (Total: ${io.engine.clientsCount})`);
  
  let currentUser = null;
  let currentRoom = null;
  let userRank = 'member';
  let isVerified = false;
  
  // ========== AUTHENTICATION ==========
  
  socket.on('login', async (data) => {
    try {
      let { username, password, rememberMe, deviceId: providedDevice } = data;
      if (username) {
        const sanitized = username.replace(/\s+/g, '_');
        if (sanitized !== username) {
          username = sanitized;
        }
      }
      if (username && NWORD_REGEX.test(username)) {
        return socket.emit('auth_error', { message: 'Invalid username' });
      }

      console.log(`🔑 Login attempt: ${username} (device=${providedDevice || 'unknown'})`);

      let deviceId = providedDevice || null;
      if (deviceId && typeof deviceId !== 'string') deviceId = String(deviceId);

      if (isDeviceBanned(deviceId)) {
        return socket.emit('auth_error', { message: '⛔ This device is banned' });
      }
      if (isDeviceMuted(deviceId)) {
        return socket.emit('auth_error', { message: '🔇 This device is muted' });
      }

      if (!username || !password) {
        return socket.emit('auth_error', { message: 'Username and password required' });
      }

      const createSession = (name, rank, theme, verified) => {
        currentUser = name;
        userRank = rank;
        isVerified = verified;
        memoryStore.sessions.set(socket.id, { username: name, rank, roomName: null, deviceId });

        if (deviceId) {
          if (!memoryStore.userDevices.has(name)) {
            memoryStore.userDevices.set(name, new Set());
          }
          memoryStore.userDevices.get(name).add(deviceId);
        }

        socket.emit('auth_success', { 
          username: name, 
          rank, 
          theme, 
          isVerified: verified,
          message: `Login successful!` 
        });
      };

      if (memoryStore.users.has(username)) {
        const user = memoryStore.users.get(username);
        const isValid = await bcrypt.compare(password, user.password);
        if (isValid) {
          createSession(username, user.rank || 'member', user.theme || 'default', user.isVerified || false);
          console.log(`✅ User logged in: ${username} (${user.rank}) ${user.isVerified ? '✓' : '✗'}`);
          return;
        }
      }

      if (isMongoConnected && User) {
        const user = await User.findOne({ username });
        if (user) {
          const isValid = await bcrypt.compare(password, user.password);
          if (isValid) {
            memoryStore.users.set(username, {
              username: user.username,
              fullName: user.fullName,
              email: user.email,
              password: user.password,
              rank: user.rank,
              theme: user.theme,
              isVerified: user.isVerified,
              deviceIds: user.deviceIds || []
            });
            
            createSession(username, user.rank, user.theme, user.isVerified);
            console.log(`✅ User logged in from DB: ${username} (${user.rank}) ${user.isVerified ? '✓' : '✗'}`);
            return;
          }
        }
      }

      socket.emit('auth_error', { message: 'Invalid credentials' });

    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth_error', { message: 'Server error' });
    }
  });
  
  socket.on('request_verification', async (data) => {
    try {
      const { fullName, email, username, password } = data;
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return socket.emit('auth_error', { message: 'Please enter a valid email address' });
      }
      
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return socket.emit('auth_error', { message: 'Email already registered' });
      }
      
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        return socket.emit('auth_error', { message: 'Username already taken' });
      }
      
      const code = generateVerificationCode();
      const hashedPassword = await bcrypt.hash(password, 10);
      
      await VerificationCode.create({
        email,
        code,
        fullName,
        username,
        password: hashedPassword
      });
      
      const emailSent = await sendVerificationEmail(email, code, fullName, username);
      
      if (emailSent) {
        socket.emit('verification_sent', { 
          message: 'Verification code sent to your email',
          email 
        });
        console.log(`📧 Verification code sent to ${email} for user ${username}`);
      } else {
        socket.emit('verification_sent', { 
          message: `Verification code: ${code} (Email sending failed - check EmailJS configuration)`,
          email 
        });
        console.log(`⚠️ Email sending failed, but code ${code} generated for ${email}`);
      }
      
    } catch (err) {
      console.error('Verification request error:', err);
      socket.emit('auth_error', { message: 'Failed to generate verification code' });
    }
  });
  
  socket.on('verify_code', async (data) => {
    try {
      const { email, code } = data;
      
      const verification = await VerificationCode.findOne({ 
        email, 
        code,
        createdAt: { $gt: new Date(Date.now() - 10 * 60 * 1000) }
      });
      
      if (!verification) {
        return socket.emit('auth_error', { message: 'Invalid or expired verification code' });
      }
      
      const user = await User.create({
        username: verification.username,
        fullName: verification.fullName,
        email: verification.email,
        password: verification.password,
        isVerified: true,
        lastLogin: new Date()
      });
      
      memoryStore.users.set(verification.username, {
        username: verification.username,
        fullName: verification.fullName,
        email: verification.email,
        password: verification.password,
        rank: 'member',
        theme: 'default',
        isVerified: true,
        deviceIds: []
      });
      
      await VerificationCode.deleteOne({ _id: verification._id });
      
      currentUser = verification.username;
      userRank = 'member';
      isVerified = true;
      
      memoryStore.sessions.set(socket.id, { 
        username: verification.username, 
        rank: 'member', 
        roomName: null,
        deviceId: null 
      });
      
      socket.emit('auth_success', {
        username: verification.username,
        rank: 'member',
        theme: 'default',
        isVerified: true,
        message: 'Registration successful!'
      });
      
      console.log(`✅ User registered and verified: ${verification.username} (${verification.email})`);
      
    } catch (err) {
      console.error('Verification error:', err);
      socket.emit('auth_error', { message: 'Failed to verify code' });
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
  
  socket.on('check_auth', () => {
    const session = memoryStore.sessions.get(socket.id);
    if (session) {
      const user = memoryStore.users.get(session.username);
      socket.emit('auth_status', { 
        authenticated: true, 
        username: session.username,
        rank: session.rank,
        isVerified: user?.isVerified || false
      });
    } else {
      socket.emit('auth_status', { authenticated: false });
    }
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
          const userData = memoryStore.users.get(session.username) || {};
          users.push({
            username: session.username,
            rank: session.rank || 'member',
            fullName: userData.fullName || '',
            email: userData.email || ''
          });
        }
      }
      
      socket.emit('room_users', { users });
    } catch (err) {
      console.error('get_room_users error:', err);
    }
  });
  
  socket.on('get_user_list', (data) => {
    try {
      if (!currentUser || !currentRoom) {
        return socket.emit('user_list', { error: 'Not in a room' });
      }
      
      const { roomName } = data;
      
      const roomUsers = [];
      for (const [sid, session] of memoryStore.sessions) {
        if (session.roomName === roomName && session.username !== currentUser) {
          const userData = memoryStore.users.get(session.username) || {};
          roomUsers.push({
            username: session.username,
            rank: session.rank || 'member',
            fullName: userData.fullName || '',
            email: userData.email || ''
          });
        }
      }
      
      const allUsers = Array.from(memoryStore.users.keys()).filter(u => u !== currentUser);
      
      const otherRoomUsers = [];
      const notOnlineUsers = [];
      
      allUsers.forEach(username => {
        if (roomUsers.some(u => u.username === username)) {
          return;
        }
        
        let isOnline = false;
        let userRoom = null;
        let userRank = memoryStore.users.get(username)?.rank || 'member';
        const userData = memoryStore.users.get(username) || {};
        
        for (const [sid, session] of memoryStore.sessions) {
          if (session.username === username) {
            isOnline = true;
            userRoom = session.roomName || 'Unknown';
            break;
          }
        }
        
        if (isOnline) {
          otherRoomUsers.push({
            username,
            rank: userRank,
            room: userRoom,
            fullName: userData.fullName || '',
            email: userData.email || ''
          });
        } else {
          notOnlineUsers.push({
            username,
            rank: userRank,
            fullName: userData.fullName || '',
            email: userData.email || ''
          });
        }
      });
      
      const rankOrder = { 'owner': 1, 'admin': 2, 'moderator': 3, 'vip': 4, 'member': 5 };
      
      roomUsers.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));
      otherRoomUsers.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));
      notOnlineUsers.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));
      
      socket.emit('user_list', {
        currentRoom: roomName,
        roomUsers,
        otherRoomUsers,
        notOnlineUsers
      });
      
    } catch (err) {
      console.error('get_user_list error:', err);
      socket.emit('user_list', { error: 'Failed to get user list' });
    }
  });
  
  socket.on('create_room', (data) => {
    try {
      if (!currentUser) {
        return socket.emit('error', { message: 'Not authenticated' });
      }
      
      let { roomName, password, theme = 'default' } = data;
      if (roomName) roomName = roomName.replace(/\s+/g, '_');
      if (NWORD_REGEX.test(roomName) || (password && NWORD_REGEX.test(password))) {
        return socket.emit('error', { message: 'Invalid room name or password' });
      }
      
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
      
      if (currentRoom) {
        socket.leave(currentRoom);
      }
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
      if (isDeviceBanned(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '⛔ This device is banned' });
      }
      
      let { roomName, password } = data;
      if (roomName) roomName = roomName.replace(/\s+/g,'_');
      const room = memoryStore.rooms.get(roomName);
      if (!room) {
        return socket.emit('error', { message: 'Room does not exist' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      
      if (room.password && room.password !== password) {
        if (!permissions.canBypassPassword) {
          return socket.emit('error', { message: 'Incorrect password' });
        } else {
          console.log(`👑 Owner ${currentUser} bypassed password for room ${roomName}`);
        }
      }
      
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
      
      socket.emit('room_history', {
        messages: (room.messages || []).map(m => ({
          ...m,
          timestamp: m.timestamp || new Date()
        }))
      });
      
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
      
      const members = Array.from(memoryStore.sessions.values())
        .filter(s => s.roomName === roomName).length;
      
      io.to(roomName).emit('user_left', {
        username: currentUser,
        rank: userRank,
        members
      });
      
      const systemMsg = {
        username: 'System',
        message: `👋 ${currentUser} left the room`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      
      const room = memoryStore.rooms.get(roomName);
      if (room) {
        if (!room.messages) room.messages = [];
        room.messages.push(systemMsg);
        if (room.messages.length > 100) room.messages.shift();
      }
      
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
  
  socket.on('chat message', async (msg) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const sidSession = memoryStore.sessions.get(socket.id);
      if (isDeviceBanned(sidSession?.deviceId)) {
        socket.emit('system_message', { message: '⛔ Your device is banned', timestamp: new Date() });
        socket.disconnect(true);
        return;
      }

      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(sidSession?.deviceId)) {
        socket.emit('system_message', { message: '🔇 You are muted and cannot send messages', timestamp: new Date() });
        return;
      }

      const canSend = await checkMessageLimit(currentUser);
      if (!canSend) {
        socket.emit('system_message', { 
          message: '⏱️ Unverified users can only send 5 messages per 10 minutes. Please verify your email.', 
          timestamp: new Date() 
        });
        return;
      }

      const text = (msg.message || '').trim();

      if (NWORD_REGEX.test(text)) {
        if (['owner','admin'].includes(userRank)) {
          console.log(`🚫 n-word detected from ${currentUser} (${userRank}) but user exempt`);
        } else {
          const duration = '10m';
          const expiresAt = Date.now() + 10 * 60 * 1000;
          if (!memoryStore.bans.has(currentRoom)) memoryStore.bans.set(currentRoom, new Map());
          memoryStore.bans.get(currentRoom).set(currentUser, { expiresAt, bannedBy: 'System' });
          const devices = memoryStore.userDevices.get(currentUser);
          if (devices) {
            devices.forEach(did => {
              memoryStore.deviceBans.set(did, { expiresAt, bannedBy: 'System' });
            });
          }
          io.to(currentRoom).emit('user_banned', { bannedUser: currentUser, duration, bannerName: 'System' });
          let bannedSid = null;
          for (const [sid, session] of memoryStore.sessions) {
            if (session.username === currentUser && session.roomName === currentRoom) {
              bannedSid = sid;
              break;
            }
          }
          if (bannedSid) {
            io.to(bannedSid).emit('force_leave', { roomName: currentRoom, reason: 'banned' });
          }
          console.log(`🚫 ${currentUser} auto-banned for n-word in message`);
          return;
        }
      }

      if (!['moderator', 'admin', 'owner'].includes(userRank)) {
        const spamCount = recordMessage(currentUser, text);
        if (spamCount >= 3) {
          const duration = '10m';
          const expiresAt = Date.now() + 10 * 60 * 1000;
          const muteKey = `${currentUser}-${currentRoom}`;
          memoryStore.mutes.set(muteKey, { roomName: currentRoom, expiresAt, mutedBy: 'System' });
          const devices = memoryStore.userDevices.get(currentUser);
          if (devices) {
            devices.forEach(did => {
              memoryStore.deviceMutes.set(did, { expiresAt, mutedBy: 'System' });
              for (const [sid, session] of memoryStore.sessions) {
                if (session.deviceId === did) {
                  io.to(sid).emit('device_muted', { duration, mutedBy: 'System' });
                }
              }
            });
          }
          io.to(currentRoom).emit('user_muted', { mutedUser: currentUser, duration, muterName: 'System' });
          const systemMsg = {
            username: 'System',
            message: `🔇 ${currentUser} muted for spam (repeated messages)`,
            timestamp: new Date(),
            rank: 'system'
          };
          io.to(currentRoom).emit('chat message', systemMsg);
          console.log(`🔇 ${currentUser} muted for spam in ${currentRoom}`);
          return;
        }
      }

      const messageData = {
        username: currentUser,
        message: text,
        timestamp: new Date(),
        rank: userRank
      };
      
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
        if (!room.messages) room.messages = [];
        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      if (!isVerified) {
        await incrementMessageCount(currentUser);
        socket.emit('message_limit_update', { count: memoryStore.messageCounts.get(currentUser)?.count || 0 });
      }
      
      io.to(currentRoom).emit('chat message', messageData);
      
    } catch (err) {
      console.error('message error:', err);
    }
  });
  
  // ========== WARN USER ==========
  
  socket.on('warn_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      const { targetUser, warnerName } = data;
      
      if (targetUser === currentUser) {
        return socket.emit('error', { message: 'Cannot warn yourself' });
      }
      
      const targetRank = memoryStore.users.get(targetUser)?.rank || 'member';
      const targetLevel = getRankLevel(targetRank);
      const warnerLevel = getRankLevel(userRank);
      
      if (targetLevel <= warnerLevel && userRank !== 'owner') {
        return socket.emit('error', { message: 'Cannot warn users of equal or higher rank' });
      }
      
      if (targetRank === 'admin' && userRank !== 'owner') {
        return socket.emit('error', { message: 'Cannot warn other admins' });
      }
      
      const warnMsg = {
        username: 'System',
        message: `⚠️ WARNING: ${targetUser} was warned by ${warnerName}`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', warnMsg);
      io.to(currentRoom).emit('user_warned', { targetUser, warnerName, timestamp: new Date() });
      
      console.log(`⚠️ ${targetUser} warned by ${warnerName} in ${currentRoom}`);
      
    } catch (err) {
      console.error('warn_user error:', err);
    }
  });
  
  // ========== PRIVATE MESSAGES ==========
  
  socket.on('private_message', (data) => {
    try {
      if (!currentUser) return;
      
      const { recipient, message } = data;
      
      if (!recipient || !message) return;
      
      let recipientRank = 'member';
      const recipientUser = memoryStore.users.get(recipient);
      if (recipientUser) {
        recipientRank = recipientUser.rank;
      }
      
      const messageData = {
        from: currentUser,
        fromRank: userRank,
        to: recipient,
        toRank: recipientRank,
        message,
        timestamp: new Date(),
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9)
      };
      
      memoryStore.privateMessages.push(messageData);
      if (memoryStore.privateMessages.length > 100) {
        memoryStore.privateMessages.shift();
      }
      
      let recipientSocketId = null;
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === recipient) {
          recipientSocketId = sid;
          break;
        }
      }
      
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private_message', messageData);
        console.log(`💌 PM sent to recipient: ${recipient}`);
      }
      
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === currentUser || session.username === recipient) continue;
        if (session.rank === 'owner') {
          io.to(sid).emit('private_message', {
            ...messageData,
            adminView: true,
            viewedBy: session.username
          });
        } else if (session.rank === 'admin') {
          if (messageData.fromRank !== 'owner' && messageData.toRank !== 'owner') {
            io.to(sid).emit('private_message', {
              ...messageData,
              adminView: true,
              viewedBy: session.username
            });
          }
        }
      }
      
      socket.emit('private_message_sent', {
        to: recipient,
        message,
        timestamp: messageData.timestamp
      });
      
      console.log(`💌 PM: ${currentUser} (${userRank}) -> ${recipient} (${recipientRank})`);
      
    } catch (err) {
      console.error('private message error:', err);
    }
  });
  
  socket.on('get_private_history', () => {
    try {
      if (!currentUser) return;
      
      const history = memoryStore.privateMessages.filter(msg => {
        if (msg.from === currentUser || msg.to === currentUser) {
          return true;
        }
        if (userRank === 'owner') {
          return true;
        }
        if (userRank === 'admin') {
          if (msg.fromRank === 'owner' || msg.toRank === 'owner') {
            return false;
          }
          return true;
        }
        return false;
      });
      
      socket.emit('private_history', { messages: history });
      
    } catch (err) {
      console.error('get_private_history error:', err);
    }
  });
  
  // ========== FILE SHARING ==========
  
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
        timestamp: new Date(),
        rank: userRank
      };
      
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
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
  
  // ========== VOICE CHAT SIGNALING ==========
  
  socket.on('join_voice', (data) => {
    try {
      const { roomName, username } = data;
      const deviceId = memoryStore.sessions.get(socket.id)?.deviceId;
      if (isDeviceBanned(deviceId)) {
        socket.emit('voice_error', { message: '⛔ This device is banned' });
        return;
      }
      if (isUserMuted(username, roomName) || isDeviceMuted(deviceId)) {
        socket.emit('voice_error', { message: 'You are muted and cannot join voice chat' });
        return;
      }
      
      socket.join(`voice:${roomName}`);
      
      const systemMsg = {
        username: 'System',
        message: `🎤 ${username} joined voice chat`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      socket.to(`voice:${roomName}`).emit('user_joined_voice', {
        userId: socket.id,
        username: username
      });
      
      console.log(`🎤 ${username} joined voice in ${roomName}`);
    } catch (err) {
      console.error('join_voice error:', err);
    }
  });
  
  socket.on('leave_voice', (data) => {
    try {
      const { roomName, username } = data;
      socket.leave(`voice:${roomName}`);
      
      const systemMsg = {
        username: 'System',
        message: `🎤 ${username} left voice chat`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      socket.to(`voice:${roomName}`).emit('user_left_voice', {
        userId: socket.id
      });
      
      console.log(`🎤 ${username} left voice`);
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
  
  // ========== VIDEO CHAT SIGNALING ==========
  
  socket.on('join_video', (data) => {
    try {
      const { roomName, username, rank } = data;
      const deviceId = memoryStore.sessions.get(socket.id)?.deviceId;
      
      if (isDeviceBanned(deviceId)) {
        socket.emit('video_error', { message: '⛔ This device is banned' });
        return;
      }
      
      const permissions = PERMISSIONS[rank] || PERMISSIONS.member;
      if (!permissions.canVideo) {
        socket.emit('video_error', { message: 'Video chat requires VIP+ rank' });
        return;
      }
      
      if (isUserMuted(username, roomName) || isDeviceMuted(deviceId)) {
        socket.emit('video_error', { message: 'You are muted and cannot join video chat' });
        return;
      }
      
      socket.join(`video:${roomName}`);
      
      const systemMsg = {
        username: 'System',
        message: `🎥 ${username} joined video chat`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      socket.to(`video:${roomName}`).emit('user_joined_video', {
        userId: socket.id,
        username: username,
        rank: rank
      });
      
      socket.emit('video_self_joined', {
        userId: socket.id,
        username: username,
        rank: rank
      });
      
      console.log(`🎥 ${username} joined video in ${roomName}`);
    } catch (err) {
      console.error('join_video error:', err);
    }
  });
  
  socket.on('leave_video', (data) => {
    try {
      const { roomName, username } = data;
      socket.leave(`video:${roomName}`);
      
      const systemMsg = {
        username: 'System',
        message: `🎥 ${username} left video chat`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      socket.to(`video:${roomName}`).emit('user_left_video', {
        userId: socket.id,
        username: username
      });
      
      console.log(`🎥 ${username} left video`);
    } catch (err) {
      console.error('leave_video error:', err);
    }
  });
  
  socket.on('video_offer', (data) => {
    try {
      const { target, offer, roomName, username, rank } = data;
      io.to(target).emit('video_offer', {
        from: socket.id,
        offer: offer,
        roomName: roomName,
        username: username,
        rank: rank
      });
    } catch (err) {
      console.error('video_offer error:', err);
    }
  });
  
  socket.on('video_answer', (data) => {
    try {
      const { target, answer } = data;
      io.to(target).emit('video_answer', {
        from: socket.id,
        answer
      });
    } catch (err) {
      console.error('video_answer error:', err);
    }
  });
  
  socket.on('video_ice_candidate', (data) => {
    try {
      const { target, candidate } = data;
      io.to(target).emit('video_ice_candidate', {
        from: socket.id,
        candidate
      });
    } catch (err) {
      console.error('video_ice_candidate error:', err);
    }
  });
  
  // ========== ADMIN COMMANDS ==========
  
  socket.on('clear_messages', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canClear) {
        return socket.emit('error', { message: '❌ Only the owner can clear messages' });
      }
      
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
        room.messages = [];
      }
      memoryStore.privateMessages = [];
      
      io.to(currentRoom).emit('messages_cleared', { roomName: currentRoom });
      io.emit('private_messages_cleared');
      
      const systemMsg = {
        username: 'System',
        message: `🧹 Messages cleared by ${currentUser}`,
        timestamp: new Date(),
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
      
      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canBan) {
        return socket.emit('error', { message: '❌ You do not have permission to ban users' });
      }
      
      const { bannedUser, duration = '10m' } = data;
      
      if (!bannedUser) return;
      if (bannedUser === OWNER_USERNAME) {
        return socket.emit('error', { message: '❌ Cannot ban owner' });
      }
      if (bannedUser === currentUser) {
        return socket.emit('error', { message: '❌ Cannot ban yourself' });
      }
      
      const bannedUserRank = memoryStore.users.get(bannedUser)?.rank || 'member';
      const bannedLevel = getRankLevel(bannedUserRank);
      const bannerLevel = getRankLevel(userRank);
      
      if (bannedUserRank === 'admin' && userRank !== 'owner') {
        return socket.emit('error', { message: '❌ Cannot ban other admins' });
      }
      
      if (bannerLevel >= bannedLevel && userRank !== 'owner') {
        return socket.emit('error', { message: `❌ Cannot ban users of equal or higher rank. Your rank: ${userRank} (${bannerLevel}), Target rank: ${bannedUserRank} (${bannedLevel})` });
      }
      
      let durationMs = 10 * 60 * 1000;
      const match = duration.match(/^(\d+)([hmd])$/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        if (unit === 'h') durationMs = val * 60 * 60 * 1000;
        else if (unit === 'd') durationMs = val * 24 * 60 * 60 * 1000;
        else durationMs = val * 60 * 1000;
      }
      
      const expiresAt = Date.now() + durationMs;
      
      if (!memoryStore.bans.has(currentRoom)) {
        memoryStore.bans.set(currentRoom, new Map());
      }
      const roomBans = memoryStore.bans.get(currentRoom);
      roomBans.set(bannedUser, { expiresAt, bannedBy: currentUser, bannedAt: new Date() });
      
      io.to(currentRoom).emit('user_banned', { 
        bannedUser, 
        duration, 
        bannerName: currentUser,
        bannerRank: userRank 
      });
      
      const systemMsg = {
        username: 'System',
        message: `⛔ ${bannedUser} banned by ${currentUser} for ${duration}`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      let bannedSocketId = null;
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === bannedUser && session.roomName === currentRoom) {
          bannedSocketId = sid;
          break;
        }
      }
      
      const userDeviceSet = memoryStore.userDevices.get(bannedUser);
      if (userDeviceSet && userDeviceSet.size > 0) {
        userDeviceSet.forEach(did => {
          const ownerSession = [...memoryStore.sessions.values()].find(s => s.deviceId === did && s.username === OWNER_USERNAME);
          if (ownerSession) return;
          memoryStore.deviceBans.set(did, { expiresAt, bannedBy: currentUser });
          for (const [sid, session] of memoryStore.sessions) {
            if (session.deviceId === did) {
              io.to(sid).emit('device_banned', { by: currentUser, duration });
              try { 
                const socketToDisconnect = io.sockets.sockets.get(sid);
                if (socketToDisconnect) socketToDisconnect.disconnect(true); 
              } catch(e){}
            }
          }
        });
      }
      
      if (bannedSocketId) {
        io.to(bannedSocketId).emit('force_leave', { roomName: currentRoom, reason: 'banned' });
      }
      
      if (isMongoConnected && Ban) {
        (async () => {
          try {
            await Ban.create({
              roomName: currentRoom,
              username: bannedUser,
              bannedBy: currentUser,
              bannedByRank: userRank,
              expiresAt: new Date(expiresAt),
              isActive: true
            });
          } catch (err) {
            console.error('Failed to save ban to DB:', err.message);
          }
        })();
      }
      
      console.log(`🔨 ${bannedUser} banned from ${currentRoom} by ${currentUser} (${userRank}) for ${duration}`);
      
    } catch (err) {
      console.error('ban_user error:', err);
      socket.emit('error', { message: 'Failed to ban user: ' + err.message });
    }
  });
  
  socket.on('unban_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUnban) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { unbannedUser, password } = data;
      
      if (!unbannedUser) return;
      
      const roomBans = memoryStore.bans.get(currentRoom);
      if (roomBans) {
        roomBans.delete(unbannedUser);
      }

      const userDeviceSet = memoryStore.userDevices.get(unbannedUser);
      if (userDeviceSet && userDeviceSet.size > 0) {
        userDeviceSet.forEach(did => {
          memoryStore.deviceBans.delete(did);
          for (const [sid, session] of memoryStore.sessions) {
            if (session.deviceId === did) {
              io.to(sid).emit('device_unbanned');
            }
          }
        });
      }
      
      io.to(currentRoom).emit('user_unbanned', { unbannedUser, unbannerName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `✅ ${unbannedUser} unbanned by ${currentUser}`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      console.log(`✅ ${unbannedUser} unbanned from ${currentRoom} by ${currentUser}`);
      
    } catch (err) {
      console.error('unban_user error:', err);
    }
  });
  
  socket.on('mute_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canMute) {
        return socket.emit('error', { message: '❌ You do not have permission to mute users' });
      }
      
      const { mutedUser, duration = '10m' } = data;
      
      if (!mutedUser) return;
      if (mutedUser === OWNER_USERNAME) {
        return socket.emit('error', { message: '❌ Cannot mute owner' });
      }
      if (mutedUser === currentUser) {
        return socket.emit('error', { message: '❌ Cannot mute yourself' });
      }
      
      const mutedUserRank = memoryStore.users.get(mutedUser)?.rank || 'member';
      const mutedLevel = getRankLevel(mutedUserRank);
      const muterLevel = getRankLevel(userRank);
      
      if (mutedUserRank === 'admin' && userRank !== 'owner') {
        return socket.emit('error', { message: '❌ Cannot mute other admins' });
      }
      
      if (muterLevel >= mutedLevel && userRank !== 'owner') {
        return socket.emit('error', { message: `❌ Cannot mute users of equal or higher rank. Your rank: ${userRank} (${muterLevel}), Target rank: ${mutedUserRank} (${mutedLevel})` });
      }
      
      const durationMs = parseDuration(duration);
      const expiresAt = Date.now() + durationMs;
      const muteKey = `${mutedUser}-${currentRoom}`;
      
      memoryStore.mutes.set(muteKey, { roomName: currentRoom, expiresAt, mutedBy: currentUser });
      
      const userDeviceSet = memoryStore.userDevices.get(mutedUser);
      if (userDeviceSet && userDeviceSet.size > 0) {
        userDeviceSet.forEach(did => {
          memoryStore.deviceMutes.set(did, { expiresAt, mutedBy: currentUser });
          for (const [sid, session] of memoryStore.sessions) {
            if (session.deviceId === did) {
              io.to(sid).emit('device_muted', { duration, mutedBy: currentUser });
            }
          }
        });
      }
      
      io.to(currentRoom).emit('user_muted', { mutedUser, duration, muterName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `🔇 ${mutedUser} muted by ${currentUser} for ${duration}`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      console.log(`🔇 ${mutedUser} muted in ${currentRoom} by ${currentUser} (${userRank}) for ${duration}`);
      
    } catch (err) {
      console.error('mute_user error:', err);
      socket.emit('error', { message: 'Failed to mute user: ' + err.message });
    }
  });
  
  socket.on('unmute_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canMute) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { unmutedUser } = data;
      
      if (!unmutedUser) return;
      
      const unmutedUserRank = memoryStore.users.get(unmutedUser)?.rank || 'member';
      const unmutedLevel = getRankLevel(unmutedUserRank);
      const unmuterLevel = getRankLevel(userRank);
      
      if (unmuterLevel >= unmutedLevel && userRank !== 'owner') {
        return socket.emit('error', { message: '❌ Cannot unmute users of equal or higher rank' });
      }
      
      const muteKey = `${unmutedUser}-${currentRoom}`;
      memoryStore.mutes.delete(muteKey);

      const userDeviceSet = memoryStore.userDevices.get(unmutedUser);
      if (userDeviceSet && userDeviceSet.size > 0) {
        userDeviceSet.forEach(did => {
          memoryStore.deviceMutes.delete(did);
          for (const [sid, session] of memoryStore.sessions) {
            if (session.deviceId === did) {
              io.to(sid).emit('device_unmuted');
            }
          }
        });
      }
      
      io.to(currentRoom).emit('user_unmuted', { unmutedUser, unmuterName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `🔓 ${unmutedUser} unmuted by ${currentUser}`,
        timestamp: new Date(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      console.log(`🔓 ${unmutedUser} unmuted in ${currentRoom} by ${currentUser}`);
      
    } catch (err) {
      console.error('unmute_user error:', err);
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
      
      io.to(roomName).emit('room_deleted_by_owner', { roomName });
      
      io.emit('room_deleted', { name: roomName });
      
      console.log(`🗑️ Room deleted: ${roomName} by ${currentUser}`);
      
    } catch (err) {
      console.error('delete_room error:', err);
      socket.emit('error', { message: 'Failed to delete room' });
    }
  });
  
  socket.on('delete_user', (data) => {
    try {
      if (!currentUser) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canDeleteAnyUser && userRank !== 'owner') {
        return socket.emit('error', { message: 'You do not have permission to delete users' });
      }
      
      const { targetUser } = data;
      
      if (targetUser === OWNER_USERNAME) {
        return socket.emit('error', { message: 'Cannot delete owner' });
      }
      
      const targetRank = memoryStore.users.get(targetUser)?.rank || 'member';
      
      if (targetRank === 'admin' && userRank !== 'owner') {
        return socket.emit('error', { message: 'Cannot delete other admins' });
      }
      
      memoryStore.users.delete(targetUser);
      
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === targetUser) {
          io.to(sid).emit('user_deleted', { deletedUser: targetUser, deletedBy: currentUser });
          const socketToDisconnect = io.sockets.sockets.get(sid);
          if (socketToDisconnect) socketToDisconnect.disconnect(true);
          memoryStore.sessions.delete(sid);
        }
      }
      
      io.emit('system_message', { 
        message: `🗑️ User ${targetUser} was deleted by ${currentUser}`,
        timestamp: new Date() 
      });
      
      console.log(`🗑️ User ${targetUser} deleted by ${currentUser}`);
      
    } catch (err) {
      console.error('delete_user error:', err);
      socket.emit('error', { message: 'Failed to delete user: ' + err.message });
    }
  });
  
  socket.on('effect_command', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUseEffects) {
        return socket.emit('error', { message: '❌ You do not have permission to use effects' });
      }
      
      const { effect } = data;
      
      const validEffects = ['glitch', 'flashbang', 'black', 'hack', 'matrix', 'rainbow', 'neon', 'firework', 'confetti', 'gameroom'];
      
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
      
      if (currentRoom && (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId))) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canGrant || permissions.canGrant.length === 0) {
        return socket.emit('error', { message: '❌ You do not have permission to grant ranks' });
      }
      
      const { targetUser, newRank } = data;
      
      if (!targetUser || !newRank) return;
      
      if (newRank === 'admin' && userRank !== 'owner') {
        return socket.emit('error', { message: 'Only the owner can grant admin rank' });
      }
      
      if (!permissions.canGrant.includes(newRank)) {
        return socket.emit('error', { message: `Cannot grant ${newRank} rank` });
      }
      
      const targetUserData = memoryStore.users.get(targetUser);
      if (!targetUserData) {
        return socket.emit('error', { message: `User ${targetUser} not found` });
      }
      
      targetUserData.rank = newRank;
      
      if (isMongoConnected && User) {
        (async () => {
          try {
            await User.findOneAndUpdate(
              { username: targetUser },
              { rank: newRank },
              { new: true }
            );
          } catch (err) {
            console.error('Failed to update user rank in DB:', err.message);
          }
        })();
      }
      
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username === targetUser) {
          session.rank = newRank;
          io.to(sid).emit('rank_changed', { newRank, grantedBy: currentUser });
          break;
        }
      }
      
      socket.emit('command_success', { message: `✅ ${targetUser} is now ${newRank}` });
      console.log(`👑 ${currentUser} granted ${targetUser} rank ${newRank}`);
      
    } catch (err) {
      console.error('grant_rank error:', err);
      socket.emit('error', { message: 'Failed to grant rank: ' + err.message });
    }
  });
  
  socket.on('change_theme', (data) => {
    try {
      if (!currentUser) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      const isVip = permissions.canUpload;
      
      const { theme, scope } = data;
      
      if (scope === 'room' && currentRoom && (isUserMuted(currentUser, currentRoom) || isDeviceMuted(memoryStore.sessions.get(socket.id)?.deviceId))) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const validThemes = ['default', 'dark', 'light', 'neon', 'midnight', 'sunset', 'forest', 'ocean', 'cyberpunk', 'vintage', 'hack'];
      
      if (!validThemes.includes(theme)) {
        return socket.emit('error', { message: '❌ Invalid theme' });
      }
      
      if (scope === 'personal') {
        if (memoryStore.users.has(currentUser)) {
          const user = memoryStore.users.get(currentUser);
          user.theme = theme;
        }
        socket.emit('theme_applied', { theme, scope: 'personal' });
      } else if (scope === 'room' && currentRoom) {
        const room = memoryStore.rooms.get(currentRoom);
        if (room && isVip) {
          room.theme = theme;
          io.to(currentRoom).emit('theme_applied', { theme, scope: 'room', changedBy: currentUser });
        }
      }
      
    } catch (err) {
      console.error('theme change error:', err);
    }
  });
  
  // ========== DISCONNECT ==========
  
  socket.on('disconnect', () => {
    try {
      if (currentUser && currentRoom) {
        const roomName = currentRoom;
        
        io.to(roomName).emit('user_left', {
          username: currentUser,
          rank: userRank,
          members: 0
        });
        
        io.to(roomName).emit('chat message', {
          username: 'System',
          message: `👋 ${currentUser} disconnected`,
          timestamp: new Date(),
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
// 💾 MESSAGE BACKUP TO MONGODB (EVERY 5 SECONDS)
// ============================================
setInterval(async () => {
  if (!isMongoConnected) {
    return;
  }
  
  try {
    if (Message && memoryStore.rooms.size > 0) {
      for (const [roomName, room] of memoryStore.rooms.entries()) {
        if (room.messages && room.messages.length > 0) {
          for (const msg of room.messages) {
            try {
              const existing = await Message.findOne({
                roomName: roomName,
                username: msg.username,
                message: msg.message,
                timestamp: msg.timestamp
              }).lean();
              
              if (!existing) {
                const message = new Message({
                  roomName: roomName,
                  username: msg.username,
                  message: msg.message,
                  timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
                  isSystem: msg.username === 'System',
                  senderRank: msg.rank || 'member',
                  fileUrl: msg.fileUrl || null,
                  fileName: msg.fileName || null,
                  fileType: msg.fileType || null,
                  fileSize: msg.fileSize || null
                });
                await message.save();
                
                await Room.updateOne(
                  { name: roomName },
                  { $push: { messages: message._id } }
                );
              }
            } catch (err) {}
          }
        }
      }
    }
    
    if (PrivateMessage && memoryStore.privateMessages.length > 0) {
      const messagesToBackup = memoryStore.privateMessages.slice();
      
      for (const msg of messagesToBackup) {
        try {
          const existing = await PrivateMessage.findOne({
            from: msg.from,
            to: msg.to,
            message: msg.message,
            timestamp: msg.timestamp
          }).lean();
          
          if (!existing) {
            const pm = new PrivateMessage({
              from: msg.from,
              fromRank: msg.fromRank,
              to: msg.to,
              toRank: msg.toRank,
              message: msg.message,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
              visibleTo: [msg.from, msg.to]
            });
            await pm.save();
          }
        } catch (err) {}
      }
    }
    
    if (memoryStore.privateMessages.length > 100) {
      memoryStore.privateMessages = memoryStore.privateMessages.slice(-100);
    }
    
  } catch (err) {
    console.error('❌ Message backup error:', err.message);
  }
}, 5000);

// ============================================
// 🚀 START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(70));
  console.log('🚀🚀🚀 BLACK HOLE CHAT V2 - SERVER RUNNING 🚀🚀🚀');
  console.log('='.repeat(70));
  console.log(`\n📡 Port: ${PORT}`);
  console.log(`👑 Owner: ${OWNER_USERNAME} (${OWNER_FULLNAME})`);
  console.log(`📧 Owner Email: ${OWNER_EMAIL}`);
  console.log(`📧 EmailJS Service: ${EMAILJS_SERVICE_ID}`);
  console.log(`📧 EmailJS Template: ${EMAILJS_TEMPLATE_ID}`);
  console.log(`📊 Rank System:`);
  console.log(`   1. 👑 Owner - Can see ALL private messages, Video enabled, Can grant any rank, Can clear chat, Can bypass room passwords, Can delete any user`);
  console.log(`   2. 👮 Admin - Can grant moderator/vip/member, CANNOT grant admin, CANNOT demote other admins, CANNOT clear chat`);
  console.log(`   3. 🛡️ Moderator - Can ban/mute/warn users with lower rank, Cannot grant ranks`);
  console.log(`   4. ⭐ VIP - Video enabled, AI access, Image generation`);
  console.log(`   5. 👤 Member - Basic access, Video disabled, AI disabled`);
  console.log(`📧 Email Verification: Required for new accounts (via EmailJS)`);
  console.log(`⏱️ Unverified users: Limited to 5 messages per 10 minutes`);
  console.log(`🎥 Video Chat: Now shows your own camera and others' feeds`);
  console.log(`⚠️ Warn Command: Available for Moderator+`);
  console.log(`🎮 Effects: Last forever until new effect or /effect off`);
  console.log(`💾 MongoDB: ${isMongoConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
  console.log(`📁 Uploads: ${uploadDir} (${memoryStore.files.size} files in memory)`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log('\n' + '='.repeat(70) + '\n');
});

module.exports = { 
  app, server, io,
  PERMISSIONS,
  memoryStore,
  getRankLevel,
  isDeviceBanned,
  isDeviceMuted
};