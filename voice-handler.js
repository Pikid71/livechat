/**
 * Voice Handler for Black Hole Chat V2
 * WebRTC Voice Chat with TURN/STUN servers for reliable connectivity
 * Includes system messages for join/leave events
 */

class VoiceChatHandler {
    constructor(socket, roomName, username, options = {}) {
        this.socket = socket;
        this.roomName = roomName;
        this.username = username;
        this.options = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...options
        };
        
        // WebRTC variables
        this.localStream = null;
        this.peerConnections = new Map(); // userId -> RTCPeerConnection
        this.isActive = false;
        this.audioElements = new Map(); // userId -> HTMLAudioElement
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        
        // Statistics
        this.stats = {
            bytesSent: 0,
            bytesReceived: 0,
            packetsLost: 0,
            jitter: 0,
            rtt: 0
        };
        
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
        
        // Bind methods to maintain 'this' context
        this.handleUserJoined = this.handleUserJoined.bind(this);
        this.handleUserLeft = this.handleUserLeft.bind(this);
        this.handleVoiceOffer = this.handleVoiceOffer.bind(this);
        this.handleVoiceAnswer = this.handleVoiceAnswer.bind(this);
        this.handleIceCandidate = this.handleIceCandidate.bind(this);
        this.handleVoiceError = this.handleVoiceError.bind(this);
    }
    
    async start() {
        try {
            console.log('🎤 Starting voice chat...');
            
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: this.options.echoCancellation,
                    noiseSuppression: this.options.noiseSuppression,
                    autoGainControl: this.options.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                }, 
                video: false 
            });
            
            console.log('✅ Microphone access granted');
            this.isActive = true;
            
            this.socket.emit('join_voice', { 
                roomName: this.roomName,
                username: this.username 
            });
            
            this.setupSocketListeners();
            this.updateUIVoiceStatus(true);
            this.startConnectionMonitoring();
            
            this.showNotification('🎤 Joined voice chat', 'success');
            return true;
            
        } catch (err) {
            console.error('❌ Voice chat start error:', err);
            this.handleError(err);
            return false;
        }
    }
    
    stop() {
        console.log('🎤 Stopping voice chat...');
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log(`🛑 Track stopped: ${track.kind}`);
            });
            this.localStream = null;
        }
        
        this.peerConnections.forEach((pc, userId) => {
            this.closePeerConnection(userId);
        });
        this.peerConnections.clear();
        
        this.audioElements.forEach((audio, userId) => {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
        });
        this.audioElements.clear();
        
        this.socket.emit('leave_voice', { 
            roomName: this.roomName,
            username: this.username 
        });
        
        this.removeSocketListeners();
        this.isActive = false;
        this.updateUIVoiceStatus(false);
        
        this.showNotification('🎤 Left voice chat', 'info');
        console.log('✅ Voice chat stopped');
    }
    
    setupSocketListeners() {
        this.socket.on('user_joined_voice', this.handleUserJoined);
        this.socket.on('user_left_voice', this.handleUserLeft);
        this.socket.on('voice_offer', this.handleVoiceOffer);
        this.socket.on('voice_answer', this.handleVoiceAnswer);
        this.socket.on('ice_candidate', this.handleIceCandidate);
        this.socket.on('voice_error', this.handleVoiceError);
    }
    
    removeSocketListeners() {
        this.socket.off('user_joined_voice', this.handleUserJoined);
        this.socket.off('user_left_voice', this.handleUserLeft);
        this.socket.off('voice_offer', this.handleVoiceOffer);
        this.socket.off('voice_answer', this.handleVoiceAnswer);
        this.socket.off('ice_candidate', this.handleIceCandidate);
        this.socket.off('voice_error', this.handleVoiceError);
    }
    
    async handleUserJoined(data) {
        console.log(`👤 User joined voice: ${data.username || data.userId}`);
        
        if (!this.isActive) return;
        
        if (data.userId === this.socket.id) return;
        
        if (this.peerConnections.has(data.userId)) {
            console.log(`Connection already exists for ${data.userId}`);
            return;
        }
        
        try {
            await this.createPeerConnection(data.userId, true);
            this.showNotification(`🎤 ${data.username} joined voice`, 'info');
        } catch (err) {
            console.error(`Failed to create connection to ${data.userId}:`, err);
        }
    }
    
    handleUserLeft(data) {
        console.log(`👋 User left voice: ${data.userId}`);
        
        const username = data.username || 'A user';
        
        this.closePeerConnection(data.userId);
        
        this.showNotification(`🎤 ${username} left voice`, 'info');
    }
    
    async handleVoiceOffer(data) {
        console.log(`📞 Received voice offer from ${data.from}`);
        
        if (!this.isActive) return;
        
        try {
            const pc = await this.createPeerConnection(data.from, false);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.socket.emit('voice_answer', {
                target: data.from,
                answer: answer
            });
            
            console.log(`✅ Sent answer to ${data.from}`);
            
        } catch (err) {
            console.error('Error handling voice offer:', err);
        }
    }
    
    async handleVoiceAnswer(data) {
        console.log(`📞 Received voice answer from ${data.from}`);
        
        const pc = this.peerConnections.get(data.from);
        if (!pc) {
            console.warn(`No peer connection for ${data.from}`);
            return;
        }
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log(`✅ Set remote description for ${data.from}`);
        } catch (err) {
            console.error('Error handling voice answer:', err);
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
    
    handleVoiceError(data) {
        console.error('Voice error:', data.message);
        this.showNotification(`❌ Voice error: ${data.message}`, 'error');
    }
    
    async createPeerConnection(userId, initiator = false) {
        console.log(`🔌 Creating peer connection to ${userId} (initiator: ${initiator})`);
        
        const pc = new RTCPeerConnection(this.iceServers);
        this.peerConnections.set(userId, pc);
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
                console.log(`➕ Added ${track.kind} track to connection`);
            });
        }
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice_candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };
        
        pc.onconnectionstatechange = () => {
            console.log(`Connection state to ${userId}: ${pc.connectionState}`);
            
            switch(pc.connectionState) {
                case 'connected':
                case 'completed':
                    this.showNotification(`✅ Voice connected to peer`, 'success');
                    break;
                case 'disconnected':
                case 'failed':
                    console.warn(`Connection to ${userId} ${pc.connectionState}`);
                    if (this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++;
                        setTimeout(() => {
                            if (initiator && this.isActive) {
                                this.createPeerConnection(userId, true);
                            }
                        }, 2000);
                    }
                    break;
                case 'closed':
                    console.log(`Connection to ${userId} closed`);
                    break;
            }
        };
        
        pc.onicegatheringstatechange = () => {
            console.log(`ICE gathering state to ${userId}: ${pc.iceGatheringState}`);
        };
        
        pc.onsignalingstatechange = () => {
            console.log(`Signaling state to ${userId}: ${pc.signalingState}`);
        };
        
        pc.ontrack = (event) => {
            console.log(`📻 Received track from ${userId}: ${event.track.kind}`);
            
            let audio = this.audioElements.get(userId);
            if (!audio) {
                audio = document.createElement('audio');
                audio.autoplay = true;
                audio.controls = false;
                audio.style.display = 'none';
                document.body.appendChild(audio);
                this.audioElements.set(userId, audio);
            }
            
            audio.srcObject = event.streams[0];
            
            event.track.onended = () => {
                console.log(`Track from ${userId} ended`);
                this.audioElements.delete(userId);
                audio.remove();
            };
            
            event.track.onmute = () => console.log(`Track from ${userId} muted`);
            event.track.onunmute = () => console.log(`Track from ${userId} unmuted`);
        };
        
        if (initiator) {
            try {
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false,
                    iceRestart: true
                });
                
                await pc.setLocalDescription(offer);
                
                this.socket.emit('voice_offer', {
                    target: userId,
                    offer: offer,
                    roomName: this.roomName
                });
                
                console.log(`📤 Sent offer to ${userId}`);
                
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
            console.log(`🔌 Closed connection to ${userId}`);
        }
        
        const audio = this.audioElements.get(userId);
        if (audio) {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
            this.audioElements.delete(userId);
        }
    }
    
    setMuted(muted) {
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !muted;
            });
            console.log(`🎤 Microphone ${muted ? 'muted' : 'unmuted'}`);
            this.showNotification(`🎤 Microphone ${muted ? 'muted' : 'unmuted'}`);
        }
    }
    
    toggleMute() {
        if (this.localStream) {
            const track = this.localStream.getAudioTracks()[0];
            if (track) {
                const newState = !track.enabled;
                track.enabled = newState;
                console.log(`🎤 Microphone ${newState ? 'unmuted' : 'muted'}`);
                this.showNotification(`🎤 Microphone ${newState ? 'unmuted' : 'muted'}`);
                return !newState;
            }
        }
        return false;
    }
    
    async getStats() {
        const stats = {
            active: this.isActive,
            peers: this.peerConnections.size,
            localTracks: this.localStream ? this.localStream.getTracks().length : 0,
            remoteTracks: this.audioElements.size,
            ...this.stats
        };
        
        if (this.peerConnections.size > 0) {
            const firstPc = this.peerConnections.values().next().value;
            try {
                const pcStats = await firstPc.getStats();
                pcStats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                        stats.bytesReceived = report.bytesReceived;
                        stats.packetsLost = report.packetsLost;
                        stats.jitter = report.jitter;
                    }
                    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                        stats.bytesSent = report.bytesSent;
                    }
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        stats.rtt = report.currentRoundTripTime;
                    }
                });
            } catch (err) {
                console.error('Error getting stats:', err);
            }
        }
        
        return stats;
    }
    
    startConnectionMonitoring() {
        this.monitoringInterval = setInterval(async () => {
            if (!this.isActive) return;
            
            const stats = await this.getStats();
            
            if (stats.packetsLost > 100 || stats.jitter > 0.1) {
                console.warn('⚠️ Poor connection quality detected');
                this.showNotification('⚠️ Poor connection quality', 'warning');
            }
            
            this.socket.emit('voice_stats', stats);
            
        }, 5000);
    }
    
    handleError(err) {
        let message = 'Voice chat error';
        
        if (err.name === 'NotAllowedError') {
            message = 'Microphone access denied. Please allow microphone access.';
        } else if (err.name === 'NotFoundError') {
            message = 'No microphone found. Please connect a microphone.';
        } else if (err.name === 'NotReadableError') {
            message = 'Microphone is busy. Please check other applications.';
        } else if (err.name === 'OverconstrainedError') {
            message = 'Microphone does not meet requirements.';
        } else if (err.message) {
            message = err.message;
        }
        
        this.showNotification(`❌ ${message}`, 'error');
        
        this.socket.emit('voice_error', {
            message: message,
            code: err.name
        });
    }
    
    showNotification(message, type = 'info') {
        const event = new CustomEvent('voiceNotification', {
            detail: { message, type }
        });
        window.dispatchEvent(event);
        
        if (window.showToast) {
            window.showToast(message);
        }
    }
    
    updateUIVoiceStatus(active) {
        const voiceIndicator = document.getElementById('voice-indicator');
        const voiceBtn = document.getElementById('voiceBtn');
        const voiceBtnText = document.getElementById('voiceBtnText');
        
        if (voiceIndicator) {
            voiceIndicator.style.display = active ? 'flex' : 'none';
        }
        
        if (voiceBtn) {
            if (active) {
                voiceBtn.classList.add('danger');
                voiceBtnText.textContent = 'LEAVE VOICE';
            } else {
                voiceBtn.classList.remove('danger');
                voiceBtnText.textContent = 'JOIN VOICE';
            }
        }
        
        const event = new CustomEvent('voiceStatusChange', {
            detail: { active, peerCount: this.peerConnections.size }
        });
        window.dispatchEvent(event);
    }
    
    getConnectedUsers() {
        return Array.from(this.peerConnections.keys());
    }
    
    isVoiceActive() {
        return this.isActive;
    }
    
    getAudioLevel() {
        if (!this.localStream) return 0;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(this.localStream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            return Math.min(100, Math.round(average));
        } catch (err) {
            return 0;
        }
    }
    
    getConnectionQuality() {
        if (this.stats.packetsLost > 200 || this.stats.jitter > 0.2) {
            return 'poor';
        } else if (this.stats.packetsLost > 100 || this.stats.jitter > 0.1) {
            return 'fair';
        } else if (this.stats.packetsLost > 50 || this.stats.jitter > 0.05) {
            return 'good';
        } else {
            return 'excellent';
        }
    }
    
    destroy() {
        this.stop();
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        this.socket = null;
        this.roomName = null;
        this.username = null;
        
        console.log('🗑️ Voice handler destroyed');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VoiceChatHandler;
} else {
    window.VoiceChatHandler = VoiceChatHandler;
}