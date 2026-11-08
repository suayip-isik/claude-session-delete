# shellcheck shell=sh disable=SC2034 # the constants are read by the *.test.sh that source this file
# A minimal test harness for the POSIX scripts in bin/: sourced by each
# *.test.sh, which calls `check` per assertion and ends with `finish`.

set -u

REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
readonly REPO_ROOT
readonly SESSION_ID=11111111-2222-4333-8444-555555555555
readonly OTHER_SESSION_ID=99999999-2222-4333-8444-555555555555

failures=0
sandboxes=''

# check <description> <command…>: passes when the command succeeds.
check() {
  description=$1
  shift
  if "$@"; then
    printf 'ok   %s\n' "$description"
  else
    printf 'FAIL %s\n' "$description"
    failures=$((failures + 1))
  fi
}

# A private temporary folder, removed by `finish`.
new_sandbox() {
  dir=$(mktemp -d "${TMPDIR:-/tmp}/session-delete-test.XXXXXX")
  sandboxes="$sandboxes $dir"
  printf '%s\n' "$dir"
}

# Starts a command whose parent exits at once, so the system reaps it when it
# ends (as a login shell reaps Claude), and prints its pid.
spawn_orphan() {
  sh -c '"$@" >/dev/null 2>&1 </dev/null & echo $!' sh "$@"
}

is_running() {
  kill -0 "$1" 2>/dev/null
}

is_gone() {
  ! is_running "$1"
}

exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

is_missing() {
  ! exists "$1"
}

file_equals() { # file expected-text
  [ "$(cat "$1")" = "$2" ]
}

finish() {
  for dir in $sandboxes; do
    rm -rf -- "$dir"
  done
  [ "$failures" -eq 0 ]
}
