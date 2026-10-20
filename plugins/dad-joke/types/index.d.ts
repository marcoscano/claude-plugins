export type Language = 'en' | 'es'

/** What the language option takes: one language, or any. */
export type LanguageChoice = Language | 'all'

/** One joke and the language it is told in. */
export type Joke = { text: string; language: Language }

/** The jokes file: one list per language, as `jokes/dad_jokes.json` is laid out. */
export type JokeBook = Record<Language, string[]>

declare module 'claude-code' {
  interface PluginState {
    'dad-joke': {
      /** The joke drawn beside the spinner; null between turns. */
      current: Joke | null
      /** The session's switch, once `/dad-joke on|off` has set it. */
      isEnabled: boolean
    }
  }
}
