export type Visibility = { isHidden: boolean }

declare module 'claude-code' {
  interface PluginState {
    'no-command-output': {
      /** The session's mode, once `/no-command-output` has set it. */
      isHidden: boolean
      /** Per tool call (by `tool_use_id`): true while the person has expanded its output. */
      isShown: StateFamily<boolean>
    }
  }
}
