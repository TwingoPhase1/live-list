FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
# If package-lock.json doesn't exist, npm install will generate it
RUN npm install

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p data

EXPOSE 3000

CMD ["npm", "start"]
