/**
 * Video Handler for Black Hole Chat V2
 * WebRTC Video Chat with TURN/STUN servers for reliable connectivity
 * Includes system messages for join/leave events and picture-in-picture support
 * Features rank-based permissions (VIP+ only) and video labels with user info
 */

class VideoChatHandler {
    constructor(socket, roomName, username, userRank = 'member', options = {}) {
        this.socket = socket;
        this.roomName = roomName;
        this.username = username;
        this.userRank = userRank;
        this.isVip = ['vip', 'moderator', 'admin', 'owner'].includes(userRank);
        this.isMuted = false;
        this.options = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            videoQuality: 'hd', // 'hd', 'sd', 'low'
            frameRate: 30,
            ...options
        };
        
        // WebRTC variables
        this.localStream = null;
        this.peerConnections = new Map(); // userId -> RTCPeerConnection
        this.isActive = false;
        this.isVideoEnabled = true;
        this.isAudioEnabled = true;
        this.videoElements = new Map(); // userId -> HTMLVideoElement
        this.videoContainers = new Map(); // userId -> HTMLDivElement
        this.videoLabels = new Map(); // userId -> HTMLElement (label container)
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.screenShareStream = null;
        this.isScreenSharing = false;
        
        // Statistics tracking for each peer
        this.peerStats = new Map(); // userId -> stats object
        
        // ICE Servers configuration with multiple fallbacks
        this.iceServers = {
            iceServers: [
                // Google STUN servers (most reliable)
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                
                // Additional STUN servers
                { urls: 'stun:stun.ekiga.net' },
                { urls: 'stun:stun.ideasip.com' },
                { urls: 'stun:stun.schlund.de' },
                { urls: 'stun:stun.stunprotocol.org:3478' },
                { urls: 'stun:stun.voiparound.com' },
                { urls: 'stun:stun.voipbuster.com' },
                
                // Free TURN servers (for users behind restrictive NATs)
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                
                // Backup TURN servers
                {
                    urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
                    username: 'webrtc',
                    credential: 'webrtc'
                },
                {
                    urls: 'turn:turn2.anyfirewall.com:3478',
                    username: 'webrtc',
                    credential: 'webrtc'
                }
            ],
            
            // ICE candidate gathering options
            iceCandidatePoolSize: 10,
            
            // Additional WebRTC options
            iceTransportPolicy: 'all',
            rtcpMuxPolicy: 'require',
            bundlePolicy: 'max-bundle'
        };
        
        // Video constraints based on quality setting
        this.videoConstraints = this.getVideoConstraints();
        
