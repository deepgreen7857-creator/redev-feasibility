'use strict';

// 건축물대장(공공데이터포털 건축HUB) 표제부로 건축물조서를 정확하게 채움
// 필지 PNU(19자리) = 시군구 5 + 법정동 5 + 대지구분 1(1 일반, 2 산) + 본번 4 + 부번 4
const Ledger = {
  URL: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo',
  get enabled() { return typeof DATA_GO_KR_KEY === 'string' && DATA_GO_KR_KEY.trim() !== ''; },

  // 개발계정은 초당 요청 수 제한이 있어 요청 간격을 두고, 막히면 기다렸다 다시 시도
  GAP: 300, last: 0,
  async throttle() {
    const wait = this.last + this.GAP - Date.now();
    this.last = Math.max(Date.now(), this.last + this.GAP);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  },

  async titleOfRetry(pnu) {
    for (let k = 0; ; k++) {
      await this.throttle();
      try { return await this.titleOf(pnu); }
      catch (e) {
        if (!/PER_SECOND|LIMITED_NUMBER|TIMEOUT|빈 응답/.test(e.message) || k >= 5) throw e;   // 초당 제한·일시 시간 초과·빈 응답은 다시
        this.GAP = Math.min(1500, this.GAP + 100);          // 계속 막히면 간격을 넓힘
        await new Promise(r => setTimeout(r, 800 * (k + 1)));
      }
    }
  },

  // 전유부: 집합건물의 호별 전유면적 (전유공용면적 중 '전유'만). 여러 쪽이면 모두 받음
  async unitsOf(pnu) {
    const p = String(pnu), all = [];
    for (let page = 1; page <= 20; page++) {
      await this.throttle();
      const params = new URLSearchParams({
        serviceKey: DATA_GO_KR_KEY.trim(), sigunguCd: p.slice(0, 5), bjdongCd: p.slice(5, 10),
        platGbCd: p.charAt(10) === '2' ? '1' : '0', bun: p.slice(11, 15), ji: p.slice(15, 19),
        numOfRows: '500', pageNo: String(page), _type: 'json',
      });
      let j = null;
      for (let k = 0; k < 6; k++) {
        const res = await fetch(`${this.URL.replace('getBrTitleInfo', 'getBrExposPubuseAreaInfo')}?${params}`);
        j = await res.json().catch(() => null);
        if (!j) { await new Promise(r => setTimeout(r, 800 * (k + 1))); continue; }   // 포털이 가끔 빈 응답(HTTP 200)을 줌 → 다시 시도
        const err = j && j.OpenAPI_ServiceResponse && j.OpenAPI_ServiceResponse.cmmMsgHeader && j.OpenAPI_ServiceResponse.cmmMsgHeader.errMsg;
        if (err && /PER_SECOND|LIMITED_NUMBER|TIMEOUT/.test(err)) { await new Promise(r => setTimeout(r, 800 * (k + 1))); continue; }
        if (err) throw new Error(err);
        break;
      }
      const body = j && j.response && j.response.body;
      if (!body) throw new Error('전유부 응답 오류');
      const it = body.items && body.items.item;
      const rows = !it ? [] : Array.isArray(it) ? it : [it];
      all.push(...rows);
      if (all.length >= num(body.totalCount) || !rows.length) break;
    }
    return all.filter(r => String(r.exposPubuseGbCd) === '1');
  },

  async titleOf(pnu) {
    const p = String(pnu);
    const params = new URLSearchParams({
      serviceKey: DATA_GO_KR_KEY.trim(), sigunguCd: p.slice(0, 5), bjdongCd: p.slice(5, 10),
      platGbCd: p.charAt(10) === '2' ? '1' : '0', bun: p.slice(11, 15), ji: p.slice(15, 19),
      numOfRows: '100', pageNo: '1', _type: 'json',
    });
    const res = await fetch(`${this.URL}?${params}`);
    const j = await res.json().catch(() => null);
    const h = j && j.response && j.response.header;
    if (!h || h.resultCode !== '00') {
      // 포털이 가끔 빈 응답(HTTP 200)을 줌 → '빈 응답'이면 titleOfRetry가 다시 시도
      const msg = (j && j.OpenAPI_ServiceResponse && j.OpenAPI_ServiceResponse.cmmMsgHeader && j.OpenAPI_ServiceResponse.cmmMsgHeader.errMsg) || (h && h.resultMsg) || (!j ? `빈 응답(HTTP ${res.status})` : `HTTP ${res.status}`);
      throw new Error(msg);
    }
    const it = j.response.body && j.response.body.items && j.response.body.items.item;
    return !it ? [] : Array.isArray(it) ? it : [it];
  },

  // 표제부 한 동 → 건축물조서 한 행
  toRow(t, land) {
    const code = String(t.mainPurpsCd || ''), etc = String(t.etcPurps || '');
    let use = '기타';
    if (code === '01003' || /다가구/.test(etc)) use = '다가구주택';
    else if (code.startsWith('01')) use = '단독주택';
    else if (code === '02001' || /아파트/.test(etc)) use = '아파트';
    else if (code === '02002' || /연립/.test(etc)) use = '연립주택';
    else if (code === '02003' || /다세대/.test(etc)) use = '다세대주택';
    else if (code.startsWith('02')) use = num(t.grndFlrCnt) >= 5 ? '아파트' : '다세대주택';
    else if (code.startsWith('03') || code.startsWith('04')) use = '근린생활시설';
    const s = String(t.strctCd || '').charAt(0);
    const structure = s === '1' ? '조적' : s === '2' || s === '4' ? '철근콘크리트' : s === '3' ? '철골' : s === '5' ? '목조' : '기타';
    const d = String(t.useAprDay || '').trim();
    const aprDate = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
    const isApt = ['아파트', '연립주택', '다세대주택'].includes(use);
    // 세대수: 공동주택은 세대수, 다가구는 가구수 참고(호수 산정은 1호), 단독 1
    const units = isApt ? num(t.hhldCnt) || num(t.hoCnt) : (use === '단독주택' || use === '다가구주택' ? 1 : 0);
    return {
      id: uid(), jibun: land.jibun, pnu: land.pnu, auto: true, ledger: true,
      name: [String(t.bldNm || '').trim(), String(t.dongNm || '').trim()].filter(Boolean).join(' '),
      use, structure, structureName: t.strctCdNm || '', purpose: [t.mainPurpsCdNm, etc.trim()].filter(Boolean).join(' / '),
      year: aprDate ? +aprDate.slice(0, 4) : 0, aprDate,
      floorArea: Math.round(num(t.totArea) * 10) / 10, archArea: Math.round(num(t.archArea) * 10) / 10, floors: num(t.grndFlrCnt), basement: num(t.ugrndFlrCnt),
      units, families: num(t.fmlyCnt), needUnits: isApt && !units, noInfo: !aprDate,
      collective: String(t.regstrGbCd) === '2', dong: String(t.dongNm || '').trim(),
    };
  },

  // 토지조서의 필지마다 대장을 조회해, 대장이 있는 필지의 건축물은 대장 기준으로 바꿈
  async fill() {
    const msg = $('#ledgerMsg');
    if (!this.enabled) { msg.textContent = '건축물대장 인증키가 없습니다.'; return; }
    const all = S.lands.filter(l => /^\d{19}$/.test(String(l.pnu || '')));
    if (!all.length) { msg.textContent = '지도에서 불러온 필지(토지조서)가 있어야 조회할 수 있습니다. 구역계에서 먼저 필지를 불러오세요.'; return; }
    // 이미 대장으로 채웠거나 대장이 없다고 확인된 필지는 건너뜀 (실패한 필지만 다시)
    const doneSet = new Set(S.buildings.filter(b => b.ledger).map(b => b.pnu));
    let lands = all.filter(l => !doneSet.has(l.pnu) && !l.ledgerEmpty);
    if (!lands.length) {
      if (!confirm('모든 필지를 이미 건축물대장으로 확인했습니다. 처음부터 다시 조회할까요?')) return;
      lands = all;
    }
    if (lands.length > 3000 && !confirm(`필지 ${lands.length}개를 조회합니다. 하루 조회 한도(1만 건)를 많이 씁니다. 계속할까요?`)) return;

    const found = new Map(), empty = new Set(), errors = [];
    let done = 0;
    const queue = lands.slice();
    const t0 = Date.now();
    const work = async land => {
      try {
        const items = (await this.titleOfRetry(land.pnu)).filter(t => String(t.mainAtchGbCd) !== '1');   // 부속건축물 제외
        if (items.length) found.set(land.pnu, items.map(t => this.toRow(t, land)));
        else empty.add(land.pnu);
      } catch (e) { errors.push(`${land.jibun}: ${e.message}`); }
      done++;
      const left = Math.round((Date.now() - t0) / done * (lands.length - done) / 1000);
      msg.textContent = `건축물대장 조회 중… ${done}/${lands.length}` + (done < lands.length ? ` (약 ${left >= 60 ? Math.ceil(left / 60) + '분' : left + '초'} 남음)` : '');
    };
    // 요청 간격은 throttle이 지키므로 동시에 2개까지만
    await Promise.all([1, 2].map(async () => { while (queue.length) await work(queue.shift()); }));

    // 집합건물(다세대·연립·아파트 등)이 있는 필지만 전유부(호별 전유면적)를 받음
    const collective = [...found.entries()].filter(([, rows]) => rows.some(r => r.collective));
    const unitRows = [], unitErr = [];
    for (let i = 0; i < collective.length; i++) {
      const [pnu, rows] = collective[i];
      msg.textContent = `전유부(호별) 조회 중… ${i + 1}/${collective.length}`;
      try {
        const us = await this.unitsOf(pnu);
        us.forEach(u => unitRows.push({
          pnu, jibun: rows[0].jibun, bldNm: String(u.bldNm || '').trim(), dong: String(u.dongNm || '').trim(),
          ho: String(u.hoNm || '').trim(), floor: (u.flrGbCdNm === '지하' ? 'B' : '') + num(u.flrNo),
          area: Math.round(num(u.area) * 100) / 100, purpose: String(u.mainPurpsCdNm || u.etcPurps || '').trim(),
        }));
        // 동별 호 수를 표제부 행에 붙임 (동 이름이 같으면 그 동, 한 동뿐이면 전부)
        const col = rows.filter(r => r.collective);
        col.forEach(r => {
          const mine = col.length === 1 ? us : us.filter(u => String(u.dongNm || '').trim() === r.dong);
          r.hoCount = mine.length;
          r.exposArea = Math.round(mine.reduce((a, u) => a + num(u.area), 0) * 10) / 10;
          // 인천 조례: 지하층 세대가 있는 공동주택은 20년 / 호수밀도용 한 층 최대 호 수
          r.resBasement = mine.some(u => u.flrGbCdNm === '지하' && /주택|다세대|연립|아파트/.test(String(u.mainPurpsCdNm || u.etcPurps || '')));
          const perFloor = {};
          mine.filter(u => u.flrGbCdNm !== '지하').forEach(u => { const f = num(u.flrNo); perFloor[f] = (perFloor[f] || 0) + 1; });
          r.maxPerFloor = Math.max(0, ...Object.values(perFloor));
        });
      } catch (e) { unitErr.push(`: ${e.message}`); }
    }
    const refreshed = new Set(collective.map(([p]) => p));
    S.exposUnits = (S.exposUnits || []).filter(u => !refreshed.has(u.pnu)).concat(unitRows);

    // 인증 문제 등으로 전부 실패하면 기존 조서를 건드리지 않음
    if (!found.size && errors.length) {
      msg.textContent = `건축물대장을 불러오지 못했습니다: ${errors[0]}`;
      return;
    }
    const before = S.buildings.length;
    S.buildings = S.buildings.filter(b => !(b.pnu && found.has(b.pnu)));   // 대장이 있는 필지는 대장 기준으로 교체
    found.forEach(rows => S.buildings.push(...rows));
    const ledgerCnt = [...found.values()].reduce((a, r) => a + r.length, 0);
    // '대장 없음'은 조회는 됐는데 표제부가 없는 필지의 건물만 (조회 실패는 표시하지 않음)
    S.lands.forEach(l => { if (empty.has(l.pnu)) l.ledgerEmpty = true; else if (found.has(l.pnu)) l.ledgerEmpty = false; });
    const noLedger = empty.size;
    S.buildings.forEach(b => { if (b.pnu && !b.ledger) b.noLedger = empty.has(b.pnu); });
    const kept = S.buildings.filter(b => b.noLedger).length;
    sortByJibun();
    msg.innerHTML = `필지 ${fmt(lands.length)}개 조회 → <b>건축물대장 ${fmt(ledgerCnt)}동</b>으로 건축물조서를 채웠습니다 (이전 ${fmt(before)}동).`
      + (noLedger ? ` 대장이 없는 필지 ${fmt(noLedger)}개` + (kept ? `(지도 자료 건물 ${fmt(kept)}동은 "대장 없음"으로 남김 – 무허가 등 확인 필요)` : '') + '.' : '')
      + (unitRows.length ? ` 전유부 <b>${fmt(unitRows.length)}호</b>(집합건물 ${fmt(collective.length)}필지)도 받았습니다.` : '')
      + (unitErr.length ? ` 전유부 실패 ${unitErr.length}건.` : '')
      + (errors.length ? ` <b class="warn">조회 실패 ${errors.length}건</b> – 잠시 후 다시 누르면 그 필지만 다시 채웁니다.` : '');
  },
};
