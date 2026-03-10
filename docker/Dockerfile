FROM node:20-slim

WORKDIR /app

# Install system dependencies for Puppeteer and general utilities
RUN apt-get update && apt-get install -y \
    chromium \
    git \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json* ./
RUN npm install --production

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc -p tsconfig.json

EXPOSE 3000

CMD ["node", "dist/index.js"]
