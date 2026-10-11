import type { Register, RenderPropsOf } from 'claude-code'

const COMMAND = 'no-command-output'
const STATUS = 'tool output hidden'
// $.state is reached directly ($.state.get / $.state.set), never through an
// imported helper: the module loader follows `$` only within this file.
const IS_HIDDEN = { plugin: 'no-command-output', key: 'isHidden' } as const
const IS_SHOWN = { plugin: 'no-command-output', key: 'isShown' } as const

/** The input fields a row's one-line summary prefers, in order. */
const SUMMARY_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'path',
  'pattern',
  'query',
  'url',
  'skill',
  'description',
  'prompt',
] as const
const SUMMARY_WIDTH = 100

type ToolUseProps = RenderPropsOf['ToolUse']

/** Counts the lines of a text, one trailing newline not counted as a line. */
const linesOf = (text: string): number =>
  text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Describes how much a result holds, for the placeholder line. */
const sizeOf = (output: unknown): string => {
  if (typeof output === 'string') return `${linesOf(output)} lines`
  if (!isRecord(output)) return ''
  const parts: string[] = []
  if (typeof output.stdout === 'string' && output.stdout.length > 0) {
    parts.push(`${linesOf(output.stdout)} lines`)
  }
  if (typeof output.stderr === 'string' && output.stderr.length > 0) {
    parts.push(`${linesOf(output.stderr)} lines of stderr`)
  }
  if (parts.length > 0) return parts.join(', ')
  // Read resolves `{ file: { numLines } }`; Write, WebFetch and a forked Skill
  // carry their text under one of these keys.
  if (isRecord(output.file) && typeof output.file.numLines === 'number') {
    return `${output.file.numLines} lines`
  }
  for (const key of ['content', 'result', 'text'] as const) {
    const text = output[key]
    if (typeof text === 'string' && text.length > 0) return `${linesOf(text)} lines`
  }
  // Edit and Write resolve a unified diff as `structuredPatch` hunks.
  if (Array.isArray(output.structuredPatch)) {
    let added = 0
    let removed = 0
    for (const hunk of output.structuredPatch) {
      if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue
      for (const line of hunk.lines) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added += 1
        else if (line.startsWith('-')) removed += 1
      }
    }
    if (added > 0 || removed > 0) return `+${added} -${removed}`
  }
  return ''
}

/** The one line drawn in place of a hidden result. */
const placeholder = (output: unknown): string => {
  const size = sizeOf(output)
  return `output hidden${size ? ` (${size})` : ''}`
}

/** One line naming what a call was given, as the row's header shows it. */
const summaryOf = (input: unknown): string => {
  if (typeof input === 'string') return shorten(input)
  if (!isRecord(input)) return ''
  for (const key of SUMMARY_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return shorten(value)
  }
  const first = Object.values(input).find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  return first === undefined ? '' : shorten(first)
}

const shorten = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > SUMMARY_WIDTH ? `${line.slice(0, SUMMARY_WIDTH - 1)}…` : line
}

/** `on`/`hide` and `off`/`show` set the mode; anything else toggles it. */
const wanted = (args: string, current: boolean): boolean => {
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'hide') return true
  if (word === 'off' || word === 'show') return false
  return !current
}

/** A finished, non-errored row whose result is on hand, the only kind hidden. */
const isHideable = (props: ToolUseProps): boolean =>
  !props.isRunning && !props.isErrored && !props.isInterrupted && props.output !== undefined

export const register: Register = (on, options) => {
  // The manifest's `hiddenByDefault` option stands until the session's own
  // toggle writes $.state; a reload keeps that state, a new session starts over.
  const hidden_by_default = options.hiddenByDefault !== false

  // The calls whose ToolUse row this module drew itself. A standalone row in
  // the default renderer draws its result in a separate ToolResult block, which
  // then has nothing to add; a reload empties the set and the next redraw refills it.
  const rows_drawn = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Hide or show tool output in the transcript',
      argumentHint: '[on|off]',
      immediate: true,
    })
    const { value } = await $.state.get(IS_HIDDEN)
    $.ui.status((value ?? hidden_by_default) ? STATUS : undefined)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const { value } = await $.state.get(IS_HIDDEN)
    const hidden = wanted(e.args, value ?? hidden_by_default)
    await $.state.set(IS_HIDDEN, hidden)
    $.ui.status(hidden ? STATUS : undefined)

    return {
      text: hidden
        ? 'Tool output hidden. Commands still show; run /no-command-output again to bring their output back.'
        : 'Tool output shown again.',
    }
  })

  // A tool call's row. In the fullscreen renderer, and inside an expanded group
  // (every group under `verbose`), the row draws its result inline, so this is
  // where the output is hidden: the header is drawn here with a pressable
  // placeholder, and once pressed the engine's own row (header and full output)
  // is nested under a control that folds it again.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isHideable(e.props)) return next(e)
    // Reading while drawing subscribes this row: a later set redraws it.
    const { value } = await $.state.get(IS_HIDDEN)
    if (!(value ?? hidden_by_default)) {
      rows_drawn.delete(e.props.tool_use_id)
      return next(e)
    }

    const { tool, input, output, tool_use_id } = e.props
    const shown_ref = { ...IS_SHOWN, id: tool_use_id }
    const { value: shown = false } = await $.state.get(shown_ref)
    const { Box, Button, Text } = $.ui.resolve(e)
    rows_drawn.add(tool_use_id)

    if (shown) {
      const row = await next(e)

      return (
        <Box flexDirection="column">
          {row}
          <Button
            plain
            dimColor
            key="hide"
            label="  ⎿  hide output"
            onPress={() => $.state.set(shown_ref, false)}
          />
        </Box>
      )
    }

    const summary = summaryOf(input)

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="success">⏺</Text> <Text bold>{tool}</Text>
          {summary ? `(${summary})` : ''}
        </Text>
        <Button
          plain
          dimColor
          key="show"
          label={`  ⎿  ${placeholder(output)}`}
          onPress={() => $.state.set(shown_ref, true)}
        />
      </Box>
    )
  })

  // The result block under a standalone row in the default renderer. Its row
  // already drew the placeholder (or, expanded, the engine's own row), so the
  // block draws nothing while folded and the engine's result once expanded; a
  // block whose row this module did not draw gets the placeholder itself.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    // A failed call keeps its output: the error is what you want to read.
    if (e.props.isErrored) return next(e)
    const { value } = await $.state.get(IS_HIDDEN)
    if (!(value ?? hidden_by_default)) return next(e)

    const { tool_use_id, output } = e.props
    const shown_ref = { ...IS_SHOWN, id: tool_use_id }
    const { value: shown = false } = await $.state.get(shown_ref)
    const { Box, Button } = $.ui.resolve(e)

    if (rows_drawn.has(tool_use_id)) {
      return shown ? next(e) : <Box />
    }
    if (shown) {
      const block = await next(e)

      return (
        <Box flexDirection="column">
          {block}
          <Button
            plain
            dimColor
            key="hide"
            label="⎿  hide output"
            onPress={() => $.state.set(shown_ref, false)}
          />
        </Box>
      )
    }

    return (
      <Button
        plain
        dimColor
        key="show"
        label={`⎿  ${placeholder(output)}`}
        onPress={() => $.state.set(shown_ref, true)}
      />
    )
  })
}
