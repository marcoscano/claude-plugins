# agents-inspector

A Claude Code mod: a pane listing the subagents of the current session, with
what each one is doing and what it has used so far. Toggle it with
`/agents-inspector`.

```
1 running · 2 finished · 412k tokens

Running · 1
● Find presave callers
  Explore · haiku-5-5 · low
  ctx 48k · 96k tokens (85% cached) · 2 steps · 0:41

▾ Finished · 2
✓ Review the diff for correctness
  pr-review-toolkit:code-reviewer · opus-5-5 · high
  ctx 112k · 301k tokens (91% cached) · 7 steps · 3:12
✗ Summarise the issue thread
  general-purpose · sonnet-5-5 · error
  ctx 15k · 15k tokens (0% cached) · 1 step · 0:09
```

Per run: the Agent call's description, the agent type, the model and effort of
its last request, the size of that request (`ctx`), the tokens of every request
summed with the share served from the prompt cache, the number of model
requests (`steps`) and the elapsed time. A run that ended without an answer
shows why (`aborted`, `error`, `refusal`).

- The pane opens itself once per session, when the first subagent starts.
  Turn that off under `/config` → "Open the agents pane when the first
  subagent starts", or set `autoOpen` to `false` in `pluginConfigs`.
- Finished runs fold under their heading; the last 100 runs are kept.
- No cost is shown: the engine reports tokens, not prices, and a price table
  in the mod would drift. Tokens and the cached share are what you can
  compare between runs.
- It registers no tools and adds nothing to the model's context.

## Install

From the prompt of a terminal session:

```
/plugin install agents-inspector --marketplace marcoscano/claude-plugins
```

Answer `y` to add the marketplace, pick the user scope, and accept or change the
one option. The plugin is active in that session and in every session after.

To run it from a checkout instead, for one session:

```
claude --plugin-dir /path/to/claude-plugins/plugins/agents-inspector
```

or in every session, the desktop app included, through the `env` block of
`~/.claude/settings.json` (several folders are separated with `:`):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-plugins/plugins/agents-inspector"
  }
}
```

An interactive session watches a folder loaded this way: a save reloads the
module in place.

## Usage

| Command | Effect |
| --- | --- |
| `/agents-inspector` | Toggle the pane |
| `/agents-inspector open` | Open it |
| `/agents-inspector close` | Close it |

Asked for, the pane is placed at any width. Opened by itself it waits until
the terminal is 144 columns wide (110 in fullscreen, `/tui fullscreen`, where
it docks beside the transcript).

## How it works

One hooks module, `hooks/register.tsx`, with no tools and no network, file or
process access:

- `agent.spawn` adds a run once the engine has started the subagent.
- `turn.step` (each model request inside a subagent's loop) adds the request's
  usage to its run and refreshes the model and effort.
- `turn.complete` marks the run `done` or `failed`, and takes the turn's usage
  when no step was seen.
- `ui.render` on the pane draws the rows with `Box`, `Text` and `Button`, the
  same tree on the terminal and in the desktop app.
- A one-second timer moves the elapsed times while a run is live and is quiet
  otherwise.

State lives in `$.state` under the contract in `types/index.d.ts`, so a hot
reload keeps the runs.

## Development

```
claude plugin validate .
claude plugin test .
```

Once a session has loaded the mod, Claude Code writes its API types to
`.claude-plugin/types/` (ignored by git), and `tsc -p .` type-checks it.

Written against Claude Code 2.1.296. The function-hooks API is early access
and may change between releases.

## License

MIT, see the repository's `LICENSE`.
