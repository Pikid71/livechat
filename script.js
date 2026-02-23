// ========== BLACK HOLE CHAT V2 - COMPLETE CLIENT SCRIPT ==========

// Socket.IO connection
const socket = io();

// ========== GLOBAL VARIABLES ==========
let currentUsername = 'User';
let currentRoom = null;
let currentRank = 'member';
let currentTheme = 'default';
let isAdmin = false;
let isModerator = false;
let isVip = false;
let isOwner = false;
let isUserMuted = false;
let muteExpiresAt = 0;
let scrollBtn = null;
let isVerified = false;
let messageCount = 0;
let messageResetTime = null;
let currentEffect = null;
let matrixInterval = null;

// device tracking
let deviceId = null;
let isDeviceMuted = false;
let deviceMuteExpiresAt = 0;

// Voice chat
let voiceChat = null;
let isVoiceActive = false;

// Video chat
let videoChat = null;
let isVideoActive = false;
let activeVideoStreams = 0;
const MAX_VIDEO_QUALITY = {
    0: 'hd',
    3: 'sd',
    6: 'low',
    10: 'very-low'
};

// File upload
let selectedFile = null;

// Private messages
let privateMessages = [];
let onlineUsers = [];
let allUsersData = new Map(); // Store user data (email, fullName) for admin view

// Browser notifications
let notificationsEnabled = true;
let notificationPermission = false;

// AI configuration
const OPENROUTER_API_KEY = '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';
const AI_MODEL = 'openai/gpt-3.5-turbo';

// UI Elements
const msgContainer = document.getElementById('messages');
const input = document.getElementById('messageInput');
const emojiPanel = document.getElementById('emojiPanel');
const matrixContainer = document.getElementById('matrix-container');

// Owner email for special handling
const OWNER_EMAIL = 'misha037@hsd.k12.or.us';

// simple global error handler
window.addEventListener('error', (e) => {
    console.error('Global JS error:', e.message, e.error);
    showToast('⚠️ JavaScript error: ' + e.message);
});

// allow enter key (without shift) to send a message
if (input) {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// if the user scrolls to bottom hide the button
if (msgContainer) {
    msgContainer.addEventListener('scroll', () => {
        if (msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight <= 0) {
            if (scrollBtn) scrollBtn.style.display = 'none';
        }
    });
}

const sendBtn = document.getElementById('sendBtn');
if (sendBtn) sendBtn.addEventListener('click', sendMessage);

createScrollButton();

const authScreen = document.getElementById('auth-screen');
const roomScreen = document.getElementById('room-screen');
const chatScreen = document.getElementById('chat-screen');
const roomsList = document.getElementById('rooms-list');
const usernameDisplay = document.getElementById('username-display');
const loggedInUsernameDisplay = document.getElementById('loggedInUsername');
const authMessage = document.getElementById('authMessage');
const toast = document.getElementById('toast');

// ========== VERIFICATION STATE ==========
let pendingVerification = null;

// ========== COOKIE FUNCTIONS ==========

function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + value + ';expires=' + expires.toUTCString() + ';path=/';
}

function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = name + '=; Max-Age=-99999999;path=/';
}

// ========== HELPER FUNCTIONS ==========

function showToast(message, duration = 3000) {
    if (!toast) return;
    toast.style.display = 'block';
    toast.className = 'toast';
    toast.textContent = message;
    setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

function showModal(modalId) {
    if (modalId === 'grantRankModal') {
        const sel = document.getElementById('grantRankSelect');
        if (sel) {
            sel.innerHTML = '';
            if (isOwner) {
                sel.add(new Option('👑 Admin', 'admin'));
            }
            sel.add(new Option('🛡️ Moderator', 'moderator'));
            sel.add(new Option('⭐ VIP', 'vip'));
            sel.add(new Option('👤 Member', 'member'));
        }
    }
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function getRankBadge(rank) {
    const rankMap = {
        'owner': { class: 'rank-owner', text: 'OWNER' },
        'admin': { class: 'rank-admin', text: 'ADMIN' },
        'moderator': { class: 'rank-moderator', text: 'MOD' },
        'vip': { class: 'rank-vip', text: 'VIP' },
        'member': { class: 'rank-member', text: 'MEMBER' }
    };
    const rankInfo = rankMap[rank] || rankMap.member;
    return `<span class="${rankInfo.class}">${rankInfo.text}</span>`;
}

function getVerificationBadge(verified) {
    if (verified) {
        return `<span class="verified-badge">✓ VERIFIED</span>`;
    } else {
        return `<span class="unverified-badge">⚠️ UNVERIFIED</span>`;
    }
}

function getRankLevel(rank) {
    const levels = {
        'owner': 1,
        'admin': 2,
        'moderator': 3,
        'vip': 4,
        'member': 5
    };
    return levels[rank] || 5;
}

// ========== URL LINK PARSING ==========
function parseLinksInText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    let escaped = div.innerHTML;

    const urlRegex = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|ftp:\/\/[^\s<>]+)/gi;

    escaped = escaped.replace(urlRegex, (url) => {
        let fullUrl = url;
        if (url.startsWith('www.')) {
            fullUrl = 'https://' + url;
        }
        const displayUrl = url.length > 40 ? url.substring(0, 37) + '...' : url;
        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer" style="color: #ff4444; text-decoration: underline; cursor: pointer; font-weight: bold;">${displayUrl}</a>`;
    });

    return escaped;
}

// ======= SCROLL MANAGEMENT =======
function createScrollButton() {
    if (scrollBtn) return;
    scrollBtn = document.createElement('button');
    scrollBtn.id = 'scrollToBottomBtn';
    scrollBtn.textContent = '🔽 Scroll to bottom';
    scrollBtn.className = 'notification-btn';
    scrollBtn.style.position = 'fixed';
    scrollBtn.style.bottom = '60px';
    scrollBtn.style.right = '20px';
    scrollBtn.style.display = 'none';
    scrollBtn.style.zIndex = '2000';
    scrollBtn.onclick = () => {
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
        scrollBtn.style.display = 'none';
    };
    document.body.appendChild(scrollBtn);
}

function appendWithScrollLogic(wrapper, timestamp = null) {
    const container = msgContainer || document.getElementById('messages');
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 0;
    container.appendChild(wrapper);
    if (atBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        createScrollButton();
        if (scrollBtn) scrollBtn.style.display = 'block';
    }
}

function addSystemMessage(message, timestamp = null) {
    if (!msgContainer) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';

    const header = document.createElement('div');
    header.className = 'msg-header';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    header.innerHTML = `<span class="msg-timestamp">${timeStr}</span>`;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg system';
    item.innerHTML = parseLinksInText(message);
    wrapper.appendChild(item);
    appendWithScrollLogic(wrapper, timestamp);
}

function addWarningMessage(username, message, timestamp = null) {
    if (!msgContainer) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';

    const header = document.createElement('div');
    header.className = 'msg-header';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    header.innerHTML = `<span class="msg-timestamp">${timeStr}</span>`;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg warning';
    item.innerHTML = parseLinksInText(message);
    wrapper.appendChild(item);
    appendWithScrollLogic(wrapper, timestamp);
}

function addAIMessage(username, prompt, response, timestamp = null) {
    if (!msgContainer) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';

    const header = document.createElement('div');
    header.className = 'msg-header';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    header.innerHTML = `
        <span class="msg-username">🤖 AI by ${username}</span>
        <span class="ai-prompt-badge">${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}</span>
        <span class="msg-timestamp">${timeStr}</span>
    `;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg ai';
    item.innerHTML = parseLinksInText(response);
    wrapper.appendChild(item);

    appendWithScrollLogic(wrapper, timestamp);
}

function addImageMessage(username, prompt, imageUrl, size, model, timestamp = null) {
    if (!msgContainer) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';

    const header = document.createElement('div');
    header.className = 'msg-header';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    header.innerHTML = `
        <span class="msg-username">🎨 Image by ${username}</span>
        <span class="image-prompt-badge">${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}</span>
        <span class="msg-timestamp">${timeStr}</span>
        <span style="font-size: 10px; color: #888;">${size} • ${model}</span>
    `;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg image-gen';

    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'generated-image';
    img.alt = prompt;
    img.onclick = () => window.open(imageUrl, '_blank');

    item.appendChild(img);
    wrapper.appendChild(item);

    appendWithScrollLogic(wrapper, timestamp);
}

function parseDurationClient(duration) {
    const match = duration.match(/^(\d+)([hmd])$/);
    if (!match) return 10 * 60 * 1000;
    const amount = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
        case 'm': return amount * 60 * 1000;
        case 'h': return amount * 60 * 60 * 1000;
        case 'd': return amount * 24 * 60 * 60 * 1000;
        default: return 10 * 60 * 1000;
    }
}

function checkIfUserMuted() {
    if (isUserMuted && muteExpiresAt && Date.now() >= muteExpiresAt) {
        isUserMuted = false;
        muteExpiresAt = 0;
    }
    return isUserMuted;
}

function checkIfDeviceMuted() {
    if (isDeviceMuted && deviceMuteExpiresAt && Date.now() >= deviceMuteExpiresAt) {
        isDeviceMuted = false;
        deviceMuteExpiresAt = 0;
    }
    return isDeviceMuted;
}

function updateOnlineUsers() {
    if (currentRoom) {
        socket.emit('get_room_users', { roomName: currentRoom });
    }
}

// ========== EMAIL VALIDATION ==========
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// ========== EFFECT FUNCTIONS ==========

function stopAllEffects() {
    document.body.classList.remove('glitch', 'flashbang', 'black', 'hack-effect', 'matrix', 'rainbow', 'neon-effect', 'firework', 'gameroom');
    if (matrixInterval) {
        clearInterval(matrixInterval);
        matrixInterval = null;
    }
    if (matrixContainer) {
        matrixContainer.style.display = 'none';
        matrixContainer.innerHTML = '';
    }
    currentEffect = null;
    showToast('✨ All effects stopped');
}

function startMatrixEffect() {
    if (!matrixContainer) return;
    matrixContainer.style.display = 'block';
    matrixContainer.innerHTML = '';

    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
    const columns = Math.floor(window.innerWidth / 20);

    for (let i = 0; i < columns; i++) {
        const column = document.createElement('div');
        column.className = 'matrix-column';
        column.style.left = i * 20 + 'px';
        column.style.animationDuration = Math.random() * 3 + 2 + 's';
        column.style.animationDelay = Math.random() * 2 + 's';

        let content = '';
        const length = Math.floor(Math.random() * 20) + 10;
        for (let j = 0; j < length; j++) {
            content += chars[Math.floor(Math.random() * chars.length)] + '<br>';
        }
        column.innerHTML = content;
        matrixContainer.appendChild(column);
    }

    matrixInterval = setInterval(() => {
        const columns = matrixContainer.children;
        for (let col of columns) {
            if (Math.random() > 0.7) {
                col.style.opacity = Math.random() * 0.5 + 0.5;
            }
        }
    }, 500);
}

// ========== AI FUNCTIONS ==========

async function askAI(prompt) {
    if (!prompt || prompt.trim() === '') {
        showToast('❌ Please enter a prompt');
        return;
    }

    if (!isVip) {
        showToast('❌ AI command requires VIP+ rank');
        return;
    }

    if (isUserMuted) {
        showToast('❌ You are muted and cannot use AI');
        return;
    }

    addSystemMessage(`🤖 ${currentUsername} asked AI: "${prompt}"`);

    const loadingWrapper = document.createElement('div');
    loadingWrapper.className = 'msg-wrapper';
    const loadingItem = document.createElement('div');
    loadingItem.className = 'msg system';
    loadingItem.innerHTML = `
        🤖 AI is thinking
        <span class="ai-thinking">
            <span></span><span></span><span></span>
        </span>
    `;
    loadingWrapper.appendChild(loadingItem);
    msgContainer.appendChild(loadingWrapper);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'Black Hole Chat V2'
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful AI assistant in a chat room. Keep responses concise and friendly.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });

        loadingWrapper.remove();

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        addAIMessage(currentUsername, prompt, aiResponse);

        socket.emit('chat message', {
            username: 'System',
            message: `🤖 AI by ${currentUsername}: ${aiResponse}`
        });

    } catch (error) {
        console.error('AI error:', error);
        loadingWrapper.remove();
        showToast('❌ AI request failed');
        addSystemMessage(`❌ AI request failed: ${error.message}`);
    }
}

function sendAIPromptFromModal() {
    const prompt = document.getElementById('aiPromptInput').value.trim();
    if (prompt) {
        askAI(prompt);
        closeModal('aiPromptModal');
        document.getElementById('aiPromptInput').value = '';
    } else {
        showToast('❌ Please enter a prompt');
    }
}

// ========== FIXED IMAGE GENERATION ==========

