import type { CommandRunInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { COMMAND_NAMES } from '../src/config'
import { SafetyPolicy } from '../src/cleanup/safetyPolicy'
import { createDeleteSession } from '../src/compositionRoot'
import { outermost } from '../src/inventory/inventory'
import { Measurer, parseStat } from '../src/inventory/measurer'
import { isKeyedBy } from '../src/inventory/sources/sessionKeyedSource'
import { parseLsof } from '../src/processes/socketInspector'
import { formatBytes } from '../src/report/format'
import { CLAUDE_PID, CONFIG, FakeHost, PLAN, SID, SNAPSHOT, SOCKET, TRANSCRIPT } from './fakeHost'

const facts = { sessionId: SID, configDir: CONFIG }

/** `/delete` as the person types it at the prompt, on the main screen. */
const TYPED_DELETE: CommandRunInput = {
  command: COMMAND_NAMES[0],
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 140 },
}

test('plan reads only: nothing is killed or removed before the confirmation', async () => {
  const host = new FakeHost()
  const plan = await createDeleteSession(host, async () => []).plan(facts)

  expect(host.ran('/bin/kill').length).toBe(0)
  expect(host.ran('/bin/rm').length).toBe(0)
  expect(plan.context.claudePid).toBe(CLAUDE_PID)
  expect(plan.context.tty).toBe('/dev/ttys009')
  expect(plan.historyRows).toBe(3)
})

test('plan finds the session tree and its port, never Claude, its worker or unrelated processes', async () => {
  const plan = await createDeleteSession(new FakeHost(), async () => []).plan(facts)
  const pids = plan.processes.processes.map(process => process.pid).sort()

  expect(pids).toEqual([5000, 5001])
  expect(plan.processes.sockets.map(socket => socket.address)).toEqual(['*:3000'])
})

test('plan lists every trace of the session and nothing of other sessions', async () => {
  const plan = await createDeleteSession(new FakeHost(), async () => []).plan(facts)
  const paths = plan.inventory.artifacts.map(artifact => artifact.path)

  expect(paths).not.toContain(TRANSCRIPT) // not written yet: found again at the exit
  expect(paths).toContain(`${CONFIG}/projects/-Users-tester-app/${SID}`)
  expect(paths).toContain(`${CONFIG}/file-history/${SID}`)
  expect(paths).toContain(`${CONFIG}/session-env/${SID}`)
  expect(paths).toContain(`${CONFIG}/sessions/4242.json`)
  expect(paths).toContain(`${CONFIG}/sessions/4242.abc.key`)
  expect(paths).toContain(`/private/tmp/claude-501/-Users-tester-app/${SID}`)
  expect(paths).toContain(SOCKET)
  expect(paths).toContain(PLAN)
  expect(paths).toContain(SNAPSHOT) // proven by the live shell that sources it
  expect(paths.some(path => path.includes('99999999') || path.includes('aaaaaaaa'))).toBe(false)
  expect(paths.some(path => path.endsWith('7777.json'))).toBe(false)
  expect(plan.inventory.refused.length).toBe(0)
})

test('begin only starts the guardian: nothing is stopped or deleted while the session is still open', async () => {
  const host = new FakeHost()
  const useCase = createDeleteSession(host, async () => [])
  const pending = await useCase.begin(await useCase.plan(facts))

  expect(host.ran('/bin/kill').length).toBe(0)
  expect(host.ran('/bin/rm').length).toBe(0)
  const launch = host.ran('/bin/sh').find(argv => argv.includes('/plugins/session-delete/bin/guardian.sh'))
  expect(launch).toBeDefined()
  expect(launch?.slice(0, 5)).toEqual(['/bin/sh', '-c', '"$@" </dev/null >/dev/null 2>&1 &', 'sh', '/usr/bin/perl'])
  expect(launch).toContain(String(CLAUDE_PID))
  expect(launch).toContain('/dev/ttys009')
  const work = '/var/folders/xx/T/claude-session-delete.abc123'
  expect(pending.guardian.workDir).toBe(work)
  expect(host.written.get(`${work}/paths`)).toContain(`${CONFIG}/file-history/${SID}`)
  expect(host.written.get(`${work}/pids`)).toContain('5001 node server.js')
  // Swept after the exit whatever they held at plan time: a short session writes its transcript only then.
  expect(host.written.get(`${work}/keyed`)).toContain(`1 ${CONFIG}/projects`)
  expect(host.written.get(`${work}/keyed`)).toContain(`0 ${CONFIG}/file-history`)
  expect(host.written.get(`${work}/keyed`)).toContain('1 /private/tmp/claude-501')
  expect(host.written.get(`${work}/fallback-report.txt`)).toContain('Claude Code session')
})

