import type { DirEntry, FileSystem, Host, RunResult } from '../src/host/host'

export const SID = '11111111-2222-4333-8444-555555555555'
export const HOME = '/Users/tester'
export const CONFIG = `${HOME}/.claude`
export const CLAUDE_PID = 4242
export const TEMP_ROOT = '/private/tmp/claude-501'
export const SOCKET = '/tmp/cc-socks/4242.sock'
export const PROJECT = `${CONFIG}/projects/-Users-tester-app`
export const TRANSCRIPT = `${PROJECT}/${SID}.jsonl`
export const PLAN = `${CONFIG}/plans/brave-plan.md`
export const SNAPSHOT = `${CONFIG}/shell-snapshots/snapshot-zsh-1700000000000-abc123.sh`

/** A small machine: Claude 4242 runs `npm run dev` (5000) → `node server.js` (5001, port 3000). */
export class FakeHost implements Host {
  readonly pluginRoot = '/plugins/session-delete'
  readonly calls: string[][] = []
  readonly written = new Map<string, string>()
  private readonly alivePids = new Set([CLAUDE_PID, 5000, 5001, 7777])
  private readonly files = new Set<string>([
    `${PROJECT}/${SID}`,
    `${CONFIG}/file-history/${SID}`,
    `${CONFIG}/session-env/${SID}`,
    `${CONFIG}/sessions/4242.json`,
    `${CONFIG}/sessions/4242.abc.key`,
    `${TEMP_ROOT}/-Users-tester-app/${SID}`,
    SOCKET,
    PLAN,
    SNAPSHOT,
    `${this.pluginRoot}/bin/guardian.sh`,
    '/usr/bin/perl',
  ])

  private readonly tree: Record<string, DirEntry[]> = {
    [`${CONFIG}/projects`]: [dir('-Users-tester-app'), dir('-Users-tester-other')],
    [PROJECT]: [dir(SID), file('99999999-2222-4333-8444-555555555555.jsonl')],
    [`${CONFIG}/projects/-Users-tester-other`]: [file('aaaaaaaa-2222-4333-8444-555555555555.jsonl')],
    [`${CONFIG}/file-history`]: [dir(SID), dir('99999999-2222-4333-8444-555555555555')],
    [`${CONFIG}/session-env`]: [dir(SID)],
    [`${CONFIG}/sessions`]: [file('4242.json'), file('4242.abc.key'), file('7777.json')],
    [TEMP_ROOT]: [dir('-Users-tester-app')],
    [`${TEMP_ROOT}/-Users-tester-app`]: [dir(SID)],
  }

  readonly fs: FileSystem = {
    list: async path => this.tree[path] ?? [],
    exists: async path => this.files.has(path),
    readText: async path => {
      if (path.endsWith('/4242.json')) return JSON.stringify({ pid: 4242, sessionId: SID, messagingSocketPath: SOCKET })
      if (path.endsWith('/7777.json')) return JSON.stringify({ pid: 7777, sessionId: 'aaaaaaaa-2222-4333-8444-555555555555' })
      throw new Error(`missing ${path}`)
    },
    writeText: async (path, text) => {
      this.written.set(path, text)
    },
    realPath: async path => (path === '/tmp' || path.startsWith('/tmp/') ? `/private${path}` : path),
  }

  readonly runner = {
    run: async (argv: readonly string[]): Promise<RunResult> => {
      this.calls.push([...argv])

      return this.answer(argv)
    },
  }

  /** An entry Claude writes only later (a short session's transcript). */
  appearAtExit(dir: string, name: string): void {
    this.tree[dir] = [...(this.tree[dir] ?? []), file(name)]
    this.files.add(`${dir}/${name}`)
  }

  ran(binary: string): string[][] {
    return this.calls.filter(argv => argv[0] === binary)
  }

  private answer(argv: readonly string[]): RunResult {
    const [bin, ...args] = argv
    const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })
    const joined = args.join(' ')

    switch (bin) {
      case '/usr/bin/uname':
        return ok('Darwin\n')
      case '/usr/bin/id':
        return ok('501\n')
      case '/usr/bin/mktemp':
        return ok('/var/folders/xx/T/claude-session-delete.abc123\n')
      case '/bin/kill':
        for (const pid of args.slice(1)) this.alivePids.delete(Number(pid))
        return ok()
      case '/bin/rm':
        for (const path of args.slice(2)) this.files.delete(path)
        return ok()
      case '/usr/bin/grep':
        return args.includes('-cF') ? ok('3\n') : args.includes('-rhoE') ? ok('"slug":"brave-plan"\n') : ok()
      case '/usr/bin/find':
        if (args.includes('-newer')) return ok() // no other transcript uses the plan
        return ok(args.filter(path => path.startsWith('/')).map(path => `8 ${path}`).join('\n'))
      case '/usr/sbin/lsof':
        return this.alivePids.has(5001) ? ok('p5001\ncnode\nf20\nPTCP\nn*:3000\nTST=LISTEN\nf21\nPTCP\nn127.0.0.1:5000->1.2.3.4:443\nTST=ESTABLISHED\n') : { exitCode: 1, stdout: '', stderr: '' }
      case '/bin/sh':
        if (joined.includes('echo "$PPID"')) return ok(`${CLAUDE_PID}\n`)
        if (joined.includes('purge-history.sh')) return ok('3 420\n')
        return ok()
      case '/bin/ps':
        return ok(this.ps(args))
      default:
        return ok()
    }
  }

  private ps(args: readonly string[]): string {
    const format = args[args.indexOf('-o') + 1]
    if (args.includes('-A') && args.includes('-e')) {
      return `5001 node server.js CLAUDE_CODE_SESSION_ID=${SID}\n8000 vim CLAUDE_CODE_SESSION_ID=${SID}x\n`
    }
    if (args.includes('-A')) {
      return [
        `${CLAUDE_PID} 1 /Users/tester/.local/bin/claude --session-id ${SID}`,
        `4300 ${CLAUDE_PID} /Users/tester/.local/bin/claude --worker`,
        `5000 ${CLAUDE_PID} /bin/zsh -c source ${SNAPSHOT} && npm run dev`,
        '5001 5000 node server.js',
        '6000 1 /usr/bin/unrelated',
      ].join('\n')
    }
    const pids = (args[args.indexOf('-p') + 1] ?? '').split(',').map(Number)
    if (format === 'pid=') return pids.filter(pid => this.alivePids.has(pid)).join('\n')
    if (format === 'tty=') return 'ttys009\n'
    if (format === 'command=') return '/Users/tester/.local/bin/claude\n'

    return ''
  }
}

function dir(name: string): DirEntry {
  return { name, kind: 'dir', isLink: false }
}

function file(name: string): DirEntry {
  return { name, kind: 'file', isLink: false }
}
