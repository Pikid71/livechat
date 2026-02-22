# 🕳️ Black Hole Chat V2

💡 **New features:** email verification codes are now sent to the user's address and include a clickable button/link for one‑click verification using `/verify`.


A full-featured real-time chat application with private messaging, voice/video chat, file sharing, and advanced moderation tools.

## ✨ Features

- **💬 Real-time Chat** - Socket.IO powered instant messaging
- **📁 File Sharing** - Upload and share files with automatic optimization
- **🎥 Video & Voice** - WebRTC-based peer-to-peer communication (VIP+ only)
- **🔒 Private Messages** - Direct messaging with encryption support
  - Owner can view all private messages
  - Admins can view all except any involving the Owner
  - Other users only see their own sent/received messages
- **👑 Rank System** - 5-level hierarchy (Owner, Admin, Moderator, VIP, Member)
- **🛡️ Admin Commands** - Ban, mute, clear messages (clears both public and private), grant ranks
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
- **Hosting**: Render.com

## 📋 Requirements

- Node.js >= 16.0.0
- MongoDB Atlas account (free tier available)
- OpenRouter API key (for AI features)
- Stable Horde API key (for image generation)
- Render.com account (for deployment)

## ⚙️ Environment Setup

In addition to the existing variables below you can configure SMTP or EmailJS settings to enable outgoing mail for verification codes (optional but recommended):

**SMTP (nodemailer) settings**
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587        # 465 for SSL
SMTP_SECURE=false    # true if using port 465 or SSL
SMTP_USER=you@example.com
SMTP_PASS=your_smtp_password
EMAIL_FROM="Chat <no-reply@example.com>"  # defaults to OWNER_EMAIL
```

**EmailJS settings** (preferred when using the EmailJS service)
```
EMAILJS_SERVICE_ID=blackchat_conformation   # service ID from EmailJS
EMAILJS_TEMPLATE_ID=template_verification   # optional, defaults as shown
EMAILJS_USER_ID=your_public_key            # public key found in EmailJS dashboard
# (alternatively set EMAILJS_PUBLIC_KEY)
```

`SITE_URL` is still honored when building the clickable verify link:
```
SITE_URL=https://your.chat.domain
```


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
- `GET /verify?email=<email>&code=<code>` - link endpoint used by the verification email button

### Authentication & Chat
- `POST /login` - User login (Socket.IO based)
- `POST /register` - User registration (Socket.IO based, sends verification email)

Socket events related to registration:
  - `request_verification` - client asks server to generate code and send email
  - `verification_sent` - server emits once the email was successfully queued (client waits up to 10 s for this event before showing a timeout error)
  - `verification_error` - server emits if sending email failed (you can retry)

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
- `/ban <user> [duration]` - Ban user (10m, 1h, 1d); device is also banned
- `/unban <user>` - Unban user (admin/owner only); clears device ban
- `/mute <user> [duration]` - Mute user; device is also muted
- `/unmute <user>` - Unmute user (mods can unmute)
- `/clear` - Clear all messages in room

> 🔒 **Device bans/mutes** apply to the entire device (based on a generated ID stored in `localStorage`).
> Banned or muted users cannot login with any account on that device.
### Admin+ Commands
- `/grant <user> <rank>` - Grant rank to user (admins can assign mod/vip/member; owner can also grant admin)
- `/delete_room <name>` - Delete a room
- `/effect <name>` - Trigger room effect (now available to VIP+ users)

## 📊 Database Schema

### Collections
- `users` - User accounts with ranks and themes
- `messages` - Chat messages (backed up every 5s)

### Render deployment notes

- The service is already configured with a `render.yaml` in the repository.
- **UPLOAD_DIR** environment variable is honoured by the server. Render mounts
  a disk to `/opt/render/project/uploads` and `render.yaml` sets
  `UPLOAD_DIR=/opt/render/project/uploads` so that user uploads persist across
  deploys. If you run locally, the code falls back to `./uploads`.
- The server respects `process.env.PORT` (default 3000) and exposes `/health`
  for the Render health check path.

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
