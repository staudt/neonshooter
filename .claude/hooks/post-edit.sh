#!/usr/bin/env bash
# PostToolUse(Edit|Write): format the file, and mark the tree dirty when game files change
# so the Stop hook knows a verify pass is needed.
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -z "$f" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
case "$f" in
  *.ts|*.js|*.mjs|*.json|*.css|*.html|*.md) npx --no-install prettier --write --log-level silent "$f" 2>/dev/null ;;
esac
case "$f" in
  */src/*|*/tests/*|*/maps/*|*/trenchbroom/*|*/scripts/*|*/index.html|*/package.json|*/vite.config.ts|*/tsconfig.json)
    touch .claude/.dirty ;;
esac
exit 0
