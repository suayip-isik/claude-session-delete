import { BIN } from '../config'
import type { CommandRunner } from '../host/host'

/**
 * Writes straight to the session's terminal device. Used while Claude exits:
 * its interface is gone but it still holds the terminal, so the shell prompt
 * comes after this text and nothing waits for a key.
 */
export class TerminalWriter {
  constructor(private readonly runner: CommandRunner) { }

  async write(tty: string | undefined, text: string): Promise<boolean> {
    if (tty === undefined || !/^\/dev\/tty[\w.]+$/.test(tty)) return false
    const { exitCode } = await this.runner.run([BIN.sh, '-c', 'cat > "$1"', 'sh', tty], { stdin: text })

    return exitCode === 0
  }
}
