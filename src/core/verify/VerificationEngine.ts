// ============================================================
// VERIFICATION ENGINE: Checks task completion
// MVP: file existence check + optional build
// ============================================================

import { fileSystemService } from '@/core/services/FileSystemService'

export interface VerificationResult {
  pass: boolean
  issues: string[]
}

export class VerificationEngine {
  static async verify(targetPaths: string[]): Promise<VerificationResult> {
    const issues: string[] = []

    // Check all declared target files exist
    for (const path of targetPaths) {
      if (!path) continue
      try {
        const exists = await fileSystemService.fileExists(path)
        if (!exists) {
          issues.push(`Missing file: ${path}`)
        }
      } catch {
        issues.push(`Cannot check: ${path}`)
      }
    }

    return {
      pass: issues.length === 0,
      issues,
    }
  }
}
