#!/usr/bin/env node
/**
 * Reads the last run from booking-cron.log and publishes a summary table
 * to a Confluence page via the REST API.
 *
 * Required env vars (add to .env or export before calling):
 *   CONFLUENCE_URL       e.g. https://yourteam.atlassian.net/wiki  (no trailing slash)
 *   CONFLUENCE_EMAIL     your Atlassian account email (Cloud) or username (Server)
 *   CONFLUENCE_TOKEN     API token (Cloud) or password (Server)
 *   CONFLUENCE_PAGE_ID   numeric page ID — find it in the page URL: ?pageId=XXXXXX
 *
 * Usage:
 *   node publish-confluence.js [--log path/to/booking-cron.log]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

// Load .env manually (no dotenv dep needed for a simple script)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
}

const CONFLUENCE_URL    = process.env.CONFLUENCE_URL;
const CONFLUENCE_EMAIL  = process.env.CONFLUENCE_EMAIL;
const CONFLUENCE_TOKEN  = process.env.CONFLUENCE_TOKEN;
const CONFLUENCE_PAGE_ID = process.env.CONFLUENCE_PAGE_ID;

if (!CONFLUENCE_URL || !CONFLUENCE_EMAIL || !CONFLUENCE_TOKEN || !CONFLUENCE_PAGE_ID) {
  console.error('Missing required env vars: CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_TOKEN, CONFLUENCE_PAGE_ID');
  process.exit(1);
}

const logArg = process.argv.indexOf('--log');
const LOG_FILE = logArg !== -1 ? process.argv[logArg + 1] : path.join(__dirname, 'booking-cron.log');

// ── Parse last run from log ───────────────────────────────────────────────────

function parseLastRun(logContent) {
  const runs = logContent.split('========================================').filter(Boolean);
  const last = runs[runs.length - 1] ?? '';

  const runStart  = last.match(/Run start:\s*(.+)/)?.[1]?.trim()  ?? 'unknown';
  const runEnd    = last.match(/Run end:\s*(.+)/)?.[1]?.trim()    ?? 'unknown';
  const success   = /SUCCESS on attempt/.test(last);
  const successAt = last.match(/SUCCESS on attempt (\d+) at (.+)/);

  // Collect all "No badminton slots" errors
  const slotErrors = [...last.matchAll(/No badminton slots available at any location for (.+?) \((.+?)\)/g)]
    .map(m => `${m[1]} (${m[2]})`);

  // Navigation failures
  const navErrors = [...last.matchAll(/Navigation failed for (.+?):/g)]
    .map(m => m[1]);

  // Attempt count
  const attempts = (last.match(/--- Attempt \d+ of \d+/g) ?? []).length;

  // Extract monocart summary table if present
  const monocartLines = [];
  const tableMatch = last.match(/┌[\s\S]+?└[^\n]+/);
  if (tableMatch) monocartLines.push(tableMatch[0]);

  return {
    runStart,
    runEnd,
    success,
    successAttempt: successAt ? parseInt(successAt[1]) : null,
    attempts,
    slotErrors,
    navErrors,
    monocartTable: monocartLines[0] ?? null,
  };
}

// ── Build Confluence storage-format HTML ──────────────────────────────────────

function statusBadge(success) {
  return success
    ? '<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">PASSED</ac:parameter></ac:structured-macro>'
    : '<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Red</ac:parameter><ac:parameter ac:name="title">FAILED</ac:parameter></ac:structured-macro>';
}

function buildPageBody(run) {
  const rows = [
    ['Status',    statusBadge(run.success)],
    ['Run start', run.runStart],
    ['Run end',   run.runEnd],
    ['Attempts',  String(run.attempts)],
  ];
  if (run.successAttempt) rows.push(['Succeeded on attempt', String(run.successAttempt)]);
  if (run.slotErrors.length) rows.push(['Slot errors', run.slotErrors.join('<br/>')]);
  if (run.navErrors.length)  rows.push(['Navigation errors', [...new Set(run.navErrors)].join('<br/>')]);

  const tableRows = rows.map(([k, v]) =>
    `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`
  ).join('\n');

  const codeBlock = run.monocartTable
    ? `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">text</ac:parameter><ac:plain-text-body><![CDATA[${run.monocartTable}]]></ac:plain-text-body></ac:structured-macro>`
    : '';

  return `
<h2>Badminton Booking – Last Run Summary</h2>
<table>
  <tbody>
    ${tableRows}
  </tbody>
</table>
${codeBlock}
<p><em>Updated automatically by booking cron at ${new Date().toISOString()}</em></p>
`.trim();
}

// ── Confluence REST API calls ─────────────────────────────────────────────────

const AUTH = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_TOKEN}`).toString('base64');
const HEADERS = {
  'Authorization': `Basic ${AUTH}`,
  'Content-Type':  'application/json',
  'Accept':        'application/json',
};

async function getPage() {
  const res = await fetch(`${CONFLUENCE_URL}/rest/api/content/${CONFLUENCE_PAGE_ID}?expand=version,title`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`GET page failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function updatePage(pageId, title, version, body) {
  const res = await fetch(`${CONFLUENCE_URL}/rest/api/content/${pageId}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      version: { number: version + 1 },
      title,
      type: 'page',
      body: {
        storage: {
          value: body,
          representation: 'storage',
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`PUT page failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    process.exit(1);
  }

  const logContent = fs.readFileSync(LOG_FILE, 'utf8');
  const run        = parseLastRun(logContent);
  const body       = buildPageBody(run);

  console.log(`Publishing to Confluence page ${CONFLUENCE_PAGE_ID}…`);
  const page    = await getPage();
  const updated = await updatePage(page.id, page.title, page.version.number, body);
  console.log(`Done — page updated: ${CONFLUENCE_URL}/wiki/spaces/_/pages/${updated.id}`);
}

main().catch(err => {
  console.error('publish-confluence.js failed:', err.message);
  process.exit(1);
});
