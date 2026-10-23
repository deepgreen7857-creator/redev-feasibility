// 자동 복사본 — 원본: auction-web/src/lib/zoneMatch.js (직접 고치지 말 것)
// 정비구역 연계 — 사람이 추진현황 페이지·공보를 보고 확인한 '정비구역 목록'(관리자 전용 redevZones)이 기준.
//  1) 물건 PNU·지번(또는 대략 경계)을 목록과 대조 → 구역 연결
//  2) 목록에 없는데 브이월드 토지이용계획에 정비구역이 찍히면 '목록 미등록 구역'(관리자 알림)
//     (브이월드는 지정고시 이후 구역만 나온다 — 지정 전 구역은 목록으로만 잡힌다)
//  3) 둘 다 아니면 '정비구역 아님'(토지이용을 아직 못 봤으면 '확인 전')
// 권리산정기준일 판정은 도시 및 주거환경정비법 제77조제1항(현행) 기준.

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
// 기준일 '다음 날'을 기준으로, 그 뒤에 아래가 생기면 분양받을 권리를 산정(제한)한다.
export const ART77 = {
  1: '1필지의 토지가 여러 필지로 분할',
  2: '집합건물이 아닌 건축물이 집합건물로 전환',
  3: '하나의 대지 범위의 동일인 소유 토지와 건축물을 토지·건축물로 각각 분리 소유',
  4: '나대지에 건축물 신축 또는 기존 건축물 철거 후 공동주택 신축으로 토지등소유자 증가',
};
const addDay = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); if (Number.isNaN(d.getTime())) return null; d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const day = (v) => { const m = String(v || '').match(/(\d{4})\D?(\d{2})\D?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const MULTI = /(다세대|연립|아파트|공동주택|도시형|오피스텔|빌라)/;

export function rightsCheck(item, zone) {
  if (!zone) return { status: 'none' };
  const rd = zone.rightsDate || {};
  const law = '도시정비법 제77조제1항';
  const checks = ['토지대장 이동연혁(기준일 뒤 분할 여부)', '건축물대장 변동(집합건물 전환일)', '토지·건물 등기부(분리 소유가 생긴 날)'];
  if (!rd.announced || !day(rd.date)) {
    return {
      status: 'pending', law, checks,
      text: stageInfo(zone.stage)?.before
        ? '권리산정기준일 미고시 — 구역 지정 전. 따로 고시하지 않으면 지정고시일이 기준일이 됨(지금 있는 필지·건물이면 영향 없음, 기준일 뒤 분할·신축·집합건물 전환은 분양권 제한)'
        : '권리산정기준일이 목록에 없음 — 지정고시일 또는 시·도 공보 고시일을 확인해 넣으세요',
    };
  }
  const basis = day(rd.date); const from = addDay(basis);
  const m = item.manual?.rights77 || {};
  const hits = []; const risks = [];
  // 관리자가 서류로 확인한 값이 우선
  if (m.split === true) hits.push({ ho: 1, text: ART77[1], evidence: m.note || '직접 확인' });
  if (m.toCollective === true) hits.push({ ho: 2, text: ART77[2], evidence: m.note || '직접 확인' });
  if (m.separated === true) hits.push({ ho: 3, text: ART77[3], evidence: m.note || '직접 확인' });
  if (m.newBuild === true) hits.push({ ho: 4, text: ART77[4], evidence: m.note || '직접 확인' });
  // 자동: 건축물대장 사용승인일이 기준일 다음 날 이후 → 4호(공동주택이면 제한, 아니면 확인)
  const apr = day(item.ledger?.useApr);
  const kind = `${item.usage || ''} ${item.usageSmall || ''} ${item.title || ''} ${(item.ledger?.titles || []).map((t) => t.mainPurpose).join(' ')}`;
  if (apr && apr >= from && m.newBuild !== false) {
    (MULTI.test(kind) ? hits : risks).push({ ho: 4, text: ART77[4], evidence: `건축물대장 사용승인 ${apr} ≥ 기준일 다음 날 ${from}` });
  }
  // 자동: 집합건물인데 대장상 '일반'이 섞이거나(전환 흔적) 대지권 미등기·토지/건물 따로 매각 → 2·3호 확인
  const kinds = new Set((item.ledger?.titles || []).map((t) => t.kind).filter(Boolean));
  if (kinds.has('집합') && kinds.has('일반') && m.toCollective !== false) risks.push({ ho: 2, text: ART77[2], evidence: '건축물대장에 일반·집합이 함께 있음(전환일 확인)' });
  const t = `${item.detail?.conditions || ''} ${item.detail?.cautions || ''} ${item.detail?.superficies || ''} ${item.title || ''}`;
  if (m.separated !== false && /(건물만\s*매각|토지만\s*매각|대지권\s*(미등기|없)|제시\s*외\s*건물|법정지상권)/.test(t)) risks.push({ ho: 3, text: ART77[3], evidence: '토지·건물을 따로 파는 물건(분리 소유가 생긴 날 확인)' });
  const status = hits.length ? 'restricted' : risks.length ? 'risk' : 'noHit';
  const text = status === 'restricted' ? `분양권 제한(현금청산 위험) — 기준일 ${basis} 다음 날(${from}) 이후 ${hits.map((h) => `${h.ho}호`).join('·')} 해당`
    : status === 'risk' ? `분양권 제한 가능성 — ${risks.map((h) => `${h.ho}호`).join('·')} 확인 필요(기준일 ${basis})`
      : `자동 확인 범위에서 제77조① 해당 없음(기준일 ${basis}) — 분할 이력 등은 서류로 확인`;
  return { status, law, basisDate: basis, basisFrom: rd.basis || null, effectiveFrom: from, hits, risks, checks, text };
}

// 물건에 붙일 정비구역 연결 결과(목록 스냅숏 — 메모는 빼고 공개해도 되는 값만)
export function zoneStatus(item, zones, { geo, now = new Date().toISOString() } = {}) {
  const hit = matchZone(item, zones, { geo });
  const vw = item.land?.landUse?.redevelopment || [];
  if (hit) {
    const z = hit.zone;
    const snap = {
      status: 'listed', by: hit.by, zoneId: z.id || null, name: z.name, sido: z.sido || null, sgg: z.sgg || null, type: z.type || null, stage: z.stage || null,
      rightsDate: z.rightsDate || null, permitZone: z.permitZone || null, actRestriction: z.actRestriction || null, sourceUrls: z.sourceUrls || [], confirmedAt: z.confirmedAt || null,
      recheck: needsRecheck(z), vworld: vw, checkedAt: now,
    };
    snap.rights = rightsCheck(item, z);
    return snap;
  }
  if (vw.length) return { status: 'unlisted', vworld: vw, checkedAt: now };
  if (!item.land?.landUse) return { status: 'unchecked', checkedAt: now };
  return { status: 'none', checkedAt: now };
}

export const ZONE_STATUS_LABEL = { listed: '정비구역(목록)', unlisted: '목록 미등록 구역', none: '정비구역 아님', unchecked: '정비구역 확인 전' };
