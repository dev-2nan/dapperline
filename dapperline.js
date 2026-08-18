#!/usr/bin/env node
/**
 * dapperline — a posh-git style status line for Claude Code.
 *
 *   [Opus 5] ⚡xhigh 💡 📁 repo [main ↑1 +1 ~1 -1 | +1 ~1 -1 !2 $3]
 *   🧠 Context  █████████░░░░░░░░░░░░░░░░░░░░░ 31% 311k/1M
 *   ⏳ 5h quota ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 14% (reset 9h24m)
 *   📅 7d quota ██████████████████░░░░░░░░░░░░ 61% (reset 2d23h)
 *
 * Line 1   model · reasoning effort · directory · git status (posh-git format)
 * Line 2+  one bar row per usage metric
 *
 * Each row carries its own hue so stacked bars stay distinct; the percentage
 * carries the threshold color, and a bar in the danger band overrides to red.
 *
 * Reads Claude Code's status line JSON on stdin, writes rendered lines to
 * stdout. See https://code.claude.com/docs/en/statusline
 */

// ─────────────────────────── config ───────────────────────────
const CONFIG = {
  // Git segment
  alwaysShowZeros: true,   // posh-git style: always print +0 ~0 -0
  showStash:       true,   // $n stash count (read from reflog, costs no process)

  // Model segment
  shortenModel:    true,   // "Opus 5 (1M context)" → "Opus 5"
  showEffort:      true,   // ⚡xhigh reasoning effort
  showThinking:    true,   // 💡 when extended thinking is on
  showFastMode:    true,   // 🚀 when fast mode is on

  // Usage segment
  barWidth:        30,     // cells per usage bar
  showTokens:      true,   // token counts next to the context percentage (217k/1M)
  showReset:       true,   // time until each rate-limit window resets
  rowIcons:        true,   // 🧠/⏳/📅 prefix on each usage row
  rowLabels:       true,   // spell the row out: "Context", "5h quota", "7d quota"

  // Bar glyphs. 'block' is █/░ and is the default. Some fonts draw those two
  // at different heights, which makes the empty half look like it floats above
  // the filled half — GitHub's monospace font does exactly that. If your
  // terminal's font does too, switch to 'line' (━/─, both centered on the same
  // axis) or 'solid' (█ throughout, fill marked by brightness, needs 24-bit
  // color).
  barStyle:        'block',

  // 'lines' gives every rate-limit window its own bar line, aligned under the
  // context bar. 'inline' appends them to the context line as "| 5h 14%".
  rateLayout:      'lines',

  // 'identity' colors each bar by which metric it is, ramping light → deep, so
  // stacked rows stay distinct even when they share a threshold band. The
  // percentage still carries the threshold color, and a bar in the danger band
  // overrides to red — separation matters less than the alarm at that point.
  // 'threshold' colors the whole bar by band instead (thresholds visible as
  // color changes along the bar).
  barColor:        'identity',
  showCost:        false,  // session cost in USD
  showDuration:    false,  // session elapsed time

  // 'daltonized' keeps the levels apart for color-vision deficiency by using
  // cyan → yellow → red, which separates them by brightness as well as hue.
  // 'classic' is the usual green → yellow → red.
  palette: 'daltonized',

  // 'auto' probes the terminal. Force with 'truecolor', '256', '16', or 'none'.
  // macOS Terminal.app has no 24-bit support; iTerm2, WezTerm, Windows
  // Terminal, and most Linux terminals do.
  color: 'auto',

  // 'auto' uses Unicode blocks and arrows, and emoji when the terminal is
  // likely to render them at a predictable width. 'ascii' is the safe subset
  // for TTYs, older PuTTY, and CI logs.
  glyphs: 'auto',

  // A value at or above `warn` turns yellow; at or above `danger` turns red.
  limits: {
    context: { warn: 70, danger: 90 },  // context window used, %
    rate:    { warn: 50, danger: 80 },  // 5h / 7d rate limit used, %
    cost:    { warn: 5,  danger: 20 },  // session cost, USD   (needs showCost)
    time:    { warn: 60, danger: 180 }, // session elapsed, min (needs showDuration)
  },

  // Write the raw stdin JSON here to inspect what Claude Code actually sends.
  // Empty string disables it.
  debugDump: '',
};
// ──────────────────────────────────────────────────────────────

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─────────────────────── terminal capability ───────────────────────
/**
 * Returns 'truecolor' | '256' | '16' | 'none'.
 *
 * NO_COLOR is honored first (https://no-color.org). COLORTERM is the only
 * reliable 24-bit signal, but Windows Terminal does not set it, so WT_SESSION
 * and known TERM_PROGRAM values are checked too.
 */
