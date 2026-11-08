import type { HistoryPolicy, MeasuredArtifact } from '../domain'
import type { InventoryResult } from '../inventory/inventory'

/** The session's prompt-history rows and the files only they point to (pasted texts). */
export interface PromptHistoryPlan {
  readonly rows: number
  readonly files: InventoryResult
}

/** The one rule for what a deletion removes: the session always, its prompt history only when purged. */
export function artifactsToDelete(
  session: InventoryResult,
  promptHistory: PromptHistoryPlan,
  policy: HistoryPolicy,
): MeasuredArtifact[] {
  return policy === 'purge' ? [...session.artifacts, ...promptHistory.files.artifacts] : [...session.artifacts]
}
