import { BIN } from '../config'
import type { ListeningSocket } from '../domain'
import type { CommandRunner } from '../host/host'

/** Lists the ports a set of processes listens on (TCP LISTEN and bound, unconnected UDP). */
export class SocketInspector {
  constructor(private readonly runner: CommandRunner) { }

  async listening(pids: readonly number[]): Promise<ListeningSocket[]> {
    if (pids.length === 0) return []
    // lsof exits 1 when nothing matches; that is an empty answer, not a failure.
    const { stdout } = await this.runner.run([BIN.lsof, '-nP', '-a', '-p', pids.join(','), '-i', '-F', 'pcPnT'])

    return parseLsof(stdout).filter(isListening).map(({ state: _state, ...socket }) => socket)
  }
}

interface RawSocket extends ListeningSocket {
  readonly state: string | undefined
}

/** `lsof -F pcPnT`: a `p`/`c` block per process, then `f`… `P`, `n`, `T` lines per descriptor. */
export function parseLsof(output: string): RawSocket[] {
  const sockets: RawSocket[] = []
  let pid = 0
  let command = ''
  let current: { protocol?: string; address?: string; state?: string } | undefined

  const flush = (): void => {
    if (current?.protocol && current.address) {
      sockets.push({ pid, command, protocol: current.protocol, address: current.address, state: current.state })
    }
    current = undefined
  }

  for (const line of output.split('\n')) {
    const field = line.charAt(0)
    const value = line.slice(1)
    if (field === 'p') {
      flush()
      pid = Number(value)
    } else if (field === 'c') command = value
    else if (field === 'f') {
      flush()
      current = {}
    } else if (field === 'P' && current) current.protocol = value
    else if (field === 'n' && current) current.address = value
    else if (field === 'T' && current && value.startsWith('ST=')) current.state = value.slice(3)
  }
  flush()

  return sockets
}

function isListening(socket: RawSocket): boolean {
  if (socket.protocol === 'TCP') return socket.state === 'LISTEN'

  return socket.protocol === 'UDP' && !socket.address.includes('->')
}
