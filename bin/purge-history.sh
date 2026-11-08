#!/bin/sh
# Removes one session's rows from Claude Code's shared prompt history, atomically.
#
# Usage: purge-history.sh <history-file> <session-id>
# Prints "<rows-removed> <bytes-removed>". Another session may append at any
# time: the file is replaced only if it did not change while it was filtered,
# otherwise the filter runs again (a few times at most).

set -u
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/common.sh
. "$here/lib/common.sh"

readonly RETRIES=5
readonly RETRY_PAUSE=0.05

[ "$#" -eq 2 ] || usage_error
history=$1 sid=$2
is_session_id "$sid" || usage_error

marker="\"sessionId\":\"$sid\""
attempt=0
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$((attempt + 1))
  if [ ! -f "$history" ] || ! grep -qF -- "$marker" "$history"; then
    echo "0 0"
    exit 0
  fi
  before=$(stat -f '%m %z %i' "$history") || break
  rows=$(grep -cF -- "$marker" "$history")
  old_size=$(stat -f '%z' "$history")
  tmp=$(mktemp "$history.session-delete.XXXXXX") || break
  grep -vF -- "$marker" "$history" >"$tmp"
  chmod "$(stat -f '%Lp' "$history")" "$tmp"
  if [ "$(stat -f '%m %z %i' "$history")" = "$before" ]; then
    mv -f "$tmp" "$history"
    echo "$rows $((old_size - $(stat -f '%z' "$history")))"
    exit 0
  fi
  rm -f "$tmp"
  sleep "$RETRY_PAUSE"
done
echo "0 0"
exit 1
