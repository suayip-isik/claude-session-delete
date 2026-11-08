#!/bin/sh
# Runs every tests/scripts/*.test.sh; exits non-zero if any of them fails.

set -u
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
status=0

for test in "$here"/*.test.sh; do
  printf '\n# %s\n' "${test##*/}"
  sh "$test" || status=1
done

exit "$status"
