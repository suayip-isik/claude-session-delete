import { BIN } from '../config'
import type { ProcessInfo } from '../domain'
import type { CommandRunner } from '../host/host'

/** Reads the host's process table; one `ps` per call, no shell. */
export class ProcessTable {
  constructor(private readonly runner: CommandRunner) { }

  async snapshot(): Promise<ProcessInfo[]> {
    const { stdout } = await this.runner.run([BIN.ps, '-A', '-ww', '-o', 'pid=,ppid=,command='])

    return stdout.split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)

      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }] : []
    })
  }

  /** Pids whose environment carries `name=value` exactly (macOS shows the environment of the user's own processes). */
  async pidsWithEnv(name: string, value: string): Promise<Set<number>> {
    const { stdout } = await this.runner.run([BIN.ps, '-A', '-ww', '-e', '-o', 'pid=,command='])
    const token = `${name}=${value}`

    return new Set(
      stdout.split('\n').flatMap(line => {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line)
        const words = match?.[2]?.split(/\s+/) ?? []

        return match && words.includes(token) ? [Number(match[1])] : []
      }),
    )
  }

  async alive(pids: readonly number[]): Promise<Set<number>> {
    if (pids.length === 0) return new Set()
    const { stdout } = await this.runner.run([BIN.ps, '-o', 'pid=', '-p', pids.join(',')])

    return new Set(stdout.split('\n').map(line => Number.parseInt(line.trim(), 10)).filter(Number.isSafeInteger))
  }
}

export function descendantsOf(rootPid: number, table: readonly ProcessInfo[]): ProcessInfo[] {
  const children = new Map<number, ProcessInfo[]>()
  for (const process of table) children.set(process.ppid, [...(children.get(process.ppid) ?? []), process])

  const found: ProcessInfo[] = []
  const queue = [...(children.get(rootPid) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift() as ProcessInfo
    found.push(next)
    queue.push(...(children.get(next.pid) ?? []))
  }

  return found
}
