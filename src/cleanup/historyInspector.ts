import { BIN, CLAUDE_LAYOUT } from '../config'
import type { SessionContext } from '../domain'
import type { CommandRunner } from '../host/host'
import { joinPath } from '../host/paths'

/**
 * The prompt history is shared by every session, so its rows are removed after
 * the session exits (finalize.sh), never the file. This counts them for the
 * confirmation dialog.
 */
export class HistoryInspector {
  constructor(private readonly runner: CommandRunner) {}

  async countRows(context: SessionContext): Promise<number> {
    const { stdout } = await this.runner.run([BIN.grep, '-cF', '--', historyMarker(context.sessionId), historyFile(context)])

    return Number.parseInt(stdout.trim(), 10) || 0
  }
}

/** How a history row names its session; finalize.sh matches the same text. */
export function historyMarker(sessionId: string): string {
  return `"sessionId":"${sessionId}"`
}

export function historyFile(context: SessionContext): string {
  return joinPath(context.configDir, CLAUDE_LAYOUT.history)
}
