// FoE Reader – background.js (service worker)
// Systémová oznámení Chromu: okamžitá (z panelu) a naplánovaná přes chrome.alarms
// (sledované provincie GBG – alarm zazvoní přesně, i když je karta hry na pozadí přiškrcená).
// Jednou za pár hodin se zeptá GitHubu na číslo poslední verze (upozornění na aktualizaci). Nic neposílá na herní server.
'use strict';

const ICON = 'img/icon128.png';
const tabOf = async (id) => (await chrome.storage.session.get('n:' + id))['n:' + id] || null;

async function notify(id, title, message, tab) {
  if (tab) await chrome.storage.session.set({ ['n:' + id]: tab });
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 2, requireInteraction: true });
}

chrome.runtime.onMessage.addListener((m, sender) => {
  const tab = sender.tab ? { tabId: sender.tab.id, windowId: sender.tab.windowId } : null;
  if (m?.type === 'notify') notify('i' + Date.now(), m.title, m.message, tab);
  else if (m?.type === 'schedule' && m.key && m.when) {
    const name = 'w:' + m.key;
    chrome.storage.session.set({ [name]: { title: m.title, message: m.message, tab } });
    chrome.alarms.create(name, { when: Math.max(Date.now() + 1000, m.when) });
  } else if (m?.type === 'unschedule' && m.key) {
    chrome.alarms.clear('w:' + m.key);
    chrome.storage.session.remove('w:' + m.key);
  }
});

// Nová verze: číslo posledního vydání z GitHubu (výsledek se drží 6 hodin, aby se GitHub neptal zbytečně často).
const REL_API = 'https://api.github.com/repos/jbasta74/foe-reader/releases/latest';
async function latestRelease(force) {
  const c = (await chrome.storage.local.get('relCheck')).relCheck;
  if (!force && c && Date.now() - c.t < 6 * 3600e3) return c;
  try {
    const r = await fetch(REL_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return c || null;
    const j = await r.json();
    const zip = (j.assets || []).find((a) => a.name.endsWith('.zip'))?.browser_download_url || null;
    const v = { t: Date.now(), tag: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, zip };
    await chrome.storage.local.set({ relCheck: v });
    return v;
  } catch { return c || null; }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type !== 'checkUpdate') return false;
  latestRelease(!!m.force).then(reply, () => reply(null));
  return true;
});

chrome.alarms.onAlarm.addListener(async (a) => {
  const d = (await chrome.storage.session.get(a.name))[a.name];
  if (!d) return;
  await chrome.storage.session.remove(a.name);
  notify(a.name, d.title, d.message, d.tab);
});

// Klik na oznámení = přepnout na kartu s hrou.
chrome.notifications.onClicked.addListener(async (id) => {
  const t = await tabOf(id);
  chrome.notifications.clear(id);
  if (!t) return;
  try { await chrome.tabs.update(t.tabId, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); } catch { /* karta zavřená */ }
});
chrome.notifications.onClosed.addListener((id) => chrome.storage.session.remove('n:' + id));
