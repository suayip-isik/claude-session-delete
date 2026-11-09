import type { Artifact, SessionContext } from '../domain'
import type { FileSystem } from '../host/host'
import { baseName, isPlainAbsolutePath, isStrictlyInside, joinPath, parentOf } from '../host/paths'

export interface Verdict {
  readonly isAllowed: boolean
  readonly reason?: string
}

/**
 * The last gate before anything is deleted: an item must sit strictly inside one
 * of the session's own roots once every link of its parent is resolved. The item
 * itself is not followed, so a link is removed as a link and never its target.
 */
export class SafetyPolicy {
  private constructor(private readonly roots: readonly string[]) { }

  allowedRoots(): readonly string[] {
    return this.roots
  }

  static async create(context: SessionContext, fs: FileSystem): Promise<SafetyPolicy> {
    const candidates = [context.configDir, context.tempRoot, ...(context.socketPath ? [parentOf(context.socketPath)] : [])]
    const resolved = await Promise.all(candidates.map(async root => (await fs.realPath(root)) ?? root))

    return new SafetyPolicy([...new Set([...candidates, ...resolved])])
  }

  async check(artifact: Artifact, fs: FileSystem): Promise<Verdict> {
    if (!isPlainAbsolutePath(artifact.path)) return { isAllowed: false, reason: 'invalid path' }

    const parent = (await fs.realPath(parentOf(artifact.path))) ?? parentOf(artifact.path)
    const resolved = joinPath(parent, baseName(artifact.path))
    const isInsideRoot = this.roots.some(root => isStrictlyInside(resolved, root))

    return isInsideRoot ? { isAllowed: true } : { isAllowed: false, reason: 'outside the allowed folders' }
  }
}
