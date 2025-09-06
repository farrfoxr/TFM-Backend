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
const playerLobbyMap = new Map<string, string>() // Maps socket.id => lobbyCode
const activeTimers = new Map<string, NodeJS.Timeout>()

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
    const lobbyCode = playerLobbyMap.get(socketId)
    if (!lobbyCode) return // Player wasn't in a lobby

    const lobby = lobbies.get(lobbyCode)
    if (!lobby) return

    // Create a new players array excluding the leaving player
    const updatedPlayers = lobby.players.filter((p) => p.id !== socketId)

    // Case 1: The lobby is now empty (0 players).
    if (updatedPlayers.length === 0) {
      const timer = activeTimers.get(lobbyCode)
      if (timer) {
        clearInterval(timer)
        activeTimers.delete(lobbyCode)
      }
      lobbies.delete(lobbyCode)
      console.log(`[v0] Lobby ${lobbyCode} is empty and has been deleted.`)
    } else {
      // Case 2: There is at least 1 player remaining.
      const wasHost = lobby.host === socketId
      const newHostId = wasHost ? updatedPlayers[0].id : lobby.host

      const updatedLobby: Lobby = {
        ...lobby,
        players: updatedPlayers.map((p, index) => ({
          ...p,
          isHost: (wasHost && index === 0) || (!wasHost && p.id === newHostId),
        })),
        host: newHostId,
      }

      lobbies.set(lobbyCode, updatedLobby)
      io.to(lobbyCode).emit("lobby-updated", updatedLobby)

      if (wasHost) {
        console.log(`[v0] Host left lobby ${lobbyCode}. New host is ${updatedPlayers[0].name}.`)
      }
    }

    // Finally, remove the disconnected player from our lookup map
    playerLobbyMap.delete(socketId)
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
        comboCount: 0, // Initialize combo count for new host
        answeredQuestionIds: [], // Initialize answered questions array for new host
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
          difficulty: "easy", // Changed default difficulty from "medium" to "easy"
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
      playerLobbyMap.set(socket.id, lobbyCode)

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
        comboCount: 0, // Initialize combo count for new player
        answeredQuestionIds: [], // Initialize answered questions array for new player
      }

      // Create a new, updated lobby object with the new player
      const updatedLobby: Lobby = {
        ...lobby,
        players: [...lobby.players, newPlayer],
      }

      // Save the new state back to the Map
      lobbies.set(lobbyCode, updatedLobby)

      // Join socket to the lobby room
      socket.join(lobbyCode)
      playerLobbyMap.set(socket.id, lobbyCode)

      console.log(`[v0] Player ${playerName} (${socket.id}) joined lobby ${lobbyCode}`)

      // Send success response to the joiner
      callback({ success: true, lobby: updatedLobby })

      // Broadcast the updated lobby to all players in the room
      io.to(lobbyCode).emit("lobby-updated", updatedLobby)
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

      const gameTimer = setInterval(() => {
        // Error handling: Check if lobby still exists
        const currentLobby = lobbies.get(lobbyCodeToUpdate!)
        if (!currentLobby) {
          clearInterval(gameTimer)
          activeTimers.delete(lobbyCodeToUpdate!)
          console.log(`[v0] Timer cleared - lobby ${lobbyCodeToUpdate} no longer exists`)
          return
        }

        // Decrement time remaining
        const newTimeRemaining = currentLobby.gameState.timeRemaining - 1

        // Update lobby with new time
        const updatedGameState: GameState = {
          ...currentLobby.gameState,
          timeRemaining: newTimeRemaining,
        }

        const timerUpdatedLobby: Lobby = {
          ...currentLobby,
          gameState: updatedGameState,
        }

        lobbies.set(lobbyCodeToUpdate!, timerUpdatedLobby)

        // Broadcast timer update to all players
        io.to(lobbyCodeToUpdate!).emit("timer-update", newTimeRemaining)

        // Check if game should end
        if (newTimeRemaining <= 0) {
          clearInterval(gameTimer)
          activeTimers.delete(lobbyCodeToUpdate!)

          // Set game flags to ended state
          const endedGameState: GameState = {
            ...updatedGameState,
            isActive: false,
            isEnded: true,
            timeRemaining: 0,
          }

          const endedLobby: Lobby = {
            ...timerUpdatedLobby,
            gameState: endedGameState,
            isGameActive: false,
          }

          lobbies.set(lobbyCodeToUpdate!, endedLobby)

          // Sort players by score (descending) for final scores
          const finalScores = [...endedLobby.players].sort((a, b) => b.score - a.score)

          // Broadcast game ended event with sorted scores
          io.to(lobbyCodeToUpdate!).emit("game-ended", finalScores)

          console.log(`[v0] Game ended in lobby ${lobbyCodeToUpdate} - timer reached zero`)
        }
      }, 1000)

      activeTimers.set(lobbyCodeToUpdate, gameTimer)
    } catch (error) {
      console.error(`[v0] Error starting game:`, error)
    }
  })

  socket.on("submit-answer", (payload) => {
    try {
      const { questionId, answer, timeTaken } = payload
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

      // --- Start of Full Validation ---
      if (!lobbyToUpdate || !lobbyCodeToUpdate) return
      if (!lobbyToUpdate.isGameActive) return

      const playerIndex = lobbyToUpdate.players.findIndex((p) => p.id === socket.id)
      if (playerIndex === -1) return

      const question = lobbyToUpdate.gameState.questions.find((q) => q.id === questionId)
      if (!question) return

      // Bug Fix: Check if player has already answered this question
      const originalPlayer = lobbyToUpdate.players[playerIndex]
      if (originalPlayer.answeredQuestionIds.includes(questionId)) {
        console.log(`[v0] Player ${originalPlayer.name} submitted a duplicate answer for question ${questionId}.`)
        return
      }
      // --- End of Full Validation ---

      const isCorrect = answer === question.answer.toString()
      let scoreChange = 0
      let newComboCount = 0

      // --- Start of Full Scoring Logic ---
      if (isCorrect && timeTaken <= 10000) {
        // Check for correctness AND time
        newComboCount = originalPlayer.comboCount + 1
        // Combo starts after 2 consecutive correct answers (i.e., when comboCount is 1)
        const comboLevel = Math.max(0, newComboCount - 1)
        const multiplier = Math.min(1.0 + comboLevel * 0.05, 2.0) // Cap at 2.0x
        scoreChange = Math.round(100 * multiplier)
      } else {
        // If incorrect OR too slow, reset the combo
        newComboCount = 0
        const comboLevel = Math.max(0, originalPlayer.comboCount - 1)
        const multiplier = Math.min(1.0 + comboLevel * 0.05, 2.0)
        const penaltyMultiplier = Math.min(multiplier, 1.5) // Cap penalty multiplier at 1.5x

        // Award points for a correct but slow answer, but no combo
        if (isCorrect) {
          scoreChange = 100 // A smaller, fixed amount for correct but slow answers
        } else {
          scoreChange = -Math.round(25 * penaltyMultiplier)
        }
      }
      // --- End of Full Scoring Logic ---

      // --- Start of Immutable Update ---
      const updatedPlayer: Player = {
        ...originalPlayer,
        score: Math.max(0, originalPlayer.score + scoreChange), // Ensure score doesn't go below 0
        comboCount: newComboCount,
        answeredQuestionIds: [...originalPlayer.answeredQuestionIds, questionId],
      }

      const updatedPlayers = lobbyToUpdate.players.map((p, index) => (index === playerIndex ? updatedPlayer : p))

      const updatedLobby: Lobby = {
        ...lobbyToUpdate,
        players: updatedPlayers,
      }

      lobbies.set(lobbyCodeToUpdate, updatedLobby)
      // --- End of Immutable Update ---

      console.log(
        `[v0] Player ${updatedPlayer.name} answered. Correct: ${isCorrect}. Score change: ${scoreChange}. New score: ${updatedPlayer.score}. Combo: ${updatedPlayer.comboCount}`,
      )

      io.to(lobbyCodeToUpdate).emit("lobby-updated", updatedLobby)
    } catch (error) {
      console.error(`[v0] Error submitting answer:`, error)
    }
  })

  socket.on("return-to-lobby", () => {
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

      // Validation: Check if player is in a lobby
      if (!lobbyToUpdate || !lobbyCodeToUpdate) return

      // Validation: Check if player is the host
      if (lobbyToUpdate.host !== socket.id) return

      // Validation: Check if game has ended
      if (!lobbyToUpdate.gameState.isEnded) return

      // Clear any active timers for this lobby
      const timer = activeTimers.get(lobbyCodeToUpdate)
      if (timer) {
        clearInterval(timer)
        activeTimers.delete(lobbyCodeToUpdate)
      }

      // Reset all players' game-related state while preserving host status
      const resetPlayers = lobbyToUpdate.players.map((player) => ({
        ...player,
        score: 0,
        isReady: false,
        comboCount: 0,
        answeredQuestionIds: [],
        // Keep isHost unchanged
      }))

      // Reset game state to initial lobby state
      const resetGameState: GameState = {
        isActive: false,
        currentQuestionIndex: 0,
        questions: [],
        timeRemaining: 0,
        comboCount: 0,
        isComboActive: false,
        comboTimeRemaining: 0,
        isEnded: false,
      }

      // Create updated lobby with reset state
      const updatedLobby: Lobby = {
        ...lobbyToUpdate,
        players: resetPlayers,
        gameState: resetGameState,
        isGameActive: false,
      }

      // Save the updated lobby
      lobbies.set(lobbyCodeToUpdate, updatedLobby)

      console.log(
        `[v0] Host returned lobby ${lobbyCodeToUpdate} to lobby state, resetting all player scores and game state`,
      )

      // Broadcast the updated lobby to all players in the room
      io.to(lobbyCodeToUpdate).emit("lobby-updated", updatedLobby)
    } catch (error) {
      console.error(`[v0] Error returning to lobby:`, error)
    }
  })

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`)
    handleLeaveLobby(socket.id)
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`🚀 Think Fast: Math server running on port ${PORT}`)
})
