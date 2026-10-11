export type RunStatus = 'running' | 'done' | 'failed'

/** One subagent of the session, from its spawn to the end of its turn. */
export type AgentRun = {
  /** The agent's id (`agent.spawn`'s `agentId`), or the Agent call's id when none was given. */
  id: string
  /** The agent type it was spawned as: `Explore`, `general-purpose`, a plugin's agent. */
  type: string
  /** The Agent tool's short description of the task. */
  description: string
  /** The model's id as the API reports it, refreshed on every request. */
  model: string
  /** The effort of the last request, when the model has one. */
  effort?: string
  status: RunStatus
  /** Why the turn ended when it did not answer: `aborted`, `error` or `refusal`. */
  reason?: string
  startedAt: number
  endedAt?: number
  /** Model requests seen (`turn.step`s). */
  steps: number
  /** The size of the last request: every input kind plus the output. */
  contextTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'agents-inspector': {
      /** Every run of the session, oldest first, capped. */
      runs: AgentRun[]
      /** The clock elapsed times are drawn against, ticked once a second while a run is live. */
      now: number
      /** Whether the pane folds its finished runs. */
      isDoneCollapsed: boolean
      /** Whether the pane has opened itself once this session. */
      hasAutoOpened: boolean
    }
  }
}
