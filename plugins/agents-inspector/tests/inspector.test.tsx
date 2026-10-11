import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const PLUGIN = 'agents-inspector'
const SURFACES = ['terminal', 'desktop'] as const
const PANE: RenderPropsOf['Pane'] = {
  title: 'Agents',
  isFocused: false,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}
const MOUNT = { plugin: PLUGIN, component: 'Pane', props: PANE, requestId: PLUGIN } as const
const RUN = {
  command: PLUGIN,
  args: '',
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 },
}
const SPAWN = {
  tool_use_id: 'call-1',
  prompt: 'Find every caller of hook_entity_presave.',
  description: 'Find presave callers',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const
// 1200 + 300 + 8000 + 500 = 10k context; 8000 of 9700 prompt tokens read from the cache: 82%.
const USAGE = {
  model: 'claude-haiku-5-5',
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 8000,
  cache_creation_input_tokens: 500,
}
const STEP = { turnId: 'turn-1', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 2, agentId: 'agent-1' } as const
const STEP_RESULT = { turnId: 'turn-1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as const
const COMPLETE = {
  turnId: 'turn-1',
  agentId: 'agent-1',
  reason: 'answer',
  answer: 'Found 3 callers.',
  durationMs: 4000,
  isAborted: false,
  usage: USAGE,
} as const
const FINISHED = { key: 'finished' }

const text = (pattern: RegExp) => ({ type: 'Text', text: pattern })

/** Stands for the engine beneath the plugin: spawns start, steps and turns answer, panes open. */
const engineBeneath = (on: On, opened: string[]) => {
  on('agent.spawn', () => ({ agentId: 'agent-1', model: 'claude-haiku-5-5' }))
  on('turn.step', async function* () {
    return STEP_RESULT
  })
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  // A call on `$` is an event too: its bottom answers `{ value }` (or `{ deny }`).
  on('ui.open', ($, e) => {
    if (!opened.includes(e.id)) opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    opened.splice(opened.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: opened.map(id => ({ id, title: 'Agents', isShown: true, isFocused: false, isPlaced: true })),
  }))
}

/** Drives one model request of the subagent through the plugin's `turn.step` hook. */
const step = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  const stream = $.turn.step(STEP)
  for await (const chunk of stream) void chunk
  return stream.result
}

test('tracks a subagent from spawn to answer and draws it on both surfaces', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const opened: string[] = []
  engineBeneath(on, opened)

  for (const surface of SURFACES) {
    const empty = await $.ui.mount({ ...MOUNT, surface })
    expect(await empty.find(text(/No subagents yet/)), `${surface}: an empty pane says so`).toBeDefined()
    await empty.unmount()
  }

  const started = await $.agent.spawn(SPAWN)
  expect(started.agentId).toBe('agent-1')
  expect(opened, 'the pane opens itself once a subagent starts').toEqual([PLUGIN])

  for (const surface of SURFACES) {
    const live = await $.ui.mount({ ...MOUNT, surface })
    expect(await live.find(text(/1 running · 0 finished/)), `${surface}: the summary counts it`).toBeDefined()
    expect(await live.find(text(/Find presave callers/)), `${surface}: the run is listed by its description`).toBeDefined()
    expect(await live.find(text(/Explore · haiku-5-5/)), `${surface}: type and model`).toBeDefined()
    expect(await live.find(text(/0 steps/)), `${surface}: no request yet`).toBeDefined()
    await live.unmount()
  }

  await step($)

  const stepped = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  expect(await stepped.find(text(/ctx 10k · 10k tokens \(82% cached\) · 1 step ·/)), 'one request: context, tokens, cache share').toBeDefined()
  expect(await stepped.find(text(/Explore · haiku-5-5 · low/)), 'the effort of the request').toBeDefined()
  await stepped.unmount()

  await $.turn.complete(COMPLETE)

  for (const surface of SURFACES) {
    const done = await $.ui.mount({ ...MOUNT, surface })
    expect(await done.find(text(/0 running · 1 finished/)), `${surface}: moved to finished`).toBeDefined()
    expect((await done.find(FINISHED))?.text, `${surface}: the fold control counts the finished runs`).toContain('Finished · 1')
    expect(await done.find(text(/Find presave callers/)), `${surface}: still listed`).toBeDefined()
    expect(await done.find(text(/1 step ·/)), `${surface}: the turn's usage is not counted twice`).toBeDefined()

    await done.press({ plugin: PLUGIN, key: 'finished' })
    expect(await done.find(text(/Find presave callers/)), `${surface}: folded away`).toBeUndefined()
    await done.press({ plugin: PLUGIN, key: 'finished' })
    expect(await done.find(text(/Find presave callers/)), `${surface}: unfolded again`).toBeDefined()
    await done.unmount()
  }

  expect(opened, 'the pane opened itself once only').toEqual([PLUGIN])
})

test('a turn that did not answer is marked failed with its reason', async ($, on) => {
  mock.clock(on)
  engineBeneath(on, [])

  await $.agent.spawn(SPAWN)
  await $.turn.complete({ ...COMPLETE, reason: 'error', answer: '' })

  const pane = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  expect(await pane.find(text(/✗/)), 'the failed glyph').toBeDefined()
  expect(await pane.find(text(/Explore · haiku-5-5 · error/)), 'the reason on the meta line').toBeDefined()
  expect(await pane.find(text(/1 step ·/)), 'a run with no step seen takes the turn\'s usage').toBeDefined()
  await pane.unmount()
})

test('the command toggles the pane, and open and close set it', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  engineBeneath(on, opened)

  expect((await $.command.run(RUN)).text).toContain('opened')
  expect(opened).toEqual([PLUGIN])
  expect((await $.command.run(RUN)).text).toContain('closed')
  expect(opened).toEqual([])
  expect((await $.command.run({ ...RUN, args: 'open' })).text).toContain('opened')
  expect((await $.command.run({ ...RUN, args: 'open' })).text, 'open on an open pane keeps it').toContain('opened')
  expect(opened).toEqual([PLUGIN])
  expect((await $.command.run({ ...RUN, args: 'close' })).text).toContain('closed')
  expect(opened).toEqual([])
})

test('keeps the pane closed when autoOpen is off', { options: { autoOpen: false } }, async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  engineBeneath(on, opened)

  await $.agent.spawn(SPAWN)
  expect(opened, 'nothing opened on the spawn').toEqual([])

  const pane = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  expect(await pane.find(text(/Find presave callers/)), 'the run is tracked all the same').toBeDefined()
  await pane.unmount()
})
