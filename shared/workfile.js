'use strict';
// 작업 저장·불러오기 — jbslab 모든 화면(사업성·/urban·/traffic·/env·/arch·/landscape) 오른쪽 아래 [작업] 버튼
//  작업 = 이 브라우저에 쌓인 검토 데이터 전체(정비계획 안 A~E·기반시설·공통 구역·1차/2차 배치·검토서 입력·사업성 프로젝트·가정값)
//  · 이 컴퓨터에 이름 붙여 저장(IndexedDB, 용량 제한 거의 없음) / 파일(.jbs.json)로 내려받기
//  · 불러오기 전·새 작업 시작 전에는 지금 상태를 '자동 백업'으로 먼저 저장(최근 3개)
//  · 다시 받을 수 있는 자료(브이월드 조회 캐시·주변 건물)는 넣지 않음
//  · 다른 컴퓨터와 이어서 하기(2026-11-08): 화면을 열 때 홈페이지의 최근 버전이 다른 컴퓨터 것이면 위쪽 띠로 알리고 한 번 눌러 이어받음(checkNewer)
//  · 온라인 저장(2026-11-04): 관리자 로그인(gate.js와 같은 Firebase 프로젝트)으로 Firestore 'jbsWork'(관리자만 읽고 씀)에 이름 붙여 저장 → 어느 컴퓨터에서나 불러오기
//    큰 작업은 700KB씩 나눠 'jbsWork/{id}/chunks'에. 파일·온라인 모두 토지조서가 들어 있을 수 있으니 외부로 보내지 말 것
(function (g) {
  if (g.JbsWork) return;
  const FORMAT = 'jbs-work', VERSION = 1, DB = 'jbs-work', STORE = 'slots';
  const EXCLUDE = /cache|-ui$|split|legend|auction|auth|gate|token|firebase|C-sample/i;
  const isWorkKey = k => (/^jbs[-.]/.test(k) || k === 'jbsc.project.v1') && !EXCLUDE.test(k);
  const KEEP_ON_NEW = ['jbs-feas-assume-v1']; // 새 작업에도 그대로 둘 것(사업성 가정값은 사람마다의 기본값)
  const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB';

  /* ---------- 지금 작업 모으기 ---------- */
  function snapshot(name) {
    const keys = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!isWorkKey(k)) continue;
      let v = localStorage.getItem(k);
      if (k === 'jbs.sites.v1') { // 주변 건물(다시 불러올 수 있음)은 빼고
        try { const o = JSON.parse(v); Object.values(o.sites || {}).forEach(s => { delete s.context; }); v = JSON.stringify(o); } catch (e) { /* 그대로 */ }
      }
      keys[k] = v;
    }
    return { format: FORMAT, version: VERSION, name: name || guessName(), savedAt: now(), keys };
  }
  function guessName() {
    const j = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const z = j('jbs-urban-zones-v1'), p = j('jbsc.project.v1'), s = j('jbs.sites.v1'), cur = localStorage.getItem('jbs.sites.current');
    const site = s && s.sites && cur && s.sites[cur];
    // 주소만 넣은 사업성 작업은 위치(괄호 안 단지 이름 우선)로 이름 붙임
    const loc = p && p.meta && p.meta.location ? String(p.meta.location) : '', apt = (loc.match(/\(([^)]*)\)/) || [])[1];
    const locName = apt ? apt.split(',').pop().trim() : loc.replace(/^인천광역시\s*|^서울특별시\s*/, '').replace(/\s*일대$/, '');
    const pj = j('jbs.project.v1');   // 공통 사업명(shared/project.js)이 원본 — 먼저
    return (pj && pj.name) || (z && z.title) || (p && p.meta && p.meta.name !== '새 정비사업' && p.meta.name) || locName || (site && site.name !== '새 정비사업' && site.name) || '이름 없는 작업';
  }
  function summary(snap) {
    const k = snap.keys || {}, j = x => { try { return JSON.parse(k[x] || 'null'); } catch (e) { return null; } };
    const z = j('jbs-urban-zones-v1'), s = j('jbs.sites.v1'), out = [];
    const zs = z && z.zones ? Object.keys(z.zones).filter(id => z.zones[id] && z.zones[id].geojson) : [];
    if (zs.length) out.push(`정비계획 ${zs.join('·')}안`);
    const sites = s && s.sites ? Object.values(s.sites) : [];
    const st = sites.filter(x => x.arch && x.arch.stages);
    if (sites.length) out.push(`구역 ${sites.length}개`);
    if (st.length) out.push(`확정 배치 ${st.map(x => Object.keys(x.arch.stages).map(n => n + '차').join('·')).join(', ')}`);
    if (k['jbsc.project.v1']) { const p = j('jbsc.project.v1'); const a = p && p.area && (p.area.drawnArea || 0); out.push('사업성 프로젝트' + (a ? ` 구역 ${Math.round(a).toLocaleString()}㎡` : '')); }
    return out.join(' · ') || '빈 작업';
  }

  /* ---------- 이 컴퓨터 저장소(IndexedDB) ---------- */
  function db() {
    return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function tx(mode, fn) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); }
  const listSlots = async () => (await tx('readonly', st => st.getAll())).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  const putSlot = slot => tx('readwrite', st => st.put(slot));
  const delSlot = id => tx('readwrite', st => st.delete(id));
  async function saveSlot(name, auto) {
    const snap = snapshot(name), id = auto ? 'auto:' + Date.now() : 'name:' + snap.name;
    await putSlot(Object.assign({ id, auto: !!auto }, snap));
    if (auto) { const a = (await listSlots()).filter(x => x.auto && !x.ver); for (const x of a.slice(3)) await delSlot(x.id); }
    return snap;
  }

  /* ---------- 온라인 저장(Firestore, 관리자 전용) ---------- */
  const FBV = '10.12.2', CFG = { apiKey: 'AIzaSyAaqAP7371502cfR3OpnYC33tTfE7EeqtI', authDomain: 'jbslab-auction.firebaseapp.com', projectId: 'jbslab-auction', appId: '1:780407673324:web:0506b356fb74a8c68a30c9' };
  const CHUNK = 700000;
  let FB = null;
  async function fb() {
    if (FB) return FB;
    const [A, U, F] = await Promise.all(['app', 'auth', 'firestore'].map(m => import(`https://www.gstatic.com/firebasejs/${FBV}/firebase-${m}.js`)));
    const app = A.getApps().length ? A.getApp() : A.initializeApp(CFG), auth = U.getAuth(app);
    if (!auth.currentUser) await new Promise(res => { const off = U.onAuthStateChanged(auth, () => { off(); res(); }); setTimeout(res, 4000); });
    if (!auth.currentUser) throw new Error('관리자로 로그인해야 온라인 저장을 쓸 수 있습니다');
    FB = { F, db: F.getFirestore(app), user: auth.currentUser };
    return FB;
  }
  const cloudId = name => 'w_' + Date.now() + '_' + String(name).replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 20);
  async function cloudSave(name, auto, kind) { return cloudPut(snapshot(name), auto, kind); }
  // 저장 위치: 'jbsWork' 컬렉션(전용 규칙). 규칙이 아직 배포 안 됐으면(권한 없음) 관리자 전용 'adminAlerts'에
  //  'jbsw_' 이름으로 임시 보관(resolved 필드가 없어 경매 화면 알림 목록에는 안 나옴). 목록·불러오기는 두 곳을 합쳐 보여 줌
  let MODE = null;
  async function mode() {
    if (MODE) return MODE;
    const { F, db } = await fb();
    try { await F.getDocs(F.query(F.collection(db, 'jbsWork'), F.limit(1))); MODE = 'main'; }
    catch (e) { MODE = /permission/i.test(e.message || e.code || '') ? 'alt' : 'main'; }
    return MODE;
  }
  const ALT = 'adminAlerts';
  async function cloudPut(snap, auto, kind) {
    const { F, db, user } = await fb(), M = await mode(), body = JSON.stringify(snap), id = cloudId(snap.name);
    const parts = []; for (let i = 0; i < body.length; i += CHUNK) parts.push(body.slice(i, i + CHUNK));
    const meta = { name: snap.name, savedAt: snap.savedAt, summary: summary(snap), size: body.length, n: parts.length, auto: !!auto, kind: kind || (auto ? 'backup' : 'manual'), hash: hashOf(snap), by: user.email, at: F.serverTimestamp() };
    if (M === 'main') {
      for (let i = 0; i < parts.length; i++) await F.setDoc(F.doc(db, 'jbsWork', id, 'chunks', String(i)), { d: parts[i] });
      await F.setDoc(F.doc(db, 'jbsWork', id), meta);
    } else {
      for (let i = 0; i < parts.length; i++) await F.setDoc(F.doc(db, ALT, `jbsw_${id}_c${i}`), { jbsWorkChunk: true, d: parts[i] });
      await F.setDoc(F.doc(db, ALT, `jbsw_${id}`), Object.assign({ jbsWork: true }, meta));
    }
    return snap;
  }
  async function cloudList() {
    const { F, db } = await fb(), out = [];
    try { (await F.getDocs(F.query(F.collection(db, 'jbsWork'), F.orderBy('savedAt', 'desc'), F.limit(400)))).docs.forEach(d => out.push(Object.assign({ id: d.id }, d.data()))); } catch (e) { /* 규칙 배포 전 */ }
    try { (await F.getDocs(F.query(F.collection(db, ALT), F.where('jbsWork', '==', true)))).docs.forEach(d => out.push(Object.assign({ id: 'alt:' + d.id.slice(5) }, d.data()))); } catch (e) { /* 무시 */ }
    return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }
  const ref = (F, db, id, i) => id.startsWith('alt:') ? F.doc(db, ALT, 'jbsw_' + id.slice(4) + (i === undefined ? '' : '_c' + i)) : (i === undefined ? F.doc(db, 'jbsWork', id) : F.doc(db, 'jbsWork', id, 'chunks', String(i)));
  async function cloudGet(id) {
    const { F, db } = await fb(), m = (await F.getDoc(ref(F, db, id))).data(); if (!m) throw new Error('없는 작업입니다');
    let body = ''; for (let i = 0; i < m.n; i++) body += (await F.getDoc(ref(F, db, id, i))).data().d;
    return check(JSON.parse(body));
  }
  async function cloudDel(id) {
    const { F, db } = await fb(), m = (await F.getDoc(ref(F, db, id))).data();
    for (let i = 0; i < ((m && m.n) || 0); i++) await F.deleteDoc(ref(F, db, id, i));
    await F.deleteDoc(ref(F, db, id));
  }
  // 내용 지문(이름·저장 시각 제외) — 바뀐 게 있을 때만 자동 버전을 남김
  function hashOf(snap) {
    const k = snap.keys || {}, str = Object.keys(k).sort().map(x => x + '=' + k[x]).join('\n');
    let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + str.length;
  }
  /* ---------- 자동 버전(사용자 요구 2026-11-04: '항상 모든 버전을 홈페이지에 저장') ----------
     작업 내용이 바뀌면 1분 동안 더 바뀌지 않을 때(또는 창을 닫거나 다른 탭으로 갈 때) 홈페이지에 새 버전으로 저장. 지우지 않고 모두 쌓음 */
  const LAST = 'jbsw:lastCloudHash';   // 작업 키(jbs-·jbs.)가 아니라 작업에 안 들어감
  let verTimer = null, verBusy = false, lastSeen = '';
  async function autoVersion(reason) {
    if (holdUpload) return;   // 다른 컴퓨터 최신 작업을 물어보는 중 — 이 컴퓨터 옛 작업을 맨 위에 올려 덮지 않게
    if (verBusy) { setTimeout(() => autoVersion(reason), 3000); return; }
    const snap = snapshot(); if (summary(snap) === '빈 작업') return;
    // 예시 불러오기로 연 예시 사업만 있는 상태는 버전으로 쌓지 않음(언제든 다시 불러올 수 있고, 실제 작업 목록을 헷갈리게 함)
    try { const pj = JSON.parse((snap.keys || {})['jbsc.project.v1'] || 'null'), nm = pj && (pj.meta || (pj.state || {}).meta || {}).name; if (/\(예시\)\s*$/.test(String(nm || '')) && !(snap.keys || {})['jbs-urban-zones-v1']) return; } catch (e) { /* 무시 */ }
    const h = hashOf(snap); if (h === localStorage.getItem(LAST)) return;
    verBusy = true;
    try {
      await cloudPut(snap, true, 'version'); localStorage.setItem(LAST, h); setBtn('홈페이지에 자동 저장됨 ' + now().slice(11));
      await flushPending();
    } catch (e) {
      // 홈페이지에 못 올리면(인터넷·권한) 이 컴퓨터에 버전으로 남겨 두고, 다음에 올라가면 함께 올림 — 버전을 잃지 않게
      console.warn('자동 버전 홈페이지 저장 실패(' + reason + ')', e);
      try { await putSlot(Object.assign({ id: 'ver:' + Date.now(), auto: true, ver: true, pending: true }, snap)); localStorage.setItem(LAST, h); setBtn('이 컴퓨터에 자동 저장됨 ' + now().slice(11) + ' (홈페이지 대기)'); }
      catch (e2) { setBtn('자동 저장 실패 — 눌러서 확인'); }
    } finally { verBusy = false; }
  }
  async function flushPending() {
    const P = (await listSlots()).filter(x => x.pending).sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    for (const x of P) { const snap = { format: x.format, version: x.version, name: x.name, savedAt: x.savedAt, keys: x.keys }; await cloudPut(snap, true, 'version'); await putSlot(Object.assign({}, x, { pending: false })); }
  }
  function setBtn(t) { if (!btn || full) return; btn.textContent = '작업 저장·불러오기 · ' + t; }
  // 구역계 지문: 사업성 구역(jbsc.project.v1 area.geojson)·정비계획 안(A~E geojson)·공통 구역 도형만 모음
  //  사용자 요구(2026-11-04): '구역은 조금이라도 바뀔 때마다 다른 버전으로 저장' → 구역이 바뀌면 1분 기다리지 않고 바로(3초 묶음) 새 버전
  function zoneHash() {
    const j = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const p = j('jbsc.project.v1'), z = j('jbs-urban-zones-v1'), st = j('jbs.sites.v1'), parts = [];
    if (p && p.area && p.area.geojson) parts.push('main=' + JSON.stringify(p.area.geojson));
    if (z && z.zones) Object.keys(z.zones).sort().forEach(k => { if (z.zones[k] && z.zones[k].geojson) parts.push(k + '=' + JSON.stringify(z.zones[k].geojson)); });
    if (st && st.sites) Object.keys(st.sites).sort().forEach(k => { const g = st.sites[k] && (st.sites[k].geojson || st.sites[k].geo); if (g) parts.push('s' + k + '=' + JSON.stringify(g)); });
    const str = parts.join('|'); let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + str.length;
  }
  let lastZone = null, zoneTimer = null;
  function watch() {
    setInterval(() => {
      let h = '', zh = ''; try { h = hashOf(snapshot()); zh = zoneHash(); } catch (e) { return; }
      if (lastZone === null) lastZone = zh;
      if (zh !== lastZone) { // 구역이 바뀜 → 바로 새 버전
        lastZone = zh; lastSeen = h; clearTimeout(verTimer); clearTimeout(zoneTimer);
        zoneTimer = setTimeout(() => autoVersion('구역 변경'), 3000); setBtn('구역 변경 — 저장 중');
        return;
      }
      if (h !== lastSeen) { lastSeen = h; clearTimeout(verTimer); verTimer = setTimeout(() => autoVersion('변경 후 1분'), 60000); if (h !== localStorage.getItem(LAST)) setBtn('저장 대기'); }
    }, 2000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoVersion('창 숨김'); });
    // 열 때: 먼저 다른 컴퓨터에서 더 최근에 올린 작업이 있는지 보고, 없을 때만 못 올린 버전을 올림
    setTimeout(() => { checkNewer('열 때').then(shown => { if (!shown) return flushPending().then(() => autoVersion('열 때')); }).catch(() => { /* 다음에 */ }); }, 2500);
    // 다른 컴퓨터에서 일하다 이 창으로 돌아오면 다시 확인(1분에 한 번까지)
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) { lastCheck = Date.now(); checkNewer('돌아옴').catch(() => { /* 무시 */ }); } });
  }

  /* ---------- 다른 컴퓨터와 이어서 하기(2026-11-08, 사용자 요구 '노트북·미니PC 어디서 열어도 이어지게') ----------
     작업은 바뀔 때마다 홈페이지에 자동 버전으로 올라감(위 autoVersion). 여기서는 반대로, 화면을 열 때 홈페이지의 가장 최근 버전이
     이 컴퓨터가 마지막으로 올린 것과 다르면(= 다른 컴퓨터가 그 뒤에 올림) 위쪽 띠로 알리고 한 번 눌러 이어받게 한다.
     · 이 컴퓨터에 아직 안 올린 변경이 있으면 그 사실도 띠에 적고, 이어받기 전에 자동 백업(이 컴퓨터+홈페이지)
     · [이 컴퓨터 것 계속]을 누르면 그 버전은 다시 묻지 않음(jbsw:skipHash), 이 컴퓨터 작업이 새 버전으로 올라감
     · 띠가 떠 있는 동안은 자동 올리기를 멈춤 */
  const SKIP = 'jbsw:skipHash';
  let holdUpload = false, bar = null;
  async function checkNewer(reason) {
    let L; try { L = await cloudList(); } catch (e) { return false; }   // 로그인 안 함·인터넷 없음 → 조용히 넘어감
    // 순서는 홈페이지 기록 시각(at, 밀리초)으로 — savedAt은 분 단위라 같은 분에 두 컴퓨터가 올리면 앞뒤를 못 가림
    const t = x => (x.at && typeof x.at.toMillis === 'function') ? x.at.toMillis() : (x.at && x.at.seconds) ? x.at.seconds * 1000 : (typeof x.at === 'number' ? x.at : Date.parse(String(x.savedAt).replace(' ', 'T')) || 0);
    const latest = L.filter(x => x && x.hash && (x.kind === 'version' || x.kind === 'manual')).sort((a, b) => t(b) - t(a))[0];
    if (!latest) return false;
    const cur = snapshot(), curH = hashOf(cur), last = localStorage.getItem(LAST);
    if (latest.hash === curH) { localStorage.setItem(LAST, curH); return false; }   // 이미 같음
    if (latest.hash === last || localStorage.getItem(SKIP) === latest.hash) return false;   // 이 컴퓨터가 올린 게 최신이거나, 이미 '계속 쓰기'를 고름
    showBar(latest, summary(cur) !== '빈 작업' && curH !== last, reason);
    return true;
  }
  function showBar(latest, dirty, reason) {
    holdUpload = true;
    if (!document.body) return;
    if (!bar) {
      const st = document.createElement('style');
      st.textContent = `#jbsSyncBar{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9500;width:min(760px,calc(100vw - 24px));background:#fff8e6;color:#3b2f12;border:1px solid #e0b64a;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px 14px;font:13.5px/1.5 'IBM Plex Sans KR','Malgun Gothic',sans-serif}
#jbsSyncBar b{font-weight:700}#jbsSyncBar .r{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}#jbsSyncBar button{font:inherit;padding:6px 12px;border-radius:7px;border:1px solid #9a8a5a;background:#fff;color:#3b2f12;cursor:pointer}#jbsSyncBar button.p{background:#1d2a33;color:#fff;border-color:#1d2a33}#jbsSyncBar .w{color:#b3261e}
@media print{#jbsSyncBar{display:none}}`;
      document.head.appendChild(st);
      bar = document.createElement('div'); bar.id = 'jbsSyncBar'; bar.setAttribute('role', 'alert'); document.body.appendChild(bar);
    }
    bar.innerHTML = `<div><b>다른 컴퓨터에서 더 최근에 저장한 작업이 있습니다.</b> '${esc(latest.name)}' · ${esc(latest.savedAt)}<br><span>${esc(latest.summary || '')}</span></div>`
      + (dirty ? `<div class="w">이 컴퓨터에도 아직 홈페이지에 안 올라간 변경이 있습니다. 이어받으면 이 컴퓨터 것은 자동 백업한 뒤 바꿉니다.</div>` : '')
      + `<div class="r"><button class="p" data-s="take">그 작업으로 이어서 하기</button><button data-s="keep">이 컴퓨터 것 계속 쓰기</button></div>`;
    bar.hidden = false;
    bar.onclick = async e => {
      const w = e.target && e.target.dataset && e.target.dataset.s; if (!w) return;
      if (w === 'take') {
        bar.querySelectorAll('button').forEach(b => { b.disabled = true; }); e.target.textContent = '받는 중…';
        try {
          const snap = await cloudGet(latest.id);
          if (dirty) await backup('불러오기 전 자동 백업');
          apply(snap); localStorage.setItem(LAST, hashOf(snap)); location.reload();
        } catch (er) { bar.querySelector('.r').insertAdjacentHTML('beforebegin', `<div class="w">받지 못했습니다: ${esc(er.message)}</div>`); bar.querySelectorAll('button').forEach(b => { b.disabled = false; }); e.target.textContent = '그 작업으로 이어서 하기'; }
      } else {
        localStorage.setItem(SKIP, latest.hash); bar.hidden = true; holdUpload = false;
        flushPending().then(() => autoVersion('이 컴퓨터 것 계속')).catch(() => { /* 다음에 */ });
      }
    };
  }

  // 지우기 전 자동 백업: 이 컴퓨터 + 온라인(실패해도 이 컴퓨터 백업은 남음)
  async function backup(label) {
    const name = guessName() + ' (' + label + ')';
    try { await saveSlot(name, true); } catch (e) { /* 무시 */ }
    try { await cloudSave(name, true); return true; } catch (e) { console.warn('온라인 백업 실패', e); return false; }
  }

  /* ---------- 되돌려 놓기 ---------- */
  function check(snap) { if (!snap || snap.format !== FORMAT || !snap.keys) throw new Error('jbslab 작업 파일이 아닙니다'); return snap; }
  function apply(snap) {
    check(snap);
    const old = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isWorkKey(k) && !KEEP_ON_NEW.includes(k)) old.push(k); }
    old.forEach(k => localStorage.removeItem(k));
    Object.entries(snap.keys).forEach(([k, v]) => { if (isWorkKey(k) && typeof v === 'string') localStorage.setItem(k, v); });
  }
  function clearWork() {
    const old = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isWorkKey(k) && !KEEP_ON_NEW.includes(k)) old.push(k); }
    old.forEach(k => localStorage.removeItem(k));
    try { localStorage.removeItem('jbs-urban-cache-v1'); } catch (e) { /* 무시 */ }
  }
  function download(snap) {
    const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${snap.name.replace(/[\\/:*?"<>|]/g, '_')}_${snap.savedAt.replace(/[: ]/g, '')}.jbs.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function used() { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length) * 2; } return n; }

  /* ---------- 화면: 오른쪽 아래 [작업] ---------- */
  let box, btn, full = false;
  function ui() {
    if (btn || !document.body) return;
    const css = document.createElement('style');
    css.textContent = `#jbsWorkBtn{position:fixed;right:16px;bottom:16px;z-index:9000;font:600 13px/1 'IBM Plex Sans KR','Malgun Gothic',sans-serif;padding:10px 14px;border-radius:999px;border:1px solid #1d2a33;background:#1d2a33;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer}
#jbsWorkBtn.full{background:#c8322b;border-color:#c8322b}
#jbsWork{position:fixed;right:16px;bottom:62px;z-index:9001;width:min(420px,calc(100vw - 32px));max-height:min(70vh,640px);overflow:auto;background:#fbfbf8;color:#1d2a33;border:1px solid #c9c9c0;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:14px 16px;font:14px/1.5 'IBM Plex Sans KR','Malgun Gothic',sans-serif}
#jbsWork h3{margin:0 0 6px;font-size:15px}#jbsWork .n{color:#5d666c;font-size:12.5px}#jbsWork .row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
#jbsWork button{font:inherit;font-size:13px;padding:6px 10px;border-radius:7px;border:1px solid #9aa2a6;background:#fff;color:#1d2a33;cursor:pointer}#jbsWork button.p{background:#1d2a33;color:#fff;border-color:#1d2a33}
#jbsWork ul{list-style:none;margin:6px 0 0;padding:0}#jbsWork li{border-top:1px solid #e3e3dc;padding:8px 0}#jbsWork li b{display:block}#jbsWork .warn{color:#c8322b;font-size:12.5px}
@media (prefers-color-scheme:dark){#jbsWork{background:#1f2629;color:#e8ebe9;border-color:#3b4549}#jbsWork button{background:#2a3236;color:#e8ebe9;border-color:#4c575c}#jbsWork .n{color:#a9b2b6}#jbsWork li{border-color:#3b4549}}`;
    document.head.appendChild(css);
    btn = document.createElement('button'); btn.id = 'jbsWorkBtn'; btn.type = 'button'; btn.textContent = '작업 저장·불러오기';
    btn.onclick = () => { if (box && !box.hidden) { box.hidden = true; return; } open(); };
    document.body.appendChild(btn);
    box = document.createElement('div'); box.id = 'jbsWork'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '작업 저장·불러오기');
    document.body.appendChild(box);
    box.addEventListener('click', onClick);
  }
  async function open(note) {
    let slots = []; try { slots = await listSlots(); } catch (e) { slots = null; }
    const cur = snapshot(), u = used();
    box.innerHTML = `<h3>지금 작업: ${esc(cur.name)}</h3>
      <div class="n">${esc(summary(cur))} · 브라우저 저장 공간 ${kb(u)} / 약 5MB${u > 4.2e6 ? ' <span class="warn">— 거의 찼습니다. 저장한 뒤 정리하세요</span>' : ''}</div>
      ${full ? '<div class="warn">브라우저 저장 공간이 꽉 차서 방금 내용이 저장되지 못했습니다. 아래 [파일로 내려받기]로 먼저 보관하세요.</div>' : ''}
      ${note ? `<div class="n" style="margin-top:6px;color:#0f6b3a">${esc(note)}</div>` : ''}
      <div class="row"><button class="p" data-w="csave">홈페이지에 저장(온라인)</button><button data-w="save">이 컴퓨터에 저장</button><button data-w="file">파일로 내려받기</button><button data-w="load">파일에서 불러오기</button><button data-w="new">새 작업 시작</button></div>
      <div class="n">저장하면 이름별로 아래 목록에 남고, 불러오면 모든 화면(정비계획·검토서·개략 건축계획·사업성)이 그 상태로 돌아갑니다. <b>홈페이지에 저장</b>한 작업은 어느 컴퓨터에서나(관리자 로그인) 불러올 수 있습니다. 배치안 목록·일조 결과는 [배치안 만들기]·[일조 계산]을 다시 누르면 나옵니다.</div>
      <h3 style="margin-top:12px">홈페이지에 저장된 작업 <span class="n">(바뀔 때마다 자동 저장 · 모든 버전 보관)</span></h3><div id="jbsCloudList" class="n">불러오는 중…</div>
      <h3 style="margin-top:12px">이 컴퓨터에 저장된 작업</h3>
      ${slots === null ? '<div class="warn">이 브라우저에서는 저장 목록을 쓸 수 없습니다(사생활 보호 창 등). 파일로 내려받으세요.</div>'
        : slots.length ? `<ul>${slots.map(s => `<li><b>${esc(s.name)}${s.ver ? ` <span class="n">(자동 버전${s.pending ? ' · 홈페이지 올리기 대기' : ''})</span>` : s.auto ? ' <span class="n">(자동 백업)</span>' : ''}</b><span class="n">${esc(s.savedAt)} · ${esc(summary(s))}</span>
          <div class="row"><button data-w="open" data-id="${esc(s.id)}">불러오기</button><button data-w="dl" data-id="${esc(s.id)}">파일</button><button data-w="del" data-id="${esc(s.id)}">지우기</button></div></li>`).join('')}</ul>` : '<div class="n">아직 없습니다.</div>'}
      <input type="file" accept=".json,application/json" hidden id="jbsWorkFile">`;
    box.hidden = false;
    cloudList().then(L => {
      const el = box.querySelector('#jbsCloudList'); if (!el) return;
      const item = s => `<li><b>${esc(s.savedAt)}${s.kind === 'version' ? '' : s.auto ? ' <span class="n">(지우기 전 백업)</span>' : ' <span class="n">(직접 저장)</span>'}</b><span class="n">${esc(s.summary || '')} · ${kb(s.size || 0)}</span>
        <div class="row"><button data-w="copen" data-id="${esc(s.id)}">이 버전 불러오기</button><button data-w="cdl" data-id="${esc(s.id)}">파일</button><button data-w="cdel" data-id="${esc(s.id)}">지우기</button></div></li>`;
      const base = n => String(n || '').replace(/ \((불러오기 전|새 작업 전|주소 바꾸기 전) 자동 백업\)$/, ''); const groups = {}; L.forEach(s => { (groups[base(s.name)] = groups[base(s.name)] || []).push(s); });
      el.outerHTML = L.length ? Object.entries(groups).map(([nm, vs], i) => `<details ${i === 0 ? 'open' : ''} style="margin:6px 0"><summary><b>${esc(nm.replace(/ \((불러오기 전|새 작업 전|주소 바꾸기 전) 자동 백업\)$/, ''))}</b> <span class="n">버전 ${vs.length}개 · 마지막 ${esc(vs[0].savedAt)}</span></summary><ul>${vs.map(item).join('')}</ul></details>`).join('') : '<div class="n">아직 없습니다. 작업을 하면 바뀔 때마다 자동으로 저장됩니다.</div>';
    }).catch(er => { const el = box.querySelector('#jbsCloudList'); if (el) el.innerHTML = `<span class="warn">온라인 목록을 불러오지 못했습니다: ${esc(er.message)}</span>`; });
    box.querySelector('#jbsWorkFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const snap = check(JSON.parse(await f.text())); await restore(snap, `파일 '${f.name}'`); } catch (er) { open('불러오지 못했습니다: ' + er.message); }
    };
  }
  async function restore(snap, label) {
    if (!confirm(`${label} — '${snap.name}'(${snap.savedAt}) 상태로 바꿉니다.\n지금 작업은 '자동 백업'으로 먼저 저장해 둡니다. 계속할까요?`)) return;
    await backup('불러오기 전 자동 백업');
    apply(snap);
    location.reload();
  }
  async function onClick(e) {
    const b = e.target.closest('button[data-w]'); if (!b) return;
    const w = b.dataset.w, id = b.dataset.id;
    try {
      if (w === 'csave') { const name = prompt('작업 이름(홈페이지에 저장)', guessName()); if (name === null) return; b.disabled = true; b.textContent = '저장 중…'; const s = await cloudSave(name.trim() || guessName(), false); open(`'${s.name}'을 홈페이지에 저장했습니다(${s.savedAt}). 다른 컴퓨터에서도 불러올 수 있습니다.`); }
      else if (w === 'copen') { b.disabled = true; b.textContent = '받는 중…'; const s = await cloudGet(id); await restore(s, '홈페이지에 저장된 작업'); b.disabled = false; b.textContent = '불러오기'; }
      else if (w === 'cdl') { download(await cloudGet(id)); }
      else if (w === 'cdel') { if (confirm('이 작업을 홈페이지에서 지울까요? 되돌릴 수 없습니다.')) { await cloudDel(id); open('홈페이지에서 지웠습니다.'); } }
      else if (w === 'save') { const name = prompt('작업 이름', guessName()); if (name === null) return; const s = await saveSlot(name.trim() || guessName(), false); full = false; btn.classList.remove('full'); open(`'${s.name}'으로 저장했습니다(${s.savedAt}).`); }
      else if (w === 'file') { const name = prompt('파일에 붙일 작업 이름', guessName()); if (name === null) return; download(snapshot(name.trim() || guessName())); open('파일을 내려받았습니다. 토지조서가 들어 있을 수 있으니 외부로 보내지 마세요.'); }
      else if (w === 'load') box.querySelector('#jbsWorkFile').click();
      else if (w === 'new') {
        if (!confirm('새 작업을 시작합니다. 정비계획 안·구역·배치·검토서·사업성 프로젝트가 비워집니다(사업성 가정값은 남김).\n지금 작업은 자동 백업으로 먼저 저장합니다. 계속할까요?')) return;
        await backup('새 작업 전 자동 백업'); clearWork(); location.reload();
      }
      else if (w === 'open') { const s = (await listSlots()).find(x => x.id === id); if (s) await restore(s, '저장된 작업'); }
      else if (w === 'dl') { const s = (await listSlots()).find(x => x.id === id); if (s) download(s); }
      else if (w === 'del') { const s = (await listSlots()).find(x => x.id === id); if (s && confirm(`'${s.name}'(${s.savedAt})을 이 컴퓨터에서 지울까요?`)) { await delSlot(id); open('지웠습니다.'); } }
    } catch (er) { open('처리하지 못했습니다: ' + er.message); }
  }
  // 저장 공간이 꽉 차서 저장 실패했다는 알림(site-store 등이 보냄)
  g.addEventListener && g.addEventListener('jbs-storage-full', () => { full = true; if (btn) { btn.classList.add('full'); btn.textContent = '저장 공간 꽉 참 — 작업 보관'; } });

  g.JbsWork = { checkNewer, snapshot, summary, autoVersion, flushPending, guessName, hashOf, cloudSave, cloudList, cloudGet, backup, apply, clearWork, listSlots, saveSlot, delSlot, download, used, isWorkKey, open: () => { ui(); open(); } };
  const start = () => { ui(); watch(); };
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
