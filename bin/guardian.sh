#!/bin/sh
# The guardian of one /delete: started detached (a process session of its own)
# right after the person confirmed.
#
#   1. signals the Claude process (SIGTERM) so the session closes at once;
#      the mod's `session.end` hook then stops, deletes and prints the summary
#      while Claude still holds the terminal, so the shell prompt comes after it;
#   2. waits for Claude to exit (SIGKILL after the failsafe);
#   3. silently removes what the exit wrote last: the listed paths, and every
#      entry named after the session in the keyed folders (a short session's
#      transcript, even its project folder, appear only at exit); stops any
#      listed process still alive and, unless the prompt history is kept,
#      purges the session's history rows again;
#   4. only if `session.end` could not print the summary, prints the fallback;
#   5. removes its own work folder.
#
# Usage: guardian.sh <claude-pid> <session-id> <history-file|-> <work-dir> <tty|-> <signal-delay> <failsafe-seconds>
# A `-` history file keeps the prompt history; a `-` tty prints nothing.
# <work-dir>: paths, roots, keyed ("<0|1> <folder>"), pids ("<pid> <command>"),
#             fallback-report.txt, printed (marker).

set -u
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/common.sh
. "$here/lib/common.sh"

readonly POLL=0.1
readonly POLLS_PER_SECOND=10

[ "$#" -eq 7 ] || usage_error
pid=$1 sid=$2 history=$3 work=$4 tty=$5 delay=$6 failsafe=$7

if ! { is_uint "$pid" && is_uint "$failsafe" && is_decimal "$delay" && is_session_id "$sid"; }; then
  usage_error
fi
# The work folder must be a folder this user owns (stat, as `test -O` is not POSIX).
if ! { [ -d "$work" ] && [ "$(stat -f '%u' "$work")" = "$(id -u)" ]; }; then
  usage_error
fi

is_allowed() { # path -> 0 when strictly inside one of the allowed roots, with no . or .. segments
  case $1 in /*) ;; *) return 1 ;; esac
  case $1 in */../* | */./* | */.. | */.) return 1 ;; esac
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    case $1 in "$root"/?*) return 0 ;; esac
  done <"$work/roots"
  return 1
}

close_session() {
  sleep "$delay"
  kill -TERM "$pid" 2>/dev/null
  polls=0
  limit=$((failsafe * POLLS_PER_SECOND))
  while kill -0 "$pid" 2>/dev/null; do
    sleep "$POLL"
    polls=$((polls + 1))
    [ "$polls" -eq "$limit" ] && kill -KILL "$pid" 2>/dev/null
  done
}

stop_leftovers() { # "<pid> <command>" lines; a pid is killed only while it still runs that same command
  [ -s "$work/pids" ] || return 0
  while IFS=' ' read -r p cmd; do
    case $p in '' | *[!0-9]*) continue ;; esac
    now=$(ps -o command= -p "$p" 2>/dev/null | sed 's/[[:space:]]*$//')
    [ -n "$now" ] && [ "$now" = "$cmd" ] && kill -KILL "$p" 2>/dev/null
  done <"$work/pids"
  return 0
}

sweep() {
  [ -f "$work/paths" ] || return 0
  while IFS= read -r path; do
    { [ -e "$path" ] || [ -L "$path" ]; } || continue
    is_allowed "$path" && rm -rf -- "$path" 2>/dev/null
  done <"$work/paths"
}

remove_keyed_in() { # folder -> removes <sid>, <sid>.*, <sid>-*, <sid>_* inside it; 0 when it removed one
  removed=1
  for entry in "$1/$sid" "$1/$sid".* "$1/$sid"-* "$1/$sid"_*; do
    { [ -e "$entry" ] || [ -L "$entry" ]; } || continue
    is_allowed "$entry" && rm -rf -- "$entry" 2>/dev/null && removed=0
  done
  return "$removed"
}

sweep_keyed() {
  [ -f "$work/keyed" ] || return 0
  while IFS=' ' read -r nested folder; do
    [ -d "$folder" ] || continue
    if [ "$nested" = 1 ]; then
      for sub in "$folder"/*/; do
        [ -d "$sub" ] && [ ! -L "${sub%/}" ] || continue
        # A folder this session's entries alone filled (a first session in a project) goes too; rmdir keeps any other.
        remove_keyed_in "${sub%/}" && is_allowed "${sub%/}" && rmdir -- "${sub%/}" 2>/dev/null
      done
    else
      remove_keyed_in "$folder"
    fi
  done <"$work/keyed"
}

purge_history() {
  [ "$history" = "$ARG_NONE" ] && return 0
  /bin/sh "$here/purge-history.sh" "$history" "$sid" >/dev/null 2>&1
}

print_fallback() {
  [ -f "$work/printed" ] && return 0
  if [ "$tty" != "$ARG_NONE" ] && [ -c "$tty" ] && [ -w "$tty" ]; then
    cat "$work/fallback-report.txt" >"$tty" 2>/dev/null
  fi
}

close_session
stop_leftovers
sweep
sweep_keyed
purge_history
print_fallback
rm -rf -- "$work"
exit 0
