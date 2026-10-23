// 특수물건(권리가 복잡한 물건) 판단 — 처음부터 버리지 않고 계산한다.
//  · 바닥 가치: 아무 일도 안 풀릴 때 최악으로 얼마인가
//  · 상승 시나리오: 어떤 일이 생기면 얼마가 되는가(조건·기간·할 일)
//  · 확인할 것: 정확한 판단에 필요한 서류·사실
// 계수는 보수적인 기본값이며, 정민 님 기준으로 settings.special 에서 바꿀 수 있다.

export const SPECIAL_DEFAULTS = {
  roadFloor: 1 / 3, // 사실상 사도: 인근 토지의 1/3 이내 (토지보상법 시행규칙 제26조)
  shareFloor: 0.6, // 지분 할인
  superficiesFloor: 0.5, // 지상 타인 건물이 있는 토지
  landlockedFloor: 0.5, // 맹지
  graveFloor: 0.7, // 분묘
  noLandRightFloor: 0.6, // 대지권 미등기
  memberMinLand: 90, // 분양자격 토지 최소 면적(㎡) — 조례 확인
};

const corpus = (item) => {
  const d = item.detail || {};
  return [item.title, item.usage, item.usageSmall, item.land?.jimok, d.landCategory, d.usageStatus, d.location,
    d.cautions, d.conditions, d.superficies, d.survivingRights, d.shareText, d.deliveryDuty, d.description]
    .filter(Boolean).join(' ');
};

export function parseShare(item) {
  const s = `${item.detail?.shareText || ''} ${typeof item.share === 'string' ? item.share : ''} ${item.title || ''}`;
  let m = s.match(/(\d+(?:\.\d+)?)\s*분의\s*(\d+(?:\.\d+)?)/);
  if (m) return Number(m[2]) / Number(m[1]);
  m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (m && Number(m[2]) > 0 && Number(m[1]) < Number(m[2])) return Number(m[1]) / Number(m[2]);
  return null;
}

// 배분요구를 안 했고, 말소기준일보다 먼저(또는 날짜 모름) 전입한 임차인 → 보증금 인수 가능
const ymd = (x) => String(x || '').replace(/\D/g, '').slice(0, 8);
export function riskyTenants(item) {
  const d = item.detail || {};
  const base = ymd(d.baseRightDate);
  const leases = d.leases || [];
  if (!leases.length) return { base, list: [{ deposit: null }], deposit: null }; // 명단 없음 → 확인 필요
  const list = leases.filter((l) => !l.claimed && (!base || !ymd(l.moveIn) || ymd(l.moveIn) < base));
  const deposit = list.every((l) => Number.isFinite(l.deposit)) ? list.reduce((s, l) => s + l.deposit, 0) : null;
  return { base, list, deposit };
}

// 어떤 특수 사정이 있는지
export function detectSpecial(item) {
  const t = corpus(item);
  const f = item.detail?.flags || {};
  // 지목·공고 용도(예: '토지 > 도로')·이용현황 어디에든 '도로/구거'가 단어로 있으면 도로 부지
  const jimok = `${item.land?.jimok || ''} ${item.detail?.landCategory || ''} ${item.usage || ''} ${item.usageSmall || ''} ${item.detail?.usageStatus || ''}`;
  const out = [];
  const add = (key, evidence) => { if (!out.some((o) => o.key === key)) out.push({ key, evidence }); };
  const jm = jimok.match(/(^|[\s>/·,()])(도로|구거)($|[\s>/·,()])/);
  if (jm) add('road', item.land?.jimok && /도로|구거/.test(item.land.jimok) ? `지목 ${item.land.jimok}` : `공고상 ${jm[2]}`);
  else if (/현황\s*도로|도로로\s*(이용|사용)|사실상\s*(의\s*)?도로|통행로|도로\s*부지/.test(t)) add('road', '현황 도로로 이용');
  if (/맹지|진입\s*도로\s*(없|미확보)|도로에\s*접하지/.test(t)) add('landlocked', '맹지 표시');
  if (f.superficies || /법정지상권|제시\s*외\s*건물|건물\s*(은|은\s*)?매각\s*제외|토지만\s*매각/.test(t)) add('superficies', f.superficies ? '법정지상권 기재' : '지상 건물 매각 제외');
  if (/대지권\s*(미등기|없음|없는)|건물만\s*매각/.test(t)) add('noLandRight', '대지권 미등기·건물만 매각');
  if (item.share || /지분\s*(매각|일부)|공유\s*지분/.test(t)) add('share', item.detail?.shareText || '지분 물건');
  if (/유치권/.test(t)) add('lien', '유치권 신고·기재');
  if (/분묘/.test(t)) add('grave', '분묘 기재');
  if (f.survivingRights || /선순위\s*(가처분|가등기|임차|전세권|지상권)|인수\s*(할|하는|조건)/.test(t)) add('surviving', item.detail?.survivingRights || '인수 권리 기재');
  if (f.unclaimedTenants) {
    const r = riskyTenants(item);
    if (r.list.length) add('tenant', `배분요구 안 한 임차인 ${r.list.length}명${r.base ? '(말소기준보다 먼저 전입)' : ''}`);
  }
  if (item.land?.landUse?.roadConflict?.length) add('roadPlan', `도시계획도로 저촉: ${item.land.landUse.roadConflict.join(', ')}`);
  if (item.land?.landUse?.greenbelt) add('greenbelt', '개발제한구역');
  return out;
}

