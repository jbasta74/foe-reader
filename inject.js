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
    // Odchozí dotaz hry jen přečteme (např. kterou budovu hráč otevřel). Nic se nemění.
    if (isGameJson(url) && body != null) {
      try {
        // Tělo může být text i binární pole (ArrayBuffer / Uint8Array).
        let text = null;
        if (typeof body === 'string') text = body;
        else if (body instanceof ArrayBuffer) text = new TextDecoder().decode(body);
        else if (ArrayBuffer.isView(body)) text = new TextDecoder().decode(body);
        const req = parseJson(text);
        if (req) emit('req', url, (Array.isArray(req) ? req : [req]).map((r) => ({
          requestClass: r.requestClass, requestMethod: r.requestMethod, requestData: r.requestData })));
      } catch { /* ignore */ }
    }
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
      if (isGameJson(url) || isMetadata(url)) {
        p.then((res) => res.clone().text())
          .then((t) => {
            const d = parseJson(t);
            if (!d) return;
            if (isGameJson(url)) emit('http', url, d);
            else emit('metadata', url, [{ metadataId: url.split('id=')[1], data: d }]);
          })
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

  // ---------- Ikony zboží (jen statické obrázky z CDN hry, žádný dotaz na herní server) ----------
  // Seznam souborů s hashi je ve skriptu klienta ForgeHX (stejně jako ho čte FoE Helper);
  // z něj se sestaví adresa atlasu ikon zboží a jeho JSON s pozicemi jednotlivých ikon.
  (async () => {
    try {
      let script = null;
      for (let i = 0; i < 600 && !script; i++) {
        script = document.querySelector('script[src*="ForgeHX"]');
        if (!script) await new Promise((r) => setTimeout(r, 500));
      }
      if (!script) return;
      const origin = new URL(script.src, document.baseURI).origin;
      const raw = await (await origFetch.call(window, script.src)).text();
      const start = raw.indexOf('baseUrl,');
      if (start < 0) return;
      let list = raw.substring(start + 'baseUrl,'.length);
      list = JSON.parse(list.substring(0, list.indexOf('}') + 1));
      const url = (path) => {
        const hash = list[path];
        if (!hash) return null;
        const dot = path.lastIndexOf('.');
        return `${origin}/assets${path.substring(0, dot)}-${hash}${path.substring(dot)}`;
      };
      const base = '/shared/icons/goods_large/fine_goods_large_0';
      const jsonUrl = url(base + '.json'), pngUrl = url(base + '.png');
      if (!jsonUrl || !pngUrl) return;
      const sprite = await (await origFetch.call(window, jsonUrl)).json();
      const frames = {};
      for (const f of sprite.frames || []) frames[f[0]] = [f[1], f[2], f[3], f[4], f[f.length - 1] === true];
      emit('assets', '', [{ goodsSprite: { png: pngUrl, w: sprite.size?.w, h: sprite.size?.h, frames } }]);
    } catch (e) {
      console.warn('[FoE Reader] ikony zboží se nepodařilo načíst', e);
    }
  })();

  console.log('[FoE Reader] odposlech aktivní (pouze čtení)');
})();
