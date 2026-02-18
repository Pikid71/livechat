require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs').promises;

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
const OWNER_USERNAME = 'Pi_Kid71';
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('\n' + '='.repeat(70));
console.log('🚀 BLACK HOLE CHAT V2 - SERVER STARTING');
console.log('='.repeat(70));
console.log(`📡 Port: ${PORT}`);
console.log(`👑 Owner: ${OWNER_USERNAME}`);
console.log(`🔑 Admin Password: ${ADMIN_PASSWORD ? '****' : 'default'}`);
console.log(`🌍 Environment: ${NODE_ENV}`);
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
    // Load recent data into memory store after defaults are ensured
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
    console.error('   Make sure your IP is whitelisted in MongoDB Atlas');
    console.error('   Network Access → Add IP Address → Add Current IP');
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

// Load users, rooms, recent messages and bans from MongoDB into in-memory store
async function loadInitialData() {
  if (!isMongoConnected) return;
  try {
    console.log('🔁 Loading initial data from MongoDB into memory store...');

    const users = await User.find({}).lean();
    users.forEach(u => {
      memoryStore.users.set(u.username, {
        username: u.username,
        password: u.password,
        rank: u.rank || 'member',
        theme: u.theme || 'default'
      });
    });

    const rooms = await Room.find({}).lean();
    rooms.forEach(r => {
      if (!memoryStore.rooms.has(r.name)) {
        memoryStore.rooms.set(r.name, {
          name: r.name,
          password: r.password || '',
          isDefault: !!r.isDefault,
          members: new Map(),
          messages: [],
          theme: r.theme || 'default'
        });
      } else {
        const existing = memoryStore.rooms.get(r.name);
        existing.theme = r.theme || existing.theme;
      }
    });

    // Load recent messages per room (limit 200)
    for (const [roomName, roomObj] of memoryStore.rooms.entries()) {
      try {
        const msgs = await Message.find({ roomName }).sort({ timestamp: -1 }).limit(200).lean();
        roomObj.messages = msgs.reverse().map(m => ({
          username: m.username,
          message: m.message,
          timestamp: m.timestamp ? m.timestamp.toLocaleTimeString() : new Date().toLocaleTimeString(),
          rank: m.senderRank || 'member',
          fileUrl: m.fileUrl || null,
          fileName: m.fileName || null,
          fileType: m.fileType || null,
          fileSize: m.fileSize || null
        }));
      } catch (err) {
        console.error(`Failed to load messages for room ${roomName}:`, err.message);
      }
    }

    // Load active bans
    const bans = await Ban.find({ isActive: true }).lean();
    bans.forEach(b => {
      const roomBans = memoryStore.bans.get(b.roomName) || [];
      roomBans.push({ username: b.username, bannedBy: b.bannedBy, expiresAt: b.expiresAt });
      memoryStore.bans.set(b.roomName, roomBans);
    });

    // Load recent private messages
    const pms = await PrivateMessage.find({}).sort({ timestamp: -1 }).limit(200).lean();
    memoryStore.privateMessages = pms.reverse().map(pm => ({
      from: pm.from,
      to: pm.to,
      message: pm.message,
      timestamp: pm.timestamp
    }));

    console.log('✅ Initial data loaded into memory store');
  } catch (err) {
    console.error('❌ loadInitialData error:', err.message);
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
// 🖼️ IMAGE GENERATION (Stable Horde fallback)
// ============================================
const imageJobs = new Map(); // requestId -> { status, url, prompt, createdAt }

app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, size = '512', model = '' } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const key = process.env.STABLE_HORDE_API_KEY;
    if (!key) return res.status(500).json({ error: 'Stable Horde API key not configured (STABLE_HORDE_API_KEY)' });

    // Build request payload for Stable Horde
    const width = parseInt(size, 10) || 512;
    const height = width;
    const steps = 20;

    const body = {
      prompt: prompt,
      params: {
        steps: steps,
        width: width,
        height: height,
        cfg_scale: 7
      }
    };

    const createResp = await fetch('https://stablehorde.net/api/v2/generate/text2img', {
      method: 'POST',
      headers: {
        'apikey': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const createJson = await createResp.json().catch(() => null);
    if (!createResp.ok || !createJson) {
      const details = createJson || { status: createResp.status, statusText: createResp.statusText };
      return res.status(502).json({ error: 'Image provider error', details });
    }

    const requestId = createJson?.id || createJson?.generations?.[0]?.id || createJson?.request_id || createJson?.task_id;
    if (!requestId) {
      // If provider returned an image immediately
      const maybeImage = extractImageFromProvider(createJson);
      if (maybeImage) {
        const fileName = `gen-${Date.now()}.png`;
        const filePath = path.join(uploadDir, fileName);
        await fs.writeFile(filePath, Buffer.from(maybeImage, 'base64'));
        const url = `/uploads/${fileName}`;
        return res.json({ imageUrl: url });
      }
      return res.status(502).json({ error: 'Image provider did not return request id' , details: createJson});
    }

    // store job as pending and start background poller
    imageJobs.set(requestId, { status: 'pending', url: null, prompt, createdAt: Date.now() });
    pollStableHordeResult(requestId, key);

    return res.json({ requestId, status: 'pending' });
  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

app.get('/api/image-result/:id', async (req, res) => {
  const id = req.params.id;
  if (!imageJobs.has(id)) return res.status(404).json({ error: 'Unknown request id' });
  return res.json(imageJobs.get(id));
});

function extractImageFromProvider(json) {
  try {
    if (!json) return null;
    // common patterns
    if (json.images && Array.isArray(json.images) && json.images[0]) return json.images[0];
    if (json.data && Array.isArray(json.data) && json.data[0]?.b64_json) return json.data[0].b64_json;
    if (json.result && json.result[0]?.b64) return json.result[0].b64;
    if (json.image && typeof json.image === 'string') return json.image;
    return null;
  } catch (e) {
    return null;
  }
}

async function pollStableHordeResult(requestId, key) {
  const endpoints = [
    `https://stablehorde.net/api/v2/generate/status/${requestId}`,
    `https://stablehorde.net/api/v2/generate/${requestId}/status`,
    `https://stablehorde.net/api/v2/generate/${requestId}`,
    `https://stablehorde.net/api/v2/generate/${requestId}/result`,
    `https://stablehorde.net/api/v2/generate/status/${requestId}/result`
  ];

  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const ep of endpoints) {
      try {
        const r = await fetch(ep, { headers: { 'apikey': key } });
        const j = await r.json().catch(() => null);
        if (!j) continue;

        // check for ready images
        const imgB64 = extractImageFromProvider(j) || (Array.isArray(j.generations) && j.generations[0]?.img) || (j.generations && j.generations[0]?.b64);
        if (imgB64) {
          const fileName = `gen-${Date.now()}.png`;
          const filePath = path.join(uploadDir, fileName);
          await fs.writeFile(filePath, Buffer.from(imgB64, 'base64'));
          const url = `/uploads/${fileName}`;
          imageJobs.set(requestId, { status: 'done', url, prompt: imageJobs.get(requestId)?.prompt, createdAt: Date.now() });
          return;
        }

        // some responses include 'done' flag or 'status'
        if (j.status && (j.status === 'done' || j.status === 'completed')) {
          // try to find images field
          const img = extractImageFromProvider(j);
          if (img) {
            const fileName = `gen-${Date.now()}.png`;
            const filePath = path.join(uploadDir, fileName);
            await fs.writeFile(filePath, Buffer.from(img, 'base64'));
            const url = `/uploads/${fileName}`;
            imageJobs.set(requestId, { status: 'done', url, prompt: imageJobs.get(requestId)?.prompt, createdAt: Date.now() });
            return;
          }
        }
      } catch (err) {
        // ignore individual endpoint errors and continue
      }
    }

    // wait before next attempt
    await new Promise(r => setTimeout(r, 2000));
  }

  // mark as failed after attempts
  imageJobs.set(requestId, { status: 'failed', url: null, prompt: imageJobs.get(requestId)?.prompt, createdAt: Date.now() });
}


// ============================================
// 🏥 HEALTH CHECK ENDPOINT
// ============================================
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

    // Only optimize images for non-owner users
    if (req.file.mimetype.startsWith('image/') && !isOwner) {
      try {
        const optimizedPath = path.join(uploadDir, 'opt-' + req.file.filename);
        
        // Moderate compression for regular users
        await sharp(req.file.path)
          .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 75, progressive: true })
          .toFile(optimizedPath);
        
        await fs.unlink(req.file.path).catch(() => {});
        finalPath = optimizedPath;
        const stats = await fs.stat(optimizedPath);
        fileSize = stats.size;
        fileType = 'image/jpeg';
        console.log(`🖼️ Image optimized for regular user: ${fileSize} bytes (${Math.round((1 - fileSize/req.file.size)*100)}% smaller)`);
      } catch (imgErr) {
        console.error('Image optimization error:', imgErr.message);
      }
    } else if (req.file.mimetype.startsWith('image/') && isOwner) {
      console.log(`👑 Owner uploaded image - keeping original quality`);
    }

    const fileUrl = `/uploads/${path.basename(finalPath)}`;
    
    if (isMongoConnected && FileModel) {
      try {
        await FileModel.create({
          filename: path.basename(finalPath),
          originalName: req.file.originalname,
          uploadedBy: uploadedBy,
          fileSize: fileSize,
          fileType: fileType,
          roomName: req.body.roomName || null,
          recipient: req.body.recipient || null
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

// ========== IMAGE GENERATION PROXY (server-side) ==========
app.post('/api/generate-image', express.json(), async (req, res) => {
  if (!isMongoConnected && !process.env.DEAPI_API_KEY) {
    // still allow if env key present
  }

  try {
    const { prompt, size = '512', model } = req.body;
    if (!prompt || prompt.trim() === '') return res.status(400).json({ error: 'Missing prompt' });

    const DEAPI_API_KEY = process.env.DEAPI_API_KEY || process.env.DEAPI_API_KEY || '';
    if (!DEAPI_API_KEY) return res.status(500).json({ error: 'Image API key not configured' });

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

    // Try requested model first; if it fails due to non-existent model, try fallbacks
    const candidateModels = [];
    if (model) candidateModels.push(model);
    // Add known DeAPI client model slugs as fallbacks (from provider listing)
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

          // If the model specifically doesn't exist, try next candidate
          if (errData && errData.errors && errData.errors.model && Array.isArray(errData.errors.model) && errData.errors.model.some(e => /does not exist|required/i.test(e))) {
            continue;
          }

          // Otherwise stop and return provider error
          return res.status(502).json({ error: 'Image provider error', details: errData });
        }

        data = await resp.json();
        // success
        break;
      } catch (err) {
        lastErr = { message: err.message };
      }
    }

    if (!data) {
      return res.status(502).json({ error: 'Image provider error', details: lastErr || {} });
    }

    // try to extract image url/base64
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
  bans: new Map(),
  mutes: new Map(),
  privateMessages: []
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
    canSeeAllPrivate: true
  },
  admin: { 
    level: 2, 
    canBan: true, 
    canUnban: true, 
    canMute: true,
    canDeleteRoom: true, 
    canClear: true, 
    canGrant: ['moderator', 'vip', 'member'], 
    canUseEffects: true, 
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: false
  },
  moderator: { 
    level: 3, 
    canBan: true, 
    canUnban: false, 
    canMute: true,
    canDeleteRoom: false, 
    canClear: true, 
    canGrant: [], 
    canUseEffects: false, 
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: false
  },
  vip: { 
    level: 4, 
    canBan: false, 
    canUnban: false, 
    canMute: false,
    canDeleteRoom: false, 
    canClear: false, 
    canGrant: [], 
    canUseEffects: false, 
    canUpload: true, 
    canVoice: true, 
    canVideo: true,
    canSeeAllPrivate: false
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
    canSeeAllPrivate: false
  }
};

// ============================================
// 🔌 SOCKET.IO HANDLERS
// ============================================

io.on('connection', (socket) => {
    // Simple ping handler for latency checks from clients (acknowledgement)
    socket.on('ping', (cb) => {
      try {
        if (typeof cb === 'function') cb();
      } catch (err) {
        // ignore
      }
    });
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
      
      if (username === OWNER_USERNAME && password === ADMIN_PASSWORD) {
        currentUser = username;
        userRank = 'owner';
        memoryStore.sessions.set(socket.id, { username, rank: 'owner' });
        socket.emit('auth_success', { username, rank: 'owner', theme: 'dark', message: 'Welcome Owner!' });
        console.log(`✅ Owner logged in: ${username}`);
        return;
      }
      
      if (username === 'admin' && password === ADMIN_PASSWORD) {
        currentUser = username;
        userRank = 'admin';
        memoryStore.sessions.set(socket.id, { username, rank: 'admin' });
        socket.emit('auth_success', { username, rank: 'admin', theme: 'default', message: 'Welcome Admin!' });
        console.log(`✅ Admin logged in: ${username}`);
        return;
      }
      
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
      
      if (username === OWNER_USERNAME || username === 'admin') {
        return socket.emit('auth_error', { message: 'Username reserved' });
      }
      
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
        message: 'Registration successful!'
      });
      
      console.log(`✅ User registered: ${username}`);
      
    } catch (err) {
      console.error('Registration error:', err);
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
  
  socket.on('check_auth', () => {
    const session = memoryStore.sessions.get(socket.id);
    if (session) {
      socket.emit('auth_status', { 
        authenticated: true, 
        username: session.username,
        rank: session.rank
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
  
  // ========== ENHANCED USER LIST COMMAND ==========
  
  socket.on('get_user_list', (data) => {
    try {
      if (!currentUser || !currentRoom) {
        return socket.emit('user_list', { error: 'Not in a room' });
      }
      
      const { roomName } = data;
      
      // Get all users in current room
      const roomUsers = [];
      for (const [sid, session] of memoryStore.sessions) {
        if (session.roomName === roomName && session.username !== currentUser) {
          roomUsers.push({
            username: session.username,
            rank: session.rank || 'member'
          });
        }
      }
      
      // Get all registered users
      const allUsers = Array.from(memoryStore.users.keys()).filter(u => u !== currentUser);
      
      // Get users in other rooms
      const otherRoomUsers = [];
      const notOnlineUsers = [];
      
      allUsers.forEach(username => {
        // Skip if already in current room
        if (roomUsers.some(u => u.username === username)) {
          return;
        }
        
        // Check if user is online
        let isOnline = false;
        let userRoom = null;
        let userRank = memoryStore.users.get(username)?.rank || 'member';
        
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
            room: userRoom
          });
        } else {
          notOnlineUsers.push({
            username,
            rank: userRank
          });
        }
      });
      
      // Sort by rank
      const rankOrder = { 'owner': 1, 'admin': 2, 'moderator': 3, 'vip': 4, 'member': 5 };
      
      roomUsers.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));
      otherRoomUsers.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));
      notOnlineUsers.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));
      
      // Send back to client
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
      
      const { roomName, password } = data;
      
      const room = memoryStore.rooms.get(roomName);
      if (!room) {
        return socket.emit('error', { message: 'Room does not exist' });
      }
      
      if (room.password && room.password !== password) {
        return socket.emit('error', { message: 'Incorrect password' });
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
        messages: room.messages || []
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
        timestamp: new Date().toLocaleTimeString(),
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
  
  socket.on('chat message', (msg) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom)) {
        socket.emit('system_message', { message: '🔇 You are muted and cannot send messages' });
        return;
      }
      
      const messageData = {
        username: currentUser,
        message: msg.message,
        timestamp: new Date().toLocaleTimeString(),
        rank: userRank
      };
      
      const room = memoryStore.rooms.get(currentRoom);
      if (room) {
        if (!room.messages) room.messages = [];
        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();
      }
      
      socket.broadcast.to(currentRoom).emit('chat message', messageData);
      
    } catch (err) {
      console.error('message error:', err);
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
        timestamp: new Date().toLocaleTimeString(),
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
      
      // Send to admins/owner based on rank
      const senderLevel = getRankLevel(userRank);
      for (const [sid, session] of memoryStore.sessions) {
        if (session.username !== currentUser && session.username !== recipient) {
          const viewerLevel = getRankLevel(session.rank);
          if (viewerLevel < senderLevel) {
            io.to(sid).emit('private_message', {
              ...messageData,
              adminView: true,
              viewedBy: session.username
            });
          }
        }
      }
      
      // Owner always sees all private messages
      if (userRank !== 'owner') {
        for (const [sid, session] of memoryStore.sessions) {
          if (session.rank === 'owner' && session.username !== currentUser && session.username !== recipient) {
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
      
      const userLevel = getRankLevel(userRank);
      const history = memoryStore.privateMessages.filter(msg => {
        if (msg.from === currentUser || msg.to === currentUser) {
          return true;
        }
        const senderLevel = getRankLevel(msg.fromRank);
        return userLevel < senderLevel;
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
        timestamp: new Date().toLocaleTimeString(),
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
      
      // Check if user is muted
      if (isUserMuted(username, roomName)) {
        socket.emit('voice_error', { message: 'You are muted and cannot join voice chat' });
        return;
      }
      
      socket.join(`voice:${roomName}`);
      
      // Send system message that user joined voice
      const systemMsg = {
        username: 'System',
        message: `🎤 ${username} joined voice chat`,
        timestamp: new Date().toLocaleTimeString(),
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
      
      // Send system message that user left voice
      const systemMsg = {
        username: 'System',
        message: `🎤 ${username} left voice chat`,
        timestamp: new Date().toLocaleTimeString(),
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
      
      // Check if user has permission (VIP+)
      const permissions = PERMISSIONS[rank] || PERMISSIONS.member;
      if (!permissions.canVideo) {
        socket.emit('video_error', { message: 'Video chat requires VIP+ rank' });
        return;
      }
      
      // Check if user is muted
      if (isUserMuted(username, roomName)) {
        socket.emit('video_error', { message: 'You are muted and cannot join video chat' });
        return;
      }
      
      socket.join(`video:${roomName}`);
      
      // Send system message that user joined video
      const systemMsg = {
        username: 'System',
        message: `🎥 ${username} joined video chat`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(roomName).emit('chat message', systemMsg);
      socket.to(`video:${roomName}`).emit('user_joined_video', {
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
      
      // Send system message that user left video
      const systemMsg = {
        username: 'System',
        message: `🎥 ${username} left video chat`,
        timestamp: new Date().toLocaleTimeString(),
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
        answer: answer
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
      
      if (isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canClear) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { password } = data;
      
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
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
      
      if (isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canBan) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { bannedUser, duration = '10m', password } = data;
      
      if (!bannedUser) return;
      
      const bannedUserRank = memoryStore.users.get(bannedUser)?.rank || 'member';
      const bannedLevel = getRankLevel(bannedUserRank);
      const bannerLevel = getRankLevel(userRank);
      
      if (bannerLevel >= bannedLevel && userRank !== 'owner') {
        return socket.emit('error', { message: '❌ Cannot ban users of equal or higher rank' });
      }
      
      if (userRank === 'moderator' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
      let durationMs = 10 * 60 * 1000;
      const match = duration.match(/^(\d+)([hmd])$/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        if (unit === 'h') durationMs = val * 60 * 60 * 1000;
        else if (unit === 'd') durationMs = val * 24 * 60 * 60 * 1000;
      }
      
      const expiresAt = Date.now() + durationMs;
      
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
      
      if (isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUnban) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { unbannedUser, password } = data;
      
      if (!unbannedUser) return;
      
      if (userRank !== 'admin' && userRank !== 'owner' && password !== ADMIN_PASSWORD) {
        return socket.emit('error', { message: '❌ Incorrect password' });
      }
      
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
  
  socket.on('mute_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canMute) {
        return socket.emit('error', { message: '❌ You do not have permission' });
      }
      
      const { mutedUser, duration = '10m' } = data;
      
      if (!mutedUser) return;
      
      const mutedUserRank = memoryStore.users.get(mutedUser)?.rank || 'member';
      const mutedLevel = getRankLevel(mutedUserRank);
      const muterLevel = getRankLevel(userRank);
      
      if (muterLevel >= mutedLevel && userRank !== 'owner') {
        return socket.emit('error', { message: '❌ Cannot mute users of equal or higher rank' });
      }
      
      const durationMs = parseDuration(duration);
      const expiresAt = Date.now() + durationMs;
      const muteKey = `${mutedUser}-${currentRoom}`;
      
      memoryStore.mutes.set(muteKey, { roomName: currentRoom, expiresAt, mutedBy: currentUser });
      
      io.to(currentRoom).emit('user_muted', { mutedUser, duration, muterName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `🔇 ${mutedUser} muted by ${currentUser} for ${duration}`,
        timestamp: new Date().toLocaleTimeString(),
        rank: 'system'
      };
      
      io.to(currentRoom).emit('chat message', systemMsg);
      
      console.log(`🔇 ${mutedUser} muted in ${currentRoom} by ${currentUser} for ${duration}`);
      
    } catch (err) {
      console.error('mute_user error:', err);
    }
  });
  
  socket.on('unmute_user', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom)) {
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
      
      io.to(currentRoom).emit('user_unmuted', { unmutedUser, unmuterName: currentUser });
      
      const systemMsg = {
        username: 'System',
        message: `🔓 ${unmutedUser} unmuted by ${currentUser}`,
        timestamp: new Date().toLocaleTimeString(),
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
  
  socket.on('effect_command', (data) => {
    try {
      if (!currentUser || !currentRoom) return;
      
      if (isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      if (!permissions.canUseEffects) {
        return socket.emit('error', { message: '❌ Only admins can use effects' });
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
      
      if (currentRoom && isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
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
      
      // Update in memory store
      if (memoryStore.users.has(targetUser)) {
        const user = memoryStore.users.get(targetUser);
        user.rank = newRank;
        
        for (const [sid, session] of memoryStore.sessions) {
          if (session.username === targetUser) {
            session.rank = newRank;
            io.to(sid).emit('rank_changed', { newRank, grantedBy: currentUser });
            break;
          }
        }
      }
      
      // Update in MongoDB
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
      
      socket.emit('command_success', { message: `✅ ${targetUser} is now ${newRank}` });
      console.log(`👑 ${currentUser} granted ${targetUser} rank ${newRank}`);
      
    } catch (err) {
      console.error('grant_rank error:', err);
    }
  });
  
  socket.on('change_theme', (data) => {
    try {
      if (!currentUser) return;
      
      const permissions = PERMISSIONS[userRank] || PERMISSIONS.member;
      const isVip = permissions.canUpload;
      
      const { theme, scope } = data;
      
      if (scope === 'room' && currentRoom && isUserMuted(currentUser, currentRoom)) {
        return socket.emit('error', { message: '❌ You are muted and cannot use commands' });
      }
      
      const validThemes = ['default', 'dark', 'light', 'neon', 'midnight', 'sunset', 'forest', 'ocean', 'cyberpunk', 'vintage'];
      
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
// 💾 MESSAGE BACKUP TO MONGODB (EVERY 5 SECONDS)
// ============================================
setInterval(async () => {
  if (!isMongoConnected) {
    return;
  }
  
  try {
    // Backup room messages from all rooms
    if (Message && memoryStore.rooms.size > 0) {
      for (const [roomName, room] of memoryStore.rooms.entries()) {
        if (room.messages && room.messages.length > 0) {
          for (const msg of room.messages) {
            try {
              // Check if message already exists (avoid duplicates)
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
              }
            } catch (err) {
              // Ignore individual message backup errors
            }
          }
        }
      }
    }
    
    // Backup private messages
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
        } catch (err) {
          // Ignore individual message backup errors
        }
      }
    }
    
    // Clear backed up messages to avoid duplicates
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
  console.log(`👑 Owner: ${OWNER_USERNAME}`);
  console.log(`📊 Rank System:`);
  console.log(`   1. 👑 Owner - Can see ALL private messages, Video enabled`);
  console.log(`   2. 👮 Admin - Can see messages from rank 2-5, Video enabled`);
  console.log(`   3. 🛡️ Moderator - Can see messages from rank 3-5, Video enabled`);
  console.log(`   4. ⭐ VIP - Can see only their own messages, Video enabled`);
  console.log(`   5. 👤 Member - Can see only their own messages, Video disabled`);
  console.log(`🎥 Video Chat: VIP+ only (Owner, Admin, Moderator, VIP)`);
  console.log(`👥 /users Command: Shows 🟢 in room, 🟡 online elsewhere, 🔴 offline`);
  console.log(`💾 MongoDB: ${isMongoConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
  console.log(`📁 Uploads: ${uploadDir}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log('\n' + '='.repeat(70) + '\n');
});

module.exports = { app, server, io };