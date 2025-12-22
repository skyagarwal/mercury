# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm install --omit=dev || npm install --only=production
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
