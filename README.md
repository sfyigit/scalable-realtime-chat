Real-Time Chat Application

Realtime Messaging is a scalable real-time messaging application developed using modern web technologies. It includes features such as instant messaging, online/offline status tracking, and message read receipts.

## Features
- **Real-Time Messaging**: Instant message sending and receiving with Socket.IO. 
- **Scalability with Multinode Architecture**: Ability to run on multiple servers with Socket.IO Redis adapter. 
- **User Management**: Registration, login, profile update, and logout operations
- **Online/Offline Status**: Real-time user online status tracking with Redis
- **Message Read Receipts**: Tracking of read/unread message status
- **Message Queue**: Message processing with RabbitMQ
- **Responsive Design**: A ready-to-use responsive HTML template was used for the design
- **Security**: JWT-based authentication and rate limiting
- **Logging**: Error and info logging with Pino
- **Automatic Message Scheduling**: Automatic messaging scheduling between active users

## 🛠️ Technology Stack

### Backend
- **Node.js & Express.js**: Web server and API development
- **MongoDB & Mongoose**: Database and ODM
- **Socket.IO**: Real-time communication
- **Redis**: Online user status and session management
- **RabbitMQ**: Message queue management
- **JWT**: Token-based authentication (Access token, refresh token)
- **Joi**: Data validation
- **bcryptjs**: Password hashing

### Frontend
- **EJS Template Engine**: Server-side rendering
- **JavaScript**: Client-side logic
- **CSS**: Responsive design

### DevOps
- **Docker & Docker Compose**: Containerization and service management

## 📋 Requirements

- Docker and Docker Compose

## 🚀 Installation

### Running with Docker

1. Clone the project:
```bash
git clone https://github.com/sfyigit/realtime-messaging.git
cd realtime-messaging
```

2. Create a `.env` file (cp .env.example .env):
```bash
cp .env.example .env
```
or

```env
NODE_ENV=development
PORT=3000
MONGO_URL=mongodb://admin:password123@localhost:27017/realtime-messaging?authSource=admin
REDIS_HOST=redis
REDIS_PORT=6379
RABBITMQ_URL=amqp://rabbitmq
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
```

2. Start all services with Docker Compose:
```bash
docker-compose up -d
```

This command starts:
- **Node.js Application**: `http://localhost:3000`
- **MongoDB**: `localhost:27017`
- **Redis**: `localhost:6379`
- **RabbitMQ Management UI**: `http://localhost:15672`

3. Access the application:
```
http://localhost:3000
```

## 📁 Project Structure

```
src/
├── config.js              # Application configuration
├── server.js              # Main server file
├── app.js                 # Express application configuration
├── models/                # Mongoose models
│   ├── user.model.js
│   ├── conversation.model.js
│   ├── message.model.js
│   └── autoMessage.model.js
├── modules/               # Modular structure
│   ├── auth/             # Authentication
│   │   ├── auth.routes.js
│   │   ├── auth.controller.js
│   │   ├── auth.service.js
│   │   └── auth.schema.js
│   ├── users/            # User management
│   │   ├── users.routes.js
│   │   ├── users.controller.js
│   │   └── users.service.js
│   ├── conversations/    # Conversation management
│   │   ├── conversations.routes.js
│   │   ├── conversations.controller.js
│   │   └── conversations.service.js
│   ├── messages/         # Message management
│   │   ├── messages.routes.js
│   │   ├── messages.controller.js
│   │   └── messages.service.js
│   └── views/            # View controllers
│       ├── view.routes.js
│       └── view.controller.js
├── middlewares/           # Express middlewares
│   ├── auth.middleware.js
│   ├── rateLimit.middleware.js
│   └── validate.middleware.js
├── socket/                # Socket.IO configuration
│   └── socket.js
├── consumers/             # RabbitMQ consumers
│   ├── message.consumer.js
│   └── autoMessage.consumer.js
├── services/              # Service layer
│   ├── cronJobs.service.js
│   ├── messagePlanning.service.js
│   └── queueManagement.service.js
├── utils/                 # Helper functions
│   ├── logger.js
│   ├── password.js
│   ├── token.js
│   ├── redis.js
│   └── rabbitmq.js
├── views/                 # EJS templates
│   ├── login.ejs
│   ├── register.ejs
│   └── dashboard.ejs
└── public/                # Static files
    ├── css/
    └── js/
```

## 🔐 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout (Auth required)
- `POST /api/auth/refresh` - Token refresh
- `GET /api/auth/me` - Current user information (Auth required)

### Users
- `GET /api/user/list` - User list (Auth required)
- `GET /api/user/:id` - User details (Auth required)
- `PATCH /api/user/me` - Profile update (Auth required)

### Conversations
- `GET /api/conversations` - User conversations (Auth required)
- `POST /api/conversations` - Create new conversation (Auth required)
- `GET /api/conversations/:id` - Conversation details (Auth required)

### Messages
- `GET /api/messages/conversation/:conversationId` - Conversation messages (Auth required)
- `PATCH /api/messages/conversation/:conversationId/read` - Mark messages as read (Auth required)

### Views
- `GET /` - Home page (redirects to login page)
- `GET /register` - Registration page
- `GET /login` - Login page
- `GET /dashboard` - Dashboard page

## 🎯 Usage

1. **Register**: Create a new account from the `/register` page
2. **Login**: Log in from the `/login` page
3. **Chat**: Select a user from the dashboard and start messaging
4. **Update Profile**: Click the pencil icon next to your name to update your profile information

## 🔧 Development Notes

- **Joi** library was used for validations.
- **Express.js EJS template engine** was used for frontend development.
- Live reload support is available with Nodemon (inside Docker).
- Scalable architecture is provided with Socket.IO Redis adapter.
