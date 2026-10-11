# claude-plugins

My [Claude Code](https://claude.com/claude-code) plugins, published as one
marketplace. Each one is a standalone plugin under `plugins/`: install only
what you need.

| Plugin | Type | What it does |
| --- | --- | --- |
| [no-command-output](plugins/no-command-output) | mod | Hides tool output in the transcript, so you see what ran without the noise of its results. `/no-command-output` toggles it. |
| [agents-inspector](plugins/agents-inspector) | mod | A pane listing the session's subagents: model, effort, context, tokens, steps and time. `/agents-inspector` toggles it. |

## Install

From the prompt of a terminal session, add the marketplace once, then install
what you want:

```
/plugin marketplace add marcoscano/claude-plugins
/plugin install no-command-output@marcoscano
/plugin install agents-inspector@marcoscano
```

Pick the user scope to have a plugin in every session, the desktop app
included. Updates come through `/plugin` like any marketplace plugin.

### By hand

To run a plugin from a checkout instead, for one session:

```bash
git clone https://github.com/marcoscano/claude-plugins.git ~/claude-plugins
claude --plugin-dir ~/claude-plugins/plugins/agents-inspector
```

or for every session through `env` in `~/.claude/settings.json`, several
folders separated with `:`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-plugins/plugins/agents-inspector:~/claude-plugins/plugins/no-command-output"
  }
}
```

An interactive session watches a folder loaded this way and reloads the plugin
when a file is saved.

## Layout

```
.claude-plugin/marketplace.json   the catalog `/plugin marketplace add` reads
plugins/<name>/
  .claude-plugin/plugin.json      manifest
  hooks/hooks.json                a mod: points at the hooks module
  hooks/register.tsx              a mod: the module itself
  types/index.d.ts                a mod: its $.state contract
  tests/*.test.tsx                run with `claude plugin test`
  README.md                       what it does, how it works
```

The mods are function-hook plugins (`hooks/register.tsx`), an early-access
Claude Code API that may change between releases; each README names the
version it was last tested with.

## Adding a plugin

1. Create `plugins/<name>/` with its manifest and files.
2. Add an entry to `.claude-plugin/marketplace.json` with the same `name`,
   `source: "./plugins/<name>"` and its `version`.
3. Check both: `claude plugin validate plugins/<name>` and
   `claude plugin validate .` for the catalog; `claude plugin test
   plugins/<name>` runs its tests.

## License

MIT, see `LICENSE`.
