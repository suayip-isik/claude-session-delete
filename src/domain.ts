/** Plain data shared by every module. No behaviour lives here. */

export interface SessionContext {
  readonly sessionId: string
  /** The Claude Code process that owns this session. */
  readonly claudePid: number
  /** Other live Claude processes attached to the same session id (a resumed copy). */
  readonly siblingPids: readonly number[]
  readonly configDir: string
  /** `/tmp/claude-<uid>`, resolved. */
  readonly tempRoot: string
  /** The terminal the session draws on (`/dev/ttys003`), when it has one. */
  readonly tty: string | undefined
  /** The session's IPC socket, as the session registry records it. */
  readonly socketPath: string | undefined
  /** The session registry files (`sessions/<pid>.json`, `.key`). */
  readonly registryFiles: readonly string[]
}

/** One file-system item to delete (a file, a link or a whole folder). */
export interface Artifact {
  readonly path: string
}

export interface MeasuredArtifact extends Artifact {
  /** Files (and links) below it, itself included when it is one. */
  readonly fileCount: number
  /** What deleting it frees on disk: the blocks its files hold. */
  readonly allocatedBytes: number
}

export interface ProcessInfo {
  readonly pid: number
  readonly ppid: number
  readonly command: string
}

export interface ListeningSocket {
  readonly pid: number
  readonly command: string
  readonly protocol: string
  readonly address: string
}

export interface ProcessPlan {
  readonly processes: readonly ProcessInfo[]
  readonly sockets: readonly ListeningSocket[]
}

export interface TerminationResult {
  readonly stopped: readonly ProcessInfo[]
  readonly forced: readonly ProcessInfo[]
  readonly survivors: readonly ProcessInfo[]
  readonly closedSockets: readonly ListeningSocket[]
  readonly openSockets: readonly ListeningSocket[]
}

export interface DeletionResult {
  readonly deleted: readonly MeasuredArtifact[]
  readonly failed: readonly { readonly artifact: MeasuredArtifact; readonly reason: string }[]
}

/** Finds the items one kind of session data leaves on disk. */
export interface ArtifactSource {
  readonly name: string
  locate(context: SessionContext): Promise<readonly Artifact[]>
}
