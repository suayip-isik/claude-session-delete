import type { EngineInterface } from 'claude-code'

import { CLAUDE_LAYOUT } from '../config'
import { joinPath } from '../host/paths'
import { ContextError, type SessionFacts } from './sessionContext'

/** The only place that reads identity facts off the engine (env names must be literals at the call). */
export async function readSessionFacts($: EngineInterface): Promise<SessionFacts> {
  return { sessionId: await $.session.id(), configDir: await claudeConfigDir($) }
}

export async function claudeConfigDir($: EngineInterface): Promise<string> {
  const override = await $.env.get('CLAUDE_CONFIG_DIR')
  if (override) return override

  const home = await $.env.get('HOME')
  if (!home) throw new ContextError('HOME is not set; the Claude config folder could not be found.')

  return joinPath(home, CLAUDE_LAYOUT.defaultDirName)
}

export async function trackedShellSnapshots($: EngineInterface): Promise<readonly string[]> {
  return (await $.state.get({ plugin: 'session-delete', key: 'shellSnapshots' })).value ?? []
}
