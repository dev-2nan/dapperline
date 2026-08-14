#!/usr/bin/env node
/**
 * Renders dapperline against fixtures so formatting changes are visible
 * without waiting for real session state.
 *
 *   node test/render.js          coloured, as Claude Code would show it
 *   node test/render.js --plain  ANSI stripped, easier to eyeball/diff
 */

const { render } = require('../dapperline.js');

const plain = process.argv.includes('--plain');
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const now = Math.floor(Date.now() / 1000);

const base = {
  model: { display_name: 'Opus 5' },
  workspace: { current_dir: process.cwd() },
  cwd: process.cwd(),
  context_window: {
    used_percentage: 22,
    total_input_tokens: 216549,
    context_window_size: 1000000,
  },
  cost: { total_cost_usd: 3.2, total_duration_ms: 75 * 60000 },
  rate_limits: {
    five_hour: { used_percentage: 8, resets_at: now + 1560 },
    seven_day: { used_percentage: 58, resets_at: now + 256000 },
  },
  session_id: 'fixture',
};

const merge = (...o) => Object.assign({}, base, ...o);

const CASES = [
  ['default', {}],
  ['context: warning', { context_window: { ...base.context_window, used_percentage: 75 } }],
  ['context: danger', { context_window: { ...base.context_window, used_percentage: 95 } }],
  ['rate: danger', { rate_limits: { five_hour: { used_percentage: 92 }, seven_day: { used_percentage: 88 } } }],
  ['no rate limits', { rate_limits: undefined }],
  ['fresh session', { context_window: { used_percentage: null, context_window_size: 1000000, total_input_tokens: 0 } }],
  ['200k model', { context_window: { used_percentage: 45, total_input_tokens: 90000, context_window_size: 200000 } }],
  ['unknown rate window', {
    rate_limits: {
      ...base.rate_limits,
      seven_day_opus: { used_percentage: 12, resets_at: now + 300000 },
    },
  }],
];

let failed = 0;
for (const [name, over] of CASES) {
  process.stdout.write(`\n── ${name}\n`);
  try {
    for (const line of render(merge(over))) {
      console.log('   ' + (plain ? strip(line) : line));
    }
  } catch (e) {
    failed++;
    console.log(`   THREW: ${e.message}`);
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} fixtures rendered.`);
process.exit(failed ? 1 : 0);
