# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/client/package*.json ./packages/client/
COPY packages/server/package*.json ./packages/server/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install pdfplumber
RUN pip3 install --break-system-packages pdfplumber

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/client/dist ./packages/client/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/package.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Start the server
CMD ["node", "packages/server/dist/index.js"]
