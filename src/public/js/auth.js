const API_BASE_URL = '/api/auth';

// Token management
const TokenManager = {
    getAccessToken: () => localStorage.getItem('accessToken'),
    setAccessToken: (token) => localStorage.setItem('accessToken', token),
    removeTokens: () => {
        localStorage.removeItem('accessToken');
    },
    
    // Check if token is expired
    isTokenExpired: (token) => {
        if (!token) return true;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const exp = payload.exp * 1000; // Convert to milliseconds
            return Date.now() >= exp;
        } catch (e) {
            return true;
        }
    },
    
    // Get new access token with refresh token
    async refreshAccessToken() {
        try {
            const response = await fetch(`${API_BASE_URL}/refresh`, {
                method: 'POST',
                credentials: 'include', // Send cookies
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (!response.ok) {
                throw new Error('Token refresh failed');
            }
            
            const data = await response.json();
            if (data.accessToken) {
                this.setAccessToken(data.accessToken);
                return data.accessToken;
            }
            throw new Error('No access token in response');
        } catch (error) {
            this.removeTokens();
            window.location.href = '/login';
            throw error;
        }
    },
    
    // Make API request, automatically refresh token if expired
    async makeRequest(url, options = {}) {
        let token = this.getAccessToken();
        
        // Refresh token if expired
        if (this.isTokenExpired(token)) {
            token = await this.refreshAccessToken();
        }
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(url, {
            ...options,
            headers,
            credentials: 'include',
        });
        
        // If we get 401 error, refresh token and retry
        if (response.status === 401 && token) {
            const newToken = await this.refreshAccessToken();
            headers['Authorization'] = `Bearer ${newToken}`;
            return fetch(url, {
                ...options,
                headers,
                credentials: 'include',
            });
        }
        
        return response;
    }
};

// Register form handler
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            password: document.getElementById('password').value,
        };
        
        try {
            const response = await fetch(`${API_BASE_URL}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
                credentials: 'include',
            });
            
            const data = await response.json();
            
            if (response.ok && data.accessToken) {
                TokenManager.setAccessToken(data.accessToken);
                window.location.href = '/dashboard';
            } else {
                showError(data.error || 'Registration failed');
            }
        } catch (error) {
            showError('Network error. Please try again.');
        }
    });
}

// Login form handler
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            email: document.getElementById('email').value,
            password: document.getElementById('password').value,
        };
        
        try {
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
                credentials: 'include',
            });
            
            const data = await response.json();
            
            if (response.ok && data.accessToken) {
                TokenManager.setAccessToken(data.accessToken);
                window.location.href = '/dashboard';
            } else {
                showError(data.error || 'Login failed');
            }
        } catch (error) {
            showError('Network error. Please try again.');
        }
    });
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    }
}

// Export TokenManager for use in dashboard.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TokenManager };
}