/* mailprompt HTML email QA.
   Rule-based checks that run instantly in your browser: Gmail clipping,
   links and UTMs, images and alt text, unsubscribe, preheader, accessibility,
   merge tags, Outlook and dark mode code. Nothing is sent anywhere.
   Severity: fix = must fix before send, check = should fix, note = worth a look. */
(function (MP) {
  'use strict';

  var CLIP = 102 * 1024;          // Gmail clips messages over about 102KB
  var CLIP_WARN = 90 * 1024;      // ESPs add tracking links and code, so leave room

  function issue(level, text, detail, area) { return { level: level, text: text, detail: detail || '', area: area || '' }; }
  function worst(items) {
    if (items.some(function (i) { return i.level === 'fix'; })) return 'fail';
    if (items.some(function (i) { return i.level === 'check'; })) return 'warn';
    return 'ok';
  }
  function byteLength(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; } }
  function textOf(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function isMerge(s) { return /\{\{|\{%|%%|\*\||\$\{|<%|\[\[/.test(s || ''); }

  function parse(html) {
    try { return new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
  }

  // ---------- Links ----------
  var SHORTENERS = /^(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|buff\.ly|rebrand\.ly|is\.gd|cutt\.ly|shorturl\.at|rb\.gy|tiny\.cc)$/i;
  var VAGUE = /^(click here|here|click|learn more|read more|more|link|this|go|this link|details)$/i;
  var UNSUB_TEXT = /unsubscribe|opt[\s-]?out|manage (your )?(email )?(preferences|subscription)|email preferences|update (your )?preferences/i;
  var UNSUB_TAGS = /\{%-?\s*unsubscribe|\{\{\s*unsubscribe|\*\|UNSUB\|\*|%%\s*unsub|%%profile_center_url%%|asm_group_unsubscribe|\{\{\{\s*unsubscribe|\$\{\s*(set_user_to_unsubscribed_url|unsubscribe)|%unsubscribe_url%|unsubscribe_product_link|\[unsubscribe\]|\{unsubscribe/i;

  function links(doc) {
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll('a'), function (a) {
      var href = (a.getAttribute('href') || '').trim();
      var text = textOf(a);
      var imgAlt = Array.prototype.map.call(a.querySelectorAll('img'), function (i) { return i.getAttribute('alt') || ''; }).join(' ').trim();
      var label = text || (imgAlt ? '[image: ' + imgAlt + ']' : '');
      var kind = 'web', status = 'ok', note = '', host = '';
      var unsub = UNSUB_TEXT.test(text) || UNSUB_TAGS.test(href);
      if (!href) { kind = 'none'; status = 'fix'; note = 'No href'; }
      else if (/^#/.test(href)) { kind = 'placeholder'; status = 'fix'; note = 'Placeholder link'; }
      else if (/^javascript:/i.test(href)) { kind = 'placeholder'; status = 'fix'; note = 'javascript: link'; }
      else if (/^(mailto|tel|sms):/i.test(href)) { kind = 'contact'; }
      else if (isMerge(href) && !/^https?:\/\//i.test(href)) { kind = 'merge'; note = 'Filled in by your ESP'; }
      else {
        var m = href.match(/^(https?):\/\/([^/?#:]+)/i);
        if (!m) { kind = 'relative'; status = 'fix'; note = 'Relative link. Email needs full https:// links'; }
        else {
          host = m[2].toLowerCase();
          if (m[1].toLowerCase() === 'http') { status = 'check'; note = 'Not https'; }
          if (SHORTENERS.test(host)) { status = 'check'; note = 'Public link shortener. Spam filters distrust these'; }
        }
      }
      var utm = /[?&]utm_(source|medium|campaign)=/i.test(href);
      if (!label && kind !== 'none') { if (status === 'ok') status = 'check'; note = note || 'No link text or image alt. Screen readers say only "link"'; }
      out.push({ href: href, text: label, kind: kind, host: host, status: status, note: note, utm: utm, unsub: unsub, vague: VAGUE.test(text) });
    });
    return out;
  }

  // ---------- Images ----------
  function images(doc) {
    return Array.prototype.map.call(doc.querySelectorAll('img'), function (img) {
      var src = (img.getAttribute('src') || '').trim();
      var hasAlt = img.hasAttribute('alt');
      var alt = (img.getAttribute('alt') || '').trim();
      var width = img.getAttribute('width');
      var st = 'ok', note = '';
      if (!src) { st = 'fix'; note = 'No src'; }
      else if (/^data:/i.test(src)) { st = 'check'; note = 'Embedded data: image. Gmail and others block these'; }
      else if (/^http:\/\//i.test(src)) { st = 'check'; note = 'Not https. Some clients block it'; }
      if (!hasAlt) { st = 'fix'; note = note ? note + '; no alt attribute' : 'No alt attribute'; }
      else if (!alt && st === 'ok') { note = 'Empty alt (fine for spacers and decoration)'; }
      if (!width && st === 'ok') { st = 'check'; note = 'No width attribute. Outlook may show it at full size'; }
      return { src: src, alt: alt, hasAlt: hasAlt, width: width, status: st, note: note };
    });
  }

  // ---------- Preheader ----------
  function preheader(doc, html) {
    var body = doc.body;
    if (!body) return null;
    var candidates = body.querySelectorAll('div, span, td, p');
    for (var i = 0; i < candidates.length && i < 60; i++) {
      var el = candidates[i];
      var st = (el.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
      var cls = (el.getAttribute('class') || '').toLowerCase();
      if (/display:none|max-height:0|opacity:0|mso-hide:all|visibility:hidden|font-size:0|font-size:1px/.test(st) || /preheader|preview-?text|hidden-?pre/.test(cls)) {
        var raw = el.textContent || '';
        var t = raw.replace(/[‌​͏  ­﻿]/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > 2) return { text: t, filler: /[‌͏ ­]|&zwnj;|&#847;|&#8199;/.test(raw + html.slice(0, 20000)) };
      }
    }
    return null;
  }

  // ---------- Merge tags ----------
  var PERSONAL = /first|last|^name|fname|lname|full_?name|city|company|title|nickname/i;

  function mergeTags(html) {
    var tags = {}, families = {};
    function add(tag, family, field, fallback) {
      var k = family + '|' + tag;
      if (!tags[k]) tags[k] = { tag: tag, family: family, field: field, fallback: fallback, count: 0 };
      tags[k].count++;
      families[family] = (families[family] || 0) + 1;
    }
    var m, re;
    // Ignore <style> blocks: minified CSS like {.a{x}}} looks like braces.
    var src = String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ');

    re = /\{\{\{?\s*([\s\S]{1,200}?)\s*\}?\}\}/g;
    while ((m = re.exec(src))) {
      var inner = m[1];
      if (/^[#\/^!]/.test(inner) || /^else\b/.test(inner)) continue; // handlebars blocks
      var field = (inner.match(/^\$?\{?\s*([a-zA-Z_][\w.]*)/) || [])[1] || inner.split(/[\s|]/)[0];
      var fb = /\|\s*default\s*[:(]|default\s*=|\|\s*d\s*:/i.test(inner);
      add('{{ ' + inner.trim() + ' }}', 'Double-brace (Liquid, Handlebars, Klaviyo, Braze, HubSpot, Veeva)', field, fb);
    }
    re = /\{%-?\s*([\s\S]{1,200}?)\s*-?%\}/g;
    while ((m = re.exec(src))) {
      var kw = m[1].split(/\s+/)[0];
      if (/^(if|elsif|else|endif|unless|endunless|for|endfor|assign|capture|endcapture|comment|endcomment|raw|endraw|case|when|endcase|abort_message)$/.test(kw)) continue;
      add('{% ' + m[1].trim() + ' %}', 'Double-brace (Liquid, Handlebars, Klaviyo, Braze, HubSpot, Veeva)', kw, true);
    }
    re = /\*\|\s*([A-Z0-9_:\-]+)\s*\|\*/g;
    while ((m = re.exec(src))) {
      if (/^(IF|ELSE|END|ELSEIF|IFNOT|INTERESTED)/.test(m[1])) continue;
      var guarded = new RegExp('\\*\\|(IF|IFNOT):' + m[1] + '\\b').test(src);
      add('*|' + m[1] + '|*', 'Mailchimp', m[1], guarded);
    }
    re = /%%=\s*([\s\S]{1,200}?)\s*=%%|%%([A-Za-z_][\w]*)%%/g;
    while ((m = re.exec(src))) {
      if (m[1]) { add('%%=' + m[1].trim() + '=%%', 'AMPscript (Salesforce Marketing Cloud)', (m[1].match(/@?\w+/) || [''])[0], /IIF|Empty|IsNull|Iif/i.test(m[1])); }
      else {
        var name = m[2];
        var guarded2 = new RegExp('(IIF|Empty|IsNull)\\s*\\(\\s*\\[?' + name, 'i').test(src);
        add('%%' + name + '%%', 'AMPscript (Salesforce Marketing Cloud)', name, guarded2 || !PERSONAL.test(name));
      }
    }
    if (/%%\[/.test(src)) families['AMPscript (Salesforce Marketing Cloud)'] = (families['AMPscript (Salesforce Marketing Cloud)'] || 0) + 1;

    var list = Object.keys(tags).map(function (k) { return tags[k]; });
    var issues = [];
    var fams = Object.keys(families);
    if (fams.length > 1) issues.push(issue('fix', 'Merge tags from ' + fams.length + ' platforms are mixed: ' + fams.map(function (f) { return f.split(' (')[0]; }).join(' and ') + '. Only one will render; the rest show as raw text.', '', 'merge'));

    function count(re) { return (src.match(re) || []).length; }
    if (count(/\{\{/g) !== count(/\}\}/g)) issues.push(issue('fix', 'Unbalanced {{ }}: ' + count(/\{\{/g) + ' opening vs ' + count(/\}\}/g) + ' closing.', '', 'merge'));
    if (count(/\{%/g) !== count(/%\}/g)) issues.push(issue('fix', 'Unbalanced {% %}: ' + count(/\{%/g) + ' opening vs ' + count(/%\}/g) + ' closing.', '', 'merge'));
    if (count(/%%\[/g) !== count(/\]%%/g)) issues.push(issue('fix', 'Unbalanced AMPscript block %%[ ]%%.', '', 'merge'));
    if (/\*\|\s+[A-Z]|[A-Z]\s+\|\*/.test(src)) issues.push(issue('fix', 'Mailchimp tag with spaces inside, like *| FNAME |*. Mailchimp won\'t replace it.', '', 'merge'));

    list.forEach(function (t) {
      if (PERSONAL.test(t.field || '') && !t.fallback) {
        var guardedIf = new RegExp('\\{%-?\\s*(if|unless)[^%]*' + String(t.field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|\\{\\{#if\\s+' + String(t.field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(src);
        if (!guardedIf) issues.push(issue('check', t.tag + ' has no fallback. Contacts without this field see a blank or "Hi ,".', '', 'merge'));
      }
    });
    return { tags: list, families: fams, issues: issues };
  }

  // ---------- Outlook, Gmail, dark mode ----------
  function clientChecks(doc, html) {
    var src = String(html);
    var styles = Array.prototype.map.call(doc.querySelectorAll('style'), function (s) { return s.textContent || ''; }).join('\n');
    var inline = Array.prototype.map.call(doc.querySelectorAll('[style]'), function (e) { return e.getAttribute('style'); }).join(';');
    var css = (styles + ';' + inline).toLowerCase();
    var outlook = [], gmail = [], dark = [];

    var opens = (src.match(/<!--\[if\b/gi) || []).length;
    var closes = (src.match(/<!\[endif\]/gi) || []).length;
    var msoCount = (src.match(/<!--\[if[^\]]*mso/gi) || []).length;
    if (opens !== closes) outlook.push(issue('fix', 'Unbalanced conditional comments: ' + opens + ' <!--[if ...]> vs ' + closes + ' <![endif]>. Outlook may hide or show the wrong content.'));
    else if (msoCount) outlook.push(issue('ok', msoCount + ' Outlook (mso) conditional block' + (msoCount > 1 ? 's' : '') + ', balanced.'));

    var vml = /<v:(roundrect|rect|fill|textbox|oval|image|shape)\b/i.test(src);
    var htmlTag = (src.match(/<html[^>]*>/i) || [''])[0];
    if (vml && !/xmlns:v\s*=/i.test(htmlTag)) outlook.push(issue('check', 'VML is used but the <html> tag has no xmlns:v. Outlook may ignore the VML.'));
    else if (vml) outlook.push(issue('ok', 'VML found with its namespace declared.'));
    if ((vml || doc.querySelectorAll('img').length) && !/PixelsPerInch/i.test(src)) outlook.push(issue('note', 'No OfficeDocumentSettings PixelsPerInch 96. Images can scale up on high-DPI Windows Outlook.'));
    if (/background-image\s*:|background\s*:[^;]*url\(/.test(css) || doc.querySelector('[background]')) {
      if (!vml) outlook.push(issue('check', 'Background image without a VML fallback. Classic Outlook on Windows won\'t show it.'));
    }
    if (/display\s*:\s*(flex|grid|inline-flex|inline-grid)/.test(css)) outlook.push(issue('check', 'display:flex or grid. Classic Outlook ignores it and Gmail support is limited. Use tables for layout.'));
    if (/position\s*:\s*(absolute|fixed)/.test(css)) outlook.push(issue('check', 'position:absolute or fixed is stripped or ignored by most email clients.'));
    if (/max-width\s*:/.test(css) && !msoCount) outlook.push(issue('check', 'max-width with no mso ghost tables. Classic Outlook ignores max-width, so the layout may stretch full width.'));
    if (/border-radius/.test(css)) outlook.push(issue('note', 'border-radius: corners are square in classic Outlook unless you use a VML button.'));
    if (doc.querySelector('button')) outlook.push(issue('check', '<button> elements aren\'t reliable in email. Use a link styled as a button.'));
    if (doc.querySelector('script')) outlook.push(issue('fix', '<script> is stripped by every email client, and some spam filters penalize it.'));
    if (doc.querySelector('form, input, select, textarea')) outlook.push(issue('check', 'Forms only work in a few clients (Apple Mail, some Outlook.com). Link to a web page instead.'));
    if (doc.querySelector('svg')) outlook.push(issue('check', 'Inline <svg> isn\'t supported in Gmail or classic Outlook. Use a PNG.'));
    if (doc.querySelector('video, iframe, object, embed')) outlook.push(issue('check', 'video, iframe and embed are blocked in most clients. Use an image linked to the video.'));
    if (/@font-face|fonts\.googleapis\.com/i.test(src)) outlook.push(issue('note', 'Web fonts: Outlook and Gmail fall back to your font stack. Make sure the fallback looks right.'));

    var styleLen = styles.length;
    if (styleLen > 16000) gmail.push(issue('check', 'Embedded CSS is ' + Math.round(styleLen / 1024) + 'KB. Gmail can drop very large <style> blocks. Inline critical styles.'));
    if (/<link[^>]+stylesheet/i.test(src)) gmail.push(issue('check', 'External stylesheet <link>. Most clients ignore it. Use <style> or inline styles.'));
    if (!doc.querySelector('style') && !inline) gmail.push(issue('note', 'No CSS found.'));

    var meta = /<meta[^>]+name=["']color-scheme["']/i.test(src);
    var supported = /<meta[^>]+name=["']supported-color-schemes["']/i.test(src);
    var mq = /prefers-color-scheme\s*:\s*dark/i.test(src);
    var ogsc = /\[data-ogs[cb]\]/i.test(src);
    if (!meta && !mq) dark.push(issue('check', 'No dark mode support. Gmail and Outlook will auto-invert colors, which can make logos and colored text hard to read.'));
    else {
      if (mq && !meta) dark.push(issue('check', 'Has dark mode styles but no <meta name="color-scheme" content="light dark">. Apple Mail may not apply them.'));
      if (meta && !supported) dark.push(issue('note', 'Add <meta name="supported-color-schemes" content="light dark"> for older Apple Mail.'));
      if (meta && mq) dark.push(issue('ok', 'color-scheme meta and dark mode styles found.'));
      if (!ogsc) dark.push(issue('note', 'No [data-ogsc] rules. Outlook.com and the Outlook apps ignore prefers-color-scheme and use these instead.'));
    }
    var logo = Array.prototype.some.call(doc.querySelectorAll('img'), function (i) { return /logo/i.test((i.getAttribute('src') || '') + ' ' + (i.getAttribute('alt') || '')); });
    if (logo) dark.push(issue('note', 'Check your logo on a dark background. A transparent PNG with dark text disappears in dark mode.'));
    return { outlook: outlook, gmail: gmail, dark: dark, hasDarkCss: mq };
  }

  // ---------- Everything ----------
  var SPAMMY = /\b(free!+|100% free|act now|buy now|order now|limited time only|urgent|winner|you('ve| have) won|risk[- ]free|guaranteed|cash bonus|no cost|double your|once in a lifetime|click below|don't delete)\b/gi;

  function analyze(html) {
    html = String(html || '');
    var doc = parse(html);
    if (!doc) throw new Error('Couldn\'t read that HTML.');
    var bytes = byteLength(html);
    var L = links(doc), I = images(doc), P = preheader(doc, html), M = mergeTags(html), C = clientChecks(doc, html);
    var items = [];

    // Size
    if (bytes >= CLIP) items.push(issue('fix', 'Gmail will clip this email: it\'s ' + (bytes / 1024).toFixed(0) + 'KB and Gmail cuts off at about 102KB, hiding your footer and unsubscribe link.', '', 'size'));
    else if (bytes >= CLIP_WARN) items.push(issue('check', 'Size is ' + (bytes / 1024).toFixed(0) + 'KB. Close to Gmail\'s ~102KB clip limit once your ESP adds tracking.', '', 'size'));

    // Unsubscribe
    var hasUnsub = L.some(function (l) { return l.unsub; }) || UNSUB_TAGS.test(html);
    if (!hasUnsub) items.push(issue('fix', 'No unsubscribe link found. It\'s required by law (CAN-SPAM, GDPR) and by Gmail and Yahoo for bulk mail.', '', 'unsub'));

    // Links
    var bad = L.filter(function (l) { return l.status === 'fix'; });
    if (bad.length) items.push(issue('fix', bad.length + ' broken or placeholder link' + (bad.length > 1 ? 's' : '') + ' (' + bad.map(function (l) { return l.href || 'no href'; }).slice(0, 3).join(', ') + ').', '', 'links'));
    var shorten = L.filter(function (l) { return /shortener/i.test(l.note); });
    if (shorten.length) items.push(issue('check', shorten.length + ' public link shortener' + (shorten.length > 1 ? 's' : '') + ' (' + shorten[0].host + '). Spam filters distrust these.', '', 'links'));
    var httpL = L.filter(function (l) { return l.note === 'Not https'; });
    if (httpL.length) items.push(issue('check', httpL.length + ' link' + (httpL.length > 1 ? 's use' : ' uses') + ' http instead of https.', '', 'links'));
    var web = L.filter(function (l) { return l.kind === 'web' && !l.unsub; });
    var noUtm = web.filter(function (l) { return !l.utm; });
    if (web.length && noUtm.length === web.length) items.push(issue('check', 'No UTM tracking on any of the ' + web.length + ' links. Clicks won\'t show up by campaign in analytics.', '', 'links'));
    else if (noUtm.length) items.push(issue('note', noUtm.length + ' of ' + web.length + ' links have no UTM parameters.', '', 'links'));
    var vague = L.filter(function (l) { return l.vague; });
    if (vague.length) items.push(issue('note', vague.length + ' vague link label' + (vague.length > 1 ? 's' : '') + ' ("' + vague[0].text + '"). Say where the link goes, for screen readers and clicks.', '', 'links'));
    var noText = L.filter(function (l) { return /No link text/.test(l.note); });
    if (noText.length) items.push(issue('check', noText.length + ' link' + (noText.length > 1 ? 's have' : ' has') + ' no text or image alt.', '', 'links'));

    // Images
    var noAlt = I.filter(function (i) { return !i.hasAlt; });
    if (noAlt.length) items.push(issue('fix', noAlt.length + ' image' + (noAlt.length > 1 ? 's have' : ' has') + ' no alt attribute. Screen readers read the file name, and images-off users see nothing.', '', 'images'));
    var noW = I.filter(function (i) { return !i.width; });
    if (noW.length) items.push(issue('check', noW.length + ' image' + (noW.length > 1 ? 's have' : ' has') + ' no width attribute. Outlook may blow them up to full size.', '', 'images'));
    var badSrc = I.filter(function (i) { return /data:|Not https|No src/.test(i.note); });
    if (badSrc.length) items.push(issue('check', badSrc.length + ' image source' + (badSrc.length > 1 ? 's' : '') + ' may be blocked (' + badSrc[0].note.toLowerCase() + ').', '', 'images'));
    var bodyText = textOf(doc.body);
    if (I.length && bodyText.length < 200) items.push(issue('check', 'Mostly images, little live text. Spam filters and images-off readers see almost nothing.', '', 'images'));

    // Preheader
    if (!P) items.push(issue('check', 'No preheader text. The inbox preview will show the first body text instead, often "View in browser".', '', 'preheader'));
    else if (P.text.length < 30) items.push(issue('note', 'Preheader is short (' + P.text.length + ' characters). Body text may fill the rest of the preview.', '', 'preheader'));
    else if (!P.filler) items.push(issue('note', 'Preheader has no spacer filler (&zwnj;&nbsp;), so body text may follow it in the preview.', '', 'preheader'));

    // Basics and accessibility
    if (!/^\s*<!doctype/i.test(html)) items.push(issue('note', 'No <!DOCTYPE>. Some clients render in quirks mode.', '', 'basics'));
    var htmlEl = doc.documentElement;
    if (!htmlEl.getAttribute('lang')) items.push(issue('check', 'No lang attribute on <html>. Screen readers may read it in the wrong language.', '', 'a11y'));
    if (!doc.querySelector('meta[charset], meta[http-equiv="Content-Type" i]')) items.push(issue('note', 'No charset meta. Special characters can break in some clients.', '', 'basics'));
    if (!doc.querySelector('meta[name="viewport"]')) items.push(issue('check', 'No viewport meta. Mobile clients may shrink the email.', '', 'mobile'));
    var tables = doc.querySelectorAll('table');
    var noRole = Array.prototype.filter.call(tables, function (t) { return t.getAttribute('role') !== 'presentation'; });
    if (noRole.length) items.push(issue('check', noRole.length + ' of ' + tables.length + ' tables lack role="presentation". Screen readers announce them as data tables.', '', 'a11y'));
    var fixedWide = Array.prototype.some.call(tables, function (t) {
      var w = parseInt(t.getAttribute('width'), 10);
      var sw = ((t.getAttribute('style') || '').match(/(?:^|;)\s*width\s*:\s*(\d+)px/i) || [])[1];
      return (w >= 480) || (sw && parseInt(sw, 10) >= 480);
    });
    var responsive = /@media[^{]*max-width/i.test(html) || /max-width\s*:\s*\d+/i.test(html);
    if (fixedWide && !responsive) items.push(issue('check', 'Fixed-width tables with no mobile handling (no @media or max-width). It will be wider than a phone screen.', '', 'mobile'));

    // Leftover placeholders
    var ph = bodyText.match(/\[(your|insert|add|enter)[^\]]{0,40}\]|lorem ipsum|\bTBD\b|\bXXX+\b|\bTK\b/i);
    if (ph) items.push(issue('fix', 'Placeholder text left in: "' + ph[0] + '".' + (/address/i.test(ph[0]) ? ' A real postal address is required by CAN-SPAM.' : ''), '', 'copy'));

    // Copy (from QA Copilot)
    var spam = (bodyText.match(SPAMMY) || []);
    var caps = (bodyText.match(/\b[A-Z]{4,}\b/g) || []).filter(function (w) { return !/^(HTML|UTM|USA|FAQ|RSVP|HTTPS?|NYC|LLC|INC|CTA|SMS)$/.test(w); });
    var bangs = (bodyText.match(/!{2,}/g) || []).length;
    if (spam.length || caps.length > 4 || bangs) items.push(issue('note', 'Copy that can look spammy: ' + [spam.length ? spam.slice(0, 3).map(function (s) { return '"' + s + '"'; }).join(', ') : '', caps.length > 4 ? caps.length + ' ALL-CAPS words' : '', bangs ? bangs + ' "!!"' : ''].filter(Boolean).join(', ') + '.', '', 'copy'));

    // Merge and client issues roll up too.
    M.issues.forEach(function (i) { items.push(i); });
    C.outlook.concat(C.gmail, C.dark).forEach(function (i) { if (i.level === 'fix' || i.level === 'check') items.push(Object.assign({ area: 'client' }, i)); });

    var order = { fix: 0, check: 1, note: 2, ok: 3 };
    items.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return {
      bytes: bytes, clip: bytes >= CLIP, links: L, images: I, preheader: P, merge: M, clients: C,
      items: items, status: worst(items), textLength: bodyText.length,
      counts: { fix: items.filter(function (i) { return i.level === 'fix'; }).length, check: items.filter(function (i) { return i.level === 'check'; }).length, note: items.filter(function (i) { return i.level === 'note'; }).length }
    };
  }

  var cache = {};
  MP.qa = {
    analyze: analyze,
    forTemplate: function (t) {
      var k = t.id + ':' + t.updated;
      if (!cache[k]) cache[k] = analyze(t.html);
      return cache[k];
    },
    worst: worst,
    CLIP: CLIP
  };
})(window.MP = window.MP || {});
