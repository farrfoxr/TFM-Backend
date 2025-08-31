import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import dotenv from "dotenv"
import type { ServerToClientEvents, ClientToServerEvents, Lobby, Player, GameState } from "./types"
import { GameUtils } from "./utils/gameUtils"

dotenv.config()

const app = express()
const server = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
})

const lobbies = new Map<string, Lobby>()

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

  socket.on("create-lobby", (playerName, callback) => {
    try {
      // Generate unique lobby code
      const lobbyCode = GameUtils.generateLobbyCode()

      // Create host player object
      const hostPlayer: Player = {
        id: socket.id,
        name: playerName,
        isHost: true,
        isReady: true, // Host is automatically ready
        score: 0,
      }

      // Create initial game state
      const initialGameState: GameState = {
        isActive: false,
        currentQuestionIndex: 0,
        questions: [],
        timeRemaining: 0,
        comboCount: 0,
        isComboActive: false,
        comboTimeRemaining: 0,
      }

      // Create new lobby
      const newLobby: Lobby = {
        code: lobbyCode,
        players: [hostPlayer],
        settings: {
          difficulty: "medium",
          duration: 30,
          questionCount: 10,
        },
        gameState: initialGameState,
        host: socket.id,
        isGameActive: false,
      }

      // Store lobby in memory
      lobbies.set(lobbyCode, newLobby)

      // Join socket to lobby room
      socket.join(lobbyCode)

      console.log(`[v0] Created lobby ${lobbyCode} with host ${playerName} (${socket.id})`)

      // Send success response back to client
      callback({ success: true, lobby: newLobby })
    } catch (error) {
      console.error(`[v0] Error creating lobby:`, error)
      callback({ success: false, error: "Failed to create lobby" })
    }
  })

  socket.on("join-lobby", (lobbyCode, playerName, callback) => {
    try {
      // Find the lobby in the Map
      const lobby = lobbies.get(lobbyCode)

      // Handle error if lobby doesn't exist
      if (!lobby) {
        callback({ success: false, error: "Lobby not found" })
        return
      }

      // Create new player object for the joining player
      const newPlayer: Player = {
        id: socket.id,
        name: playerName,
        isHost: false,
        isReady: false,
        score: 0,
      }

      // Add player to lobby's players array
      lobby.players.push(newPlayer)

      // Join socket to the lobby room
      socket.join(lobbyCode)

      console.log(`[v0] Player ${playerName} (${socket.id}) joined lobby ${lobbyCode}`)

      // Send success response to the joiner
      callback({ success: true, lobby })

      // Broadcast lobby update to all players in the room
      io.to(lobbyCode).emit("lobby-updated", lobby)
    } catch (error) {
      console.error(`[v0] Error joining lobby:`, error)
      callback({ success: false, error: "Failed to join lobby" })
    }
  })

  socket.on("toggle-ready", (callback) => {
    try {
      // Find which lobby the player belongs to by iterating through all lobbies
      let playerLobby: Lobby | null = null
      let lobbyCode: string | null = null

      for (const [code, lobby] of lobbies.entries()) {
        const player = lobby.players.find((p) => p.id === socket.id)
        if (player) {
          playerLobby = lobby
          lobbyCode = code
          break
        }
      }

      // Handle error if player is not in any lobby
      if (!playerLobby || !lobbyCode) {
        callback({ success: false, error: "Player not found in any lobby" })
        return
      }

      // Find the specific player within the lobby
      const player = playerLobby.players.find((p) => p.id === socket.id)

      if (!player) {
        callback({ success: false, error: "Player not found in lobby" })
        return
      }

      // Toggle the player's ready status
      player.isReady = !player.isReady

      console.log(`[v0] Player ${player.name} (${socket.id}) toggled ready to ${player.isReady} in lobby ${lobbyCode}`)

      // Send success response to the player
      callback({ success: true, isReady: player.isReady })

      // Broadcast updated lobby to all players in the room
      io.to(lobbyCode).emit("lobby-updated", playerLobby)
    } catch (error) {
      console.error(`[v0] Error toggling ready status:`, error)
      callback({ success: false, error: "Failed to toggle ready status" })
    }
  })

  // TODO: Implement socket event handlers
  // - leave-lobby
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
