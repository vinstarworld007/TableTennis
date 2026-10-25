# Container image for cloud hosting (Railway, Render, Fly.io …).
# The database and uploads live in /data, which must be a persistent volume.
FROM node:22-slim

# ffmpeg converts phone videos to web-friendly MP4 (optional, but handy for the gallery).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production \
    DATA_DIR=/data \
    TRUST_PROXY=1 \
    PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
