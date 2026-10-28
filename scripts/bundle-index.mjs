// EVEN Bundle Index sampler.
// Runs in GitHub Actions (Node 22, no dependencies, no API keys).
// Listens to new pump.fun launches for a few minutes, reads block 0 (the create slot)
// of each one through public Solana RPC, and writes a rolling 24h sample to data/index.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const RPCS = (process.env.RPCS || 'https://solana-rpc.publicnode.com,https://api.mainnet-beta.solana.com').split(',').map(s => s.trim()).filter(Boolean);
const COLLECT_MS = +(process.env.COLLECT_MS || 170000); // how long to listen for new launches
const MAX_SCANS = +(process.env.MAX_SCANS || 60);       // launches to read per run
const SETTLE_MS = 25000;                                 // wait this long after create before reading block 0
const WINDOW_MS = 864e5, MAX_ROWS = 1500, OUT = 'data/index.json';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- RPC with pacing and failover ---------- */
let rpcIndex = 0, lastCall = 0;
async function rpc(method, params, tries = 0) {
  const wait = Math.max(0, lastCall + 250 - Date.now()); lastCall = Date.now() + wait;
  if (wait) await sleep(wait);
  const url = RPCS[rpcIndex % RPCS.length];
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal });
    clearTimeout(to);
    if (r.status === 429 || r.status === 403 || r.status >= 500) throw Object.assign(new Error(`${url} ${r.status}`), { retry: true });
    const j = await r.json();
    if (j.error) {
      if (/rate|limit|busy|too many|unavailable/i.test(j.error.message || '') || j.error.code === -32005 || j.error.code === 429) throw Object.assign(new Error(j.error.message), { retry: true });
      throw new Error(j.error.message || 'rpc error');
    }
    return j.result;
  } catch (e) {
    if ((e.retry || e.name === 'AbortError' || e.name === 'TypeError') && tries < 4) { rpcIndex++; await sleep(800 * (tries + 1)); return rpc(method, params, tries + 1); }
    throw e;
  }
}

/* ---------- block 0 reader (same logic as the site) ---------- */
function parseTx(tx, mint) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const msg = tx.transaction.message, la = tx.meta.loadedAddresses || {};
  const keys = [...msg.accountKeys, ...(la.writable || []), ...(la.readonly || [])];
  const signers = new Set(keys.slice(0, msg.header.numRequiredSignatures));
  const tok = new Map(), post = new Map(); let dec = 6;
  for (const b of tx.meta.postTokenBalances || []) if (b.mint === mint && b.owner) post.set(b.owner, (post.get(b.owner) || 0n) + BigInt(b.uiTokenAmount.amount));
  const add = (arr, sign) => { for (const b of arr || []) if (b.mint === mint && b.owner) { dec = b.uiTokenAmount.decimals; tok.set(b.owner, (tok.get(b.owner) || 0n) + sign * BigInt(b.uiTokenAmount.amount)); } };
  add(tx.meta.preTokenBalances, -1n); add(tx.meta.postTokenBalances, 1n);
  // the bonding curve is the non-signing token owner that SOL flows into (Mayhem launches mint a second 1B to another owner)
  let curve = null, best = -Infinity, cbal = -1n; const deltas = [];
  for (const [o, d] of tok) {
    if (signers.has(o)) { if (d !== 0n) deltas.push([o, d]); continue; }
    const i = keys.indexOf(o); if (i < 0) continue;
    const lam = tx.meta.postBalances[i] - tx.meta.preBalances[i], p = post.get(o) || 0n;
    if (lam > best || (lam === best && p > cbal)) { best = lam; cbal = p; curve = o; }
  }
  const curveSol = curve ? Math.max(0, best) / 1e9 : 0;
  return { deltas, curveSol, dec };
}
async function scanBlock0(mint) {
  const sigs = await rpc('getSignaturesForAddress', [mint, { limit: 1000, commitment: 'confirmed' }]);
  if (!sigs || !sigs.length || sigs.length >= 1000) return null;
  const slot = sigs[sigs.length - 1].slot;
  const inSlot = sigs.filter(s => s.slot === slot && !s.err).reverse().slice(0, 24);
  const net = new Map(); let sol = 0, dec = 6;
  for (const s of inSlot) {
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    const p = parseTx(tx, mint); if (!p) continue;
    dec = p.dec;
    if (p.deltas.length) { sol += p.curveSol; for (const [o, d] of p.deltas) net.set(o, (net.get(o) || 0n) + d); }
  }
  const supply = 1_000_000_000 * 10 ** dec;
  const fr = [...net.values()].filter(d => d > 0n).map(d => Number(d) / supply).filter(f => f >= 2e-5).sort((a, b) => b - a);
  return { t: sigs[sigs.length - 1].blockTime ? sigs[sigs.length - 1].blockTime * 1000 : Date.now(), w: fr.length, pct: fr.reduce((a, b) => a + b, 0), sol: Math.max(0, sol), sh: fr.slice(0, 12) };
}

