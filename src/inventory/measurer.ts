import { BIN, REPORT } from '../config'
import type { Artifact, MeasuredArtifact } from '../domain'
import type { CommandRunner } from '../host/host'
import { parentOf } from '../host/paths'

/** One line of `stat -f '%b %N'`: a file and the bytes its blocks hold. */
export interface StatLine {
  readonly path: string
  readonly allocatedBytes: number
}

/**
 * Counts the files below each item and the disk space they hold, in one
 * `find … -exec stat` run. Links are measured as links, never followed.
 * Items must not nest (the inventory keeps the outermost only).
 */
export class Measurer {
  constructor(private readonly runner: CommandRunner) { }

  async measure(artifacts: readonly Artifact[]): Promise<MeasuredArtifact[]> {
    if (artifacts.length === 0) return []
    const { stdout } = await this.runner.run([
      BIN.find,
      ...artifacts.map(artifact => artifact.path),
      '!',
      '-type',
      'd',
      '-exec',
      BIN.stat,
      '-f',
      '%b %N',
      '{}',
      '+',
    ])

    const totals = new Map(artifacts.map(artifact => [artifact.path, { fileCount: 0, allocatedBytes: 0 }]))
    for (const line of parseStat(stdout)) {
      const owner = totals.get(ownerOf(line.path, totals))
      if (owner === undefined) continue
      owner.fileCount += 1
      owner.allocatedBytes += line.allocatedBytes
    }

    return artifacts.map(artifact => ({ ...artifact, ...(totals.get(artifact.path) ?? { fileCount: 0, allocatedBytes: 0 }) }))
  }
}

/** The measured item a file belongs to: the file itself or its nearest listed ancestor. */
function ownerOf(path: string, owners: ReadonlyMap<string, unknown>): string {
  let current = path
  while (!owners.has(current) && current !== '/') current = parentOf(current)

  return current
}

export function parseStat(output: string): StatLine[] {
  return output.split('\n').flatMap(line => {
    const match = /^(\d+) (\/.*)$/.exec(line)
    const [, blocks, path] = match ?? []

    return blocks !== undefined && path !== undefined ? [{ allocatedBytes: Number(blocks) * REPORT.blockSize, path }] : []
  })
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
