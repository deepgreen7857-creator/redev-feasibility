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
  assert.equal(rightsCheck({ usage: '다세대', ledger: { useApr: '2020-03-02' } }, zone).status, 'noHit');
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
