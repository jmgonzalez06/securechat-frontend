// =============================
// SecureChat Frontend Script
// =============================

const host = window.location.hostname;
console.log('Connecting to host:', host);

let ws = null;
let currentUser = null;
let currentRoom = "main"; // default room


// DOM element references
const loginPage = document.getElementById('login-page');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const chatHistory = document.getElementById('chat-history');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const logoutButton = document.getElementById('logout-button');
const emojiButton = document.getElementById('emoji-button');
const emojiMenu = document.getElementById('emoji-menu');
const closeEmojiMenuButton = document.getElementById('close-emoji-menu-button');
const boldButton = document.getElementById('bold-button');
const italicsButton = document.getElementById('italics-button');
const underlineButton = document.getElementById('underline-button');
const fileButton = document.getElementById('file-button');
const fileInput = document.getElementById('file-input');
const typingStatus = document.getElementById('typing-status');
const onlineUsers = new Set();


// =============================
// Login Handler
// =============================
loginButton.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        alert('Please enter both username and password.');
        return;
    }
    console.log("Sending credentials:", username, password);
    try {
        const apiBase = window.location.hostname !== 'localhost'
            ? 'https://securechat-backend-a8yh.onrender.com'
            : 'http://localhost:5000';
            const response = await fetch(`${apiBase}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (result.success) {
            currentUser = username;
            loginPage.style.display = 'none';
            document.getElementById('app-container').style.display = 'flex';
            chatScreen.style.display = 'block';
            messageInput.disabled = false;
            sendButton.disabled = false;
            setTimeout(scrollToBottom, 0);
            alert(`Welcome, ${currentUser}!`);
            initializeWebSocket();
            onlineUsers.add(currentUser);
            updateUserList();
            populateRoomList();
            document.querySelector('[data-room="main"]').click();
        } else {
            alert(result.message || 'Invalid username or password.');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login.');
    }
});

// =============================
// WebSocket Setup (Post-login)
// =============================
function initializeWebSocket() {
    console.log("InitializeWebSocket() called");
    // ws = new WebSocket(`ws://${host}:8080?user=${encodeURIComponent(currentUser)}`)
    //const wsUrl = `ws://${window.location.hostname}:8080?user=${encodeURIComponent(currentUser)}`;
    //console.log("Connecting to:", wsUrl);
    //ws = new WebSocket(wsUrl);
    // Dynamically set WebSocket URL based on environment
    const isProd = window.location.hostname !== 'localhost';
    const wsProtocol = isProd ? 'wss' : 'ws';
    const wsHost = isProd ? 'securechat-backend-a8yh.onrender.com' : `${window.location.hostname}:8080`;
    const wsUrl = `${wsProtocol}://${wsHost}?user=${encodeURIComponent(currentUser)}`;

    console.log("Connecting to WebSocket:", wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to WebSocket');

        // Wait until WebSocket is truly open and DOM is ready
        const tryRoomJoin = setInterval(() => {
            const mainRoom = document.querySelector('[data-room="main"]');
            console.log('Waiting for mainRoom and WebSocket OPEN...', ws.readyState, mainRoom);

            if (ws.readyState === WebSocket.OPEN && mainRoom) {
                console.log('Joining Main Room...');
                mainRoom.click();
                ws.send(JSON.stringify({
                    type: "status",
                    user: currentUser,
                    status: "online"
                }));
                clearInterval(tryRoomJoin);
            }
        }, 100);

        // Start sending heartbeats
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "heartbeat" }));
                console.log(`[Heartbeat] Sent by ${currentUser}`);
            }
        }, 10000);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
    
            // Ignore heartbeat messages
            if (data.type === "heartbeat") {
                console.log(`[Heartbeat] Received ping at ${new Date().toLocaleTimeString()}`);
                return;
            }

            if (data.type === "message" && !data.rendered) {

                if (data.room !== currentRoom) return;

                const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const isLink = data.message.includes("Shared a file:");
                const raw = isLink ? data.message : parseMarkdown(data.message);

                const message = data.user === currentUser
                    ? `<div class="bubble you"><span class="meta">You • ${timestamp}</span><div>${raw}</div></div>`
                    : `<div class="bubble other"><span class="meta">${data.user} • ${timestamp}</span><div>${raw}</div></div>`;
                data.rendered = true;
                addMessageToChat(message);
            }
    
            if (data.type === "typing") {
                const userElement = [...document.querySelectorAll('.user-online')]
                    .find(el => el.textContent === data.user);

                if (userElement) {
                    userElement.textContent = `${data.user} (typing...)`;
                    setTimeout(() => {
                        userElement.textContent = data.user;
                    }, 3000);
                }
                typingStatus.textContent = `${data.user} is typing...`;
                setTimeout(() => {
                    typingStatus.textContent = '';
                    typingStatus.dataset.user = '';
                    updateUserList(); 
                }, 3000);
                return; // skip the fallback log
            }
    
            if (data.type === "status") {
                if (data.status === "online") {
                    onlineUsers.add(data.user);
                } else if (data.status === "offline") {
                    onlineUsers.delete(data.user);
                }
                updateUserList();
            }
            if (data.type === "status" && data.status === "cleared the chat history") {
                if (data.room === currentRoom) {
                    chatHistory.innerHTML = ''; // Added to attempt to clear the DOM
                    ws.send(JSON.stringify({
                        type: "switch-room",
                        room: currentRoom
                    }));
                }
            }
        } catch (e) {
            console.error("Invalid message from server:", event.data);
        }
    };

    ws.onclose = () => console.log('WebSocket disconnected.');
    ws.onerror = (e) => console.error('WebSocket error:', e);
}