        // Bind methods to maintain 'this' context
        this.handleUserJoined = this.handleUserJoined.bind(this);
        this.handleUserLeft = this.handleUserLeft.bind(this);
        this.handleVideoOffer = this.handleVideoOffer.bind(this);
        this.handleVideoAnswer = this.handleVideoAnswer.bind(this);
        this.handleIceCandidate = this.handleIceCandidate.bind(this);
        this.handleVideoError = this.handleVideoError.bind(this);
        this.handleUserMuted = this.handleUserMuted.bind(this);
        this.handleUserBanned = this.handleUserBanned.bind(this);
    }
    
    /**
     * Check if user has permission to use video chat
     * @returns {boolean} Whether user can use video
     */
    hasPermission() {
        return this.isVip && !this.isMuted;
    }
    
    /**
     * Set muted status (called from server)
     * @param {boolean} muted - Whether user is muted
     */
    setMutedStatus(muted) {
        this.isMuted = muted;
        if (muted && this.isActive) {
            this.stop();
            this.showNotification('🔇 You have been muted - video chat disabled', 'error');
        }
    }
    
    /**
     * Handle user being muted
     * @param {Object} data - Mute data
     */
    handleUserMuted(data) {
        if (data.mutedUser === this.username) {
            this.setMutedStatus(true);
        }
    }
    
    /**
     * Handle user being banned
     * @param {Object} data - Ban data
     */
    handleUserBanned(data) {
        if (data.bannedUser === this.username && this.isActive) {
            this.stop();
            this.showNotification('⛔ You have been banned - video chat disabled', 'error');
        }
    }
    
    /**
     * Get video constraints based on quality setting
     * @returns {Object} Video constraints
     */
    getVideoConstraints() {
        switch(this.options.videoQuality) {
            case 'hd':
                return {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: this.options.frameRate, max: 60 }
                };
            case 'sd':
                return {
                    width: { ideal: 640, max: 854 },
                    height: { ideal: 480, max: 480 },
                    frameRate: { ideal: this.options.frameRate, max: 30 }
                };
            case 'low':
                return {
                    width: { ideal: 320, max: 426 },
                    height: { ideal: 240, max: 240 },
                    frameRate: { ideal: 15, max: 20 }
                };
            default:
                return {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 30, max: 60 }
                };
        }
    }
    
    /**
     * Initialize and start video chat
     * @returns {Promise<boolean>} Success status
     */
    async start() {
        // Check permissions first
        if (!this.hasPermission()) {
            const reason = !this.isVip ? 'VIP+ only' : 'You are muted';
            this.showNotification(`❌ Video chat unavailable: ${reason}`, 'error');
            return false;
        }
        
        try {
            console.log('🎥 Starting video chat...');
            
            // Request camera and microphone access with optimal settings
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: this.options.echoCancellation,
                    noiseSuppression: this.options.noiseSuppression,
                    autoGainControl: this.options.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                }, 
                video: this.videoConstraints
            });
            
            console.log('✅ Camera and microphone access granted');
            this.isActive = true;
            
            // Join video room - this will trigger system message from server
            this.socket.emit('join_video', { 
                roomName: this.roomName,
                username: this.username,
                rank: this.userRank
            });
            
            // Set up socket listeners
            this.setupSocketListeners();
            
            // Update UI
            this.updateUIVideoStatus(true);
            
            // Start monitoring connection quality
            this.startConnectionMonitoring();
            
            // Show local notification
            this.showNotification('🎥 Joined video chat', 'success');
            
            return true;
            
        } catch (err) {
            console.error('❌ Video chat start error:', err);
            this.handleError(err);
            return false;
        }
    }
    
    /**
     * Stop video chat and clean up
     */
    stop() {
        console.log('🎥 Stopping video chat...');
        
        // Stop screen sharing if active
        if (this.isScreenSharing) {
            this.stopScreenShare();
        }
        
        // Stop all local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log(`🛑 Track stopped: ${track.kind}`);
            });
            this.localStream = null;
        }
        
        // Close all peer connections
        this.peerConnections.forEach((pc, userId) => {
            this.closePeerConnection(userId);
        });
        this.peerConnections.clear();
        
        // Remove all video elements and labels
        this.videoElements.forEach((video, userId) => {
            video.pause();
            video.srcObject = null;
        });
        this.videoElements.clear();
        
        this.videoContainers.forEach((container, userId) => {
            container.remove();
        });
        this.videoContainers.clear();
        
        this.videoLabels.clear();
        
        // Leave video room - this will trigger system message from server
        this.socket.emit('leave_video', { 
            roomName: this.roomName,
            username: this.username 
        });
        
        // Remove socket listeners
        this.removeSocketListeners();
        
        this.isActive = false;
        
        // Update UI
        this.updateUIVideoStatus(false);
        
        // Show local notification
        this.showNotification('🎥 Left video chat', 'info');
        
        console.log('✅ Video chat stopped');
    }
    
    /**
     * Set up socket event listeners for video signaling
     */
    setupSocketListeners() {
        this.socket.on('user_joined_video', this.handleUserJoined);
        this.socket.on('user_left_video', this.handleUserLeft);
        this.socket.on('video_offer', this.handleVideoOffer);
        this.socket.on('video_answer', this.handleVideoAnswer);
        this.socket.on('video_ice_candidate', this.handleIceCandidate);
        this.socket.on('video_error', this.handleVideoError);
        this.socket.on('user_muted', this.handleUserMuted);
        this.socket.on('user_banned', this.handleUserBanned);
    }
    
    /**
     * Remove socket listeners
     */
    removeSocketListeners() {
        this.socket.off('user_joined_video', this.handleUserJoined);
        this.socket.off('user_left_video', this.handleUserLeft);
        this.socket.off('video_offer', this.handleVideoOffer);
        this.socket.off('video_answer', this.handleVideoAnswer);
        this.socket.off('video_ice_candidate', this.handleIceCandidate);
        this.socket.off('video_error', this.handleVideoError);
        this.socket.off('user_muted', this.handleUserMuted);
        this.socket.off('user_banned', this.handleUserBanned);
    }
    
    /**
     * Create video label with user info and stats
     * @param {string} userId - User ID
     * @param {string} username - Username
     * @param {string} rank - User rank
     * @returns {HTMLElement} Label element
     */
    createVideoLabel(userId, username, rank = 'member') {
        const label = document.createElement('div');
        label.className = 'video-label';
        label.setAttribute('data-user', userId);
        label.style.cssText = `
            position: absolute;
            top: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 10;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            pointer-events: none;
            display: flex;
            flex-direction: column;
            gap: 2px;
        `;
        
        // Get rank badge color
        const rankColors = {
            owner: '#FFD700',
            admin: '#ff4444',
            moderator: '#ff9933',
            vip: '#9933ff',
            member: '#667eea'
        };
        const rankColor = rankColors[rank] || '#667eea';
        
        label.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="color: ${rankColor};">${this.getRankIcon(rank)}</span>
                <span style="color: white;">${username}</span>
                <span style="background: ${rankColor}; padding: 2px 6px; border-radius: 12px; font-size: 8px; text-transform: uppercase;">${rank}</span>
            </div>
            <div class="video-stats" id="stats-${userId}" style="display: flex; gap: 8px; font-size: 10px; color: #aaa;">
                <span>📊 FPS: <span class="fps-value">0</span></span>
                <span>🎥 Quality: <span class="quality-value">${this.options.videoQuality}</span></span>
                <span>📶 <span class="connection-quality">●</span></span>
            </div>
        `;
        
        return label;
    }
    
    /**
     * Get rank icon
     * @param {string} rank - User rank
     * @returns {string} Rank icon
     */
    getRankIcon(rank) {
        const icons = {
            owner: '👑',
            admin: '👮',
            moderator: '🛡️',
            vip: '⭐',
            member: '👤'
        };
        return icons[rank] || '👤';
    }
    
    /**
     * Update video stats label
     * @param {string} userId - User ID
     * @param {Object} stats - Stats object
     */
    updateVideoStats(userId, stats) {
        const label = this.videoLabels.get(userId);
        if (!label) return;
        
        const fpsElement = label.querySelector('.fps-value');
        const qualityElement = label.querySelector('.quality-value');
        const connectionElement = label.querySelector('.connection-quality');
        
        if (fpsElement) {
            fpsElement.textContent = Math.round(stats.frameRate || 0);
        }
        
        if (qualityElement) {
            qualityElement.textContent = stats.quality || this.options.videoQuality;
        }
        
        if (connectionElement) {
            // Color code connection quality
            if (stats.packetsLost > 200 || stats.jitter > 0.15) {
                connectionElement.style.color = '#ff4444';
                connectionElement.textContent = '● Poor';
            } else if (stats.packetsLost > 100 || stats.jitter > 0.1) {
                connectionElement.style.color = '#ffaa00';
                connectionElement.textContent = '● Fair';
            } else if (stats.packetsLost > 50 || stats.jitter > 0.05) {
                connectionElement.style.color = '#4ade80';
                connectionElement.textContent = '● Good';
            } else {
                connectionElement.style.color = '#4ade80';
                connectionElement.textContent = '● Excellent';
            }
        }
    }
    
    /**
     * Handle new user joining video chat
     * @param {Object} data - User joined data
     */
    async handleUserJoined(data) {
        console.log(`👤 User joined video: ${data.username || data.userId} (Rank: ${data.rank || 'member'})`);
        
        if (!this.isActive) return;
        
        // Don't create connection to self
        if (data.userId === this.socket.id) return;
        
        // Check if connection already exists
        if (this.peerConnections.has(data.userId)) {
            console.log(`Connection already exists for ${data.userId}`);
            return;
        }
        
        try {
            await this.createPeerConnection(data.userId, true, data.username, data.rank);
            // Show notification for new user (system message is handled by server)
            this.showNotification(`🎥 ${data.username} joined video`, 'info');
        } catch (err) {
            console.error(`Failed to create connection to ${data.userId}:`, err);
        }
    }
    
    /**
     * Handle user leaving video chat
     * @param {Object} data - User left data
     */
    handleUserLeft(data) {
        console.log(`👋 User left video: ${data.userId}`);
        
        // Get username before closing connection
        const username = data.username || 'A user';
        
        this.closePeerConnection(data.userId);
        
        // Show notification for user leaving (system message is handled by server)
        this.showNotification(`🎥 ${username} left video`, 'info');
    }
    
    /**
     * Handle incoming video offer
     * @param {Object} data - Offer data
     */
    async handleVideoOffer(data) {
        console.log(`📞 Received video offer from ${data.from}`);
        
        if (!this.isActive) return;
        
        try {
            const pc = await this.createPeerConnection(data.from, false, data.username, data.rank);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.socket.emit('video_answer', {
                target: data.from,
                answer: answer
            });
            
            console.log(`✅ Sent answer to ${data.from}`);
            
        } catch (err) {
            console.error('Error handling video offer:', err);
        }
    }
    
    /**
     * Handle incoming video answer
     * @param {Object} data - Answer data
     */
    async handleVideoAnswer(data) {
        console.log(`📞 Received video answer from ${data.from}`);
        
        const pc = this.peerConnections.get(data.from);
        if (!pc) {
            console.warn(`No peer connection for ${data.from}`);
            return;
        }
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log(`✅ Set remote description for ${data.from}`);
        } catch (err) {
            console.error('Error handling video answer:', err);
        }
    }
    
    /**
     * Handle incoming ICE candidate
     * @param {Object} data - ICE candidate data
     */
    async handleIceCandidate(data) {
        const pc = this.peerConnections.get(data.from);
        if (!pc) return;
        
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('Error adding ICE candidate:', err);
        }
    }
    
    /**
     * Handle video error
     * @param {Object} data - Error data
     */
    handleVideoError(data) {
        console.error('Video error:', data.message);
        this.showNotification(`❌ Video error: ${data.message}`, 'error');
    }
    
    /**
     * Create a new peer connection
     * @param {string} userId - Target user ID
     * @param {boolean} initiator - Whether this connection is the initiator
     * @param {string} username - Target username
     * @param {string} rank - Target user rank
     * @returns {RTCPeerConnection} The created peer connection
     */
    async createPeerConnection(userId, initiator = false, username = 'Unknown', rank = 'member') {
        console.log(`🔌 Creating peer connection to ${userId} (initiator: ${initiator})`);
        
        const pc = new RTCPeerConnection(this.iceServers);
        this.peerConnections.set(userId, pc);
        
        // Initialize stats for this peer
        this.peerStats.set(userId, {
            frameRate: 0,
            quality: this.options.videoQuality,
            packetsLost: 0,
            jitter: 0,
            username: username,
            rank: rank
        });
        
        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
                console.log(`➕ Added ${track.kind} track to connection`);
            });
        }
        
        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('video_ice_candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };
        
        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log(`Connection state to ${userId}: ${pc.connectionState}`);
            
            switch(pc.connectionState) {
                case 'connected':
                case 'completed':
                    this.showNotification(`✅ Video connected to ${username}`, 'success');
                    break;
                case 'disconnected':
                case 'failed':
                    console.warn(`Connection to ${userId} ${pc.connectionState}`);
                    if (this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++;
                        setTimeout(() => {
                            if (initiator && this.isActive) {
                                this.createPeerConnection(userId, true, username, rank);
                            }
                        }, 2000);
                    }
                    break;
                case 'closed':
                    console.log(`Connection to ${userId} closed`);
                    break;
            }
        };
        
        // Handle ICE gathering state
        pc.onicegatheringstatechange = () => {
            console.log(`ICE gathering state to ${userId}: ${pc.iceGatheringState}`);
        };
        
        // Handle signaling state
        pc.onsignalingstatechange = () => {
            console.log(`Signaling state to ${userId}: ${pc.signalingState}`);
        };
        
        // Handle incoming tracks
        pc.ontrack = (event) => {
            console.log(`📻 Received track from ${userId}: ${event.track.kind}`);
            
            // Create video container
            const container = document.createElement('div');
            container.className = 'video-container';
            container.style.cssText = `
                position: relative;
                width: 100%;
                height: auto;
                background: #1a1a2e;
                border-radius: 12px;
                overflow: hidden;
                border: 2px solid #667eea;
                aspect-ratio: 16/9;
            `;
            
            // Create video element
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.controls = false;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.display = 'block';
            video.style.objectFit = 'cover';
            video.setAttribute('data-user', userId);
            
            // Create video label
            const label = this.createVideoLabel(userId, username, rank);
            this.videoLabels.set(userId, label);
            
            // Add PiP button overlay
            const pipButton = document.createElement('button');
            pipButton.className = 'video-control-btn';
            pipButton.innerHTML = '📺';
            pipButton.style.cssText = `
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(0, 0, 0, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: white;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
                z-index: 10;
                pointer-events: auto;
            `;
            pipButton.onclick = (e) => {
                e.stopPropagation();
                this.togglePictureInPicture(userId);
            };
            pipButton.onmouseenter = () => {
                pipButton.style.background = '#667eea';
                pipButton.style.transform = 'scale(1.1)';
            };
            pipButton.onmouseleave = () => {
                pipButton.style.background = 'rgba(0, 0, 0, 0.6)';
                pipButton.style.transform = 'scale(1)';
            };
            
            // Add to container
            container.appendChild(video);
            container.appendChild(label);
            container.appendChild(pipButton);
            
            // Add to video grid
            const videoGrid = document.getElementById('video-grid');
            if (videoGrid) {
                videoGrid.appendChild(container);
            }
            
            this.videoElements.set(userId, video);
            this.videoContainers.set(userId, container);
            
            // Handle multiple streams (for screen share)
            if (event.streams && event.streams[0]) {
                video.srcObject = event.streams[0];
            }
            
            // Handle track events
            event.track.onended = () => {
                console.log(`Track from ${userId} ended`);
                if (video && video.srcObject) {
                    video.srcObject = null;
                }
                container.remove();
                this.videoElements.delete(userId);
                this.videoContainers.delete(userId);
                this.videoLabels.delete(userId);
            };
            
            event.track.onmute = () => {
                console.log(`Track from ${userId} muted`);
                label.style.opacity = '0.5';
            };
            
            event.track.onunmute = () => {
                console.log(`Track from ${userId} unmuted`);
                label.style.opacity = '1';
            };
        };
        
        // If initiator, create and send offer
        if (initiator) {
            try {
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                    iceRestart: true
                });
                
                await pc.setLocalDescription(offer);
                
                this.socket.emit('video_offer', {
                    target: userId,
                    offer: offer,
                    roomName: this.roomName,
                    username: this.username,
                    rank: this.userRank
                });
                
                console.log(`📤 Sent offer to ${userId}`);
                
            } catch (err) {
                console.error('Error creating offer:', err);
            }
        }
        
        return pc;
    }
    
    /**
     * Close a specific peer connection
     * @param {string} userId - User ID to close connection to
     */
    closePeerConnection(userId) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(userId);
            console.log(`🔌 Closed connection to ${userId}`);
        }
        
        // Remove video container
        const container = this.videoContainers.get(userId);
        if (container) {
            container.remove();
        }
        
        this.videoElements.delete(userId);
        this.videoContainers.delete(userId);
        this.videoLabels.delete(userId);
        this.peerStats.delete(userId);
    }
    
    /**
     * Toggle video on/off
     * @param {boolean} enabled - Whether video should be enabled
     */
    toggleVideo(enabled) {
        if (!this.hasPermission()) return;
        
        if (this.localStream) {
            const videoTracks = this.localStream.getVideoTracks();
            videoTracks.forEach(track => {
                track.enabled = enabled;
            });
            this.isVideoEnabled = enabled;
            console.log(`🎥 Video ${enabled ? 'enabled' : 'disabled'}`);
            this.showNotification(`🎥 Video ${enabled ? 'enabled' : 'disabled'}`);
        }
    }
    
    /**
     * Toggle audio on/off
     * @param {boolean} enabled - Whether audio should be enabled
     */
    toggleAudio(enabled) {
        if (!this.hasPermission()) return;
        
        if (this.localStream) {
            const audioTracks = this.localStream.getAudioTracks();
            audioTracks.forEach(track => {
                track.enabled = enabled;
            });
            this.isAudioEnabled = enabled;
            console.log(`🎤 Audio ${enabled ? 'enabled' : 'disabled'}`);
            this.showNotification(`🎤 Audio ${enabled ? 'enabled' : 'disabled'}`);
        }
    }
    
    /**
     * Start screen sharing
     * @returns {Promise<boolean>} Success status
     */
    async startScreenShare() {
        if (!this.hasPermission()) return false;
        
        try {
            if (this.isScreenSharing) {
                return false;
            }
            
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                },
                audio: false
            });
            
            this.screenShareStream = screenStream;
            this.isScreenSharing = true;
            
            // Replace video track with screen share track
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // Update all peer connections
            this.peerConnections.forEach((pc) => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });
            
            // Handle when user stops screen sharing
            videoTrack.onended = () => {
                this.stopScreenShare();
            };
            
            this.showNotification('🖥️ Screen sharing started', 'success');
            return true;
            
        } catch (err) {
            console.error('Screen share error:', err);
            this.showNotification('❌ Failed to start screen share', 'error');
            return false;
        }
    }
    
    /**
     * Stop screen sharing
     */
    async stopScreenShare() {
        if (!this.isScreenSharing) return;
        
        if (this.screenShareStream) {
            this.screenShareStream.getTracks().forEach(track => track.stop());
            this.screenShareStream = null;
        }
        
        this.isScreenSharing = false;
        
        // Restore camera video track
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            
            // Update all peer connections
            this.peerConnections.forEach((pc) => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender && videoTrack) {
                    sender.replaceTrack(videoTrack);
                }
            });
        }
        
        this.showNotification('🖥️ Screen sharing stopped', 'info');
    }
    
    /**
     * Toggle picture-in-picture mode for a video
     * @param {string} userId - User ID to show in PiP
     */
    async togglePictureInPicture(userId) {
        try {
            const video = this.videoElements.get(userId);
            if (!video) return;
            
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                this.showNotification('📺 Exited picture-in-picture', 'info');
            } else {
                await video.requestPictureInPicture();
                this.showNotification('📺 Entered picture-in-picture', 'success');
            }
        } catch (err) {
            console.error('Picture-in-picture error:', err);
            this.showNotification('❌ Picture-in-picture failed', 'error');
        }
    }
    
    /**
     * Set video quality
     * @param {string} quality - 'hd', 'sd', or 'low'
     */
    async setVideoQuality(quality) {
        if (!this.localStream || !this.hasPermission()) return;
        
        this.options.videoQuality = quality;
        this.videoConstraints = this.getVideoConstraints();
        
        // Restart video track with new constraints
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: this.videoConstraints,
                    audio: false
                });
                
                const newVideoTrack = newStream.getVideoTracks()[0];
                
                // Replace track in all peer connections
                this.peerConnections.forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(newVideoTrack);
                    }
                });
                
                // Replace track in local stream
                this.localStream.removeTrack(videoTrack);
                this.localStream.addTrack(newVideoTrack);
                videoTrack.stop();
                
                // Update quality in stats
                this.peerStats.forEach(stats => {
                    stats.quality = quality;
                });
                
                this.showNotification(`🎥 Video quality set to ${quality}`, 'success');
                
            } catch (err) {
                console.error('Error changing video quality:', err);
                this.showNotification('❌ Failed to change video quality', 'error');
            }
        }
    }
    
    /**
     * Get video chat statistics
     * @returns {Object} Video stats
     */
    async getStats() {
        const stats = {
            active: this.isActive,
            peers: this.peerConnections.size,
            localTracks: this.localStream ? this.localStream.getTracks().length : 0,
            remoteTracks: this.videoElements.size,
            isVideoEnabled: this.isVideoEnabled,
            isAudioEnabled: this.isAudioEnabled,
            isScreenSharing: this.isScreenSharing,
            videoQuality: this.options.videoQuality,
            hasPermission: this.hasPermission(),
            userRank: this.userRank,
            ...this.stats
        };
        
        // Get detailed stats from all peer connections
        let peerIndex = 0;
        for (const [userId, pc] of this.peerConnections) {
            try {
                const pcStats = await pc.getStats();
                const peerStat = this.peerStats.get(userId) || {};
                
                pcStats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        peerStat.bytesReceived = report.bytesReceived;
                        peerStat.packetsLost = report.packetsLost;
                        peerStat.jitter = report.jitter;
                        peerStat.frameRate = report.framesPerSecond;
                        peerStat.videoWidth = report.frameWidth;
                        peerStat.videoHeight = report.frameHeight;
                        
                        // Update video label
                        this.updateVideoStats(userId, peerStat);
                    }
                    if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        stats.bytesSent = (stats.bytesSent || 0) + report.bytesSent;
                    }
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && peerIndex === 0) {
                        stats.rtt = report.currentRoundTripTime;
                    }
                });
                
                this.peerStats.set(userId, peerStat);
                peerIndex++;
                
            } catch (err) {
                console.error(`Error getting stats for ${userId}:`, err);
            }
        }
        
        return stats;
    }
    
    /**
     * Start monitoring connection quality
     */
    startConnectionMonitoring() {
        this.monitoringInterval = setInterval(async () => {
            if (!this.isActive) return;
            
            const stats = await this.getStats();
            
            // Check for poor connection and auto-adjust
            let totalPacketsLost = 0;
            this.peerStats.forEach(stat => {
                totalPacketsLost += stat.packetsLost || 0;
            });
            
            const avgPacketsLost = this.peerStats.size > 0 ? totalPacketsLost / this.peerStats.size : 0;
            
            if (avgPacketsLost > 300 && this.options.videoQuality !== 'low') {
                console.warn('⚠️ Poor video connection - reducing to low quality');
                this.setVideoQuality('low');
                this.showNotification('⚠️ Reducing video quality due to poor connection', 'warning');
            } else if (avgPacketsLost > 200 && this.options.videoQuality !== 'sd') {
                console.warn('⚠️ Fair video connection - reducing to SD quality');
                this.setVideoQuality('sd');
                this.showNotification('⚠️ Reducing video quality to maintain stability', 'warning');
            }
            
            // Emit stats for debugging
            this.socket.emit('video_stats', stats);
            
        }, 5000);
    }
    
    /**
     * Handle errors
     * @param {Error} err - Error object
     */
    handleError(err) {
        let message = 'Video chat error';
        
        if (!this.hasPermission()) {
            message = 'Video chat requires VIP+ rank and not being muted';
        } else if (err.name === 'NotAllowedError') {
            message = 'Camera/microphone access denied. Please allow access.';
        } else if (err.name === 'NotFoundError') {
            message = 'No camera or microphone found. Please connect a camera.';
        } else if (err.name === 'NotReadableError') {
            message = 'Camera/microphone is busy. Please check other applications.';
        } else if (err.name === 'OverconstrainedError') {
            message = 'Camera does not meet requirements. Trying lower quality...';
            // Try with lower quality
            this.options.videoQuality = 'sd';
            this.videoConstraints = this.getVideoConstraints();
        } else if (err.message) {
            message = err.message;
        }
        
        this.showNotification(`❌ ${message}`, 'error');
        
        // Emit error
        this.socket.emit('video_error', {
            message: message,
            code: err.name
        });
    }
    
    /**
     * Show notification
     * @param {string} message - Message to show
     * @param {string} type - Notification type (info, success, warning, error)
     */
    showNotification(message, type = 'info') {
        // Dispatch custom event for UI
        const event = new CustomEvent('videoNotification', {
            detail: { message, type }
        });
        window.dispatchEvent(event);
        
        // Also try to use toast if available
        if (window.showToast) {
            window.showToast(message);
        }
    }
    
    /**
     * Update UI based on video status
     * @param {boolean} active - Whether video is active
     */
    updateUIVideoStatus(active) {
        const videoIndicator = document.getElementById('video-indicator');
        const videoBtn = document.getElementById('videoBtn');
        const videoBtnText = document.getElementById('videoBtnText');
        const videoGrid = document.getElementById('video-grid');
        const videoControls = document.getElementById('video-controls');
        
        if (videoIndicator) {
            videoIndicator.style.display = active ? 'flex' : 'none';
        }
        
        if (videoBtn) {
            if (active) {
                videoBtn.classList.add('danger');
                videoBtnText.textContent = 'LEAVE VIDEO';
            } else {
                videoBtn.classList.remove('danger');
                videoBtnText.textContent = 'JOIN VIDEO';
            }
        }
        
        if (videoGrid) {
            videoGrid.style.display = active ? 'grid' : 'none';
        }
        
        if (videoControls) {
            videoControls.style.display = active && this.hasPermission() ? 'flex' : 'none';
        }
        
        // Dispatch event
        const event = new CustomEvent('videoStatusChange', {
            detail: { 
                active, 
                peerCount: this.peerConnections.size,
                hasPermission: this.hasPermission(),
                userRank: this.userRank
            }
        });
        window.dispatchEvent(event);
    }
    
    /**
     * Get list of connected users
     * @returns {Array} List of user IDs with info
     */
    getConnectedUsers() {
        const users = [];
        this.peerStats.forEach((stats, userId) => {
            users.push({
                userId,
                username: stats.username,
                rank: stats.rank,
                quality: stats.quality,
                frameRate: stats.frameRate
            });
        });
        return users;
    }
    
    /**
     * Check if video is active
     * @returns {boolean} Active status
     */
    isVideoActive() {
        return this.isActive;
    }
    
    /**
     * Take a snapshot from a user's video
     * @param {string} userId - User ID to snapshot
     * @returns {Promise<string>} Data URL of snapshot
     */
    async takeSnapshot(userId) {
        const video = this.videoElements.get(userId);
        if (!video) return null;
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        return canvas.toDataURL('image/png');
    }
    
    /**
     * Destroy the video handler and clean up
     */
    destroy() {
        this.stop();
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        this.socket = null;
        this.roomName = null;
        this.username = null;
        
        console.log('🗑️ Video handler destroyed');
    }
}

// ========== EXPORT FOR USE IN HTML ==========
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoChatHandler;
} else {
    window.VideoChatHandler = VideoChatHandler;
}