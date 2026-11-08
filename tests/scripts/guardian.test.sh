#!/bin/sh
# bin/guardian.sh: closes the session, then sweeps what the exit left behind.

# shellcheck source=harness.sh
. "$(dirname -- "$0")/harness.sh"

readonly GUARDIAN="$REPO_ROOT/bin/guardian.sh"
readonly NO_TTY=-
readonly NO_HISTORY=-
readonly NO_DELAY=0
readonly FAILSAFE_SECONDS=2

# A work folder as the mod writes it: one file per list.
write_job() { # work-dir allowed-root
  for list in paths keyed pids; do : >"$1/$list"; done
  printf '%s\n' "$2" >"$1/roots"
  printf 'summary\n' >"$1/fallback-report.txt"
}

run_guardian() { # claude-pid history work-dir
  sh "$GUARDIAN" "$1" "$SESSION_ID" "$2" "$3" "$NO_TTY" "$NO_DELAY" "$FAILSAFE_SECONDS"
}

# --- a full run ---------------------------------------------------------------

box=$(new_sandbox)
root="$box/claude" outside="$box/outside" work="$box/work"
mkdir -p "$root/projects/app/$SESSION_ID" "$root/projects/solo" "$root/projects/other" "$root/flat" "$outside" "$work"
printf 'x' >"$root/listed.txt"
printf 'x' >"$outside/keep.txt"
printf 'x' >"$root/projects/app/$SESSION_ID.jsonl"
printf 'x' >"$root/projects/app/$SESSION_ID/tool-result.txt"
printf 'x' >"$root/projects/app/$OTHER_SESSION_ID.jsonl"
printf 'x' >"$root/projects/solo/$SESSION_ID.jsonl"
printf 'x' >"$root/flat/$SESSION_ID-agent-1.json"
printf 'x' >"$root/flat/${SESSION_ID}x"
printf '{"sessionId":"%s"}\n{"sessionId":"%s"}\n' "$SESSION_ID" "$OTHER_SESSION_ID" >"$box/history.jsonl"

write_job "$work" "$root"
printf '%s\n' "$root/listed.txt" "$outside/keep.txt" "relative/path" "$root/../outside/keep.txt" >"$work/paths"
printf '1 %s\n0 %s\n' "$root/projects" "$root/flat" >"$work/keyed"

claude=$(spawn_orphan sleep 30)
leftover=$(spawn_orphan sleep 31)
reused=$(spawn_orphan sleep 32)
printf '%s sleep 31\n%s a-different-command\n' "$leftover" "$reused" >"$work/pids"

run_guardian "$claude" "$box/history.jsonl" "$work"

check 'closes the Claude process' is_gone "$claude"
check 'kills a listed process still running its command' is_gone "$leftover"
check 'spares a pid now running another command' is_running "$reused"
check 'removes a listed path inside the allowed root' is_missing "$root/listed.txt"
check 'keeps a listed path outside the allowed root' exists "$outside/keep.txt"
check "removes the session's transcript in every project" is_missing "$root/projects/app/$SESSION_ID.jsonl"
check "removes the session's transcript folder" is_missing "$root/projects/app/$SESSION_ID"
check "keeps another session's transcript" exists "$root/projects/app/$OTHER_SESSION_ID.jsonl"
check 'removes a project folder only this session filled' is_missing "$root/projects/solo"
check 'keeps a project folder that was already empty' exists "$root/projects/other"
check 'removes entries named <id>-… in a flat folder' is_missing "$root/flat/$SESSION_ID-agent-1.json"
check 'keeps an entry whose name only starts with the id' exists "$root/flat/${SESSION_ID}x"
check "removes the session's history rows" file_equals "$box/history.jsonl" "{\"sessionId\":\"$OTHER_SESSION_ID\"}"
check 'removes its work folder' is_missing "$work"
kill "$reused" 2>/dev/null

# --- prompt history kept ------------------------------------------------------

box=$(new_sandbox)
mkdir -p "$box/work"
write_job "$box/work" "$box"
printf '{"sessionId":"%s"}\n' "$SESSION_ID" >"$box/history.jsonl"
kept_history=$(cat "$box/history.jsonl")
claude=$(spawn_orphan sleep 30)
sh "$GUARDIAN" "$claude" "$SESSION_ID" "$NO_HISTORY" "$box/work" "$NO_TTY" "$NO_DELAY" "$FAILSAFE_SECONDS"
check "leaves the prompt history alone when it is kept (-)" file_equals "$box/history.jsonl" "$kept_history"
check 'still closes the session when the history is kept' is_gone "$claude"

# --- a session that ignores SIGTERM -------------------------------------------

box=$(new_sandbox)
mkdir -p "$box/work"
write_job "$box/work" "$box"
# shellcheck disable=SC2016 # perl code, not a shell expansion
stubborn=$(spawn_orphan perl -e '$SIG{TERM} = "IGNORE"; sleep 30')
run_guardian "$stubborn" "$box/history.jsonl" "$box/work"
check 'kills a session that ignores SIGTERM after the failsafe' is_gone "$stubborn"

# --- refused calls ------------------------------------------------------------

box=$(new_sandbox)
mkdir -p "$box/work"
write_job "$box/work" "$box"
sh "$GUARDIAN" 1 not-a-session-id "$box/history.jsonl" "$box/work" "$NO_TTY" "$NO_DELAY" "$FAILSAFE_SECONDS"
check 'refuses a malformed session id (exit 64)' [ $? -eq 64 ]
sh "$GUARDIAN" not-a-pid "$SESSION_ID" "$box/history.jsonl" "$box/work" "$NO_TTY" "$NO_DELAY" "$FAILSAFE_SECONDS"
check 'refuses a malformed pid (exit 64)' [ $? -eq 64 ]
sh "$GUARDIAN" 1 "$SESSION_ID" "$box/history.jsonl" "$box/missing" "$NO_TTY" "$NO_DELAY" "$FAILSAFE_SECONDS"
check 'refuses a missing work folder (exit 64)' [ $? -eq 64 ]
check 'leaves the work folder of a refused call alone' exists "$box/work/paths"

finish