function detectColor() {
  if (CONFIG.color !== 'auto') return CONFIG.color;
  const e = process.env;
  if (e.NO_COLOR != null) return 'none';
  if (/^(truecolor|24bit)$/i.test(e.COLORTERM || '')) return 'truecolor';
  if (e.WT_SESSION) return 'truecolor';                      // Windows Terminal
  if (/^(iTerm\.app|WezTerm|vscode|Hyper|ghostty)$/i.test(e.TERM_PROGRAM || '')) return 'truecolor';
  if (/-256color$/.test(e.TERM || '')) return '256';         // incl. macOS Terminal.app
  if (e.TERM === 'dumb') return 'none';
  return '16';
}

/**
 * Emoji width is inconsistent across terminals, which knocks the line out of
 * alignment. Only enable it where rendering is predictable.
 */
function detectGlyphs() {
  if (CONFIG.glyphs !== 'auto') return CONFIG.glyphs;
  const e = process.env;
  if (e.TERM === 'dumb' || e.TERM === 'linux') return 'ascii';
  return 'unicode';
}

const COLOR = detectColor();
const GLYPH = detectGlyphs();
const UNI = GLYPH === 'unicode';

const G = UNI
  ? { full: '█', empty: '░', even: '≡', ahead: '↑', behind: '↓',
      detached: '➦', clean: '✔', gone: '×', dir: '📁 ', effort: '⚡', think: '💡', fast: '🚀' }
  : { full: '#', empty: '.', even: '=', ahead: '^', behind: 'v',
      detached: '@', clean: 'ok', gone: 'x', dir: '', effort: '*', think: '~', fast: '>' };

// ─────────────────────────── color ───────────────────────────
const RESET = COLOR === 'none' ? '' : '\x1b[0m';
const BOLD = COLOR === 'none' ? '' : '\x1b[1m';

/** Basic 16-color codes, used directly and as the non-truecolor fallback. */
const C = COLOR === 'none'
  ? new Proxy({}, { get: () => '' })
  : {
      red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
      magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
      bRed: '\x1b[91m', bYellow: '\x1b[93m', bCyan: '\x1b[96m',
    };

/**
 * Per-band [light, deep] RGB pairs. Each band gradates within itself, so the
 * bar looks continuous while the band boundaries — the thresholds — stay crisp.
 */
const RGB = {
  daltonized: {
    ok:     [[110, 231, 231], [ 56, 189, 189]],
    warn:   [[250, 220, 120], [240, 190,  40]],
    danger: [[255, 130, 110], [214,  45,  35]],
  },
  classic: {
    ok:     [[130, 225, 150], [ 46, 175,  80]],
    warn:   [[250, 220, 120], [240, 190,  40]],
    danger: [[255, 130, 110], [214,  45,  35]],
  },
}[CONFIG.palette] || {};

/**
 * Per-row identity hues, [light, deep]. Chosen to stay apart under
 * deuteranopia/protanopia: teal, violet, and amber differ in brightness as
 * well as hue, unlike the pink/blue/yellow trio these are modelled on.
 */
const IDENTITY = {
  ctx:        [[130, 240, 240], [ 40, 160, 160]],  // teal
  five_hour:  [[190, 170, 255], [110,  80, 210]],  // violet
  seven_day:  [[255, 215, 140], [220, 150,  30]],  // amber
  _default:   [[190, 198, 214], [110, 120, 140]],  // slate, for unknown windows
};

