FROM node:18-alpine

# Install curl and redis-cli (via redis package) for healthcheck and verification scripts
RUN apk add --no-cache curl redis

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy source files
COPY src/ ./src/
COPY public/ ./public/
COPY verify.mjs ./
COPY verify.sh ./
COPY .env.example ./
COPY submission.json ./

# Expose the API port (default 3000)
EXPOSE ${API_PORT:-3000}

# Start the application
CMD ["node", "src/index.js"]
