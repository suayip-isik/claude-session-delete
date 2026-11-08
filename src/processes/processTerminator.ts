import { BIN, TIMING } from '../config'
import type { ProcessPlan, TerminationResult } from '../domain'
import type { CommandRunner } from '../host/host'
import type { ProcessTable } from './processTable'
import type { SocketInspector } from './socketInspector'

/** SIGTERM first, SIGKILL for what is still alive after the grace period, then verifies the ports. */
export class ProcessTerminator {
  constructor(
    private readonly runner: CommandRunner,
    private readonly table: ProcessTable,
    private readonly sockets: SocketInspector,
  ) { }

  async terminate(plan: ProcessPlan): Promise<TerminationResult> {
    const pids = plan.processes.map(process => process.pid)
    if (pids.length === 0) {
      return { stopped: [], forced: [], survivors: [], closedSockets: [], openSockets: [] }
    }

    await this.signal('TERM', pids)
    const afterTerm = await this.waitForExit(pids, TIMING.terminateGraceMs)
    const forcedPids = [...afterTerm]
    if (forcedPids.length > 0) {
      await this.signal('KILL', forcedPids)
      await this.waitForExit(forcedPids, TIMING.terminateGraceMs)
    }

    const stillAlive = await this.table.alive(pids)
    const openSockets = await this.sockets.listening([...stillAlive])
    const isOpen = (address: string, pid: number): boolean =>
      openSockets.some(socket => socket.pid === pid && socket.address === address)

    return {
      stopped: plan.processes.filter(process => !stillAlive.has(process.pid)),
      forced: plan.processes.filter(process => forcedPids.includes(process.pid) && !stillAlive.has(process.pid)),
      survivors: plan.processes.filter(process => stillAlive.has(process.pid)),
      closedSockets: plan.sockets.filter(socket => !isOpen(socket.address, socket.pid)),
      openSockets,
    }
  }

  private async signal(signal: 'TERM' | 'KILL', pids: readonly number[]): Promise<void> {
    // A pid that already exited makes kill exit non-zero; the others are still signalled.
    await this.runner.run([BIN.kill, `-${signal}`, ...pids.map(String)])
  }

  /** Polls until every pid is gone or the time is up; resolves with those still alive. */
  private async waitForExit(pids: readonly number[], withinMs: number): Promise<Set<number>> {
    let pollsLeft = Math.ceil(withinMs / TIMING.terminatePollMs)
    let alive = await this.table.alive(pids)
    while (alive.size > 0 && pollsLeft-- > 0) {
      await this.runner.run([BIN.sleep, String(TIMING.terminatePollMs / 1000)])
      alive = await this.table.alive([...alive])
    }

    return alive
  }
}
