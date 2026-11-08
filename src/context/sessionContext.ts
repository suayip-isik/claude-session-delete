import { BIN, CLAUDE_LAYOUT, SESSION_ID_PATTERN, SUPPORTED_PLATFORM, TEMP_LAYOUT } from '../config'
import type { SessionContext } from '../domain'
import type { Host } from '../host/host'
import { joinPath } from '../host/paths'

/** What the engine tells the mod about itself; gathered by the command, resolved here. */
export interface SessionFacts {
  readonly sessionId: string
  readonly configDir: string
}

interface RegistryEntry {
  readonly pid: number
  readonly sessionId: string
  readonly messagingSocketPath?: string
}

export class ContextError extends Error { }

/** Resolves and verifies who this session is before anything is touched. */
export class SessionContextResolver {
  constructor(private readonly host: Host) { }

  async resolve(facts: SessionFacts): Promise<SessionContext> {
    await this.assertPlatform()
    const sessionId = this.validSessionId(facts.sessionId)
    const configDir = facts.configDir
    const claudePid = await this.ownerPid()
    const registry = await this.readRegistry(configDir)
    const own = registry.find(entry => entry.pid === claudePid)

    if (own !== undefined && own.sessionId !== sessionId) {
      throw new ContextError('The session registry does not match this process; stopped for safety.')
    }
    if (own === undefined && !(await this.looksLikeClaude(claudePid))) {
      throw new ContextError('The session\'s Claude process could not be verified; stopped for safety.')
    }

    const siblingPids = await this.alivePids(
      registry.filter(entry => entry.sessionId === sessionId && entry.pid !== claudePid).map(entry => entry.pid),
    )

    return {
      sessionId,
      claudePid,
      siblingPids,
      configDir,
      tempRoot: await this.tempRoot(),
      tty: await this.ttyOf(claudePid),
      socketPath: own?.messagingSocketPath,
      registryFiles: await this.registryFilesOf(configDir, claudePid),
    }
  }

  private async assertPlatform(): Promise<void> {
    const { stdout } = await this.host.runner.run([BIN.uname, '-s'])
    if (stdout.trim() !== SUPPORTED_PLATFORM) {
      throw new ContextError(`This command is supported on macOS only (detected: ${stdout.trim()}).`)
    }
  }

  private validSessionId(id: string): string {
    if (!SESSION_ID_PATTERN.test(id)) throw new ContextError(`Unexpected session id: ${id}`)

    return id
  }

  /** The process that spawns the mod's commands is the Claude Code process itself. */
  private async ownerPid(): Promise<number> {
    const { stdout } = await this.host.runner.run([BIN.sh, '-c', 'echo "$PPID"'])
    const pid = Number.parseInt(stdout.trim(), 10)
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new ContextError('Could not read the Claude process id.')

    return pid
  }

  private async readRegistry(configDir: string): Promise<RegistryEntry[]> {
    const dir = joinPath(configDir, CLAUDE_LAYOUT.registry)
    const names = (await this.host.fs.list(dir)).filter(entry => entry.kind === 'file' && /^\d+\.json$/.test(entry.name))
    const entries = await Promise.all(names.map(entry => this.readEntry(joinPath(dir, entry.name))))

    return entries.filter((entry): entry is RegistryEntry => entry !== undefined)
  }

  private async readEntry(path: string): Promise<RegistryEntry | undefined> {
    try {
      const parsed: unknown = JSON.parse(await this.host.fs.readText(path))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const { pid, sessionId, messagingSocketPath } = parsed as Record<string, unknown>
      if (typeof pid !== 'number' || typeof sessionId !== 'string') return undefined

      return { pid, sessionId, messagingSocketPath: typeof messagingSocketPath === 'string' ? messagingSocketPath : undefined }
    } catch {
      return undefined
    }
  }

  private async registryFilesOf(configDir: string, pid: number): Promise<string[]> {
    const dir = joinPath(configDir, CLAUDE_LAYOUT.registry)
    const prefix = `${pid}.`

    return (await this.host.fs.list(dir))
      .filter(entry => entry.name.startsWith(prefix))
      .map(entry => joinPath(dir, entry.name))
  }

  private async alivePids(pids: readonly number[]): Promise<number[]> {
    if (pids.length === 0) return []
    const { stdout } = await this.host.runner.run([BIN.ps, '-o', 'pid=', '-p', pids.join(',')])

    return stdout.split('\n').map(line => Number.parseInt(line.trim(), 10)).filter(Number.isSafeInteger)
  }

  private async looksLikeClaude(pid: number): Promise<boolean> {
    const { stdout } = await this.host.runner.run([BIN.ps, '-o', 'command=', '-p', String(pid)])

    return /(^|\/)claude(\s|$)/.test(stdout.trim())
  }

  private async ttyOf(pid: number): Promise<string | undefined> {
    const { stdout } = await this.host.runner.run([BIN.ps, '-o', 'tty=', '-p', String(pid)])
    const tty = stdout.trim()

    return /^tty[\w.]+$/.test(tty) ? `/dev/${tty}` : undefined
  }

  private async tempRoot(): Promise<string> {
    const uid = (await this.host.runner.run([BIN.id, '-u'])).stdout.trim()
    if (!/^\d+$/.test(uid)) throw new ContextError('Could not read the user id (uid).')
    const root = joinPath(TEMP_LAYOUT.systemTemp, `${TEMP_LAYOUT.rootPrefix}${uid}`)

    return (await this.host.fs.realPath(root)) ?? root
  }
}
