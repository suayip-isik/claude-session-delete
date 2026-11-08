# shellcheck shell=sh
# Shared by the session-delete scripts: sourced, never run.
#
# A fixed PATH, so no directory of the user's can shadow a system tool, and
# private modes for every file the scripts create.

PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 077

# sysexits.h: the command was called with bad arguments.
readonly EX_USAGE=64

usage_error() {
  exit "$EX_USAGE"
}

# A Claude Code session id: a lowercase UUID.
is_session_id() {
  printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
}

# A whole number of zero or more.
is_uint() {
  case $1 in '' | *[!0-9]*) return 1 ;; esac
}

# A plain decimal (`0.2`, `8`).
is_decimal() {
  case $1 in '' | *[!0-9.]* | *.*.*) return 1 ;; esac
}
