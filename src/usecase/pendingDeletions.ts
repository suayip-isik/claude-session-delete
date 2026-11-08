import type { PendingDeletion } from './deleteSession'

/**
 * Hands a confirmed deletion from the /delete command to the `session.end`
 * hook of the same module, keyed by session id. Lives as long as the module.
 */
export class PendingDeletions {
  private readonly bySession = new Map<string, PendingDeletion>()

  add(pending: PendingDeletion): void {
    this.bySession.set(pending.plan.context.sessionId, pending)
  }

  /** Removes and returns the deletion waiting for this session, if any. */
  take(sessionId: string): PendingDeletion | undefined {
    const pending = this.bySession.get(sessionId)
    this.bySession.delete(sessionId)

    return pending
  }
}
