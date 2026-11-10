import { CLAUDE_LAYOUT, SESSION_ENV_TAG } from '../config'
import type { ProcessInfo, SessionContext } from '../domain'
import { joinPath } from '../host/paths'
import { descendantsOf, type ProcessTable } from './processTable'

/**
 * Everything this session started: its process tree, plus anything that left
 * the tree (a daemonised server, `nohup … &`) but still carries the session's
 * environment tag. The Claude process itself, a resumed sibling of the session
 * and Claude's own helper children (the same executable) are never included.
 * When Claude keeps running (`reset`), what it started for itself, MCP servers
 * and hook helpers, is spared too: only the shells it ran for tools, and what
 * they started, belong to the session.
 */
export class ProcessDiscovery {
  constructor(private readonly table: ProcessTable) { }

  async discover(context: SessionContext): Promise<ProcessInfo[]> {
    const all = await this.table.snapshot()
    const byPid = new Map(all.map(process => [process.pid, process]))
    const executable = executableOf(byPid.get(context.claudePid)?.command)

    const protectedPids = new Set<number>([
      context.claudePid,
      ...context.siblingPids,
      ...context.siblingPids.flatMap(pid => descendantsOf(pid, all).map(process => process.pid)),
      ...(context.ending === 'reset' ? engineOwnedPids(context, all) : []),
    ])
    const tagged = await this.table.pidsWithEnv(SESSION_ENV_TAG, context.sessionId)
    const candidates = new Map<number, ProcessInfo>()

    for (const process of descendantsOf(context.claudePid, all)) candidates.set(process.pid, process)
    for (const pid of tagged) {
      const process = byPid.get(pid)
      if (process) candidates.set(pid, process)
    }

    const isEngineHelper = (process: ProcessInfo): boolean =>
      process.ppid === context.claudePid && executable !== undefined && executableOf(process.command) === executable
    const chosen = [...candidates.values()].filter(process => !protectedPids.has(process.pid) && !isEngineHelper(process))
    const alive = await this.table.alive(chosen.map(process => process.pid))

    // The `ps` calls above were children of Claude while they ran; only what still lives counts.
    return chosen.filter(process => alive.has(process.pid))
  }
}

function executableOf(command: string | undefined): string | undefined {
  return command?.trim().split(/\s+/)[0]
}

/** Claude's direct children that are not tool shells (a tool shell sources a shell snapshot), with everything below them. */
function engineOwnedPids(context: SessionContext, table: readonly ProcessInfo[]): number[] {
  const snapshots = joinPath(context.configDir, CLAUDE_LAYOUT.shellSnapshots)
  const owned = table.filter(process => process.ppid === context.claudePid && !process.command.includes(snapshots))

  return owned.flatMap(process => [process.pid, ...descendantsOf(process.pid, table).map(child => child.pid)])
}