async function generateImage(prompt, size = '512', model = '') {
    if (!prompt || prompt.trim() === '') {
        showToast('❌ Please enter a prompt');
        return;
    }

    if (!isVip) {
        showToast('❌ Image generation requires VIP+ rank');
        return;
    }

    if (isUserMuted) {
        showToast('❌ You are muted and cannot generate images');
        return;
    }

    addSystemMessage(`🎨 ${currentUsername} requested image: "${prompt}" (${size}x${size} • ${model})`);

    const loadingWrapper = document.createElement('div');
    loadingWrapper.className = 'msg-wrapper';
    const loadingItem = document.createElement('div');
    loadingItem.className = 'msg system';
    loadingItem.innerHTML = `
        🎨 Generating image with ${model}
        <span class="ai-thinking">
            <span></span><span></span><span></span>
        </span>
    `;
    loadingWrapper.appendChild(loadingItem);
    msgContainer.appendChild(loadingWrapper);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    try {
        const resp = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, size, model })
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || 'Image service failed');
        }

        const result = await resp.json();

        if (result.imageUrl) {
            loadingWrapper.remove();
            addImageMessage(currentUsername, prompt, result.imageUrl, `${size}x${size}`, model || 'stable-horde');
            return;
        }

        const requestId = result.requestId || result.id;
        if (!requestId) throw new Error('No image returned and no request id');

        const pollMax = 30;
        let attempts = 0;
        while (attempts < pollMax) {
            await new Promise(r => setTimeout(r, 2000));
            attempts++;
            const pollResp = await fetch(`/api/image-result/${requestId}`);
            if (!pollResp.ok) continue;
            const pollData = await pollResp.json().catch(() => null);
            if (!pollData) continue;
            if (pollData.status === 'done' && pollData.url) {
                loadingWrapper.remove();
                addImageMessage(currentUsername, prompt, pollData.url, `${size}x${size}`, model || 'stable-horde');
                return;
            }
            if (pollData.status === 'failed') {
                loadingWrapper.remove();
                throw new Error('Image generation failed');
            }
        }

        loadingWrapper.remove();
        throw new Error('Image generation timed out');

        socket.emit('chat message', {
            username: 'System',
            message: `🎨 Image by ${currentUsername}: ${prompt}`
        });
    } catch (error) {
        console.error('❌ Image generation error:', error);
        loadingWrapper.remove();
        showToast('❌ Image generation failed');
        addSystemMessage(`❌ Image generation failed: ${error.message}`);
    }
}

function generateImageFromModal() {
    const prompt = document.getElementById('imagePromptInput').value.trim();
    const size = document.getElementById('imageSizeSelect').value;
    const model = document.getElementById('imageModelSelect').value;
    if (prompt) {
        generateImage(prompt, size, model);
        closeModal('imageModal');
        document.getElementById('imagePromptInput').value = '';
    } else {
        showToast('❌ Please enter a prompt');
    }
}

// ========== RANK LEVELS ==========
const RANK_LEVELS = {
    'owner': 1,
    'admin': 2,
    'moderator': 3,
    'vip': 4,
    'member': 5
};

function canViewerSeePrivate(msg) {
    if (msg.from === currentUsername || msg.to === currentUsername) {
        return { show: true, adminView: false };
    }
    if (currentRank === 'owner') {
        return { show: true, adminView: true };
    }
    if (currentRank === 'admin') {
        if (msg.fromRank === 'owner' || msg.toRank === 'owner') {
            return { show: false, adminView: false };
        }
        return { show: true, adminView: true };
    }
    return { show: false, adminView: false };
}

// ========== 200+ EMOJIS ==========
const emojis = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
    '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️',
    '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓',
    '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵',
    '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽',
    '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '🐵', '🐶', '🐱', '🐭', '🐹',
    '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐙', '🦑', '🐙', '🦐', '🦞', '🐡', '🐠', '🐟', '🐬', '🐳',
    '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄',
    '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🐦', '🐧', '🐤',
    '🐣', '🐥', '🐺', '🦝', '🐗', '🐴', '🦄', '🐝', '🪲', '🐞', '🦋', '🐌', '🐛', '🐜', '🪰', '🪱', '🦟', '🦗', '🕷️', '🕸️',
    '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🌍', '🌎', '🌏',
    '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '☀️', '🌝', '🌛', '🌜', '🌚', '☁️', '⛅', '🌤️', '🌥️', '🌦️', '🌧️', '🌨️',
    '👍', '👎'
];

function loadEmojis() {
    if (!emojiPanel) return;
    emojiPanel.innerHTML = '';
    emojis.forEach(emoji => {
        const emojiItem = document.createElement('div');
        emojiItem.className = 'emoji-item';
        emojiItem.textContent = emoji;
        emojiItem.onclick = (e) => {
            e.stopPropagation();
            input.value += emoji;
            input.focus();
            emojiPanel.classList.remove('show');
        };
        emojiPanel.appendChild(emojiItem);
    });
}

document.addEventListener('DOMContentLoaded', loadEmojis);

function toggleEmojiPanel() {
    emojiPanel.classList.toggle('show');
    if (emojiPanel.classList.contains('show')) {
        emojiPanel.style.display = 'grid';
        input.blur();
    } else {
        emojiPanel.style.display = 'none';
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-btn') &&
        !e.target.closest('#emojiBtn') &&
        !e.target.closest('.emoji-panel')) {
        emojiPanel.classList.remove('show');
        emojiPanel.style.display = 'none';
    }
});

// ========== BROWSER NOTIFICATIONS ==========

function checkNotificationSupport() {
    return "Notification" in window;
}

function requestNotificationPermission() {
    if (!checkNotificationSupport()) {
        showToast("❌ Your browser doesn't support notifications");
        return;
    }

    Notification.requestPermission().then(permission => {
        notificationPermission = permission === 'granted';
        const btn = document.getElementById('notificationPermissionBtn');

        if (notificationPermission) {
            notificationsEnabled = true;
            btn.classList.add('enabled');
            btn.innerHTML = '<span>🔔</span> <span>Notifications Enabled</span>';
            showToast("✅ Notifications enabled!");
            sendNotification('✅ Notifications Enabled', 'You will now receive notifications for new messages');
        } else {
            notificationsEnabled = false;
            btn.classList.remove('enabled');
            btn.innerHTML = '<span>🔕</span> <span>Enable Notifications</span>';
            showToast("❌ Notifications blocked");
        }
    });
}

function toggleNotifications() {
    if (!checkNotificationSupport()) {
        showToast("❌ Your browser doesn't support notifications");
        return;
    }

    if (!notificationPermission) {
        Notification.requestPermission().then(permission => {
            notificationPermission = permission === 'granted';
            if (notificationPermission) {
                notificationsEnabled = true;
                updateNotificationSwitch();
                showToast("✅ Notifications enabled!");
                sendNotification('✅ Notifications Enabled', 'You will now receive notifications for new messages');
            } else {
                showToast("❌ Please allow notifications in your browser");
            }
        });
    } else {
        notificationsEnabled = !notificationsEnabled;
        updateNotificationSwitch();
        showToast(notificationsEnabled ? '🔔 Notifications enabled' : '🔕 Notifications disabled');
    }
}

function updateNotificationSwitch() {
    const switchEl = document.getElementById('notifSwitch');
    if (switchEl) {
        if (notificationsEnabled) {
            switchEl.classList.add('enabled');
        } else {
            switchEl.classList.remove('enabled');
        }
    }
}

function sendNotification(title, body, icon = '🕳️') {
    if (!notificationPermission || !notificationsEnabled) return;

    try {
        const notification = new Notification(title, {
            body: body,
            icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#667eea" opacity="0.3"/><text x="50" y="70" font-size="50" text-anchor="middle" fill="white">🕳️</text></svg>'),
            tag: 'chat-message',
            renotify: true,
            silent: false
        });

        notification.onclick = function () {
            window.focus();
            this.close();
        };

        setTimeout(() => notification.close(), 5000);

    } catch (err) {
        console.error('Notification error:', err);
    }
}

// ========== UPDATE RANK UI ==========