const LEVEL = CONFIG.palette === 'classic'
  ? { ok: C.green, warn: C.yellow, danger: BOLD + C.red }
  : { ok: C.bCyan, warn: C.bYellow, danger: BOLD + C.bRed };

const lv = (v, t) => (v >= t.danger ? LEVEL.danger : v >= t.warn ? LEVEL.warn : LEVEL.ok);
const paint = (text, color) => (COLOR === 'none' ? String(text) : `${color}${text}${RESET}`);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (x, y, t) => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
const dim = ([r, g, b], k = 0.3) => [Math.round(r * k), Math.round(g * k), Math.round(b * k)];

/** Color for the point `p` on the 0-100 axis, gradating inside each band. */
function bandColor(p, t) {
  if (p < t.warn) return mix(RGB.ok[0], RGB.ok[1], t.warn ? p / t.warn : 0);
  if (p < t.danger) return mix(RGB.warn[0], RGB.warn[1], (p - t.warn) / (t.danger - t.warn));
  return mix(RGB.danger[0], RGB.danger[1], Math.min(1, (p - t.danger) / (100 - t.danger)));
}

/** Color for one cell, under whichever barColor mode is active. */
function cellColor(cellPct, t, id, pct) {
  if (CONFIG.barColor === 'threshold') return bandColor(cellPct, t);
  // Identity mode: a light → deep ramp in this row's own hue, so stacked rows
  // stay distinct. Once the value is genuinely in the danger band the alarm
  // wins and the whole bar goes red.
  const pair = pct >= t.danger ? RGB.danger : (IDENTITY[id] || IDENTITY._default);
  return mix(pair[0], pair[1], cellPct / 100);
}

/**
 * Filled and empty glyphs for the configured bar style. 'solid' and 'line'
 * both need Unicode; 'solid' additionally needs truecolor, since it separates
 * filled from empty by brightness rather than by shape.
 */
function barGlyphs() {
  let style = CONFIG.barStyle;
  if (!UNI) return { full: G.full, empty: G.empty };            // ASCII: # and .
  if (style === 'auto') style = COLOR === 'truecolor' ? 'solid' : 'block';   // legacy value
  if (style === 'solid' && COLOR !== 'truecolor') style = 'block';
  if (style === 'line') return { full: '━', empty: '─' };
  if (style === 'solid') return { full: '█', empty: '█' };
  return { full: '█', empty: '░' };
}

/**
 * Renders the usage bar. With 24-bit color each cell is tinted individually;
 * unfilled cells keep a dimmed tint so the shape stays readable. Without
 * truecolor the whole bar falls back to one flat threshold color.
 */
function renderBar(pct, t, id) {
  const w = CONFIG.barWidth;
  const filled = Math.max(0, Math.min(w, Math.floor((pct / 100) * w)));
  const { full, empty } = barGlyphs();

  if (COLOR !== 'truecolor') {
    const flat = lv(pct, t);
    return paint(full.repeat(filled) + empty.repeat(w - filled), flat);
  }

  let out = '';
  for (let i = 0; i < w; i++) {
    const cellPct = ((i + 0.5) / w) * 100;   // the value this cell stands for
    const rgb = cellColor(cellPct, t, id, pct);
    out += i < filled ? fg(rgb) + full : fg(dim(rgb, 0.22)) + empty;
  }
  return out + RESET;
}

const git = (args, cwd) => execSync(`git ${args}`, {
  cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
});

