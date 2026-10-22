import test from 'node:test';
import assert from 'node:assert';
import * as XLSX from 'xlsx';
import { parseZones, zonesForListing, toDate, normalizeStage, stageForAnalysis } from './redevZones.js';

test('서울형: 제목줄 아래 머리글, 단계 열, 날짜 문자열', () => {
  const rows = [
    ['서울특별시 정비사업 현황(2026.6.30 기준)'], [],
    ['연번', '자치구', '사업구분', '구역명', '위치', '면적(㎡)', '추진단계', '구역지정', '조합설립인가', '사업시행인가', '관리처분인가'],
    [1, '마포구', '재개발', '○○1구역', '마포구 아현동 699번지 일대', '25,000', '관리처분', '2015.05.12', '2018.03.02', '2021.07.01', '2024.11.20'],
    [2, '강북구', '재건축', '△△아파트', '강북구 미아동 1-2', '12,000', '', '2020-01-10', '', '', ''],
    ['', '', '', '합계', '', '', '', '', '', '', ''],
  ];
  const { zones, header } = parseZones(rows, { sido: '서울특별시' });
  assert.equal(header.index, 2);
  assert.equal(zones.length, 2);
  assert.equal(zones[0].stage, '관리처분인가 후');
  assert.equal(zones[0].emd, '아현동');
  assert.equal(zones[0].dates.union, '2018-03-02');
  assert.equal(zones[1].stage, '구역지정');
});

test('인천형: 두 줄 머리글(인가일 아래 세부), 엑셀 날짜 일련번호', () => {
  const rows = [
    ['구분', '구역명', '대표지번', '사업유형', '추진현황', '인가일', '', ''],
    ['', '', '', '', '', '추진위원회 승인일', '조합설립인가일', '사업시행인가일'],
    ['미추홀구', '용현○구역', '용현동 340', '재개발', '추진위 구성', 45000, '', ''],
    ['부평구', '십정○구역', '십정동 123-4 일원', '재개발', '조합설립인가', 44000, 45500, ''],
  ];
  const { zones } = parseZones(rows, { sido: '인천광역시' });
  assert.equal(zones.length, 2);
  assert.equal(zones[0].stage, '추진위원회 승인');
  assert.equal(zones[1].stage, '조합설립인가 후');
  assert.equal(zones[1].dates.union, toDate(45500));
  assert.deepEqual(zones[1].lots, ['123']);
});

test('실제 xlsx 파일 왕복', () => {
  const ws = XLSX.utils.aoa_to_sheet([['정비구역명', '소재지', '진행단계'], ['작전○구역', '계양구 작전동 45번지', '사업시행인가']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '현황');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(back.Sheets['현황'], { header: 1, defval: '' });
  const { zones } = parseZones(rows, { sido: '인천광역시' });
  assert.equal(zones[0].stage, '사업시행인가 후');
});

test('물건 ↔ 구역: 같은 동, 지번 일치 우선', () => {
  const zones = [
    { sgg: '부평구', name: 'A구역', location: '십정동 200 일원', emd: '십정동', lots: ['200'] },
    { sgg: '부평구', name: 'B구역', location: '십정동 123-4 일원', emd: '십정동', lots: ['123'] },
    { sgg: '계양구', name: 'C구역', location: '작전동 45', emd: '작전동', lots: ['45'] },
  ];
  const r = zonesForListing({ sido: '인천광역시', sgg: '부평구', emd: '십정동', address: '인천광역시 부평구 십정동 123-9 빌라' }, zones);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'B구역'); assert.equal(r[0].strong, true);
});

test('단계 정규화', () => {
  assert.equal(normalizeStage('이주 및 철거'), '관리처분인가 후');
  assert.equal(stageForAnalysis('착공'), '관리처분인가 후');
  assert.equal(normalizeStage('정비예정구역'), '정비예정구역');
});

test('경기형: 3줄 머리글, 합계줄(구역명 자리 숫자) 건너뜀, 사업단계 "예정구역"', () => {
  const rows = [
    ['□ 경기도 일반 정비사업 추진현황 세부내역 (2026년도 3/4분기 자료)'],
    ['연번', '시군', '사업단계', '사업유형', '정비구역명', '위치', '구역면적\r\n(㎡)', '정비구역지정', '추진위\r\n승인\r\n(최초)', '조합설립\r\n인가\r\n(최초)', '관리처분\r\n인가\r\n(최초)', '준공일'],
    ['', '', '', '', '', '', '', '최초', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', 554, '', 30922529, '', '', '', '', ''],
    [1, '수원시', '예정구역', '재건축', '원천1(아주아파트)', '영통구 원천동 71-1일원', 10494, '', '', '', '', ''],
    [2, '구리시', '조합설립', '재개발', '수택E', '수택동496-6번지 일원', 146946, new Date(Date.UTC(2010, 4, 9, 14, 59, 8)), '', new Date(Date.UTC(2015, 2, 12, 14, 59, 8)), '', ''],
  ];
  const { zones } = parseZones(rows, { sido: '경기도', kind: '정비사업' });
  assert.equal(zones.length, 2);
  assert.equal(zones[0].stage, '정비예정구역');
  assert.equal(zones[1].emd, '수택동');
  assert.equal(zones[1].dates.union, '2015-03-13');
  assert.equal(zones[1].dates.designated, '2010-05-10');
});
