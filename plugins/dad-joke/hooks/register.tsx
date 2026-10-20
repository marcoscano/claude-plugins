import type { EngineInterface, Register } from 'claude-code'

import type { Joke, JokeBook, Language, LanguageChoice } from '../types'

const JOKES_FILE = 'jokes/dad_jokes.json'
const ADD_TOOL = 'mcp__dad-joke__add_jokes'
/** How long one joke stays beside the spinner. */
const ROTATE_MS = 60_000
/** How often the clock is checked while a turn runs. */
const TICK_MS = 5_000
/** Columns the terminal needs before the joke sits beside the spinner rather than under it. */
const SIDE_BY_SIDE_COLUMNS = 90
/** The share of the row the joke takes beside the spinner. */
const JOKE_SHARE = 0.4
const MIN_JOKE_COLUMNS = 28
/** How many new jokes /dad-joke-more-jokes asks for. */
const MORE_JOKES = 50

// $.state is reached directly ($.state.get / $.state.set), never through an
// imported helper: some builds' module loader follows `$` only within this file.
const CURRENT = { plugin: 'dad-joke', key: 'current' } as const
const IS_ENABLED = { plugin: 'dad-joke', key: 'isEnabled' } as const

const LANGUAGES: readonly Language[] = ['en', 'es']
const LANGUAGE_NAME: Record<Language, string> = { en: 'English', es: 'Spanish' }

const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)

const emptyBook = (): JokeBook => ({ en: [], es: [] })

/** Reads the jokes file, keeping only a list of non-empty strings per language. */
const parseBook = (text: string): JokeBook => {
  const book = emptyBook()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return book
  }
  if (data === null || typeof data !== 'object') return book
  for (const language of LANGUAGES) {
    const list = (data as Record<string, unknown>)[language]
    if (!Array.isArray(list)) continue
    book[language] = list
      .filter((one): one is string => typeof one === 'string' && one.trim().length > 0)
      .map(one => one.trim())
  }
  return book
}

/** Lowercased, unpunctuated, single-spaced: two spellings of one joke share a key. */
const keyOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

const languagesOf = (choice: LanguageChoice): readonly Language[] =>
  choice === 'all' ? LANGUAGES : [choice]

