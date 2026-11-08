import type { EngineInterface } from 'claude-code'

import { TIMING } from '../config'

/**
 * The narrow slice of the engine the mod depends on. Every module takes these
 * interfaces, never `$`, so each one can be tested with a fake host.
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

export function createHost($: EngineInterface): Host {
  const runner: CommandRunner = {
    run: async (argv, options) => {
      const { exitCode, stdout, stderr } = await $.process.run(argv, {
        timeoutMs: options?.timeoutMs ?? TIMING.commandTimeoutMs,
        ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
      })

      return { exitCode, stdout, stderr }
    },
  }

  const fs: FileSystem = {
    list: async path => {
      try {
        return (await $.fs.list(path)).map(({ name, kind, isLink }) => ({ name, kind, isLink }))
      } catch {
        return []
      }
    },
    exists: path => $.fs.exists(path),
    readText: path => $.fs.read(path),
    writeText: (path, text) => $.fs.write(path, text),
    realPath: async path => {
      try {
        return (await $.fs.stat(path, { resolve: true })).realPath
      } catch {
        return undefined
      }
    },
  }

  return { runner, fs, pluginRoot: $.plugin.root }
}