// =============================
// Sending Messages
// =============================
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !ws) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket is not open.");
        return;
    }
    
    ws.send(JSON.stringify({
        type: "message",
        user: currentUser,
        room: currentRoom,
        message: message
    }));
    messageInput.value = '';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isLink = message.includes("Shared a file:");
    const raw = isLink ? message : parseMarkdown(message);

    const rendered = `<div class="bubble you"><span class="meta">You • ${timestamp}</span><div>${raw}</div></div>`;
    addMessageToChat(rendered);
}

messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') sendMessage();
    else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing", user: currentUser }));
    }
});
sendButton.addEventListener('click', sendMessage);

// =============================
// Logout
// =============================
logoutButton.addEventListener('click', () => {
    if (ws) ws.close();
    currentUser = null;
    chatHistory.innerHTML = '';
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    chatScreen.style.display = 'none';
    document.getElementById('app-container').style.display = 'none';
    loginPage.style.display = 'block';
    loginPage.style.display = 'flex';
    loginPage.style.marginLeft = 'auto';
    loginPage.style.marginRight = 'auto';
});

// =============================
// Markdown Parser
// =============================
function parseMarkdown(text) {
    return text
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>') // Markdown link [text](url)
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') // Bold
        .replace(/\*(.*?)\*/g, '<i>$1</i>')     // Italic
        .replace(/_(.*?)_/g, '<u>$1</u>');      // Underline
}

