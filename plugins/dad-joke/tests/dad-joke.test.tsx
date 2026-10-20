import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const PLUGIN = 'dad-joke'
const ADD_TOOL = 'mcp__dad-joke__add_jokes'
const SURFACES = ['terminal', 'desktop'] as const

const EN_A = 'What do you call a fake noodle? An impasta.'
const EN_B = 'I only know 25 letters of the alphabet. I do not know y.'
const ES_A = 'Qué le dice un jaguar a otro jaguar? Jaguar you.'
const BOOK = { en: [EN_A, EN_B], es: [ES_A] }
const ANY_JOKE = /impasta|alphabet|jaguar/

const SPINNER: RenderPropsOf['Spinner'] = {
  word: 'Hullaballooing',
  message: null,
  suffix: '…',
  mode: 'thinking',
}
const MOUNT = {
  plugin: PLUGIN,
  component: 'Spinner',
  requestId: 'main',
  props: SPINNER,
  viewport: { columns: 120, rows: 40, isFullscreen: false },
} as const
const RUN = {
  args: '',
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 120 },
}
const START = { text: 'Refactor the thing.', turnId: 'turn-1' }
const COMPLETE = {
  turnId: 'turn-1',
  reason: 'answer',
  answer: 'Done.',
  durationMs: 4000,
  isAborted: false,
} as const

const text = (pattern: RegExp) => ({ type: 'Text', text: pattern })

/** Stands for the engine beneath the plugin: the jokes file, registrations, turns and the spinner's own line. */
const engineBeneath = (on: On, world: { written: string[]; submitted: string[]; book?: string }) => {
  on('fs.read', () => ({ value: world.book ?? JSON.stringify(BOOK) }))
  on('fs.write', ($, e) => {
    world.written.push(e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    world.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine spinner</Text>
  })
}

/** Mounts the spinner on a surface and reads the joke drawn beside it, if any. */
const jokeShown = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  surface: (typeof SURFACES)[number],
): Promise<string | undefined> => {
  const ui = await $.ui.mount({ ...MOUNT, surface })
  expect(await ui.find(text(/engine spinner/)), `${surface}: the engine's own line is kept`).toBeDefined()
  const joke = await ui.find(text(ANY_JOKE))
  await ui.unmount()
  return joke?.text
}

test('a joke sits beside the spinner while a turn runs, changes each minute, and goes with the turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world = { written: [], submitted: [] }
  engineBeneath(on, world)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    expect(await jokeShown($, surface), `${surface}: nothing before a turn`).toBeUndefined()
  }

  await $.turn.start(START)
  const first = await jokeShown($, 'terminal')
  expect(first, 'a joke once the turn runs').toBeDefined()
  expect(await jokeShown($, 'desktop'), 'the same joke on the desktop').toBe(first)

  await clock.advance(30_000)
  expect(await jokeShown($, 'terminal'), 'the same joke within the minute').toBe(first)

  await clock.advance(35_000)
  const second = await jokeShown($, 'terminal')
  expect(second, 'another joke after a minute').toBeDefined()
  expect(second).not.toBe(first)

  await $.turn.complete(COMPLETE)
  for (const surface of SURFACES) {
    expect(await jokeShown($, surface), `${surface}: nothing once the turn is over`).toBeUndefined()
  }
})

