#!/usr/bin/env node
/*
  mailprompt Klaviyo connector

  Lets mailprompt read your Klaviyo templates without putting your API key in
  a web page. It runs on your own computer, listens only on 127.0.0.1, and
  only reads templates.

  1. Create a Klaviyo private API key with the "Templates: Read" scope
     (Klaviyo > Settings > API keys > Create private API key).
  2. In this folder run:   node connector/klaviyo-connect.js
     (or set it ahead:     KLAVIYO_API_KEY=pk_... node connector/klaviyo-connect.js)
  3. In mailprompt type:   connect klaviyo <pairing code shown here>

  Needs Node 18 or newer. No npm install.
*/
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.MAILPROMPT_PORT || 8787);
const BASE = process.env.KLAVIYO_BASE || 'https://a.klaviyo.com';
const REVISION = process.env.KLAVIYO_REVISION || '2026-07-15';
const ORIGINS = (process.env.MAILPROMPT_ORIGINS || 'https://tony007digital.github.io,null,http://localhost:8000,http://127.0.0.1:8000').split(',').map((s) => s.trim());
const MAX_PAGES = 10;

if (typeof fetch !== 'function') {
  console.error('This connector needs Node 18 or newer (you have ' + process.version + ').');
  process.exit(1);
}

const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
const CODE = hex.slice(0, 4) + '-' + hex.slice(4);

function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { buf += d; if (buf.includes('\n')) { stdin.pause(); resolve(buf.split('\n')[0].trim()); } });
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(value.trim()); }
      else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(0); }
      else if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); }
      else { value += ch; }
    };
    stdin.on('data', onData);
  });
}

async function klaviyo(key, path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: 'Klaviyo-API-Key ' + key, revision: REVISION, accept: 'application/vnd.api+json' }
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const detail = json && json.errors && json.errors[0] ? (json.errors[0].detail || json.errors[0].title) : text.slice(0, 200);
    const err = new Error('Klaviyo said ' + res.status + ': ' + detail);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function listTemplates(key) {
  const out = [];
  let path = '/api/templates?fields[template]=name,editor_type,created,updated';
  for (let page = 0; path && page < MAX_PAGES; page++) {
    let json;
    try { json = await klaviyo(key, path); }
    catch (e) {
      // Older revisions may not accept sparse fields; retry plain once.
      if (page === 0 && e.status === 400) { path = '/api/templates'; json = await klaviyo(key, path); }
      else throw e;
    }
    (json.data || []).forEach((t) => {
      const a = t.attributes || {};
      out.push({ id: t.id, name: a.name || '(untitled)', editor_type: a.editor_type || '', updated: a.updated || a.created || null });
    });
    const next = json.links && json.links.next;
    path = next ? next.replace(BASE, '') : null;
  }
  out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  return out;
}

async function getTemplate(key, id) {
  const json = await klaviyo(key, '/api/templates/' + encodeURIComponent(id));
  const a = (json.data && json.data.attributes) || {};
  return { id: json.data && json.data.id, name: a.name || '', editor_type: a.editor_type || '', html: a.html || '', text: a.text || '' };
}

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function start(key) {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const allowed = ORIGINS.includes(origin) ? origin : '';

    if (req.method === 'OPTIONS') {
      if (!allowed) { res.writeHead(403); return res.end(); }
      res.writeHead(204, {
        'access-control-allow-origin': allowed,
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'x-mailprompt-code',
        'access-control-allow-private-network': 'true',
        'access-control-max-age': '600',
        vary: 'Origin'
      });
      return res.end();
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Read-only connector.' }, allowed);
    if (origin && !allowed) return send(res, 403, { error: 'Origin not allowed: ' + origin + '. Add it with MAILPROMPT_ORIGINS.' });
    if (req.headers['x-mailprompt-code'] !== CODE) return send(res, 401, { error: 'Wrong or missing pairing code.' }, allowed);

    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true, connector: 'klaviyo' }, allowed);
      if (url.pathname === '/klaviyo/templates') {
        const templates = await listTemplates(key);
        console.log('  listed ' + templates.length + ' templates');
        return send(res, 200, { templates }, allowed);
      }
      const m = url.pathname.match(/^\/klaviyo\/templates\/([^/]+)$/);
      if (m) {
        const t = await getTemplate(key, decodeURIComponent(m[1]));
        console.log('  sent "' + t.name + '" (' + Math.round(t.html.length / 1024) + 'KB)');
        return send(res, 200, t, allowed);
      }
      return send(res, 404, { error: 'Not found.' }, allowed);
    } catch (e) {
      console.log('  error: ' + e.message);
      const status = e.status === 401 || e.status === 403 ? 502 : 500;
      const hint = e.status === 401 ? ' Check the API key.' : e.status === 403 ? ' The key needs the Templates: Read scope.' : '';
      return send(res, status, { error: e.message + hint }, allowed);
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error('Port ' + PORT + ' is busy. Is the connector already running? Or set MAILPROMPT_PORT.');
    else console.error(e.message);
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  mailprompt Klaviyo connector is running on http://127.0.0.1:' + PORT);
    console.log('');
    console.log('  Pairing code:  ' + CODE);
    console.log('');
    console.log('  In mailprompt, type:  connect klaviyo ' + CODE);
    console.log('  Then:                 klaviyo templates');
    console.log('');
    console.log('  Read-only. Your key stays in this terminal. Press Ctrl+C to stop.');
    console.log('');
  });
}

(async () => {
  let key = (process.env.KLAVIYO_API_KEY || '').trim();
  if (!key) key = await askHidden('Paste your Klaviyo private API key (starts with pk_, hidden): ');
  if (!/^pk_[A-Za-z0-9]+/.test(key)) {
    console.error('That doesn\'t look like a Klaviyo private key (they start with pk_).');
    process.exit(1);
  }
  start(key);
})();
