import { CLAUDE_LAYOUT } from '../../config'
import type { Artifact, ArtifactSource, SessionContext } from '../../domain'
import type { FileSystem } from '../../host/host'
import { joinPath, parentOf } from '../../host/paths'
import { existingArtifacts } from './existingArtifacts'

/**
 * Shell snapshots are not named after the session, so ownership is proven two
 * ways only: the snapshot tracker saw this session create it, or one of this
 * session's live shells is sourcing it right now.
 */
export class ShellSnapshotSource implements ArtifactSource {
  readonly name = 'shell-snapshots'

  constructor(
    private readonly fs: FileSystem,
    private readonly tracked: () => Promise<readonly string[]>,
    private readonly liveCommands: () => readonly string[],
  ) { }

  async locate(context: SessionContext): Promise<Artifact[]> {
    const dir = joinPath(context.configDir, CLAUDE_LAYOUT.shellSnapshots)
    const referenced = this.liveCommands().flatMap(command => command.split(/\s+/))
    const candidates = [...(await this.tracked()), ...referenced].filter(path => parentOf(path) === dir)

    return existingArtifacts(this.fs, candidates)
  }
}
