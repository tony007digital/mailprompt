/* mailprompt log import and analysis.
   Reads a CSV export from PowerMTA (accounting files) or most ESPs
   (SendGrid, Mailgun, SES, Postmark, Braze, Klaviyo bounce/event exports).
   Columns are matched by name, so the order doesn't matter.
   Everything runs in your browser. Files never leave your machine. */
(function (MP) {
  'use strict';

  // ---------- CSV ----------
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false, i = 0, c;
    text = String(text).replace(/^﻿/, '');
    var delim = guessDelimiter(text);
    while (i < text.length) {
      c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === delim) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] && r[0].trim()); });
  }

  function guessDelimiter(text) {
    var first = text.split('\n')[0] || '';
    var counts = { ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length, ';': (first.match(/;/g) || []).length };
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || ',';
  }

  var ALIASES = {
    type: ['type', 'event', 'event_type', 'eventtype', 'status', 'record_type', 'notificationtype'],
    action: ['dsnaction', 'action', 'delivery_status'],
    time: ['timelogged', 'timestamp', 'time', 'date', 'created_at', 'event_time', 'processed', 'datetime', 'occurred_at'],
    rcpt: ['rcpt', 'recipient', 'email', 'to', 'address', 'email_address', 'recipient_email', 'destination_address'],
    code: ['dsnstatus', 'status_code', 'enhanced_code', 'smtp_status', 'code', 'smtp_code', 'status'],
    diag: ['dsndiag', 'reason', 'response', 'diagnostic', 'diagnostic_code', 'bounce_reason', 'smtp_response', 'description', 'details', 'error'],
    mx: ['dsnmta', 'mx', 'remote_mta', 'remotemta', 'mx_host', 'destination'],
    category: ['bouncecat', 'bounce_category', 'bouncetype', 'bounce_type', 'category', 'classification'],
    queue: ['vmta', 'vmtapool', 'ip_pool', 'pool', 'queue', 'sending_pool', 'message_stream'],
    ip: ['dlvsourceip', 'sending_ip', 'source_ip', 'ip', 'sendingip'],
    campaign: ['jobid', 'campaign', 'campaign_id', 'campaign_name', 'job', 'envid', 'tag', 'tags', 'category_name']
  };

  function mapColumns(header) {
    var norm = header.map(function (h) { return String(h).trim().toLowerCase().replace(/[\s-]+/g, '_'); });
    var map = {};
    Object.keys(ALIASES).forEach(function (field) {
      for (var i = 0; i < ALIASES[field].length; i++) {
        var idx = norm.indexOf(ALIASES[field][i]);
        if (idx !== -1 && Object.keys(map).map(function (k) { return map[k]; }).indexOf(idx) === -1) { map[field] = idx; return; }
      }
    });
    // "status" may be the event column (ESP) or a code column. If we already
    // have a type column, let it be the code column instead.
    return map;
  }

  // ---------- Normalizing ----------
  function normEvent(type, action, code, diag) {
    var t = String(type || '').trim().toLowerCase();
    var a = String(action || '').trim().toLowerCase();
    if (t === 'd') return 'delivered';
    if (t === 'b' || t === 'rb') return 'bounced';
    if (t === 't' || t === 'tq') return 'deferred';
    if (t === 'f') return 'complaint';
    var s = t + ' ' + a;
    if (/complain|spam ?report|abuse|fbl/.test(s)) return 'complaint';
    if (/defer|delay|transient|soft|retry|tempfail/.test(s)) return 'deferred';
    if (/bounce|fail|reject|dropped|undeliver|permanent|hard/.test(s)) return 'bounced';
    if (/deliver|relayed|sent|success/.test(s)) return 'delivered';
    if (/open|click|unsub|processed|queued/.test(s)) return 'other';
    var c = basicCode(code, diag);
    if (c) {
      if (c[0] === '2') return 'delivered';
      if (c[0] === '4') return 'deferred';
      if (c[0] === '5') return 'bounced';
    }
    return 'other';
  }

  function basicCode(code, diag) {
    var m = String(diag || '').match(/\b([245]\d\d)[\s-]/) || String(code || '').match(/\b([245]\d\d)\b/);
    if (m) return m[1];
    var e = String(code || '').match(/\b([245])\.\d{1,3}\.\d{1,3}\b/);
    return e ? e[1] + '00' : null;
  }

  function enhancedCode(code, diag) {
    var m = String(code || '').match(/\b([245]\.\d{1,3}\.\d{1,3})\b/) || String(diag || '').match(/\b([245]\.\d{1,3}\.\d{1,3})\b/);
    return m ? m[1] : null;
  }

  function cleanDiag(diag) {
    return String(diag || '').replace(/^smtp;\s*/i, '').trim();
  }

  function providerOf(rcpt, mx) {
    var h = String(mx || '').toLowerCase();
    if (/google\.com|googlemail\.com/.test(h)) return 'Gmail';
    if (/yahoodns\.net|yahoo\.com|aol\.com/.test(h)) return 'Yahoo';
    if (/outlook\.com|hotmail\.com|protection\.outlook/.test(h)) return 'Microsoft';
    if (/icloud\.com|me\.com|apple\.com/.test(h)) return 'Apple';
    var d = String(rcpt || '').toLowerCase().split('@')[1] || '';
    if (/^(gmail|googlemail)\./.test(d)) return 'Gmail';
    if (/^(yahoo|ymail|rocketmail|aol|aim)\./.test(d)) return 'Yahoo';
    if (/^(outlook|hotmail|live|msn|passport)\./.test(d)) return 'Microsoft';
    if (/^(icloud|me|mac)\./.test(d)) return 'Apple';
    return 'Other';
  }

  function parseTime(v) {
    if (!v) return null;
    var s = String(v).trim();
    if (/^\d{10}(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
    if (/^\d{13}$/.test(s)) return parseInt(s, 10);
    s = s.replace(/^(\d{4}-\d\d-\d\d) (\d)/, '$1T$2').replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function bounceCategory(r) {
    var cat = String(r.category || '').toLowerCase();
    var txt = (r.code || '') + ' ' + r.diag.toLowerCase();
    if (/spamhaus|blocklist|blacklist|block(ed)? using|listed|\brbl\b|spamcop|barracuda/.test(txt)) return 'Blocklisted';
    if (/bad-mailbox|inactive-mailbox|bad-domain/.test(cat) || /5\.1\.[0-3]|does not exist|user unknown|no such user|mailbox unavailable|doesn't have a|not found|invalid recipient|unknown user|address rejected/.test(txt)) return 'Bad address';
    if (/quota|mailbox-full/.test(cat) || /5\.2\.2|mailbox full|over quota|quota exceeded|insufficient storage/.test(txt)) return 'Mailbox full';
    if (/spam-related|policy-related|content-related/.test(cat) || /5\.7\.\d|policy|spam|reputation|denied|blocked|dmarc|not authorized|authentication/.test(txt)) return 'Policy or spam block';
    if (/routing|bad-connection|dns/.test(cat) || /5\.4\.\d|no mx|dns|host not found|domain not found/.test(txt)) return 'Domain or DNS';
    return 'Other';
  }

  function normalize(table) {
    var header = table[0];
    var map = mapColumns(header);
    if (map.rcpt === undefined) throw new Error('Couldn\'t find a recipient column. Expected one named rcpt, email, recipient or to.');
    if (map.type === undefined && map.action === undefined && map.code === undefined && map.diag === undefined) {
      throw new Error('Couldn\'t find an event or status column. Expected type, event, status, dsnStatus or reason.');
    }
    function get(row, f) { return map[f] === undefined ? '' : (row[map[f]] || ''); }
    var out = [];
    for (var i = 1; i < table.length; i++) {
      var row = table[i];
      var rcpt = get(row, 'rcpt').trim();
      if (!rcpt) continue;
      var code = get(row, 'code'), diag = cleanDiag(get(row, 'diag'));
      var r = {
        event: normEvent(get(row, 'type'), get(row, 'action'), code, diag),
        time: parseTime(get(row, 'time')),
        rcpt: rcpt.toLowerCase(),
        code: enhancedCode(code, diag),
        basic: basicCode(code, diag),
        diag: diag,
        mx: get(row, 'mx'),
        category: get(row, 'category'),
        queue: get(row, 'queue') || get(row, 'ip') || '',
        ip: get(row, 'ip'),
        campaign: get(row, 'campaign')
      };
      r.provider = providerOf(r.rcpt, r.mx);
      if (r.event === 'bounced') r.bounceType = bounceCategory(r);
      out.push(r);
    }
    return { rows: out, columns: map, header: header };
  }

  // ---------- Dataset ----------
  function Dataset(rows, source) {
    this.rows = rows;
    this.source = source;
    this._build();
  }

  Dataset.prototype._build = function () {
    var byMsg = {};
    var times = [];
    this.rows.forEach(function (r) {
      if (r.time) times.push(r.time);
      var key = r.rcpt + '|' + (r.campaign || '');
      var m = byMsg[key] || (byMsg[key] = { rcpt: r.rcpt, campaign: r.campaign, provider: r.provider, queue: r.queue, deferrals: 0, final: null, complaint: false, last: null });
      if (r.event === 'deferred') m.deferrals++;
      if (r.event === 'delivered' || r.event === 'bounced') m.final = r.event;
      if (r.event === 'complaint') m.complaint = true;
      if (!m.last || (r.time && r.time >= (m.last.time || 0))) m.last = r;
      if (r.queue) m.queue = r.queue;
    });
    this.messages = Object.keys(byMsg).map(function (k) { return byMsg[k]; });
    times.sort(function (a, b) { return a - b; });
    this.start = times[0] || null;
    this.end = times[times.length - 1] || null;
    this.hasQueues = this.rows.some(function (r) { return r.queue; });
    this.hasCampaigns = this.rows.some(function (r) { return r.campaign; });
  };

  function pct(n, d) { return d ? (n / d) * 100 : 0; }

  Dataset.prototype.summary = function () {
    var s = { events: this.rows.length, messages: 0, delivered: 0, bounced: 0, queued: 0, deferrals: 0, complaints: 0 };
    this.messages.forEach(function (m) {
      if (m.final === 'delivered') s.delivered++;
      else if (m.final === 'bounced') s.bounced++;
      else if (m.deferrals) s.queued++;
      if (m.final || m.deferrals) s.messages++;
      s.deferrals += m.deferrals;
      if (m.complaint) s.complaints++;
    });
    s.deliveredPct = pct(s.delivered, s.messages);
    s.bouncedPct = pct(s.bounced, s.messages);
    s.complaintPct = pct(s.complaints, s.delivered);
    s.start = this.start; s.end = this.end;
    return s;
  };

  Dataset.prototype.byProvider = function () {
    var g = {};
    this.messages.forEach(function (m) {
      var p = g[m.provider] || (g[m.provider] = { provider: m.provider, messages: 0, delivered: 0, bounced: 0, queued: 0, deferrals: 0, complaints: 0 });
      if (m.final || m.deferrals) p.messages++;
      if (m.final === 'delivered') p.delivered++;
      else if (m.final === 'bounced') p.bounced++;
      else if (m.deferrals) p.queued++;
      p.deferrals += m.deferrals;
      if (m.complaint) p.complaints++;
    });
    return Object.keys(g).map(function (k) {
      var p = g[k];
      p.deliveredPct = pct(p.delivered, p.messages);
      p.bouncedPct = pct(p.bounced, p.messages);
      p.deferralRate = pct(p.deferrals, p.messages);
      p.complaintPct = pct(p.complaints, p.delivered);
      p.state = p.deferralRate > 10 || p.bouncedPct > 3 || p.complaintPct > 0.3 ? 'warn' : 'ok';
      return p;
    }).sort(function (a, b) { return b.messages - a.messages; });
  };

  Dataset.prototype.deferrals = function () {
    var total = 0, g = {};
    this.rows.forEach(function (r) {
      if (r.event !== 'deferred') return;
      total++;
      var p = g[r.provider] || (g[r.provider] = { provider: r.provider, count: 0, codes: {}, queues: {} });
      p.count++;
      var key = (r.basic || '') + ' ' + (r.code || '') + (shortTag(r.diag) ? ' ' + shortTag(r.diag) : '');
      p.codes[key.trim()] = (p.codes[key.trim()] || 0) + 1;
      if (r.queue) p.queues[r.queue] = (p.queues[r.queue] || 0) + 1;
    });
    var list = Object.keys(g).map(function (k) {
      var p = g[k];
      p.share = pct(p.count, total);
      p.topCode = topKey(p.codes);
      p.topQueue = topKey(p.queues);
      p.topQueueShare = p.topQueue ? pct(p.queues[p.topQueue], p.count) : 0;
      return p;
    }).sort(function (a, b) { return b.count - a.count; });
    return { total: total, providers: list };
  };

  function shortTag(diag) {
    var m = String(diag).match(/\[([A-Z]{2,5}\d{1,3})\]/); // Yahoo-style [TSS04]
    return m ? '[' + m[1] + ']' : '';
  }

  function topKey(obj) {
    var best = null, n = -1;
    Object.keys(obj).forEach(function (k) { if (obj[k] > n) { n = obj[k]; best = k; } });
    return best;
  }

  Dataset.prototype.bounces = function () {
    var total = 0, g = {};
    this.rows.forEach(function (r) {
      if (r.event !== 'bounced') return;
      total++;
      var c = g[r.bounceType] || (g[r.bounceType] = { type: r.bounceType, count: 0, providers: {}, example: r.diag });
      c.count++;
      c.providers[r.provider] = (c.providers[r.provider] || 0) + 1;
    });
    var list = Object.keys(g).map(function (k) {
      var c = g[k];
      c.share = pct(c.count, total);
      c.topProvider = topKey(c.providers);
      return c;
    }).sort(function (a, b) { return b.count - a.count; });
    return { total: total, types: list };
  };

  Dataset.prototype.queues = function () {
    var g = {};
    var end = this.end || 0;
    var self = this;
    this.messages.forEach(function (m) {
      var key = (m.queue || 'default') + ' → ' + m.provider;
      var q = g[key] || (g[key] = { queue: m.queue || 'default', provider: m.provider, queued: 0, deferrals: 0, delivered: 0, bounced: 0, oldest: null });
      if (m.final === 'delivered') q.delivered++;
      else if (m.final === 'bounced') q.bounced++;
      else if (m.deferrals) {
        q.queued++;
        var first = self._firstTime(m);
        if (first && (!q.oldest || first < q.oldest)) q.oldest = first;
      }
      q.deferrals += m.deferrals;
    });
    return Object.keys(g).map(function (k) {
      var q = g[k];
      q.oldestMin = q.oldest && end ? Math.round((end - q.oldest) / 60000) : null;
      q.state = q.queued > 50 ? 'backoff' : q.queued > 0 ? 'retrying' : 'normal';
      return q;
    }).sort(function (a, b) { return b.queued - a.queued || b.deferrals - a.deferrals; });
  };

  Dataset.prototype._firstTime = function (m) {
    if (!this._firstIndex) {
      var idx = {};
      this.rows.forEach(function (r) {
        var k = r.rcpt + '|' + (r.campaign || '');
        if (r.time && (!idx[k] || r.time < idx[k])) idx[k] = r.time;
      });
      this._firstIndex = idx;
    }
    return this._firstIndex[m.rcpt + '|' + (m.campaign || '')] || null;
  };

  Dataset.prototype.codes = function () {
    var g = {};
    this.rows.forEach(function (r) {
      if (r.event !== 'deferred' && r.event !== 'bounced') return;
      var key = [r.basic, r.code].filter(Boolean).join(' ') || 'unknown';
      var c = g[key] || (g[key] = { code: key, count: 0, event: r.event, example: r.diag, providers: {} });
      c.count++;
      c.providers[r.provider] = (c.providers[r.provider] || 0) + 1;
    });
    return Object.keys(g).map(function (k) { var c = g[k]; c.topProvider = topKey(c.providers); return c; })
      .sort(function (a, b) { return b.count - a.count; });
  };

  Dataset.prototype.timeline = function () {
    if (!this.start || !this.end) return { buckets: [] };
    var HOUR = 3600 * 1000;
    var start = Math.floor(this.start / HOUR) * HOUR;
    var n = Math.min(72, Math.floor((this.end - start) / HOUR) + 1);
    var buckets = [];
    for (var i = 0; i < n; i++) buckets.push({ t: start + i * HOUR, delivered: 0, deferred: 0, bounced: 0 });
    this.rows.forEach(function (r) {
      if (!r.time) return;
      var i = Math.floor((r.time - start) / HOUR);
      if (i < 0 || i >= n) return;
      if (r.event === 'delivered' || r.event === 'deferred' || r.event === 'bounced') buckets[i][r.event]++;
    });
    return { buckets: buckets };
  };

  Dataset.prototype.campaigns = function () {
    var g = {};
    this.messages.forEach(function (m) {
      var key = m.campaign || '(none)';
      var c = g[key] || (g[key] = { campaign: key, messages: 0, delivered: 0, bounced: 0, queued: 0, complaints: 0 });
      if (m.final || m.deferrals) c.messages++;
      if (m.final === 'delivered') c.delivered++;
      else if (m.final === 'bounced') c.bounced++;
      else if (m.deferrals) c.queued++;
      if (m.complaint) c.complaints++;
    });
    return Object.keys(g).map(function (k) {
      var c = g[k];
      c.deliveredPct = pct(c.delivered, c.messages);
      c.bouncedPct = pct(c.bounced, c.messages);
      c.complaintPct = pct(c.complaints, c.delivered);
      return c;
    }).sort(function (a, b) { return b.messages - a.messages; });
  };

  Dataset.prototype.trace = function (email) {
    email = String(email).toLowerCase();
    return this.rows.filter(function (r) { return r.rcpt === email; })
      .sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
  };

  Dataset.prototype.findAddress = function (part) {
    part = String(part).toLowerCase();
    var hit = this.rows.filter(function (r) { return r.rcpt.indexOf(part) === 0; })[0];
    return hit ? hit.rcpt : null;
  };

  // One-line verdicts, most important first.
  Dataset.prototype.insights = function () {
    var out = [];
    var s = this.summary();
    var d = this.deferrals();
    if (d.total && d.providers[0] && d.providers[0].share >= 50) {
      var p = d.providers[0];
      var q = p.topQueue && p.topQueueShare >= 80 ? ', mostly on ' + p.topQueue : '';
      out.push({ level: 'warn', tile: 'deferrals', text: Math.round(p.share) + '% of deferrals are ' + p.provider + q + ' (' + (p.topCode || 'mixed codes') + ').' });
    }
    if (s.bouncedPct > 2) out.push({ level: 'warn', tile: 'bounces', text: 'Bounce rate is ' + s.bouncedPct.toFixed(1) + '%. Above 2% hurts reputation.' });
    var bl = this.bounces().types.filter(function (t) { return t.type === 'Blocklisted'; })[0];
    if (bl) out.push({ level: 'warn', tile: 'bounces', text: bl.count + ' bounce' + (bl.count > 1 ? 's' : '') + ' mention a blocklist. Check your sending IPs.' });
    if (s.complaintPct >= 0.1) out.push({ level: 'warn', tile: 'providers', text: 'Complaint rate is ' + s.complaintPct.toFixed(2) + '%. Gmail and Yahoo want under 0.10%.' });
    if (s.queued > 0) out.push({ level: 'info', tile: 'queues', text: s.queued.toLocaleString() + ' messages still retrying.' });
    if (!out.length) out.push({ level: 'ok', tile: 'summary', text: 'Sending looks normal. ' + s.deliveredPct.toFixed(1) + '% delivered.' });
    return out;
  };

  function fromText(text, source) {
    var table = parseCSV(text);
    if (table.length < 2) throw new Error('That file has no data rows.');
    var n = normalize(table);
    if (!n.rows.length) throw new Error('No rows with a recipient address.');
    return new Dataset(n.rows, source);
  }

  function fromDemo() {
    var text = MP.demo.toCSV();
    return fromText(text, { kind: 'demo', name: MP.demo.name });
  }

  MP.logs = {
    parseCSV: parseCSV,
    fromText: fromText,
    fromDemo: fromDemo,
    providerOf: providerOf
  };
})(window.MP = window.MP || {});
