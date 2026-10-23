import test from 'node:test';
import assert from 'node:assert';
import { parseLot, zoneLots, itemLot, matchZone, rightsCheck, zoneStatus, needsRecheck, inPolygon } from './zoneMatch.js';
import { analyze } from './analyze.js';
import { DEFAULT_SETTINGS } from '../data/defaults.js';

const zone = {
  id: 'z1', name: '십정5구역', sido: '인천광역시', sgg: '부평구', type: '재개발', stage: '조합설립',
  rightsDate: { announced: true, date: '2020-03-02', basis: '지정고시일' },
  boundary: { lots: '십정동 123-4, 125\n산 7-1\n2823710100101260003' }, confirmedAt: '2026-10-01',
};

test('포함 지번 목록 읽기: 동 이어 쓰기·산·PNU', () => {
  const { pnus, lots } = zoneLots(zone);
  assert.ok(pnus.has('2823710100101260003'));
  assert.deepEqual(lots.map((l) => `${l.dong}${l.mountain ? '산' : ''}${l.bon}-${l.bu}`), ['십정동123-4', '십정동125-0', '십정동산7-1']);
  assert.deepEqual(parseLot('삼계리 산56'), { dong: '삼계리', mountain: true, bon: 56, bu: 0 });
});
test('물건 지번: 주소 글 + PNU(산·본번·부번 우선)', () => {
  assert.deepEqual(itemLot({ title: '경기도 용인시 처인구 포곡읍 삼계리 산 56 임야' }), { dong: '삼계리', mountain: true, bon: 56, bu: 0 });
});
test('매칭: PNU → 지번 → 경계, 시군구 다르면 안 붙음', () => {
  assert.equal(matchZone({ sido: '인천광역시', sgg: '부평구', pnu: '2823710100101260003' }, [zone]).by, 'PNU');
  assert.equal(matchZone({ sido: '인천광역시', sgg: '부평구', address: '인천광역시 부평구 십정동 123-4 제2층' }, [zone]).by, '지번');
  assert.equal(matchZone({ sido: '인천광역시', sgg: '계양구', address: '인천광역시 계양구 십정동 123-4' }, [zone]), null);
  const poly = { ...zone, boundary: { polygon: [[126.70, 37.46], [126.71, 37.46], [126.71, 37.47], [126.70, 37.47]] } };
  assert.equal(matchZone({ sido: '인천광역시', sgg: '부평구', address: '십정동 999' }, [poly], { geo: [126.705, 37.465] }).by, '경계(대략)');
  assert.equal(inPolygon([0, 0], poly.boundary.polygon), false);
});
test('목록에 없고 브이월드에 정비구역 → 목록 미등록, 토지이용 미조회 → 확인 전, 그 외 → 아님', () => {
  assert.equal(zoneStatus({ land: { landUse: { redevelopment: ['정비구역'] } } }, []).status, 'unlisted');
  assert.equal(zoneStatus({}, []).status, 'unchecked');
  assert.equal(zoneStatus({ land: { landUse: { redevelopment: [] } } }, []).status, 'none');
});
test('권리산정기준일: 기준일 다음 날 이후 사용승인 다세대 → 4호 분양권 제한, 기준일 당일은 해당 없음', () => {
  const r = rightsCheck({ usage: '다세대', ledger: { useApr: '2020-03-03' } }, zone);
  assert.equal(r.status, 'restricted'); assert.equal(r.effectiveFrom, '2020-03-03'); assert.equal(r.hits[0].ho, 4);
  // 사용승인일은 기준일 전이지만 분할일·전환일 등은 모름 → 판단불가(날짜 미확인)
  assert.equal(rightsCheck({ usage: '다세대', ledger: { useApr: '2020-03-02' } }, zone).status, 'unknown');
  assert.equal(rightsCheck({ usage: '토지', manual: { rights77: { split: true } } }, zone).hits[0].ho, 1);
  assert.equal(rightsCheck({ usage: '다세대', detail: { conditions: '대지권 미등기' } }, zone).status, 'risk');
  assert.equal(rightsCheck({}, { ...zone, stage: '후보지·사전검토', rightsDate: { announced: false } }).status, 'pending');
});
test('분석 연결: 목록 구역 + 기준일 뒤 신축 → 현금청산형, 확인일 90일 지나면 재확인', () => {
  const item = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', usage: '다세대', buildingArea: 40, appraisal: 2e8, minBid: 1e8, ledger: { useApr: '2021-05-01' } };
  item.redevMatch = zoneStatus(item, [{ ...zone, boundary: { lots: '십정동 123-4' } }]);
  assert.equal(item.redevMatch.status, 'unchecked'); // 주소가 없어 매칭 안 됨
  item.address = '인천광역시 부평구 십정동 123-4';
  item.redevMatch = zoneStatus(item, [zone]);
  assert.equal(item.redevMatch.rights.status, 'restricted');
  const a = analyze(item, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.member.status, 'cash'); assert.ok(a.cashType);
  assert.equal(needsRecheck({ confirmedAt: '2026-01-01' }, new Date('2026-10-23').getTime()), true);
  assert.equal(needsRecheck({ confirmedAt: '2026-10-01' }, new Date('2026-10-23').getTime()), false);
});

