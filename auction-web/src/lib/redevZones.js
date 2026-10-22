// 서울·경기·인천 정비사업 현황(분기 엑셀) 읽기 → 구역 목록 → 물건과 연결
// 시도마다 엑셀 모양이 달라서 머리글 이름으로 열을 찾는다(머리글 줄 위치도 자동으로 찾음).

const COLS = {
  name: ['구역명', '정비구역명', '사업장명', '사업명', '구역 명칭', '정비구역 명칭', '단지명', '조합명'],
  sgg: ['자치구', '시군구', '구군', '군구', '시군', '구별', '구청', '관할구', '자치구(군)'],
  location: ['위치', '소재지', '대표지번', '사업위치', '구역위치', '대지위치', '주소', '대표주소'],
  type: ['사업유형', '사업구분', '사업종류', '유형', '정비유형'],
  stage: ['추진단계', '진행단계', '사업단계', '단계', '추진현황', '진행상황', '현재단계'],
  area: ['면적', '구역면적', '정비구역면적', '면적(㎡)'],
  note: ['비고'],
  households: ['세대수', '건립세대수', '계획세대수', '총세대수'],
  candidate: ['후보지', '후보지사업지선정', '정비구역지정후보'],
  designated: ['구역지정', '정비구역지정', '구역지정일', '정비구역 지정일', '지정일', '지정고시일'],
  committee: ['추진위', '추진위원회', '추진위승인', '추진위원회승인', '추진위원회 승인일', '추진위 승인일'],
  union: ['조합설립', '조합설립인가', '조합설립인가일', '조합인가', '주민합의체', '사업시행자지정'],
  review: ['건축심의'],
  implementation: ['사업시행', '사업시행인가', '사업시행계획인가', '사업시행인가일'],
  management: ['관리처분', '관리처분인가', '관리처분계획인가', '관리처분인가일'],
  construction: ['착공', '착공일'],
  completion: ['준공', '준공일', '준공인가'],
  transfer: ['이전고시', '이전고시일'],
};

const STAGE_ORDER = [
  ['transfer', '이전고시'], ['completion', '준공'], ['construction', '착공'], ['management', '관리처분인가 후'],
  ['implementation', '사업시행인가 후'], ['review', '건축심의'], ['union', '조합설립인가 후'], ['designated', '구역지정'], ['committee', '추진위원회 승인'],
  ['candidate', '정비예정구역'],
];

const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[()（）]/g, '');

function matchCol(header) {
  const h = norm(header);
  if (!h) return null;
  let best = null;
  for (const [key, names] of Object.entries(COLS)) {
    for (const n of names) {
      const nn = norm(n);
      if (h === nn || (h.includes(nn) && nn.length >= 2)) {
        const score = h === nn ? 100 : nn.length;
        if (!best || score > best.score) best = { key, score };
      }
    }
  }
  return best && best.key;
}

function rowMap(row, extra) {
  const best = {};
  const take = (cells, filter) => (cells || []).forEach((cell, j) => {
    if (filter && !filter(cell)) return;
    const h = norm(cell);
    for (const [key, names] of Object.entries(COLS)) {
      for (const n of names) {
        const nn = norm(n);
        if (!h || !(h === nn || (h.includes(nn) && nn.length >= 2))) continue;
        const score = h === nn ? 100 : nn.length;
        if (!best[key] || score > best[key].score) best[key] = { j, score };
      }
    }
  });
  take(row);
  // 두 줄 머리글: 아래 줄의 세부 칸(인가·설립·심의·착공 등)이 위 칸보다 정확하면 덮어쓴다
  if (extra) {
    const sub = {};
    (extra || []).forEach((cell, j) => {
      if (!/일|인가|승인|지정|착공|준공|고시|설립|심의|처분|구청|군구/.test(String(cell))) return;
      const k = matchCol(cell);
      if (k && sub[k] === undefined) sub[k] = j;
    });
    Object.entries(sub).forEach(([k, j]) => { if (!best[k] || best[k].score < 100 || norm(row[best[k].j]) === '') best[k] = { j, score: 100 }; });
  }
  // 한 칸이 두 항목에 잡히면 점수가 높은 쪽만 남긴다
  const byCol = {};
  Object.entries(best).forEach(([k, v]) => { if (!byCol[v.j] || byCol[v.j].score < v.score) byCol[v.j] = { k, score: v.score }; });
  const map = {};
  Object.entries(byCol).forEach(([j, v]) => { map[v.k] = Number(j); });
  return map;
}

