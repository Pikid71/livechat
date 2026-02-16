/**
 * Video Handler for Black Hole Chat V2
 * WebRTC Video Chat with TURN/STUN servers for reliable connectivity
 * Fixed to ensure only one display per person
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
            videoQuality: 'hd',
            frameRate: 30,
            ...options
        };
        
        this.localStream = null;
        this.peerConnections = new Map();
        this.isActive = false;
        this.isVideoEnabled = true;
        this.isAudioEnabled = true;
        this.videoElements = new Map();
        this.videoContainers = new Map();
        this.videoLabels = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.screenShareStream = null;
        this.isScreenSharing = false;
        this.peerStats = new Map();
        
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        };
        
        this.videoConstraints = this.getVideoConstraints();
        
        this.handleUserJoined = this.handleUserJoined.bind(this);
        this.handleUserLeft = this.handleUserLeft.bind(this);
        this.handleVideoOffer = this.handleVideoOffer.bind(this);
        this.handleVideoAnswer = this.handleVideoAnswer.bind(this);
        this.handleIceCandidate = this.handleIceCandidate.bind(this);
        this.handleVideoError = this.handleVideoError.bind(this);
        this.handleUserMuted = this.handleUserMuted.bind(this);
        this.handleUserBanned = this.handleUserBanned.bind(this);
    }
    
    hasPermission() {
        return this.isVip && !this.isMuted;
    }
    
    setMutedStatus(muted) {
        this.isMuted = muted;
        if (muted && this.isActive) {
            this.stop();
            this.showNotification('🔇 You have been muted - video chat disabled');
        }
    }
    
    handleUserMuted(data) {
        if (data.mutedUser === this.username) {
            this.setMutedStatus(true);
        }
    }
    
    handleUserBanned(data) {
        if (data.bannedUser === this.username && this.isActive) {
            this.stop();
            this.showNotification('⛔ You have been banned - video chat disabled');
        }
    }
    
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
    
    async start() {
        if (!this.hasPermission()) {
            const reason = !this.isVip ? 'VIP+ only' : 'You are muted';
            this.showNotification(`❌ Video chat unavailable: ${reason}`);
            return false;
        }
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }, 
                video: this.videoConstraints
            });
            
            this.isActive = true;
            
            this.socket.emit('join_video', { 
                roomName: this.roomName,
                username: this.username,
                rank: this.userRank
            });
            
            this.setupSocketListeners();
            this.updateUIVideoStatus(true);
            this.startConnectionMonitoring();
            this.showNotification('🎥 Joined video chat');
            return true;
            
        } catch (err) {
            console.error('Video chat error:', err);
            this.handleError(err);
            return false;
        }
    }
    
    stop() {
        if (this.isScreenSharing) this.stopScreenShare();
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        this.peerConnections.forEach((pc, userId) => this.closePeerConnection(userId));
        this.peerConnections.clear();
        
        this.videoElements.forEach(video => {
            video.pause();
            video.srcObject = null;
        });
        this.videoElements.clear();
        
        this.videoContainers.forEach(container => container.remove());
        this.videoContainers.clear();
        this.videoLabels.clear();
        
        this.socket.emit('leave_video', { 
            roomName: this.roomName,
            username: this.username 
        });
        
        this.removeSocketListeners();
        this.isActive = false;
        this.updateUIVideoStatus(false);
        this.showNotification('🎥 Left video chat');
    }
    
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
    
    createVideoLabel(userId, username, rank = 'member') {
        const label = document.createElement('div');
        label.className = 'video-label';
        label.setAttribute('data-user', userId);
        
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
            <div class="video-stats" style="display: flex; gap: 8px; font-size: 10px; color: #aaa;">
                <span>📊 FPS: <span class="fps-value">0</span></span>
                <span>🎥 Quality: <span class="quality-value">${this.options.videoQuality}</span></span>
                <span>📶 <span class="connection-quality">●</span></span>
            </div>
        `;
        
        return label;
    }
    
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
    
    updateVideoStats(userId, stats) {
        const label = this.videoLabels.get(userId);
        if (!label) return;
        
        const fpsElement = label.querySelector('.fps-value');
        const qualityElement = label.querySelector('.quality-value');
        const connectionElement = label.querySelector('.connection-quality');
        
        if (fpsElement) fpsElement.textContent = Math.round(stats.frameRate || 0);
        if (qualityElement) qualityElement.textContent = stats.quality || this.options.videoQuality;
        
        if (connectionElement) {
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
    
    async handleUserJoined(data) {
        if (!this.isActive || data.userId === this.socket.id) return;
        
        // FIXED: Check if we already have a connection for this user
        if (this.peerConnections.has(data.userId)) {
            console.log(`Already connected to ${data.userId}, skipping duplicate`);
            return;
        }
        
        try {
            await this.createPeerConnection(data.userId, true, data.username, data.rank);
            this.showNotification(`🎥 ${data.username} joined video`);
        } catch (err) {
            console.error(`Failed to create connection to ${data.userId}:`, err);
        }
    }
    
    handleUserLeft(data) {
        this.closePeerConnection(data.userId);
        this.showNotification(`🎥 ${data.username || 'A user'} left video`);
    }
    
    async handleVideoOffer(data) {
        if (!this.isActive) return;
        
        // FIXED: Check if we already have a connection for this user
        if (this.peerConnections.has(data.from)) {
            console.log(`Already have connection for ${data.from}, ignoring duplicate offer`);
            return;
        }
        
        try {
            const pc = await this.createPeerConnection(data.from, false, data.username, data.rank);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.socket.emit('video_answer', {
                target: data.from,
                answer: answer
            });
            
        } catch (err) {
            console.error('Error handling video offer:', err);
        }
    }
    
    async handleVideoAnswer(data) {
        const pc = this.peerConnections.get(data.from);
        if (!pc) return;
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (err) {
            console.error('Error handling video answer:', err);
        }
    }
    
    async handleIceCandidate(data) {
        const pc = this.peerConnections.get(data.from);
        if (!pc) return;
        
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('Error adding ICE candidate:', err);
        }
    }
    
    handleVideoError(data) {
        console.error('Video error:', data.message);
        this.showNotification(`❌ Video error: ${data.message}`);
    }
    
    async createPeerConnection(userId, initiator = false, username = 'Unknown', rank = 'member') {
        // FIXED: Extra check before creating connection
        if (this.peerConnections.has(userId)) {
            console.log(`Connection for ${userId} already exists, returning existing`);
            return this.peerConnections.get(userId);
        }
        
        const pc = new RTCPeerConnection(this.iceServers);
        this.peerConnections.set(userId, pc);
        
        this.peerStats.set(userId, {
            frameRate: 0,
            quality: this.options.videoQuality,
            packetsLost: 0,
            jitter: 0,
            username: username,
            rank: rank
        });
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        }
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('video_ice_candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };
        
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                this.showNotification(`✅ Video connected to ${username}`);
            }
        };
        
        pc.ontrack = (event) => {
            // FIXED: Check if we already have a container for this user
            if (this.videoContainers.has(userId)) {
                console.log(`Already have video container for ${userId}, skipping duplicate`);
                return;
            }
            
            const container = document.createElement('div');
            container.className = 'video-container';
            
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.controls = false;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.setAttribute('data-user', userId);
            
            const label = this.createVideoLabel(userId, username, rank);
            this.videoLabels.set(userId, label);
            
            const pipButton = document.createElement('button');
            pipButton.className = 'video-control-btn';
            pipButton.innerHTML = '📺';
            pipButton.onclick = (e) => {
                e.stopPropagation();
                this.togglePictureInPicture(userId);
            };
            
            container.appendChild(video);
            container.appendChild(label);
            container.appendChild(pipButton);
            
            document.getElementById('video-grid')?.appendChild(container);
            
            this.videoElements.set(userId, video);
            this.videoContainers.set(userId, container);
            
            if (event.streams && event.streams[0]) {
                video.srcObject = event.streams[0];
            }
            
            event.track.onended = () => {
                container.remove();
                this.videoElements.delete(userId);
                this.videoContainers.delete(userId);
                this.videoLabels.delete(userId);
            };
        };
        
        if (initiator) {
            try {
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await pc.setLocalDescription(offer);
                
                this.socket.emit('video_offer', {
                    target: userId,
                    offer: offer,
                    roomName: this.roomName,
                    username: this.username,
                    rank: this.userRank
                });
                
            } catch (err) {
                console.error('Error creating offer:', err);
            }
        }
        
        return pc;
    }
    
    closePeerConnection(userId) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(userId);
        }
        
        const container = this.videoContainers.get(userId);
        if (container) container.remove();
        
        this.videoElements.delete(userId);
        this.videoContainers.delete(userId);
        this.videoLabels.delete(userId);
        this.peerStats.delete(userId);
    }
    
    toggleVideo(enabled) {
        if (!this.hasPermission() || !this.localStream) return;
        this.localStream.getVideoTracks().forEach(track => track.enabled = enabled);
        this.isVideoEnabled = enabled;
        this.showNotification(`🎥 Video ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    toggleAudio(enabled) {
        if (!this.hasPermission() || !this.localStream) return;
        this.localStream.getAudioTracks().forEach(track => track.enabled = enabled);
        this.isAudioEnabled = enabled;
        this.showNotification(`🎤 Audio ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    async startScreenShare() {
        if (!this.hasPermission()) return false;
        
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });
            
            this.screenShareStream = screenStream;
            this.isScreenSharing = true;
            
            const videoTrack = screenStream.getVideoTracks()[0];
            
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);
            });
            
            videoTrack.onended = () => this.stopScreenShare();
            
            this.showNotification('🖥️ Screen sharing started');
            return true;
            
        } catch (err) {
            console.error('Screen share error:', err);
            this.showNotification('❌ Failed to start screen share');
            return false;
        }
    }
    
    async stopScreenShare() {
        if (!this.isScreenSharing) return;
        
        if (this.screenShareStream) {
            this.screenShareStream.getTracks().forEach(track => track.stop());
            this.screenShareStream = null;
        }
        
        this.isScreenSharing = false;
        
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender && videoTrack) sender.replaceTrack(videoTrack);
            });
        }
        
        this.showNotification('🖥️ Screen sharing stopped');
    }
    
    async togglePictureInPicture(userId) {
        try {
            const video = this.videoElements.get(userId);
            if (!video) return;
            
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                this.showNotification('📺 Exited picture-in-picture');
            } else {
                await video.requestPictureInPicture();
                this.showNotification('📺 Entered picture-in-picture');
            }
        } catch (err) {
            console.error('Picture-in-picture error:', err);
            this.showNotification('❌ Picture-in-picture failed');
        }
    }
    
    async setVideoQuality(quality) {
        if (!this.localStream || !this.hasPermission()) return;
        
        this.options.videoQuality = quality;
        this.videoConstraints = this.getVideoConstraints();
        
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: this.videoConstraints,
                    audio: false
                });
                
                const newVideoTrack = newStream.getVideoTracks()[0];
                
                this.peerConnections.forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(newVideoTrack);
                });
                
                this.localStream.removeTrack(videoTrack);
                this.localStream.addTrack(newVideoTrack);
                videoTrack.stop();
                
                this.peerStats.forEach(stats => stats.quality = quality);
                this.showNotification(`🎥 Video quality set to ${quality}`);
                
            } catch (err) {
                console.error('Error changing video quality:', err);
                this.showNotification('❌ Failed to change video quality');
            }
        }
    }
    
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
            userRank: this.userRank
        };
        
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
                        this.updateVideoStats(userId, peerStat);
                    }
                });
                
                this.peerStats.set(userId, peerStat);
                
            } catch (err) {
                console.error(`Error getting stats for ${userId}:`, err);
            }
        }
        
        return stats;
    }
    
    startConnectionMonitoring() {
        this.monitoringInterval = setInterval(async () => {
            if (!this.isActive) return;
            await this.getStats();
        }, 5000);
    }
    
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
        } else if (err.message) {
            message = err.message;
        }
        
        this.showNotification(`❌ ${message}`);
    }
    
    showNotification(message, type = 'info') {
        const event = new CustomEvent('videoNotification', {
            detail: { message, type }
        });
        window.dispatchEvent(event);
        
        if (window.showToast) {
            window.showToast(message);
        }
    }
    
    updateUIVideoStatus(active) {
        const videoIndicator = document.getElementById('video-indicator');
        const videoBtn = document.getElementById('videoBtn');
        const videoBtnText = document.getElementById('videoBtnText');
        const videoGrid = document.getElementById('video-grid');
        const videoControls = document.getElementById('video-controls');
        
        if (videoIndicator) videoIndicator.style.display = active ? 'flex' : 'none';
        
        if (videoBtn) {
            if (active) {
                videoBtn.classList.add('danger');
                videoBtnText.textContent = 'LEAVE VIDEO';
            } else {
                videoBtn.classList.remove('danger');
                videoBtnText.textContent = 'JOIN VIDEO';
            }
        }
        
        if (videoGrid) videoGrid.style.display = active ? 'grid' : 'none';
        if (videoControls) videoControls.style.display = active && this.hasPermission() ? 'flex' : 'none';
    }
    
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
    
    isVideoActive() {
        return this.isActive;
    }
    
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoChatHandler;
} else {
    window.VideoChatHandler = VideoChatHandler;
}