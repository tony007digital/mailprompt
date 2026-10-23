/* mailprompt demo data.
   Everything here is fictional. Recipient and sender domains use the reserved
   .example TLD, and IPs use documentation ranges, so nothing points at a real
   person or server. */
(function (MP) {
  'use strict';

  // Small seeded PRNG so the demo is identical every time.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SENDER = 'news.juniperbakery.example';
  var ORIG = 'bounce@' + SENDER;
  var VMTAS = [
    { name: 'vmta-1', ip: '203.0.113.10' },
    { name: 'vmta-2', ip: '203.0.113.11' }
  ];
  var PROVIDERS = [
    { key: 'gmail', domain: 'gmail.example', mx: 'gmail-smtp-in.l.google.com (198.51.100.26)', share: 0.46 },
    { key: 'yahoo', domain: 'yahoo.example', mx: 'mta5.am0.yahoodns.net (198.51.100.72)', share: 0.20 },
    { key: 'microsoft', domain: 'outlook.example', mx: 'outlook-com.olc.protection.outlook.com (198.51.100.44)', share: 0.19 },
    { key: 'apple', domain: 'icloud.example', mx: 'mx01.mail.icloud.com (198.51.100.57)', share: 0.08 },
    { key: 'other', domain: 'corp.example', mx: 'mx1.corp.example (198.51.100.25)', share: 0.07 }
  ];

  var OK = {
    gmail: 'smtp;250 2.0.0 OK  1729587603 a1-20020a05',
    yahoo: 'smtp;250 ok dirdel',
    microsoft: 'smtp;250 2.6.0 <msg@news.juniperbakery.example> Queued mail for delivery',
    apple: 'smtp;250 2.0.0 Ok: queued',
    other: 'smtp;250 2.0.0 Ok: queued as 4XyZ'
  };

  var DEFER = {
    gmail: ['4.7.28', 'smtp;421-4.7.28 Our system has detected an unusual rate of unsolicited mail originating from your IP address. To protect our users from spam, mail sent from your IP address has been temporarily rate limited.'],
    yahoo: ['4.7.0', 'smtp;421 4.7.0 [TSS04] Messages from 203.0.113.11 temporarily deferred due to unexpected volume or user complaints - 4.16.55.1; see https://postmaster.yahooinc.com/error-codes'],
    microsoft: ['4.7.500', 'smtp;451 4.7.500 Server busy. Please try again later.'],
    apple: ['4.7.1', 'smtp;450 4.7.1 Too many connections, try again later'],
    other: ['4.4.1', 'smtp;451 4.4.1 Connection timed out']
  };

  var BOUNCE = {
    gmail: ['5.1.1', 'bad-mailbox', 'smtp;550-5.1.1 The email account that you tried to reach does not exist.'],
    yahoo: ['5.0.0', 'bad-mailbox', "smtp;554 delivery error: dd This user doesn't have a yahoo.com account"],
    microsoft: ['5.5.0', 'bad-mailbox', 'smtp;550 5.5.0 Requested action not taken: mailbox unavailable.'],
    apple: ['5.1.1', 'bad-mailbox', 'smtp;550 5.1.1 <user@icloud.example>: user does not exist'],
    other: ['5.2.2', 'quota-issues', 'smtp;552 5.2.2 Mailbox full']
  };

  var NAMES = ['alex', 'sam', 'jordan', 'casey', 'riley', 'morgan', 'taylor', 'jamie', 'drew', 'quinn', 'avery', 'reese', 'sky', 'rowan', 'blair', 'emery'];

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  // Times are local -0700. base = Oct 21 22:00.
  var BASE = Date.UTC(2026, 9, 22, 5, 0, 0); // 22:00 PDT on Oct 21
  function stamp(ms) {
    var d = new Date(ms - 7 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2) + ' ' +
      pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2) + '-0700';
  }
  var MIN = 60 * 1000;
  var END = BASE + 10 * 60 * MIN; // 08:00 PDT
  var YAHOO_TROUBLE = BASE + (4 * 60 + 10) * MIN; // 02:10 PDT

  function row(type, ms, rcpt, p, vmta, job, status, diag, cat) {
    return {
      type: type,
      timeLogged: stamp(ms),
      orig: ORIG,
      rcpt: rcpt,
      dsnAction: type === 'd' ? 'relayed' : type === 'b' ? 'failed' : type === 't' ? 'delayed' : 'complaint',
      dsnStatus: status,
      dsnDiag: diag,
      dsnMta: p.mx,
      bounceCat: cat || '',
      dlvSourceIp: vmta.ip,
      vmta: vmta.name,
      jobId: job
    };
  }

  function build() {
    var r = rng(20261022);
    var rows = [];
    var N = 4200;
    for (var i = 0; i < N; i++) {
      var x = r(), acc = 0, p = PROVIDERS[PROVIDERS.length - 1];
      for (var k = 0; k < PROVIDERS.length; k++) { acc += PROVIDERS[k].share; if (x < acc) { p = PROVIDERS[k]; break; } }
      var vmta = VMTAS[r() < 0.5 ? 0 : 1];
      var job = i < 1600 ? 'fall-menu-reminder' : 'pumpkin-loaves';
      var start = job === 'fall-menu-reminder' ? BASE + r() * 90 * MIN : BASE + 240 * MIN + r() * 300 * MIN;
      var rcpt = NAMES[Math.floor(r() * NAMES.length)] + '.' + pad(i, 4) + '@' + p.domain;
      var t = start;

      // Yahoo trouble on vmta-2 after 02:10.
      if (p.key === 'yahoo' && vmta.name === 'vmta-2' && t > YAHOO_TROUBLE && r() < 0.62) {
        var tries = 1 + Math.floor(r() * 3);
        for (var a = 0; a < tries && t < END; a++) {
          rows.push(row('t', t, rcpt, p, vmta, job, DEFER.yahoo[0], DEFER.yahoo[1]));
          t += (15 + r() * 40) * MIN;
        }
        if (t < END && r() < 0.55) rows.push(row('d', t, rcpt, p, vmta, job, '2.0.0 (success)', OK.yahoo));
        continue; // otherwise still queued at 08:00
      }

      // Ordinary background deferrals.
      var deferChance = { gmail: 0.004, yahoo: 0.01, microsoft: 0.008, apple: 0.005, other: 0.01 }[p.key];
      if (r() < deferChance) {
        rows.push(row('t', t, rcpt, p, vmta, job, DEFER[p.key][0], DEFER[p.key][1]));
        t += (5 + r() * 20) * MIN;
      }

      var bounceChance = { gmail: 0.004, yahoo: 0.007, microsoft: 0.005, apple: 0.004, other: 0.012 }[p.key];
      if (r() < bounceChance) {
        var b = BOUNCE[p.key];
        rows.push(row('b', t, rcpt, p, vmta, job, b[0], b[2], b[1]));
        continue;
      }
      rows.push(row('d', t, rcpt, p, vmta, job, '2.0.0 (success)', OK[p.key]));

      // Feedback-loop complaints (Yahoo and Microsoft send FBLs; Gmail does not).
      var fbl = { yahoo: 0.0025, microsoft: 0.0015 }[p.key] || 0;
      if (fbl && r() < fbl) rows.push(row('f', t + (30 + r() * 120) * MIN, rcpt, p, vmta, job, '', 'abuse report (ARF)', 'spam-related'));
    }

    // Two blocklist bounces at a corporate gateway.
    var other = PROVIDERS[4];
    rows.push(row('b', BASE + 300 * MIN, 'ops.9001@corp.example', other, VMTAS[1], 'pumpkin-loaves', '5.7.1', 'smtp;550 5.7.1 Service unavailable; client host [203.0.113.11] blocked using zen.spamhaus.org', 'policy-related'));
    rows.push(row('b', BASE + 342 * MIN, 'desk.9002@corp.example', other, VMTAS[1], 'pumpkin-loaves', '5.7.1', 'smtp;550 5.7.1 Service unavailable; client host [203.0.113.11] blocked using zen.spamhaus.org', 'policy-related'));

    // Named recipients used in the walkthrough.
    var yahoo = PROVIDERS[1];
    rows.push(row('b', BASE + 361 * MIN, 'jane@yahoo.example', yahoo, VMTAS[1], 'pumpkin-loaves', BOUNCE.yahoo[0], BOUNCE.yahoo[2], 'bad-mailbox'));
    rows.push(row('t', BASE + 322 * MIN, 'sam@yahoo.example', yahoo, VMTAS[1], 'pumpkin-loaves', DEFER.yahoo[0], DEFER.yahoo[1]));
    rows.push(row('t', BASE + 371 * MIN, 'sam@yahoo.example', yahoo, VMTAS[1], 'pumpkin-loaves', DEFER.yahoo[0], DEFER.yahoo[1]));
    rows.push(row('d', BASE + 418 * MIN, 'sam@yahoo.example', yahoo, VMTAS[1], 'pumpkin-loaves', '2.0.0 (success)', OK.yahoo));

    rows.sort(function (a, b) { return a.timeLogged < b.timeLogged ? -1 : a.timeLogged > b.timeLogged ? 1 : 0; });
    return rows;
  }

  var COLUMNS = ['type', 'timeLogged', 'orig', 'rcpt', 'dsnAction', 'dsnStatus', 'dsnDiag', 'dsnMta', 'bounceCat', 'dlvSourceIp', 'vmta', 'jobId'];

  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function toCSV(rows) {
    var out = [COLUMNS.join(',')];
    rows.forEach(function (r) { out.push(COLUMNS.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return out.join('\n') + '\n';
  }

  // Demo DNS for the fictional sender. Real domains are looked up live.
  var DKIM_2048 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApWtuCritiNLxDCCQnFzuKTbr/3tNm+WMMNUhXOYqh2dcXxewn08D4muVbpdXaHnjbC+Oj678R5MQ+/E7QTLrk+RiiKCw30tJPKMME1XhBm/TaNcytMrrtTLVzRHE4tSsfTSZKd/qYzzYJy/dvBo3qf0SlVDSUqJc7/klPicQQdYqg0E53Ssaf/G8NbU9G0KNFJx85BDqTYGSrxXjuN6ZtjVcr8m+I2xbU3xBT3D83Kzyl/Fg7GfAa9j0uD43wsYS7zdoClklb3a3sxjTezC7D5A+y2LGgl+Z82hQBfTi0vZyVX67YZRDhxrD5d6ihibOIun0Ar/jxp7u0qsedQeTNwIDAQAB';
  var DNS = {
    'juniperbakery.example|TXT': ['v=spf1 include:_spf.google.example ~all'],
    'juniperbakery.example|MX': ['1 aspmx.l.google.com.', '5 alt1.aspmx.l.google.com.'],
    '_spf.google.example|TXT': ['v=spf1 ip4:198.51.100.0/24 ~all'],
    '_dmarc.juniperbakery.example|TXT': ['v=DMARC1; p=none; rua=mailto:dmarc@juniperbakery.example'],
    'news.juniperbakery.example|TXT': ['v=spf1 ip4:203.0.113.10 ip4:203.0.113.11 include:_spf.demo-esp.example -all'],
    '_spf.demo-esp.example|TXT': ['v=spf1 ip4:198.51.100.128/25 -all'],
    'news.juniperbakery.example|MX': ['10 mx.news.juniperbakery.example.'],
    '_dmarc.news.juniperbakery.example|TXT': ['v=DMARC1; p=none; rua=mailto:dmarc@juniperbakery.example; adkim=r; aspf=r'],
    's1._domainkey.news.juniperbakery.example|TXT': ['v=DKIM1; k=rsa; p=' + DKIM_2048],
    's1._domainkey.juniperbakery.example|TXT': ['v=DKIM1; k=rsa; p=' + DKIM_2048],
    '_smtp._tls.juniperbakery.example|TXT': ['v=TLSRPTv1; rua=mailto:tlsrpt@juniperbakery.example']
  };

  var cached = null;
  MP.demo = {
    name: 'Demo log: Juniper Bakery overnight sends',
    sender: SENDER,
    rows: function () { if (!cached) cached = build(); return cached.map(function (r) { return Object.assign({}, r); }); },
    toCSV: function () { if (!cached) cached = build(); return toCSV(cached); },
    dns: DNS
  };
})(window.MP = window.MP || {});
