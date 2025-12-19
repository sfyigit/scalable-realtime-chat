const API_BASE_URL = '/api';
let currentUserId = null;
let selectedUserId = null;
let currentConversationId = null;
let socket = null;
let onlineUsers = new Set();
let typingUsers = new Map(); // conversationId -> Set of userIds
let typingTimeout = null;
let conversationsList = []; // Store conversations for filtering

// TokenManager
const TokenManager = {
    getAccessToken: () => localStorage.getItem('accessToken'),
    setAccessToken: (token) => localStorage.setItem('accessToken', token),
    removeTokens: () => {
        localStorage.removeItem('accessToken');
        if (socket) socket.disconnect();
        window.location.href = '/login';
    },
    isTokenExpired: (token) => {
        if (!token) return true;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const exp = payload.exp * 1000;
            return Date.now() >= exp;
        } catch (e) {
            return true;
        }
    },
    async refreshAccessToken() {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error('Token refresh failed');
            const data = await response.json();
            if (data.accessToken) {
                this.setAccessToken(data.accessToken);
                return data.accessToken;
            }
            throw new Error('No access token');
        } catch (error) {
            this.removeTokens();
            throw error;
        }
    },
    async makeRequest(url, options = {}) {
        let token = this.getAccessToken();
        if (this.isTokenExpired(token)) {
            token = await this.refreshAccessToken();
        }
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        const isRefreshOrLogout = url.includes('/auth/refresh') || url.includes('/auth/logout');
        
        const fetchOptions = {
            ...options,
            headers,
            credentials: isRefreshOrLogout ? 'include' : 'omit'
        };

        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(url, fetchOptions);
        if (response.status === 401 && token) {
            const newToken = await this.refreshAccessToken();
            headers['Authorization'] = `Bearer ${newToken}`;
            const retryOptions = {
                ...options,
                headers,
                credentials: isRefreshOrLogout ? 'include' : 'omit'
            };
            return fetch(url, retryOptions);
        }
        return response;
    }
};

