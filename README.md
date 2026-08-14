# dapperline

A [posh-git](https://github.com/dahlbyk/posh-git) style status line for [Claude Code](https://code.claude.com) — full git status in the format PowerShell users already know, plus context window and rate-limit usage.

```
[Opus 5] 📁 dapperline [main ↑1 +1 ~1 -1 | +1 ~1 -1 !2 $3]
██░░░░░░░░ 22% 217k/1M | 5h 8% | 7d 58%
```

- **Real posh-git formatting** — upstream tracking arrows, staged `|` unstaged counts, conflicts, stash. Not just a branch name.
- **One `git` process per render.** Most status lines spawn five or six.
- **Threshold colors.** Every number turns yellow, then red, at limits you set.
- **Color-vision-deficient palette by default** — cyan → yellow → bold red, separated by brightness as well as hue.
- Single file, no dependencies. Node.js, so it runs the same on macOS, Linux, and Windows.

## Install

Requires Node.js and git.

```bash
git clone https://github.com/dev-2nan/dapperline.git ~/.dapperline
```

Then point Claude Code at it in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.dapperline/dapperline.js"
  }
}
```

<details>
<summary>Windows</summary>

Write the path with **forward slashes**. Claude Code runs the status line through Git Bash when it is installed, and Git Bash eats backslashes as escape characters — the command then fails silently and the status line stays blank.

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/you/.dapperline/dapperline.js"
  }
}
```
</details>

The status line appears on the next update — a new assistant message, a `/compact`, or a permission-mode change. Restart Claude Code if it does not.

## Reading it

### Git segment

```
[main ↑1 +1 ~1 -1 | +1 ~1 -1 !2 $3]
 │     │  └─ staged ─┘   └ unstaged ┘ │  └ stash
 │     └─ upstream                    └─ conflicts
 └─ branch
```

| | Meaning |
|---|---|
| `≡` | Even with upstream |
| `↑n` `↓n` `↑n↓m` | Ahead, behind, diverged |
| `×` | Upstream is gone |
| `➦ 87a31fc` | Detached HEAD |
| `+` `~` `-` | Added, modified, deleted |
| `!n` | Conflicted files |
| `$n` | Stash entries |
| `✔` | Clean |

Left of the `|` is the index (green), right of it is the working tree (red); untracked files count as working-tree adds. The branch name is colored by its relationship to the upstream: cyan even, green ahead, red behind, yellow diverged, gray no upstream.

### Usage segment

| | Meaning |
|---|---|
| `██░░░░░░░░ 22% 217k/1M` | Context window used, and the token counts behind it |
| `5h 8%` | 5-hour rate limit consumed |
| `7d 58%` | 7-day rate limit consumed |

Rate limits appear for Claude.ai Pro/Max subscribers after the first API response, and are omitted otherwise. Any additional window Claude Code adds later renders automatically.

## Configuration

Everything lives in the `CONFIG` block at the top of `dapperline.js`.

| Option | Default | Effect |
|---|---|---|
| `alwaysShowZeros` | `true` | Print `+0 ~0 -0` like posh-git. `false` hides zero counts and shows `✔` when clean |
| `showStash` | `true` | `$n` stash count |
| `showTokens` | `true` | Token counts next to the context percentage |
| `showReset` | `false` | Time until each rate-limit window resets (`5h 8% 25m`) |
| `showCost` | `false` | Session cost in USD |
| `showDuration` | `false` | Session elapsed time |
| `palette` | `'daltonized'` | `'classic'` for the usual green → yellow → red |
| `limits` | see below | Warning and danger thresholds |

```js
limits: {
  context: { warn: 70, danger: 90 },  // %
  rate:    { warn: 50, danger: 80 },  // %
  cost:    { warn: 5,  danger: 20 },  // USD
  time:    { warn: 60, danger: 180 }, // minutes
}
```

Set `debugDump` to a file path to capture the raw JSON Claude Code sends, which is the fastest way to see which fields are actually available to you.

## Testing

```bash
node test/render.js
```

Renders a set of fixtures — clean repo, diverged branch, detached HEAD, merge conflict, every threshold band — so you can see formatting changes without waiting for real session state.

## Notes

`used_percentage` is calculated from input tokens only, so the token counter uses `total_input_tokens` to stay consistent with the percentage it sits next to.

Stash entries are counted by reading `logs/refs/stash` directly rather than shelling out to `git stash list`, which keeps the render to a single git process.

## Credits

The git format is [posh-git](https://github.com/dahlbyk/posh-git) by Keith Dahlby. The idea of putting session telemetry in the status line comes from [CC-statusline](https://github.com/AwesomeJun/CC-statusline) and [ccstatusline](https://github.com/sirmalloc/ccstatusline).

## License

MIT