// ─────────────────────────── git ───────────────────────────
/** Returns null when cwd is not inside a git repository. */
function readGit(cwd) {
  let out;
  try {
    // One call answers everything: whether this is a repo, the branch, the
    // ahead/behind counts, and per-file status. -z keeps parsing correct even
    // when a filename contains a newline.
    out = git('status --porcelain=v2 --branch -z', cwd);
  } catch {
    return null;
  }

  const s = {
    branch: '', oid: '', upstream: false, ab: false, ahead: 0, behind: 0,
    idx: { a: 0, m: 0, d: 0 }, wt: { a: 0, m: 0, d: 0 }, conflict: 0, stash: 0,
  };

  const recs = out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;

    if (r.startsWith('# branch.head ')) { s.branch = r.slice(14); continue; }
    if (r.startsWith('# branch.oid ')) { s.oid = r.slice(13, 20); continue; }
    if (r.startsWith('# branch.upstream ')) { s.upstream = true; continue; }
    if (r.startsWith('# branch.ab ')) {
      const m = r.match(/\+(\d+) -(\d+)/);
      if (m) { s.ab = true; s.ahead = +m[1]; s.behind = +m[2]; }
      continue;
    }
    if (r.startsWith('# ')) continue;

    const t = r[0];
    if (t === '?') { s.wt.a++; continue; }   // untracked counts as a working-tree add
    if (t === '!') continue;                 // ignored (not requested, so never appears)
    if (t === 'u') { s.conflict++; continue; }
    if (t === '1' || t === '2') {
      if (t === '2') i++; // a rename/copy record is followed by its original path
      const X = r[2], Y = r[3];              // X = staged, Y = unstaged
      if (X === 'A') s.idx.a++; else if (X === 'D') s.idx.d++; else if (X !== '.') s.idx.m++;
      if (Y === 'A') s.wt.a++; else if (Y === 'D') s.wt.d++; else if (Y !== '.') s.wt.m++;
    }
  }

  if (CONFIG.showStash) s.stash = stashCount(cwd);
  return s;
}

/**
 * Counts stash entries straight from the reflog instead of shelling out to
 * `git stash list`, which saves roughly 70ms per render.
 */
function stashCount(cwd) {
  let dir = path.resolve(cwd), gitDir = null;
  for (;;) {
    const g = path.join(dir, '.git');
    try {
      const st = fs.statSync(g);
      if (st.isDirectory()) { gitDir = g; break; }
      if (st.isFile()) {                       // worktrees/submodules use a "gitdir: <path>" file
        const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (m) { gitDir = path.resolve(dir, m[1].trim()); break; }
      }
    } catch {}
    const up = path.dirname(dir);
    if (up === dir) return 0;
    dir = up;
  }
  // A linked worktree keeps its stash in the shared git directory.
  let common = gitDir;
  try {
    const c = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
    if (c) common = path.resolve(gitDir, c);
  } catch {}
  try {
    return fs.readFileSync(path.join(common, 'logs', 'refs', 'stash'), 'utf8')
             .split('\n').filter(Boolean).length;
  } catch { return 0; }   // no stash
}

function renderGit(s) {
  let name, color;
  if (s.branch === '(detached)') {
    name = `${G.detached} ${s.oid}`; color = C.magenta;
  } else {
    name = s.branch || s.oid || '?'; color = C.gray;
  }

  let track = '';
  if (s.branch !== '(detached)' && s.upstream) {
    if (!s.ab) { track = ` ${G.gone}`; color = C.magenta; }        // upstream is gone
    else if (s.ahead && s.behind) { track = ` ${G.ahead}${s.ahead}${G.behind}${s.behind}`; color = C.yellow; }
    else if (s.ahead) { track = ` ${G.ahead}${s.ahead}`; color = C.green; }
    else if (s.behind) { track = ` ${G.behind}${s.behind}`; color = C.red; }
    else { track = ` ${G.even}`; color = C.cyan; }
  }

  const counts = g =>
    ((CONFIG.alwaysShowZeros || g.a ? `+${g.a} ` : '') +
     (CONFIG.alwaysShowZeros || g.m ? `~${g.m} ` : '') +
     (CONFIG.alwaysShowZeros || g.d ? `-${g.d} ` : '')).trim();

  const idx = counts(s.idx), wt = counts(s.wt);
  const parts = [paint(`${name}${track}`, color)];
  if (idx) parts.push(paint(idx, C.green));
  if (idx && wt) parts.push(paint('|', C.gray));
  if (wt) parts.push(paint(wt, C.red));
  if (s.conflict) parts.push(paint(`!${s.conflict}`, C.magenta));
  if (!idx && !wt && !s.conflict) parts.push(paint(G.clean, C.green));
  if (s.stash) parts.push(paint(`$${s.stash}`, C.gray));

  return `${paint('[', C.yellow)}${parts.join(' ')}${paint(']', C.yellow)}`;
}

