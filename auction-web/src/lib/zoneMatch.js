// 정비구역 연계 — 사람이 추진현황 페이지·공보를 보고 확인한 '정비구역 목록'(관리자 전용 redevZones)이 기준.
//  1) 물건 PNU·지번(또는 대략 경계)을 목록과 대조 → 구역 연결
//  2) 목록에 없는데 브이월드 토지이용계획에 정비구역이 찍히면 '목록 미등록 구역'(관리자 알림)
//     (브이월드는 지정고시 이후 구역만 나온다 — 지정 전 구역은 목록으로만 잡힌다)
//  3) 둘 다 아니면 '정비구역 아님'(토지이용을 아직 못 봤으면 '확인 전')
// 권리산정기준일 판정은 도시 및 주거환경정비법 제77조제1항(현행) 기준.
import { RIGHTS77_DEFAULT } from '../data/defaults.js';

// 단계(관리자 목록) → 순서·분양자격 판정에 쓰는 단계 이름
export const REDEV_STAGES = [
  { key: '정비예정구역(기본계획 반영)', rank: 0, legacy: '정비예정구역', before: true },
  { key: '기본계획 주민공람', rank: 0.1, legacy: '정비예정구역', before: true },
  { key: '후보지·사전검토', rank: 0.2, legacy: '정비예정구역', before: true },
  { key: '입안제안', rank: 0.5, legacy: '정비예정구역', before: true },
  { key: '주민공람(구역지정)', rank: 0.8, legacy: '정비예정구역', before: true },
  { key: '지정고시', rank: 1, legacy: '구역지정' },
  { key: '추진위', rank: 2, legacy: '추진위원회 승인' },
  { key: '조합설립', rank: 3, legacy: '조합설립인가 후' },
  { key: '사업시행', rank: 4, legacy: '사업시행인가 후' },
  { key: '관리처분', rank: 5, legacy: '관리처분인가 후' },
  { key: '해제', rank: -1, legacy: null },
];
export const stageInfo = (stage) => REDEV_STAGES.find((s) => s.key === stage) || null;
export const ZONE_TYPES = ['재개발', '재건축', '기타'];
export const RECHECK_DAYS = 90;

export function needsRecheck(zone, now = Date.now()) {
  const t = zone?.confirmedAt ? new Date(zone.confirmedAt).getTime() : NaN;
  return !Number.isFinite(t) || now - t > RECHECK_DAYS * 86400e3;
}

// ── 지번 ────────────────────────────────────────────────────────
// PNU 19자리: 법정동 10 + 산 구분 1(1 일반, 2 산) + 본번 4 + 부번 4
export function pnuParts(pnu) {
  const p = String(pnu || '');
  if (!/^\d{19}$/.test(p)) return null;
  return { bjd: p.slice(0, 10), mountain: p[10] === '2', bon: Number(p.slice(11, 15)), bu: Number(p.slice(15, 19)) };
}

const DONG = /([가-힣]{1,10}\d{0,2}(?:동|가|리|로\d*가))$/;

// '삼계리 산56', '부평동 123-4', '산 56-1'(앞 줄의 동·리 이어 씀) → { dong, mountain, bon, bu }
export function parseLot(text, prevDong = null) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/(?:^|\s)(?:([가-힣]{1,10}\d{0,2}(?:동|가|리))\s*)?(산\s?)?(\d{1,5})(?:\s*-\s*(\d{1,4}))?(?:\s*번지)?\s*$/);
  if (!m) return null;
  const dong = m[1] || prevDong;
  if (!dong) return null;
  return { dong, mountain: Boolean(m[2]), bon: Number(m[3]), bu: Number(m[4] || 0) };
}

// 구역 경계의 '포함 지번 목록'(줄·쉼표로 구분) → PNU 집합 + 지번 목록
export function zoneLots(zone) {
  const pnus = new Set(); const lots = [];
  let prev = null;
  const raw = Array.isArray(zone?.boundary?.lots) ? zone.boundary.lots.join('\n') : String(zone?.boundary?.lots || '');
  for (const piece of raw.split(/[\n,，;]+/).map((x) => x.trim()).filter(Boolean)) {
    if (/^\d{19}$/.test(piece)) { pnus.add(piece); continue; }
    const l = parseLot(piece, prev);
    if (l) { lots.push(l); prev = l.dong; }
  }
  return { pnus, lots };
}

