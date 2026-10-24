// 데이터 창구 — Firebase 설정이 있으면 Firestore, 없으면 샘플(데모 모드)
import { SAMPLE_LISTINGS, SAMPLE_BANKRUPT, SAMPLE_TRADES } from '../data/sample.js';
import { DEFAULT_SETTINGS } from '../data/defaults.js';

const env = import.meta.env || {};
export const DEMO = env.VITE_DEMO === '1' || !env.VITE_FIREBASE_PROJECT_ID;
const ADMINS = (env.VITE_ADMIN_EMAILS || 'deepgreen7857@gmail.com').split(',').map((s) => s.trim().toLowerCase());

let fb = null; // { db, auth, functions, mod }
async function firebase() {
  if (DEMO) return null;
  if (fb) return fb;
  const [{ initializeApp }, fs, au, fn] = await Promise.all([
    import('firebase/app'), import('firebase/firestore'), import('firebase/auth'), import('firebase/functions'),
  ]);
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID,
  });
  fb = { db: fs.getFirestore(app), auth: au.getAuth(app), functions: fn.getFunctions(app, env.VITE_FUNCTIONS_REGION || 'asia-northeast3'), fs, au, fn };
  return fb;
}

// 데모 모드에서 관리자 화면 변경을 이 브라우저에만 잠시 기억
const mem = { settings: null, listings: null, user: null };
const userListeners = new Set();
function local(key, fallback) { try { const v = localStorage.getItem(`jbs-auction:${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function setLocal(key, v) { try { localStorage.setItem(`jbs-auction:${key}`, JSON.stringify(v)); } catch { /* 저장 안 돼도 화면은 동작 */ } }

export async function getSettings() {
  const f = await firebase();
  if (!f) return mem.settings || (mem.settings = { ...DEFAULT_SETTINGS, ...local('settings', {}) });
  const snap = await f.fs.getDoc(f.fs.doc(f.db, 'settings', 'main'));
  return { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
}

export async function saveSettings(s) {
  const f = await firebase();
  if (!f) { mem.settings = s; setLocal('settings', s); return; }
  await f.fs.setDoc(f.fs.doc(f.db, 'settings', 'main'), { ...s, updatedAt: new Date().toISOString() }, { merge: true });
}

function demoListings() {
  if (!mem.listings) mem.listings = [...SAMPLE_LISTINGS, ...local('manualListings', [])];
  return mem.listings;
}

export async function listListings({ sido } = {}) {
  const f = await firebase();
  if (!f) return demoListings().filter((x) => !sido || x.sido === sido);
  const { collection, query, where, limit, getDocs } = f.fs;
  const q = sido ? query(collection(f.db, 'listings'), where('sido', '==', sido), limit(5000)) : query(collection(f.db, 'listings'), limit(5000));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 온비드 입찰결과목록으로 받은 과거 완료 물건(우리가 진행 중에 모으지 않았던 것) — 완료 물건 채점용
export async function listPastResults({ sido } = {}) {
  const f = await firebase();
  if (!f) return [];
  const { collection, query, where, orderBy, limit, getDocs } = f.fs;
  const q = sido ? query(collection(f.db, 'pastResults'), where('sido', '==', sido), limit(5000)) : query(collection(f.db, 'pastResults'), orderBy('bidEnd', 'desc'), limit(5000));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getListing(id) {
  const f = await firebase();
  if (!f) return demoListings().find((x) => x.id === id) || null;
  const snap = await f.fs.getDoc(f.fs.doc(f.db, 'listings', id));
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  const past = await f.fs.getDoc(f.fs.doc(f.db, 'pastResults', id));
  return past.exists() ? { id: past.id, ...past.data() } : null;
}

export async function saveListing(item) {
  const f = await firebase();
  const doc = { ...item, updatedAt: new Date().toISOString() };
  if (!f) {
    const list = demoListings();
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = { ...list[i], ...doc }; else list.unshift(doc);
    setLocal('manualListings', list.filter((x) => x.source === 'court' && String(x.id).startsWith('court_')));
    return;
  }
  await f.fs.setDoc(f.fs.doc(f.db, 'listings', item.id), doc, { merge: true });
}

export async function listBankrupt() {
  const f = await firebase();
  if (!f) return SAMPLE_BANKRUPT;
  const { collection, query, orderBy, limit, getDocs } = f.fs;
  const snap = await getDocs(query(collection(f.db, 'bankruptNotices'), orderBy('seq', 'desc'), limit(500)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 실거래가: (종류·시군구) 최근 n개월 → 거래 배열
export async function getDeals(type, lawd, months = 12) {
  if (!type || !lawd) return [];
  const yms = [];
  const now = new Date();
  for (let i = 0; i < months; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); yms.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const f = await firebase();
  if (!f) return yms.flatMap((ym) => (SAMPLE_TRADES[`${type}_${lawd}_${ym}`] || []).map((d) => [...d, ym]));
  const snaps = await Promise.all(yms.map((ym) => f.fs.getDoc(f.fs.doc(f.db, 'tradeMonths', `${type}_${lawd}_${ym}`))));
  return snaps.flatMap((s, i) => {
    if (!s.exists()) return [];
    try { return JSON.parse(s.data().d || '[]').map((d) => [...d, yms[i]]); } catch { return []; }
  });
}

export async function getStatus() {
  const f = await firebase();
  if (!f) {
    return {
      demo: true,
      state: { onbid: { lastDay: '샘플', lastFullDay: '샘플' }, bankrupt: { lastDay: '샘플', maxSeq: 99001 }, zones: { lastDay: '샘플', lastResult: { title: '(2026.9월말 기준)' } } },
      progress: { apt: { remaining: 0, updatedAt: '샘플' }, rh: { remaining: 0 }, sh: { remaining: 0 }, offi: { remaining: 0 }, land: { remaining: 0 } },
      quota: [], runs: [],
    };
  }
  const { collection, query, orderBy, limit, getDocs, getDoc, doc } = f.fs;
  const [onbidS, bankS, zonesS, runs, quota, ...prog] = await Promise.all([
    getDoc(doc(f.db, 'state', 'onbid')), getDoc(doc(f.db, 'state', 'bankrupt')), getDoc(doc(f.db, 'state', 'incheonZones')),
    getDocs(query(collection(f.db, 'runs'), orderBy('at', 'desc'), limit(10))),
    getDocs(query(collection(f.db, 'quota'), orderBy('updatedAt', 'desc'), limit(30))),
    ...['apt', 'rh', 'sh', 'offi', 'land'].map((t) => getDoc(doc(f.db, 'tradeProgress', t))),
  ]);
  const progress = {};
  ['apt', 'rh', 'sh', 'offi', 'land'].forEach((t, i) => { const d = prog[i].exists() ? prog[i].data() : null; progress[t] = d ? { remaining: d.remaining, updatedAt: d.updatedAt, done: Object.keys(d.done || {}).length } : null; });
  return {
    state: { onbid: onbidS.data() || {}, bankrupt: bankS.data() || {}, zones: zonesS.data() || {} },
    progress,
    quota: quota.docs.map((d) => d.data()),
    runs: runs.docs.map((d) => d.data()),
  };
}

// 서버 함수 호출(관리자)
// 관리자: Claude 검토가 모아 둔 규칙 수정 제안(최근 것부터)
export async function listRuleSuggestions() {
  const f = await firebase();
  if (!f) return [];
  const { collection, query, orderBy, limit, getDocs } = f.fs;
  const snap = await getDocs(query(collection(f.db, 'ruleSuggestions'), orderBy('at', 'desc'), limit(100)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function callFn(name, data = {}) {
  const f = await firebase();
  if (!f) {
    if (name === 'landCheck') return { demo: true, landUse: { zone: '제2종일반주거지역', redevelopment: [], farmPromotion: false, greenbelt: false, roadConflict: [] }, officialPrice: 3000000, officialPriceYear: '2026' };
    if (name === 'testApis') return { results: [{ name: '데모 모드', ok: false, message: 'Firebase 연결 후 실제 API를 시험할 수 있습니다.' }] };
    return { demo: true, message: '데모 모드에서는 실제 수집을 하지 않습니다.' };
  }
  const res = await f.fn.httpsCallable(f.functions, name, { timeout: 540000 })(data);
  return res.data;
}

// 로그인
export async function onUser(cb) {
  const f = await firebase();
  if (!f) { cb(mem.user); userListeners.add(cb); return () => userListeners.delete(cb); }
  return f.au.onAuthStateChanged(f.auth, (u) => cb(u ? { email: u.email, name: u.displayName } : null));
}
export async function signIn() {
  const f = await firebase();
  if (!f) { mem.user = { email: '데모 관리자', demo: true }; userListeners.forEach((cb) => cb(mem.user)); return mem.user; }
  const r = await f.au.signInWithPopup(f.auth, new f.au.GoogleAuthProvider());
  return { email: r.user.email };
}
export async function signOut() { const f = await firebase(); if (!f) { mem.user = null; userListeners.forEach((cb) => cb(null)); return; } await f.au.signOut(f.auth); }
export const isAdmin = (u) => Boolean(u && (u.demo || ADMINS.includes(String(u.email).toLowerCase())));

// 정비사업 현황(분기 엑셀, 참고 자료) — 시도마다 문서 1개(redevZoneFiles)
const demoZones = {};
export async function saveZones(sido, payload) {
  const f = await firebase();
  const doc = { sido, quarter: payload.quarter || null, fileName: payload.fileName || null, count: payload.zones.length, uploadedAt: new Date().toISOString(), z: JSON.stringify(payload.zones) };
  if (!f) { demoZones[sido] = doc; return; }
  await f.fs.setDoc(f.fs.doc(f.db, 'redevZoneFiles', sido), doc);
}
export async function getZones(sido) {
  if (!sido) return { zones: [] };
  const f = await firebase();
  let doc;
  if (!f) doc = demoZones[sido] || (await import('../data/sampleZones.js')).SAMPLE_ZONES[sido];
  else { const s = await f.fs.getDoc(f.fs.doc(f.db, 'redevZoneFiles', sido)); doc = s.exists() ? s.data() : null; }
  if (!doc) return { zones: [] };
  try { return { ...doc, zones: doc.zones || JSON.parse(doc.z || '[]') }; } catch { return { ...doc, zones: [] }; }
}

// ── 정비구역 목록(관리자 전용 redevZones) — 추진현황 페이지·공보로 사람이 확인한 구역 ──
const demoList = new Map();
export async function listRedevZones() {
  const f = await firebase();
  if (!f) return [...demoList.values()];
  const snap = await f.fs.getDocs(f.fs.collection(f.db, 'redevZones'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function saveRedevZone(zone) {
  const f = await firebase();
  const { id, ...rest } = zone;
  const doc = { ...rest, updatedAt: new Date().toISOString() };
  if (!f) { const k = id || `demo_${Date.now()}`; demoList.set(k, { id: k, ...doc }); return k; }
  if (id) { await f.fs.setDoc(f.fs.doc(f.db, 'redevZones', id), doc); return id; }
  const ref = await f.fs.addDoc(f.fs.collection(f.db, 'redevZones'), { ...doc, createdAt: doc.updatedAt });
  return ref.id;
}
export async function deleteRedevZone(id) {
  const f = await firebase();
  if (!f) { demoList.delete(id); return; }
  await f.fs.deleteDoc(f.fs.doc(f.db, 'redevZones', id));
}

// 관리자 알림: 목록 미등록 정비구역(zoneUnlisted)·계산 이상(calcAnomaly)
export async function listAlerts() {
  const f = await firebase();
  if (!f) return [];
  const { collection, query, where, getDocs } = f.fs;
  const snap = await getDocs(query(collection(f.db, 'adminAlerts'), where('resolved', '==', false)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function resolveAlert(id) {
  const f = await firebase();
  if (!f) return;
  await f.fs.setDoc(f.fs.doc(f.db, 'adminAlerts', id), { resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: 'admin' }, { merge: true });
}

// 등기부 열람본(관리자 전용 모음 registry) — 물건 하나에 건물·토지 등 여러 장
export async function getRegistry(listingId) {
  const f = await firebase();
  if (!f) return [];
  const { collection, query, where, getDocs } = f.fs;
  const snap = await getDocs(query(collection(f.db, 'registry'), where('listingId', '==', listingId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 법원 첨부 PDF 열기 주소(감정평가서·현황조사서·매각물건명세서) — 관리자만 읽을 수 있음(일반 회원은 권한 없음)
export async function getCourtFiles(listingId) {
  const f = await firebase();
  if (!f) return {};
  const snap = await f.fs.getDoc(f.fs.doc(f.db, 'courtFiles', listingId));
  return snap.exists() ? snap.data() : {};
}

// 미니PC 수집기 상태(휴대폰으로 확인용): 법원경매 수집기가 마지막으로 보낸 때, 등기부 수집기 오늘 저장 수·마지막 저장·마지막 회차 결과
export async function getMiniPcStatus() {
  const f = await firebase();
  if (!f) return { demo: true, court: {}, registry: {}, regToday: 0, regLast: null };
  const { collection, query, where, orderBy, limit, getDocs, getDoc, doc, getCountFromServer } = f.fs;
  const kst = new Date(Date.now() + 9 * 3600e3);
  const since = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600e3).toISOString(); // 오늘 0시(한국)
  const regQ = query(collection(f.db, 'listings'), where('registryAt', '>=', since));
  const [court, registry, cnt, last] = await Promise.all([
    getDoc(doc(f.db, 'state', 'court')), getDoc(doc(f.db, 'state', 'registry')),
    getCountFromServer(regQ).catch(() => null),
    getDocs(query(collection(f.db, 'listings'), where('registryAt', '>=', since), orderBy('registryAt', 'desc'), limit(1))).catch(() => null),
  ]);
  const l = last?.docs[0]?.data();
  return {
    court: court.data() || {}, registry: registry.data() || {},
    regToday: cnt ? cnt.data().count : null,
    regLast: l ? { at: l.registryAt, caseNo: l.caseNo, court: l.court } : null,
  };
}