/** A joke of the wanted language(s) at random; never the last one shown while another exists. */
const pick = (book: JokeBook, choice: LanguageChoice, last: Joke | null): Joke | null => {
  const pool: Joke[] = languagesOf(choice).flatMap(language =>
    book[language].map(text => ({ text, language })),
  )
  const fresh = last === null ? pool : pool.filter(joke => joke.text !== last.text)
  const candidates = fresh.length > 0 ? fresh : pool
  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

const countOf = (book: JokeBook): string =>
  LANGUAGES.map(language => `${book[language].length} ${LANGUAGE_NAME[language]}`).join(' and ')

/** `on` and `off` set the panel; anything else toggles it. */
const wanted = (args: string, current: boolean): boolean => {
  const word = args.trim().toLowerCase()
  if (word === 'on') return true
  if (word === 'off') return false
  return !current
}

/** The prompt /dad-joke-more-jokes hands the model: search the web, then store through the tool. */
const morePrompt = (book: JokeBook, choice: LanguageChoice): string => {
  const languages = languagesOf(choice)
  const target =
    languages.length === 1
      ? `at least ${MORE_JOKES} new dad jokes in ${LANGUAGE_NAME[languages[0]]}`
      : `at least ${MORE_JOKES} new dad jokes in total, about half in English and half in Spanish`
  const existing = languages
    .map(
      language =>
        `${LANGUAGE_NAME[language]} (${book[language].length}):\n` +
        book[language].map(text => `- ${text.replace(/\s+/g, ' ')}`).join('\n'),
    )
    .join('\n\n')

  return [
    `Use web search to collect ${target} that are not already in the collection below.`,
    'A dad joke is short (one or two sentences; question and answer is fine), family-friendly and groan-worthy: a pun or a deadpan literal reading. Skip anything that is not clearly a joke, anything rude, and anything already in the collection, even reworded.',
    `Then call the \`${ADD_TOOL}\` tool once per language with \`{ "language": "en" | "es", "jokes": [...] }\`. It skips duplicates and reports how many it added; if fewer than ${MORE_JOKES} were added in total, search again and add more until that many new jokes are in.`,
    'Finish with one line saying how many jokes were added per language.',
    '',
    `Collection so far:\n\n${existing}`,
  ].join('\n')
}

// The module's own values, set by `register` and reset by a reload (which runs
// it again). They sit at the top of the file because the helpers under them
// take `$`, and the loader follows `$` only into functions declared here.
/** The manifest's options, as `register` read them. */
let enabled_by_default = true
let language: LanguageChoice = 'all'
/** The jokes on hand: the plugin's own file, read at session start and rewritten by the add_jokes tool. */
let book: JokeBook = emptyBook()
let jokes_path = JOKES_FILE
/** True while the main loop's turn runs: the joke then changes every minute. A subagent's turn is not counted. */
let is_working = false
let shown_at = 0

const loadBook = async ($: EngineInterface): Promise<void> => {
  jokes_path = `${$.plugin.root}/${JOKES_FILE}`
  try {
    const text = await $.fs.read(jokes_path)
    book = parseBook(typeof text === 'string' ? text : '')
  } catch {
    book = emptyBook()
  }
}

const isEnabled = async ($: EngineInterface): Promise<boolean> => {
  const { value } = await $.state.get(IS_ENABLED)
  return value ?? enabled_by_default
}

/** Puts a fresh joke beside the spinner; the spinner rows reading it redraw. */
const showNext = async ($: EngineInterface, now: number): Promise<void> => {
  const { value: last } = await $.state.get(CURRENT)
  shown_at = now
  await $.state.set(CURRENT, pick(book, language, last ?? null))
}

/** Letters and marks only Spanish uses; each counts double against the stop words. */
const SPANISH_MARKS = /[¿¡ñáéíóúü]/giu
/** Stop words that belong to one language alone (`a`, `no`, `me` belong to both and are left out). */
const SPANISH_WORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'que', 'qué', 'por', 'porque', 'un', 'una', 'es', 'se',
  'con', 'para', 'como', 'cómo', 'le', 'dice', 'al', 'mi', 'su', 'y', 'en', 'lo', 'dos', 'está',
])
const ENGLISH_WORDS = new Set([
  'the', 'an', 'of', 'to', 'and', 'is', 'what', 'why', 'do', 'does', 'you', 'my', 'i', 'it',
  'its', 'in', 'on', 'call', 'did', 'said', 'was', 'are', 'with', 'have', 'has', 'be', 'because',
])

/** Which language a joke reads as, by its marks and stop words; null when it is a tie. */
const detectLanguage = (text: string): Language | null => {
  const words = keyOf(text).split(' ')
  const marks = text.match(SPANISH_MARKS)?.length ?? 0
  const es = marks * 2 + words.filter(word => SPANISH_WORDS.has(word)).length
  const en = words.filter(word => ENGLISH_WORDS.has(word)).length
  if (es === en) return null
  return es > en ? 'es' : 'en'
}

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
]

/** `/dad-joke-add-joke [en:|es:] <joke>`: the language named, and the joke with one pair of quotes taken off. */
const parseAddArgs = (args: string): { language: Language | null; text: string } => {
  let text = args.trim()
  let given: Language | null = null
  const prefixed = /^(en|es):\s*/iu.exec(text)
  if (prefixed) {
    given = prefixed[1].toLowerCase() as Language
    text = text.slice(prefixed[0].length)
  }
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, -close.length).trim()
      break
    }
  }
  return { language: given, text: text.replace(/\s+/g, ' ') }
}

