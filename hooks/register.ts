import type { Register } from 'claude-code'

import { registerDeleteCommand } from '../src/commands/deleteCommand'
import { registerSnapshotTracker } from '../src/tracking/snapshotTracker'
import { PendingDeletions } from '../src/usecase/pendingDeletions'

export const register: Register = on => {
  registerSnapshotTracker(on)
  registerDeleteCommand(on, new PendingDeletions())
}
