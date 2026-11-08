/**
 * Every tunable value of the mod lives here; modules read names, never literals.
 */

/** Slash command names, in order of preference (the first one the engine accepts wins). */
export const COMMAND_NAMES = ['delete', 'delete-session'] as const

export const COMMAND_DESCRIPTION =
  'Permanently delete this session and every trace of it on disk, stop its processes and close it (no model call)'

export const CONFIRM = {
  header: 'Delete session',
  approve: 'Yes, delete permanently',
  cancel: 'Cancel',
} as const

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The environment variable Claude Code stamps on every shell it starts for a session. */
export const SESSION_ENV_TAG = 'CLAUDE_CODE_SESSION_ID'

/** Absolute paths of the host tools (macOS); absolute so a PATH entry cannot shadow them. */
export const BIN = {
  sh: '/bin/sh',
  ps: '/bin/ps',
  kill: '/bin/kill',
  rm: '/bin/rm',
  find: '/usr/bin/find',
  stat: '/usr/bin/stat',
  grep: '/usr/bin/grep',
  lsof: '/usr/sbin/lsof',
  id: '/usr/bin/id',
  uname: '/usr/bin/uname',
  mktemp: '/usr/bin/mktemp',
  perl: '/usr/bin/perl',
  sleep: '/bin/sleep',
} as const

export const SUPPORTED_PLATFORM = 'Darwin'

/** Where Claude Code keeps per-session data, relative to its config dir. */
export const CLAUDE_LAYOUT = {
  defaultDirName: '.claude',
  projects: 'projects',
  registry: 'sessions',
  shellSnapshots: 'shell-snapshots',
  plans: 'plans',
  pasteCache: 'paste-cache',
  history: 'history.jsonl',
  /** Folders whose entries are named after the session id (`<id>`, `<id>.txt`, `<id>-agent-…`). */
  sessionKeyedDirs: ['file-history', 'session-env', 'dev-mods', 'todos', 'tasks', 'debug'],
} as const

/** Claude Code's per-user scratch root is `<SYSTEM_TEMP>/<TEMP_ROOT_PREFIX><uid>`. */
export const TEMP_LAYOUT = {
  systemTemp: '/tmp',
  rootPrefix: 'claude-',
} as const

/**
 * How a session names its shared files (extended regex). A plan belongs to the
 * session whose messages carry its slug; pasted text to the history rows that
 * carry its hash.
 */
export const REFERENCE_PATTERNS = {
  planSlug: String.raw`"slug":"[A-Za-z0-9._-]+"`,
  planExtension: '.md',
  paste: String.raw`"contentHash":"[0-9a-f]+"`,
  pasteExtension: '.txt',
} as const

export const SEARCH = {
  /** Searched in order; the system grep is the fallback. */
  ripgrepCandidates: ['/opt/homebrew/bin/rg', '/usr/local/bin/rg'],
  transcriptSuffix: '.jsonl',
} as const

export const TIMING = {
  /** SIGTERM → SIGKILL grace for the session's processes; short, it runs inside Claude's exit. */
  terminateGraceMs: 600,
  terminatePollMs: 100,
  /** The guardian signals Claude this long after /delete returns, so the command's answer lands first. */
  exitSignalDelaySeconds: '0.2',
  /** If Claude has not exited this long after the signal, the guardian kills it. */
  exitFailsafeSeconds: 20,
  /** Below this much of `session.end`'s bound left, the work is left to the guardian. */
  sessionEndReserveMs: 150,
  commandTimeoutMs: 60_000,
} as const

export const REPORT = {
  /** At most this many warning lines in the summary; the rest are counted. */
  maxWarnings: 5,
  blockSize: 512,
} as const

/** The detached helper that triggers the exit and finishes what the exit leaves (bin/guardian.sh). */
export const GUARDIAN = {
  script: 'bin/guardian.sh',
  purgeHistoryScript: 'bin/purge-history.sh',
  workDirTemplate: 'claude-session-delete.XXXXXX',
  files: {
    paths: 'paths',
    roots: 'roots',
    /** "<0|1> <folder>": entries named after the session in the folder (0) or in each folder below it (1). */
    keyed: 'keyed',
    pids: 'pids',
    /** The summary to print if `session.end` could not (written up front, from the plan). */
    fallbackReport: 'fallback-report.txt',
    /** Present once `session.end` printed the real summary. */
    printed: 'printed',
  },
} as const
