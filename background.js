// FoE Reader – background.js (service worker)
// Systémová oznámení Chromu: okamžitá (z panelu) a naplánovaná přes chrome.alarms
// (sledované provincie GBG – alarm zazvoní přesně, i když je karta hry na pozadí přiškrcená).
// Nic neposílá na herní server.
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
