import { BIN } from '../config'
import type { DeletionResult, MeasuredArtifact } from '../domain'
import type { CommandRunner, FileSystem } from '../host/host'

/** Removes measured items (already cleared by the safety policy) and checks each is gone. */
export class Deleter {
  constructor(
    private readonly runner: CommandRunner,
    private readonly fs: FileSystem,
  ) { }

  async delete(artifacts: readonly MeasuredArtifact[]): Promise<DeletionResult> {
    if (artifacts.length === 0) return { deleted: [], failed: [] }

    const { stderr } = await this.runner.run([BIN.rm, '-rf', '--', ...artifacts.map(artifact => artifact.path)])
    const remaining = await Promise.all(artifacts.map(artifact => this.fs.exists(artifact.path)))

    return {
      deleted: artifacts.filter((_, index) => !remaining[index]),
      failed: artifacts
        .filter((_, index) => remaining[index])
        .map(artifact => ({ artifact, reason: firstLineAbout(stderr, artifact.path) ?? 'could not be removed' })),
    }
  }
}

function firstLineAbout(stderr: string, path: string): string | undefined {
  return stderr.split('\n').find(line => line.includes(path))?.trim()
}
