# dapperline

A [posh-git](https://github.com/dahlbyk/posh-git) style status line for [Claude Code](https://code.claude.com) — full git status in the format PowerShell users already know, plus context window and rate-limit usage.

```
[Opus 5] ⚡xhigh 💡 📁 dapperline [main ↑1 +1 ~1 -1 | +1 ~1 -1 !2 $3]
🧠 █████████░░░░░░░░░░░░░░░░░░░░░ 31% 311k/1M
⏳ ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 14% (reset 9h24m)
📅 ██████████████████░░░░░░░░░░░░ 61% (reset 2d23h)
```

- **Real posh-git formatting** — upstream tracking arrows, staged `|` unstaged counts, conflicts, stash. Not just a branch name.
- **Each quota row has its own hue and icon**, so stacked bars never blur together — while the percentage still carries the threshold color, and a bar in the danger band turns red anyway.
- **One `git` process per render.** Most status lines spawn five or six.
- **Degrades cleanly** — 24-bit, 256-color, 16-color, `NO_COLOR`, and an ASCII-only mode, picked automatically.
- **Color-vision-deficient palette by default** — cyan → yellow → red, separated by brightness as well as hue.
- Single file, no dependencies. Node.js, so macOS, Linux, and Windows behave the same.

## Install

Requires Node.js 18+ and git.

```bash
git clone https://github.com/dev-2nan/dapperline.git ~/.dapperline
```

Point Claude Code at it in `~/.claude/settings.json`:

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

### Header

```
[Opus 5] ⚡xhigh 💡 🚀 📁 dapperline
   │        │     │  └─ fast mode on
   │        │     └─ extended thinking on
   │        └─ reasoning effort
   └─ model
```

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

Each quota gets its own bar row, prefixed by an icon so the rows stay apart by shape:

```
🧠 █████████░░░░░░░░░░░░░░░░░░░░░ 31% 311k/1M     context window, and the tokens behind it
⏳ ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 14% (reset 9h24m)   5-hour rate limit
📅 ██████████████████░░░░░░░░░░░░ 61% (reset 2d23h)   7-day rate limit
```

Each row's bar carries its own hue — teal, violet, amber — ramping light to deep as it fills, so three rows sitting in the same threshold band are still telling apart. The **percentage** carries the threshold color instead, and a bar whose value reaches the danger band overrides to red: at that point the alarm matters more than the separation.

The context bar bands at 70/90%, the quota bars at 50/80%, so the same fill can be a different color on different rows — that is the thresholds doing their job, not an inconsistency.

Rate limits appear for Claude.ai Pro/Max subscribers after the first API response. When they are absent the quota rows disappear and the context bar drops its label, collapsing to a single line. Any additional window Claude Code adds later gets its own row automatically, and the labels re-pad to fit.

Set `rateLayout: 'inline'` for the compact one-line form instead:

```
██░░░░░░░░ 22% 217k/1M | 5h 14% | 7d 61%
```

### `barColor: 'threshold'`

The alternative mode tints each cell by the percentage *it* represents rather than by the current value, so the bands sit at fixed positions and the thresholds are visible as color changes along the bar:

```
cell:    1    2    3    4    5    6    7    8    9   10
covers:  5%  15%  25%  35%  45%  55%  65%  75%  85%  95%
band:   ├────────── ok ──────────┤├─ warn ─┤├ danger ┤
                              70% ↑     90% ↑
```

This reads well for a single bar but makes stacked rows hard to separate, since rows in the same band come out the same color — which is why `'identity'` is the default. Unfilled cells keep a dimmed tint either way, and below 24-bit color the whole bar falls back to a single level color.

## Configuration

Everything lives in the `CONFIG` block at the top of `dapperline.js`.

| Option | Default | Effect |
|---|---|---|
| `alwaysShowZeros` | `true` | Print `+0 ~0 -0` like posh-git. `false` hides zero counts and shows `✔` when clean |
| `showStash` | `true` | `$n` stash count |
| `shortenModel` | `true` | Drop a trailing parenthetical: `Opus 5 (1M context)` → `Opus 5` |
| `showEffort` | `true` | `⚡xhigh` reasoning effort |
| `showThinking` | `true` | `💡` when extended thinking is on |
| `showFastMode` | `true` | `🚀` when fast mode is on |
| `barWidth` | `30` | Cells per usage bar |
| `showTokens` | `true` | Token counts next to the context percentage |
| `rateLayout` | `'lines'` | One bar row per quota. `'inline'` appends them to the context line |
| `rowIcons` | `true` | 🧠/⏳/📅 row prefixes instead of `ctx`/`5h`/`7d` text |
| `barColor` | `'identity'` | Per-row hue, red in the danger band. `'threshold'` colors the whole bar by band |
| `showReset` | `true` | Time until each rate-limit window resets (`(reset 9h24m)`) |
| `showCost` | `false` | Session cost in USD |
| `showDuration` | `false` | Session elapsed time |
| `palette` | `'daltonized'` | `'classic'` for the usual green → yellow → red |
| `color` | `'auto'` | Force `'truecolor'`, `'256'`, `'16'`, or `'none'` |
| `glyphs` | `'auto'` | Force `'unicode'` or `'ascii'` |
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

## Terminal support

`color: 'auto'` resolves in this order:

| Signal | Result |
|---|---|
| `NO_COLOR` set | `none` |
| `COLORTERM=truecolor` or `24bit` | `truecolor` |
| `WT_SESSION` (Windows Terminal) | `truecolor` |
| `TERM_PROGRAM` is iTerm2, WezTerm, VS Code, Hyper, ghostty | `truecolor` |
| `TERM` ends in `-256color` | `256` |
| `TERM=dumb` | `none` |
| otherwise | `16` |

macOS Terminal.app reports `xterm-256color` and genuinely has no 24-bit support, so it lands on the flat-color bar rather than the gradient. Windows Terminal does not set `COLORTERM`, hence the `WT_SESSION` check.

`glyphs: 'auto'` uses Unicode everywhere except `TERM=dumb` and the Linux console. ASCII mode replaces the blocks and arrows with `#`, `.`, `=`, `^`, `v` and drops emoji — useful when emoji width is inconsistent enough to misalign the line.

## Testing

```bash
npm test              # ANSI stripped
node test/render.js   # in color
```

Renders fixtures for each threshold band, missing fields, and unusual context sizes, then re-runs the script under five simulated terminals to check the color and glyph fallbacks.

## Notes

`used_percentage` is calculated from input tokens only, so the token counter uses `total_input_tokens` to stay consistent with the percentage it sits next to.

Stash entries are counted by reading `logs/refs/stash` directly rather than shelling out to `git stash list`, which keeps the render to a single git process.

stdin is read with `setEncoding('utf8')` so multi-byte characters split across chunk boundaries — non-ASCII directory names, for instance — survive intact.

## Credits

The git format is [posh-git](https://github.com/dahlbyk/posh-git) by Keith Dahlby. The idea of putting session telemetry and reasoning effort in the status line comes from [CC-statusline](https://github.com/AwesomeJun/CC-statusline) and [ccstatusline](https://github.com/sirmalloc/ccstatusline).

## License

MIT