function updateRankUI(rank) {
    currentRank = rank;
    isOwner = rank === 'owner';
    isAdmin = rank === 'admin' || rank === 'owner';
    isModerator = rank === 'moderator' || rank === 'admin' || rank === 'owner';
    isVip = rank === 'vip' || rank === 'moderator' || rank === 'admin' || rank === 'owner';

    const badgeHeader = document.getElementById('rank-badge-header');
    const badgeChat = document.getElementById('rank-badge-chat');
    const rankIndicator = document.getElementById('rank-indicator-header');

    if (badgeHeader) badgeHeader.innerHTML = getRankBadge(rank);
    if (badgeChat) badgeChat.innerHTML = getRankBadge(rank);
    if (rankIndicator) rankIndicator.innerHTML = getRankBadge(rank);

    const fileUploadBtn = document.getElementById('fileUploadBtn');
    if (fileUploadBtn) {
        fileUploadBtn.style.display = isVip ? 'flex' : 'none';
    }

    const existingGrantBtn = document.getElementById('grantRankBtn');
    if (existingGrantBtn) existingGrantBtn.remove();
    const existingEffectsBtn = document.getElementById('effectsBtn');
    if (existingEffectsBtn) existingEffectsBtn.remove();
    const existingWarnBtn = document.getElementById('warnBtn');
    if (existingWarnBtn) existingWarnBtn.remove();
    const existingDeleteBtn = document.getElementById('deleteBtn');
    if (existingDeleteBtn) existingDeleteBtn.remove();

    const headerActions = document.querySelector('.header .user-info');
    if (headerActions) {
        if (isModerator) {
            const warnBtn = document.createElement('button');
            warnBtn.id = 'warnBtn';
            warnBtn.className = 'action-btn warning';
            warnBtn.style.padding = '8px 16px';
            warnBtn.innerHTML = '<span>⚠️</span> WARN';
            warnBtn.onclick = () => showModal('warnModal');
            headerActions.after(warnBtn);
        }

        if (isAdmin || isOwner) {
            const grantBtn = document.createElement('button');
            grantBtn.id = 'grantRankBtn';
            grantBtn.className = 'action-btn success';
            grantBtn.style.padding = '8px 16px';
            grantBtn.innerHTML = '<span>👑</span> GRANT';
            grantBtn.onclick = () => showModal('grantRankModal');
            headerActions.after(grantBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.id = 'deleteBtn';
            deleteBtn.className = 'action-btn danger';
            deleteBtn.style.padding = '8px 16px';
            deleteBtn.innerHTML = '<span>🗑️</span> DELETE';
            deleteBtn.onclick = () => showModal('deleteModal');
            headerActions.after(deleteBtn);
        }

        if (isAdmin || isOwner || isModerator || isVip) {
            const effectsBtn = document.createElement('button');
            effectsBtn.id = 'effectsBtn';
            effectsBtn.className = 'action-btn';
            effectsBtn.style.padding = '8px 16px';
            effectsBtn.innerHTML = '<span>✨</span> EFFECTS';
            effectsBtn.onclick = () => showModal('effectsModal');
            headerActions.after(effectsBtn);
        }
    }
}

function updateVerificationUI(verified) {
    isVerified = verified;

    const badgeHeader = document.getElementById('verification-badge-header');
    const badgeChat = document.getElementById('verification-badge-chat');
    const limitIndicator = document.getElementById('message-limit-indicator');

    if (badgeHeader) badgeHeader.innerHTML = getVerificationBadge(verified);
    if (badgeChat) badgeChat.innerHTML = getVerificationBadge(verified);

    if (!verified && limitIndicator) {
        limitIndicator.style.display = 'inline-block';
        updateMessageLimitDisplay();
    } else if (limitIndicator) {
        limitIndicator.style.display = 'none';
    }
}

function updateMessageLimitDisplay() {
    const limitIndicator = document.getElementById('message-limit-indicator');
    if (!limitIndicator) return;

    if (!isVerified) {
        limitIndicator.style.display = 'inline-block';
        limitIndicator.innerHTML = `⏱️ ${messageCount}/5 msgs`;
    } else {
        limitIndicator.style.display = 'none';
    }
}

// ========== VOICE CHAT ==========

class VoiceChatHandler {
    constructor(socket, roomName, username) {
        this.socket = socket;
        this.roomName = roomName;
        this.username = username;
        this.localStream = null;
        this.peerConnections = {};
        this.isActive = false;

        this.configuration = {
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
    }

    async start() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            this.isActive = true;

            this.socket.emit('join_voice', {
                roomName: this.roomName,
                username: this.username
            });

            this.socket.on('user_joined_voice', (data) => this.handleUserJoined(data));
            this.socket.on('user_left_voice', (data) => this.handleUserLeft(data));
            this.socket.on('voice_offer', (data) => this.handleVoiceOffer(data));
            this.socket.on('voice_answer', (data) => this.handleVoiceAnswer(data));
            this.socket.on('ice_candidate', (data) => this.handleIceCandidate(data));

            document.getElementById('voice-indicator').style.display = 'flex';
            document.getElementById('voiceBtnText').textContent = 'LEAVE VOICE';
            document.getElementById('voiceBtn').classList.add('danger');

            showToast('🎤 Joined voice chat');
            return true;

        } catch (err) {
            console.error('Voice chat error:', err);
            showToast('❌ Could not access microphone');
            return false;
        }
    }

    stop() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        Object.values(this.peerConnections).forEach(pc => pc.close());
        this.peerConnections = {};
        this.isActive = false;

        this.socket.emit('leave_voice', {
            roomName: this.roomName,
            username: this.username
        });

        this.socket.off('user_joined_voice');
        this.socket.off('user_left_voice');
        this.socket.off('voice_offer');
        this.socket.off('voice_answer');
        this.socket.off('ice_candidate');

        document.getElementById('voice-indicator').style.display = 'none';
        document.getElementById('voiceBtnText').textContent = 'JOIN VOICE';
        document.getElementById('voiceBtn').classList.remove('danger');

        showToast('🎤 Left voice chat');
    }

    handleUserJoined(data) {
        addSystemMessage(`🎤 ${data.username} joined voice chat`);
        this.createPeerConnection(data.userId);
    }

    handleUserLeft(data) {
        addSystemMessage(`🎤 ${data.username || 'A user'} left voice chat`);
        if (this.peerConnections[data.userId]) {
            this.peerConnections[data.userId].close();
            delete this.peerConnections[data.userId];
        }
    }

    async createPeerConnection(targetId) {
        try {
            const pc = new RTCPeerConnection(this.configuration);
            this.peerConnections[targetId] = pc;

            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('ice_candidate', {
                        target: targetId,
                        candidate: event.candidate
                    });
                }
            };

            pc.ontrack = (event) => {
                const audio = document.createElement('audio');
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                audio.controls = false;
                document.body.appendChild(audio);

                event.streams[0].oninactive = () => {
                    audio.remove();
                };
            };

            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            await pc.setLocalDescription(offer);

            this.socket.emit('voice_offer', {
                target: targetId,
                offer: offer,
                roomName: this.roomName
            });

            return pc;

        } catch (err) {
            console.error('Create peer connection error:', err);
        }
    }

    async handleVoiceOffer(data) {
        try {
            const pc = new RTCPeerConnection(this.configuration);
            this.peerConnections[data.from] = pc;

            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('ice_candidate', {
                        target: data.from,
                        candidate: event.candidate
                    });
                }
            };

            pc.ontrack = (event) => {
                const audio = document.createElement('audio');
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                audio.controls = false;
                document.body.appendChild(audio);

                event.streams[0].oninactive = () => {
                    audio.remove();
                };
            };

            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.socket.emit('voice_answer', {
                target: data.from,
                answer: answer
            });

        } catch (err) {
            console.error('Handle voice offer error:', err);
        }
    }

    async handleVoiceAnswer(data) {
        try {
            const pc = this.peerConnections[data.from];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        } catch (err) {
            console.error('Handle voice answer error:', err);
        }
    }

    handleIceCandidate(data) {
        try {
            const pc = this.peerConnections[data.from];
            if (pc) {
                pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (err) {
            console.error('Handle ICE candidate error:', err);
        }
    }
}

async function toggleVoiceChat() {
    if (!currentRoom) {
        showToast('❌ Join a room first');
        return;
    }
    if (checkIfUserMuted() || checkIfDeviceMuted()) {
        showToast('❌ You are muted and cannot join voice chat');
        return;
    }

    if (!voiceChat || !isVoiceActive) {
        voiceChat = new VoiceChatHandler(socket, currentRoom, currentUsername);
        const success = await voiceChat.start();
        if (success) {
            isVoiceActive = true;
        }
    } else {
        voiceChat.stop();
        isVoiceActive = false;
        voiceChat = null;
    }
}

// ========== VIDEO CHAT WITH DYNAMIC QUALITY ==========

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
        this.handleVideoSelfJoined = this.handleVideoSelfJoined.bind(this);
    }

    getVideoRoot() {
        return document.getElementById('video-grid');
    }

    addLocalVideo() {
        const root = this.getVideoRoot();
        if (!root) return;
        const doc = document;
        const userId = this.socket.id + '_self';
        if (this.videoContainers.has(userId)) return;

        const container = doc.createElement('div');
        container.className = 'video-container';

        const video = doc.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.controls = false;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.setAttribute('data-user', userId);

        const label = this.createVideoLabel(userId, this.username + ' (You)', this.userRank);
        this.videoLabels.set(userId, label);

        container.appendChild(video);
        container.appendChild(label);
        root.appendChild(container);

        this.videoElements.set(userId, video);
        this.videoContainers.set(userId, container);

        if (this.localStream) {
            video.srcObject = this.localStream;
        }
    }

    handleVideoSelfJoined(data) {
        this.addLocalVideo();
    }

    hasPermission() {
        return this.isVip && !this.isMuted;
    }

    setMutedStatus(muted) {
        this.isMuted = muted;
        if (muted && this.isActive) {
            this.stop();
            showToast('🔇 You have been muted - video chat disabled');
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
            showToast('⛔ You have been banned - video chat disabled');
        }
    }

    adjustQualityBasedOnParticipants() {
        const participantCount = this.peerConnections.size;
        let newQuality = 'hd';

        if (participantCount >= 10) {
            newQuality = 'very-low';
        } else if (participantCount >= 6) {
            newQuality = 'low';
        } else if (participantCount >= 3) {
            newQuality = 'sd';
        }

        if (newQuality !== this.options.videoQuality) {
            console.log(`Adjusting video quality to ${newQuality} due to ${participantCount} participants`);
            this.setVideoQuality(newQuality);
        }
    }

    getVideoConstraints() {
        const participantCount = this.peerConnections.size;
        let quality = this.options.videoQuality;

        // Auto-adjust based on participant count
        if (participantCount >= 10) {
            quality = 'very-low';
        } else if (participantCount >= 6) {
            quality = 'low';
        } else if (participantCount >= 3) {
            quality = 'sd';
        }

        switch (quality) {
            case 'very-low':
                return {
                    width: { ideal: 160, max: 320 },
                    height: { ideal: 120, max: 240 },
                    frameRate: { ideal: 10, max: 15 }
                };
            case 'low':
                return {
                    width: { ideal: 320, max: 426 },
                    height: { ideal: 240, max: 240 },
                    frameRate: { ideal: 15, max: 20 }
                };
            case 'sd':
                return {
                    width: { ideal: 640, max: 854 },
                    height: { ideal: 480, max: 480 },
                    frameRate: { ideal: 20, max: 30 }
                };
            case 'hd':
                return {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 30, max: 60 }
                };
            default:
                return {
                    width: { ideal: 640, max: 854 },
                    height: { ideal: 480, max: 480 },
                    frameRate: { ideal: 20, max: 30 }
                };
        }
    }

    async start() {
        if (!this.hasPermission()) {
            const reason = !this.isVip ? 'VIP+ only' : 'You are muted';
            showToast(`❌ Video chat unavailable: ${reason}`);
            return false;
        }

        try {
            this.videoConstraints = this.getVideoConstraints();
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: this.videoConstraints
            });

            this.isActive = true;
            activeVideoStreams++;

            this.setupSocketListeners();

            this.socket.emit('join_video', {
                roomName: this.roomName,
                username: this.username,
                rank: this.userRank
            });

            this.addLocalVideo();

            this.updateUIVideoStatus(true);
            this.startConnectionMonitoring();
            showToast('🎥 Joined video chat');
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
        activeVideoStreams = Math.max(0, activeVideoStreams - 1);
        this.updateUIVideoStatus(false);
        showToast('🎥 Left video chat');
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
        this.socket.on('video_self_joined', this.handleVideoSelfJoined);
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
        this.socket.off('video_self_joined', this.handleVideoSelfJoined);
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

        if (this.peerConnections.has(data.userId)) {
            console.log(`Already connected to ${data.userId}, skipping duplicate`);
            return;
        }

        try {
            await this.createPeerConnection(data.userId, true, data.username, data.rank);
            this.adjustQualityBasedOnParticipants();
            showToast(`🎥 ${data.username} joined video`);
        } catch (err) {
            console.error(`Failed to create connection to ${data.userId}:`, err);
        }
    }

    handleUserLeft(data) {
        this.closePeerConnection(data.userId);
        this.adjustQualityBasedOnParticipants();
        showToast(`🎥 ${data.username || 'A user'} left video`);
    }

    async handleVideoOffer(data) {
        if (!this.isActive) return;

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
        showToast(`❌ Video error: ${data.message}`);
    }

    async createPeerConnection(userId, initiator = false, username = 'Unknown', rank = 'member') {
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
                showToast(`✅ Video connected to ${username}`);
            }
        };

        pc.ontrack = (event) => {
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

            const root = this.getVideoRoot();
            root?.appendChild(container);

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
        showToast(`🎥 Video ${enabled ? 'enabled' : 'disabled'}`);
    }

    toggleAudio(enabled) {
        if (!this.hasPermission() || !this.localStream) return;
        this.localStream.getAudioTracks().forEach(track => track.enabled = enabled);
        this.isAudioEnabled = enabled;
        showToast(`🎤 Audio ${enabled ? 'enabled' : 'disabled'}`);
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

            showToast('🖥️ Screen sharing started');
            return true;

        } catch (err) {
            console.error('Screen share error:', err);
            showToast('❌ Failed to start screen share');
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

        showToast('🖥️ Screen sharing stopped');
    }

    async togglePictureInPicture(userId) {
        try {
            const video = this.videoElements.get(userId);
            if (!video) return;

            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                showToast('📺 Exited picture-in-picture');
            } else {
                await video.requestPictureInPicture();
                showToast('📺 Entered picture-in-picture');
            }
        } catch (err) {
            console.error('Picture-in-picture error:', err);
            showToast('❌ Picture-in-picture failed');
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
                showToast(`🎥 Video quality set to ${quality}`);

            } catch (err) {
                console.error('Error changing video quality:', err);
                showToast('❌ Failed to change video quality');
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

        showToast(`❌ ${message}`);
    }

    updateUIVideoStatus(active) {
        const videoIndicator = document.getElementById('video-indicator');
        const videoBtn = document.getElementById('videoBtn');
        const videoBtnText = document.getElementById('videoBtnText');
        const videoControls = document.getElementById('video-controls');
        const videoGrid = document.getElementById('video-grid');

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

async function toggleVideoChat() {
    if (!currentRoom) {
        showToast('❌ Join a room first');
        return;
    }

    if (!videoChat || !isVideoActive) {
        if (!isVip) {
            showToast('❌ Video chat requires VIP+ rank');
            return;
        }

        if (checkIfUserMuted() || checkIfDeviceMuted()) {
            showToast('❌ You are muted and cannot use video chat');
            return;
        }

        videoChat = new VideoChatHandler(socket, currentRoom, currentUsername, currentRank);
        const success = await videoChat.start();
        if (success) {
            isVideoActive = true;
            document.getElementById('videoMuteBtn').style.display = 'flex';
            document.getElementById('audioMuteBtn').style.display = 'flex';
            document.getElementById('screenShareBtn').style.display = 'flex';
            document.getElementById('qualityBtn').style.display = 'flex';
            document.getElementById('video-controls').style.display = 'flex';
        }
    } else {
        videoChat.stop();
        isVideoActive = false;
        videoChat = null;
        document.getElementById('videoMuteBtn').style.display = 'none';
        document.getElementById('audioMuteBtn').style.display = 'none';
        document.getElementById('screenShareBtn').style.display = 'none';
        document.getElementById('qualityBtn').style.display = 'none';
        document.getElementById('video-controls').style.display = 'none';
    }
}

function toggleVideoMute() {
    if (videoChat) {
        videoChat.toggleVideo(!videoChat.isVideoEnabled);
        const btn = document.getElementById('videoMuteBtn');
        if (btn) {
            btn.innerHTML = videoChat.isVideoEnabled ?
                '<span>🎥</span> <span>MUTE VIDEO</span>' :
                '<span>🎥</span> <span>UNMUTE VIDEO</span>';
        }
    }
}

function toggleAudioMute() {
    if (videoChat) {
        videoChat.toggleAudio(!videoChat.isAudioEnabled);
        const btn = document.getElementById('audioMuteBtn');
        if (btn) {
            btn.innerHTML = videoChat.isAudioEnabled ?
                '<span>🎤</span> <span>MUTE AUDIO</span>' :
                '<span>🎤</span> <span>UNMUTE AUDIO</span>';
        }
    }
}

async function toggleScreenShare() {
    if (videoChat) {
        if (!videoChat.isScreenSharing) {
            await videoChat.startScreenShare();
            document.getElementById('screenShareBtn').innerHTML = '<span>🖥️</span> <span>STOP SHARE</span>';
        } else {
            videoChat.stopScreenShare();
            document.getElementById('screenShareBtn').innerHTML = '<span>🖥️</span> <span>SHARE SCREEN</span>';
        }
    }
}

function showVideoQualityMenu() {
    showModal('videoQualityModal');
}

function setVideoQuality(quality) {
    if (videoChat) {
        videoChat.setVideoQuality(quality);
        closeModal('videoQualityModal');
    }
}

// ========== FILE UPLOAD ==========

function showFileUpload() {
    if (!isVip) {
        showToast('❌ VIP+ only can share files');
        return;
    }
    showModal('fileUploadModal');
}

function handleFileSelect(file) {
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
        showToast('❌ File too large! Max 50MB');
        return;
    }

    selectedFile = file;

    let icon = '📄';
    if (file.type.startsWith('image/')) icon = '🖼️';
    else if (file.type === 'application/pdf') icon = '📕';
    else if (file.type.startsWith('audio/')) icon = '🎵';
    else if (file.type.startsWith('video/')) icon = '🎬';

    document.getElementById('fileIcon').textContent = icon;
    document.getElementById('fileName').textContent = file.name;

    let sizeText = '';
    if (file.size < 1024) sizeText = `${file.size} B`;
    else if (file.size < 1024 * 1024) sizeText = `${(file.size / 1024).toFixed(1)} KB`;
    else sizeText = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    document.getElementById('fileSize').textContent = sizeText;
    document.getElementById('filePreview').style.display = 'block';
}