// ── 2026-10-23d: 제77조① 5호·설정값 관리·세 갈래 판정·카드 태그 ─────────────────
import { zoneTags, extraParcels, rights77Of, RIGHTS77_LABEL } from './zoneMatch.js';
import { RIGHTS77_DEFAULT } from '../data/defaults.js';

test('제77조①: 5호(전유부분 분할) 포함, 결과는 분양권 가능 / 분양권 제한 / 판단불가 셋', () => {
  assert.deepEqual(RIGHTS77_DEFAULT.rules.map((r) => r.ho), [1, 2, 3, 4, 5]);
  const apt = { usage: '다세대', ledger: { useApr: '2015-06-01' } };
  // 모든 날짜가 기준일 다음 날 전 → 분양권 가능, 판정 근거 날짜 표시
  const allBefore = { ...apt, manual: { rights77: { splitDate: '2010-01-01', collectiveDate: '2015-06-01', separatedDate: '2015-06-01', unitSplitDate: '2015-06-01' } } };
  const ok = rightsCheck(allBefore, zone);
  assert.equal(ok.status, 'ok'); assert.equal(ok.label, '분양권 가능');
  assert.equal(ok.dates.length, 5); assert.ok(ok.dates.every((d) => /전$/.test(d.cmp)));
  // 5호: 전유부분 분할일이 기준일 다음 날 이후 → 분양권 제한
  const r5 = rightsCheck({ ...allBefore, manual: { rights77: { ...allBefore.manual.rights77, unitSplitDate: '2021-01-05' } } }, zone);
  assert.equal(r5.status, 'restricted'); assert.equal(r5.hits[0].ho, 5); assert.equal(r5.label, RIGHTS77_LABEL.restricted);
  // 기준일 당일 분할은 해당 없음, 다음 날부터 해당
  assert.equal(rightsCheck({ usage: '토지', manual: { rights77: { splitDate: '2020-03-02' } } }, zone).status, 'ok');
  assert.equal(rightsCheck({ usage: '토지', manual: { rights77: { splitDate: '2020-03-03' } } }, zone).status, 'restricted');
  // 날짜 모름 → 판단불가(날짜 미확인)
  const u = rightsCheck({ usage: '토지' }, zone);
  assert.equal(u.status, 'unknown'); assert.match(u.text, /판단불가\(날짜 미확인\).*토지 분할일/);
  // 토지만 있는 물건은 1호만 따진다
  assert.deepEqual(u.dates.map((d) => d.ho), [1]);
});
test('제77조① 사유 목록은 설정값: 관리자가 고친 사유·조례 메모가 판정에 쓰임', () => {
  const cfg = rights77Of({ rights77: { law: '개정법 제77조①', rules: [...RIGHTS77_DEFAULT.rules, { ho: 6, text: '(가상) 새 사유', date: 'ho6Date', dateLabel: '새 날짜', applies: 'all' }], ordinance: { 인천광역시: '분양 대상: 90㎡ 이상 토지' } } });
  const r = rightsCheck({ sido: '인천광역시', usage: '토지', manual: { rights77: { splitDate: '2010-01-01', ho6Date: '2024-01-01' } } }, zone, cfg);
  assert.equal(r.status, 'restricted'); assert.equal(r.hits[0].ho, 6); assert.equal(r.law, '개정법 제77조①');
  assert.equal(r.ordinance, '분양 대상: 90㎡ 이상 토지');
  assert.equal(rights77Of({}).rules.length, 5); // 설정이 없으면 기본값(현행 1~5호)
});
test('기준일 미고시 구역 → "기준일 미고시 — 향후 고시 시 재판정"', () => {
  const r = rightsCheck({ usage: '다세대' }, { ...zone, stage: '후보지·사전검토', rightsDate: { announced: false } });
  assert.equal(r.status, 'pending'); assert.match(r.text, /^기준일 미고시 — 향후 고시 시 재판정/);
});

