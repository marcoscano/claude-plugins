# no-command-output

A Claude Code plugin that hides tool output in the transcript, so you see which
commands ran and which files were touched without the noise of their results.
Toggle it with `/no-command-output`.

<img src="docs/no-command-output-screenshot.png" alt="Screenshot of a Claude Code session explaining how no-command-output behaves" width="820">


- Every finished tool row shows a one-line placeholder, `output hidden (12 lines)`,
  instead of its output. The command or file in the row's header still shows.
- Click the placeholder to expand that row in place, exactly as Claude Code
  draws it; click `hide output` under it to fold it again. Clicks reach rows in
  the fullscreen renderer (`/tui fullscreen`), where the transcript stays live;
  the default renderer prints finished rows to scrollback, where nothing is
  clickable.
- Failed, interrupted and still-running calls are left alone: the error is what
  you want to read.
- Works in the default and fullscreen (`/tui`) renderers, with and without
  `verbose`, on the terminal and in the desktop app.
- Output is hidden from the start of every session. Change that under
  `/config` → "Hide tool output by default".
- The status line reads `tool output hidden` while the mode is on.

## Install

From the prompt of a terminal session:

```
/plugin install no-command-output --marketplace marcoscano/claude-plugins
```

Answer `y` to add the marketplace, pick the user scope, and accept or change the
one option. The plugin is active in that session and in every session after.

## Usage

| Command | Effect |
| --- | --- |
| `/no-command-output` | Toggle for the current session |
| `/no-command-output on` (or `hide`) | Hide output |
| `/no-command-output off` (or `show`) | Show output |

The session's toggle wins over the `/config` default until the session ends.
A row you expanded stays expanded for the session, whatever the mode.

## How it works

The plugin is a hooks module (`hooks/register.tsx`) with two `ui.render` hooks:

- `ToolResult`, the result block under a standalone row, is replaced by the
  placeholder for any tool.
- `ToolUse`, the row itself, draws its result inline in expanded groups and in
  the fullscreen renderer. While folded, the plugin draws the row (`⏺ Read(path)`
  and the placeholder, a plain dim `Button`). Once expanded it nests the
  engine's own drawing of the row (`next(e)`, header and full output) under a
  `hide output` button, so an expanded row looks exactly as it does without the
  plugin.
- `ToolResult` stays empty while its row drew the placeholder, which keeps a
  standalone row in the default renderer from showing it twice.

The mode lives in `$.state` for the session, and each expanded row in a
`StateFamily` keyed by the call's id; the manifest's `hiddenByDefault` option
(`.claude-plugin/plugin.json`) applies until the session toggles it.

## Development

Clone the repository and run Claude Code against the checkout:

```
claude --plugin-dir /path/to/claude-plugins/plugins/no-command-output
```

Or link it under `~/.claude/skills/no-command-output`: a plugin folder there
loads in every interactive session, and a save reloads it in place.

Check and test it against the engine:

```
claude plugin validate .
claude plugin test .
```

Once the plugin has loaded in a session, Claude Code writes its API types to
`.claude-plugin/types/` (ignored by git), and `tsc -p .` type-checks the module.

Notes for changes:

- Reach `$.state` directly (`$.state.get`, `$.state.set`); never pass `$` to an
  imported helper, which some builds' module loader refuses.
- Declare every `$.state` key in `types/index.d.ts`; `claude plugin validate`
  holds the module to that contract.
- Add or adjust a test in `tests/` for the behaviour you change.

Tested with Claude Code 2.1.292.

## License

MIT, see the repository's `LICENSE`.
