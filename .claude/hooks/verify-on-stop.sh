#!/usr/bin/env bash
# Stop / SubagentStop: if game files changed since the last green run, run `npm run verify`
# (typecheck + unit/sim tests + headless smoke). On failure, exit 2 so the errors go back
# to Claude and it keeps fixing instead of delivering. Capped at 3 blocked attempts.
input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# SubagentStop: only gate agents that write code; read-only helpers must not be blocked.
agent=$(jq -r '.agent_type // empty' <<<"$input")
if [ -n "$agent" ] && [ "$agent" != "implementer" ]; then exit 0; fi

[ -f .claude/.dirty ] || exit 0

MAX=3
counter=.claude/.verify-attempts
out=$(npm run -s verify 2>&1)
if [ $? -eq 0 ]; then
  rm -f .claude/.dirty "$counter"
  exit 0
fi

n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$counter"
if [ "$n" -gt "$MAX" ]; then
  rm -f "$counter"
  jq -n --arg m "verify still failing after $MAX fix attempts — stopping; tell the user what is failing." \
    '{systemMessage: $m}'
  exit 0
fi

{
  echo "npm run verify FAILED (attempt $n/$MAX). Fix before delivering:"
  echo "$out" | grep -vE '^\s*$' | tail -60
} >&2
exit 2
