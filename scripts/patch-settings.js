#!/usr/bin/env node
/**
 * Points Claude Code's statusLine at a dapperline install.
 *
 *   node scripts/patch-settings.js /path/to/dapperline.js
 *
 * Merges into ~/.claude/settings.json, keeping every other key, and backs the
 * file up first. Used by install.sh and install.ps1 so both platforms share one
 * implementation and neither needs jq — node is already required to run
 * dapperline at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const target = process.argv[2];
if (!target) {
  console.error('usage: node patch-settings.js <path to dapperline.js>');
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error(`not found: ${target}`);
  process.exit(1);
}

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');

// Keep the command portable: a path under $HOME becomes ~/... so the same
// settings.json works on every machine. Forward slashes throughout, because
// Claude Code runs the command through Git Bash on Windows, where a backslash
// is an escape character and the command fails silently.
const abs = path.resolve(target);
const home = os.homedir();
const rel = abs.startsWith(home + path.sep)
  ? '~/' + abs.slice(home.length + 1).split(path.sep).join('/')
  : abs.split(path.sep).join('/');

let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      console.error(`${settingsPath} is not valid JSON — fix it before installing.`);
      console.error(`  ${e.message}`);
      process.exit(1);
    }
  }
  const backup = `${settingsPath}.backup-${new Date().toISOString().slice(0, 10)}`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`  backed up  ${backup}`);
} else {
  fs.mkdirSync(claudeDir, { recursive: true });
}

const previous = settings.statusLine?.command;
settings.statusLine = { type: 'command', command: `node ${rel}` };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.log(`  settings   ${settingsPath}`);
console.log(`  statusLine node ${rel}`);
if (previous && previous !== `node ${rel}`) {
  console.log(`  replaced   ${previous}`);
}

// A user-level settings.local.json is silently ignored: Claude Code only reads
// settings.local.json from a repository root. Worth flagging, because a
// statusLine parked there looks configured and never runs.
const stray = path.join(claudeDir, 'settings.local.json');
if (fs.existsSync(stray)) {
  console.log('');
  console.log(`  ! ${stray} exists but Claude Code does not read it`);
  console.log('    (settings.local.json is a repository-root file, not a user-level one)');
  console.log('    Move anything you need from it into settings.json.');
}
