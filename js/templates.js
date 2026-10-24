/* mailprompt template library.
   Templates you paste, upload, pull from an .eml or import from Klaviyo are
   kept in this browser only (local storage). */
(function (MP) {
  'use strict';

  var KEY = 'mailprompt.templates';
  var list = [];
  var memoryOnly = false;

  function load() {
    try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(list)) list = []; }
    catch (e) { list = []; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(list)); memoryOnly = false; }
    catch (e) { memoryOnly = true; }
  }

  var STOP = { the: 1, a: 1, an: 1, my: 1, our: 1, email: 1, emails: 1, template: 1, templates: 1, html: 1, show: 1, me: 1, open: 1, qa: 1, check: 1, test: 1, preview: 1, and: 1, for: 1, of: 1, to: 1, review: 1, audit: 1 };
  function words(s) {
    return String(s || '').toLowerCase().replace(/\.(html?|eml)$/, '').split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1 && !STOP[w]; });
  }

  function nameFrom(html, fallback) {
    var t = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    var title = t ? t[1].replace(/\s+/g, ' ').trim() : '';
    if (title && title.length < 80 && !/^(email|untitled|document|\{\{)/i.test(title)) return title;
    return fallback || 'Pasted email';
  }

  function cleanName(fileName) {
    return String(fileName).replace(/\.(html?|eml|txt)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
  }

  function add(t) {
    var name = String(t.name || 'Untitled').slice(0, 120);
    var existing = list.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase() && x.source === t.source; })[0];
    if (existing) {
      existing.html = t.html; existing.updated = Date.now(); existing.meta = t.meta || existing.meta;
      persist();
      return existing;
    }
    // Avoid clobbering a different template with the same name.
    var taken = list.some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
    if (taken) {
      var n = 2;
      while (list.some(function (x) { return x.name.toLowerCase() === (name + ' ' + n).toLowerCase(); })) n++;
      name = name + ' ' + n;
    }
    var rec = { id: 'tpl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, html: String(t.html), source: t.source || 'paste', meta: t.meta || null, added: Date.now(), updated: Date.now() };
    list.unshift(rec);
    persist();
    return rec;
  }

  function get(id) { return list.filter(function (x) { return x.id === id; })[0] || null; }

  function remove(id) { list = list.filter(function (x) { return x.id !== id; }); persist(); }

  // Find the template a sentence refers to: every word of its name must appear.
  function find(text) {
    var have = {};
    words(text).forEach(function (w) { have[w] = true; });
    var best = null, bestLen = 0;
    list.forEach(function (t) {
      var w = words(t.name);
      if (!w.length) return;
      if (w.every(function (x) { return have[x]; }) && w.join(' ').length > bestLen) { best = t; bestLen = w.join(' ').length; }
    });
    return best;
  }

  function looksLikeHtml(text) {
    text = String(text || '');
    return text.length > 120 && /<(!doctype|html|body|table|td|div|p|img|a)\b/i.test(text) && /<\/(table|td|div|p|body|html|a)>/i.test(text);
  }

  load();
  MP.templates = {
    all: function () { return list.slice(); },
    add: add, get: get, remove: remove, find: find,
    nameFrom: nameFrom, cleanName: cleanName, looksLikeHtml: looksLikeHtml,
    get memoryOnly() { return memoryOnly; },
    reload: load
  };
})(window.MP = window.MP || {});
