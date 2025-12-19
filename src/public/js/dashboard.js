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

// Socket.IO bağlantısı
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
        // Online kullanıcı listesi otomatik olarak socket bağlantısı tamamlandığında gönderilecek
        // Ancak yine de manuel olarak isteyebiliriz (güvenlik için)
        socket.emit('get_online_users');
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    // Online kullanıcı listesi
    socket.on('online_users_list', (data) => {
        // Tüm userId'leri string'e çevir
        onlineUsers = new Set(data.userIds.map(id => id.toString()));
        updateUserListOnlineStatus();
        updateChatHeaderStatus();
        updateOnlineOfflineLists();
    });

    socket.on('user_online', (data) => {
        // userId'yi string'e çevir
        const userId = data.userId.toString();
        onlineUsers.add(userId);
        updateUserListOnlineStatus();
        updateChatHeaderStatus();
        updateOnlineOfflineLists();
    });

    socket.on('user_offline', (data) => {
        // userId'yi string'e çevir
        const userId = data.userId.toString();
        onlineUsers.delete(userId);
        updateUserListOnlineStatus();
        updateChatHeaderStatus();
        updateOnlineOfflineLists();
    });

    // Mesaj event'leri
    socket.on('new_message', async (data) => {
        if (data.conversationId === currentConversationId) {
            displayMessage(data, false);
            // Conversation'ı okundu işaretle (tüm mesajlar için)
            await markConversationAsRead(data.conversationId);
        } else {
            // Conversation açık değilse, listeyi güncelle
            await loadAllUsers();
        }
    });

    // Yeni mesaj bildirimi (conversation'a katılmamış olsa bile)
    socket.on('new_message_notification', async (data) => {
        // Eğer bu conversation açık değilse, kullanıcı listesini güncelle
        if (data.conversationId !== currentConversationId) {
            // Kullanıcı listesini yenile
            await loadAllUsers();
        } else {
            // Eğer açıksa mesajı göster ve okundu işaretle
            displayMessage(data, false);
            // Conversation'ı okundu işaretle
            await markConversationAsRead(data.conversationId);
        }
    });

    // Mesaj gönderildi onayı
    socket.on('message_sent', async (data) => {
        // Eğer yeni bir conversation oluşturulduysa
        if (data.conversation && data.conversationId) {
            // Eğer henüz conversation açık değilse veya farklı bir conversation ise
            if (!currentConversationId || currentConversationId !== data.conversationId) {
                currentConversationId = data.conversationId;
                // Conversation'ı seç ve mesajları yükle
                const otherUser = data.conversation.participants.find(p => 
                    p._id && p._id.toString() !== currentUserId
                );
                if (otherUser) {
                    await selectConversation(data.conversation, otherUser);
                }
            }
            // Kullanıcı listesini yenile
            await loadAllUsers();
        }
    });

    socket.on('message_saved', (data) => {
        // Sadece geçici mesajı gerçek ID ile güncelle, yeni mesaj ekleme
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer || data.conversationId !== currentConversationId) return;
        
        // Temp ID ile mesajı bul
        const tempMessages = messagesContainer.querySelectorAll('[data-message-id^="temp_"]');
        let messageElement = null;
        
        // En son eklenen temp mesajı al (aynı conversation için)
        if (tempMessages.length > 0) {
            // Mesaj içeriğine göre eşleştir
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
            // Mesaj ID'sini güncelle
            messageElement.setAttribute('data-message-id', data.message._id);
            messageElement.dataset.messageId = data.message._id;
        } else {
            // Eğer temp mesaj bulunamadıysa, gerçek ID ile zaten var mı kontrol et
            const existingMessage = messagesContainer.querySelector(`[data-message-id="${data.message._id}"]`);
            if (!existingMessage) {
                // Mesaj yoksa ekle (nadir durum)
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
    
    // Form alanlarını mevcut değerlerle doldur
    nameInput.value = currentUser.name;
    emailInput.value = currentUser.email;
    
    // Modal'ı göster
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
            // Kullanıcı bilgilerini güncelle
            currentUser = data.data;
            currentUserId = currentUser._id;
            
            document.getElementById('currentUserName').textContent = currentUser.name;
            document.getElementById('currentUserEmail').textContent = currentUser.email;
            document.getElementById('currentUserAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
            
            // Modal'ı kapat
            closeEditUserModal();
            
            // Başarı mesajı (opsiyonel)
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
        // currentUserId kontrolü
        if (!currentUserId) {
            console.warn('currentUserId not set, waiting...');
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!currentUserId) {
                console.error('currentUserId still not set');
                return;
            }
        }
        
        // Tüm kullanıcıları yükle
        const usersResponse = await TokenManager.makeRequest(`${API_BASE_URL}/user/list?limit=100`);
        if (!usersResponse.ok) throw new Error('Failed to load users');
        
        const usersData = await usersResponse.json();
        if (!usersData.success) return;
        
        // Tüm conversation'ları yükle (lastMessageAt için)
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
    
    // Tüm container'ları temizle
    onlineUsersContainer.innerHTML = '';
    offlineUsersContainer.innerHTML = '';
    
    // Mevcut kullanıcıyı filtrele
    const currentUserIdStr = (currentUserId?._id || currentUserId).toString();
    const availableUsers = allUsers.filter(user => {
        const userId = (user._id?._id || user._id).toString();
        return userId !== currentUserIdStr;
    });
    
    // Her kullanıcı için conversation bilgisini bul ve lastMessageAt ekle
    const usersWithConversationData = availableUsers.map(user => {
        const userId = (user._id?._id || user._id).toString();
        
        // Bu kullanıcı ile olan conversation'ı bul
        const conversation = conversations.find(conv => {
            // Conversation'ın participants'ında hem currentUserId hem de userId olmalı
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
    
    // Kullanıcıları online ve offline olarak ayır
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
    
    // Her listeyi lastMessageAt'e göre sırala (en yeni en üstte, conversation'ı olmayanlar en altta)
    onlineUsersList.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1; // a'nın conversation'ı yok, en alta
        if (!b.lastMessageAt) return -1; // b'nin conversation'ı yok, en alta
        return b.lastMessageAt - a.lastMessageAt; // En yeni en üstte
    });
    
    offlineUsersList.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1; // a'nın conversation'ı yok, en alta
        if (!b.lastMessageAt) return -1; // b'nin conversation'ı yok, en alta
        return b.lastMessageAt - a.lastMessageAt; // En yeni en üstte
    });
    
    // Online kullanıcı sayısını güncelle
    document.getElementById('onlineCount').textContent = onlineUsersList.length;
    
    // Online kullanıcıları ekle
    if (onlineUsersList.length > 0) {
        onlineUsersList.forEach(user => {
            const userItem = createUserListItemWithConversation(user);
            onlineUsersContainer.appendChild(userItem);
        });
    } else {
        onlineUsersContainer.innerHTML = '<p style="padding: 20px; text-align: center; color: #667781; font-size: 14px;">No online users</p>';
    }
    
    // Offline kullanıcıları ekle
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
    
    // userId'yi string'e çevir ve kontrol et
    const userIdStr = (user._id?._id || user._id).toString();
    const userIsOnline = onlineUsers.has(userIdStr);
    
    // Son mesaj içeriğini hazırla
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
    
    // Click event: eğer conversation varsa onu seç, yoksa yeni başlat
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
        
        // Önce mevcut conversation var mı kontrol et
        const existingConversation = await findExistingConversation(user._id);
        
        if (existingConversation) {
            // Mevcut conversation'ı seç
            const otherUser = existingConversation.participants.find(p => p._id !== currentUserId);
            if (otherUser) {
                await selectConversation(existingConversation, otherUser);
                // Kullanıcı listesini yenile
                await loadAllUsers();
            }
        } else {
            // Chat window'u göster ama conversation henüz oluşturulmadı
            // Kullanıcı mesaj gönderdiğinde conversation otomatik oluşturulacak
            document.getElementById('chatPlaceholder').style.display = 'none';
            document.getElementById('chatWindow').style.display = 'flex';
            
            // Update chat header
            document.getElementById('chatUserName').textContent = user.name;
            document.getElementById('chatUserAvatar').textContent = user.name.charAt(0).toUpperCase();
            
            // Mesajları temizle
            document.getElementById('chatMessages').innerHTML = '<p style="text-align: center; color: #667781; padding: 20px;">Start a conversation!</p>';
            
            // Online durumunu güncelle
            updateChatHeaderStatus();
            
            // Conversation ID'yi sıfırla (henüz oluşturulmadı)
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
        
        // userId'yi string'e çevir ve karşılaştır
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
    // Tüm listeyi yeniden yükle
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
    
    // Unread badge'i kaldır
    const unreadBadge = activeItem?.querySelector('.unread-badge');
    if (unreadBadge) unreadBadge.remove();
    
    // Show chat window
    document.getElementById('chatPlaceholder').style.display = 'none';
    document.getElementById('chatWindow').style.display = 'flex';
    
    // Update chat header
    document.getElementById('chatUserName').textContent = otherUser.name;
    document.getElementById('chatUserAvatar').textContent = otherUser.name.charAt(0).toUpperCase();
    updateChatHeaderStatus();
    
    // Socket ile konuşmaya katıl
    if (socket) {
        socket.emit('join_conversation', conversation._id);
    }
    
    // Load messages
    await loadMessages(conversation._id);
    
    // Mesajları okundu işaretle
    await markConversationAsRead(conversation._id);
}

// Update chat header status
function updateChatHeaderStatus() {
    const statusElement = document.getElementById('chatUserStatus');
    if (!statusElement || !selectedUserId) return;
    
    // selectedUserId'yi string'e çevir ve karşılaştır
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
    
    // Mesaj ID'sini al (temp ID veya gerçek ID)
    const messageId = message._id || message.tempId;
    if (!messageId) return;
    
    // Eğer bu mesaj zaten gösteriliyorsa, güncelle ama tekrar ekleme
    const existingMessageById = messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (existingMessageById && !isHistorical) {
        // Mesaj zaten var, sadece güncelle (read status vs)
        return;
    }
    
    // Eğer gerçek ID varsa, gerçek ID ile de kontrol et
    if (message._id && messageId !== message._id) {
        const existingMessageByRealId = messagesContainer.querySelector(`[data-message-id="${message._id}"]`);
        if (existingMessageByRealId) {
            // Gerçek ID ile mesaj zaten var, temp ID'yi güncelle
            existingMessageByRealId.dataset.messageId = message._id;
            return;
        }
    }
    
    // Mesaj içeriğine ve zamanına göre de kontrol et (duplicate önleme)
    if (!isHistorical) {
        const messageContent = message.content;
        const messageTime = message.createdAt || message.timestamp;
        const allMessages = messagesContainer.querySelectorAll('.message');
        
        // Son 3 mesajı kontrol et (performans için)
        const recentMessages = Array.from(allMessages).slice(-3);
        for (let msg of recentMessages) {
            const msgContent = msg.querySelector('.message-content')?.textContent;
            // Aynı içerik varsa duplicate olabilir
            if (msgContent === messageContent) {
                // Zaman kontrolü yap (eğer timestamp varsa)
                if (messageTime) {
                    const msgTimeAttr = msg.dataset.timestamp;
                    if (msgTimeAttr) {
                        const msgTime = new Date(msgTimeAttr).getTime();
                        const newMsgTime = new Date(messageTime).getTime();
                        // 10 saniye içinde aynı içerik varsa duplicate
                        if (Math.abs(newMsgTime - msgTime) < 10000) {
                            return;
                        }
                    }
                } else {
                    // Zaman yoksa sadece içeriğe göre kontrol et (son mesajla aynıysa)
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
    // Timestamp'i de sakla (duplicate kontrolü için)
    if (message.createdAt || message.timestamp) {
        messageElement.dataset.timestamp = new Date(message.createdAt || message.timestamp).toISOString();
    }
    
    const messageContent = message.content;
    const messageTime = new Date(message.createdAt || message.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Okundu durumu kontrolü
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
    
    // Burada unread count'u güncellemek için API'ye istek atılabilir
    // Şimdilik basit bir gösterim
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
    
    // Eğer conversationId yoksa ama selectedUserId varsa, recipientId gönder
    const messageData = {
        content: message,
        type: 'text'
    };
    
    if (currentConversationId) {
        messageData.conversationId = currentConversationId;
    } else if (selectedUserId) {
        messageData.recipientId = selectedUserId;
    } else {
        return; // Ne conversationId ne de selectedUserId var
    }
    
    // Socket ile mesaj gönder
    socket.emit('send_message', messageData);
    
    input.value = '';
    
    // Typing'i durdur
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