async function uploadFile() {
    if (!selectedFile) {
        showToast('❌ Please select a file');
        return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('username', currentUsername);
    formData.append('roomName', currentRoom || '');

    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('uploadBtn').innerHTML = '<span>⏳</span> UPLOADING...';

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            socket.emit('share_file', {
                fileUrl: result.fileUrl,
                fileName: result.fileName,
                fileType: result.fileType,
                fileSize: result.fileSize
            });
            closeModal('fileUploadModal');
            showToast(`✅ File shared: ${result.fileName}`);
        } else {
            showToast('❌ Upload failed: ' + (result.error || 'Unknown error'));
        }

    } catch (err) {
        console.error('Upload error:', err);
        showToast('❌ Upload failed');
    } finally {
        document.getElementById('uploadBtn').disabled = false;
        document.getElementById('uploadBtn').innerHTML = '<span>📤</span> UPLOAD FILE';
        selectedFile = null;
        document.getElementById('filePreview').style.display = 'none';
    }
}

// ========== AUTH UI ==========

function switchToRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    authMessage.style.display = 'none';
}

function switchToLogin() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('verificationSection').style.display = 'none';
    document.getElementById('registerBtn').style.display = 'block';
    authMessage.style.display = 'none';
    pendingVerification = null;
}

function showAuthMessage(msg, isError = true) {
    authMessage.textContent = msg;
    authMessage.style.color = isError ? '#ff6b6b' : '#4ade80';
    authMessage.style.display = 'block';
    setTimeout(() => {
        authMessage.style.display = 'none';
    }, 3000);
}

// ========== AUTH HANDLERS WITH COOKIE STORAGE ==========

function handleLogin() {
    let username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    username = username.replace(/\s+/g, '_');
    const nwordRegex = /(nigga|nigger)/i;
    if (nwordRegex.test(username)) {
        showAuthMessage('Invalid username');
        return;
    }

    if (!username || !password) {
        showAuthMessage('Please enter both username and password');
        return;
    }

    if (rememberMe) {
        setCookie('username', username, 30);
        setCookie('password', password, 30);
        setCookie('rememberMe', 'true', 30);
    }

    socket.emit('login', { username, password, rememberMe, deviceId });
}

function handleRegister() {
    const fullName = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    let username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    username = username.replace(/\s+/g, '_');

    const nwordRegex = /(nigga|nigger)/i;
    if (nwordRegex.test(username)) {
        showAuthMessage('Invalid username');
        return;
    }

    if (!fullName || !email || !username || !password || !confirmPassword) {
        showAuthMessage('Please fill in all fields');
        return;
    }

    if (!validateEmail(email)) {
        showAuthMessage('Please enter a valid email address');
        return;
    }

    if (password !== confirmPassword) {
        showAuthMessage('Passwords do not match');
        return;
    }

    if (password.length < 4) {
        showAuthMessage('Password must be at least 4 characters');
        return;
    }

    const registerBtn = document.getElementById('registerBtn');
    registerBtn.disabled = true;
    registerBtn.innerHTML = '<span>⏳</span> SENDING...';

    socket.emit('request_verification', { fullName, email, username, password });
}

socket.on('verification_sent', (data) => {
    showAuthMessage(`✅ Verification code sent to ${data.email}`, false);

    document.getElementById('verificationSection').style.display = 'block';
    document.getElementById('registerBtn').style.display = 'none';

    pendingVerification = data.email;
});

function verifyCode() {
    const code = document.getElementById('verificationCode').value.trim();

    if (!code || code.length !== 6) {
        showAuthMessage('Please enter a valid 6-digit code');
        return;
    }

    if (!pendingVerification) {
        showAuthMessage('No pending verification');
        return;
    }

    socket.emit('verify_code', { email: pendingVerification, code });
}

function handleLogout() {
    deleteCookie('username');
    deleteCookie('password');
    deleteCookie('rememberMe');

    if (currentRoom) {
        socket.emit('leave_room');
    }
    if (isVoiceActive && voiceChat) {
        voiceChat.stop();
        isVoiceActive = false;
    }
    if (isVideoActive && videoChat) {
        videoChat.stop();
        isVideoActive = false;
    }
    socket.emit('logout');
    resetUI();
}

function resetUI() {
    currentUsername = 'User';
    currentRoom = null;
    currentRank = 'member';
    isAdmin = false;
    isModerator = false;
    isVip = false;
    isOwner = false;
    isVerified = false;

    authScreen.style.display = 'flex';
    roomScreen.style.display = 'none';
    chatScreen.style.display = 'none';
    switchToLogin();

    const grantBtn = document.getElementById('grantRankBtn');
    if (grantBtn) grantBtn.remove();

    const effectsBtn = document.getElementById('effectsBtn');
    if (effectsBtn) effectsBtn.remove();

    const warnBtn = document.getElementById('warnBtn');
    if (warnBtn) warnBtn.remove();

    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.remove();

    stopAllEffects();
}

// ========== GRANT RANK ==========

function grantRank() {
    const targetUser = document.getElementById('grantUsername').value.trim();
    const newRank = document.getElementById('grantRankSelect').value;

    if (!targetUser || !newRank) {
        showToast('❌ Please enter username and select rank');
        return;
    }

    socket.emit('grant_rank', {
        targetUser,
        newRank
    });

    closeModal('grantRankModal');
    showToast(`👑 Granting ${newRank} to ${targetUser}...`);
}

// ========== WARN USER ==========

function warnUser() {
    const targetUser = document.getElementById('warnUsername').value.trim();

    if (!targetUser) {
        showToast('❌ Please enter username');
        return;
    }

    if (targetUser === currentUsername) {
        showToast('❌ Cannot warn yourself');
        return;
    }

    const targetRank = onlineUsers.find(u => u.username === targetUser)?.rank || 'member';
    const targetLevel = getRankLevel(targetRank);
    const userLevel = getRankLevel(currentRank);

    if (targetLevel <= userLevel && currentRank !== 'owner') {
        showToast('❌ Cannot warn users of equal or higher rank');
        return;
    }

    socket.emit('warn_user', {
        targetUser,
        roomName: currentRoom,
        warnerName: currentUsername
    });

    closeModal('warnModal');
    document.getElementById('warnUsername').value = '';
    showToast(`⚠️ Warning ${targetUser}...`);
}

// ========== DELETE COMMANDS ==========

function deleteUser() {
    const targetUser = document.getElementById('deleteUserUsername').value.trim();

    if (!targetUser) {
        showToast('❌ Please enter username');
        return;
    }

    if (targetUser === 'Pi_Kid71') {
        showToast('❌ Cannot delete owner');
        return;
    }

    if (confirm(`Are you sure you want to delete user ${targetUser}?`)) {
        socket.emit('delete_user', {
            targetUser
        });
        closeModal('deleteModal');
        document.getElementById('deleteUserUsername').value = '';
    }
}

function deleteRoomFromModal() {
    const roomName = document.getElementById('deleteRoomName').value.trim();

    if (!roomName) {
        showToast('❌ Please enter room name');
        return;
    }

    if (roomName === 'Main') {
        showToast('❌ Cannot delete Main room');
        return;
    }

    if (confirm(`Are you sure you want to delete room ${roomName}?`)) {
        socket.emit('delete_room', { roomName, password: '' });
        closeModal('deleteModal');
        document.getElementById('deleteRoomName').value = '';
    }
}

// ========== SOCKET AUTH EVENTS ==========

socket.on('auth_success', (data) => {
    currentUsername = data.username;
    updateRankUI(data.rank);
    updateVerificationUI(data.isVerified);

    loggedInUsernameDisplay.textContent = data.username;
    usernameDisplay.textContent = data.username;

    if (data.theme) {
        changeTheme(data.theme, 'personal');
    }

    if (!data.isVerified) {
        showToast('⚠️ Your account is not verified. You can only send 5 messages per 10 minutes.', 5000);
    }

    showAuthMessage(data.message, false);
    setTimeout(() => {
        authScreen.style.display = 'none';
        roomScreen.style.display = 'flex';
        loadRooms();
    }, 500);

    showToast(`✅ Welcome, ${data.username}!`);
});

socket.on('auth_error', (data) => {
    showAuthMessage(data.message);

    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.innerHTML = '✨ SEND VERIFICATION';
    }
});

socket.on('logged_out', () => {
    resetUI();
    showToast('👋 Logged out');
});

socket.on('rank_changed', (data) => {
    updateRankUI(data.newRank);
    showToast(`👑 Your rank is now ${data.newRank.toUpperCase()}`);
});

socket.on('message_limit_update', (data) => {
    messageCount = data.count;
    updateMessageLimitDisplay();
});

socket.on('user_data', (data) => {
    if (data.username && data.email) {
        allUsersData.set(data.username, {
            email: data.email,
            fullName: data.fullName
        });
    }
});

// ========== WARNING EVENT ==========

socket.on('user_warned', (data) => {
    addWarningMessage('⚠️ WARNING', `${data.targetUser} was warned by ${data.warnerName}`, data.timestamp);

    if (data.targetUser === currentUsername) {
        showToast(`⚠️ You have been warned by ${data.warnerName}`);
        sendNotification('⚠️ Warning', `You were warned by ${data.warnerName}`);
    }
});

// ========== DELETE EVENTS ==========

socket.on('user_deleted', (data) => {
    addSystemMessage(`🗑️ User ${data.deletedUser} was deleted by ${data.deletedBy}`);

    if (data.deletedUser === currentUsername) {
        showToast('🗑️ Your account has been deleted');
        setTimeout(() => {
            socket.disconnect();
            location.reload();
        }, 2000);
    }
});

// ========== ROOMS ==========

function loadRooms() {
    socket.emit('get_rooms');
}

socket.on('rooms_list', (rooms) => {
    roomsList.innerHTML = '';

    if (rooms.length === 0) {
        roomsList.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">No rooms available. Create one!</div>';
        return;
    }

    rooms.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return a.name.localeCompare(b.name);
    });

    rooms.forEach(room => {
        const roomCard = document.createElement('div');
        roomCard.className = 'room-card';

        let lockIcon = room.hasPassword ? '🔒' : '🔓';
        let defaultBadge = room.isDefault ? '<span class="rank-owner" style="margin-left: 8px;">DEFAULT</span>' : '';

        roomCard.innerHTML = `
            <div class="room-header">
                <div class="room-name">
                    <span>${lockIcon}</span>
                    ${room.name}
                    ${defaultBadge}
                    <span style="font-size: 12px; color: #888; margin-left: 8px;">🎨 ${room.theme || 'default'}</span>
                </div>
                <div class="room-stats">
                    <span>👥 ${room.members}</span>
                </div>
            </div>
            <div class="room-actions">
                <button onclick="joinRoom('${room.name}', ${room.hasPassword})" class="action-btn success" style="flex: 1;">
                    <span>🚪</span> JOIN
                </button>
                ${!room.isDefault && (isAdmin || isOwner) ? `
                    <button onclick="deleteRoom('${room.name}')" class="action-btn danger">
                        <span>🗑️</span> DEL
                    </button>
                ` : ''}
            </div>
        `;

        roomsList.appendChild(roomCard);
    });
});

function createRoom() {
    let roomName = document.getElementById('newRoomName').value.trim();
    const password = document.getElementById('newRoomPassword').value;
    const theme = document.getElementById('roomTheme').value;

    roomName = roomName.replace(/\s+/g, '_');

    const nwordRegex = /(nigga|nigger)/i;
    if (nwordRegex.test(roomName) || nwordRegex.test(password)) {
        showToast('❌ Invalid room name or password');
        return;
    }

    if (!roomName) {
        showToast('❌ Please enter a room name');
        return;
    }

    if (roomName.length < 2) {
        showToast('❌ Room name too short');
        return;
    }

    socket.emit('create_room', { roomName, password, theme });

    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomPassword').value = '';
}

function joinRoom(roomName, hasPassword = false) {
    if (hasPassword) {
        if (isOwner) {
            socket.emit('join_room', { roomName, password: '' });
            showToast('👑 Owner bypassed room password');
        } else {
            const pwd = prompt('Enter room password:');
            if (pwd === null) return;
            socket.emit('join_room', { roomName, password: pwd });
        }
    } else {
        socket.emit('join_room', { roomName, password: '' });
    }
}

