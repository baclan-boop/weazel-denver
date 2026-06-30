FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy server
COPY server.js ./

# Create public folder for frontend
RUN mkdir -p public data/uploads

# Copy frontend
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "server.js"]