type Added = { added: number; skipped: number; writeError?: string }

/** Adds what is new among `jokes` to the language's list and writes the file; the new ones are on hand at once. */
const addJokes = async ($: EngineInterface, to: Language, jokes: readonly unknown[]): Promise<Added> => {
  const known = new Set(LANGUAGES.flatMap(one => book[one].map(keyOf)))
  const added: string[] = []
  let skipped = 0
  for (const joke of jokes) {
    const text = typeof joke === 'string' ? joke.replace(/\s+/g, ' ').trim() : ''
    const key = keyOf(text)
    if (text.length === 0 || key.length === 0 || known.has(key)) {
      skipped += 1
      continue
    }
    known.add(key)
    added.push(text)
  }
  if (added.length === 0) return { added: 0, skipped }

  // The book is updated before the write, so a second add that lands during
  // it starts from the newer list and writes the whole of it.
  book = { ...book, [to]: [...book[to], ...added] }
  try {
    await $.fs.write(jokes_path, `${JSON.stringify(book, null, 2)}\n`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { added: added.length, skipped, writeError: `could not write ${jokes_path}: ${reason}` }
  }
  return { added: added.length, skipped }
}

export const register: Register = (on, options) => {
  enabled_by_default = options.enabledByDefault !== false
  language = options.language === 'en' || options.language === 'es' ? options.language : 'all'

  on('session.start', async ($, e, next) => {
    await loadBook($)
    await $.command.register({
      name: 'dad-joke',
      description: 'Show or hide the dad joke beside the spinner',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await $.command.register({
      name: 'dad-joke-now',
      description: 'Tell a dad joke right now',
      immediate: true,
    })
    await $.command.register({
      name: 'dad-joke-add-joke',
      description: 'Store one dad joke in the collection for the future',
      argumentHint: '[en:|es:] <joke>',
      immediate: true,
    })
    await $.command.register({
      name: 'dad-joke-more-jokes',
      description: `Search the web for ${MORE_JOKES} new dad jokes and add them to the collection`,
    })
    await $.tool.register({
      name: 'add_jokes',
      description:
        'Adds dad jokes to the dad-joke plugin\'s collection, one language per call. Duplicates of jokes already held are skipped; the result says how many were added.',
      inputSchema: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['en', 'es'], description: 'The language the jokes are told in' },
          jokes: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'The jokes, one string each' },
        },
        required: ['language', 'jokes'],
      },
      isDeferred: false,
    })

    // Checks the age of the joke on show while a turn runs; quiet otherwise.
    $.clock.every(TICK_MS, () => {
      if (!is_working) return
      void (async () => {
        const now = await $.clock.now()
        if (now - shown_at >= ROTATE_MS) await showNext($, now)
      })()
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    is_working = true
    if (await isEnabled($)) await showNext($, await $.clock.now())

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    is_working = false
    await $.state.set(CURRENT, null)

    return next(e)
  })

  // The spinner row while a turn runs: the engine's own line (word, elapsed
  // time, tokens, effort) on the left, the joke on the right. A narrow
  // terminal gets the joke under the line instead.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // Reading while drawing subscribes this row: a later set redraws it.
    const { value: joke } = await $.state.get(CURRENT)
    if (!(await isEnabled($)) || !joke) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const engine = await next(e)
    const columns = e.viewport?.columns ?? 80

    if (columns < SIDE_BY_SIDE_COLUMNS) {
      return (
        <Box flexDirection="column">
          {engine}
          <Text dimColor wrap="wrap">
            {joke.text}
          </Text>
        </Box>
      )
    }

    const width = Math.max(MIN_JOKE_COLUMNS, Math.floor(columns * JOKE_SHARE))

    return (
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          {engine}
        </Box>
        <Box width={width} flexShrink={0} flexDirection="row" marginLeft={2}>
          <Text dimColor>{'│ '}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="wrap">
              {joke.text}
            </Text>
          </Box>
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'dad-joke' }, async ($, e) => {
    const enabled = wanted(e.args, await isEnabled($))
    await $.state.set(IS_ENABLED, enabled)
    if (enabled && is_working) await showNext($, await $.clock.now())
    if (!enabled) await $.state.set(CURRENT, null)

    return {
      text: enabled
        ? 'Dad jokes on: one shows beside the spinner while Claude works, a new one every minute.'
        : 'Dad jokes off. Run /dad-joke on to bring them back.',
    }
  })

  on('command.run', { command: 'dad-joke-now' }, async $ => {
    const { value: last } = await $.state.get(CURRENT)
    const joke = pick(book, language, last ?? null)
    if (joke === null) {
      return { text: `No jokes on hand: ${jokes_path} is missing or holds none in the chosen language.` }
    }
    // The spinner shows the same one while a turn runs.
    if (is_working && (await isEnabled($))) {
      shown_at = await $.clock.now()
      await $.state.set(CURRENT, joke)
    }

    return { text: joke.text }
  })

  // One joke the person wants kept: its language as prefixed, else as the
  // text reads, else the configured one; a tie under `all` asks for the prefix.
  on('command.run', { command: 'dad-joke-add-joke' }, async ($, e) => {
    const { language: given, text } = parseAddArgs(e.args)
    if (text.length === 0) {
      return { text: 'Usage: /dad-joke-add-joke [en:|es:] <joke>' }
    }
    const to = given ?? detectLanguage(text) ?? (language === 'all' ? null : language)
    if (to === null) {
      return {
        text: 'Could not tell which language that is. Run it as /dad-joke-add-joke en: <joke> or /dad-joke-add-joke es: <joke>.',
      }
    }
    const { added, writeError } = await addJokes($, to, [text])
    if (added === 0) {
      return { text: `That one is already in the collection (${LANGUAGE_NAME[to]}); nothing added.` }
    }
    if (writeError !== undefined) {
      return { text: `Kept for this session as ${LANGUAGE_NAME[to]}, but ${writeError}` }
    }

    return { text: `Stored as ${LANGUAGE_NAME[to]}. The collection now holds ${countOf(book)}.` }
  })

  on('command.run', { command: 'dad-joke-more-jokes' }, $ => {
    // The prompt starts a turn of its own once the session is idle. The host
    // refuses a submit made inside a command's dispatch (it would wait on the
    // turn the command holds), so it goes right after this hook returns.
    const prompt = morePrompt(book, language)
    $.clock.after(0, () => {
      void $.prompt.submit({ text: prompt })
    })
    const where = language === 'all' ? 'English and Spanish' : LANGUAGE_NAME[language]

    return {
      text: `Asked Claude to search the web for at least ${MORE_JOKES} new dad jokes in ${where} and add them to the collection (${countOf(book)} so far).`,
    }
  })

  // The tool the model calls with what it found: new jokes join the file,
  // duplicates (by their words, punctuation and case aside) are skipped.
  on('tool.call', { tool: ADD_TOOL }, async ($, e) => {
    const input = e as Record<string, unknown>
    const given_language = input.language
    const given_jokes = input.jokes
    if (!isLanguage(given_language)) {
      return { deny: `language must be one of ${LANGUAGES.join(', ')}.` }
    }
    if (!Array.isArray(given_jokes) || given_jokes.length === 0) {
      return { deny: 'jokes must be a non-empty list of strings.' }
    }

    const { added, skipped, writeError } = await addJokes($, given_language, given_jokes)
    if (writeError !== undefined) {
      return { deny: `Kept ${added} for this session, but ${writeError}` }
    }

    return {
      result: `Added ${added} ${LANGUAGE_NAME[given_language]} ${added === 1 ? 'joke' : 'jokes'} (${skipped} skipped as duplicates or empty). The collection now holds ${countOf(book)}.`,
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: add_jokes failed.` }))
}
