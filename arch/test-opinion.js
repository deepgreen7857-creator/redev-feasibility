// node arch/test-opinion.js — 담당자 검토 의견 문안(shared/review-opinion.js) 시험
const assert = require('assert'); const O = require('../shared/review-opinion.js');
const v = { rules: [{ id: 'spacing', 항목: '동 사이 거리', 동: [101, 102] }, { id: 'side', 항목: '옆 동', 동: [102, 103] }, { id: 'far', 항목: '용적률', 값: '312%', 기준: '300%', 근거: '정비계획' }],
  risks: [{ id: 'privacy', 항목: '101·104동 창끼리 마주 봄 12.3m(15m 미만) — 심의 지적 가능', 동: [101, 104] }, { id: 'sun_tolerance', 동: [105, 101] }, { id: 'near', 항목: '102·104동 근접 7.5m(10m 미만)', 동: [102, 104] }] };
const pv = { ok: false, total: 1101, lost: 84, per: { 101: { lost: 30, total: 200 }, 102: { lost: 54, total: 180 }, 103: { lost: 0, total: 150 } } };
const t = O.text(v, pv, { sun: {}, kstLost: 120 }, { landscape: { 통경축_개방률_퍼센트: 21.4, 경계부_층수_점감_대상동: [106] } });
console.log(t);
assert.ok(/제86조제3항제2호/.test(t) && /세대별 일조분석 자료/.test(t), '단서 문안');
assert.ok(/101·102·103동 사이/.test(t) && /약 84세대\(101동 30세대, 102동 54세대\)/.test(t), '동·미달 세대');
assert.ok(/표준시 기준 미달 약 120세대/.test(t), '시각 기준');
assert.ok(/용적률\(계획 312% \/ 기준 300%\)/.test(t), '법정 위반');
assert.ok(/101·104동은 채광창이 근거리\(약 12.3m\)/.test(t), '시선 간섭');
assert.ok(/105동 저층부/.test(t) && /7.5m/.test(t) && /21.4%/.test(t) && /106동은 구역 경계부/.test(t));
assert.ok(/^1\. /.test(t) && /변동될 수 있습니다\.$/.test(t));
assert.ok(/특이사항 없음/.test(O.text({ rules: [], risks: [] }, null, null)));
console.log('\n검토 의견 문안 시험 통과');
