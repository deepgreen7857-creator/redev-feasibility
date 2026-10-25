// 받은 자료를 이 브라우저(IndexedDB)에 보관해 두고, 접속할 때마다 전부 다시 받지 않게 한다.
//  자료가 바뀌는 때: 밤 수집(0~7시)·밤 예측(23:40). 그래서 '오늘 아침 7시 이후에 받은 것'이고 정해 둔 시간 안이면 그대로 쓴다.
//  저장이 안 되는 환경(사생활 보호 창 등)에서는 그냥 매번 받는다.
const DB = 'jbs-auction-cache'; const STORE = 'kv';
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function get(key) {
  const db = await open(); if (!db) return null;
  return new Promise((res) => { try { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } });
}
async function put(key, value) {
  const db = await open(); if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ at: Date.now(), value }, key); } catch { /* 저장 못 해도 화면은 동작 */ }
}
export async function clearCache() {
  const db = await open(); mem.clear(); if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch { /* 무시 */ }
}
// 오늘(한국 시각) 아침 7시 — 밤 수집이 끝나는 때. 이 전에 받은 자료는 새로 받는다
function morningCut() { const k = new Date(Date.now() + 9 * 3600e3); k.setUTCHours(7, 0, 0, 0); let t = k.getTime() - 9 * 3600e3; if (t > Date.now()) t -= 86400e3; return t; }
const mem = new Map(); // 같은 접속 안에서 화면을 옮겨 다닐 때 다시 받지 않게
export const cacheStamp = { at: null };
export async function cached(key, maxAgeMs, fetcher) {
  if (mem.has(key)) return mem.get(key);
  const hit = await get(key);
  if (hit && Date.now() - hit.at < maxAgeMs && hit.at >= morningCut()) { mem.set(key, hit.value); cacheStamp.at = Math.min(cacheStamp.at || hit.at, hit.at); return hit.value; }
  const value = await fetcher();
  mem.set(key, value); put(key, value); cacheStamp.at = cacheStamp.at || Date.now();
  return value;
}
export function forget(prefix) { [...mem.keys()].forEach((k) => { if (k.startsWith(prefix)) mem.delete(k); }); open().then((db) => { if (!db) return; try { const st = db.transaction(STORE, 'readwrite').objectStore(STORE); const r = st.openCursor(); r.onsuccess = () => { const c = r.result; if (!c) return; if (String(c.key).startsWith(prefix)) c.delete(); c.continue(); }; } catch { /* 무시 */ } }); }
export const HOUR = 3600e3;