test('complete stops, deletes, purges the history, prints the summary and silences the guardian', async () => {
  const host = new FakeHost()
  const useCase = createDeleteSession(host, async () => [])
  const pending = await useCase.begin(await useCase.plan(facts))
  host.appearAtExit(`${CONFIG}/projects/-Users-tester-app`, `${SID}.jsonl`) // written lazily, after the plan
  const result = await useCase.complete(pending)

  expect(host.ran('/bin/kill')[0]).toEqual(['/bin/kill', '-TERM', '5000', '5001'])
  const removed = host.ran('/bin/rm')[0] ?? []
  expect(removed.slice(0, 3)).toEqual(['/bin/rm', '-rf', '--'])
  expect(removed).toContain(TRANSCRIPT)
  expect(host.ran('/bin/sh').some(argv => argv[1]?.endsWith('bin/purge-history.sh'))).toBe(true)

  const print = host.ran('/bin/sh').find(argv => argv[2] === 'cat > "$1"')
  expect(print?.[4]).toBe('/dev/ttys009')
  expect(result.isPrinted).toBe(true)
  expect(host.written.has('/var/folders/xx/T/claude-session-delete.abc123/printed')).toBe(true)

  expect(result.report).toContain('2 processes stopped')
  expect(result.report).toContain('1 port closed')
  expect(result.report).toContain(`session ${SID} deleted`)
  expect(result.report).toContain('3 history rows removed')
  expect(result.report).toMatch(/\d+ files removed · [\d.]+ (B|KB|MB) freed/)
  expect(result.report.trim().split('\n').length).toBeLessThanOrEqual(3)
})

test('the safety policy refuses anything outside the session roots', async () => {
  const host = new FakeHost()
  const context = (await createDeleteSession(host, async () => []).plan(facts)).context
  const policy = await SafetyPolicy.create(context, host.fs)

  expect((await policy.check({ path: `${CONFIG}/projects/x/${SID}.jsonl` }, host.fs)).isAllowed).toBe(true)
  expect((await policy.check({ path: '/Users/tester/Documents/project' }, host.fs)).isAllowed).toBe(false)
  expect((await policy.check({ path: CONFIG }, host.fs)).isAllowed).toBe(false)
  expect((await policy.check({ path: `${CONFIG}/../Documents` }, host.fs)).isAllowed).toBe(false)
  expect((await policy.check({ path: 'relative/path' }, host.fs)).isAllowed).toBe(false)
})

test('the measurer assigns every file to the item that holds it, in one run', async () => {
  const runs: string[][] = []
  const runner = {
    run: async (argv: readonly string[]) => {
      runs.push([...argv])

      return { exitCode: 0, stdout: ['8 /a/x', '16 /a/sub/y', '8 /b.jsonl', '8 /elsewhere/z'].join('\n'), stderr: '' }
    },
  }
  const measured = await new Measurer(runner).measure([{ path: '/a' }, { path: '/b.jsonl' }, { path: '/c' }])

  expect(runs.length).toBe(1)
  expect(measured).toEqual([
    { path: '/a', fileCount: 2, allocatedBytes: 12_288 },
    { path: '/b.jsonl', fileCount: 1, allocatedBytes: 4096 },
    { path: '/c', fileCount: 0, allocatedBytes: 0 },
  ])
})

test('the parsers and helpers', async () => {
  expect(isKeyedBy(SID, SID)).toBe(true)
  expect(isKeyedBy(`${SID}.jsonl`, SID)).toBe(true)
  expect(isKeyedBy(`${SID}-agent-1.json`, SID)).toBe(true)
  expect(isKeyedBy(`${SID}x`, SID)).toBe(false)
  expect(isKeyedBy(`x${SID}`, SID)).toBe(false)

  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(1536)).toBe('1.5 KB')
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')

  expect(parseStat('8 /a/b c\nbad line\n')).toEqual([{ allocatedBytes: 4096, path: '/a/b c' }])
  expect(outermost([{ path: '/a' }, { path: '/a/b' }, { path: '/a' }]).length).toBe(1)

  const sockets = parseLsof('p1\ncnode\nf3\nPTCP\nn*:8080\nTST=LISTEN\nf4\nPUDP\nn*:5353\np2\ncpy\nf5\nPTCP\nn1.1.1.1:1->2.2.2.2:2\nTST=ESTABLISHED\n')
  expect(sockets.map(socket => `${socket.pid} ${socket.protocol} ${socket.address} ${socket.state ?? ''}`)).toEqual([
    '1 TCP *:8080 LISTEN',
    '1 UDP *:5353 ',
    '2 TCP 1.1.1.1:1->2.2.2.2:2 ESTABLISHED',
  ])
})

test('/delete cancelled at the dialog changes nothing and keeps the session', async ($, on) => {
  const calls: string[][] = []
  on('command.register', () => ({ value: { command: 'delete' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SID }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/tester' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    const out = e.argv[0] === '/usr/bin/uname' ? 'Darwin' : e.argv[0] === '/bin/sh' ? '4242' : e.argv[0] === '/usr/bin/id' ? '501' : '/x/claude'

    return { value: { exitCode: 0, stdout: `${out}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ deny: 'dismissed' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const result = await $.command.run(TYPED_DELETE)

  expect(result.text).toContain('Cancelled')
  expect(calls.some(argv => argv[0] === '/bin/rm' || argv[0] === '/bin/kill')).toBe(false)
})
