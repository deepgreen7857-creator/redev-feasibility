'use strict';

// 건축물대장(공공데이터포털 건축HUB) 표제부로 건축물조서를 정확하게 채움
// 필지 PNU(19자리) = 시군구 5 + 법정동 5 + 대지구분 1(1 일반, 2 산) + 본번 4 + 부번 4
const Ledger = {
  URL: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo',
  get enabled() { return typeof DATA_GO_KR_KEY === 'string' && DATA_GO_KR_KEY.trim() !== ''; },

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
      const msg = (j && j.OpenAPI_ServiceResponse && j.OpenAPI_ServiceResponse.cmmMsgHeader && j.OpenAPI_ServiceResponse.cmmMsgHeader.errMsg) || (h && h.resultMsg) || `HTTP ${res.status}`;
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
      floorArea: Math.round(num(t.totArea) * 10) / 10, floors: num(t.grndFlrCnt), basement: num(t.ugrndFlrCnt),
      units, families: num(t.fmlyCnt), needUnits: isApt && !units, noInfo: !aprDate,
    };
  },

  // 토지조서의 필지마다 대장을 조회해, 대장이 있는 필지의 건축물은 대장 기준으로 바꿈
  async fill() {
    const msg = $('#ledgerMsg');
    if (!this.enabled) { msg.textContent = '건축물대장 인증키가 없습니다.'; return; }
    const lands = S.lands.filter(l => /^\d{19}$/.test(String(l.pnu || '')));
    if (!lands.length) { msg.textContent = '지도에서 불러온 필지(토지조서)가 있어야 조회할 수 있습니다. 구역계에서 먼저 필지를 불러오세요.'; return; }
    if (lands.length > 3000 && !confirm(`필지 ${lands.length}개를 조회합니다. 하루 조회 한도(1만 건)를 많이 씁니다. 계속할까요?`)) return;

    const found = new Map(), errors = [];
    let done = 0;
    const queue = lands.slice();
    const work = async land => {
      try {
        const items = (await this.titleOf(land.pnu)).filter(t => String(t.mainAtchGbCd) !== '1');   // 부속건축물 제외
        if (items.length) found.set(land.pnu, items.map(t => this.toRow(t, land)));
      } catch (e) { errors.push(`${land.jibun}: ${e.message}`); }
      done++;
      if (done % 5 === 0 || done === lands.length) msg.textContent = `건축물대장 조회 중… ${done}/${lands.length}`;
    };
    await Promise.all([1, 2, 3, 4].map(async () => { while (queue.length) await work(queue.shift()); }));

    // 인증 문제 등으로 전부 실패하면 기존 조서를 건드리지 않음
    if (!found.size && errors.length) {
      msg.textContent = `건축물대장을 불러오지 못했습니다: ${errors[0]}`;
      return;
    }
    const before = S.buildings.length;
    S.buildings = S.buildings.filter(b => !(b.pnu && found.has(b.pnu)));   // 대장이 있는 필지는 대장 기준으로 교체
    found.forEach(rows => S.buildings.push(...rows));
    const ledgerCnt = [...found.values()].reduce((a, r) => a + r.length, 0);
    const noLedger = lands.length - found.size - errors.length;
    const kept = S.buildings.filter(b => b.pnu && !b.ledger && !found.has(b.pnu)).length;
    S.buildings.forEach(b => { if (b.pnu && !b.ledger && !found.has(b.pnu)) b.noLedger = true; });
    sortByJibun();
    msg.innerHTML = `필지 ${fmt(lands.length)}개 조회 → <b>건축물대장 ${fmt(ledgerCnt)}동</b>으로 건축물조서를 채웠습니다 (이전 ${fmt(before)}동).`
      + (noLedger ? ` 대장이 없는 필지 ${fmt(noLedger)}개` + (kept ? `(지도 자료 건물 ${fmt(kept)}동은 "대장 없음"으로 남김 – 무허가 등 확인 필요)` : '') + '.' : '')
      + (errors.length ? ` <b class="warn">조회 실패 ${errors.length}건</b> – 잠시 후 다시 누르면 그 필지만 다시 채웁니다.` : '');
  },
};
