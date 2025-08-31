import type { Question } from "../types"

// Utility functions for game logic
export class GameUtils {
  static generateQuestions(difficulty: "easy" | "medium" | "hard", count: number): Question[] {
    const questions: Question[] = []

    for (let i = 0; i < count; i++) {
      questions.push(this.generateSingleQuestion(i + 1, difficulty))
    }

    return questions
  }

  private static generateSingleQuestion(id: number, difficulty: "easy" | "medium" | "hard"): Question {
    const operations = ["+", "-", "*", "/"]
    const operation = operations[Math.floor(Math.random() * operations.length)]

    let num1: number, num2: number, answer: number

    switch (difficulty) {
      case "easy":
        num1 = Math.floor(Math.random() * 20) + 1
        num2 = Math.floor(Math.random() * 20) + 1
        break
      case "medium":
        num1 = Math.floor(Math.random() * 50) + 1
        num2 = Math.floor(Math.random() * 50) + 1
        break
      case "hard":
        num1 = Math.floor(Math.random() * 100) + 1
        num2 = Math.floor(Math.random() * 100) + 1
        break
    }

    switch (operation) {
      case "+":
        answer = num1 + num2
        break
      case "-":
        answer = num1 - num2
        break
      case "*":
        answer = num1 * num2
        break
      case "/":
        // Ensure clean division
        answer = num1
        num1 = answer * num2
        break
      default:
        answer = num1 + num2
    }

    return {
      id,
      equation: `${num1} ${operation} ${num2}`,
      answer,
      operation,
    }
  }

  static generateLobbyCode(): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    let code = ""
    for (let i = 0; i < 4; i++) {
      code += letters.charAt(Math.floor(Math.random() * letters.length))
    }
    return code
  }
}
