import { BIN, GUARDIAN, TIMING } from '../config'
import { historyFile } from '../cleanup/historyInspector'
import type { ProcessInfo, SessionContext } from '../domain'
import type { KeyedScope } from '../inventory/sources/sessionKeyedSource'
import type { Host } from '../host/host'
import { isPlainAbsolutePath, joinPath } from '../host/paths'

export interface GuardianJob {
  readonly context: SessionContext
  /** Paths to remove again once Claude has exited (the exit writes the transcript's last rows). */
  readonly sweepPaths: readonly string[]
  /** Folders whose entries named after the session are removed after the exit, whenever they appeared. */
  readonly keyedScopes: readonly KeyedScope[]
  /** Roots a swept path must sit inside (the safety policy's, re-checked by the script). */
  readonly allowedRoots: readonly string[]
  /** The session's processes, killed after the exit if one still runs the same command. */
  readonly processes: readonly ProcessInfo[]
  /** Printed by the guardian only if `session.end` did not print the real summary. */
  readonly fallbackReport: string
}

export interface GuardianHandle {
  readonly workDir: string
}

/**
 * Starts bin/guardian.sh in a process session of its own (it outlives Claude and
 * any signal sent to Claude's group). It closes the session right away and
 * finishes whatever the exit leaves behind.
 */
export class Guardian {
  constructor(private readonly host: Host) { }

  async start(job: GuardianJob): Promise<GuardianHandle> {
    const script = joinPath(this.host.pluginRoot, GUARDIAN.script)
    if (!(await this.host.fs.exists(script))) throw new Error(`script not found: ${script}`)

    const workDir = await this.createWorkDir()
    await this.writeJob(workDir, job)

    const argv = [
      BIN.sh,
      script,
      String(job.context.claudePid),
      job.context.sessionId,
      historyFile(job.context),
      workDir,
      job.context.tty ?? '-',
      TIMING.exitSignalDelaySeconds,
      String(TIMING.exitFailsafeSeconds),
    ]
    const { exitCode, stderr } = await this.host.runner.run(await this.detached(argv))
    if (exitCode !== 0) throw new Error(stderr.trim() || `the guardian did not start (exit code ${exitCode})`)

    return { workDir }
  }

  /** Tells the guardian the real summary is on screen, so it stays silent. */
  async markPrinted(handle: GuardianHandle): Promise<void> {
    await this.host.fs.writeText(joinPath(handle.workDir, GUARDIAN.files.printed), '1\n')
  }

  private async createWorkDir(): Promise<string> {
    const { exitCode, stdout } = await this.host.runner.run([BIN.mktemp, '-d', '-t', GUARDIAN.workDirTemplate])
    const dir = stdout.trim()
    if (exitCode !== 0 || !isPlainAbsolutePath(dir)) throw new Error('could not create a temporary work folder')

    return dir
  }

  private async writeJob(workDir: string, job: GuardianJob): Promise<void> {
    const lines = (values: readonly string[]): string => `${values.join('\n')}\n`
    const file = (name: string): string => joinPath(workDir, name)

    await Promise.all([
      this.host.fs.writeText(file(GUARDIAN.files.paths), lines(job.sweepPaths.filter(isPlainAbsolutePath))),
      this.host.fs.writeText(file(GUARDIAN.files.roots), lines(job.allowedRoots.filter(isPlainAbsolutePath))),
      this.host.fs.writeText(
        file(GUARDIAN.files.keyed),
        lines(job.keyedScopes.filter(scope => isPlainAbsolutePath(scope.root)).map(scope => `${scope.isNested ? 1 : 0} ${scope.root}`)),
      ),
      this.host.fs.writeText(
        file(GUARDIAN.files.pids),
        lines(job.processes.map(process => `${process.pid} ${process.command.replace(/[\r\n]/g, ' ').trimEnd()}`)),
      ),
      this.host.fs.writeText(file(GUARDIAN.files.fallbackReport), job.fallbackReport),
    ])
  }

  /** `setsid` through perl where present (macOS ships it); a plain background job otherwise. */
  private async detached(argv: readonly string[]): Promise<string[]> {
    const background = '"$@" </dev/null >/dev/null 2>&1 &'
    if (!(await this.host.fs.exists(BIN.perl))) return [BIN.sh, '-c', background, 'sh', ...argv]

    return [BIN.sh, '-c', background, 'sh', BIN.perl, '-MPOSIX', '-e', 'POSIX::setsid(); exec { $ARGV[0] } @ARGV or exit 127', ...argv]
  }
}
