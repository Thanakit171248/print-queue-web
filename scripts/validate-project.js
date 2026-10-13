#!/usr/bin/env node
'use strict';

/* Lightweight checks that need only Node.js (no npm dependencies). */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const failures = [];
const warnings = [];
const passes = [];

function walk(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(absolute));
    else found.push(absolute);
  }
  return found;
}
function ok(message) { passes.push(message); }
function warn(message) { warnings.push(message); }
function fail(message) { failures.push(message); }

const jsFiles = [...walk(path.join(root, 'assets', 'js')), ...walk(path.join(root, 'api'))]
  .filter(file => file.endsWith('.js')).sort();
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) fail(`JavaScript syntax: ${path.relative(root, file)}\n${result.stderr || result.stdout}`);
}
if (!failures.length) ok(`JavaScript syntax passes (${jsFiles.length} files)`);

let vercel;
try {
  vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  ok('vercel.json parses as JSON');
} catch (error) { fail(`vercel.json: ${error.message}`); }

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
if (scriptSrcs.at(-1) === 'assets/js/22-secure-rpc-bridge.js') ok('Secure RPC bridge is the last external script in index.html');
else fail(`Secure RPC bridge must be last external script (last found: ${scriptSrcs.at(-1) || 'none'})`);

const localRefs = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(value => value && !/^(?:https?:|data:|blob:|mailto:|tel:|javascript:|#)/i.test(value));
const missing = [];
for (const ref of localRefs) {
  // Browser-root paths like /assets/... map to the deployment root directory.
  const rel = ref.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  if (!rel || rel.startsWith('api/')) continue; // API endpoints are generated functions, not static files.
  if (!fs.existsSync(path.join(root, rel))) missing.push(rel);
}
const uniqueMissing = [...new Set(missing)];
if (uniqueMissing.length) warn(`Missing local assets referenced in index.html: ${uniqueMissing.join(', ')}`);
else ok('All local src/href assets referenced by index.html exist');

const bridge = fs.readFileSync(path.join(root, 'assets', 'js', '22-secure-rpc-bridge.js'), 'utf8');
const requiredRpcs = [
  'pd_create_topup_v2', 'pd_create_pending_topup_v2', 'pd_admin_review_topup_v2',
  'pd_create_print_order_v2', 'pd_admin_set_user_role_v2',
  'pd_update_order_status_v2', 'pd_update_delivery_v2'
];
for (const rpc of requiredRpcs) {
  if (!bridge.includes(`'${rpc}'`)) fail(`Secure RPC bridge does not call ${rpc}`);
}
if (requiredRpcs.every(rpc => bridge.includes(`'${rpc}'`))) ok(`Secure RPC calls found (${requiredRpcs.length})`);
if (bridge.includes('p_manual_verification_id: verification.manualReviewToken') && bridge.includes('result?.manualReviewToken')) ok('Manual top-up fallback requires the server-issued single-use verification token');
else fail('Manual top-up fallback must pass the server-issued manual verification token');

const directFinancialWrite = /\.from\(['"](?:topups|wallets|wallet_transactions|orders|payments|print_jobs)['"]\)\s*\.(?:insert|upsert|update|delete)\s*\(/;
if (directFinancialWrite.test(bridge)) fail('Secure RPC bridge includes a direct write to a financial/order table');
else ok('Secure bridge contains no direct insert/update/delete for financial/order tables');

const v2Api = fs.readFileSync(path.join(root, 'api', 'verify-slip-v2.js'), 'utf8');
const exportPosition = v2Api.lastIndexOf('module.exports = async function handler');
const configPosition = v2Api.lastIndexOf('module.exports.config = { api: { bodyParser: false, maxDuration: 30 } }');
if (exportPosition >= 0 && configPosition > exportPosition) ok('Vercel multipart config is attached after API handler export');
else fail('verify-slip-v2 must attach its raw multipart config after exporting the handler');
if (v2Api.includes('async function issueManualReviewCapability') && v2Api.includes('manualReviewToken: record.id') && v2Api.includes('manual_review: true')) ok('API issues a server-side single-use manual-review capability');
else fail('API missing server-issued manual-review capability');

const migration = fs.readFileSync(path.join(root, 'database', '20261013_secure_rpc_topups_and_orders.sql'), 'utf8');
if (/\bbegin;[\s\S]*\bcommit;\s*$/i.test(migration.trim())) ok('Secure RPC migration is transaction-wrapped');
else fail('Secure RPC migration must be wrapped in BEGIN/COMMIT');
for (const functionName of requiredRpcs.slice(0, 4)) {
  if (!migration.includes(functionName)) fail(`Migration missing expected function: ${functionName}`);
}

for (const line of passes) console.log(`PASS  ${line}`);
for (const line of warnings) console.log(`WARN  ${line}`);
for (const line of failures) console.error(`FAIL  ${line}`);
console.log(`\nSummary: ${passes.length} pass, ${warnings.length} warning, ${failures.length} failure.`);
process.exitCode = failures.length ? 1 : 0;