function deleteRoom(roomName) {
    if (confirm(`Are you sure you want to delete "${roomName}"?`)) {
        if (isAdmin || isOwner) {
            socket.emit('delete_room', { roomName, password: '' });
        } else {
            const password = prompt('Enter admin password:');
            if (password) {
                socket.emit('delete_room', { roomName, password });
            }
        }
    }
}

socket.on('room_created', (data) => {
    loadRooms();
    showToast(`🏠 Room "${data.name}" created`);
});

socket.on('room_deleted', (data) => {
    loadRooms();
    if (currentRoom === data.name) {
        leaveRoom();
    }
    showToast(`🗑️ Room "${data.name}" deleted`);
});

socket.on('joined_room', (data) => {
    currentRoom = data.roomName;
    usernameDisplay.textContent = data.username;
    document.getElementById('current-room').textContent = data.roomName;
    document.getElementById('members-count').textContent = '1';
    document.getElementById('room-theme-indicator').innerHTML = `🎨 ${data.theme || 'default'}`;

    msgContainer.innerHTML = '';
    roomScreen.style.display = 'none';
    chatScreen.style.display = 'flex';
    input.focus();

    if (isVip && data.theme) {
        changeTheme(data.theme, 'personal');
    }

    showToast(`🚪 Joined room: ${data.roomName}`);
});

socket.on('room_history', (data) => {
    msgContainer.innerHTML = '';

    if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
            if (msg.isPrivate) {
                const result = canViewerSeePrivate(msg);
                if (result.show) {
                    addPrivateMessage(msg.username, msg.message, msg.recipient, msg.username === currentUsername, result.adminView);
                }
            } else if (msg.fileUrl) {
                addFileMessage(msg.username, msg.fileUrl, msg.fileName, msg.fileType, msg.fileSize, msg.timestamp);
            } else {
                addMessage(msg.username, msg.message, msg.rank, msg.timestamp);
            }
        });
    }

    setTimeout(() => {
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 100);
});

socket.on('user_joined', (data) => {
    document.getElementById('members-count').textContent = data.members;
    addSystemMessage(`👋 ${data.username} (${data.rank || 'member'}) joined`);
    sendNotification('👋 User Joined', `${data.username} joined the room`);
    updateOnlineUsers();
});

socket.on('user_left', (data) => {
    document.getElementById('members-count').textContent = data.members;
    if (data.username) {
        addSystemMessage(`👋 ${data.username} left`);
    }
    updateOnlineUsers();
});

// ========== MESSAGES ==========

socket.on('chat message', (data) => {
    if (data.fileUrl) {
        addFileMessage(data.username, data.fileUrl, data.fileName, data.fileType, data.fileSize, data.timestamp);
    } else {
        addMessage(data.username, data.message, data.rank, data.timestamp);
    }

    if (data.username !== currentUsername && currentRoom) {
        sendNotification(`💬 New message in ${currentRoom}`, `${data.username}: ${data.message.substring(0, 50)}${data.message.length > 50 ? '...' : ''}`);
    }
});

function addMessage(username, message, rank = 'member', timestamp = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';
    if (username === currentUsername) {
        wrapper.classList.add('mine');
    }

    const header = document.createElement('div');
    header.className = 'msg-header';

    let rankBadge = '';
    if (rank && rank !== 'member' && rank !== 'system') {
        rankBadge = getRankBadge(rank);
    }

    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    header.innerHTML = `
        <span class="msg-username">${username}</span>
        ${rankBadge}
        <span class="msg-timestamp">${timeStr}</span>
    `;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg';
    if (username === currentUsername) item.classList.add('mine');
    if (username === 'System') item.classList.add('system');
    item.innerHTML = parseLinksInText(message);
    wrapper.appendChild(item);

    appendWithScrollLogic(wrapper, timestamp);
}

function addPrivateMessage(from, message, to, isFromSelf = false, isAdminView = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';

    const header = document.createElement('div');
    header.className = 'msg-header';

    let viewBadge = '';
    if (isAdminView) {
        viewBadge = '<span class="admin-view-badge">admin view</span>';
    }

    header.innerHTML = `
        <span class="msg-username">🔒 ${from} → ${to}</span>
        ${viewBadge}
        <span class="msg-timestamp">${new Date().toLocaleTimeString()}</span>
        ${isFromSelf ? '<span style="color: #4ade80; font-size: 10px;">(sent)</span>' : ''}
    `;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg private';
    item.innerHTML = parseLinksInText(message);
    wrapper.appendChild(item);

    appendWithScrollLogic(wrapper);
}

