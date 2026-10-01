// FoE Reader – inject.js
// Běží v kontextu stránky (world: MAIN) ještě před hrou.
// Obaluje XMLHttpRequest a WebSocket, POUZE čte odpovědi a předává je panelu.
// Nic nemění a nic neodesílá.
(() => {
  'use strict';
  if (window.__foeReaderInstalled) return;
  window.__foeReaderInstalled = true;

  const SOURCE = 'foe-reader';

  function emit(channel, url, messages) {
    if (!Array.isArray(messages)) messages = [messages];
    window.postMessage({ source: SOURCE, channel, url, time: Date.now(), messages }, '*');
  }

  function parseJson(text) {
    if (typeof text !== 'string' || !text.length) return null;
    const c = text[0];
    if (c !== '[' && c !== '{') return null; // PING/PONG apod.
    try { return JSON.parse(text); } catch { return null; }
  }

  // ---------- Statická metadata z CDN (názvy budov apod.) ----------
  const isGameJson = (url) => /\/game\/json\?h=/.test(url);
  const isMetadata = (url) => /\/start\/metadata\?id=/.test(url);

  // ---------- XMLHttpRequest ----------
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url, ...rest) {
    try { this.__foeUrl = String(url); } catch { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.send = function (body) {
    const url = this.__foeUrl || '';
    if (isGameJson(url) || isMetadata(url)) {
      this.addEventListener('load', () => {
        try {
          let data = null;
          const rt = this.responseType;
          if (rt === '' || rt === 'text') data = parseJson(this.responseText);
          else if (rt === 'json') data = this.response;
          else if (rt === 'arraybuffer' && this.response) data = parseJson(new TextDecoder().decode(this.response));
          if (data == null) return;
          if (isGameJson(url)) emit('http', url, data);
          else emit('metadata', url, [{ metadataId: url.split('id=')[1], data }]);
        } catch (e) {
          console.warn('[FoE Reader] parse error', e);
        }
      });
    }
    return origSend.call(this, body);
  };

  // ---------- fetch (pro jistotu, kdyby hra přešla na fetch) ----------
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isGameJson(url)) {
        p.then((res) => res.clone().text())
          .then((t) => { const d = parseJson(t); if (d) emit('http', url, d); })
          .catch(() => {});
      }
    } catch { /* ignore */ }
    return p;
  };

  // ---------- WebSocket ----------
  const OrigWS = window.WebSocket;
  function WrappedWS(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    if (/forgeofempires\.com\/socket/.test(String(url))) {
      ws.addEventListener('message', (ev) => {
        const d = parseJson(ev.data);
        if (d) emit('ws', String(url), d);
      });
    }
    return ws;
  }
  WrappedWS.prototype = OrigWS.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) WrappedWS[k] = OrigWS[k];
  window.WebSocket = WrappedWS;

  console.log('[FoE Reader] odposlech aktivní (pouze čtení)');
})();
