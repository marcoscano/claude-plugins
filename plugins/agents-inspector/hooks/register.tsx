import { atom, read, update } from 'claude-code'
import type { ModelUsage, Register } from 'claude-code'

import type { AgentRun, RunStatus } from '../types'

const PANE = 'agents-inspector'
const TITLE = 'Agents'
/** Runs kept for the session; the oldest leave first. */
const MAX_RUNS = 100

// `plugin` and `key` stay literals: `claude plugin validate` reads them off the source.
const runs = atom({ plugin: 'agents-inspector', key: 'runs' } as const, [])
const now = atom({ plugin: 'agents-inspector', key: 'now' } as const, 0)
const isDoneCollapsed = atom({ plugin: 'agents-inspector', key: 'isDoneCollapsed' } as const, false)
const hasAutoOpened = atom({ plugin: 'agents-inspector', key: 'hasAutoOpened' } as const, false)

const GLYPH: Record<RunStatus, string> = { running: '●', done: '✓', failed: '✗' }
const COLOR: Record<RunStatus, string> = { running: 'claude', done: 'success', failed: 'error' }

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtTime = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** `claude-opus-5-5` reads `opus-5-5`; a bracketed suffix such as `[1m]` is dropped. */
const modelName = (id: string): string => id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '?'

const elapsed = (run: AgentRun, at: number): number =>
  (run.endedAt ?? Math.max(at, run.startedAt)) - run.startedAt

const totalTokens = (run: AgentRun): number =>
  run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens

/** The share of the prompts served from the cache over the whole run; null before any request. */
const cachedShare = (run: AgentRun): number | null => {
  const prompt = run.inputTokens + run.cacheReadTokens + run.cacheWriteTokens
  return prompt > 0 ? Math.round((run.cacheReadTokens / prompt) * 100) : null
}

/** Adds one request's usage to the run; the context is that request's own size. */
const withUsage = (run: AgentRun, usage: ModelUsage): AgentRun => {
  const input = usage.input_tokens || 0
  const output = usage.output_tokens || 0
  const cache_read = usage.cache_read_input_tokens || 0
  const cache_write = usage.cache_creation_input_tokens || 0

  return {
    ...run,
    steps: run.steps + 1,
    contextTokens: input + cache_read + cache_write + output,
    inputTokens: run.inputTokens + input,
    outputTokens: run.outputTokens + output,
    cacheReadTokens: run.cacheReadTokens + cache_read,
    cacheWriteTokens: run.cacheWriteTokens + cache_write,
  }
}

/** The second line of a row: type, model, effort, and why a failed run ended. */
const metaOf = (run: AgentRun): string => {
  const parts = [run.type, modelName(run.model)]
  if (run.effort) parts.push(run.effort)
  if (run.reason) parts.push(run.reason)

  return parts.join(' · ')
}

/** The third line of a row: context, tokens, cache share, steps and time. */
const statsOf = (run: AgentRun, at: number): string => {
  const share = cachedShare(run)

  return [
    `ctx ${fmtTokens(run.contextTokens)}`,
    `${fmtTokens(totalTokens(run))} tokens${share === null ? '' : ` (${share}% cached)`}`,
    `${run.steps} ${run.steps === 1 ? 'step' : 'steps'}`,
    fmtTime(elapsed(run, at)),
  ].join(' · ')
}

export const register: Register = (on, options) => {
  // The manifest's `autoOpen` option: open the pane once, when the first subagent starts.
  const auto_open = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agents-inspector',
      description: "Show or hide the pane of this session's subagents",
      argumentHint: '[open|close]',
    })
    // Ticks the elapsed times once a second; quiet while nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, runs)
        if (!list.some(run => run.status === 'running')) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })

    return next(e)
  })

  // `open` and `close` set the pane; anything else toggles it.
  on('command.run', { command: 'agents-inspector' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const is_open = (await $.ui.panes()).some(pane => pane.id === PANE)
    const wanted = word === 'open' ? true : word === 'close' ? false : !is_open
    if (!wanted) {
      await $.ui.close({ id: PANE })

      return { text: 'Agents pane closed.' }
    }
    const at = await $.clock.now()
    await update($, now, () => at)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agents pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    const run: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: at,
      steps: 0,
      contextTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    await update($, runs, list => [...list.filter(one => one.id !== run.id), run].slice(-MAX_RUNS))
    await update($, now, () => at)

    if (auto_open && !(await read($, hasAutoOpened))) {
      await update($, hasAutoOpened, () => true)
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return started
  })

  // Each model request of a subagent: its live context, tokens, model and effort.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agent_id = e.agentId
    const usage = result.usage
    if (!agent_id || !usage) return result

    const effort = typeof e.effort === 'number' ? String(e.effort) : e.effort
    await update($, runs, list =>
      list.map(run => {
        if (run.id !== agent_id) return run
        const live: AgentRun = {
          ...withUsage(run, usage),
          model: usage.model || e.model,
          effort: effort ?? run.effort,
          status: 'running',
          endedAt: undefined,
        }

        return live
      }),
    )

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agent_id = e.agentId
    if (!agent_id) return result

    const at = await $.clock.now()
    const usage = result.usage
    await update($, runs, list =>
      list.map(run => {
        if (run.id !== agent_id) return run
        const ended: AgentRun = {
          ...run,
          status: e.reason === 'answer' ? 'done' : 'failed',
          reason: e.reason === 'answer' ? undefined : e.reason,
          endedAt: at,
        }

        // A run whose steps went unseen still gets the turn's own sum.
        return run.steps === 0 && usage ? withUsage(ended, usage) : ended
      }),
    )
    await update($, now, () => at)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, runs)
    const collapsed = await read($, isDoneCollapsed)
    const at = Math.max(await read($, now), ...list.map(run => run.startedAt), 0)

    const running = list.filter(run => run.status === 'running').reverse()
    const finished = list.filter(run => run.status !== 'running').reverse()
    const tokens = list.reduce((sum, run) => sum + totalTokens(run), 0)
    const summary = `${running.length} running · ${finished.length} finished · ${fmtTokens(tokens)} tokens`

    const row = (run: AgentRun) => (
      <Box key={run.id} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={COLOR[run.status]}>{GLYPH[run.status]}</Text>
          <Text bold wrap="truncate-end">
            {run.description || run.type}
          </Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {'  '}
          {metaOf(run)}
        </Text>
        <Text dimColor wrap="truncate-end">
          {'  '}
          {statsOf(run, at)}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text dimColor>{summary}</Text>
        {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
        {running.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Running · {running.length}</Text>
            {running.map(row)}
          </Box>
        )}
        {finished.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Button
              key="finished"
              plain
              dimColor
              label={`${collapsed ? '▸' : '▾'} Finished · ${finished.length}`}
              onPress={() => update($, isDoneCollapsed, value => !value)}
            />
            {!collapsed && finished.map(row)}
          </Box>
        )}
      </Box>
    )
  })
}
