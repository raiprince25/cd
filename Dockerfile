# First stage - Node.js for the server
FROM node:18-alpine as builder

# Environment variables for build stage (optional)
ENV NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Second stage - Python environment
FROM python:3.10-slim

# Install Node.js to run the server
RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

WORKDIR /app
COPY --from=builder /app .

# Runtime environment variables (recommended placement)
ENV NODE_ENV=production
ENV PORT=5000

RUN mkdir -p /tmp
EXPOSE 5000
CMD ["node", "index.js"]