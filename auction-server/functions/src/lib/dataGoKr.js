// 공공데이터포털(apis.data.go.kr) 공통 호출기 — XML/JSON 응답 해석, 재시도, 하루 호출 한도 관리.
const { XMLParser } = require('fast-xml-parser');

const DAILY_LIMIT = Number(process.env.DATA_GO_KR_DAILY_LIMIT || 1000); // 개발계정 기본 1,000건(API별)
const SAFETY_MARGIN = 30; // 한도 끝까지 쓰지 않고 남겨 둔다(수동 시험용)

const xml = new XMLParser({ parseTagValue: false, processEntities: false, ignoreAttributes: true });

class ApiError extends Error {
  constructor(code, message) {
    super(message || `공공데이터 API 오류(${code})`);
    this.code = String(code);
  }
}

// 결과코드 해석
const NO_DATA = ['03'];
const OK = ['00', '0', '000', '0000'];
const QUOTA = ['22']; // LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR
const RETRY = ['01', '04', '05', '23', 'NETWORK', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'];

function decode(raw) {
  const text = String(raw || '').trim();
  let data;
  if (text.startsWith('<')) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ApiError('INVALID_XML');
    data = xml.parse(text);
  } else {
    try { data = JSON.parse(text); } catch { throw new ApiError('INVALID_RESPONSE', text.slice(0, 200)); }
  }
  const env = data && (data.response || data);
  const denied = env && env.OpenAPI_ServiceResponse && env.OpenAPI_ServiceResponse.cmmMsgHeader;
  const code = String(
    (env && env.header && env.header.resultCode) ??
    (env && env.cmmMsgHeader && env.cmmMsgHeader.returnReasonCode) ??
    (denied && denied.returnReasonCode) ??
    'INVALID_RESPONSE',
  );
  const message =
    (env && env.header && env.header.resultMsg) ||
    (denied && (denied.returnAuthMsg || denied.errMsg)) || '';
  const body = (env && env.body) || {};
  const rows = rowsOf(body);
  const total = Number(body.totalCount || 0);
  if (NO_DATA.includes(code)) return { code, rows: [], total: 0, pageNo: 1, numOfRows: 0 };
  if (!OK.includes(code)) throw new ApiError(code, message ? `${message}(${code})` : undefined);
  return { code, rows, total, pageNo: Number(body.pageNo || 1), numOfRows: Number(body.numOfRows || rows.length) };
}

function rowsOf(body) {
  const v = body && body.items && (body.items.item ?? body.items);
  if (!v || typeof v === 'string') return [];
  return Array.isArray(v) ? v : [v];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');

// 호출 한도 장부(Firestore). db 없이 쓰면(시험·로컬) 메모리로만 센다.
class Quota {
  constructor(db) {
    this.db = db;
    this.mem = new Map();
  }
  key(api) { return `${api}_${kstDay()}`; }
  async used(api) {
    const k = this.key(api);
    if (!this.db) return this.mem.get(k) || 0;
    const snap = await this.db.collection('quota').doc(k).get();
    return snap.exists ? snap.data().count || 0 : 0;
  }
  async remaining(api) { return Math.max(0, DAILY_LIMIT - SAFETY_MARGIN - (await this.used(api))); }
  async add(api, n = 1, extra = {}) {
    const k = this.key(api);
    if (!this.db) { this.mem.set(k, (this.mem.get(k) || 0) + n); return; }
    const { FieldValue } = require('firebase-admin/firestore');
    await this.db.collection('quota').doc(k).set(
      { api, day: kstDay(), count: FieldValue.increment(n), updatedAt: new Date(), ...extra },
      { merge: true },
    );
  }
  async markExhausted(api) {
    const k = this.key(api);
    if (!this.db) { this.mem.set(k, DAILY_LIMIT); return; }
    await this.db.collection('quota').doc(k).set({ api, day: kstDay(), count: DAILY_LIMIT, exhausted: true, updatedAt: new Date() }, { merge: true });
  }
}

// api: 한도 장부 이름(예: 'onbid-list'), url: 요청 주소, params: 질의 변수
async function call({ api, url, params, serviceKey, quota, fetcher = fetch, retries = 3 }) {
  if (!serviceKey) throw new ApiError('NO_KEY', '공공데이터포털 인증키가 설정되지 않았습니다.');
  if (quota && (await quota.remaining(api)) <= 0) throw new ApiError('22', `오늘 ${api} 호출 한도를 다 썼습니다.`);
  const u = new URL(url);
  // 인증키는 Decoding 키를 넣고 URLSearchParams가 한 번만 인코딩하게 둔다.
  u.searchParams.set('serviceKey', serviceKey);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      if (quota) await quota.add(api, 1);
      const res = await fetcher(u, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new ApiError(`HTTP_${res.status}`);
      return decode(await res.text());
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(e && (e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError) ? 'NETWORK' : 'UNKNOWN', e && e.message);
      lastErr = err;
      if (QUOTA.includes(err.code)) { if (quota) await quota.markExhausted(api); throw err; }
      if (!RETRY.includes(err.code) || i === retries - 1) throw err;
      await sleep(1000 * 2 ** i);
    }
  }
  throw lastErr;
}

const won = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

module.exports = { call, decode, rowsOf, Quota, ApiError, kstDay, won, num, text, DAILY_LIMIT, SAFETY_MARGIN };
