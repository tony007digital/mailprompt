/* mailprompt Klaviyo client.
   Talks to the small connector you run on your own computer
   (node connector/klaviyo-connect.js). Your Klaviyo key stays in that
   terminal; this page only ever sees the pairing code and your templates. */
(function (MP) {
  'use strict';

  var CODE_KEY = 'mailprompt.klaviyo';
  var BASE = 'http://127.0.0.1:8787';

  function getCode() { try { return localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; } }
  function setCode(c) { try { if (c) localStorage.setItem(CODE_KEY, c); else localStorage.removeItem(CODE_KEY); } catch (e) {} }

  function call(path) {
    var code = getCode();
    if (!code) return Promise.reject(new Error('Not paired yet. Start the connector, then type: connect klaviyo <pairing code>'));
    return fetch(BASE + path, { headers: { 'x-mailprompt-code': code } }).catch(function () {
      throw new Error('Can\'t reach the connector. In a terminal, run: node connector/klaviyo-connect.js');
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.status === 401) throw new Error('Pairing code doesn\'t match. Restarting the connector makes a new code; type: connect klaviyo <new code>');
        if (!res.ok) throw new Error(j.error || ('Connector error ' + res.status));
        return j;
      });
    });
  }

  MP.klaviyo = {
    base: BASE,
    getCode: getCode,
    setCode: setCode,
    paired: function () { return !!getCode(); },
    list: function () { return call('/klaviyo/templates').then(function (j) { return j.templates || []; }); },
    get: function (id) { return call('/klaviyo/templates/' + encodeURIComponent(id)); },
    check: function () { return call('/health'); }
  };
})(window.MP = window.MP || {});
