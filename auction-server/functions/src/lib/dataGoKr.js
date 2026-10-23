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

// 인증키 관련 결과코드 → 확인할 것(인코딩/디코딩 키 혼동이 가장 흔함)
const KEY_HINT = {
  30: '등록되지 않은 인증키: Encoding 키를 그대로 넣어 두 번 인코딩됐거나(자동으로 풀어 쓰지만 % 없이 잘린 키는 못 풂), 다른 계정 키일 수 있음 — 공공데이터포털 마이페이지의 일반 인증키(Decoding)를 다시 넣으세요',
  31: '활용 기간 만료 — 마이페이지에서 연장 신청',
  20: '이 API 활용신청이 승인되지 않음 — 해당 API를 따로 활용신청',
  12: '없는 서비스 주소 — API 주소(버전) 변경 확인',
};

// 키 모양만 알려 준다(키 값은 보이지 않음)
function keyShape(key) {
  const k = String(key || '');
  const t = k.replace(/[\s"'`]/g, '');
  const parts = [`${t.length}자`];
  if (t !== k) parts.push('앞뒤 빈칸·따옴표 있음(자동 제거)');
  if (/%[0-9A-Fa-f]{2}/.test(t)) parts.push('% 포함 → Encoding 키(자동으로 풀어 Decoding 키로 씀)');
  else if (/[+/=]/.test(t)) parts.push('+ / = 포함 → Decoding 키(정상)');
  else if (/^[0-9a-f]{64}$/i.test(t)) parts.push('16진수 64자 → 인코딩·디코딩 키가 같은 형식(정상)');
  else parts.push('형식 확인 필요');
  return parts.join(' · ');
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
  if (!OK.includes(code)) throw new ApiError(code, `${message ? `${message}(${code})` : `공공데이터 API 오류(${code})`}${KEY_HINT[code] ? ` — ${KEY_HINT[code]}` : ''}`);
  return { code, rows, total, pageNo: Number(body.pageNo || 1), numOfRows: Number(body.numOfRows || rows.length) };
}

function rowsOf(body) {
  const v = body && body.items && (body.items.item ?? body.items);
  if (!v || typeof v === 'string') return [];
  return Array.isArray(v) ? v : [v];
}

// 브라우저처럼 보이는 머리글(User-Agent 없는 요청을 막는 방화벽 대비)
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json, application/xml, text/xml, */*' };

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

// 인증키 정리: 앞뒤 빈칸·줄바꿈·따옴표 제거, Encoding 키(%2B 같은 글자 포함)를 넣었으면 풀어서 Decoding 키로 바꾼다.
// (URLSearchParams가 한 번 인코딩하므로 Decoding 키가 들어가야 정확히 한 번만 인코딩된다)
function normalizeKey(key) {
  let k = String(key || '').replace(/[\s"'`]/g, '');
  if (/%[0-9A-Fa-f]{2}/.test(k)) { try { k = decodeURIComponent(k); } catch { /* 그대로 둔다 */ } }
  return k;
}

// api: 한도 장부 이름(예: 'onbid-list'), url: 요청 주소, params: 질의 변수
async function call({ api, url, params, serviceKey, quota, fetcher = fetch, retries = 3 }) {
  if (!serviceKey) throw new ApiError('NO_KEY', '공공데이터포털 인증키가 설정되지 않았습니다.');
  if (quota && (await quota.remaining(api)) <= 0) throw new ApiError('22', `오늘 ${api} 호출 한도를 다 썼습니다.`);
  const u = new URL(url);
  u.searchParams.set('serviceKey', normalizeKey(serviceKey));
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      if (quota) await quota.add(api, 1);
      let res = await fetcher(u, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
      // 일부 환경에서 https 요청이 403으로 막히면 http로 한 번 더 시도
      if (res.status === 403 && u.protocol === 'https:') {
        const alt = new URL(u); alt.protocol = 'http:';
        const r2 = await fetcher(alt, { headers: HEADERS, signal: AbortSignal.timeout(25000) }).catch(() => null);
        if (r2 && r2.ok) res = r2;
      }
      if (!res.ok) {
        let body = '';
        try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160); } catch { /* 무시 */ }
        throw new ApiError(`HTTP_${res.status}`, `공공데이터 API 오류(HTTP_${res.status})${body ? ` ${body}` : ''}`);
      }
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
// 공공데이터 응답에 섞여 오는 &amp; 같은 HTML 표기를 글자로 바꾼다
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : unescape(String(v).trim()));

module.exports = { keyShape, KEY_HINT, normalizeKey, call, decode, rowsOf, Quota, ApiError, kstDay, won, num, text, DAILY_LIMIT, SAFETY_MARGIN };
