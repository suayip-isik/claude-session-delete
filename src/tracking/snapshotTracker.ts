import type { EngineInterface, On } from 'claude-code'

import { CLAUDE_LAYOUT } from '../config'
import { claudeConfigDir } from '../context/engineFacts'
import { joinPath } from '../host/paths'

/** A snapshot is written as the first shell of a session starts: only one stamped this soon after the call counts. */
const CREATION_WINDOW_MS = 10_000
const SNAPSHOT_NAME = /^snapshot-[a-z]+-(\d+)-[a-z0-9]+\.sh$/

/**
 * Shell snapshots carry no session id. Around this session's first shell
 * command the tracker notes which snapshot appeared, so /delete can prove it is
 * this session's own. One snapshot is written per session, so tracking stops
 * once it is known.
 */
export function registerSnapshotTracker(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const known = (await $.state.get({ plugin: 'session-delete', key: 'shellSnapshots' })).value ?? []
    if (known.length > 0) return next(e)

    const dir = joinPath(await claudeConfigDir($), CLAUDE_LAYOUT.shellSnapshots)
    const startedAt = await $.clock.now()
    const before = await snapshotNames($, dir)
    const result = await next(e)
    const created = [...(await snapshotNames($, dir))].filter(name => !before.has(name) && isStampedNear(name, startedAt))

    if (created.length > 0) {
      await $.state.set(
        { plugin: 'session-delete', key: 'shellSnapshots' },
        created.map(name => joinPath(dir, name)),
      )
    }

    return result
  }).catch((_$, e, next) => next(e)) // tracking must never stand between a tool and its run
}

async function snapshotNames($: EngineInterface, dir: string): Promise<Set<string>> {
  try {
    return new Set((await $.fs.list(dir)).map(entry => entry.name).filter(name => SNAPSHOT_NAME.test(name)))
  } catch {
    return new Set()
  }
}

function isStampedNear(name: string, startedAt: number): boolean {
  const stamp = Number(SNAPSHOT_NAME.exec(name)?.[1])

  return stamp >= startedAt - CREATION_WINDOW_MS && stamp <= startedAt + CREATION_WINDOW_MS
}
