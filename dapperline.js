#!/usr/bin/env node
/**
 * dapperline — a posh-git style status line for Claude Code.
 *
 *   [Opus 5] ⚡xhigh 💡 📁 repo [main ↑1 +1 ~1 -1 | +1 ~1 -1 !2 $3]
 *   ██████░░░░ 22% 217k/1M | 5h 8% | 7d 58%
 *
 * Line 1  model · reasoning effort · directory · git status (posh-git format)
 * Line 2  context window and rate-limit usage, colored by threshold
 *
 * The usage bars are gradient-filled along the *threshold* axis, so the point
 * where the color changes is the warning or danger line itself. Unfilled cells
 * keep a dimmed version of their band color, which means the thresholds stay
 * visible even before you reach them.
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
  barWidth:        10,     // cells per usage bar
  showTokens:      true,   // token counts next to the context percentage (217k/1M)
  showReset:       false,  // time until each rate-limit window resets
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

/**
 * Renders the usage bar. With 24-bit color each cell is tinted by the
 * percentage it represents, so the warning and danger lines are visible as
 * color changes; unfilled cells keep a dimmed tint of the same band. Without
 * truecolor the whole bar falls back to one flat level color.
 */
function renderBar(pct, t) {
  const w = CONFIG.barWidth;
  const filled = Math.max(0, Math.min(w, Math.floor((pct / 100) * w)));

  if (COLOR !== 'truecolor') {
    const flat = lv(pct, t);
    return paint(G.full.repeat(filled) + G.empty.repeat(w - filled), flat);
  }

  let out = '';
  for (let i = 0; i < w; i++) {
    const cellPct = ((i + 0.5) / w) * 100;   // the value this cell stands for
    const rgb = bandColor(cellPct, t);
    out += i < filled ? fg(rgb) + G.full : fg(dim(rgb)) + G.empty;
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

/**
 * Renders every window under rate_limits. Claude Code currently sends only
 * five_hour and seven_day, but any window added later shows up automatically
 * using its key as the label.
 */
function renderRates(rl) {
  if (!rl) return [];
  const known = RATE_ORDER.filter(k => rl[k]);
  const extra = Object.keys(rl).filter(k => !RATE_ORDER.includes(k));
  return [...known, ...extra].map(k => {
    const w = rl[k];
    const p = w?.used_percentage;
    if (p == null) return null;
    const label = RATE_LABEL[k] ||
      k.replace(/^five_hour/, '5h').replace(/^seven_day/, '7d').replace(/_/g, ' ').trim();
    let seg = `${paint(label, C.gray)} ${paint(`${Math.round(p)}%`, lv(p, CONFIG.limits.rate))}`;
    if (CONFIG.showReset) {
      const left = until(w.resets_at);
      if (left) seg += ` ${paint(left, C.gray)}`;
    }
    return seg;
  }).filter(Boolean);
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

  const cw = d.context_window || {};
  const pct = Math.floor(cw.used_percentage || 0);   // may be null early on
  let ctx = `${renderBar(pct, CONFIG.limits.context)} ${paint(`${pct}%`, lv(pct, CONFIG.limits.context))}`;
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
  segs.push(...renderRates(d.rate_limits));

  return [head.join(' '), segs.join(` ${paint('|', C.gray)} `)];
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
    for (const line of render(JSON.parse(input))) console.log(line);
  });
}