const LABEL = {
  road: '도로·현황도로', landlocked: '맹지', superficies: '법정지상권(지상 타인 건물)', noLandRight: '대지권 미등기',
  share: '지분', lien: '유치권', grave: '분묘', surviving: '인수 권리', tenant: '대항력 임차인 가능성', roadPlan: '도시계획도로 저촉', greenbelt: '개발제한구역',
};

// 유형별 바닥 계수·시나리오·확인할 것. full = 아무 하자 없을 때의 가치
function build(key, item, full, ctx) {
  const s = ctx.s;
  const v = (r) => (full ? Math.round(full * r) : null);
  switch (key) {
    case 'road': {
      const area = item.landArea || 0;
      const sc = [];
      if (ctx.redev || ctx.member?.status !== 'none') {
        const enough = area >= s.memberMinLand;
        sc.push({
          name: '정비구역 편입 → 조합원 분양', value: ctx.rightValue || null, months: 36,
          prob: enough ? '보통' : '낮음',
          basis: ctx.rightValue ? '입주권 가치' : '구역 비례율·조합원분양가를 넣으면 입주권 가치로 계산',
          conditions: [`토지 면적 ${Math.round(area)}㎡ — 조례 분양자격 기준(${s.memberMinLand}㎡ 기본값) ${enough ? '이상' : '미달 → 단독으로는 분양 어려움'}`, '권리산정기준일 전에 분할된 필지인지', '투기과열지구 양도 제한 해당 여부'],
        });
      }
      sc.push({
        name: '정상 평가로 보상(사실상 사도 아님)', value: v(1), months: 36, prob: '확인 필요',
        basis: '도로 개설 경위가 소유자 스스로의 편익이 아니면 1/3 감액 없이 인근 토지 수준',
        conditions: ['원소유자가 택지 분할·분양하면서 스스로 낸 길이 아닌지', '도시계획시설 도로로 결정·고시됐는지(공법상 제한 받지 않은 상태로 평가)'],
      });
      sc.push({
        name: '지자체에 부당이득(사용료) 청구', value: null, annual: v(0.05), months: 12, prob: '확인 필요',
        basis: '지자체가 포장·하수도 등으로 점유·관리하는 사유 도로 — 연 임료 상당(대략 가치의 5%)',
        conditions: ['원소유자가 배타적 사용수익권을 포기한 사정이 없는지(대법원 2019. 1. 24. 2016다264556 전원합의체)', '지자체가 실제 점유·관리하는지'],
      });
      sc.push({
        name: '통행이 필요한 인접 필지에 매도', value: v(0.7), months: 12, prob: nbProb(item),
        basis: '이 길 외에 진입로가 없는 필지·신축 예정지가 있으면 협상력 생김',
        conditions: [nbText(item), '인접 필지가 이 도로로만 건축법상 접도 가능한지', pmText(item)],
      });
      if (ctx.roadPlan) sc.push({ name: '도시계획도로 개설 보상', value: v(1), months: 48, prob: '보통', basis: '계획도로 집행 시 보상', conditions: ['도로 사업 집행계획·예산 여부', '실효 시점'] });
      return { floor: s.roadFloor, floorBasis: `인근 같은 구 토지 시세의 ${Math.round(s.roadFloor * 100)}%(사실상 사도 기준)`, scenarios: sc,
        checks: ['토지이용계획(도로 결정 여부)', '지적도·항공사진으로 실제 통행 범위', '지자체 도로대장 등재 여부', '분할 연혁(토지대장)'] };
    }
    case 'landlocked':
      return { floor: s.landlockedFloor, floorBasis: '맹지 할인', scenarios: [
        { name: '주위토지통행권 확보', value: v(0.75), months: 12, prob: '보통', basis: '민법 제219조 — 최소한의 통행로 확보(보상 필요)', conditions: ['통행로가 될 인접지 상황', '건축허가에 필요한 접도 폭'] },
        { name: '인접 도로부지 매입 후 합쳐서 매도', value: v(1), months: 18, prob: '보통', basis: '진입로가 생기면 정상 토지', conditions: ['인접 필지 소유자 매도 의사'] },
        { name: '인접 토지 소유자에게 매도', value: v(0.8), months: 6, prob: '보통', basis: '붙어 있는 땅 주인이 가장 큰 수요자', conditions: ['인접지 소유자의 개발 계획'] },
      ], checks: ['지적도·현황 진입로', '인접 필지 소유자(등기부)'] };
    case 'superficies':
      return { floor: s.superficiesFloor, floorBasis: '지상 건물 때문에 당장 못 쓰는 토지 — 지료 수입 위주', scenarios: [
        { name: '법정지상권 불성립 → 철거·인도 청구 후 협상', value: v(0.95), months: 18, prob: '확인 필요', basis: '건물주는 철거를 피하려 토지를 사거나 건물을 넘김', conditions: ['최초 근저당 설정 당시 토지 위에 건물이 없었는지(나대지 저당)', '저당 설정 당시 토지·건물 소유자가 같았는지', '건물이 무허가·미등기인지'] },
        { name: '성립해도 지료 청구 → 2년 연체 시 소멸 청구', value: v(0.85), annual: v(0.04), months: 30, prob: '보통', basis: '민법 제287조 — 지료 2년 이상 연체 시 지상권 소멸 청구', conditions: ['지료 판결·협의 금액', '건물주 자력'] },
        { name: '건물주에게 토지 매도', value: v(0.85), months: 6, prob: '보통', basis: '건물주가 가장 큰 수요자', conditions: ['건물주가 실사용 중인지·자금력'] },
      ], checks: ['토지·건물 등기부(근저당 설정일, 건물 보존등기일)', '건축물대장 사용승인일', '감정평가서 제시외 건물'] };
    case 'noLandRight':
      return { floor: s.noLandRightFloor, floorBasis: '대지권 없는 전유부분 할인', scenarios: [
        { name: '대지사용권 함께 취득 확인 → 정상 가격', value: v(1), months: 6, prob: '확인 필요', basis: '분양대금이 다 치러졌는데 등기만 안 된 경우 낙찰자가 대지사용권도 취득', conditions: ['분양대금 완납 여부', '토지 별도등기·대지권 분리처분 사정'] },
      ], checks: ['집합건물 등기부 표제부', '분양계약·대금 완납 자료'] };
    case 'share': {
      const r = parseShare(item);
      return { floor: s.shareFloor, floorBasis: `지분 할인 ${Math.round((1 - s.shareFloor) * 100)}%${r ? ` · 지분 ${Math.round(r * 1000) / 10}%` : ''}`, scenarios: [
        { name: '다른 공유자에게 매도', value: v(0.85), months: 6, prob: '보통', basis: '공유자가 거주·사용 중이면 매수 유인', conditions: ['공유자 수·관계(가족 여부)', '공유자 실거주'] },
        { name: '공유물분할 청구 → 경매로 분할', value: v(0.8), months: 15, prob: '높음', basis: '판결로 전체를 팔아 지분만큼 받음(소송비 수백만 원)', conditions: ['현물분할 가능성', '다른 지분의 근저당'] },
      ], checks: ['공유자 우선매수신고 가능성(민사집행법 제140조)', '공유자 전원 등기부', '감정가가 전체 기준인지 지분 기준인지'] };
    }
    case 'lien':
      return { floor: null, floorBasis: '신고 금액만큼 인수될 수 있음 — 금액 확인 전 바닥 계산 불가', scenarios: [
        { name: '유치권 불성립 → 정상 가격', value: v(0.95), months: 9, prob: '확인 필요', basis: '부존재 확인·인도 소송', conditions: ['경매개시결정 기입등기 전부터 점유했는지', '공사대금 채권인지(분양대금·임차보증금은 아님)', '실제 점유 여부(현황조사서)'] },
      ], checks: ['유치권 신고서·공사계약서', '현황조사서 점유자', '현장 사진'] };
    case 'grave':
      return { floor: s.graveFloor, floorBasis: '분묘 부담 할인', scenarios: [
        { name: '분묘 개장 협의 → 정상 토지', value: v(1), months: 12, prob: '보통', basis: '연고자 협의·개장(장사법)', conditions: ['분묘 수·연고자', '분묘기지권 성립 여부(시효취득도 지료는 청구 가능, 대법원 2021. 4. 29. 2017다228007 전원합의체)'] },
      ], checks: ['현장 분묘 수', '감정평가서 분묘 기재'] };
    case 'surviving':
      return { floor: null, floorBasis: '인수 금액 확인 전 바닥 계산 불가', scenarios: [
        { name: '인수 권리가 실제로는 소멸 → 정상 가격', value: v(1), months: 6, prob: '확인 필요', basis: '담보가등기면 소멸, 보전처분 후 3년간 본안 미제기 가처분은 취소 신청(민사집행법 제288조)', conditions: ['가등기 성격(담보/소유권이전청구권)', '가처분 피보전권리·본안 제기 여부', '선순위 임차인 배당요구로 전액 배당되는지'] },
      ], checks: ['등기부 전체(말소기준권리 이전 권리)', '매각물건명세서 인수 기재'] };
    case 'tenant': {
      const r = riskyTenants(item);
      const known = r.deposit !== null && r.base;
      return { floor: known ? 1 : null, assume: known ? r.deposit : 0, floorBasis: known ? `대항력 있을 수 있는 임차인 보증금 ${Math.round(r.deposit / 1e4).toLocaleString('ko-KR')}만 원 인수 전제` : '보증금·전입일 확인 전 바닥 계산 불가', scenarios: [
        { name: '가장 임차인·대항력 없음 확인 → 인수 없음', value: v(1), months: 6, prob: '확인 필요', basis: '전입일이 말소기준권리보다 늦거나 실거주 아님(가족 등)', conditions: ['전입일 vs 말소기준일', '확정일자·배당요구', '현황조사서 점유 관계'] },
      ], checks: ['전입세대 열람', '임대차 현황'] };
    }
    case 'roadPlan':
      return { floor: 1, floorBasis: '저촉 부분 보상 전제', scenarios: [
        { name: '장기 미집행 → 매수청구·보상', value: v(1), months: 24, prob: '보통', basis: '지목 대(垈)이고 10년 이상 미집행이면 매수청구(국토계획법 제47조)', conditions: ['결정 고시일', '지목', '저촉 면적'] },
      ], checks: ['도시계획시설 결정 고시', '저촉 면적'] };
    case 'greenbelt':
      return { floor: 1, floorBasis: '개발제한구역 시세 그대로', scenarios: [
        { name: '매수청구·해제 기대', value: null, months: 60, prob: '낮음', basis: '개발제한구역법 제17조 매수청구(효용 현저히 감소 토지)', conditions: ['해제 계획·주변 개발'] },
      ], checks: ['행위제한·기존 건축물'] };
    default: return null;
  }
}

