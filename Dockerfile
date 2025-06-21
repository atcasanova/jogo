FROM node:18-alpine

WORKDIR /app

# Install Python for the bot manager and its dependencies
RUN apk add --no-cache python3 py3-pip

# Install Node.js dependencies
COPY package*.json ./
RUN npm install

# Install Python dependencies for the bot service
COPY game-ai-training/requirements.txt ./game-ai-training/requirements.txt
RUN pip3 install --no-cache-dir -r game-ai-training/requirements.txt

# Copy the rest of the application code
COPY . .

EXPOSE 3000

CMD ["node", "server/server.js"]

