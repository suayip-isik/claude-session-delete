import type { SafetyPolicy } from '../cleanup/safetyPolicy'
import type { Artifact, ArtifactSource, MeasuredArtifact, SessionContext } from '../domain'
import type { FileSystem } from '../host/host'
import { isStrictlyInside } from '../host/paths'
import type { Measurer } from './measurer'

export interface InventoryResult {
  readonly artifacts: readonly MeasuredArtifact[]
  /** Items a source proposed that the safety policy refused, with why. */
  readonly refused: readonly { readonly artifact: Artifact; readonly reason: string }[]
  /** Sources that failed; the rest still ran. */
  readonly errors: readonly string[]
}

/** Asks every source, drops duplicates and nested items, applies the safety policy, measures. */
export class Inventory {
  constructor(
    private readonly sources: readonly ArtifactSource[],
    private readonly policy: SafetyPolicy,
    private readonly fs: FileSystem,
    private readonly measurer: Measurer,
  ) { }

  async collect(context: SessionContext): Promise<InventoryResult> {
    const errors: string[] = []
    const found = await Promise.all(
      this.sources.map(source =>
        source.locate(context).catch((error: unknown) => {
          errors.push(`${source.name}: ${describe(error)}`)

          return [] as readonly Artifact[]
        }),
      ),
    )

    const allowed: Artifact[] = []
    const refused: { artifact: Artifact; reason: string }[] = []
    for (const artifact of outermost(found.flat())) {
      const verdict = await this.policy.check(artifact, this.fs)
      if (verdict.isAllowed) allowed.push(artifact)
      else refused.push({ artifact, reason: verdict.reason ?? 'refused' })
    }

    return { artifacts: await this.measurer.measure(allowed), refused, errors }
  }
}

/** One entry per path, and none inside another chosen folder (the folder removes it). */
export function outermost(artifacts: readonly Artifact[]): Artifact[] {
  const unique = [...new Map(artifacts.map(artifact => [artifact.path, artifact])).values()]

  return unique.filter(artifact => !unique.some(other => isStrictlyInside(artifact.path, other.path)))
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