export function findHeader(rows) {
  let best = { index: -1, map: {}, hits: 0 };
  rows.slice(0, 25).forEach((row, i) => {
    const map = rowMap(row, rows[i + 1]);
    const hits = Object.keys(map).length;
    if (hits > best.hits && (map.name !== undefined || map.location !== undefined)) best = { index: i, map, hits };
  });
  // 두 줄 머리글이면 자료는 그 다음 줄부터
  if (best.index >= 0) {
    const next = rows[best.index + 1] || [];
    const looksSub = next.filter((c) => String(c).trim()).length && !next.some((c) => typeof c === 'number' || c instanceof Date) && !String(next[best.map.name] ?? '').trim();
    best.dataStart = best.index + (looksSub ? 2 : 1);
  }
  return best;
}

export function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  // 엑셀 날짜는 한국 시간 자정이 UTC로 바뀌며 전날로 보이므로 9시간을 더해 읽는다
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(v.getTime() + 9 * 3600e3 + 60e3).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) { // 엑셀 날짜 일련번호
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400e3);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})(?:\s*[.\-/월]\s*(\d{1,2}))?/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}${m[3] ? `-${m[3].padStart(2, '0')}` : ''}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  return null;
}

export function emdOf(text) {
  // '수택동496-6번지', '신흥동2가 54-5', '길상면 온수리 502' 처럼 띄어쓰기가 없어도 찾는다
  const t = String(text || '');
  for (const m of t.matchAll(/([가-힣]{1,8}\d{0,2}(?:동|가|읍|면|리))(?=[\s\d,(\-]|$)/g)) {
    const w = m[1];
    if (/^(일원|일대|기타|구역)$/.test(w) || /(구|시|군)$/.test(w)) continue;
    return w;
  }
  return null;
}

function lotsOf(text) {
  // '신흥동2가 54-5' → 54 ('2가'의 2는 지번이 아님)
  return [...String(text || '').matchAll(/(?:^|[\s,(]|[동리가])(산?\d{1,5})(?![가동\d])(?:-(\d{1,4}))?/g)].map((m) => m[1]);
}

export function parseZones(rows, { sido, quarter, kind } = {}) {
  const head = findHeader(rows);
  if (head.index < 0) return { zones: [], header: head, error: '머리글(구역명·위치 등)을 찾지 못했습니다.' };
  const m = head.map;
  const get = (row, k) => (m[k] === undefined ? null : row[m[k]]);
  const zones = [];
  for (const row of rows.slice(head.dataStart ?? head.index + 1)) {
    if (!row || !row.some((c) => String(c ?? '').trim())) continue;
    const name = String(get(row, 'name') ?? '').trim();
    const location = String(get(row, 'location') ?? '').trim();
    if (!name && !location) continue;
    if (/^(합\s*계|계|소\s*계|총\s*계)$/.test(name) || /^[\d,.\s]+$/.test(name)) continue; // 합계줄(구역명 자리에 숫자)
    if (matchCol(name) === 'name') continue; // 반복 머리글
    const dates = {};
    const marks = {};
    for (const [k] of STAGE_ORDER) {
      const v = get(row, k);
      const d = toDate(v);
      if (d) dates[k] = d;
      else if (/^[○ㅇOo●◎v√✓]$/.test(String(v ?? '').trim())) marks[k] = true; // 인천 정비사업 파일은 해당 단계에 ○ 표시
    }
    const stageText = String(get(row, 'stage') ?? '').trim() || null;
    const derived = (STAGE_ORDER.find(([k]) => dates[k] || marks[k]) || [])[1] || null;
    const sggRaw = String(get(row, 'sgg') ?? '').trim();
    zones.push({
      sido: sido || null,
      sgg: sggRaw || (location.match(/([가-힣]+(시|군|구))\s/) || [])[1] || null,
      name: name || location,
      location,
      emd: emdOf(location) || emdOf(name),
      lots: lotsOf(location),
      type: String(get(row, 'type') ?? '').trim() || null,
      stage: normalizeStage(stageText) || derived || normalizeStage(String(get(row, 'note') ?? '')) || null,
      stageText,
      area: Number(String(get(row, 'area') ?? '').replace(/[^\d.]/g, '')) || null,
      households: Number(String(get(row, 'households') ?? '').replace(/[^\d]/g, '')) || null,
      dates,
      quarter: quarter || null,
      kind: kind || null,
      cancelled: /취소|해제|폐지/.test(`${name} ${stageText || ''}`) || undefined,
    });
  }
  return { zones, header: head };
}

export function normalizeStage(t) {
  if (!t) return null;
  const s = norm(t);
  if (/이전고시/.test(s)) return '이전고시';
  if (/준공/.test(s)) return '준공';
  if (/착공|공사/.test(s)) return '착공';
  if (/관리처분|이주|철거/.test(s)) return '관리처분인가 후';
  if (/건축심의/.test(s)) return '건축심의';
  if (/사업시행/.test(s)) return '사업시행인가 후';
  if (/조합설립|조합인가/.test(s)) return '조합설립인가 후';
  if (/추진위/.test(s)) return '추진위원회 승인';
  if (/후보지|사업지선정/.test(s)) return '정비예정구역';
  if (/구역지정|정비구역/.test(s)) return '구역지정';
  if (/예정/.test(s)) return '정비예정구역';
  return null;
}

// 물건 → 같은 시군구·동의 구역 후보(지번 본번까지 같으면 앞에)
export function zonesForListing(item, zones) {
  if (!item || !zones) return [];
  const emd = item.emd || emdOf(item.address);
  const lot = (String(item.address || '').match(/(?:동|가|리|읍|면)\s*(산?\d{1,5})/) || [])[1];
  return zones
    .filter((z) => (!z.sgg || !item.sgg || item.sgg.includes(z.sgg) || z.sgg.includes(item.sgg)) && emd && (z.emd === emd || String(z.location).includes(emd) || String(z.name).includes(emd.replace(/(동|가)$/, ''))))
    .map((z) => ({ ...z, strong: Boolean(lot && z.lots.includes(lot)) }))
    .sort((a, b) => Number(b.strong) - Number(a.strong));
}

// 현금청산형 판정에 쓰는 단계 값으로 바꾸기
export function stageForAnalysis(stage) {
  if (!stage) return '';
  if (['이전고시', '준공', '착공', '관리처분인가 후'].includes(stage)) return '관리처분인가 후';
  if (stage === '건축심의') return '조합설립인가 후';
  return stage;
}

// 파일 이름으로 종류 구분: 정비사업 / 소규모주택정비
export function kindOfFile(name) {
  const n = String(name || '');
  if (/소규모|가로주택|자율주택/.test(n)) return '소규모주택정비';
  if (/재정비촉진|촉진/.test(n)) return '재정비촉진';
  return '정비사업';
}

// 기준 시점 문자열: "2026년 9월말 기준" → "2026.9월말"
export function basisOf(text) {
  const m = String(text || '').match(/(\d{4})\s*[년.]\s*(\d{1,2})\s*월/);
  return m ? `${m[1]}.${m[2]}월말` : null;
}
