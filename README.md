Gerçek Zamanlı Chat Uygulaması

Realtime Messaging, modern web teknolojileri kullanılarak geliştirilmiş gerçek zamanlı scale edilebilir bir mesajlaşma uygulamasıdır. Kullanıcıların anlık mesajlaşma, online/offline durumu takibi ve mesaj okundu bilgisi gibi özellikleri içerir.

## Özellikler
- **Gerçek Zamanlı Mesajlaşma**: Socket.IO ile anlık mesaj gönderimi ve alma. 
- **Multinode Yapı İle Ölçeklenebilirlik**: Socket.IO redis adapter ile çoklu sunucularda çalışabilme. 
- **Kullanıcı Yönetimi**: Kayıt, giriş, profil güncelleme ve çıkış işlemleri
- **Online/Offline Durumu**: Redis ile kullanıcıların gerçek zamanlı online durumu takibi
- **Mesaj Okundu Bilgisi**: Mesajların okundu/okunmadı durumu takibi
- **Mesaj Kuyruğu**: RabbitMQ ile mesaj işleme
- **Responsive Tasarım**: Tasarım için hazır responsive bir html taslağı kullanıldı
- **Güvenlik**: JWT tabanlı kimlik doğrulama ve rate limiting
- **Loglama**: Pino ile error ve info loglama
- **Otomatik Mesaj Planlama**:  Aktif kullanıcılar arasında otomatik mesajlaşma planlaması

## 🛠️ Teknoloji Stack'i

### Backend
- **Node.js & Express.js**: Web sunucusu ve API geliştirme
- **MongoDB & Mongoose**: Veritabanı ve ODM
- **Socket.IO**: Gerçek zamanlı iletişim
- **Redis**: Online kullanıcı durumu ve session yönetimi
- **RabbitMQ**: Mesaj kuyruğu yönetimi
- **JWT**: Token tabanlı kimlik doğrulama (Access token, refresh token)
- **Joi**: Veri validasyonu
- **bcryptjs**: Şifre hashleme

### Frontend
- **EJS Template Engine**: Sunucu tarafı render
- **JavaScript**: İstemci tarafı mantık
- **CSS**: Responsive tasarım

### DevOps
- **Docker & Docker Compose**: Containerization ve servis yönetimi

## 📋 Gereksinimler

- Docker ve Docker Compose

## 🚀 Kurulum

### Docker ile Çalıştırma

1. Projeyi klonlayın:
```bash
git clone https://github.com/sfyigit/realtime-messaging.git
cd realtime-messaging
```

2. `.env` dosyası oluşturun (cp .env.example .env):
```bash
cp .env.example .env
```
yada

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

2. Docker Compose ile tüm servisleri başlatın:
```bash
docker-compose up -d
```

Bu komut şunları başlatır:
- **Node.js Uygulaması**: `http://localhost:3000`
- **MongoDB**: `localhost:27017`
- **Redis**: `localhost:6379`
- **RabbitMQ Management UI**: `http://localhost:15672`

3. Uygulamaya erişin:
```
http://localhost:3000
```

## 📁 Proje Yapısı

```
src/
├── config.js              # Uygulama konfigürasyonu
├── server.js              # Ana sunucu dosyası
├── app.js                 # Express uygulama yapılandırması
├── models/                # Mongoose modelleri
│   ├── user.model.js
│   ├── conversation.model.js
│   ├── message.model.js
│   └── autoMessage.model.js
├── modules/               # Modüler yapı
│   ├── auth/             # Kimlik doğrulama
│   │   ├── auth.routes.js
│   │   ├── auth.controller.js
│   │   ├── auth.service.js
│   │   └── auth.schema.js
│   ├── users/            # Kullanıcı yönetimi
│   │   ├── users.routes.js
│   │   ├── users.controller.js
│   │   └── users.service.js
│   ├── conversations/    # Konuşma yönetimi
│   │   ├── conversations.routes.js
│   │   ├── conversations.controller.js
│   │   └── conversations.service.js
│   ├── messages/         # Mesaj yönetimi
│   │   ├── messages.routes.js
│   │   ├── messages.controller.js
│   │   └── messages.service.js
│   └── views/            # View controller'ları
│       ├── view.routes.js
│       └── view.controller.js
├── middlewares/           # Express middleware'leri
│   ├── auth.middleware.js
│   ├── rateLimit.middleware.js
│   └── validate.middleware.js
├── socket/                # Socket.IO yapılandırması
│   └── socket.js
├── consumers/             # RabbitMQ consumer'ları
│   ├── message.consumer.js
│   └── autoMessage.consumer.js
├── services/              # Servis katmanı
│   ├── cronJobs.service.js
│   ├── messagePlanning.service.js
│   └── queueManagement.service.js
├── utils/                 # Yardımcı fonksiyonlar
│   ├── logger.js
│   ├── password.js
│   ├── token.js
│   ├── redis.js
│   └── rabbitmq.js
├── views/                 # EJS template'leri
│   ├── login.ejs
│   ├── register.ejs
│   └── dashboard.ejs
└── public/                # Statik dosyalar
    ├── css/
    └── js/
```

## 🔐 API Endpoints

### Authentication
- `POST /api/auth/register` - Kullanıcı kaydı
- `POST /api/auth/login` - Kullanıcı girişi
- `POST /api/auth/logout` - Kullanıcı çıkışı (Auth gerekli)
- `POST /api/auth/refresh` - Token yenileme
- `GET /api/auth/me` - Mevcut kullanıcı bilgisi (Auth gerekli)

### Users
- `GET /api/user/list` - Kullanıcı listesi (Auth gerekli)
- `GET /api/user/:id` - Kullanıcı detayı (Auth gerekli)
- `PATCH /api/user/me` - Profil güncelleme (Auth gerekli)

### Conversations
- `GET /api/conversations` - Kullanıcı konuşmaları (Auth gerekli)
- `POST /api/conversations` - Yeni konuşma oluşturma (Auth gerekli)
- `GET /api/conversations/:id` - Konuşma detayı (Auth gerekli)

### Messages
- `GET /api/messages/conversation/:conversationId` - Konuşma mesajları (Auth gerekli)
- `PATCH /api/messages/conversation/:conversationId/read` - Mesajları okundu işaretleme (Auth gerekli)

### Views
- `GET /` - Ana sayfa (login sayfasına yönlendirir)
- `GET /register` - Kayıt sayfası
- `GET /login` - Giriş sayfası
- `GET /dashboard` - Dashboard sayfası

## 🎯 Kullanım

1. **Kayıt Ol**: `/register` sayfasından yeni bir hesap oluşturun
2. **Giriş Yap**: `/login` sayfasından giriş yapın
3. **Mesajlaş**: Dashboard'dan bir kullanıcı seçip mesajlaşmaya başlayın
4. **Profil Güncelle**: İsminizin yanındaki kalem ikonuna tıklayarak profil bilgilerinizi güncelleyin

## 🔧 Geliştirme Notları

- Validasyonlar için **Joi** kütüphanesi kullanıldı.
- Frontend geliştirmeleri için **Express.js EJS template engine** kullanıldı.
- Nodemon ile canlı reload desteği mevcuttur (Docker içinde).
- Socket.IO Redis adapter ile ölçeklenebilir yapı sağlanmıştır.
