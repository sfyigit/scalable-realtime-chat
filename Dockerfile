# --- Base ---
FROM node:18 AS base
WORKDIR /app
COPY package*.json ./

# --- Development ---
FROM base AS development
RUN npm install
COPY . .
CMD npm run dev

# --- Production ---
FROM base AS production
RUN npm install --only=production
COPY . .
CMD npm start