// 주변 필지 맹지 자동 확인 결과(서버가 브이월드 지적도·토지특성으로 조사)
function nbProb(item) {
  const nb = item.neighbors;
  if (!nb || nb.error || !nb.checked) return '보통';
  return nb.landlocked > 0 ? '높음' : '낮음';
}
function nbText(item) {
  const nb = item.neighbors;
  if (!nb) return '주변에 맹지 필지가 있는지(자동 확인 전)';
  if (nb.error) return `주변 맹지 자동 확인 실패: ${nb.error}`;
  if (!nb.landlocked) return `✔ 확인됨: 주변 ${nb.checked}필지 중 맹지 없음 — 이 시나리오는 약함`;
  const names = nb.list.filter((x) => x.landlocked).slice(0, 5).map((x) => x.jibun).join(', ');
  return `✔ 확인됨: 주변 ${nb.checked}필지 중 맹지 ${nb.landlocked}필지 (${names}) — 이 땅 주인들이 매수 후보`;
}

// 같은 법정동 최근 건축 허가(건축HUB 인허가)
function pmText(item) {
  const pm = item.permits;
  if (!pm) return '주변 신축·개발 움직임(자동 확인 전)';
  if (pm.error) return `주변 건축 허가 자동 확인 실패: ${pm.error}`;
  return pm.newBuild ? `✔ 확인됨: 같은 동 최근 ${pm.years}년 신축 허가 ${pm.newBuild}건(같은 번지대 ${pm.nearby}건) — 개발 수요 있음` : `✔ 확인됨: 같은 동 최근 ${pm.years}년 신축 허가 없음 — 개발 수요 약함`;
}

