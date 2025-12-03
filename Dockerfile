# Build image using docker build -t nostrband/keep.ai:latest .
# Use Node.js 22 LTS alpine image for smaller size
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install build dependencies needed for native modules (sqlite3, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite

# Copy package files for dependency installation
COPY package*.json ./
COPY package-lock.json ./

# Copy workspace package.json files
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

# Create necessary directories for workspace structure
RUN mkdir -p apps/web apps/server apps/cli apps/electron apps/push \
    packages/agent packages/db packages/node packages/proto packages/sync packages/tests packages/browser

# Install dependencies (including dev dependencies needed for build)
RUN npm ci

# Copy source code (excluding node_modules, dist, etc. via .dockerignore)
COPY . .

# Build frontend first using turbo
RUN npm exec turbo run build:frontend -- --filter=@app/web

# Build server + deps
RUN npm exec turbo run build -- --filter=@app/server

# Copy the web app's data
WORKDIR /app/apps/server
RUN npm run build:all

# Create volume mount point for data persistence
RUN mkdir -p /root/.keep.ai

# Expose default port
EXPOSE 8080

# Set environment variables with defaults
ENV PORT=8080
ENV DEBUG=""

# Start the server
CMD ["npm", "start"]