import { CLAUDE_LAYOUT } from '../config'
import { joinPath } from '../host/paths'
import { ContextError } from './sessionContext'

/**
 * The Claude config folder, from the two environment values the hook files read
 * (`CLAUDE_CONFIG_DIR`, then `HOME`). Pure on purpose: the engine is only ever
 * touched by plain `$.noun.method(...)` calls inside the files that declare hooks.
 */
export function configDirFrom(override: string | undefined, home: string | undefined): string {
  if (override) return override
  if (!home) throw new ContextError('HOME is not set; the Claude config folder could not be found.')

  return joinPath(home, CLAUDE_LAYOUT.defaultDirName)
}
