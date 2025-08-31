// src/types/index.ts

// Core data structures that match your frontend exactly
export interface Player {
  id: string // Socket ID on backend
  name: string
  isHost: boolean
  isReady: boolean
  score: number
  isYou?: boolean // This will be set on frontend
}

export interface Question {
  id: number
  equation: string
  answer: number
  operation: string
}

export interface GameSettings {
  difficulty: "easy" | "medium" | "hard"
  duration: number // in seconds
  questionCount: number
  operations: {
    addition: boolean
    subtraction: boolean
    multiplication: boolean
    division: boolean
    exponents: boolean
  }
}

export interface GameState {
  isActive: boolean
  currentQuestionIndex: number
  questions: Question[]
  timeRemaining: number
  comboCount: number
  isComboActive: boolean
  comboTimeRemaining: number
}

export interface Lobby {
  code: string
  players: Player[]
  settings: GameSettings
  gameState: GameState
  host: string // Socket ID of host
  isGameActive: boolean
}

// Socket event types for type safety
export interface ServerToClientEvents {
  "lobby-updated": (lobby: Lobby) => void
  "game-started": (gameState: GameState) => void
  "question-updated": (question: Question, timeRemaining: number) => void
  "player-answered": (playerId: string, isCorrect: boolean, newScore: number) => void
  "game-ended": (finalScores: Player[]) => void
  error: (message: string) => void
}

export interface ClientToServerEvents {
  "create-lobby": (
    playerName: string,
    callback: (response: { success: boolean; lobby?: Lobby; error?: string }) => void,
  ) => void
  "join-lobby": (
    code: string,
    playerName: string,
    callback: (response: { success: boolean; lobby?: Lobby; error?: string }) => void,
  ) => void
  "leave-lobby": () => void
  "toggle-ready": (callback: (response: { success: boolean; isReady?: boolean; error?: string }) => void) => void
  "start-game": () => void
  "submit-answer": (answer: string) => void
  "update-settings": (settings: Partial<GameSettings>) => void
}
