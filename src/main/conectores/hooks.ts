/** Los avisos de Claude Code que interesan, y el bloque para pegar en ~/.claude/settings.json. */
export const HOOKS_CLAUDE_CODE = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd'] as const

export function configHooksClaudeCode(script: string): string {
  const orden = { type: 'command', command: `node "${script}" --claude-code`, timeout: 5 }
  const hooks = Object.fromEntries(
    HOOKS_CLAUDE_CODE.map((h) => [h, [h === 'PreToolUse' ? { matcher: '*', hooks: [orden] } : { hooks: [orden] }]])
  )
  return JSON.stringify({ hooks }, null, 2)
}