// =============================
// Chat Display Helpers
// =============================
function addMessageToChat(html) {
    chatHistory.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// =============================
// Text Formatting Buttons
// =============================
boldButton.onclick = () => formatText('**');
italicsButton.onclick = () => formatText('*');
underlineButton.onclick = () => formatText('_');

function formatText(symbol) {
    const msg = messageInput.value;
    messageInput.value = `${symbol}${msg}${symbol}`;
}

// =============================
// Emoji Functionality
// =============================

// 1. Add emojis dynamically to #emoji-list
const emojiList = document.getElementById('emoji-list');
const emojis = ['🙂', '😀', '😄', '😎', '😍',
    '🙁', '😮', '😲', '😳', '😦',
    '😥', '😢', '😭', '😱', '😓',
    '🥰', '😋', '🤪', '😛', '😜',
    '😂', '🤭', '🤫', '🤨', '😐',
    '😒', '🙄', '😬', '🤢', '🤮',
    '🥶', '🥴', '💀', '🤡', '💩'];

emojis.forEach((emoji) => {
    const emojiElement = document.createElement('span');
    emojiElement.textContent = emoji;
    emojiElement.className = 'emoji';
    emojiList.appendChild(emojiElement);
});

// 2. Toggle emoji menu visibility
emojiButton.onclick = () => {
    emojiMenu.style.display = emojiMenu.style.display === 'block' ? 'none' : 'block';
};
closeEmojiMenuButton.onclick = () => {
    emojiMenu.style.display = 'none';
};

// 3. Insert clicked emoji into message input
document.querySelectorAll('.emoji').forEach(e => {
    e.onclick = () => {
        const pos = messageInput.selectionStart;
        messageInput.value = messageInput.value.substring(0, pos) + e.textContent + messageInput.value.substring(pos);
        messageInput.focus();
        emojiMenu.style.display = 'none';
    };
});
// 4. Auto-hide emoji menu if clicked outside
document.addEventListener('click', (event) => {
    if (!emojiMenu.contains(event.target) && event.target !== emojiButton) {
        emojiMenu.style.display = 'none';
    }
});

// =============================
// File Upload Handler
// =============================
fileButton.onclick = () => fileInput.click();
fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`http://${host}:5000/upload`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();
        if (result.success) {
            ws.send(JSON.stringify({
                type: "message",
                user: currentUser,
                 room: currentRoom,
                message: `Shared a file: <a href="${result.url}" target="_blank">${file.name}</a>`
            }));
        } else {
            alert('Upload failed.');
        }
    } catch (err) {
        console.error('Upload error:', err);
        alert('Upload failed.');
    }
};

// =============================
// Used to Pupulate a list of available chat rooms based on users
// =============================
function populateRoomList() {
    const roomList = document.getElementById('room-list');
    roomList.innerHTML = '';
    const mainRoom = document.createElement('div');
    mainRoom.className = 'room';
    mainRoom.textContent = 'Main Chat';
    mainRoom.dataset.room = 'main';
    mainRoom.onclick = () => {
        document.querySelectorAll('.room').forEach(r => r.classList.remove('selected'));
        mainRoom.classList.add('selected');
        currentRoom = 'main';
        chatHistory.innerHTML = '';
        // Notify the backend to load message history for the new room
        ws.send(JSON.stringify({
            type: "switch-room",
            room: currentRoom
        }));
    };
    roomList.appendChild(mainRoom);

    // Dummy users for now — in real code, replace with live online users
    const users = ['user1', 'user2', 'user3'].filter(u => u !== currentUser);

    users.forEach(user => {
        const roomName = currentUser < user ? `${currentUser}-${user}` : `${user}-${currentUser}`;
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room';
        roomDiv.textContent = `Chat with ${user}`;
        roomDiv.dataset.room = roomName;

        roomDiv.onclick = () => {
            document.querySelectorAll('.room').forEach(r => r.classList.remove('selected'));
            roomDiv.classList.add('selected');
            currentRoom = roomName;
            chatHistory.innerHTML = ''; // Clear UI for the selected room
            // Notify backend to load chat history for this DM room
            ws.send(JSON.stringify({
                type: "switch-room",
                room: currentRoom
            }));
        };

        roomList.appendChild(roomDiv);
    });
}

// =============================
// For User List
// =============================
function updateUserList() {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';

    onlineUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-online';
        div.textContent = (user === currentUser) ? `${user} (You)` : user;
        if (user === typingStatus.dataset.user) {
            div.textContent += ' (typing...)';
        }
        userList.appendChild(div);
    });
}