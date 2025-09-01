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

  const handleLeaveLobby = (socketId: string) => {
    let lobbyCodeToUpdate: string | null = null

    for (const [code, lobby] of lobbies.entries()) {
      const playerIndex = lobby.players.findIndex((p) => p.id === socketId)

      if (playerIndex !== -1) {
        // Remove the player from the lobby
        lobby.players.splice(playerIndex, 1)
        lobbyCodeToUpdate = code

        // If the lobby is now empty, delete it
        if (lobby.players.length === 0) {
          lobbies.delete(code)
          console.log(`[v0] Lobby ${code} is empty and has been deleted.`)
          break
        }

        // If the leaving player was the host, assign a new host
        if (lobby.host === socketId) {
          const newHost = lobby.players[0]
          if (newHost) {
            newHost.isHost = true
            lobby.host = newHost.id
            console.log(`[v0] Host left lobby ${code}. New host is ${newHost.name}.`)
          }
        }

        // Broadcast the update to the remaining players
        io.to(code).emit("lobby-updated", lobby)
        break
      }
    }
  }

  socket.on("create-lobby", (playerName, callback) => {
    try {
      // Generate unique lobby code
      const lobbyCode = GameUtils.generateLobbyCode()

      // Create host player object
      const hostPlayer: Player = {
        id: socket.id,
        name: playerName,
        isHost: true,
        isReady: false, // Changed from true to false - host is no longer automatically ready
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
        isEnded: false, // Added isEnded: false to initial game state
      }

      // Create new lobby
      const newLobby: Lobby = {
        code: lobbyCode,
        players: [hostPlayer],
        settings: {
          difficulty: "medium",
          duration: 120, // Changed from 30 to 120 seconds to match frontend default
          questionCount: 10,
          operations: {
            addition: true,
            subtraction: true,
            multiplication: true,
            division: true,
            exponents: false,
          },
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

  socket.on("leave-lobby", () => {
    console.log(`[v0] Player ${socket.id} is leaving lobby`)
    handleLeaveLobby(socket.id)
  })

  socket.on("update-settings", (newSettings) => {
    try {
      // Find which lobby the player belongs to
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
        console.log(`[v0] Player ${socket.id} tried to update settings but is not in any lobby`)
        return
      }

      // Find the specific player and verify they are the host
      const player = playerLobby.players.find((p) => p.id === socket.id)
      if (!player || !player.isHost) {
        console.log(`[v0] Player ${socket.id} tried to update settings but is not the host`)
        return
      }

      // Merge new settings with existing settings using shallow merge
      playerLobby.settings = { ...playerLobby.settings, ...newSettings }

      console.log(`[v0] Host ${player.name} (${socket.id}) updated settings in lobby ${lobbyCode}:`, newSettings)

      // Broadcast updated lobby to all players in the room
      io.to(lobbyCode).emit("lobby-updated", playerLobby)
    } catch (error) {
      console.error(`[v0] Error updating settings:`, error)
    }
  })

  socket.on("start-game", () => {
    try {
      let lobbyToUpdate: Lobby | undefined
      let lobbyCodeToUpdate: string | undefined

      // Find the lobby the player is in
      for (const [code, lobby] of lobbies.entries()) {
        if (lobby.players.some((p) => p.id === socket.id)) {
          lobbyCodeToUpdate = code
          lobbyToUpdate = lobby
          break
        }
      }

      if (!lobbyToUpdate || !lobbyCodeToUpdate) {
        return console.log(`[v0] Player ${socket.id} tried to start game but is not in any lobby`)
      }

      // Validate that the player is the host and all players are ready
      const playerIsHost = lobbyToUpdate.host === socket.id
      const allPlayersReady = lobbyToUpdate.players.every((p) => p.isReady)

      if (!playerIsHost) {
        return console.log(`[v0] Player ${socket.id} tried to start game but is not the host`)
      }
      if (!allPlayersReady) {
        return console.log(`[v0] Host tried to start game but not all players are ready`)
      }

      // --- Start of Immutable Update Logic ---

      // 1. Generate questions
      const questions = GameUtils.generateQuestions(lobbyToUpdate.settings)

      // 2. Create the new game state
      const newGameState: GameState = {
        ...lobbyToUpdate.gameState,
        isActive: true,
        currentQuestionIndex: 0,
        questions: questions,
        timeRemaining: lobbyToUpdate.settings.duration,
        isEnded: false,
      }

      // 3. Create the new, updated lobby object
      const updatedLobby: Lobby = {
        ...lobbyToUpdate,
        gameState: newGameState,
        isGameActive: true,
      }

      // 4. Save the new lobby state back to the Map
      lobbies.set(lobbyCodeToUpdate, updatedLobby)

      // --- End of Immutable Update Logic ---

      console.log(`[v0] Host started game in lobby ${lobbyCodeToUpdate} with ${questions.length} questions`)

      // Broadcast "game-started" event to all players in the lobby
      io.to(lobbyCodeToUpdate).emit("game-started", updatedLobby.gameState)
    } catch (error) {
      console.error(`[v0] Error starting game:`, error)
    }
  })

  // TODO: Implement socket event handlers
  // - submit-answer

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`)
    handleLeaveLobby(socket.id)
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`🚀 Think Fast: Math server running on port ${PORT}`)
})
