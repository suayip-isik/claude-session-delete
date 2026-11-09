/**
 * The narrow slice of the engine the mod depends on. Every module takes these
 * interfaces, never `$`, so each one can be tested with a fake host. The real
 * host is built in `commands/deleteCommand.ts`, from plain `$.noun.method(...)` calls.
 */
export interface RunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface RunOptions {
  readonly timeoutMs?: number
  /** Text written to the child's standard input. */
  readonly stdin?: string
}

export interface CommandRunner {
  run(argv: readonly string[], options?: RunOptions): Promise<RunResult>
}

export interface DirEntry {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'other'
  readonly isLink: boolean
}

export interface FileSystem {
  list(path: string): Promise<readonly DirEntry[]>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  /** The path with every link followed, or undefined when it leads nowhere. */
  realPath(path: string): Promise<string | undefined>
}

export interface Host {
  readonly runner: CommandRunner
  readonly fs: FileSystem
  readonly pluginRoot: string
}
