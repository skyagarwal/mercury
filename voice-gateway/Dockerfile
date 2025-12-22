FROM node:20-slim

WORKDIR /app

# Install dependencies for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose ports
EXPOSE 7100 7101

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:7101/health || exit 1

# Start the server
CMD ["npm", "start"]
