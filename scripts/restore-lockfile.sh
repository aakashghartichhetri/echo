#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# The standalone source archive contains reviewed code. Restore the exact
# audited lockfile from the immutable GitHub baseline; never re-resolve versions.
commit='8952d2a46a1e5a88f6392879fff2ef40d933bf69'
expected='bc53374b728bf380a8a6fa88c015588ae789b3cf'
if [ -f package-lock.json ]; then
  echo 'package-lock.json is already present; leaving it unchanged.'
  exit 0
fi

command -v git >/dev/null || { echo 'git is required to verify the lockfile.' >&2; exit 1; }
tmp="$(mktemp ./package-lock.json.XXXXXXXX)"
trap 'rm -f "$tmp"' EXIT

if git cat-file -e "$commit:package-lock.json" 2>/dev/null; then
  git show "$commit:package-lock.json" > "$tmp"
else
  command -v curl >/dev/null || { echo 'curl is needed when Git history is not available.' >&2; exit 1; }
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 90 \
    "https://raw.githubusercontent.com/aakashghartichhetri/echo/$commit/package-lock.json" -o "$tmp"
fi

actual="$(git hash-object "$tmp")"
if [ "$actual" != "$expected" ]; then
  echo "Lockfile verification failed (expected $expected, received $actual)." >&2
  exit 1
fi
mv "$tmp" package-lock.json
trap - EXIT
echo 'Restored and verified audited package-lock.json.'