// ─────────────────────────── usage ───────────────────────────
const fmtDur = ms => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

/** 216549 → 217k, 1000000 → 1M */
const fmtTok = n => {
  if (n >= 1e6) { const v = n / 1e6; return (Number.isInteger(v) ? v : v.toFixed(1)) + 'M'; }
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
};

/** Time left until a resets_at (unix seconds) timestamp. */
const until = ts => {
  if (!ts) return null;
  const ms = ts * 1000 - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d${h % 24}h` : h ? `${h}h${m % 60}m` : `${m}m`;
};

const RATE_ORDER = ['five_hour', 'seven_day'];
const RATE_LABEL = { five_hour: '5h', seven_day: '7d' };
const CTX_LABEL = 'ctx';

// Row prefixes. Icons separate the rows by shape, so the rows stay
// distinguishable even when all three sit in the same threshold band and
// therefore share a color. Falls back to the text labels without them.
const ICON = { ctx: '🧠', five_hour: '⏳', seven_day: '📅', _default: '📊' };
// The distinguishing token leads, so a vertical stack is scannable down the
// left edge — "5h quota" reads faster than "Usage 5H" when three rows align.
const ROW_LABEL = { ctx: 'Context', five_hour: '5h quota', seven_day: '7d quota' };
const useIcons = () => CONFIG.rowIcons && UNI;

/** icon + spelled-out label, whichever of the two are enabled. */
function rowPrefix(key, fallback) {
  const parts = [];
  if (useIcons()) parts.push(ICON[key] || ICON._default);
  if (CONFIG.rowLabels) parts.push(ROW_LABEL[key] || fallback);
  return parts.length ? parts : [fallback];   // neither enabled: short label
}

// Codepoints with Emoji_Presentation, which terminals render two columns wide.
// padEnd counts them as one, so padding has to consult this instead.
const WIDE = [
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55], [0x1f300, 0x1faff],
];
const dispWidth = s => {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += WIDE.some(([lo, hi]) => c >= lo && c <= hi) ? 2 : 1;
  }
  return n;
};
const padTo = (s, w) => s + ' '.repeat(Math.max(0, w - dispWidth(s)));

/**
 * Every window under rate_limits, as {label, pct, reset}. Claude Code
 * currently sends only five_hour and seven_day, but any window added later
 * shows up automatically using its key as the label.
 */
function rateEntries(rl) {
  if (!rl) return [];
  const known = RATE_ORDER.filter(k => rl[k]);
  const extra = Object.keys(rl).filter(k => !RATE_ORDER.includes(k));
  return [...known, ...extra].map(k => {
    const w = rl[k];
    const p = w?.used_percentage;
    if (p == null) return null;
    const label = RATE_LABEL[k] ||
      k.replace(/^five_hour/, '5h').replace(/^seven_day/, '7d').replace(/_/g, ' ').trim();
    const prefix = rowPrefix(k, label).join(' ');
    return { key: k, label, prefix, pct: Math.round(p), reset: until(w.resets_at) };
  }).filter(Boolean);
}

/** "5h 14%" for the inline layout. */
function rateInline(e) {
  let seg = `${paint(e.label, C.gray)} ${paint(`${e.pct}%`, lv(e.pct, CONFIG.limits.rate))}`;
  if (CONFIG.showReset && e.reset) seg += ` ${paint(e.reset, C.gray)}`;
  return seg;
}

/** "⏳ ████░░░░ 14% (reset 9h25m)" — one bar row per window. */
function rateLine(e, prefixW) {
  let seg = `${paint(padTo(e.prefix, prefixW), C.gray)} ` +
            `${renderBar(e.pct, CONFIG.limits.rate, e.key)} ` +
            `${paint(`${e.pct}%`, lv(e.pct, CONFIG.limits.rate))}`;
  if (CONFIG.showReset && e.reset) seg += ` ${paint(`(reset ${e.reset})`, C.gray)}`;
  return seg;
}

/** "Opus 5 (1M context)" → "Opus 5" */
const shortModel = n => {
  const s = n || '?';
  return CONFIG.shortenModel ? s.replace(/\s*\([^)]*\)\s*$/, '') : s;
};

/** Renders both lines. Exported so tests can feed it fixtures. */
function render(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  const g = readGit(cwd);

  const head = [paint(`[${shortModel(d.model?.display_name)}]`, C.cyan)];
  if (CONFIG.showEffort && d.effort?.level) {
    head.push(paint(`${G.effort}${d.effort.level}`, C.yellow));
  }
  if (CONFIG.showThinking && d.thinking?.enabled) head.push(paint(G.think, C.yellow));
  if (CONFIG.showFastMode && d.fast_mode) head.push(paint(G.fast, C.magenta));
  head.push(`${G.dir}${path.basename(cwd)}`);
  if (g) head.push(renderGit(g));

  const rates = rateEntries(d.rate_limits);
  const stacked = CONFIG.rateLayout === 'lines' && rates.length > 0;
  const ctxPrefix = rowPrefix('ctx', CTX_LABEL).join(' ');
  // Line up the bars by padding every prefix to the widest one.
  const prefixW = stacked
    ? Math.max(dispWidth(ctxPrefix), ...rates.map(r => dispWidth(r.prefix)))
    : 0;

  const cw = d.context_window || {};
  const pct = Math.floor(cw.used_percentage || 0);   // may be null early on
  let ctx = stacked ? `${paint(padTo(ctxPrefix, prefixW), C.gray)} ` : '';
  ctx += `${renderBar(pct, CONFIG.limits.context, 'ctx')} ${paint(`${pct}%`, lv(pct, CONFIG.limits.context))}`;
  if (CONFIG.showTokens && cw.context_window_size) {
    // used_percentage is computed from input tokens, so total_input_tokens is
    // the number that agrees with it.
    ctx += ` ${paint(`${fmtTok(cw.total_input_tokens || 0)}/${fmtTok(cw.context_window_size)}`, C.gray)}`;
  }

  const cost = d.cost?.total_cost_usd || 0;
  const durMs = d.cost?.total_duration_ms || 0;

  const segs = [ctx];
  if (CONFIG.showCost) segs.push(paint(`$${cost.toFixed(2)}`, lv(cost, CONFIG.limits.cost)));
  if (CONFIG.showDuration) segs.push(paint(fmtDur(durMs), lv(Math.floor(durMs / 60000), CONFIG.limits.time)));
  if (!stacked) segs.push(...rates.map(rateInline));

  const lines = [head.join(' '), segs.join(` ${paint('|', C.gray)} `)];
  if (stacked) lines.push(...rates.map(e => rateLine(e, prefixW)));
  return lines;
}

module.exports = { render, renderBar, CONFIG, COLOR, GLYPH };

// Run as a status line command only when invoked directly, so `require()` in
// tests does not block waiting on stdin.
if (require.main === module) {
  let input = '';
  // setEncoding lets Node's StringDecoder hold partial UTF-8 sequences that
  // straddle a chunk boundary; concatenating raw Buffers would corrupt
  // non-ASCII paths.
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => (input += c));
  process.stdin.on('end', () => {
    if (CONFIG.debugDump) { try { fs.writeFileSync(CONFIG.debugDump, input); } catch {} }
    // Windows PowerShell prepends a BOM when piping to a native command, and
    // JSON.parse rejects it. Cheap to tolerate, impossible to debug from the
    // blank status line it would otherwise produce.
    for (const line of render(JSON.parse(input.replace(/^﻿/, '')))) console.log(line);
  });
}
