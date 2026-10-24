// 가치 검토 — 실거래가 없는 물건이 더 많으므로, 있는 기준을 모두 맞대어 '범위'로 낸다.
// 각 기준의 값·근거·사용 여부(뺀 이유)를 그대로 돌려줘서 화면에 검토 과정으로 보여 준다.
//   시세 기준: 실거래 · 감정가 · 공시가격 환산 · 전세 환산
//   참고(경매 시장가): 감정가 × 종류별 낙찰가율 — 시세가 아니라 '보통 이 가격대에 낙찰'
// 판단용 가치: 기준들이 잘 맞으면(차이 20% 이하) 가운데 값, 아니면 아래쪽과 가운데의 중간(보수적).

// 공시가격 → 시세 환산 비율(현실화율, 기본값 — 관리자 설정 valuation.realization 으로 바꿀 수 있음)
export const VALUATION_DEFAULTS = {
  realization: { apartHouse: 0.69, detachedHouse: 0.536, land: 0.655 },
  jeonseRatio: { apt: 0.6, rh: 0.7, sh: 0.6, offi: 0.8 },
  // 감정가 대비 낙찰가율 기본값 — 완료 물건(입찰결과)이 쌓이면 실제 값(settings.saleRates)으로 바뀐다
  saleRate: { apt: 0.9, rh: 0.78, sh: 0.78, offi: 0.8, nrg: 0.7, indu: 0.75, land: 0.7 },
  outlier: 0.5, // 다른 기준들의 가운데 값과 50% 넘게 다르면 뺀다
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const eok = (n) => { const v = Math.round(n / 1e4); return Math.abs(v) >= 1e4 ? `${Math.floor(v / 1e4)}억${v % 1e4 ? ` ${(v % 1e4).toLocaleString('ko-KR')}만` : ''}` : `${v.toLocaleString('ko-KR')}만`; };

function monthsSince(ymd) {
  const t = String(ymd || '').replace(/\D/g, '');
  if (t.length < 6) return null;
  const y = Number(t.slice(0, 4)); const m = Number(t.slice(4, 6));
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

// shareRatio: 지분비율(집 전체 값에 곱함) · landShare: 토지면적에 곱할 비율(수집 면적이 이미 지분 면적이면 1)
export function valuation(item, { type, market, marketValue, jeonse, settings, stats, shareRatio = 1, landShare = shareRatio } = {}) {
  const cfg = { ...VALUATION_DEFAULTS, ...(settings?.valuation || {}) };
  const anchors = [];
  const add = (a) => anchors.push({ used: true, ...a });

  // ① 실거래
  if (market?.value) {
    const gradeText = { A: '같은 단지·같은 평형', B: '같은 단지', C: '같은 동', D: '같은 시군구' }[market.grade] || '';
    const scale = marketValue && market.value ? marketValue / market.value : 1; // 지분 등으로 조정된 경우 범위도 같이
    add({ key: 'trade', label: '실거래', value: marketValue || market.value, low: market.low ? Math.round(market.low * scale) : null, high: market.high ? Math.round(market.high * scale) : null, grade: market.grade, basis: `${market.basis}${gradeText ? ` · 근거 ${market.grade}등급(${gradeText})` : ''}` });
  } else if (market?.basis) {
    anchors.push({ key: 'trade', label: '실거래', value: null, used: false, why: market.basis });
  }

  // ② 감정가
  if (item.appraisal) {
    const ad = item.detail?.appraisalDate;
    const age = monthsSince(ad);
    add({ key: 'appraisal', label: '감정가', value: item.appraisal, basis: `법원·온비드 감정평가${ad ? ` (${String(ad).replace(/\D/g, '').slice(0, 8)} 감정${age !== null ? `, ${age}개월 전` : ''})` : ''}`, stale: age !== null && age > 12 });
  }

  // ③ 공시가격 환산 — 집 전체 값이므로 지분 물건은 지분 비율을 곱하고, 비율을 모르면 쓰지 않는다
  const hp = item.housePrice?.matched ? item.housePrice : null;
  const shareText = shareRatio !== 1 ? ` × 지분 ${Math.round(shareRatio * 1000) / 10}%` : '';
  if ((hp?.price || jeonse?.value) && shareRatio === 0) anchors.push({ key: 'official', label: '공시가격·전세 환산', value: null, used: false, why: '지분 물건인데 지분 비율을 못 읽어 집 전체 값을 쓸 수 없음' });
  else if (hp?.price) {
    const r = hp.kind === '개별주택' ? cfg.realization.detachedHouse : cfg.realization.apartHouse;
    add({ key: 'official', label: '공시가격 환산', value: Math.round((hp.price / r) * shareRatio), basis: `${hp.kind} 공시가격 ${eok(hp.price)}(${hp.year}) ÷ 현실화율 ${Math.round(r * 1000) / 10}%${shareText} (추정)` });
  } else if (type === 'land' && item.land?.officialPrice && item.landArea) {
    const r = cfg.realization.land;
    const v = item.land.officialPrice * item.landArea * landShare;
    add({ key: 'official', label: '공시지가 환산', value: Math.round(v / r), basis: `개별공시지가 ${item.land.officialPrice.toLocaleString('ko-KR')}원/㎡ × ${Math.round(item.landArea)}㎡${landShare !== 1 ? ` × 지분 ${Math.round(landShare * 10000) / 100}%` : ''} = ${eok(v)} ÷ 현실화율 ${Math.round(r * 1000) / 10}% (추정)` });
  }

  // ④ 전세 환산
  if (jeonse?.value && cfg.jeonseRatio[type] && shareRatio > 0) {
    const r = cfg.jeonseRatio[type];
    add({ key: 'jeonse', label: '전세 환산', value: Math.round((jeonse.value / r) * shareRatio), basis: `${jeonse.basis} ${eok(jeonse.value)} ÷ 전세가율 ${Math.round(r * 100)}%${shareText} (추정)` });
  }

  // ⑤ 현재 호가(정민 님이 직접 확인해 넣은 값) — 호가는 실제 거래보다 높게 나오므로 95%로
  const ask = item.manual?.asking;
  if (ask?.low) {
    const mid = ask.high ? (ask.low + ask.high) / 2 : ask.low;
    const days = ask.at ? Math.floor((Date.now() - new Date(ask.at).getTime()) / 86400e3) : null;
    // 경매 물건은 내부 상태를 모르니 '기본 상태' 매물 호가와 맞댄다: 설명에 '기본·수리 필요'라 적힌 매물 → 없으면 같은 면적 매물 중 가장 낮은 호가(대개 수리 안 된 집)
    const bc = ask.auto?.byCond?.basic;
    const base = bc ? (bc.low + bc.high) / 2 : ask.low;
    const r = cfg.askingRatio ?? 0.97; // 호가 → 실제 팔리는 값(흥정분)
    const condNote = bc ? `'기본 상태' 매물 ${bc.n}건 호가` : '같은 면적 최저 호가(대개 수리 안 된 집)';
    add({ key: 'asking', label: '현재 호가(직접 확인)', value: Math.round(base * r), low: ask.low, high: ask.high || ask.low, top: ask.auto?.byCond?.top ? ask.auto.byCond.top.low : null, basis: `${condNote} ${eok(base)} × ${Math.round(r * 100)}% · 전체 호가 ${eok(ask.low)}${ask.high && ask.high !== ask.low ? `~${eok(ask.high)}` : ''} (중간 ${eok(mid)})${days !== null ? ` (${days}일 전 확인)` : ''}${ask.memo ? ` · ${ask.memo}` : ''}`, stale: days !== null && days > 30 });
  }

  // 참고: 경매 시장가(감정가 × 낙찰가율)
  let auction = null;
  if (item.appraisal) {
    const real = stats?.[type];
    const rate = real?.rate || cfg.saleRate[type] || 0.75;
    auction = { value: Math.round(item.appraisal * rate), rate, basis: real ? `완료 물건 ${real.count}건 평균 낙찰가율 ${Math.round(rate * 100)}%` : `종류별 기본 낙찰가율 ${Math.round(rate * 100)}% (완료 물건이 쌓이면 실제 값으로 바뀜)` };
  }

  // 합치기: 가운데 값에서 50% 넘게 벗어난 기준은 빼고(이유 표시) 범위·일치도
  const vals = anchors.filter((a) => a.used && a.value);
  if (!vals.length) return { anchors, auction, value: null, summary: '가치를 낼 기준이 없음' };
  const m0 = median(vals.map((a) => a.value));
  if (vals.length >= 3) {
    vals.forEach((a) => {
      const d = Math.abs(a.value - m0) / m0;
      if (d > cfg.outlier) { a.used = false; a.why = `다른 기준들의 가운데 값(${eok(m0)})과 ${Math.round(d * 100)}% 차이 — 제외`; }
    });
  }
  const used = anchors.filter((a) => a.used && a.value);
  const center = Math.round(median(used.map((a) => a.value)));
  const low = Math.min(...used.map((a) => a.value)); const high = Math.max(...used.map((a) => a.value));
  const spread = center ? (high - low) / center : 0;
  const trade = used.find((a) => a.key === 'trade');
  let confidence = used.length >= 3 && spread <= 0.25 ? '높음' : used.length >= 2 && spread <= 0.4 ? '보통' : '낮음';
  if (trade && ['A', 'B'].includes(trade.grade)) confidence = spread <= 0.4 ? '높음' : '보통';
  if (used.length === 1) confidence = '낮음';
  let decision = spread <= 0.2 ? center : Math.round((low + center) / 2);
  let how = spread <= 0.2 ? '기준들이 잘 맞아 가운데 값' : '기준들이 엇갈려 아래쪽과 가운데의 중간(보수적)';
  // 감정가 하나뿐: 감정가는 시세가 아니라 첫 회차 출발값이라 그대로 쓰면 가치를 높게 본다(상가 낙찰가÷우리 가치 60%) → 경매 시장가로
  if (used.length === 1 && used[0].key === 'appraisal' && auction?.value && auction.value < decision) {
    decision = auction.value;
    how = `감정가 하나뿐이라 경매 시장가(감정가 × ${Math.round(auction.rate * 100)}%)`;
  }
  return {
    anchors, auction, used: used.length, center, low, high, spread, confidence, value: decision,
    summary: `기준 ${used.length}개 범위 ${eok(low)}~${eok(high)}, 가운데 ${eok(center)} → 판단용 ${eok(decision)}(${how}) · 신뢰도 ${confidence}`,
  };
}