// 알려진 정비구역(지정고시·기준일 고시) 안 필지 1건 + 지정 전 후보지 필지 1건 — 시험용 목록(실제 구역 자료 아님)
const designated = { id: 'zA', name: '시험A재개발구역', sido: '인천광역시', sgg: '부평구', type: '재개발', stage: '지정고시', rightsDate: { announced: true, date: '2023-05-10', basis: '지정고시일' }, boundary: { lots: '부개동 100-1, 100-2' }, confirmedAt: '2026-10-20', sourceUrls: ['https://example.invalid/추진현황'] };
const candidate = { id: 'zB', name: '시험B후보지', sido: '서울특별시', sgg: '강북구', type: '재개발', stage: '후보지·사전검토', rightsDate: { announced: false }, permitZone: { yes: true, from: '2026-01-01', to: '2027-12-31' }, boundary: { lots: '미아동 200' }, confirmedAt: '2026-10-20', sourceUrls: ['https://example.invalid/후보지'] };

test('알려진 정비구역 안 필지: 지번으로 연결, 기준일 태그·분양권 판정', () => {
  const item = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', address: '인천광역시 부평구 부개동 100-2', usage: '다세대', buildingArea: 40, landArea: 20, appraisal: 2e8, minBid: 1.4e8, ledger: { useApr: '2001-04-01' } };
  item.redevMatch = zoneStatus(item, [designated, candidate]);
  assert.equal(item.redevMatch.status, 'listed'); assert.equal(item.redevMatch.by, '지번'); assert.equal(item.redevMatch.name, '시험A재개발구역');
  const a = analyze(item, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.zoneInfo.before, false);
  assert.deepEqual(a.zoneInfo.tags.map((t) => t.text), ['시험A재개발구역·지정고시', '기준일 2023.05.10', '분양권 판단불가']);
  assert.equal(a.rights77.status, 'unknown');
});
test('지정 전 후보지 필지: [지정 전·○○(후보지)] [기준일 미고시] [허가구역] + 법인 취득 제약 확인 필요', () => {
  const item = { source: 'onbid', category: 'public', sido: '서울특별시', sgg: '강북구', title: '서울특별시 강북구 미아동 200 단독주택', usage: '단독주택', buildingArea: 80, landArea: 120, appraisal: 6e8, minBid: 4e8 };
  item.redevMatch = zoneStatus(item, [designated, candidate]);
  assert.equal(item.redevMatch.status, 'listed');
  const a = analyze(item, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.zoneInfo.before, true);
  assert.deepEqual(a.zoneInfo.tags.map((t) => t.text), ['지정 전·시험B후보지(후보지)', '기준일 미고시', '허가구역', '분양권 재판정 대기']);
  assert.equal(a.zoneInfo.corpPermit, true);
  assert.ok(a.warnings.some((w) => /법인 취득 제약 확인 필요/.test(w)));
  assert.ok(a.warnings.some((w) => /기준일 미고시 — 향후 고시 시 재판정/.test(w)));
  // 허가 기간이 끝났으면 허가구역 태그 없음
  assert.equal(zoneTags(item, { ...candidate, permitZone: { yes: true, to: '2025-12-31' } }, null).permit, null);
  // 브이월드 토지이용계획에 토지거래허가구역만 찍혀도 법인 제약 배지
  assert.equal(zoneTags({ land: { landUse: { permitZone: true } } }, null, null).corpPermit, true);
});
test('외 ○필지: 첫 필지만 조회됨 경고', () => {
  assert.equal(extraParcels({ title: '경기도 여주시 ○○면 전북리 산40-6 외 2필지 임야' }), 2);
  const a = analyze({ source: 'onbid', category: 'public', sido: '경기도', sgg: '여주시', title: '경기도 여주시 전북리 산40-6 외 2필지', usage: '임야', landArea: 5000, minBid: 1e7, land: { officialPrice: 3000 } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.ok(a.warnings.some((w) => /외 2필지/.test(w)));
});
