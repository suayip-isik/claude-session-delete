import { BIN, SEARCH } from '../config'
import type { CommandRunner, FileSystem } from './host'

export interface TranscriptQuery {
  /** Folder searched recursively (`~/.claude/projects`). */
  readonly root: string
  /** Fixed text to find. */
  readonly needle: string
  /** Transcripts of this session are skipped (`<id>.jsonl`, `<id>/…`). */
  readonly excludeSessionId: string
  /** Only files modified after this one can match (a transcript older than a file cannot name it). */
  readonly newerThan: string
}

/** Answers "does any other transcript contain this text?" as fast as the machine allows. */
export interface TextSearcher {
  anyTranscriptContains(query: TranscriptQuery): Promise<boolean>
}

/** ripgrep when installed (≈10× faster on a large archive), the system grep otherwise. */
export async function createTextSearcher(runner: CommandRunner, fs: FileSystem): Promise<TextSearcher> {
  for (const candidate of SEARCH.ripgrepCandidates) {
    if (await fs.exists(candidate)) return new RipgrepSearcher(runner, candidate)
  }

  return new SystemGrepSearcher(runner)
}

class RipgrepSearcher implements TextSearcher {
  constructor(
    private readonly runner: CommandRunner,
    private readonly rg: string,
  ) { }

  async anyTranscriptContains(query: TranscriptQuery): Promise<boolean> {
    const { stdout } = await this.runner.run([
      this.rg,
      '--no-config',
      '--no-ignore',
      '--hidden',
      '--files-with-matches',
      '--fixed-strings',
      '--max-count',
      '1',
      '--glob',
      `*${SEARCH.transcriptSuffix}`,
      '--glob',
      `!${query.excludeSessionId}*`,
      '--glob',
      `!**/${query.excludeSessionId}/**`,
      '--regexp',
      query.needle,
      '--',
      query.root,
    ])

    return stdout.trim().length > 0
  }
}

class SystemGrepSearcher implements TextSearcher {
  constructor(private readonly runner: CommandRunner) { }

  async anyTranscriptContains(query: TranscriptQuery): Promise<boolean> {
    const { stdout } = await this.runner.run([
      BIN.find,
      query.root,
      '-type',
      'f',
      '-name',
      `*${SEARCH.transcriptSuffix}`,
      '-newer',
      query.newerThan,
      '!',
      '-name',
      `${query.excludeSessionId}*`,
      '!',
      '-path',
      `*/${query.excludeSessionId}/*`,
      '-exec',
      BIN.grep,
      '-lF',
      '-e',
      query.needle,
      '{}',
      '+',
    ])

    return stdout.trim().length > 0
  }
}
