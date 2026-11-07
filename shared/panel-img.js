/* 판넬용 그림 보관(2026-11-07): /arch 조감도 탭 [판넬로 보내기] → 이 브라우저 IndexedDB 'jbs-panel-img'에 구역별로 한 장 → /panel이 열 때 읽음
   서버로 보내지 않음(작업 저장·불러오기 파일에도 안 들어감 — 다시 만들 수 있는 그림) */
(function (g) {
  const DB = 'jbs-panel-img', ST = 'img';
  const open = () => new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  async function put(id, blob, meta) { const db = await open(); return new Promise((ok, no) => { const t = db.transaction(ST, 'readwrite'); t.objectStore(ST).put(Object.assign({ blob, at: new Date().toISOString() }, meta || {}), String(id)); t.oncomplete = () => ok(true); t.onerror = () => no(t.error); }); }
  async function get(id) { try { const db = await open(); return await new Promise(ok => { const r = db.transaction(ST).objectStore(ST).get(String(id)); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch (e) { return null; } }
  g.JbsPanelImg = { put, get };
})(window);
