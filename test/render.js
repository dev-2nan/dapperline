#!/usr/bin/env node
/**
 * Renders dapperline against fixtures so formatting changes are visible
 * without waiting for real session state, and exercises the terminal
 * capability fallbacks by re-running the script under different environments.
 *
 *   node test/render.js          coloured, as Claude Code would show it
 *   node test/render.js --plain  ANSI stripped, easier to eyeball/diff
 */

const { execFileSync } = require('child_process');
const path = require('path');
const { render, CONFIG, COLOR, GLYPH } = require('../dapperline.js');
const pkg = require('../package.json');

const plain = process.argv.includes('--plain');
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const show = s => (plain ? strip(s) : s);
const now = Math.floor(Date.now() / 1000);
const SCRIPT = path.join(__dirname, '..', 'dapperline.js');

const base = {
  model: { display_name: 'Opus 5 (1M context)' },
  workspace: { current_dir: process.cwd() },
  cwd: process.cwd(),
  context_window: {
    used_percentage: 22,
    total_input_tokens: 216549,
    context_window_size: 1000000,
  },
  cost: { total_cost_usd: 3.2, total_duration_ms: 75 * 60000 },
  effort: { level: 'xhigh' },
  thinking: { enabled: true },
  fast_mode: false,
  rate_limits: {
    five_hour: { used_percentage: 8, resets_at: now + 1560 },
    seven_day: { used_percentage: 58, resets_at: now + 256000 },
  },
  session_id: 'fixture',
};

const merge = (...o) => Object.assign({}, base, ...o);
const ctx = (used, extra = {}) => ({
  context_window: { ...base.context_window, used_percentage: used, ...extra },
});

const CASES = [
  ['default', {}],
  ['context 5% (ok band)', ctx(5)],
  ['context 65% (near warn)', ctx(65)],
  ['context 75% (warn band)', ctx(75)],
  ['context 95% (danger band)', ctx(95)],
  ['context 100% (full)', ctx(100)],
  ['fresh session (null pct)', ctx(null, { total_input_tokens: 0 })],
  ['200k model', ctx(45, { total_input_tokens: 90000, context_window_size: 200000 })],
  ['fast mode on', { fast_mode: true }],
  ['no effort / no thinking', { effort: undefined, thinking: undefined }],
  ['rate limits absent', { rate_limits: undefined }],
  ['unknown rate window', {
    rate_limits: { ...base.rate_limits, seven_day_opus: { used_percentage: 12 } },
  }],
];

let failed = 0;
console.log(`env: color=${COLOR}  glyphs=${GLYPH}`);

for (const [name, over] of CASES) {
  process.stdout.write(`\n── ${name}\n`);
  try {
    for (const line of render(merge(over))) console.log('   ' + show(line));
  } catch (e) {
    failed++;
    console.log(`   THREW: ${e.message}`);
  }
}

// ── rate-limit layouts ───────────────────────────────────────────────────
console.log('\n\n═══ rateLayout ═══');
const originalLayout = CONFIG.rateLayout;
for (const layout of ['lines', 'inline']) {
  CONFIG.rateLayout = layout;
  process.stdout.write(`\n── ${layout}\n`);
  try {
    for (const line of render(merge())) console.log('   ' + show(line));
  } catch (e) {
    failed++;
    console.log(`   THREW: ${e.message}`);
  }
}
CONFIG.rateLayout = originalLayout;

// ── terminal capability fallbacks ────────────────────────────────────────
// COLOR/GLYPH are resolved from the environment at load time, so each mode
// needs its own process.
const ENVS = [
  ['truecolor (WT/iTerm)', { COLORTERM: 'truecolor' }],
  ['256 color (macOS Terminal.app)', { TERM: 'xterm-256color' }],
  ['16 color (bare TERM)', { TERM: 'xterm' }],
  ['NO_COLOR', { NO_COLOR: '1' }],
  ['dumb terminal (ascii)', { TERM: 'dumb' }],
];

console.log('\n\n═══ terminal fallbacks (context 75%) ═══');
const payload = JSON.stringify(merge(ctx(75)));

for (const [name, vars] of ENVS) {
  // Strip inherited signals so each case starts from a known state.
  const env = { ...process.env };
  delete env.COLORTERM; delete env.WT_SESSION; delete env.TERM_PROGRAM;
  delete env.TERM; delete env.NO_COLOR;
  Object.assign(env, vars);

  process.stdout.write(`\n── ${name}\n`);
  try {
    const out = execFileSync(process.execPath, [SCRIPT], { input: payload, env, encoding: 'utf8' });
    for (const line of out.split('\n').filter(Boolean)) console.log('   ' + show(line));
  } catch (e) {
    failed++;
    console.log(`   THREW: ${e.message}`);
  }
}

// The runtime constant and package.json both carry the version; catch drift
// here rather than shipping a build that misreports itself.
console.log('\n\n═══ version ═══');
const reported = execFileSync(process.execPath, [SCRIPT, '--version'], { encoding: 'utf8' }).trim();
if (reported.startsWith(`dapperline ${pkg.version}`)) {
  console.log(`   ${reported}  matches package.json`);
} else {
  failed++;
  console.log(`   ${reported}  DOES NOT match package.json ${pkg.version}`);
}

const total = CASES.length + ENVS.length + 3;   // + two rateLayout checks + version
console.log(`\n${total - failed}/${total} checks rendered.`);
process.exit(failed ? 1 : 0);
