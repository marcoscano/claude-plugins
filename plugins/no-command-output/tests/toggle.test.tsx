import { expect, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

const PLUGIN = 'no-command-output'
const RUN = {
  command: PLUGIN,
  args: '',
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 },
}
const SURFACES = ['terminal', 'desktop'] as const
const OUTPUT = { stdout: 'one\ntwo\nthree\n', stderr: '', interrupted: false }
const RESULT: RenderPropsOf['ToolResult'] = {
  tool_use_id: 'result-1',
  tool: 'Bash',
  output: OUTPUT,
  isErrored: false,
}
const BASH_ROW: RenderPropsOf['ToolUse'] = {
  tool_use_id: 'call-1',
  tool: 'Bash',
  input: { command: 'ls -la' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: OUTPUT,
}
const READ_ROW: RenderPropsOf['ToolUse'] = {
  tool_use_id: 'call-2',
  tool: 'Read',
  input: { file_path: '/srv/app/web/modules/custom/common/common.module' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {
    type: 'text',
    file: { filePath: '/srv/app/web/modules/custom/common/common.module', content: 'a\nb\n', numLines: 45, startLine: 1, totalLines: 45 },
  },
}
const ENGINE = { type: 'Text', text: 'engine drew it' }
const SHOW = { key: 'show' }
const HIDE = { key: 'hide' }

/** Stands for the engine's own renderer beneath the plugin, at either site. */
const engineDraws = (on: Parameters<Parameters<typeof test>[1]>[1], component: 'ToolUse' | 'ToolResult') =>
  on('ui.render', { component }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine drew it</Text>
  })

test('hides a standalone result from the start and shows it once turned off', async ($, on) => {
  engineDraws(on, 'ToolResult')

  for (const surface of SURFACES) {
    await $.command.run({ ...RUN, args: 'on' })

    const hidden = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolResult', props: RESULT })
    expect(await hidden.find(ENGINE), `${surface}: hidden by default`).toBeUndefined()
    expect((await hidden.find(SHOW))?.text, `${surface}: the placeholder is a control`).toContain('3 lines')
    await hidden.unmount()

    const errored = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'ToolResult',
      props: { ...RESULT, isErrored: true },
    })
    expect(await errored.find(ENGINE), `${surface}: errors stay visible`).toBeDefined()
    await errored.unmount()

    const turnedOff = await $.command.run({ ...RUN, args: 'off' })
    expect(turnedOff.text).toContain('shown')

    const shown = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolResult', props: RESULT })
    expect(await shown.find(ENGINE), `${surface}: shown once off`).toBeDefined()
    await shown.unmount()

    const turnedOn = await $.command.run(RUN)
    expect(turnedOn.text).toContain('hidden')
  }
})

test('starts with output shown when hiddenByDefault is off', { options: { hiddenByDefault: false } }, async ($, on) => {
  engineDraws(on, 'ToolResult')

  for (const surface of SURFACES) {
    const shown = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolResult', props: RESULT })
    expect(await shown.find(ENGINE), `${surface}: shown by default`).toBeDefined()
    await shown.unmount()
  }

  // The toggle with no argument flips from the option's default.
  const turnedOn = await $.command.run(RUN)
  expect(turnedOn.text).toContain('hidden')
  const hidden = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolResult', props: RESULT })
  expect(await hidden.find(ENGINE)).toBeUndefined()
  await hidden.unmount()
})

test('draws a pressable placeholder in a tool row and expands it in place', async ($, on) => {
  engineDraws(on, 'ToolUse')

  for (const [surface, row] of [['terminal', BASH_ROW], ['desktop', READ_ROW]] as const) {
    await $.command.run({ ...RUN, args: 'on' })

    const mounted = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row })
    expect(await mounted.find(ENGINE), `${surface}: the engine's row is not drawn while folded`).toBeUndefined()
    expect(await mounted.find({ type: 'Text', text: new RegExp(row.tool) }), `${surface}: the header names the tool`).toBeDefined()
    const show = await mounted.find(SHOW)
    expect(show?.text, `${surface}: the placeholder sizes the output`).toContain(row.tool === 'Bash' ? '3 lines' : '45 lines')

    // A press on the placeholder nests the engine's own row under a fold control.
    await mounted.press({ plugin: PLUGIN, key: 'show' })
    expect(await mounted.find(ENGINE), `${surface}: expanded rows draw the engine's row`).toBeDefined()
    expect(await mounted.find(SHOW), `${surface}: the placeholder is gone once expanded`).toBeUndefined()
    expect(await mounted.find(HIDE), `${surface}: expanded rows carry a fold control`).toBeDefined()

    await mounted.press({ plugin: PLUGIN, key: 'hide' })
    expect(await mounted.find(ENGINE), `${surface}: folded again`).toBeUndefined()
    expect(await mounted.find(SHOW), `${surface}: the placeholder is back`).toBeDefined()
    await mounted.unmount()

    const errored = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: { ...row, isErrored: true } })
    expect(await errored.find(ENGINE), `${surface}: errors stay visible`).toBeDefined()
    await errored.unmount()

    const running = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'ToolUse',
      props: { ...row, isRunning: true, output: undefined },
    })
    expect(await running.find(ENGINE), `${surface}: a running row is untouched`).toBeDefined()
    await running.unmount()

    await $.command.run({ ...RUN, args: 'off' })

    const shown = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row })
    expect(await shown.find(ENGINE), `${surface}: the engine's row once off`).toBeDefined()
    await shown.unmount()
  }
})

test('leaves the result block empty when the row already drew the placeholder', async ($, on) => {
  engineDraws(on, 'ToolUse')
  engineDraws(on, 'ToolResult')
  await $.command.run({ ...RUN, args: 'on' })

  const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props: BASH_ROW })
  const block = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: { ...RESULT, tool_use_id: BASH_ROW.tool_use_id },
  })
  expect(await block.find(SHOW), 'no second placeholder under the row').toBeUndefined()
  expect(await block.find(ENGINE), 'nothing drawn while folded').toBeUndefined()

  // Expanding the row brings the engine's result block back.
  await row.press({ plugin: PLUGIN, key: 'show' })
  expect(await block.find(ENGINE), 'the engine draws the result once expanded').toBeDefined()

  await block.unmount()
  await row.unmount()
})
