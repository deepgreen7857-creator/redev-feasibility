/* 담당자 검토 의견 문안(2026-11-07, 사용자 목록 6 '단서를 쓸 경우 세대별 일조분석을 제출하라는 식의 문장을 위험요소 카드에서 복사')
   JbsCheck.verify 결과(v) + 세대별 일조(pv, JbsCheck.unitSun) + 정밀 검산(sv, JbsSunVerify.check 결과)을 받아
   인허가 담당자가 보완 요구·검토 의견에 그대로 붙여 쓸 공문체 문장 목록을 만든다. 숫자는 검사 결과 그대로, 근거 조문은 검사 결과의 근거 칸을 씀
   쓰는 곳: /arch 위험요소 카드 '담당자 검토 의견(문안)' [복사] */
(function (g) {
  const dongs = ids => (ids || []).filter(x => x !== undefined && x !== null && x !== '').join('·');
  const uniq = a => [...new Set(a)];
  const m1 = x => (Math.round(+x * 10) / 10).toLocaleString('ko-KR');

  function build(v, pv, sv, o) {
    o = o || {};
    const out = [], rules = (v && v.rules) || [], risks = (v && v.risks) || [];
    const spR = rules.filter(r => ['spacing', 'side'].includes(r.id)), hard = rules.filter(r => !['spacing', 'side'].includes(r.id));
    // ① 법정 기준 위반
    hard.forEach(r => out.push(`${r.동 && r.동.length ? dongs(r.동) + '동 ' : ''}${r.항목}${r.값 ? `(계획 ${r.값}${r.기준 ? ` / 기준 ${r.기준}` : ''})` : ''}이(가) 관련 기준에 맞지 않으므로 계획을 보완하시기 바랍니다.${r.근거 ? ` [근거: ${r.근거}]` : ''}`));
    // ② 동 사이 거리 본문 미달 → 단서 적용 시 세대별 일조분석 제출
    if (spR.length) {
      const ds = uniq(spR.flatMap(r => r.동 || []));
      let s = `${ds.length ? dongs(ds) + '동 사이 ' : ''}거리가 「건축법 시행령」 제86조제3항제2호 본문 기준(인천광역시 건축 조례 배수 적용)에 미달하는 곳이 ${spR.length}곳 있습니다. 같은 호 단서를 적용하려는 경우 그 대지의 모든 세대가 동지일을 기준으로 9시에서 15시 사이에 2시간 이상 계속하여 일조를 확보함을 입증하는 세대별 일조분석 자료(분석 기준 시각·창 위치·층별 결과 포함)를 제출하시기 바랍니다.`;
      if (pv && !pv.ok && pv.lost > 0) {
        const per = Object.entries(pv.per || {}).filter(([, q]) => q.lost).map(([k, q]) => `${k}동 ${q.lost}세대`).join(', ');
        s += ` 개략 검토 결과 전체 ${(+pv.total).toLocaleString('ko-KR')}세대 중 약 ${(+pv.lost).toLocaleString('ko-KR')}세대(${per})가 기준에 미달하는 것으로 보이므로, 주동 배치·간격 조정 또는 해당 세대의 비주거·필로티 계획 등 대안을 함께 검토하시기 바랍니다.`;
      } else if (pv && pv.ok) s += ' 개략 검토로는 모든 세대가 기준을 충족하는 것으로 보이나, 정밀 일조분석으로 확인이 필요합니다.';
      if (sv && sv.sun) s += ` (참고: 분석 시각 기준을 진태양시로 할지 표준시로 할지에 따라 결과가 달라지므로 기준을 명시하시기 바랍니다${sv.kstLost != null ? ` — 개략 검산 시 표준시 기준 미달 약 ${(+sv.kstLost).toLocaleString('ko-KR')}세대` : ''}.)`;
      out.push(s);
    }
    // ③ 경험 항목(심의·민원)
    const by = id => risks.filter(r => r.id === id);
    const sunT = by('sun_tolerance'); if (sunT.length) out.push(`${dongs(uniq(sunT.map(r => (r.동 || [])[0])))}동 저층부는 동지일 일조 시간이 일조 수인한도(판례 기준)에 미달할 우려가 있으므로, 단지 내외 일조 영향을 검토하고 저감 대책(층수 조정·주동 간격 확보 등)을 제시하시기 바랍니다.`);
    by('privacy').forEach(r => { const d = /([\d.]+)m/.exec(r.항목); out.push(`${dongs(r.동)}동은 채광창이 근거리${d ? `(약 ${d[1]}m)` : ''}에서 서로 마주 보아 세대 간 시선 간섭이 우려되므로, 주동 배치 조정, 창 위치·측벽 처리, 차폐 식재 등 사생활 보호 방안을 제시하시기 바랍니다.`); });
    const near = by('near'); if (near.length) out.push(`${near.map(r => dongs(r.동)).join(', ')}동은 모서리 간 거리가 가까워(${near.map(r => { const d = /근접 ([\d.]+)m/.exec(r.항목); return d ? d[1] + 'm' : ''; }).filter(Boolean).join(', ')}) 시선 간섭·화재 확산·통풍에 불리하므로 주동 간 이격을 검토하시기 바랍니다.`);
    const nsP = by('spacing_practical'); if (nsP.length) out.push(`${nsP.map(r => dongs(r.동)).join(', ')}동은 법정 거리는 충족하나 앞뒤 동 간격이 좁아 저층 세대 일조·사생활 민원이 예상되므로 간격 확보 또는 남측 동 층수 조정을 검토하시기 바랍니다.`);
    const ls = by('long_slab'); if (ls.length) out.push(`${dongs(uniq(ls.flatMap(r => r.동 || [])))}동은 고층 장대형 판상으로 계획되어 통경축 확보·조망 차폐가 우려되므로, 주동 분절 또는 탑상형·꺾인 판상형 도입을 검토하시기 바랍니다.`);
    const hj = by('height_jump'); if (hj.length) out.push(`${hj.map(r => dongs(r.동)).join(', ')}동은 인접 주동 간 층수 차이가 커 스카이라인이 급변하므로 층수 단계적 조정(점감)을 검토하시기 바랍니다.`);
    // ④ 경관 검토에서 넘어온 조건(있으면)
    const cl = o.landscape;
    if (cl && cl.통경축_개방률_퍼센트 != null && cl.통경축_개방률_퍼센트 < 30) out.push(`통경축 개방률이 약 ${m1(cl.통경축_개방률_퍼센트)}%로 낮으므로 주요 조망 방향의 통경축을 확보하도록 주동 배치를 조정하시기 바랍니다.`);
    if (cl && (cl.경계부_층수_점감_대상동 || []).length) out.push(`${dongs(cl.경계부_층수_점감_대상동)}동은 구역 경계부에서 주변 기성 시가지 대비 층수 차이가 크므로 경계부 층수 점감을 검토하시기 바랍니다.`);
    return out;
  }

  // 붙여 쓰기용 글(번호 + 맺음말)
  function text(v, pv, sv, o) {
    const L = build(v, pv, sv, o);
    if (!L.length) return '검토 결과 특이사항 없음. ※ 개략 검토 결과이며 인허가 및 심의 과정에서 변동될 수 있습니다.';
    return L.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n※ 위 의견은 개략 배치 검토 결과이며, 인허가 및 심의 과정에서 변동될 수 있습니다.';
  }

  const api = { build, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.JbsOpinion = api;
})(typeof window !== 'undefined' ? window : globalThis);
