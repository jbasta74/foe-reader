// FoE Reader – stats.js
// Úložiště statistik (vlastní vývoj a navštívená města) a nastavení.
//  - chrome.storage.local: hlavní místní kopie (v testu bez rozšíření localStorage);
//  - volitelně složka na disku (OneDrive / Google Drive / iCloud …) přes File System Access API:
//    jeden soubor na svět a hráče, při každém zápisu se nejdřív načte a sloučí (PC ↔ Mac);
//  - nastavení navíc přes chrome.storage.sync (účet prohlížeče) a do složky.
// Nic se neposílá na herní server.
(() => {
  'use strict';
  const VER = 1;
  const MAX_DAYS_VISIT = 120; // kolik dní historie držet u jednoho cizího hráče
  const hasChrome = () => { try { return !!chrome?.storage?.local; } catch { return false; } };

  // ---------- Místní úložiště ----------
  const local = {
    async get(k) {
      if (hasChrome()) { try { return (await chrome.storage.local.get(k))[k] ?? null; } catch { /* spadne do localStorage */ } }
      try { return JSON.parse(localStorage.getItem('foeReader_' + k) || 'null'); } catch { return null; }
    },
    async set(k, v) {
      if (hasChrome()) { try { await chrome.storage.local.set({ [k]: v }); return; } catch { /* dál */ } }
      try { localStorage.setItem('foeReader_' + k, JSON.stringify(v)); } catch { /* plné */ }
    },
  };

  // ---------- IndexedDB (jen pro uložení odkazu na vybranou složku) ----------
  const idb = (mode, fn) => new Promise((res, rej) => {
    const rq = indexedDB.open('foeReader', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => {
      try {
        const tx = rq.result.transaction('kv', mode);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(r?.result);
        tx.onerror = () => rej(tx.error);
      } catch (e) { rej(e); }
    };
  });
  const idbGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
  const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => null);
  const idbDel = (k) => idb('readwrite', (s) => s.delete(k)).catch(() => null);

  // ---------- Data ----------
  // {v, world, pid, name, own:{den:snap}, visits:{pid:{name, days:{den:snap}}}}
  let D = null, key = null, fileName = null, dirty = false;
  const listeners = [];
  const changed = () => listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
  const empty = (world, pid, name) => ({ v: VER, world, pid, name, own: {}, visits: {} });

  // Sloučení dvou kopií (místní + soubor / import): u každého dne vyhrává novější snímek.
  function merge(a, b) {
    if (!b || typeof b !== 'object') return a;
    for (const [d, s] of Object.entries(b.own || {})) if (!a.own[d] || (s?.t || 0) > (a.own[d].t || 0)) a.own[d] = s;
    for (const [pid, v] of Object.entries(b.visits || {})) {
      const t = (a.visits[pid] ||= { name: v.name, days: {} });
      for (const [d, s] of Object.entries(v.days || {})) if (!t.days[d] || (s?.t || 0) > (t.days[d].t || 0)) t.days[d] = s;
      const last = Object.values(t.days).sort((x, y) => y.t - x.t)[0];
      if (last?.name) t.name = last.name;
    }
    return a;
  }
  function prune() {
    for (const v of Object.values(D.visits)) {
      const ds = Object.keys(v.days).sort();
      for (const d of ds.slice(0, Math.max(0, ds.length - MAX_DAYS_VISIT))) delete v.days[d];
    }
  }

  // ---------- Složka ----------
  const fs = { handle: null, name: null, perm: 'none', last: 0, error: null, busy: false };
  const fsSupported = () => typeof window.showDirectoryPicker === 'function';
  async function perm(ask) {
    if (!fs.handle) return (fs.perm = 'none');
    try {
      const o = { mode: 'readwrite' };
      let p = await fs.handle.queryPermission(o);
      if (p !== 'granted' && ask) p = await fs.handle.requestPermission(o);
      return (fs.perm = p);
    } catch (e) { fs.error = String(e?.message || e); return (fs.perm = 'none'); }
  }
  async function readFile(name) {
    try { const fh = await fs.handle.getFileHandle(name); return JSON.parse(await (await fh.getFile()).text()); } catch { return null; }
  }
  async function writeFile(name, obj) {
    const fh = await fs.handle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj));
    await w.close();
  }
  // Načte soubor ze složky, sloučí s místními daty a uloží výsledek zpět.
  async function syncFolder() {
    if (!D || !fs.handle || fs.busy) return false;
    if ((await perm(false)) !== 'granted') { changed(); return false; }
    fs.busy = true;
    try {
      merge(D, await readFile(fileName));
      prune();
      await writeFile(fileName, D);
      if (settings.cfg) {
        const other = await readFile('foe-reader-nastaveni.json');
        if (other?.cfg && (other.t || 0) > (settings.t || 0)) applySettings(other);
        else await writeFile('foe-reader-nastaveni.json', { t: settings.t, cfg: settings.cfg });
      }
      await local.set(key, D);
      fs.last = Date.now(); fs.error = null; dirty = false;
      return true;
    } catch (e) { fs.error = String(e?.message || e); return false; } finally { fs.busy = false; changed(); }
  }

  // ---------- Ukládání se zpožděním ----------
  let tLocal = null, tFolder = null;
  function schedule() {
    dirty = true;
    clearTimeout(tLocal); tLocal = setTimeout(() => local.set(key, D), 2000);
    clearTimeout(tFolder); tFolder = setTimeout(() => { if (fs.handle) syncFolder(); }, 8000);
  }

  // ---------- Nastavení ----------
  const settings = { t: 0, cfg: null, apply: null };
  function applySettings(s) {
    settings.t = s.t; settings.cfg = s.cfg;
    if (settings.apply) settings.apply(s.cfg);
  }

  const safe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(0, 40);

  globalThis.FOE_STATS = {
    // Spustí se po načtení hráče (StartupService.getData).
    async init(world, pid, name) {
      const k = `stats_${world}_${pid}`;
      if (key === k && D) return D;
      key = k; fileName = `foe-reader-${safe(world)}-${safe(name) || pid}.json`;
      D = merge(empty(world, pid, name), await local.get(k));
      D.name = name;
      if (fsSupported()) {
        fs.handle = await idbGet('dir');
        fs.name = fs.handle?.name || null;
        if (fs.handle) await syncFolder();
      }
      changed();
      return D;
    },
    data: () => D,
    ready: () => !!D,
    fileName: () => fileName,
    putOwn(day, snap) { if (!D) return; D.own[day] = snap; schedule(); },
    putVisit(pid, day, snap) {
      if (!D || pid == null) return;
      const v = (D.visits[pid] ||= { name: snap.name, days: {} });
      v.name = snap.name || v.name; v.days[day] = snap; schedule();
    },
    onChange(f) { listeners.push(f); },
    // --- složka ---
    folder: () => ({ supported: fsSupported(), name: fs.name, perm: fs.perm, last: fs.last, error: fs.error, busy: fs.busy, dirty }),
    async pickFolder() {
      if (!fsSupported()) return false;
      try {
        const h = await window.showDirectoryPicker({ id: 'foe-reader', mode: 'readwrite' });
        fs.handle = h; fs.name = h.name; fs.error = null;
        await idbSet('dir', h);
        await perm(true);
        return syncFolder();
      } catch (e) { if (e?.name !== 'AbortError') fs.error = String(e?.message || e); changed(); return false; }
    },
    async grant() { if ((await perm(true)) === 'granted') return syncFolder(); changed(); return false; },
    sync: () => syncFolder(),
    async forgetFolder() { fs.handle = null; fs.name = null; fs.perm = 'none'; fs.last = 0; await idbDel('dir'); changed(); },
    // --- export / import ---
    exportJson: () => JSON.stringify(D, null, 1),
    importJson(text) {
      const o = JSON.parse(text);
      if (!o || typeof o !== 'object' || (!o.own && !o.visits)) throw new Error('Soubor neobsahuje statistiky FoE Readeru.');
      if (o.world && D.world && o.world !== D.world) throw new Error(`Soubor je ze světa ${o.world}, ne ${D.world}.`);
      merge(D, o); prune(); schedule(); changed();
    },
    // --- nastavení ---
    // apply(cfg) se zavolá, když se odjinud (synchronizace účtu / složka) načte novější nastavení.
    async initSettings(cfg, apply) {
      settings.apply = apply; settings.cfg = cfg; settings.t = cfg._t || 0;
      try {
        if (chrome?.storage?.sync) {
          const s = (await chrome.storage.sync.get('settings')).settings;
          if (s?.cfg && (s.t || 0) > settings.t) applySettings(s);
          chrome.storage.onChanged?.addListener((ch, area) => {
            const nv = area === 'sync' && ch.settings?.newValue;
            if (nv?.cfg && (nv.t || 0) > settings.t) applySettings(nv);
          });
        }
      } catch { /* bez rozšíření */ }
    },
    saveSettings(cfg) {
      settings.cfg = cfg; settings.t = cfg._t;
      try { chrome?.storage?.sync?.set({ settings: { t: cfg._t, cfg } }); } catch { /* limit / bez rozšíření */ }
      clearTimeout(tFolder); tFolder = setTimeout(() => { if (fs.handle) syncFolder(); }, 8000);
    },
  };
})();
