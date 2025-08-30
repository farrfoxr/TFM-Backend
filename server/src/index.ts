import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import dotenv from "dotenv"
import type { ServerToClientEvents, ClientToServerEvents } from "./types"

dotenv.config()

const app = express()
const server = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
})

// Middleware
app.use(cors())
app.use(express.json())

// Basic health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() })
})

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`)

  // TODO: Implement socket event handlers
  // - create-lobby
  // - join-lobby
  // - leave-lobby
  // - toggle-ready
  // - start-game
  // - submit-answer
  // - update-settings

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`)
    // TODO: Handle player leaving lobby
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`🚀 Think Fast: Math server running on port ${PORT}`)
})
