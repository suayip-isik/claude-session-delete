import { BIN, GUARDIAN } from '../config'
import type { SessionContext } from '../domain'
import type { Host } from '../host/host'
import { joinPath } from '../host/paths'
import { historyFile } from './historyInspector'

export interface HistoryPurge {
  readonly rows: number
  readonly bytes: number
}

/** Removes the session's rows from the shared prompt history (bin/purge-history.sh, atomic). */
export class HistoryPurger {
  constructor(private readonly host: Host) { }

  async purge(context: SessionContext): Promise<HistoryPurge> {
    const script = joinPath(this.host.pluginRoot, GUARDIAN.purgeHistoryScript)
    const { stdout } = await this.host.runner.run([BIN.sh, script, historyFile(context), context.sessionId])
    const [rows = 0, bytes = 0] = stdout.trim().split(/\s+/).map(value => Number.parseInt(value, 10) || 0)

    return { rows, bytes }
  }
}
