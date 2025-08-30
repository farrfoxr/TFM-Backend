#!/bin/bash

# Create server directory at project root
mkdir server
cd server

# Initialize Node.js project with TypeScript
npm init -y

# Install production dependencies
npm install express socket.io cors dotenv
npm install @types/express @types/cors @types/node typescript ts-node nodemon --save-dev

# Create TypeScript configuration
npx tsc --init

# Create basic directory structure
mkdir src
mkdir src/types
mkdir src/controllers
mkdir src/services
mkdir src/utils

echo "Backend project setup complete!"
