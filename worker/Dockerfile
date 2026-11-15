FROM node:22-bookworm-slim

# GDAL (tiles da cartografia), ffmpeg (vídeo), Chromium (render do tour)
RUN apt-get update && apt-get install -y --no-install-recommends \
      gdal-bin python3-gdal ffmpeg chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "index.mjs"]
