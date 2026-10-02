# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# ffmpeg wajib untuk streaming audio ke voice channel
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg

WORKDIR /app

# Install dependency dulu (memanfaatkan cache layer)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source aplikasi
COPY . .

# Plugin @distube/yt-dlp mengunduh binary yt-dlp saat runtime ke folder ini,
# jadi folder harus bisa ditulis oleh user non-root.
RUN mkdir -p /app/node_modules/@distube/yt-dlp/bin \
 && chown -R node:node /app

USER node

CMD ["node", "index.js"]
