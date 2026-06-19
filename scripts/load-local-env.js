#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Load `.env.local` into process.env for opt-in harness scripts only.
// Never import from app runtime or bundle this into the mobile client.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

function parseEnvFile(contents) {
  const parsed = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadLocalEnv(projectRoot) {
  const envPath = path.join(projectRoot, '.env.local');
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return parseEnvFile(fs.readFileSync(envPath, 'utf8'));
}

function applyLocalEnv(projectRoot) {
  const vars = loadLocalEnv(projectRoot);
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return vars;
}

module.exports = {
  loadLocalEnv,
  applyLocalEnv,
};