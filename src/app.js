const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const viewRoutes = require('./modules/views/view.routes');
const conversationsRoutes = require('./modules/conversations/conversations.routes');
const messagesRoutes = require('./modules/messages/messages.routes');
const { defaultRateLimiter } = require('./middlewares/rateLimit.middleware');


const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting - Apply to all API routes
app.use('/api', defaultRateLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', usersRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/', viewRoutes);

module.exports = app;