function addFileMessage(username, fileUrl, fileName, fileType, fileSize, timestamp = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';
    if (username === currentUsername) wrapper.classList.add('mine');

    const header = document.createElement('div');
    header.className = 'msg-header';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    header.innerHTML = `
        <span class="msg-username">${username}</span>
        <span class="msg-timestamp">${timeStr}</span>
    `;
    wrapper.appendChild(header);

    const item = document.createElement('div');
    item.className = 'msg file-share';

    let icon = '📄';
    if (fileType?.startsWith('image/')) icon = '🖼️';
    else if (fileType === 'application/pdf') icon = '📕';
    else if (fileType?.startsWith('audio/')) icon = '🎵';
    else if (fileType?.startsWith('video/')) icon = '🎬';

    let sizeText = '';
    if (fileSize) {
        if (fileSize < 1024) sizeText = `${fileSize} B`;
        else if (fileSize < 1024 * 1024) sizeText = `${(fileSize / 1024).toFixed(1)} KB`;
        else sizeText = `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
    }

    item.innerHTML = `
        <div class="file-info" onclick="window.open('${fileUrl}', '_blank')">
            <span class="file-icon">${icon}</span>
            <div style="flex: 1;">
                <div class="file-name">${fileName}</div>
                ${sizeText ? `<div style="font-size: 10px; color: #888;">${sizeText}</div>` : ''}
            </div>
            <span style="font-size: 20px;">📥</span>
        </div>
    `;
    wrapper.appendChild(item);

    appendWithScrollLogic(wrapper);
}

function processMentions(text) {
    let processedText = text;
    const mentionRegex = /@(\w+)/g;
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
        const mentionedUsername = match[1];
        const mentionedUser = onlineUsers.find(u => u.username === mentionedUsername);

        if (mentionedUser) {
            const rankBadgeStr = getRankBadge(mentionedUser.rank);
            const rankMatch = rankBadgeStr.match(/>([A-Z]+)</);
            const rankText = rankMatch ? rankMatch[1] : mentionedUser.rank.toUpperCase();
            processedText = processedText.replace(`@${mentionedUsername}`, `{${rankText}} ${mentionedUsername}`);
        } else {
            processedText = processedText.replace(`@${mentionedUsername}`, mentionedUsername);
        }
    }
    return processedText;
}

function sendMessage() {
    const msgInput = document.getElementById('messageInput');
    if (!msgInput || !msgInput.value.trim()) {
        return;
    }

    let messageText = msgInput.value;

    if (messageText.startsWith('/')) {
        if (checkIfUserMuted() || checkIfDeviceMuted()) {
            addSystemMessage('❌ You are muted and cannot use commands');
            msgInput.value = '';
            emojiPanel.classList.remove('show');
            return;
        }
        const handled = handleCommand(messageText);
        msgInput.value = '';
        emojiPanel.classList.remove('show');
        if (handled) return;
    }

    if (checkIfUserMuted() || checkIfDeviceMuted()) {
        showToast('🔇 You are muted and cannot send messages');
        return;
    }

    const processedMessage = processMentions(messageText);
    socket.emit('chat message', { username: currentUsername, message: processedMessage });
    msgInput.value = '';
    emojiPanel.classList.remove('show');
}

// ========== HELP COMMAND ==========

function showHelp() {
    const helpDiv = document.createElement('div');
    helpDiv.className = 'msg system help-menu';

    const rankLevel = getRankLevel(currentRank);

    helpDiv.innerHTML = `
        <div style="text-align: center; margin-bottom: 15px;">
            <span style="font-size: 20px;">🕳️</span>
            <span style="font-weight: bold; font-size: 18px; color: gold;"> BLACK HOLE CHAT V2</span>
            <span style="font-size: 20px;">🕳️</span>
        </div>
        
        <div class="help-section">
            <div class="help-title">📋 YOUR RANK</div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                ${getRankBadge(currentRank)}
                ${getVerificationBadge(isVerified)}
                <span style="color: #4ade80;">Rank ${rankLevel}/5 (lower number = higher rank)</span>
            </div>
        </div>
        
        <div class="help-section">
            <div class="help-title">💬 EVERYONE</div>
            <div><span class="help-command">/help</span> <span class="help-desc">- Show this help menu</span></div>
            <div><span class="help-command">/users</span> <span class="help-desc">- List users (🟢 in room, 🟡 online elsewhere, 🔴 offline) - Shows name to mod, email to admin+</span></div>
            <div><span class="help-command">/msg &lt;user&gt; &lt;text&gt;</span> <span class="help-desc">- Send private message</span></div>
            <div><span class="help-command">/flip</span> <span class="help-desc">- Flip a coin (heads/tails)</span></div>
            <div><span class="help-command">/roll &lt;min&gt; &lt;max&gt;</span> <span class="help-desc">- Roll a random number</span></div>
            <div><span class="help-command">/ping</span> <span class="help-desc">- Check connection latency</span></div>
            <div><span class="help-command">/cloak &lt;title&gt;</span> <span class="help-desc">- Change browser tab title (VIP+)</span></div>
        </div>
        
        <div class="help-section">
            <div class="help-title">📊 RANK SYSTEM (Lower number = Higher rank)</div>
            <div><span class="help-rank owner">OWNER (1)</span> <span class="help-desc">- Can see ALL private messages, Video enabled, Can ban anyone, Can grant any rank, Can clear chat, Can delete users, Can bypass room passwords</span></div>
            <div><span class="help-rank admin">ADMIN (2)</span> <span class="help-desc">- Can see messages from rank 3-5, Video enabled, Can ban rank 3-5, Can grant mod/vip/member, Can delete rooms, CANNOT demote other admins, CANNOT clear chat</span></div>
            <div><span class="help-rank mod">MOD (3)</span> <span class="help-desc">- Can see messages from rank 4-5, Video enabled, Can ban rank 4-5, Can warn users</span></div>
            <div><span class="help-rank vip">VIP (4)</span> <span class="help-desc">- Can see only their own messages, Video enabled, AI access, Image generation, Can set room themes</span></div>
            <div><span class="help-rank member">MEMBER (5)</span> <span class="help-desc">- Can see only their own messages, Video disabled, AI disabled, Image disabled</span></div>
        </div>
        
        ${!isVerified ? `
        <div class="help-section">
            <div class="help-title">⚠️ UNVERIFIED ACCOUNT</div>
            <div style="color: #f97316; font-size: 12px;">
                • You can only send 5 messages per 10 minutes<br>
                • Verify your email to remove this limit
            </div>
        </div>
        ` : ''}
        
        ${isVip ? `
        <div class="help-section">
            <div class="help-title">⭐ VIP+ COMMANDS</div>
            <div><span class="help-command">/theme &lt;name&gt;</span> <span class="help-desc">- Change theme (personal)</span></div>
            <div><span class="help-command">/roomtheme &lt;name&gt;</span> <span class="help-desc">- Change room theme (VIP+)</span></div>
            <div><span class="help-command">/video</span> <span class="help-desc">- Toggle video chat</span></div>
            <div><span class="help-command">/ai &lt;prompt&gt;</span> <span class="help-desc">- Ask AI anything</span></div>
            <div><span class="help-command">/cloak &lt;title&gt;</span> <span class="help-desc">- Change browser tab title</span></div>
        </div>
        ` : ''}
        
        ${isModerator ? `
        <div class="help-section">
            <div class="help-title">🛡️ MODERATOR+ COMMANDS</div>
            <div><span class="help-command">/ban &lt;user&gt; [duration]</span> <span class="help-desc">- Ban user (default 10m) - Can ban users with lower rank (VIP, Member)</span></div>
            <div><span class="help-command">/mute &lt;user&gt; [duration]</span> <span class="help-desc">- Mute user - Can mute users with lower rank</span></div>
            <div><span class="help-command">/unmute &lt;user&gt;</span> <span class="help-desc">- Unmute user</span></div>
            <div><span class="help-command">/warn &lt;user&gt;</span> <span class="help-desc">- Warn a user (sends red system message)</span></div>
            <div><span class="help-command">/effect off</span> <span class="help-desc">- Stop all effects</span></div>
        </div>
        ` : ''}
        
        ${isAdmin ? `
        <div class="help-section">
            <div class="help-title">👮 ADMIN+ COMMANDS</div>
            <div><span class="help-command">/unban &lt;user&gt;</span> <span class="help-desc">- Unban user</span></div>
            <div><span class="help-command">/delete room &lt;room&gt;</span> <span class="help-desc">- Delete any room</span></div>
            <div><span class="help-command">/delete user &lt;user&gt;</span> <span class="help-desc">- Delete a user account</span></div>
            <div><span class="help-command">/grant &lt;user&gt; &lt;rank&gt;</span> <span class="help-desc">- Grant mod/vip/member (CANNOT grant admin)</span></div>
            <div><span class="help-command">/ban &lt;user&gt; [duration]</span> <span class="help-desc">- Can ban rank 3-5 (Mod, VIP, Member)</span></div>
        </div>
        ` : ''}
        
        ${isOwner ? `
        <div class="help-section">
            <div class="help-title">👑 OWNER COMMANDS</div>
            <div><span class="help-command">/grant &lt;user&gt; admin</span> <span class="help-desc">- Grant admin rank (owner only)</span></div>
            <div><span class="help-command">/clear</span> <span class="help-desc">- Clear all messages including private (Owner only) - Also clears from database</span></div>
            <div><span class="help-command">/ban &lt;user&gt; [duration]</span> <span class="help-desc">- Can ban anyone (including admins)</span></div>
            <div><span class="help-command">/delete user &lt;user&gt;</span> <span class="help-desc">- Delete any user (including admins)</span></div>
        </div>
        ` : ''}
        
        ${isAdmin || isOwner || isModerator || isVip ? `
        <div class="help-section">
            <div class="help-title">🎮 EFFECT COMMANDS (VIP+)</div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px;">
                <div><span class="help-command">/effect glitch</span> <span class="help-desc">- Glitch (VIP+)</span></div>
                <div><span class="help-command">/effect flashbang</span> <span class="help-desc">- Flash</span></div>
                <div><span class="help-command">/effect black</span> <span class="help-desc">- Blackout</span></div>
                <div><span class="help-command">/effect hack</span> <span class="help-desc">- Hacker</span></div>
                <div><span class="help-command">/effect matrix</span> <span class="help-desc">- Matrix (falling binary code)</span></div>
                <div><span class="help-command">/effect rainbow</span> <span class="help-desc">- Rainbow</span></div>
                <div><span class="help-command">/effect neon</span> <span class="help-desc">- Neon</span></div>
                <div><span class="help-command">/effect firework</span> <span class="help-desc">- Fireworks</span></div>
                <div><span class="help-command">/effect confetti</span> <span class="help-desc">- Confetti</span></div>
                <div><span class="help-command">/effect off</span> <span class="help-desc">- Stop all effects</span></div>
            </div>
        </div>
        ` : ''}
        
        <div style="text-align: center; margin-top: 15px; color: #888; font-size: 11px; border-top: 1px solid rgba(102,126,234,0.3); padding-top: 10px;">
            🤖 AI command available for VIP+ • 🔔 Notifications work in background<br>
            ⚡ Rank levels: Owner(1) > Admin(2) > Moderator(3) > VIP(4) > Member(5)<br>
            📧 Email: misha037@hsd.k12.or.us registers as owner (max 5 accounts) • Links appear in red
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';
    wrapper.appendChild(helpDiv);
    msgContainer.appendChild(wrapper);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

// ========== ENHANCED USERS COMMAND ==========

function handleUsersCommand() {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'msg system';
    loadingMsg.textContent = '👥 Fetching user list...';
    loadingMsg.style.animation = 'pulse 1.5s infinite';
    msgContainer.appendChild(loadingMsg);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    socket.emit('get_user_list', { roomName: currentRoom });
}

socket.on('user_list', (data) => {
    if (data.error) {
        addSystemMessage(`❌ ${data.error}`);
        return;
    }

    const loadingMsg = document.querySelector('.msg.system:last-child');
    if (loadingMsg && loadingMsg.textContent.includes('Fetching user list')) {
        loadingMsg.remove();
    }

    const userListDiv = document.createElement('div');
    userListDiv.className = 'msg system help-menu';

    const currentRoomName = data.currentRoom || currentRoom || 'Unknown';

    const totalInRoom = data.roomUsers?.length || 0;
    const totalOnlineElsewhere = data.otherRoomUsers?.length || 0;
    const totalOffline = data.notOnlineUsers?.length || 0;
    const totalUsers = totalInRoom + totalOnlineElsewhere + totalOffline;

    userListDiv.innerHTML = `
        <div style="text-align: center; margin-bottom: 15px;">
            <span style="font-size: 24px;">👥</span>
            <span style="font-weight: bold; font-size: 20px; color: gold;"> USER DIRECTORY</span>
            <span style="font-size: 24px;">📋</span>
        </div>
        
        <div style="text-align: center; margin-bottom: 20px; padding: 10px; background: rgba(102, 126, 234, 0.2); border-radius: 12px;">
            <span style="font-size: 16px; color: #4ade80;">📍 Current Room: </span>
            <span style="font-size: 18px; font-weight: bold; color: white;">${currentRoomName}</span>
            <div style="display: flex; justify-content: center; gap: 20px; margin-top: 8px; font-size: 13px;">
                <span><span style="color: #4ade80;">🟢</span> ${totalInRoom} in room</span>
                <span><span style="color: #ffaa00;">🟡</span> ${totalOnlineElsewhere} elsewhere</span>
                <span><span style="color: #ff4444;">🔴</span> ${totalOffline} offline</span>
                <span><span style="color: #888;">👥</span> ${totalUsers} total</span>
            </div>
        </div>
        
        ${data.roomUsers && data.roomUsers.length > 0 ? `
        <div class="help-section">
            <div class="help-title">
                <span>🟢 IN THIS ROOM</span>
                <span style="font-size: 12px; color: #888;">(${data.roomUsers.length})</span>
            </div>
            ${data.roomUsers.map(user => {
        let extraInfo = '';
        if (isAdmin || isOwner) {
            extraInfo = `<div style="font-size: 10px; color: #888;">📧 ${user.email || 'No email'} | 👤 ${user.fullName || ''}</div>`;
        } else if (isModerator) {
            extraInfo = `<div style="font-size: 10px; color: #888;">👤 ${user.fullName || ''}</div>`;
        }
        return `
                            <div style="display: flex; align-items: center; margin: 8px 0; padding: 6px 10px; background: rgba(74, 222, 128, 0.1); border-radius: 8px;">
                                <span style="font-size: 16px; margin-right: 10px;">🟢</span>
                                <div style="flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-weight: bold; color: #4ade80;">${user.username}</span>
                                        ${getRankBadge(user.rank)}
                                        <span style="font-size: 11px; color: #888;">Level ${getRankLevel(user.rank)}</span>
                                    </div>
                                    ${extraInfo}
                                </div>
                            </div>
                        `;
    }).join('')}
        </div>
        ` : ''}
        
        ${data.otherRoomUsers && data.otherRoomUsers.length > 0 ? `
        <div class="help-section">
            <div class="help-title">
                <span>🟡 ONLINE ELSEWHERE</span>
                <span style="font-size: 12px; color: #888;">(${data.otherRoomUsers.length})</span>
            </div>
            ${data.otherRoomUsers.map(user => {
        let extraInfo = '';
        if (isAdmin || isOwner) {
            extraInfo = `<div style="font-size: 10px; color: #888;">📧 ${user.email || 'No email'} | 👤 ${user.fullName || ''}</div>`;
        } else if (isModerator) {
            extraInfo = `<div style="font-size: 10px; color: #888;">👤 ${user.fullName || ''}</div>`;
        }
        return `
                            <div style="display: flex; align-items: center; margin: 8px 0; padding: 6px 10px; background: rgba(255, 170, 0, 0.1); border-radius: 8px;">
                                <span style="font-size: 16px; margin-right: 10px;">🟡</span>
                                <div style="flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-weight: bold; color: #ffaa00;">${user.username}</span>
                                        ${getRankBadge(user.rank)}
                                        <span style="font-size: 11px; background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 12px;">
                                            📍 ${user.room}
                                        </span>
                                    </div>
                                    ${extraInfo}
                                </div>
                            </div>
                        `;
    }).join('')}
        </div>
        ` : ''}
        
        ${data.notOnlineUsers && data.notOnlineUsers.length > 0 ? `
        <div class="help-section">
            <div class="help-title">
                <span>🔴 OFFLINE</span>
                <span style="font-size: 12px; color: #888;">(${data.notOnlineUsers.length})</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
                ${data.notOnlineUsers.map(user => {
        let extraInfo = '';
        if (isAdmin || isOwner) {
            extraInfo = `<div style="font-size: 10px; color: #888;">📧 ${user.email || 'No email'}</div>`;
        } else if (isModerator) {
            extraInfo = `<div style="font-size: 10px; color: #888;">👤 ${user.fullName || ''}</div>`;
        }
        return `
                            <div style="display: flex; flex-direction: column; padding: 8px; background: rgba(255, 68, 68, 0.1); border-radius: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 14px;">🔴</span>
                                    <span style="color: #ff8888;">${user.username}</span>
                                    ${getRankBadge(user.rank)}
                                </div>
                                ${extraInfo}
                            </div>
                        `;
    }).join('')}
            </div>
        </div>
        ` : ''}
        
        ${data.roomUsers?.length === 0 && data.otherRoomUsers?.length === 0 && data.notOnlineUsers?.length === 0 ? `
        <div style="text-align: center; padding: 30px; color: #888;">
            <span style="font-size: 48px; display: block; margin-bottom: 10px;">👤</span>
            No other users found
        </div>
        ` : ''}
        
        <div style="text-align: center; margin-top: 15px; color: #888; font-size: 11px; border-top: 1px solid rgba(102,126,234,0.3); padding-top: 10px;">
            <span>🟢 In this room</span> • 
            <span>🟡 Online elsewhere</span> • 
            <span>🔴 Offline</span>
            ${isAdmin || isOwner ? '<br>📧 Email shown for Admin+' : ''}
            ${isModerator ? '<br>👤 Name shown for Moderator+' : ''}
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';
    wrapper.appendChild(userListDiv);

    msgContainer.appendChild(wrapper);
    msgContainer.scrollTop = msgContainer.scrollHeight;
});

function handleMsgCommand(args) {
    if (args.length < 2) {
        addSystemMessage('Usage: /msg <username> <message>');
        return;
    }
    const recipient = args[0];
    const message = args.slice(1).join(' ');
    const recipientExists = onlineUsers.some(u => u.username === recipient);
    if (!recipientExists) {
        addSystemMessage(`❌ User '${recipient}' not found in room`);
        return;
    }
    socket.emit('private_message', {
        recipient,
        message,
        senderRank: currentRank,
        senderRankLevel: getRankLevel(currentRank)
    });
}

function handleClearCommand(args) {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }

    if (!isOwner) {
        addSystemMessage('❌ Only the Owner can use /clear command');
        return;
    }

    socket.emit('clear_messages', {
        roomName: currentRoom,
        password: ''
    });
}

function handleFlipCommand() {
    const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    socket.emit('chat message', { username: 'System', message: `🪙 ${currentUsername} flipped a coin... ${result}!` });
}

function handleRollCommand(args) {
    if (args.length < 2) {
        addSystemMessage('Usage: /roll <min> <max>');
        return;
    }
    const min = parseInt(args[0]);
    const max = parseInt(args[1]);
    if (isNaN(min) || isNaN(max)) {
        addSystemMessage('❌ Invalid numbers');
        return;
    }
    if (min >= max) {
        addSystemMessage('❌ Min must be less than max');
        return;
    }
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    socket.emit('chat message', { username: 'System', message: `🎲 ${currentUsername} rolled... ${result}!` });
}

function handleBanCommand(args) {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }
    if (!isModerator && !isAdmin && !isOwner) {
        addSystemMessage('❌ You do not have permission');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /ban <username> [duration]');
        return;
    }
    const targetUser = args[0];
    const targetRank = onlineUsers.find(u => u.username === targetUser)?.rank || 'member';
    const targetLevel = getRankLevel(targetRank);
    const userLevel = getRankLevel(currentRank);

    if (targetRank === 'admin' && !isOwner) {
        addSystemMessage('❌ Cannot ban other admins');
        return;
    }

    if (targetLevel <= userLevel && currentRank !== 'owner') {
        addSystemMessage('❌ Cannot ban users of equal or higher rank');
        return;
    }

    let duration = '10m';
    if (args.length >= 2) {
        if (/^\d+[hmd]?$/.test(args[1])) {
            duration = args[1];
        }
    }

    socket.emit('ban_user', {
        roomName: currentRoom,
        bannedUser: targetUser,
        duration,
        bannerName: currentUsername,
        password: ''
    });
    addSystemMessage(`⛔ Banning ${targetUser} for ${duration}...`);
}

function handleMuteCommand(args) {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }
    if (!isModerator && !isAdmin && !isOwner) {
        addSystemMessage('❌ You do not have permission');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /mute <username> [duration]');
        return;
    }
    const targetUser = args[0];
    const targetRank = onlineUsers.find(u => u.username === targetUser)?.rank || 'member';
    const targetLevel = getRankLevel(targetRank);
    const userLevel = getRankLevel(currentRank);

    if (targetRank === 'admin' && !isOwner) {
        addSystemMessage('❌ Cannot mute other admins');
        return;
    }

    if (targetLevel <= userLevel && currentRank !== 'owner') {
        addSystemMessage('❌ Cannot mute users of equal or higher rank');
        return;
    }

    let duration = '10m';
    if (args.length >= 2 && /^\d+[hmd]?$/.test(args[1])) {
        duration = args[1];
    }
    socket.emit('mute_user', {
        roomName: currentRoom,
        mutedUser: targetUser,
        duration,
        muterName: currentUsername
    });
    addSystemMessage(`🔇 Muting ${targetUser} for ${duration}...`);
}

function handleWarnCommand(args) {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }
    if (!isModerator && !isAdmin && !isOwner) {
        addSystemMessage('❌ You do not have permission');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /warn <username>');
        return;
    }
    const targetUser = args[0];

    if (targetUser === currentUsername) {
        addSystemMessage('❌ Cannot warn yourself');
        return;
    }

    const targetRank = onlineUsers.find(u => u.username === targetUser)?.rank || 'member';
    const targetLevel = getRankLevel(targetRank);
    const userLevel = getRankLevel(currentRank);

    if (targetRank === 'admin' && !isOwner) {
        addSystemMessage('❌ Cannot warn other admins');
        return;
    }

    if (targetLevel <= userLevel && currentRank !== 'owner') {
        addSystemMessage('❌ Cannot warn users of equal or higher rank');
        return;
    }

    socket.emit('warn_user', {
        targetUser,
        roomName: currentRoom,
        warnerName: currentUsername
    });

    addSystemMessage(`⚠️ Warning sent to ${targetUser}`);
}

function handleUnmuteCommand(args) {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }
    if (!isModerator && !isAdmin && !isOwner) {
        addSystemMessage('❌ You do not have permission');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /unmute <username>');
        return;
    }
    socket.emit('unmute_user', {
        roomName: currentRoom,
        unmutedUser: args[0],
        unmuterName: currentUsername
    });
    addSystemMessage(`🔓 Unmuting ${args[0]}...`);
}

function handleUnbanCommand(args) {
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }
    if (!isAdmin && !isOwner) {
        addSystemMessage('❌ Only admins can unban');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /unban <username>');
        return;
    }
    socket.emit('unban_user', {
        roomName: currentRoom,
        unbannedUser: args[0],
        unbannerName: currentUsername,
        password: ''
    });
    addSystemMessage(`✅ Unbanning ${args[0]}...`);
}

function handleDeleteCommand(args) {
    if (!isAdmin && !isOwner) {
        addSystemMessage('❌ Only admins can delete');
        return;
    }
    if (args.length < 2) {
        addSystemMessage('Usage: /delete <user|room> <name>');
        return;
    }

    const type = args[0].toLowerCase();
    const name = args[1];

    if (type === 'room') {
        if (name === 'Main') {
            addSystemMessage('❌ Cannot delete Main room');
            return;
        }
        socket.emit('delete_room', { roomName: name, password: '' });
        addSystemMessage(`🗑️ Deleting room: ${name}`);
    } else if (type === 'user') {
        if (name === 'Pi_Kid71') {
            addSystemMessage('❌ Cannot delete owner');
            return;
        }
        socket.emit('delete_user', { targetUser: name });
        addSystemMessage(`🗑️ Deleting user: ${name}`);
    } else {
        addSystemMessage('Usage: /delete <user|room> <name>');
    }
}

function handleEffectCommand(args) {
    if (!isAdmin && !isOwner && !isModerator && !isVip) {
        addSystemMessage('❌ You do not have permission to use effects');
        return;
    }
    if (!currentRoom) {
        addSystemMessage('❌ Not in a room');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /effect <name>');
        return;
    }
    const effect = args[0].toLowerCase();

    if (effect === 'off') {
        stopAllEffects();
        return;
    }

    socket.emit('effect_command', { effect, roomName: currentRoom });
}

function handleThemeCommand(args) {
    if (!isVip) {
        addSystemMessage('❌ VIP+ only can change themes');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /theme <name>');
        return;
    }
    const theme = args[0].toLowerCase();
    changeTheme(theme, 'personal');
}

function handleRoomThemeCommand(args) {
    if (!isVip) {
        addSystemMessage('❌ VIP+ only can change room themes');
        return;
    }
    if (!currentRoom) {
        addSystemMessage('❌ You must be in a room to change its theme');
        return;
    }
    if (args.length < 1) {
        addSystemMessage('Usage: /roomtheme <name>');
        return;
    }
    const theme = args[0].toLowerCase();
    changeTheme(theme, 'room');
}

function handleGrantCommand(args) {
    if (!isAdmin && !isOwner) {
        addSystemMessage('❌ Only admins can grant ranks');
        return;
    }
    if (args.length < 2) {
        addSystemMessage('Usage: /grant <username> <rank>');
        return;
    }
    const targetUser = args[0];
    const newRank = args[1].toLowerCase();

    if (newRank === 'admin' && !isOwner) {
        addSystemMessage('❌ Only the owner can grant admin rank');
        return;
    }

    const validRanks = isOwner ? ['admin', 'moderator', 'vip', 'member'] : ['moderator', 'vip', 'member'];
    if (!validRanks.includes(newRank)) {
        addSystemMessage(`❌ You can only grant: ${validRanks.join(', ')}`);
        return;
    }

    socket.emit('grant_rank', { targetUser, newRank, password: '' });
}

function handleRankCommand() {
    addSystemMessage(`Your rank: ${currentRank.toUpperCase()} (Rank ${getRankLevel(currentRank)}/5) ${isVerified ? '✓ Verified' : '✗ Unverified'}`);
}

function handlePingCommand() {
    const start = Date.now();
    socket.emit('ping', () => {
        const latency = Date.now() - start;
        addSystemMessage(`🏓 Pong! Latency: ${latency}ms`);
    });
}

// ========== CLOAK COMMAND ==========

function handleCloakCommand(args) {
    if (!isVip) {
        addSystemMessage('❌ Cloak command requires VIP+ rank');
        return;
    }
    if (!args || args.length === 0) {
        addSystemMessage('❌ Usage: /cloak <title>');
        return;
    }
    const title = args.join(' ');
    document.title = title;
    showToast(`🪄 Tab title changed to: ${title}`);
}

// ========== AI COMMAND HANDLER ==========

async function handleAICommand(args) {
    if (!isVip) {
        addSystemMessage('❌ AI command requires VIP+ rank');
        return;
    }

    if (isUserMuted) {
        addSystemMessage('❌ You are muted and cannot use AI');
        return;
    }

    if (args.length < 1) {
        addSystemMessage('Usage: /ai <your question or prompt>');
        return;
    }

    const prompt = args.join(' ');
    await askAI(prompt);
}

// ========== COMMAND HANDLER ==========

function handleCommand(commandText) {
    const parts = commandText.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
        case '/help': showHelp(); return true;
        case '/users': handleUsersCommand(); return true;
        case '/ping': handlePingCommand(); return true;
        case '/flip': handleFlipCommand(); return true;
        case '/roll': handleRollCommand(args); return true;
    }

    if (checkIfUserMuted() || checkIfDeviceMuted()) {
        addSystemMessage('❌ You are muted and cannot use commands');
        return false;
    }

    switch (command) {
        case '/msg': handleMsgCommand(args); break;
        case '/clear': handleClearCommand(args); break;
        case '/ban': handleBanCommand(args); break;
        case '/mute': handleMuteCommand(args); break;
        case '/warn': handleWarnCommand(args); break;
        case '/unmute': handleUnmuteCommand(args); break;
        case '/unban': handleUnbanCommand(args); break;
        case '/delete': handleDeleteCommand(args); break;
        case '/effect': handleEffectCommand(args); break;
        case '/theme': handleThemeCommand(args); break;
        case '/roomtheme': handleRoomThemeCommand(args); break;
        case '/grant': handleGrantCommand(args); break;
        case '/rank': handleRankCommand(); break;
        case '/video': toggleVideoChat(); break;
        case '/ai': handleAICommand(args); break;
        case '/cloak': handleCloakCommand(args); break;
        default:
            addSystemMessage(`❌ Unknown command: ${command}. Type /help for commands.`);
            return false;
    }
    return true;
}

// ========== EFFECTS ==========

socket.on('room_effect', (data) => {
    addSystemMessage(`✨ ${data.triggeredBy} triggered: ${data.effect}`);

    if (currentEffect !== data.effect) {
        stopAllEffects();
        currentEffect = data.effect;
    }

    switch (data.effect) {
        case 'glitch':
            document.body.classList.add('glitch');
            break;
        case 'flashbang':
            document.body.classList.add('flashbang');
            setTimeout(() => document.body.classList.remove('flashbang'), 1000);
            break;
        case 'black':
            document.body.classList.add('black');
            break;
        case 'hack':
            document.body.classList.add('hack-effect');
            break;
        case 'matrix':
            document.body.classList.add('matrix');
            startMatrixEffect();
            break;
        case 'rainbow':
            document.body.classList.add('rainbow');
            break;
        case 'neon':
            document.body.classList.add('neon-effect');
            break;
        case 'firework':
            document.body.classList.add('firework');
            setTimeout(() => document.body.classList.remove('firework'), 2000);
            break;
        case 'confetti':
            for (let i = 0; i < 100; i++) {
                setTimeout(() => createConfetti(), i * 10);
            }
            break;
        case 'gameroom':
            document.body.classList.add('gameroom');
            break;
    }
});

function triggerEffect(effect) {
    socket.emit('effect_command', { effect, roomName: currentRoom });
    closeModal('effectsModal');
}

function createConfetti() {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.background = `hsl(${Math.random() * 360}, 100%, 50%)`;
    confetti.style.animationDelay = Math.random() * 2 + 's';
    confetti.style.width = Math.random() * 10 + 5 + 'px';
    confetti.style.height = Math.random() * 10 + 5 + 'px';
    confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3000);
}

// ========== THEMES ==========

function showThemeSelector() {
    showModal('themeModal');
}

function changeTheme(theme, scope = 'personal') {
    document.body.setAttribute('data-theme', theme);
    currentTheme = theme;

    if (scope === 'room' && isVip && currentRoom) {
        socket.emit('change_theme', { theme, scope: 'room' });
        showToast(`🎨 Room theme changed to: ${theme}`);
    } else {
        showToast(`🎨 Personal theme changed to: ${theme}`);
    }
}

// ========== USER LIST ==========

function showUserList() {
    showModal('userListModal');
    socket.emit('get_room_users', { roomName: currentRoom });
}

socket.on('room_users', (data) => {
    onlineUsers = data.users.filter(u => u.username !== currentUsername);

    const select = document.getElementById('pmRecipientSelect');
    if (select) {
        select.innerHTML = '<option value="">Select user...</option>';
        onlineUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.username;
            option.innerHTML = `${user.username} ${getRankBadge(user.rank)}`;
            select.appendChild(option);
        });
    }

    updateUserListModal(data.users);
});

function updateUserListModal(users) {
    const content = document.getElementById('userListContent');
    if (!content) return;

    let html = '';
    users.forEach(user => {
        const userLevel = getRankLevel(user.rank);
        const currentUserLevel = getRankLevel(currentRank);
        const userData = allUsersData.get(user.username) || {};

        let extraInfo = '';
        if (isAdmin || isOwner) {
            extraInfo = `<div class="user-email">📧 ${userData.email || 'No email'} | 👤 ${userData.fullName || ''}</div>`;
        } else if (isModerator) {
            extraInfo = `<div class="user-email">👤 ${userData.fullName || ''}</div>`;
        }

        const canWarn = isModerator && userLevel > currentUserLevel && user.rank !== 'admin';
        const canBan = isModerator && userLevel > currentUserLevel && user.rank !== 'admin';

        html += `
            <div class="user-list-item">
                <div class="user-info-modal">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span>${user.username}</span>
                            ${getRankBadge(user.rank)}
                            <span style="font-size: 10px; color: #888;">Rank ${userLevel}</span>
                        </div>
                        ${extraInfo}
                    </div>
                </div>
                <div class="user-actions">
                    ${canWarn ? `
                        <button class="action-btn warning" style="padding: 4px 8px; font-size: 12px;" onclick="quickWarn('${user.username}')">⚠️</button>
                    ` : ''}
                    ${canBan ? `
                        <button class="action-btn danger" style="padding: 4px 8px; font-size: 12px;" onclick="quickBan('${user.username}')">⛔</button>
                    ` : ''}
                    <button class="action-btn" style="padding: 4px 8px; font-size: 12px;" onclick="quickMsg('${user.username}')">💌</button>
                </div>
            </div>
        `;
    });

    content.innerHTML = html || '<div style="text-align: center; color: #888; padding: 20px;">No users in room</div>';
}

function quickWarn(username) {
    if (username === currentUsername) {
        showToast('❌ Cannot warn yourself');
        return;
    }
    const targetRank = onlineUsers.find(u => u.username === username)?.rank || 'member';
    const targetLevel = getRankLevel(targetRank);
    const userLevel = getRankLevel(currentRank);

    if (targetRank === 'admin' && !isOwner) {
        showToast('❌ Cannot warn other admins');
        return;
    }

    if (targetLevel <= userLevel && currentRank !== 'owner') {
        showToast('❌ Cannot warn users of equal or higher rank');
        return;
    }

    socket.emit('warn_user', {
        targetUser: username,
        roomName: currentRoom,
        warnerName: currentUsername
    });
    closeModal('userListModal');
    showToast(`⚠️ Warning sent to ${username}`);
}

function quickBan(username) {
    if (username === currentUsername) {
        showToast('❌ Cannot ban yourself');
        return;
    }
    const targetRank = onlineUsers.find(u => u.username === username)?.rank || 'member';
    const targetLevel = getRankLevel(targetRank);
    const userLevel = getRankLevel(currentRank);

    if (targetRank === 'admin' && !isOwner) {
        showToast('❌ Cannot ban other admins');
        return;
    }

    if (targetLevel <= userLevel && currentRank !== 'owner') {
        showToast('❌ Cannot ban users of equal or higher rank');
        return;
    }
    const duration = prompt('Ban duration (e.g., 10m, 1h, 1d):', '10m');
    if (duration) {
        socket.emit('ban_user', {
            roomName: currentRoom,
            bannedUser: username,
            duration,
            bannerName: currentUsername,
            password: ''
        });
        closeModal('userListModal');
    }
}

function quickMsg(username) {
    closeModal('userListModal');
    showModal('privateMessagesModal');
    document.getElementById('pmRecipient').value = username;
    document.getElementById('pmRecipientSelect').value = username;
    document.getElementById('pmMessage').focus();
}

// ========== PRIVATE MESSAGES ==========

function showPrivateMessages() {
    showModal('privateMessagesModal');
    loadPrivateMessageHistory();
    updateOnlineUsersList();
}

function updateOnlineUsersList() {
    const select = document.getElementById('pmRecipientSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select user...</option>';
    onlineUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user.username;
        option.innerHTML = `${user.username} ${getRankBadge(user.rank)}`;
        select.appendChild(option);
    });
}

function sendPrivateMessage() {
    const recipient = document.getElementById('pmRecipient').value.trim() ||
        document.getElementById('pmRecipientSelect').value;
    const message = document.getElementById('pmMessage').value.trim();

    if (!recipient || !message) {
        showToast('❌ Please enter recipient and message');
        return;
    }

    if (recipient === currentUsername) {
        showToast('❌ Cannot send private message to yourself');
        return;
    }

    socket.emit('private_message', {
        recipient,
        message,
        senderRank: currentRank,
        senderRankLevel: getRankLevel(currentRank)
    });

    document.getElementById('pmMessage').value = '';
    addPrivateMessage(currentUsername, message, recipient, true);
    addToPrivateMessagesList(currentUsername, message, recipient, true);
}

function addToPrivateMessagesList(from, message, to, isFromSelf = false, isAdminView = false) {
    const pmList = document.getElementById('privateMessagesList');
    if (!pmList) return;

    const msgDiv = document.createElement('div');
    msgDiv.style.padding = '10px';
    msgDiv.style.borderBottom = '1px solid #333';

    let bgColor = 'rgba(102,126,234,0.1)';
    if (isFromSelf) bgColor = 'rgba(74, 222, 128, 0.1)';
    else if (to === currentUsername) bgColor = 'rgba(255, 153, 255, 0.1)';
    else if (isAdminView) bgColor = 'rgba(255, 215, 0, 0.1)';

    msgDiv.style.background = bgColor;

    const fromRank = onlineUsers.find(u => u.username === from)?.rank || 'member';

    msgDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span style="color: ${isFromSelf ? '#4ade80' : '#ff99ff'};">
                    ${isFromSelf ? 'You' : from} → ${to === currentUsername ? 'You' : to}
                </span>
                ${getRankBadge(fromRank)}
                ${isAdminView ? '<span style="color: gold; font-size: 10px; margin-left: 5px;">(admin)</span>' : ''}
            </div>
            <span style="color: #888; font-size: 11px;">${new Date().toLocaleTimeString()}</span>
        </div>
        <div style="margin-top: 5px; color: #fff;">${message}</div>
        <div style="font-size: 10px; color: #888; margin-top: 4px;">🔒 Private message</div>
    `;

    pmList.insertBefore(msgDiv, pmList.firstChild);
}

socket.on('private_message', (data) => {
    const result = canViewerSeePrivate(data);
    if (!result.show) return;

    const { from, message, to } = data;
    addPrivateMessage(from, message, to, from === currentUsername, result.adminView);
    addToPrivateMessagesList(from, message, to, from === currentUsername, result.adminView);

    if (to === currentUsername) {
        sendNotification('💌 Private Message', `${from}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
        showToast(`💌 New message from ${from}`);
    } else if (result.adminView) {
    }
});

socket.on('private_message_sent', (data) => {
    showToast(`💌 Message sent to ${data.to}`);
});

function loadPrivateMessageHistory() {
    const pmList = document.getElementById('privateMessagesList');
    if (pmList) pmList.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">Loading messages...</div>';
    socket.emit('get_private_history');
}

socket.on('private_history', (data) => {
    const pmList = document.getElementById('privateMessagesList');
    if (!pmList) return;

    pmList.innerHTML = '';

    if (data.messages && data.messages.length > 0) {
        data.messages.reverse().forEach(msg => {
            const result = canViewerSeePrivate(msg);
            if (result.show) {
                const isFromSelf = msg.from === currentUsername;
                addToPrivateMessagesList(msg.from, msg.message, msg.to, isFromSelf, result.adminView);
            }
        });
    } else {
        pmList.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">No messages yet</div>';
    }
});

// ========== ROOM MANAGEMENT ==========

function leaveRoom() {
    if (isVoiceActive && voiceChat) {
        voiceChat.stop();
        isVoiceActive = false;
    }
    if (isVideoActive && videoChat) {
        videoChat.stop();
        isVideoActive = false;
    }
    socket.emit('leave_room');
    currentRoom = null;
    roomScreen.style.display = 'flex';
    chatScreen.style.display = 'none';
    loadRooms();
    showToast('🚪 Left room');
}

// ========== SOCKET EVENT HANDLERS ==========

socket.on('error', (data) => {
    showToast('❌ ' + data.message);
});

socket.on('command_error', (data) => {
    addSystemMessage('❌ ' + data.message);
});

socket.on('command_success', (data) => {
    addSystemMessage('✅ ' + data.message);
});

socket.on('messages_cleared', (data) => {
    if (data && data.roomName && data.roomName !== currentRoom) return;
    msgContainer.innerHTML = '';
    addSystemMessage('🧹 All messages cleared from chat and database');
});

socket.on('private_messages_cleared', () => {
    privateMessages = [];
    const pmList = document.getElementById('privateMessagesList');
    if (pmList) pmList.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">No messages yet</div>';
});

socket.on('user_banned', (data) => {
    if (data.bannedUser === currentUsername) {
        showToast(`⛔ You have been banned for ${data.duration || '10m'}`);
        if (isVideoActive && videoChat) {
            videoChat.stop();
            isVideoActive = false;
        }
        setTimeout(() => leaveRoom(), 2000);
    }
});

socket.on('device_muted', (data) => {
    isDeviceMuted = true;
    const durationMs = parseDurationClient(data.duration || '10m');
    deviceMuteExpiresAt = Date.now() + durationMs;
    showToast(`🔇 This device has been muted for ${data.duration || '10m'}`);
    if (isVideoActive && videoChat) {
        videoChat.setMutedStatus(true);
        videoChat.stop();
        isVideoActive = false;
    }
});

socket.on('device_unmuted', () => {
    isDeviceMuted = false;
    deviceMuteExpiresAt = 0;
    showToast('✅ Device mute lifted');
});

socket.on('user_unbanned', (data) => {
    addSystemMessage(`✅ ${data.unbannedUser} unbanned by ${data.unbannerName}`);
});

socket.on('user_muted', (data) => {
    if (data.mutedUser === currentUsername) {
        isUserMuted = true;
        const durationMs = parseDurationClient(data.duration || '10m');
        muteExpiresAt = Date.now() + durationMs;
        showToast(`🔇 You have been muted for ${data.duration || '10m'}`);

        if (isVideoActive && videoChat) {
            videoChat.setMutedStatus(true);
            videoChat.stop();
            isVideoActive = false;
        }
    }
    addSystemMessage(`🔇 ${data.mutedUser} has been muted for ${data.duration || '10m'}`);
});

socket.on('user_unmuted', (data) => {
    if (data.unmutedUser === currentUsername) {
        isUserMuted = false;
        muteExpiresAt = 0;
        showToast(`🔓 You have been unmuted`);
    }
    addSystemMessage(`🔓 ${data.unmutedUser} has been unmuted by ${data.unmuterName}`);
});

socket.on('force_leave', (data) => {
    if (data.reason === 'banned') {
        showToast('⛔ You have been banned');
        if (isVideoActive && videoChat) {
            videoChat.stop();
            isVideoActive = false;
        }
        setTimeout(() => leaveRoom(), 1000);
    }
});

socket.on('device_banned', () => {
    showToast('⛔ This device has been banned');
    setTimeout(() => {
        socket.disconnect();
        location.reload();
    }, 1500);
});

socket.on('room_deleted_by_owner', (data) => {
    showToast(`🗑️ Room "${data.roomName}" deleted`);
    if (currentRoom === data.roomName) {
        setTimeout(() => leaveRoom(), 2000);
    }
});

socket.on('theme_applied', (data) => {
    if (data.scope === 'room') {
        addSystemMessage(`🎨 Room theme changed to ${data.theme} by ${data.changedBy}`);
        document.body.setAttribute('data-theme', data.theme);
        document.getElementById('room-theme-indicator').innerHTML = `🎨 ${data.theme}`;
    }
});

socket.on('system_notification', (data) => {
    addSystemMessage(data.message, data.timestamp);
    showToast(data.message);
    sendNotification('System', data.message);
});

socket.on('ping', (cb) => {
    if (cb) cb();
});

socket.on('video_error', (data) => {
    showToast(`❌ ${data.message}`);
});

// ========== UI EVENT LISTENERS ==========

input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById('loginUsername')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
});
document.getElementById('loginPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
});
document.getElementById('regFullName')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister();
});
document.getElementById('regEmail')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister();
});
document.getElementById('regUsername')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister();
});
document.getElementById('regPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister();
});
document.getElementById('regConfirmPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister();
});
document.getElementById('verificationCode')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verifyCode();
});

document.getElementById('pmRecipientSelect')?.addEventListener('change', (e) => {
    document.getElementById('pmRecipient').value = e.target.value;
});

// ========== DEVICE IDENTIFICATION ==========

function getDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
        id = 'dev-' + Math.random().toString(36).substr(2, 12);
        localStorage.setItem('deviceId', id);
    }
    return id;
}

deviceId = getDeviceId();

['loginUsername', 'regUsername', 'newRoomName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', e => {
            e.target.value = e.target.value.replace(/\s+/g, '_');
        });
    }
});

// ========== AUTO-LOGIN FROM COOKIES ==========

function checkSavedLogin() {
    const savedUsername = getCookie('username');
    const savedPassword = getCookie('password');
    const rememberMe = getCookie('rememberMe');

    if (savedUsername && savedPassword && rememberMe === 'true') {
        document.getElementById('loginUsername').value = savedUsername;
        document.getElementById('loginPassword').value = savedPassword;
        document.getElementById('rememberMe').checked = true;
        setTimeout(() => {
            handleLogin();
        }, 500);
    }
}

// ========== INITIAL CONNECTION ==========

socket.on('connect', () => {
    console.log('✅ Connected to Black Hole Chat V2');
    showToast('✅ Connected to server');
    socket.emit('check_auth');
    checkSavedLogin();
});

socket.on('auth_status', (data) => {
    if (data.authenticated) {
        currentUsername = data.username;
        updateRankUI(data.rank);
        updateVerificationUI(data.isVerified);

        loggedInUsernameDisplay.textContent = data.username;
        usernameDisplay.textContent = data.username;

        if (data.theme) {
            changeTheme(data.theme, 'personal');
        }

        authScreen.style.display = 'none';
        roomScreen.style.display = 'flex';
        loadRooms();

        showToast(`👋 Welcome back, ${data.username}!`);
    } else {
        authScreen.style.display = 'flex';
        roomScreen.style.display = 'none';
        chatScreen.style.display = 'none';
        checkSavedLogin();
    }
});

socket.on('disconnect', () => {
    addSystemMessage('⚠️ Disconnected from server. Reconnecting...', new Date());
    showToast('⚠️ Disconnected - reconnecting...');
});

socket.on('reconnect', () => {
    addSystemMessage('✅ Reconnected to server');
    showToast('✅ Reconnected');
    if (currentRoom) {
        socket.emit('join_room', { roomName: currentRoom, password: '' });
    }
});

if (checkNotificationSupport() && Notification.permission === 'granted') {
    notificationPermission = true;
    notificationsEnabled = true;
    const btn = document.getElementById('notificationPermissionBtn');
    if (btn) {
        btn.classList.add('enabled');
        btn.innerHTML = '<span>🔔</span> <span>Notifications Enabled</span>';
    }
}

socket.on('system_message', (data) => {
    addSystemMessage(data.message, data.timestamp);
});