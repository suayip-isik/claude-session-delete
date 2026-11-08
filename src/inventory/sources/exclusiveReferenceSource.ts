import { BIN, CLAUDE_LAYOUT } from '../../config'
import { historyFile, historyMarker } from '../../cleanup/historyInspector'
import type { Artifact, ArtifactSource, SessionContext } from '../../domain'
import type { CommandRunner, FileSystem } from '../../host/host'
import { joinPath } from '../../host/paths'
import type { TextSearcher } from '../../host/textSearch'

/** One kind of shared file a session refers to (a plan, a pasted text). */
export interface ReferenceKind {
  /** Extended regex matching the reference in this session's transcripts or history rows. */
  readonly pattern: string
  /** Whether this session's transcripts are searched for the pattern (else only its history rows). */
  readonly isInTranscripts: boolean
  /** The bare token (file name stem or hash) inside one match. */
  readonly token: (match: string) => string | undefined
  /** Where the file for a token lives. */
  readonly pathOf: (context: SessionContext, token: string) => string
  /** The text another session's transcript would hold if it used the same file; absent: history only. */
  readonly sharedNeedle?: (token: string) => string
}

/**
 * Files in shared folders (plans, paste-cache) that only this session uses.
 * A token in another session's prompt history, or (for plans) another
 * transcript carrying the same slug, keeps its file.
 */
export class ExclusiveReferenceSource implements ArtifactSource {
  constructor(
    readonly name: string,
    private readonly kind: ReferenceKind,
    private readonly runner: CommandRunner,
    private readonly fs: FileSystem,
    private readonly searcher: TextSearcher,
    private readonly transcripts: (context: SessionContext) => Promise<readonly string[]>,
  ) { }

  async locate(context: SessionContext): Promise<Artifact[]> {
    const tokens = [...(await this.tokensOfSession(context))]
    if (tokens.length === 0) return []

    const inOtherHistory = await this.tokensInOtherHistory(context, tokens)
    const candidates = await Promise.all(
      tokens.map(async token => {
        const path = this.kind.pathOf(context, token)
        const isOwned = !inOtherHistory.has(token) && (await this.fs.exists(path)) && !(await this.isUsedByAnotherTranscript(context, token, path))

        return isOwned ? [{ path }] : []
      }),
    )

    return candidates.flat()
  }

  private async tokensOfSession(context: SessionContext): Promise<Set<string>> {
    const transcripts = this.kind.isInTranscripts ? await this.transcripts(context) : []
    const [fromTranscripts, fromHistory] = await Promise.all([
      transcripts.length
        ? this.runner.run([BIN.grep, '-rhoE', '--', this.kind.pattern, ...transcripts]).then(result => result.stdout)
        : Promise.resolve(''),
      this.runner
        .run([
          BIN.sh,
          '-c',
          '"$1" -F -- "$2" "$3" | "$1" -oE -- "$4"',
          'sh',
          BIN.grep,
          historyMarker(context.sessionId),
          historyFile(context),
          this.kind.pattern,
        ])
        .then(result => result.stdout),
    ])

    return this.toTokens(`${fromTranscripts}\n${fromHistory}`)
  }

  private async tokensInOtherHistory(context: SessionContext, tokens: readonly string[]): Promise<Set<string>> {
    const { stdout } = await this.runner.run([
      BIN.sh,
      '-c',
      'g=$1; marker=$2; file=$3; shift 3; "$g" -vF -- "$marker" "$file" | "$g" -ohF "$@"',
      'sh',
      BIN.grep,
      historyMarker(context.sessionId),
      historyFile(context),
      ...tokens.flatMap(token => ['-e', token]),
    ])

    return new Set(stdout.split('\n').filter(line => tokens.includes(line)))
  }

  private async isUsedByAnotherTranscript(context: SessionContext, token: string, path: string): Promise<boolean> {
    if (this.kind.sharedNeedle === undefined) return false

    return this.searcher.anyTranscriptContains({
      root: joinPath(context.configDir, CLAUDE_LAYOUT.projects),
      needle: this.kind.sharedNeedle(token),
      excludeSessionId: context.sessionId,
      newerThan: path,
    })
  }

  private toTokens(output: string): Set<string> {
    return new Set(
      output
        .split('\n')
        .map(match => this.kind.token(match))
        .filter((token): token is string => token !== undefined && /^[A-Za-z0-9._-]+$/.test(token)),
    )
  }
}
