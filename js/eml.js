/* mailprompt .eml reader.
   Reads a raw message (File > Save As / Download original / Show original in
   most clients), checks the headers inbox providers care about, and pulls out
   the HTML part so the template checks can run on it. Runs in your browser. */
(function (MP) {
  'use strict';

  function splitOnce(text) {
    var m = text.match(/\r?\n\r?\n/);
    if (!m) return [text, ''];
    return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
  }

  function parseHeaders(block) {
    var lines = block.split(/\r?\n/), out = [];
    lines.forEach(function (l) {
      if (/^[ \t]/.test(l) && out.length) out[out.length - 1][1] += ' ' + l.trim();
      else {
        var i = l.indexOf(':');
        if (i > 0) out.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]);
      }
    });
    return {
      list: out,
      get: function (n) { n = n.toLowerCase(); var h = out.filter(function (x) { return x[0].toLowerCase() === n; })[0]; return h ? h[1] : null; },
      all: function (n) { n = n.toLowerCase(); return out.filter(function (x) { return x[0].toLowerCase() === n; }).map(function (x) { return x[1]; }); }
    };
  }

  function bytesFromBinary(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  function decodeBytes(bytes, charset) {
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }
  function qp(s, charset) {
    s = s.replace(/=\r?\n/g, '');
    var bin = s.replace(/=([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
    // Keep non-ASCII chars already present as UTF-8 by encoding them back.
    var out = [];
    for (var i = 0; i < bin.length; i++) {
      var c = bin.charCodeAt(i);
      if (c < 256) out.push(c);
      else { var enc = new TextEncoder().encode(bin[i]); for (var j = 0; j < enc.length; j++) out.push(enc[j]); }
    }
    return decodeBytes(new Uint8Array(out), charset);
  }
  function b64(s, charset) {
    try { return decodeBytes(bytesFromBinary(atob(s.replace(/\s+/g, ''))), charset); } catch (e) { return ''; }
  }

  function decodeWords(v) {
    return String(v || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, function (_, cs, enc, text) {
      if (enc.toUpperCase() === 'B') return b64(text, cs);
      return qp(text.replace(/_/g, ' '), cs);
    }).replace(/\?=\s+=\?/g, '');
  }

  function param(v, name) {
    var m = String(v || '').match(new RegExp(name + '\\s*=\\s*"?([^";]+)"?', 'i'));
    return m ? m[1] : null;
  }

  function walk(headers, body, parts) {
    var ct = headers.get('content-type') || 'text/plain';
    var type = ct.split(';')[0].trim().toLowerCase();
    if (/^multipart\//.test(type)) {
      var boundary = param(ct, 'boundary');
      if (!boundary) return;
      var chunks = body.split(new RegExp('\\r?\\n?--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?\\s*\\r?\\n?'));
      chunks.forEach(function (c) {
        if (!c.trim()) return;
        var s = splitOnce(c);
        walk(parseHeaders(s[0]), s[1], parts);
      });
      return;
    }
    var cte = (headers.get('content-transfer-encoding') || '').toLowerCase();
    var charset = param(ct, 'charset') || 'utf-8';
    var text = cte === 'base64' ? b64(body, charset) : cte === 'quoted-printable' ? qp(body, charset) : body;
    parts.push({ type: type, charset: charset, text: text, size: body.length });
  }

  function addr(v) {
    v = decodeWords(v || '');
    var m = v.match(/<([^>]+)>/);
    var email = (m ? m[1] : v).trim().toLowerCase();
    var name = m ? v.slice(0, m.index).replace(/["']/g, '').trim() : '';
    return { name: name, email: email, domain: (email.split('@')[1] || '').replace(/[>\s]/g, '') };
  }
  function org(d) { var p = String(d || '').toLowerCase().split('.'); return p.length > 2 ? p.slice(-2).join('.') : p.join('.'); }

  function parse(raw) {
    raw = String(raw || '').replace(/^﻿/, '');
    var s = splitOnce(raw);
    var h = parseHeaders(s[0]);
    if (!h.get('from') && !h.get('received') && !h.get('subject')) throw new Error('This doesn\'t look like an email file. Save the message as .eml (or "Show original" and copy it).');
    var parts = [];
    walk(h, s[1], parts);
    var html = parts.filter(function (p) { return p.type === 'text/html'; })[0];
    var text = parts.filter(function (p) { return p.type === 'text/plain'; })[0];
    var from = addr(h.get('from'));
    var rp = addr(h.get('return-path') || '');
    var dkim = h.all('dkim-signature').map(function (v) {
      return { d: (param(v, 'd') || '').toLowerCase(), s: param(v, 's') || '', a: param(v, 'a') || '' };
    });
    var auth = h.all('authentication-results').join(' ; ');
    function res(name) { var m = auth.match(new RegExp('\\b' + name + '=(\\w+)', 'i')); return m ? m[1].toLowerCase() : null; }
    var lu = h.get('list-unsubscribe');
    var lup = h.get('list-unsubscribe-post');

    var checks = [];
    // One-click unsubscribe (Gmail and Yahoo bulk sender rules, RFC 8058)
    if (lu && /<https:/i.test(lu) && lup && /List-Unsubscribe=One-Click/i.test(lup)) checks.push({ level: 'ok', name: 'One-click unsubscribe', text: 'List-Unsubscribe with https and List-Unsubscribe-Post: One-Click.' });
    else if (lu) checks.push({ level: 'check', name: 'One-click unsubscribe', text: lup ? 'List-Unsubscribe has no https URL.' : 'List-Unsubscribe is set but List-Unsubscribe-Post: List-Unsubscribe=One-Click is missing. Gmail and Yahoo require one-click for bulk mail.' });
    else checks.push({ level: 'fix', name: 'One-click unsubscribe', text: 'No List-Unsubscribe header. Gmail and Yahoo require one-click unsubscribe for bulk mail.' });

    // DKIM alignment
    if (!dkim.length) checks.push({ level: 'fix', name: 'DKIM', text: 'Not signed. No DKIM-Signature header.' });
    else {
      var aligned = dkim.filter(function (k) { return org(k.d) === org(from.domain); });
      if (aligned.length) checks.push({ level: 'ok', name: 'DKIM', text: 'Signed by ' + aligned[0].d + ' (selector ' + aligned[0].s + '), aligned with the From domain.' });
      else checks.push({ level: 'check', name: 'DKIM', text: 'Signed by ' + dkim.map(function (k) { return k.d; }).join(', ') + ', not ' + from.domain + '. DMARC can\'t pass on DKIM. Set up custom DKIM for your domain.' });
    }

    // SPF alignment via Return-Path
    if (rp.domain) {
      if (org(rp.domain) === org(from.domain)) checks.push({ level: 'ok', name: 'SPF alignment', text: 'Return-Path ' + rp.domain + ' matches the From domain.' });
      else checks.push({ level: 'note', name: 'SPF alignment', text: 'Return-Path is ' + rp.domain + ', so SPF won\'t align with ' + from.domain + '. Fine if DKIM aligns. Otherwise set a custom bounce domain.' });
    }

    // Results the receiving server recorded, if this is a received copy.
    if (auth) {
      ['spf', 'dkim', 'dmarc'].forEach(function (k) {
        var r = res(k);
        if (r) checks.push({ level: r === 'pass' ? 'ok' : r === 'none' || r === 'neutral' ? 'check' : 'fix', name: k.toUpperCase() + ' result', text: k.toUpperCase() + '=' + r + ' according to the receiving server.' });
      });
    }

    if (!text) checks.push({ level: 'note', name: 'Plain-text part', text: 'No text/plain part. Some filters and clients prefer multipart/alternative with a text version.' });
    else checks.push({ level: 'ok', name: 'Plain-text part', text: 'Has a text/plain part.' });
    if (!html) checks.push({ level: 'note', name: 'HTML part', text: 'No text/html part.' });

    var subject = decodeWords(h.get('subject') || '');
    if (subject.length > 70) checks.push({ level: 'note', name: 'Subject length', text: subject.length + ' characters. Mobile inboxes show about 35 to 50.' });
    if (!from.name) checks.push({ level: 'note', name: 'From name', text: 'No display name in From. The inbox shows the bare address.' });
    if (!h.get('message-id')) checks.push({ level: 'check', name: 'Message-ID', text: 'No Message-ID header. Some receivers treat this as suspicious.' });

    return {
      subject: subject, from: from, returnPath: rp, to: addr(h.get('to') || ''), date: h.get('date'),
      messageId: h.get('message-id'), listUnsub: lu, listUnsubPost: lup, feedbackId: h.get('feedback-id'),
      dkim: dkim, auth: auth, html: html ? html.text : null, text: text ? text.text : null,
      received: h.all('received').length, checks: checks, headers: h.list
    };
  }

  function looksLikeEml(text) {
    var head = String(text).replace(/^﻿/, '').slice(0, 4000);
    return /^[A-Za-z][\w-]*:[ \t]/.test(head) && /^(From|Subject|Received|Message-ID|MIME-Version):/im.test(head) && /\r?\n\r?\n/.test(text);
  }

  MP.eml = { parse: parse, looksLikeEml: looksLikeEml };
})(window.MP = window.MP || {});