// 물건의 필지: 지번 주소 글에서(동·리 + [산] 본번-부번). PNU가 있으면 산·본번·부번은 PNU가 우선
export function itemLot(item) {
  const texts = [item.detail?.addressFull, item.title, item.address].filter(Boolean);
  let lot = null;
  for (const t of texts) {
    const m = String(t).replace(/\s+/g, ' ').match(/([가-힣]{1,10}\d{0,2}(?:동|가|리))\s+(산\s?)?(\d{1,5})(?:-(\d{1,4}))?(?=\s|,|$)/);
    if (m) { lot = { dong: m[1], mountain: Boolean(m[2]), bon: Number(m[3]), bu: Number(m[4] || 0) }; break; }
  }
  const p = pnuParts(item.pnu);
  if (p && lot) return { ...lot, mountain: p.mountain, bon: p.bon, bu: p.bu };
  return lot;
}

// 점이 다각형 안에 있나(경도·위도, [[x,y],...])
export function inPolygon([x, y], poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const lastWord = (s) => String(s || '').trim().split(/\s+/).pop();
function sameArea(item, zone) {
  if (zone.sido && item.sido && zone.sido !== item.sido) return false;
  if (zone.sgg && item.sgg && !(item.sgg.includes(lastWord(zone.sgg)) || zone.sgg.includes(lastWord(item.sgg)))) return false;
  return true;
}

// 물건 → 목록의 구역 하나(없으면 null). geo: 필지 중심점 [경도, 위도](경계 다각형 대조용, 있으면)
export function matchZone(item, zones, { geo } = {}) {
  const lot = itemLot(item);
  for (const z of zones || []) {
    if (!sameArea(item, z)) continue;
    const { pnus, lots } = zoneLots(z);
    if (item.pnu && pnus.has(String(item.pnu))) return { zone: z, by: 'PNU' };
    if (lot && lots.some((l) => l.dong === lot.dong && l.mountain === lot.mountain && l.bon === lot.bon && l.bu === lot.bu)) return { zone: z, by: '지번' };
  }
  if (geo) {
    for (const z of zones || []) {
      if (sameArea(item, z) && z.boundary?.polygon && inPolygon(geo, z.boundary.polygon)) return { zone: z, by: '경계(대략)' };
    }
  }
  return null;
}

// ── 권리산정기준일(도시정비법 제77조제1항) ───────────────────────────────
// 기준일: 정비구역 지정고시일, 또는 시·도지사가 기본계획 수립 주민공람 공고일 후 구역 지정·고시 전에 따로 정해 공보에 고시한 날.
// 기준일 '다음 날'을 기준으로, 그 뒤에 아래(설정 rights77.rules)가 생기면 분양받을 권리를 산정(제한)한다.
// 사유 목록은 코드에 고정하지 않고 설정값(settings.rights77)으로 관리한다 — 기본값은 data/defaults.js RIGHTS77_DEFAULT.
export const rights77Of = (settings) => {
  const c = settings?.rights77;
  return c?.rules?.length ? { ...RIGHTS77_DEFAULT, ...c, ordinance: { ...RIGHTS77_DEFAULT.ordinance, ...(c.ordinance || {}) } } : RIGHTS77_DEFAULT;
};
// 예전 화면·기록 호환: 호 번호 → 사유 글(기본값)
export const ART77 = Object.fromEntries(RIGHTS77_DEFAULT.rules.map((r) => [r.ho, r.text]));
// 예전에 관리자가 넣은 예/아니오 값(manual.rights77)의 이름
const LEGACY_FLAG = { 1: 'split', 2: 'toCollective', 3: 'separated', 4: 'newBuild', 5: 'unitSplit' };
export const RIGHTS77_LABEL = { ok: '분양권 가능', restricted: '분양권 제한(현금청산 위험)', risk: '판단불가(날짜 미확인)', unknown: '판단불가(날짜 미확인)', pending: '기준일 미고시 — 향후 고시 시 재판정' };

const addDay = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); if (Number.isNaN(d.getTime())) return null; d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const day = (v) => { const m = String(v || '').match(/(\d{4})\D?(\d{2})\D?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const MULTI = /(다세대|연립|아파트|공동주택|도시형|오피스텔|빌라)/;

// 이 물건에 어떤 사유를 따져야 하나: 집합건물 호실 / 건물(또는 토지·건물 따로 매각) / 토지만
function itemShape(item) {
  const kind = `${item.usage || ''} ${item.usageSmall || ''} ${item.title || ''} ${(item.ledger?.titles || []).map((t) => t.mainPurpose).join(' ')}`;
  const kinds = new Set((item.ledger?.titles || []).map((t) => t.kind).filter(Boolean));
  const collective = MULTI.test(kind) || kinds.has('집합');
  const t = `${item.detail?.conditions || ''} ${item.detail?.cautions || ''} ${item.detail?.superficies || ''} ${item.title || ''}`;
  const splitSale = /(건물만\s*매각|토지만\s*매각|대지권\s*(미등기|없)|제시\s*외\s*건물|법정지상권)/.test(t);
  const building = collective || Boolean(item.buildingArea) || Boolean(item.ledger?.useApr) || splitSale;
  return { collective, building, splitSale, multi: MULTI.test(kind), kinds };
}

export function rightsCheck(item, zone, cfg = RIGHTS77_DEFAULT) {
  if (!zone) return { status: 'none' };
  const rules = cfg?.rules?.length ? cfg : RIGHTS77_DEFAULT;
  const rd = zone.rightsDate || {};
  const law = rules.law || RIGHTS77_DEFAULT.law;
  const ordinance = (rules.ordinance || {})[zone.sido || item.sido] || '';
  const checks = ['토지대장 이동연혁(기준일 뒤 분할 여부)', '건축물대장 변동(집합건물 전환일·사용승인일)', '집합건물 등기부(구분등기·전유부분 분할일)', '토지·건물 등기부(분리 소유가 생긴 날)'];
  if (!rd.announced || !day(rd.date)) {
    return {
      status: 'pending', label: RIGHTS77_LABEL.pending, law, checks, ordinance,
      text: stageInfo(zone.stage)?.before
        ? '기준일 미고시 — 향후 고시 시 재판정. 구역 지정 전이라 따로 공보 고시가 없으면 지정고시일이 기준일이 됨(지금 있는 필지·건물이면 영향 없음, 기준일 뒤 분할·신축·집합건물 전환·전유부분 분할은 분양권 제한)'
        : '기준일 미고시 — 향후 고시 시 재판정. 목록에 기준일이 없음: 지정고시일 또는 시·도 공보 고시일을 확인해 넣으세요',
    };
  }
  const basis = day(rd.date); const from = addDay(basis);
  const m = item.manual?.rights77 || {};
  const shape = itemShape(item);
  const hits = []; const risks = []; const oks = []; const missing = []; const dates = [];
  for (const r of rules.rules) {
    const applies = r.applies === 'collective' ? shape.collective : r.applies === 'building' ? shape.building : true;
    if (!applies) continue;
    const flag = m[LEGACY_FLAG[r.ho]] ?? m[`ho${r.ho}`]; // 관리자가 서류로 본 예/아니오
    // 비교 날짜: 관리자가 넣은 날짜 → (사용승인일만) 건축물대장 자동
    let d = day(m[r.date]); let src = d ? '직접 확인' : null;
    if (!d && r.date === 'useAprDate' && day(item.ledger?.useApr)) { d = day(item.ledger.useApr); src = '건축물대장 사용승인일'; }
    const row = { ho: r.ho, text: r.text, label: r.dateLabel, date: d, source: src };
    if (flag === true) { hits.push({ ...row, evidence: m.note || '직접 확인: 해당' }); dates.push({ ...row, cmp: '해당(직접 확인)' }); continue; }
    if (flag === false) { oks.push(row); dates.push({ ...row, cmp: '아님(직접 확인)' }); continue; }
    if (d) {
      const after = d >= from;
      dates.push({ ...row, cmp: after ? `기준일 다음 날(${from}) 이후` : `기준일 다음 날(${from}) 전` });
      if (!after) { oks.push(row); continue; }
      // 4호는 '토지등소유자 수 증가'까지 있어야 — 공동주택이면 제한, 단독 등은 확인 필요
      if (r.date === 'useAprDate' && !shape.multi) risks.push({ ...row, evidence: `${r.dateLabel} ${d} ≥ ${from} — 공동주택이 아니어서 토지등소유자 증가 여부 확인` });
      else hits.push({ ...row, evidence: `${r.dateLabel} ${d} ≥ 기준일 다음 날 ${from}` });
      continue;
    }
    // 날짜 모름: 자동으로 의심되는 흔적이 있으면 '의심', 아니면 '미확인'
    if (r.ho === 2 && shape.kinds.has('집합') && shape.kinds.has('일반')) risks.push({ ...row, evidence: '건축물대장에 일반·집합이 함께 있음(전환일 확인)' });
    else if (r.ho === 3 && shape.splitSale) risks.push({ ...row, evidence: '토지·건물을 따로 파는 물건(분리 소유가 생긴 날 확인)' });
    missing.push(row); dates.push({ ...row, cmp: '날짜 미확인' });
  }
  const status = hits.length ? 'restricted' : risks.length ? 'risk' : missing.length ? 'unknown' : 'ok';
  const hoList = (xs) => [...new Set(xs.map((h) => `${h.ho}호`))].join('·');
  const text = status === 'restricted' ? `분양권 제한(현금청산 위험) — 기준일 ${basis} 다음 날(${from}) 이후 ${hoList(hits)} 해당`
    : status === 'risk' ? `판단불가(날짜 미확인) — ${hoList(risks)} 의심, 날짜 확인 필요(기준일 ${basis})`
      : status === 'unknown' ? `판단불가(날짜 미확인) — ${missing.map((x) => x.label).join('·')} 확인 필요(기준일 ${basis})`
        : `분양권 가능 — 비교 날짜가 모두 기준일 다음 날(${from}) 전이거나 해당 없음(기준일 ${basis}) · 다물권·조합원 지위 양도 제한은 별도`;
  return { status, label: RIGHTS77_LABEL[status], law, basisDate: basis, basisFrom: rd.basis || null, effectiveFrom: from, hits, risks, oks, missing, dates, checks, ordinance, text };
}

// 물건에 붙일 정비구역 연결 결과(목록 스냅숏 — 메모는 빼고 공개해도 되는 값만)
export function zoneStatus(item, zones, { geo, now = new Date().toISOString(), rights77 } = {}) {
  const hit = matchZone(item, zones, { geo });
  const vw = item.land?.landUse?.redevelopment || [];
  if (hit) {
    const z = hit.zone;
    const snap = {
      status: 'listed', by: hit.by, zoneId: z.id || null, name: z.name, sido: z.sido || null, sgg: z.sgg || null, type: z.type || null, stage: z.stage || null,
      rightsDate: z.rightsDate || null, permitZone: z.permitZone || null, actRestriction: z.actRestriction || null, sourceUrls: z.sourceUrls || [], confirmedAt: z.confirmedAt || null,
      recheck: needsRecheck(z), vworld: vw, checkedAt: now,
    };
    snap.rights = rightsCheck(item, z, rights77);
    return snap;
  }
  if (vw.length) return { status: 'unlisted', vworld: vw, checkedAt: now };
  if (!item.land?.landUse) return { status: 'unchecked', checkedAt: now };
  return { status: 'none', checkedAt: now };
}

export const ZONE_STATUS_LABEL = { listed: '정비구역(목록)', unlisted: '목록 미등록 구역', none: '정비구역 아님', unchecked: '정비구역 확인 전' };

// 여러 필지 물건('… 산56 외 2필지'): 토지이용계획·공시지가는 첫 필지만 조회된다
export function extraParcels(item) {
  const m = `${item.title || ''} ${item.address || ''} ${item.detail?.addressFull || ''}`.match(/외\s*(\d{1,3})\s*필지/);
  return m ? Number(m[1]) : 0;
}

const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 토지거래허가구역: 목록(허가 기간 안) 또는 브이월드 토지이용계획
export function permitZoneOf(item, zone, today = todayKst()) {
  const p = zone?.permitZone;
  if (p?.yes && (!day(p.to) || day(p.to) >= today)) return { yes: true, from: p.from || null, to: p.to || null, source: '정비구역 목록' };
  if (item.land?.landUse?.permitZone) return { yes: true, source: '브이월드 토지이용계획' };
  return null;
}

// 카드 태그: [지정 전·○○구역/후보지] [기준일 ○○○○.○○.○○ 또는 미고시] [허가구역] [분양권 판정] + 법인 취득 제약
const RIGHTS_TAG = { ok: ['분양권 가능', 'now'], restricted: ['분양권 제한', 'hard'], risk: ['분양권 판단불가', 'wait'], unknown: ['분양권 판단불가', 'wait'], pending: ['분양권 재판정 대기', 'muted'] };
export function zoneTags(item, zone, rights, today = todayKst()) {
  const tags = [];
  const st = zone ? stageInfo(zone.stage) : null;
  if (zone) {
    tags.push({ key: 'zone', tone: 'brand', text: st?.before ? `지정 전·${zone.name}${zone.stage === '후보지·사전검토' ? '(후보지)' : ''}` : `${zone.name}·${zone.stage || '단계 미상'}` });
    const rd = zone.rightsDate || {};
    tags.push({ key: 'rightsDate', tone: rd.announced && day(rd.date) ? 'muted' : 'wait', text: rd.announced && day(rd.date) ? `기준일 ${day(rd.date).replace(/-/g, '.')}` : '기준일 미고시' });
  }
  const permit = permitZoneOf(item, zone, today);
  if (permit) tags.push({ key: 'permit', tone: 'wait', text: '허가구역' });
  if (zone && rights?.status && RIGHTS_TAG[rights.status]) { const [text, tone] = RIGHTS_TAG[rights.status]; tags.push({ key: 'rights', tone, text }); }
  return { before: Boolean(st?.before), name: zone?.name || null, stage: zone?.stage || null, permit, corpPermit: Boolean(permit), tags };
}
