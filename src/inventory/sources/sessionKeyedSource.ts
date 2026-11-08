import type { Artifact, ArtifactSource, SessionContext } from '../../domain'
import type { FileSystem } from '../../host/host'
import { joinPath } from '../../host/paths'

/**
 * Where entries named after the session live: `root` itself, or (nested) each
 * folder directly below `root` (`projects/<encoded cwd>/`, `/tmp/claude-<uid>/<encoded cwd>/`).
 */
export interface KeyedScope {
  readonly root: string
  readonly isNested: boolean
}

/**
 * Entries whose name is the session id, or starts with it followed by a
 * separator (`<id>`, `<id>.jsonl`, `<id>.txt`, `<id>-agent-1.json`): the
 * transcripts, file-history, session-env, todos, debug logs, the session's
 * mods folder and its scratch folder.
 */
export class SessionKeyedSource implements ArtifactSource {
  constructor(
    readonly name: string,
    private readonly fs: FileSystem,
    private readonly scopesOf: (context: SessionContext) => readonly KeyedScope[],
  ) { }

  async locate(context: SessionContext): Promise<Artifact[]> {
    const found = await Promise.all(this.scopesOf(context).map(scope => this.scanScope(scope, context.sessionId)))

    return found.flat()
  }

  /**
   * The scopes this source scans. Claude writes some entries lazily (a short
   * session's transcript, even its project folder, appear only at exit), so
   * the guardian sweeps these scopes again after the exit.
   */
  scopes(context: SessionContext): readonly KeyedScope[] {
    return this.scopesOf(context)
  }

  private async scanScope(scope: KeyedScope, sessionId: string): Promise<Artifact[]> {
    const dirs = scope.isNested
      ? (await this.fs.list(scope.root)).filter(entry => entry.kind === 'dir' && !entry.isLink).map(entry => joinPath(scope.root, entry.name))
      : [scope.root]
    const found = await Promise.all(dirs.map(dir => this.scanDir(dir, sessionId)))

    return found.flat()
  }

  private async scanDir(dir: string, sessionId: string): Promise<Artifact[]> {
    return (await this.fs.list(dir))
      .filter(entry => isKeyedBy(entry.name, sessionId))
      .map(entry => ({ path: joinPath(dir, entry.name) }))
  }
}

export function isKeyedBy(name: string, sessionId: string): boolean {
  return name === sessionId || (name.startsWith(sessionId) && /^[.\-_]/.test(name.slice(sessionId.length)))
}
