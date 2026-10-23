/* mailprompt DNS checks.
   Looks records up live with DNS-over-HTTPS straight from your browser
   (Cloudflare first, Google as a fallback). Nothing goes through a mailprompt
   server, because there isn't one. Domains ending in .example use the
   built-in demo records. */
(function (MP) {
  'use strict';

  var TYPES = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };
  var cache = {};

  function unquoteTxt(data) {
    // DoH returns TXT as one or more quoted strings: "v=spf1 ..." "more"
    var parts = String(data).match(/"((?:[^"\\]|\\.)*)"/g);
    if (!parts) return String(data);
    return parts.map(function (p) { return p.slice(1, -1).replace(/\\"/g, '"'); }).join('');
  }

  function fetchJson(url, headers) {
    return fetch(url, { headers: headers || {} }).then(function (res) {
      if (!res.ok) throw new Error('DNS lookup failed (' + res.status + ')');
      return res.json();
    });
  }

  function lookup(name, type) {
    name = String(name).toLowerCase().replace(/\.$/, '');
    var key = name + '|' + type;
    if (cache[key]) return cache[key];

    if (/\.example$/.test(name)) {
      var demo = (MP.demo && MP.demo.dns[key]) || [];
      cache[key] = Promise.resolve({ name: name, type: type, answers: demo.slice(), demo: true });
      return cache[key];
    }

    var q = '?name=' + encodeURIComponent(name) + '&type=' + type;
    var p = fetchJson('https://cloudflare-dns.com/dns-query' + q, { accept: 'application/dns-json' })
      .catch(function () { return fetchJson('https://dns.google/resolve' + q); })
      .then(function (json) {
        var want = TYPES[type];
        var answers = (json.Answer || [])
          .filter(function (a) { return a.type === want; })
          .map(function (a) { return type === 'TXT' ? unquoteTxt(a.data) : String(a.data); });
        return { name: name, type: type, answers: answers, status: json.Status, demo: false };
      });
    cache[key] = p;
    p.catch(function () { delete cache[key]; });
    return p;
  }

  function clearCache() { cache = {}; }

  // ---------- SPF ----------
  function spfRecords(answers) {
    return answers.filter(function (t) { return /^v=spf1(\s|$)/i.test(t.trim()); });
  }

  // Count DNS-querying mechanisms recursively (RFC 7208 limit is 10).
  function countSpfLookups(domain, depth, seen) {
    if (depth > 10 || seen[domain]) return Promise.resolve({ count: 0, loops: !!seen[domain] });
    seen[domain] = true;
    return lookup(domain, 'TXT').then(function (r) {
      var recs = spfRecords(r.answers);
      if (!recs.length) return { count: 0, missing: [domain] };
      var terms = recs[0].trim().split(/\s+/).slice(1);
      var count = 0, nested = [];
      terms.forEach(function (term) {
        var t = term.replace(/^[+\-~?]/, '').toLowerCase();
        var m;
        if ((m = t.match(/^include:(.+)$/))) { count++; nested.push(m[1]); }
        else if ((m = t.match(/^redirect=(.+)$/))) { count++; nested.push(m[1]); }
        else if (/^(a|mx|ptr|exists)([:/]|$)/.test(t)) { count++; }
      });
      return Promise.all(nested.map(function (d) { return countSpfLookups(d, depth + 1, seen); }))
        .then(function (subs) {
          var missing = [];
          subs.forEach(function (s) { count += s.count; if (s.missing) missing = missing.concat(s.missing); });
          return { count: count, missing: missing };
        });
    }).catch(function () { return { count: 0, error: true }; });
  }

  function checkSpf(domain) {
    return lookup(domain, 'TXT').then(function (r) {
      var recs = spfRecords(r.answers);
      var out = { domain: domain, record: recs[0] || null, records: recs, demo: r.demo };
      if (!recs.length) {
        out.status = 'fail';
        out.verdict = 'No SPF record. Receivers can\'t tell which servers may send for this domain.';
        out.fix = 'v=spf1 include:<your-esp-spf> -all';
        return out;
      }
      if (recs.length > 1) {
        out.status = 'fail';
        out.verdict = recs.length + ' SPF records found. Only one is allowed, so SPF returns a permanent error.';
        out.fix = 'Merge them into one record.';
        return out;
      }
      var all = (recs[0].match(/\s([+\-~?]?)all\b/i) || [])[1];
      out.allQualifier = all === undefined ? null : (all || '+');
      return countSpfLookups(domain, 0, {}).then(function (c) {
        out.lookups = c.count;
        out.missingIncludes = c.missing || [];
        if (out.allQualifier === '+') { out.status = 'fail'; out.verdict = '+all lets any server on the internet pass SPF.'; out.fix = recs[0].replace(/\+?all\b/i, '-all'); }
        else if (c.count > 10) { out.status = 'fail'; out.verdict = c.count + ' DNS lookups. Over the limit of 10, so SPF fails.'; out.fix = 'Flatten or remove includes to get under 10.'; }
        else if (out.missingIncludes.length) { out.status = 'warn'; out.verdict = 'An include points at a domain with no SPF record: ' + out.missingIncludes.join(', ') + '.'; }
        else if (c.count >= 8) { out.status = 'warn'; out.verdict = c.count + ' of 10 lookups used. Close to the limit.'; }
        else if (out.allQualifier === '?' || out.allQualifier === null) { out.status = 'warn'; out.verdict = 'Record ends without ~all or -all, so it doesn\'t protect much.'; }
        else { out.status = 'ok'; out.verdict = 'Valid. ' + c.count + ' of 10 lookups used.'; }
        return out;
      });
    });
  }

  // ---------- DMARC ----------
  function orgDomain(domain) {
    // Simple guess: last two labels. Good enough for most .com/.net/.org senders.
    var parts = domain.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : domain;
  }

  function parseTags(record) {
    var tags = {};
    record.split(';').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) tags[kv.slice(0, i).trim().toLowerCase()] = kv.slice(i + 1).trim();
    });
    return tags;
  }

  function checkDmarc(domain) {
    function find(d) {
      return lookup('_dmarc.' + d, 'TXT').then(function (r) {
        return { at: d, demo: r.demo, rec: r.answers.filter(function (t) { return /^v=DMARC1/i.test(t.trim()); })[0] || null };
      });
    }
    return find(domain).then(function (res) {
      var org = orgDomain(domain);
      if (!res.rec && org !== domain) return find(org).then(function (o) { o.inherited = !!o.rec; return o; });
      return res;
    }).then(function (res) {
      var out = { domain: domain, record: res.rec, foundAt: res.at, inherited: !!res.inherited, demo: res.demo };
      if (!res.rec) {
        out.status = 'fail';
        out.verdict = 'No DMARC record. Gmail, Yahoo and Microsoft require one for bulk senders.';
        out.fix = '_dmarc.' + domain + '  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@' + orgDomain(domain) + '"';
        return out;
      }
      var tags = parseTags(res.rec);
      out.tags = tags;
      var p = (tags.p || '').toLowerCase();
      var policy = res.inherited && tags.sp ? tags.sp.toLowerCase() : p;
      out.policy = policy;
      var notes = [];
      if (!tags.rua) notes.push('no rua, so you get no aggregate reports');
      if (tags.pct && tags.pct !== '100') notes.push('pct=' + tags.pct + ' applies the policy to only part of your mail');
      if (policy === 'none') {
        out.status = 'warn';
        out.verdict = 'p=none: monitoring only. Spoofed mail still gets delivered.';
        out.fix = res.rec.replace(/p=none/i, 'p=quarantine');
      } else if (policy === 'quarantine' || policy === 'reject') {
        out.status = notes.length ? 'warn' : 'ok';
        out.verdict = 'Enforcing (p=' + policy + ').';
      } else {
        out.status = 'fail';
        out.verdict = 'Policy tag is missing or invalid.';
      }
      if (res.inherited) out.verdict += ' Inherited from ' + res.at + '.';
      if (notes.length) out.verdict += ' Note: ' + notes.join('; ') + '.';
      return out;
    });
  }

  // ---------- DKIM ----------
  var COMMON_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'k3', 's1', 's2', 'smtp', 'mail', 'dkim', 'mandrill', 'mxvault', 'pm', 'kl', 'kl2', 'sig1', 'mte1', 'cm', 'scph1022', 'everlytickey1', 'zendesk1', 'resend'];

  function keyBits(p) {
    if (!p) return null;
    try {
      var bytes = atob(p.replace(/\s+/g, '')).length;
      if (bytes < 120) return 512;
      if (bytes < 200) return 1024;
      if (bytes < 330) return 2048;
      if (bytes < 600) return 4096;
      return 8192;
    } catch (e) { return null; }
  }

  function checkDkim(domain, selectors) {
    var list = selectors && selectors.length ? selectors : COMMON_SELECTORS;
    return Promise.all(list.map(function (sel) {
      return lookup(sel + '._domainkey.' + domain, 'TXT').then(function (r) {
        var rec = r.answers.filter(function (t) { return /(^|;)\s*(v=DKIM1|k=|p=)/i.test(t); })[0];
        if (!rec) return null;
        var tags = parseTags(rec);
        return { selector: sel, record: rec, bits: keyBits(tags.p), revoked: tags.p === '', demo: r.demo };
      }).catch(function () { return null; });
    })).then(function (found) {
      found = found.filter(Boolean);
      var out = { domain: domain, keys: found, searched: list.length, custom: !!(selectors && selectors.length) };
      if (!found.length) {
        out.status = 'warn';
        out.verdict = out.custom
          ? 'No DKIM key at selector ' + list.join(', ') + '.'
          : 'No DKIM key at ' + list.length + ' common selectors. Your provider may use a custom one.';
        out.hint = 'dkim <selector> ' + domain;
        return out;
      }
      var weak = found.filter(function (k) { return k.bits && k.bits < 2048 && !k.revoked; });
      if (weak.length) {
        out.status = 'warn';
        out.verdict = 'Found ' + found.length + ' key' + (found.length > 1 ? 's' : '') + '. ' + weak.map(function (k) { return k.selector; }).join(', ') + (weak.length > 1 ? ' are' : ' is') + ' under 2048-bit.';
      } else {
        out.status = 'ok';
        out.verdict = 'Found ' + found.length + ' key' + (found.length > 1 ? 's' : '') + ': ' + found.map(function (k) { return k.selector + (k.bits ? ' (' + k.bits + '-bit)' : ''); }).join(', ') + '.';
      }
      return out;
    });
  }

  // ---------- MX ----------
  function mxProvider(host) {
    host = host.toLowerCase();
    if (/google\.com\.?$|googlemail\.com\.?$/.test(host)) return 'Google Workspace';
    if (/protection\.outlook\.com\.?$|outlook\.com\.?$/.test(host)) return 'Microsoft 365';
    if (/yahoodns\.net\.?$/.test(host)) return 'Yahoo';
    if (/icloud\.com\.?$/.test(host)) return 'iCloud';
    if (/pphosted\.com\.?$/.test(host)) return 'Proofpoint';
    if (/mimecast\.com\.?$/.test(host)) return 'Mimecast';
    if (/zoho\.(com|eu)\.?$/.test(host)) return 'Zoho';
    if (/messagingengine\.com\.?$/.test(host)) return 'Fastmail';
    return null;
  }

  function checkMx(domain) {
    return lookup(domain, 'MX').then(function (r) {
      var mx = r.answers.map(function (a) {
        var parts = a.split(/\s+/);
        return { pref: parseInt(parts[0], 10), host: (parts[1] || '').replace(/\.$/, '') };
      }).sort(function (a, b) { return a.pref - b.pref; });
      var out = { domain: domain, mx: mx, demo: r.demo };
      if (!mx.length) {
        out.status = 'warn';
        out.verdict = 'No MX records. Replies to this domain bounce. Fine for a send-only subdomain if Reply-To points elsewhere.';
        return out;
      }
      var prov = mx.map(function (m) { return mxProvider(m.host); }).filter(Boolean)[0];
      out.provider = prov || null;
      out.status = 'ok';
      out.verdict = mx.length + ' MX record' + (mx.length > 1 ? 's' : '') + (prov ? '. Inbox hosted by ' + prov + '.' : '.');
      return out;
    });
  }

  // ---------- Extras: BIMI, MTA-STS, TLS-RPT ----------
  function checkExtras(domain) {
    return Promise.all([
      lookup('default._bimi.' + domain, 'TXT'),
      lookup('_mta-sts.' + domain, 'TXT'),
      lookup('_smtp._tls.' + domain, 'TXT')
    ]).then(function (r) {
      function first(res, re) { return res.answers.filter(function (t) { return re.test(t); })[0] || null; }
      var out = {
        domain: domain,
        bimi: first(r[0], /^v=BIMI1/i),
        mtasts: first(r[1], /^v=STSv1/i),
        tlsrpt: first(r[2], /^v=TLSRPTv1/i),
        demo: r[0].demo
      };
      var have = [out.bimi && 'BIMI', out.mtasts && 'MTA-STS', out.tlsrpt && 'TLS-RPT'].filter(Boolean);
      out.status = 'info';
      out.verdict = have.length ? 'Has ' + have.join(', ') + '.' : 'None set. All optional.';
      return out;
    });
  }

  function checkAll(domain, opts) {
    opts = opts || {};
    return Promise.all([
      checkSpf(domain).catch(errorResult('SPF')),
      checkDkim(domain, opts.selectors).catch(errorResult('DKIM')),
      checkDmarc(domain).catch(errorResult('DMARC')),
      checkMx(domain).catch(errorResult('MX')),
      checkExtras(domain).catch(errorResult('extras'))
    ]).then(function (r) {
      return { domain: domain, spf: r[0], dkim: r[1], dmarc: r[2], mx: r[3], extras: r[4], demo: /\.example$/.test(domain) };
    });
  }

  function errorResult(what) {
    return function (e) {
      return { status: 'fail', error: true, verdict: 'Couldn\'t look up ' + what + ': ' + (e && e.message ? e.message : 'network error') + '.' };
    };
  }

  MP.dns = {
    lookup: lookup,
    checkAll: checkAll,
    checkSpf: checkSpf,
    checkDmarc: checkDmarc,
    checkDkim: checkDkim,
    checkMx: checkMx,
    checkExtras: checkExtras,
    clearCache: clearCache,
    commonSelectors: COMMON_SELECTORS
  };
})(window.MP = window.MP || {});
