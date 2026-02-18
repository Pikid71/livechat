# 🕳️ Black Hole Chat V2

A full-featured real-time chat application with private messaging, voice/video chat, file sharing, and advanced moderation tools.

## ✨ Features

- **💬 Real-time Chat** - Socket.IO powered instant messaging
- **📁 File Sharing** - Upload and share files with automatic optimization
- **🎥 Video & Voice** - WebRTC-based peer-to-peer communication (VIP+ only)
- **🔒 Private Messages** - Direct messaging with encryption support
- **👑 Rank System** - 5-level hierarchy (Owner, Admin, Moderator, VIP, Member)
- **🛡️ Admin Commands** - Ban, mute, clear messages, grant ranks
- **🎨 Effects** - Room-wide visual effects (glitch, matrix, neon, firework, etc.)
- **🤖 AI Integration** - OpenRouter powered AI assistant for chat
- **🖼️ Image Generation** - Stable Horde integration for async image generation
- **📊 Message Persistence** - MongoDB backup every 5 seconds
- **🔔 Web Notifications** - Real-time background notifications
- **🌍 Theme System** - Multiple built-in themes

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Real-time**: Socket.IO
- **Database**: MongoDB Atlas
- **File Upload**: Multer + Sharp (image optimization)
- **WebRTC**: Native browser WebRTC API
- **AI**: OpenRouter API
- **Image Generation**: Stable Horde API
- **Hosting**: Render.com (or similar Node hosting)

## 📋 Requirements

- Node.js >= 16.0.0
- MongoDB Atlas account (free tier available)
- OpenRouter API key (for AI features)
- Stable Horde API key (for image generation)
- Render.com account (for deployment)

## ⚙️ Environment Setup

1. **Copy `.env.example` to `.env`**
   ```bash
   cp .env.example .env
   ```

2. **Configure environment variables**
   ```
   # Server
   PORT=3000
   NODE_ENV=development
   
   # MongoDB
   MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname
   
   # Admin
   ADMIN_PASSWORD=your_secure_password
   OWNER_USERNAME=your_username
   
   # APIs
   OPENROUTER_API_KEY=your_openrouter_key
   STABLE_HORDE_API_KEY=your_stable_horde_key
   ```

## 🚀 Local Development

```bash
# Install dependencies
npm install

# Start development server (with auto-reload)
npm run dev

# Or start production server
npm start
```

Server will be available at `http://localhost:3000`

## 📦 Deployment (Render.com)

### Option 1: Automatic Deployment (Recommended)

The project includes `render.yaml` with full configuration. Simply connect your GitHub repository to Render.com and it will auto-deploy on every push to the main branch.

### Option 2: Manual Deployment

1. Create a new Web Service on Render.com
2. Connect your GitHub repository
3. Set environment variables from `render.yaml`
4. Set start command: `node server.js`
5. Create a disk mount at `/opt/render/project/uploads` (5GB)
6. Deploy!

### Environment Variables for Production

```yaml
NODE_ENV=production
MONGODB_URI=<your_production_mongo_uri>
ADMIN_PASSWORD=<strong_password>
OWNER_USERNAME=Pi_Kid71
OPENROUTER_API_KEY=<your_key>
STABLE_HORDE_API_KEY=<your_key>
PORT=10000 (Render assigns dynamically)
```

## 🔑 API Keys & Setup

### MongoDB Atlas
1. Create free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a cluster
3. Get connection string and add to `.env`

### OpenRouter (AI)
1. Sign up at [OpenRouter.ai](https://openrouter.ai)
2. Get API key from dashboard
3. Add to `OPENROUTER_API_KEY` in `.env`

### Stable Horde (Image Generation)
1. Sign up at [Stable Horde](https://stablehorde.net)
2. Get API key from account settings
3. Add to `STABLE_HORDE_API_KEY` in `.env`

## 📡 API Endpoints

### Health Check
- `GET /health` - Server health status

### Authentication & Chat
- `POST /login` - User login (Socket.IO based)
- `POST /register` - User registration (Socket.IO based)

### File Operations
- `POST /upload` - Upload file with optional size optimization
- `GET /uploads/:filename` - Download uploaded file

### Image Generation
- `POST /api/generate-image` - Start image generation job
- `GET /api/image-result/:id` - Poll image generation result

### WebRTC Signaling
- `voice_offer`, `voice_answer`, `ice_candidate` - Voice chat signaling
- `video_offer`, `video_answer`, `video_ice_candidate` - Video chat signaling

## 🎮 Commands

### User Commands
- `/help` - Show all available commands
- `/rank` - Check your current rank
- `/ping` - Test server latency
- `/users` - List online users
- `/ai <prompt>` - Ask AI assistant
- `/theme <name>` - Change theme
- `/video` - Toggle video chat

### Moderator+ Commands
- `/ban <user> [duration]` - Ban user (10m, 1h, 1d)
- `/unban <user>` - Unban user
- `/mute <user> [duration]` - Mute user
- `/unmute <user>` - Unmute user
- `/clear` - Clear all messages in room

### Admin+ Commands
- `/grant <user> <rank>` - Grant rank to user
- `/delete_room <name>` - Delete a room
- `/effect <name>` - Trigger room effect

## 📊 Database Schema

### Collections
- `users` - User accounts with ranks and themes
- `messages` - Chat messages (backed up every 5s)
- `private_messages` - Direct messages between users
- `rooms` - Chat rooms
- `bans` - Active/expired bans
- `sessions` - Active user sessions
- `files` - File upload metadata

## 🔐 Security Features

- ✅ Password hashing (prepared for bcrypt integration)
- ✅ Admin password authentication
- ✅ API key isolation (never exposed to client)
- ✅ CORS enabled with proper headers
- ✅ XSS protection via HTML escaping
- ✅ File upload validation
- ✅ Rate limiting (can be enhanced)

## 📈 Performance

- ✅ Message backup every 5 seconds (no data loss)
- ✅ Image optimization with Sharp
- ✅ Socket.IO with compression
- ✅ Database indexing on frequently queried fields
- ✅ In-memory store for fast access

## 🐛 Troubleshooting

### Connection Issues
- Check MongoDB connection string
- Verify IP whitelist in MongoDB Atlas
- Ensure Render environment variables are set

### File Upload Issues
- Check `/uploads` directory permissions
- Verify MAX_FILE_SIZE setting
- Ensure disk storage is available on Render

### Image Generation Fails
- Check Stable Horde API key is valid
- Verify API key has credits remaining
- Check network connectivity to provider

## 📝 License

Built with ❤️ by [Pikid71](https://github.com/Pikid71)

## 🤝 Support

For issues and feature requests, check the [GitHub repository](https://github.com/Pikid71/livechat)
