import type { Question, GameSettings } from "../types"

export class GameUtils {
  // Main function to generate a full set of questions
  static generateQuestions(settings: GameSettings, count = 40): Question[] {
    const questions: Question[] = []
    const ops = Object.entries(settings.operations)
      .filter(([_, enabled]) => enabled)
      .map(([op, _]) => op)

    // Fallback in case no operations are enabled
    if (ops.length === 0) {
      // As a fallback, let's just use addition
      ops.push("addition")
    }

    for (let i = 0; i < count; i++) {
      const operation = this.getWeightedOperation(ops, settings.difficulty)
      let questionData: { equation: string; answer: number }

      switch (operation) {
        case "addition":
          questionData = this.generateAddition(settings.difficulty)
          break
        case "subtraction":
          questionData = this.generateSubtraction(settings.difficulty)
          break
        case "multiplication":
          questionData = this.generateMultiplication(settings.difficulty)
          break
        case "division":
          questionData = this.generateDivision(settings.difficulty)
          break
        case "exponents":
          questionData = this.generateExponents(settings.difficulty)
          break
        default:
          questionData = this.generateAddition(settings.difficulty) // Fallback
      }

      questions.push({
        id: i + 1,
        equation: questionData.equation,
        answer: questionData.answer,
        operation,
      })
    }

    return questions
  }

  // Generates a number with a 15% chance of being single-digit
  private static generateWeightedNumber(min: number, max: number, favorLarger = true): number {
    if (!favorLarger || max <= 9) {
      return Math.floor(Math.random() * (max - min + 1)) + min
    }
    const useSmall = Math.random() < 0.15
    if (useSmall && min <= 9) {
      const singleDigitMax = Math.min(9, max)
      return Math.floor(Math.random() * (singleDigitMax - min + 1)) + min
    } else {
      const largerMin = Math.max(min, 10)
      if (largerMin > max) {
        return Math.floor(Math.random() * (max - min + 1)) + min
      }
      return Math.floor(Math.random() * (max - largerMin + 1)) + largerMin
    }
  }

  // Specific question generation logic based on SDD
  private static generateAddition(diff: "easy" | "medium" | "hard"): { equation: string; answer: number } {
    const maxRange = diff === "easy" ? 99 : diff === "medium" ? 999 : 99999
    const a = this.generateWeightedNumber(1, maxRange)
    const b = this.generateWeightedNumber(1, maxRange)
    return { equation: `${a} + ${b}`, answer: a + b }
  }

  private static generateSubtraction(diff: "easy" | "medium" | "hard"): { equation: string; answer: number } {
    const maxRange = diff === "easy" ? 99 : diff === "medium" ? 999 : 99999
    let a = this.generateWeightedNumber(10, maxRange)
    let b = this.generateWeightedNumber(10, maxRange)
    if (b > a) [a, b] = [b, a] // Ensure positive result
    return { equation: `${a} - ${b}`, answer: a - b }
  }

  private static generateMultiplication(diff: "easy" | "medium" | "hard"): { equation: string; answer: number } {
    let a: number, b: number
    if (diff === "easy") {
      a = Math.floor(Math.random() * 9) + 1
      b = this.generateWeightedNumber(1, 99, false)
    } else if (diff === "medium") {
      a = this.generateWeightedNumber(1, 99, false)
      b = this.generateWeightedNumber(1, 99, false)
    } else {
      // hard
      a = this.generateWeightedNumber(1, 999, false)
      b = this.generateWeightedNumber(1, 999, false)
    }
    // Randomly swap a and b for variety
    if (Math.random() < 0.5) [a, b] = [b, a]
    return { equation: `${a} × ${b}`, answer: a * b }
  }

  private static generateDivision(diff: "easy" | "medium" | "hard"): { equation: string; answer: number } {
    let divisor: number, quotient: number
    if (diff === "easy") {
      divisor = Math.floor(Math.random() * 9) + 2 // Divisor 2-9
      quotient = this.generateWeightedNumber(1, 99, false)
    } else if (diff === "medium") {
      divisor = this.generateWeightedNumber(2, 99, false)
      quotient = this.generateWeightedNumber(1, 99, false)
    } else {
      // hard
      divisor = this.generateWeightedNumber(2, 999, false)
      quotient = this.generateWeightedNumber(1, 999, false)
    }
    const dividend = divisor * quotient
    return { equation: `${dividend} ÷ ${divisor}`, answer: quotient }
  }

  private static generateExponents(diff: "easy" | "medium" | "hard"): { equation: string; answer: number } {
    const baseRange = diff === "easy" ? 20 : diff === "medium" ? 30 : 50
    const base = Math.floor(Math.random() * baseRange) + 1
    const operationType = Math.floor(Math.random() * 3)

    switch (operationType) {
      case 0: // x²
        return { equation: `${base}²`, answer: base * base }
      case 1: // x³
        if (base > 20 && (diff === "easy" || diff === "medium")) {
          // Prevent huge numbers for cube
          const smallBase = Math.floor(Math.random() * 15) + 1
          return { equation: `${smallBase}³`, answer: smallBase * smallBase * smallBase }
        }
        return { equation: `${base}³`, answer: base * base * base }
      default: // √(x²)
        const squared = base * base
        return { equation: `√${squared}`, answer: base }
    }
  }

  // Chooses an operation based on difficulty weighting from SDD
  private static getWeightedOperation(ops: string[], diff: "easy" | "medium" | "hard"): string {
    const weights: { [key: string]: number } = {}
    const easyWeights = { addition: 30, subtraction: 30, multiplication: 15, division: 15, exponents: 10 }
    const mediumWeights = { addition: 25, subtraction: 25, multiplication: 20, division: 20, exponents: 10 }
    const hardWeights = { addition: 20, subtraction: 20, multiplication: 25, division: 25, exponents: 10 }
    const selectedWeights = diff === "easy" ? easyWeights : diff === "medium" ? mediumWeights : hardWeights

    ops.forEach((op) => {
      const key = op as keyof typeof selectedWeights
      if (selectedWeights[key]) {
        weights[op] = selectedWeights[key]
      }
    })

    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
    if (totalWeight === 0) return ops[0] // Fallback if no valid weights

    const random = Math.random() * totalWeight
    let cumulative = 0

    for (const [operation, weight] of Object.entries(weights)) {
      cumulative += weight
      if (random <= cumulative) {
        return operation
      }
    }
    return ops[0] // Fallback
  }

  // Keep the lobby code generator
  static generateLobbyCode(): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    let result = ""
    for (let i = 0; i < 4; i++) {
      result += letters.charAt(Math.floor(Math.random() * letters.length))
    }
    return result
  }
}