const PROB_PT = { 높음: 20, 보통: 13, '확인 필요': 9, 낮음: 5 };

// 하자 없는 가치(full)를 받아 특수물건 분석 결과를 만든다. 특수 사정이 없으면 null
export function specialAnalysis(item, { full, settings, member, rightValue, redev, rounds } = {}) {
  const found = detectSpecial(item);
  if (!found.length) return null;
  const s = { ...SPECIAL_DEFAULTS, ...(settings?.special || {}) };
  const ctx = { s, member, rightValue, redev: redev?.length > 0, roadPlan: found.some((x) => x.key === 'roadPlan') };
  const types = found.map((x) => ({ ...x, label: LABEL[x.key], ...build(x.key, item, full, ctx) }));
  // 바닥 계수는 겹치면 곱한다(도로+지분 → 1/3 × 0.6). 금액 미확인 유형이 있으면 바닥은 '추정 불가'
  const unknownFloor = types.some((t) => t.floor === null);
  const factor = types.reduce((p, t) => p * (t.floor ?? 1), 1);
  const manualFloor = item.manual?.special?.floor;
  // 인수 금액: 정민 님이 확인해 넣은 값이 우선, 없으면 자료로 계산된 값(임차인 보증금 등)
  const autoAssume = types.reduce((p, t) => p + (t.assume || 0), 0);
  const assume = item.manual?.special?.assume || autoAssume;
  let floor = full ? Math.round(full * factor) - assume : null;
  if (manualFloor) floor = manualFloor;
  const floorKnown = Boolean(full) && (!unknownFloor || Boolean(item.manual?.special?.assume) || Boolean(manualFloor));
  const scenarios = types.flatMap((t) => t.scenarios.map((sc) => ({ ...sc, type: t.label })));
  // 시나리오 가치는 다른 하자의 바닥 계수를 남긴 채 계산(도로+지분이면 도로가 풀려도 지분 할인은 남음)
  scenarios.forEach((sc) => {
    if (sc.value && types.length > 1) {
      const others = types.filter((t) => t.label !== sc.type).reduce((p, t) => p * (t.floor ?? 1), 1);
      sc.value = Math.round(sc.value * others);
    }
  });
  const best = scenarios.filter((x) => x.value).sort((a, b) => b.value - a.value)[0] || null;
  const price = item.minBid || null;
  const floorEntry = floorKnown && floor > 0 ? (rounds || []).find((r) => r.price <= floor) || null : null;
  // 기대 가치: 바닥에서 최고 시나리오까지 오른 폭을 가능성만큼만 인정
  const P = { 높음: 0.8, 보통: 0.5, '확인 필요': 0.3, 낮음: 0.2 };
  // 바닥을 모를 때(인수 금액 미확인)는 하자 없는 가치의 일정 비율(기본 60%)을 임시 바닥으로 본다
  const base = floorKnown ? floor : full ? full * (s.unknownFloor ?? 0.6) : null;
  const expected = best && base !== null ? Math.round(base + Math.max(0, best.value - base) * (P[best.prob] ?? 0.3)) : base;
  const score = (() => {
    if (!price) return null;
    const fr = floorKnown ? floor / price : null;
    const pFloor = fr === null ? 12 : Math.round(Math.max(0, Math.min(1, (fr - 0.5) / 0.6)) * 40); // 바닥/입찰가 1.1 이상 만점
    const up = expected ? expected / price - 1 : 0;
    const pUp = Math.round(Math.max(0, Math.min(1, up / 1.0)) * 30); // 기대 가치가 입찰가의 2배면 만점
    const pProb = best ? PROB_PT[best.prob] ?? 9 : 0;
    const pInfo = item.detail ? 10 : 4;
    const total = pFloor + pUp + pProb + pInfo;
    return { total, grade: total >= 70 ? 'A' : total >= 50 ? 'B' : 'C', parts: { 바닥안전: pFloor, 상승폭: pUp, 실현가능성: pProb, 정보: pInfo } };
  })();
  const checks = [...new Set(types.flatMap((t) => t.checks))];
  return { types, factor, floor, floorKnown, assume, best, expected, scenarios, floorEntry, score, checks };
}
