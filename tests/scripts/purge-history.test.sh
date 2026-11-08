#!/bin/sh
# bin/purge-history.sh: removes one session's rows from the shared history, atomically.

# shellcheck source=harness.sh
. "$(dirname -- "$0")/harness.sh"

readonly PURGE="$REPO_ROOT/bin/purge-history.sh"

row() { # session-id text
  printf '{"display":"%s","sessionId":"%s"}\n' "$2" "$1"
}

box=$(new_sandbox)
history="$box/history.jsonl"
{
  row "$OTHER_SESSION_ID" first
  row "$SESSION_ID" mine
  row "$OTHER_SESSION_ID" second
  row "$SESSION_ID" also-mine
} >"$history"
chmod 644 "$history"
expected_rest=$(row "$OTHER_SESSION_ID" first; row "$OTHER_SESSION_ID" second)
removed_bytes=$(($(row "$SESSION_ID" mine | wc -c) + $(row "$SESSION_ID" also-mine | wc -c)))

output=$(sh "$PURGE" "$history" "$SESSION_ID")
check 'reports the rows and bytes it removed' [ "$output" = "2 $removed_bytes" ]
check 'keeps every other session row, in order' file_equals "$history" "$expected_rest"
check 'keeps the file mode' [ "$(stat -f '%Lp' "$history")" = 644 ]
check 'leaves no temporary file behind' [ "$(find "$box" -type f | wc -l | tr -d ' ')" = 1 ]

inode=$(stat -f '%i' "$history")
check 'reports nothing when the session has no rows' [ "$(sh "$PURGE" "$history" "$SESSION_ID")" = '0 0' ]
check 'does not rewrite the file then' [ "$(stat -f '%i' "$history")" = "$inode" ]

check 'reports nothing when there is no history file' [ "$(sh "$PURGE" "$box/missing.jsonl" "$SESSION_ID")" = '0 0' ]

sh "$PURGE" "$history" 'not-a-session-id' >/dev/null
check 'refuses a malformed session id (exit 64)' [ $? -eq 64 ]
sh "$PURGE" "$history" >/dev/null
check 'refuses a missing argument (exit 64)' [ $? -eq 64 ]
check 'touches nothing when refusing' file_equals "$history" "$expected_rest"

finish