/* ---------- run ---------- */
const start = Date.now();
let existing = [], prevUpdated = 0;
try { const j = JSON.parse(await readFile(OUT, 'utf8')); if (Array.isArray(j.rows)) existing = j.rows; prevUpdated = j.updated || 0; } catch { /* first run */ }

const seen = [];        // { mint, sym, t }
const done = new Set(existing.map(r => r[1]));
const fresh = [];
let wsOpen = false;
const ws = new WebSocket('wss://pumpportal.fun/api/data');
ws.onopen = () => { wsOpen = true; ws.send(JSON.stringify({ method: 'subscribeNewToken' })); console.log('stream open'); };
ws.onmessage = m => {
  let d; try { d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString()); } catch { return; }
  if (d && d.txType === 'create' && d.mint && B58.test(d.mint) && (d.pool ? d.pool === 'pump' : /pump$/.test(d.mint)) && !done.has(d.mint)) seen.push({ mint: d.mint, sym: String(d.symbol || '').slice(0, 14), t: Date.now() });
};
ws.onerror = e => console.log('stream error', e.message || '');
ws.onclose = () => { wsOpen = false; console.log('stream closed'); };

let scans = 0, fails = 0;
while (scans < MAX_SCANS) {
  const listening = Date.now() - start < COLLECT_MS;
  const c = seen.find(s => !done.has(s.mint) && Date.now() - s.t >= SETTLE_MS);
  if (!c) {
    if (!listening && !seen.some(s => !done.has(s.mint))) break;
    if (!listening && Date.now() - start > COLLECT_MS + SETTLE_MS + 5000) break;
    await sleep(1000); continue;
  }
  done.add(c.mint);
  try {
    const r = await scanBlock0(c.mint);
    if (r) { fresh.push([r.t, c.mint, c.sym, r.w, Math.round(r.pct * 1e4), Math.round(r.sol * 1e3), r.sh.map(x => Math.round(x * 1e4))]); scans++; }
  } catch (e) { fails++; console.log('skip', c.mint, e.message); if (fails > 25) break; }
  // keep sampling spread out instead of reading every launch back to back
  if (Date.now() - start < COLLECT_MS) await sleep(1200);
}
try { ws.close(); } catch { }

const cut = Date.now() - WINDOW_MS;
const byMint = new Map();
for (const r of [...fresh, ...existing]) if (r[0] > cut && !byMint.has(r[1])) byMint.set(r[1], r);
const rows = [...byMint.values()].sort((a, b) => b[0] - a[0]).slice(0, MAX_ROWS);
const heavy = rows.filter(r => r[4] >= 2000).length;
await mkdir('data', { recursive: true });
await writeFile(OUT, JSON.stringify({ v: 1, updated: fresh.length ? Date.now() : prevUpdated, threshold: 0.2, rows }));
console.log(`read ${fresh.length} new launches (${fails} skipped), ${rows.length} in the 24h sample, Bundle Index ${rows.length ? (heavy / rows.length * 100).toFixed(1) : '—'}%`);
process.exit(0);