// Socket.IO connection
function initializeSocket() {
    const token = TokenManager.getAccessToken();
    if (!token) {
        console.error('No token available for socket connection');
        return;
    }

    socket = io({
        auth: {
            token: token
        },
        transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
        console.log('Socket connected');
        // Online user list will be automatically sent when socket connection is completed
        // But we can still request it manually (for security)
        socket.emit('get_online_users');
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    // Online user list
    socket.on('online_users_list', (data) => {
        // Convert all userIds to string
        onlineUsers = new Set(data.userIds.map(id => id.toString()));
        updateUserListOnlineStatus();
        updateChatHeaderStatus();
        updateOnlineOfflineLists();
    });

    socket.on('user_online', (data) => {
        // Convert userId to string
        const userId = data.userId.toString();
        onlineUsers.add(userId);
        updateUserListOnlineStatus();
        updateChatHeaderStatus();
        updateOnlineOfflineLists();
    });

    socket.on('user_offline', (data) => {
        // Convert userId to string
        const userId = data.userId.toString();
        onlineUsers.delete(userId);
        updateUserListOnlineStatus();
        updateChatHeaderStatus();
        updateOnlineOfflineLists();
    });

    // Message events
    socket.on('new_message', async (data) => {
        if (data.conversationId === currentConversationId) {
            displayMessage(data, false);
            // Mark conversation as read (for all messages)
            await markConversationAsRead(data.conversationId);
        } else {
            // If conversation is not open, update the list
            await loadAllUsers();
        }
    });

    // New message notification (even if not joined to conversation)
    socket.on('new_message_notification', async (data) => {
        // If this conversation is not open, update user list
        if (data.conversationId !== currentConversationId) {
            // Refresh user list
            await loadAllUsers();
        } else {
            // If open, show message and mark as read
            displayMessage(data, false);
            // Mark conversation as read
            await markConversationAsRead(data.conversationId);
        }
    });

    // Message sent confirmation
    socket.on('message_sent', async (data) => {
        // If a new conversation was created
        if (data.conversation && data.conversationId) {
            // If conversation is not yet open or is a different conversation
            if (!currentConversationId || currentConversationId !== data.conversationId) {
                currentConversationId = data.conversationId;
                // Select conversation and load messages
                const otherUser = data.conversation.participants.find(p => 
                    p._id && p._id.toString() !== currentUserId
                );
                if (otherUser) {
                    await selectConversation(data.conversation, otherUser);
                }
            }
            // Refresh user list
            await loadAllUsers();
        }
    });

    socket.on('message_saved', (data) => {
        // Only update temporary message with real ID, don't add new message
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer || data.conversationId !== currentConversationId) return;
        
        // Find message with temp ID
        const tempMessages = messagesContainer.querySelectorAll('[data-message-id^="temp_"]');
        let messageElement = null;
        
        // Get the most recently added temp message (for the same conversation)
        if (tempMessages.length > 0) {
            // Match by message content
            for (let i = tempMessages.length - 1; i >= 0; i--) {
                const msg = tempMessages[i];
                const content = msg.querySelector('.message-content')?.textContent;
                if (content === data.message.content) {
                    messageElement = msg;
                    break;
                }
            }
        }
        
        if (messageElement) {
            // Update message ID
            messageElement.setAttribute('data-message-id', data.message._id);
            messageElement.dataset.messageId = data.message._id;
        } else {
            // If temp message not found, check if it already exists with real ID
            const existingMessage = messagesContainer.querySelector(`[data-message-id="${data.message._id}"]`);
            if (!existingMessage) {
                // Add message if it doesn't exist (rare case)
                displayMessage(data.message, false);
            }
        }
    });

    socket.on('message_read', (data) => {
        if (data.userId !== currentUserId) {
            const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageElement) {
                const readIndicator = messageElement.querySelector('.read-indicator');
                if (readIndicator) {
                    readIndicator.classList.add('read');
                    readIndicator.textContent = '✓✓';
                }
            }
        }
    });

    // Typing indicators
    socket.on('user_typing', (data) => {
        if (data.conversationId === currentConversationId && data.userId !== currentUserId) {
            showTypingIndicator(data.userId);
        }
    });

    socket.on('user_stopped_typing', (data) => {
        if (data.conversationId === currentConversationId) {
            hideTypingIndicator();
        }
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
}

// Initialize dashboard
async function initDashboard() {
    const token = TokenManager.getAccessToken();
    if (!token || TokenManager.isTokenExpired(token)) {
        try {
            await TokenManager.refreshAccessToken();
        } catch (error) {
            return;
        }
    }
    
    await loadCurrentUser();
    await loadAllUsers();
    initializeSocket();
    setupEventListeners();
}

// Load current user info
let currentUser = null;
async function loadCurrentUser() {
    try {
        const response = await TokenManager.makeRequest(`${API_BASE_URL}/auth/me`);
        if (!response.ok) throw new Error('Failed to load user');
        
        const data = await response.json();
        if (data.success) {
            currentUser = data.data;
            currentUserId = currentUser._id;
            
            document.getElementById('currentUserName').textContent = currentUser.name;
            document.getElementById('currentUserEmail').textContent = currentUser.email;
            document.getElementById('currentUserAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
        }
    } catch (error) {
        console.error('Error loading current user:', error);
        TokenManager.removeTokens();
    }
}

// Open edit user modal
function openEditUserModal() {
    if (!currentUser) return;
    
    const modal = document.getElementById('editUserModal');
    const nameInput = document.getElementById('editUserName');
    const emailInput = document.getElementById('editUserEmail');
    
    // Fill form fields with current values
    nameInput.value = currentUser.name;
    emailInput.value = currentUser.email;
    
    // Show modal
    modal.style.display = 'flex';
}

// Close edit user modal
function closeEditUserModal() {
    const modal = document.getElementById('editUserModal');
    modal.style.display = 'none';
}

// Update user info
async function updateUserInfo(event) {
    event.preventDefault();
    
    const nameInput = document.getElementById('editUserName');
    const emailInput = document.getElementById('editUserEmail');
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    
    if (!name || !email) {
        alert('Name and email are required');
        return;
    }
    
    try {
        const response = await TokenManager.makeRequest(`${API_BASE_URL}/user/me`, {
            method: 'PATCH',
            body: JSON.stringify({ name, email })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update user');
        }
        
        const data = await response.json();
        if (data.success) {
            // Update user information
            currentUser = data.data;
            currentUserId = currentUser._id;
            
            document.getElementById('currentUserName').textContent = currentUser.name;
            document.getElementById('currentUserEmail').textContent = currentUser.email;
            document.getElementById('currentUserAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
            
            // Close modal
            closeEditUserModal();
            
            // Success message (optional)
            console.log('User updated successfully');
        }
    } catch (error) {
        console.error('Error updating user:', error);
        alert(error.message || 'Failed to update user. Please try again.');
    }
}

// Load all users with conversations data
async function loadAllUsers() {
    try {
        // Check currentUserId
        if (!currentUserId) {
            console.warn('currentUserId not set, waiting...');
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!currentUserId) {
                console.error('currentUserId still not set');
                return;
            }
        }
        
        // Load all users
        const usersResponse = await TokenManager.makeRequest(`${API_BASE_URL}/user/list?limit=100`);
        if (!usersResponse.ok) throw new Error('Failed to load users');
        
        const usersData = await usersResponse.json();
        if (!usersData.success) return;
        
        // Load all conversations (for lastMessageAt)
        const conversationsResponse = await TokenManager.makeRequest(`${API_BASE_URL}/conversations`);
        let conversations = [];
        if (conversationsResponse.ok) {
            const conversationsData = await conversationsResponse.json();
            if (conversationsData.success) {
                conversations = conversationsData.data;
                conversationsList = conversations; // Store for other uses
            }
        }
        
        await displayAllUsersSorted(usersData.data, conversations);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Display all users sorted by last message date
async function displayAllUsersSorted(allUsers, conversations) {
    const onlineUsersContainer = document.getElementById('onlineUsersList');
    const offlineUsersContainer = document.getElementById('offlineUsersList');
    
    // Clear all containers
    onlineUsersContainer.innerHTML = '';
    offlineUsersContainer.innerHTML = '';
    
    // Filter current user
    const currentUserIdStr = (currentUserId?._id || currentUserId).toString();
    const availableUsers = allUsers.filter(user => {
        const userId = (user._id?._id || user._id).toString();
        return userId !== currentUserIdStr;
    });
    
    // Find conversation info for each user and add lastMessageAt
    const usersWithConversationData = availableUsers.map(user => {
        const userId = (user._id?._id || user._id).toString();
        
        // Find conversation with this user
        const conversation = conversations.find(conv => {
            // Conversation's participants should include both currentUserId and userId
            const participantIds = conv.participants.map(p => {
                const pId = (p._id?._id || p._id).toString();
                return pId;
            });
            return participantIds.includes(currentUserIdStr) && participantIds.includes(userId);
        });
        
        return {
            ...user,
            conversation: conversation || null,
            lastMessageAt: conversation?.lastMessageAt ? new Date(conversation.lastMessageAt) : null,
            lastMessage: conversation?.lastMessage || null,
            unreadCount: conversation?.unreadCount || 0
        };
    });
    
    // Separate users into online and offline
    const onlineUsersList = [];
    const offlineUsersList = [];
    
    usersWithConversationData.forEach(user => {
        const userIdStr = (user._id?._id || user._id).toString();
        const isOnline = onlineUsers.has(userIdStr);
        
        if (isOnline) {
            onlineUsersList.push(user);
        } else {
            offlineUsersList.push(user);
        }
    });
    
    // Sort each list by lastMessageAt (newest on top, users without conversations at bottom)
    onlineUsersList.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1; // a has no conversation, to bottom
        if (!b.lastMessageAt) return -1; // b has no conversation, to bottom
        return b.lastMessageAt - a.lastMessageAt; // Newest on top
    });
    
    offlineUsersList.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1; // a has no conversation, to bottom
        if (!b.lastMessageAt) return -1; // b has no conversation, to bottom
        return b.lastMessageAt - a.lastMessageAt; // Newest on top
    });
    
    // Update online user count
    document.getElementById('onlineCount').textContent = onlineUsersList.length;
    
    // Add online users
    if (onlineUsersList.length > 0) {
        onlineUsersList.forEach(user => {
            const userItem = createUserListItemWithConversation(user);
            onlineUsersContainer.appendChild(userItem);
        });
    } else {
        onlineUsersContainer.innerHTML = '<p style="padding: 20px; text-align: center; color: #667781; font-size: 14px;">No online users</p>';
    }
    
    // Add offline users
    if (offlineUsersList.length > 0) {
        offlineUsersList.forEach(user => {
            const userItem = createUserListItemWithConversation(user);
            offlineUsersContainer.appendChild(userItem);
        });
    } else {
        offlineUsersContainer.innerHTML = '<p style="padding: 20px; text-align: center; color: #667781; font-size: 14px;">No offline users</p>';
    }
}

// Helper function to create user list item with conversation data
function createUserListItemWithConversation(user) {
    const userItem = document.createElement('div');
    userItem.className = 'user-item all-user-item';
    userItem.dataset.userId = user._id;
    
    if (user.conversation) {
        userItem.dataset.conversationId = user.conversation._id;
    }
    
    // Convert userId to string and check
    const userIdStr = (user._id?._id || user._id).toString();
    const userIsOnline = onlineUsers.has(userIdStr);
    
    // Prepare last message content
    let lastMessageContent = user.email || 'No email';
    if (user.lastMessage) {
        if (typeof user.lastMessage === 'object' && user.lastMessage.content) {
            lastMessageContent = user.lastMessage.content.substring(0, 30) + (user.lastMessage.content.length > 30 ? '...' : '');
        } else if (typeof user.lastMessage === 'string') {
            lastMessageContent = user.lastMessage.substring(0, 30) + (user.lastMessage.length > 30 ? '...' : '');
        }
    }
    
    userItem.innerHTML = `
        <div class="user-item-avatar ${userIsOnline ? 'online' : ''}">
            ${user.name.charAt(0).toUpperCase()}
            ${userIsOnline ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="user-item-info">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h4>${user.name}</h4>
                ${user.unreadCount > 0 ? `<span class="unread-badge">${user.unreadCount}</span>` : ''}
            </div>
            <p>${lastMessageContent}</p>
        </div>
    `;
    
    // Click event: if conversation exists select it, otherwise start new one
    userItem.addEventListener('click', async () => {
        const currentUserIdStr = (currentUserId?._id || currentUserId).toString();
        if (user.conversation) {
            const otherUser = user.conversation.participants.find(p => {
                const pId = (p._id?._id || p._id).toString();
                return pId !== currentUserIdStr;
            });
            if (otherUser) {
                await selectConversation(user.conversation, otherUser);
            }
        } else {
            await selectUser(user);
        }
    });
    
    return userItem;
}

// Select user to start new conversation
async function selectUser(user) {
    try {
        selectedUserId = user._id;
        
        // First check if existing conversation exists
        const existingConversation = await findExistingConversation(user._id);
        
        if (existingConversation) {
            // Select existing conversation
            const otherUser = existingConversation.participants.find(p => p._id !== currentUserId);
            if (otherUser) {
                await selectConversation(existingConversation, otherUser);
                // Refresh user list
                await loadAllUsers();
            }
        } else {
            // Show chat window but conversation hasn't been created yet
            // Conversation will be automatically created when user sends a message
            document.getElementById('chatPlaceholder').style.display = 'none';
            document.getElementById('chatWindow').style.display = 'flex';
            
            // Update chat header
            document.getElementById('chatUserName').textContent = user.name;
            document.getElementById('chatUserAvatar').textContent = user.name.charAt(0).toUpperCase();
            
            // Clear messages
            document.getElementById('chatMessages').innerHTML = '<p style="text-align: center; color: #667781; padding: 20px;">Start a conversation!</p>';
            
            // Update online status
            updateChatHeaderStatus();
            
            // Reset conversation ID (not created yet)
            currentConversationId = null;
        }
    } catch (error) {
        console.error('Error selecting user:', error);
        alert('Failed to start conversation. Please try again.');
    }
}

// Find existing conversation with user
async function findExistingConversation(userId) {
    try {
        const response = await TokenManager.makeRequest(`${API_BASE_URL}/conversations`);
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data.success) {
            return data.data.find(conv => {
                const otherUser = conv.participants.find(p => p._id !== currentUserId);
                return otherUser && otherUser._id === userId;
            });
        }
        return null;
    } catch (error) {
        console.error('Error finding conversation:', error);
        return null;
    }
}

// Update user list online status
function updateUserListOnlineStatus() {
    document.querySelectorAll('.user-item').forEach(item => {
        const userId = item.dataset.userId;
        if (!userId) return;
        
        // Convert userId to string and compare
        const userIdStr = userId.toString();
        const isOnline = onlineUsers.has(userIdStr);
        const avatar = item.querySelector('.user-item-avatar');
        
        if (isOnline) {
            avatar.classList.add('online');
            if (!avatar.querySelector('.online-dot')) {
                const dot = document.createElement('span');
                dot.className = 'online-dot';
                avatar.appendChild(dot);
            }
        } else {
            avatar.classList.remove('online');
            const dot = avatar.querySelector('.online-dot');
            if (dot) dot.remove();
        }
    });
}

// Update online/offline lists when status changes
async function updateOnlineOfflineLists() {
    // Reload entire list
    await loadAllUsers();
}

// Select conversation
async function selectConversation(conversation, otherUser) {
    currentConversationId = conversation._id;
    selectedUserId = otherUser._id;
    
    // Update active state
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-conversation-id="${conversation._id}"]`);
    if (activeItem) activeItem.classList.add('active');
    
    // Remove unread badge
    const unreadBadge = activeItem?.querySelector('.unread-badge');
    if (unreadBadge) unreadBadge.remove();
    
    // Show chat window
    document.getElementById('chatPlaceholder').style.display = 'none';
    document.getElementById('chatWindow').style.display = 'flex';
    
    // Update chat header
    document.getElementById('chatUserName').textContent = otherUser.name;
    document.getElementById('chatUserAvatar').textContent = otherUser.name.charAt(0).toUpperCase();
    updateChatHeaderStatus();
    
    // Join conversation via socket
    if (socket) {
        socket.emit('join_conversation', conversation._id);
    }
    
    // Load messages
    await loadMessages(conversation._id);
    
    // Mark messages as read
    await markConversationAsRead(conversation._id);
}

// Update chat header status
function updateChatHeaderStatus() {
    const statusElement = document.getElementById('chatUserStatus');
    if (!statusElement || !selectedUserId) return;
    
    // Convert selectedUserId to string and compare
    const userIdStr = selectedUserId.toString();
    const isOnline = onlineUsers.has(userIdStr);
    statusElement.textContent = isOnline ? 'Online' : 'Offline';
    statusElement.className = isOnline ? 'online-status' : 'offline-status';
}

// Load messages
async function loadMessages(conversationId) {
    try {
        const response = await TokenManager.makeRequest(`${API_BASE_URL}/messages/conversation/${conversationId}`);
        if (!response.ok) throw new Error('Failed to load messages');
        
        const data = await response.json();
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = '';
        
        if (data.success && data.data.length > 0) {
            data.data.forEach(message => {
                displayMessage(message, true);
            });
            scrollToBottom();
        } else {
            messagesContainer.innerHTML = '<p style="text-align: center; color: #667781; padding: 20px;">No messages yet. Start a conversation!</p>';
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

// Display message
function displayMessage(message, isHistorical = false) {
    const messagesContainer = document.getElementById('chatMessages');
    
    // Get message ID (temp ID or real ID)
    const messageId = message._id || message.tempId;
    if (!messageId) return;
    
    // If this message is already displayed, update but don't add again
    const existingMessageById = messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (existingMessageById && !isHistorical) {
        // Message already exists, just update (read status etc)
        return;
    }
    
    // If real ID exists, also check with real ID
    if (message._id && messageId !== message._id) {
        const existingMessageByRealId = messagesContainer.querySelector(`[data-message-id="${message._id}"]`);
        if (existingMessageByRealId) {
            // Message already exists with real ID, update temp ID
            existingMessageByRealId.dataset.messageId = message._id;
            return;
        }
    }
    
    // Also check by message content and time (prevent duplicates)
    if (!isHistorical) {
        const messageContent = message.content;
        const messageTime = message.createdAt || message.timestamp;
        const allMessages = messagesContainer.querySelectorAll('.message');
        
        // Check last 3 messages (for performance)
        const recentMessages = Array.from(allMessages).slice(-3);
        for (let msg of recentMessages) {
            const msgContent = msg.querySelector('.message-content')?.textContent;
            // If same content exists, might be duplicate
            if (msgContent === messageContent) {
                // Check time (if timestamp exists)
                if (messageTime) {
                    const msgTimeAttr = msg.dataset.timestamp;
                    if (msgTimeAttr) {
                        const msgTime = new Date(msgTimeAttr).getTime();
                        const newMsgTime = new Date(messageTime).getTime();
                        // If same content within 10 seconds, it's a duplicate
                        if (Math.abs(newMsgTime - msgTime) < 10000) {
                            return;
                        }
                    }
                } else {
                    // If no time, check only by content (if same as last message)
                    if (recentMessages.indexOf(msg) === recentMessages.length - 1) {
                        return;
                    }
                }
            }
        }
    }
    
    const isSent = message.senderId._id === currentUserId || message.senderId === currentUserId || 
                   (message.senderId && message.senderId.toString() === currentUserId);
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
    messageElement.dataset.messageId = messageId;
    // Also store timestamp (for duplicate check)
    if (message.createdAt || message.timestamp) {
        messageElement.dataset.timestamp = new Date(message.createdAt || message.timestamp).toISOString();
    }
    
    const messageContent = message.content;
    const messageTime = new Date(message.createdAt || message.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Check read status
    const isRead = isSent && message.readBy && message.readBy.some(r => 
        r.userId && r.userId.toString() !== currentUserId
    );
    
    messageElement.innerHTML = `
        <div class="message-content">${escapeHtml(messageContent)}</div>
        <div class="message-footer">
            <span class="message-time">${messageTime}</span>
            ${isSent ? `<span class="read-indicator ${isRead ? 'read' : ''}">${isRead ? '✓✓' : '✓'}</span>` : ''}
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

// Mark message as read
function markMessageAsRead(messageId) {
    if (socket && currentConversationId) {
        socket.emit('mark_as_read', {
            messageId,
            conversationId: currentConversationId
        });
    }
}

// Mark conversation as read
async function markConversationAsRead(conversationId) {
    try {
        await TokenManager.makeRequest(`${API_BASE_URL}/messages/conversation/${conversationId}/read`, {
            method: 'PATCH'
        });
    } catch (error) {
        console.error('Error marking conversation as read:', error);
    }
}

// Update unread count
function updateUnreadCount(conversationId) {
    const conversationItem = document.querySelector(`[data-conversation-id="${conversationId}"]`);
    if (!conversationItem) return;
    
    // API request can be made here to update unread count
    // For now, simple display
}

// Typing indicator
function showTypingIndicator(userId) {
    const messagesContainer = document.getElementById('chatMessages');
    let typingElement = document.getElementById('typing-indicator');
    
    if (!typingElement) {
        typingElement = document.createElement('div');
        typingElement.id = 'typing-indicator';
        typingElement.className = 'typing-indicator';
        typingElement.innerHTML = '<span></span><span></span><span></span>';
        messagesContainer.appendChild(typingElement);
    }
    
    typingElement.style.display = 'flex';
    scrollToBottom();
}

function hideTypingIndicator() {
    const typingElement = document.getElementById('typing-indicator');
    if (typingElement) {
        typingElement.style.display = 'none';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Edit user button
    document.getElementById('editUserBtn').addEventListener('click', openEditUserModal);
    
    // Close modal buttons
    document.getElementById('closeEditModal').addEventListener('click', closeEditUserModal);
    document.getElementById('cancelEditBtn').addEventListener('click', closeEditUserModal);
    
    // Edit user form submit
    document.getElementById('editUserForm').addEventListener('submit', updateUserInfo);
    
    // Close modal when clicking outside
    document.getElementById('editUserModal').addEventListener('click', (e) => {
        if (e.target.id === 'editUserModal') {
            closeEditUserModal();
        }
    });
    
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch(`${API_BASE_URL}/auth/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${TokenManager.getAccessToken()}`
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            TokenManager.removeTokens();
        }
    });
    
    // Send message button
    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
    
    // Message input
    const messageInput = document.getElementById('messageInput');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Typing indicator
    let typingTimer = null;
    messageInput.addEventListener('input', () => {
        if (!currentConversationId || !socket) return;
        
        // Typing start
        socket.emit('typing_start', { conversationId: currentConversationId });
        
        // Clear existing timer
        clearTimeout(typingTimer);
        
        // Stop typing after 3 seconds of no input
        typingTimer = setTimeout(() => {
            if (socket && currentConversationId) {
                socket.emit('typing_stop', { conversationId: currentConversationId });
            }
        }, 3000);
    });
    
    // Search functionality
    document.getElementById('searchInput').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const userItems = document.querySelectorAll('.user-item');
        userItems.forEach(item => {
            const name = item.querySelector('h4')?.textContent.toLowerCase() || '';
            if (name.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    });
}

// Send message
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message || !socket) return;
    
    // If conversationId doesn't exist but selectedUserId exists, send recipientId
    const messageData = {
        content: message,
        type: 'text'
    };
    
    if (currentConversationId) {
        messageData.conversationId = currentConversationId;
    } else if (selectedUserId) {
        messageData.recipientId = selectedUserId;
    } else {
        return; // Neither conversationId nor selectedUserId exists
    }
    
    // Send message via socket
    socket.emit('send_message', messageData);
    
    input.value = '';
    
    // Stop typing
    if (socket && currentConversationId) {
        socket.emit('typing_stop', { conversationId: currentConversationId });
    }
}

// Scroll to bottom
function scrollToBottom() {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initDashboard);