test('the joke is drawn under the line on a narrow terminal', async ($, on) => {
  mock.clock(on)
  engineBeneath(on, { written: [], submitted: [] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start(START)

  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', viewport: { columns: 60, rows: 40 } })
  expect(await ui.find(text(/engine spinner/))).toBeDefined()
  expect(await ui.find(text(ANY_JOKE))).toBeDefined()
  await ui.unmount()
})

test('the language option keeps the jokes to that language', { options: { language: 'es' } }, async ($, on) => {
  mock.clock(on)
  engineBeneath(on, { written: [], submitted: [] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start(START)
  expect(await jokeShown($, 'terminal')).toBe(ES_A)

  const told = await $.command.run({ ...RUN, command: 'dad-joke-now' })
  expect(told.text).toBe(ES_A)
})

test('/dad-joke off hides the joke and on brings it back', async ($, on) => {
  mock.clock(on)
  engineBeneath(on, { written: [], submitted: [] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start(START)
  expect(await jokeShown($, 'terminal')).toBeDefined()

  expect((await $.command.run({ ...RUN, command: 'dad-joke', args: 'off' })).text).toContain('off')
  expect(await jokeShown($, 'terminal'), 'hidden while off').toBeUndefined()

  expect((await $.command.run({ ...RUN, command: 'dad-joke', args: 'on' })).text).toContain('on')
  expect(await jokeShown($, 'terminal'), 'shown again, the turn still running').toBeDefined()

  expect((await $.command.run({ ...RUN, command: 'dad-joke' })).text, 'bare, it toggles').toContain('off')
  expect(await jokeShown($, 'terminal')).toBeUndefined()
})

test('starts hidden when enabledByDefault is off', { options: { enabledByDefault: false } }, async ($, on) => {
  mock.clock(on)
  engineBeneath(on, { written: [], submitted: [] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start(START)
  expect(await jokeShown($, 'terminal')).toBeUndefined()

  await $.command.run({ ...RUN, command: 'dad-joke', args: 'on' })
  expect(await jokeShown($, 'terminal')).toBeDefined()
})

test('/dad-joke-now tells a joke at once, and says so when there are none', async ($, on) => {
  mock.clock(on)
  const world = { written: [], submitted: [], book: JSON.stringify(BOOK) }
  engineBeneath(on, world)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const told = await $.command.run({ ...RUN, command: 'dad-joke-now' })
  expect(told.text).toMatch(ANY_JOKE)
})

test('an empty jokes file leaves the spinner alone and /dad-joke-now says so', async ($, on) => {
  mock.clock(on)
  engineBeneath(on, { written: [], submitted: [], book: '{}' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start(START)
  expect(await jokeShown($, 'terminal')).toBeUndefined()
  expect((await $.command.run({ ...RUN, command: 'dad-joke-now' })).text).toContain('No jokes on hand')
})

test('/dad-joke-more-jokes hands the model a search prompt naming the tool and the collection', async ($, on) => {
  const clock = mock.clock(on)
  const world = { written: [], submitted: [] }
  engineBeneath(on, world)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'dad-joke-more-jokes' })
  expect(ran.text).toContain('at least 50 new dad jokes')
  expect(ran.text).toContain('2 English and 1 Spanish')
  expect(world.submitted.length, 'nothing submitted inside the command').toBe(0)

  // The prompt goes once the command's dispatch is over.
  await clock.settle()
  expect(world.submitted.length).toBe(1)
  const prompt = world.submitted[0]
  expect(prompt).toContain('web search')
  expect(prompt).toContain(ADD_TOOL)
  expect(prompt).toContain('half in English and half in Spanish')
  expect(prompt).toContain(`- ${EN_A}`)
  expect(prompt).toContain(`- ${ES_A}`)
})

test('/dad-joke-add-joke stores one joke in the language it reads as, quotes and prefix aside', async ($, on) => {
  mock.clock(on)
  const world: { written: string[]; submitted: string[] } = { written: [], submitted: [] }
  engineBeneath(on, world)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const add = (args: string) => $.command.run({ ...RUN, command: 'dad-joke-add-joke', args })

  const spanish = '¿Por qué el marisco viene del mar? - Porque si viniera de Francia se llamaría Francisco'
  expect((await add(`"${spanish}"`)).text).toBe('Stored as Spanish. The collection now holds 2 English and 2 Spanish.')
  expect(JSON.parse(world.written[0]).es).toEqual([ES_A, spanish])

  const english = 'Why did the coffee file a police report? It got mugged.'
  expect((await add(`  ${english}  `)).text).toContain('Stored as English')
  expect(JSON.parse(world.written[1]).en).toEqual([EN_A, EN_B, english])

  // The prefix wins over what the text reads as; curly quotes come off too.
  expect((await add('en: “Es war einmal? No, that is German.”')).text).toContain('Stored as English')
  expect(JSON.parse(world.written[2]).en.at(-1)).toBe('Es war einmal? No, that is German.')

  expect((await add(`'${english}'`)).text).toContain('already in the collection (English)')
  expect(world.written.length, 'a duplicate writes nothing').toBe(3)

  expect((await add('')).text).toContain('Usage:')
  expect((await add('Knock knock.')).text, 'a tie under `all` asks for the prefix').toContain('Could not tell')
  expect(world.written.length).toBe(3)
})

test('under one configured language, an unreadable joke goes to that language', { options: { language: 'en' } }, async ($, on) => {
  mock.clock(on)
  const world: { written: string[]; submitted: string[] } = { written: [], submitted: [] }
  engineBeneath(on, world)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ ...RUN, command: 'dad-joke-add-joke', args: 'Knock knock.' })).text).toContain('Stored as English')
  expect(JSON.parse(world.written[0]).en.at(-1)).toBe('Knock knock.')
  // A joke that clearly reads as Spanish still goes to Spanish.
  expect((await $.command.run({ ...RUN, command: 'dad-joke-add-joke', args: '¿Qué hace una abeja en el gimnasio? Zum-ba.' })).text).toContain('Stored as Spanish')
})

test('the add_jokes tool appends new jokes to the file and skips duplicates', async ($, on) => {
  mock.clock(on)
  const world: { written: string[]; submitted: string[] } = { written: [], submitted: [] }
  engineBeneath(on, world)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const added = await $.tool.call({
    tool: ADD_TOOL,
    language: 'en',
    jokes: ['  Why did the coffee file a police report?  It got mugged. ', 'what do you call a fake noodle? an impasta!', '', 'I used to play piano by ear. Now I use my hands.'],
  })
  expect(added.deny).toBeUndefined()
  expect(added.result).toContain('Added 2 English jokes (2 skipped')
  expect(added.result).toContain('4 English and 1 Spanish')

  expect(world.written.length).toBe(1)
  const file = JSON.parse(world.written[0]) as { en: string[]; es: string[] }
  expect(file.en).toEqual([EN_A, EN_B, 'Why did the coffee file a police report? It got mugged.', 'I used to play piano by ear. Now I use my hands.'])
  expect(file.es).toEqual([ES_A])

  // The new jokes are on hand at once.
  const again = await $.tool.call({ tool: ADD_TOOL, language: 'en', jokes: ['I used to play piano by ear, now I use my hands'] })
  expect(again.result).toContain('Added 0 English jokes (1 skipped')
  expect(world.written.length, 'nothing to write').toBe(1)

  const refused = await $.tool.call({ tool: ADD_TOOL, language: 'fr', jokes: ['Pourquoi?'] })
  expect(refused.deny).toContain('language must be one of en, es')
})
