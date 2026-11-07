/* 일조 정밀 검산(2026-11-07, 인계 '검산 스크립트를 사이트 기능으로')
   지금 엔진(JbsCheck.unitSun — 10분 간격·그림자 다각형)과 계산 방법을 일부러 다르게 해서 같은 창을 다시 판정함
     ① 태양 위치: 동지 날짜의 적위·균시차를 NOAA 일반식으로 따로 계산(엔진은 적위 −23.44° 고정 진태양시)
     ② 1분 간격(엔진 10분)
     ③ 그림자 다각형 대신 창에서 해 쪽으로 광선을 쏴서 동 기둥(바닥 다각형 × 높이)에 처음 들어가는 지점의 높이로 막힘 판정(오목한 동도 그대로)
   시각 기준: 'solar' 진태양시 9~15시(판례·엔진과 같음) / 'kst' 한국 표준시 9~15시(경도 보정 — 인천이면 진태양시보다 약 32분 이름)
   판정: 그 창이 동지 9~15시에 연속 2시간 이상 해를 받으면 통과. 위층으로 갈수록 가리는 것만 줄어드므로 층은 이분 탐색
   쓰는 곳: /arch 위험요소 카드 [정밀 검산], 일조 시뮬레이터 [정밀 검산] */
(function (g) {
  const D2R = Math.PI / 180;

  // NOAA 일반식(Spencer 계열) — 날짜의 적위(rad)·균시차(분)
  function solarDay(year, month, day) {
    const doy = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 864e5);
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0, γ = 2 * Math.PI / (leap ? 366 : 365) * (doy - 1);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(γ) - 0.032077 * Math.sin(γ) - 0.014615 * Math.cos(2 * γ) - 0.040849 * Math.sin(2 * γ));
    const decl = 0.006918 - 0.399912 * Math.cos(γ) + 0.070257 * Math.sin(γ) - 0.006758 * Math.cos(2 * γ) + 0.000907 * Math.sin(2 * γ) - 0.002697 * Math.cos(3 * γ) + 0.00148 * Math.sin(3 * γ);
    return { doy, eqt, decl };
  }
  // 동지 날짜: 그해 12월 20~23일 중 적위가 가장 남쪽인 날
  function solsticeDay(year) { let best = null; for (let d = 20; d <= 23; d++) { const s = solarDay(year, 12, d); if (!best || s.decl < best.decl) best = Object.assign({ day: d }, s); } return best; }

  // 분 단위 태양 위치 목록 — u = 해 쪽 수평 단위벡터(x 동, y 북), tan = 고도 탄젠트
  function sunTrack(o) {
    const lat = (+o.lat || 37.46) * D2R, lon = +o.lon || 126.65, tz = o.tz == null ? 9 : +o.tz, year = +o.year || new Date().getFullYear();
    const S = solsticeDay(year), step = +o.step || 1, out = [];
    for (let m = 9 * 60; m < 15 * 60 - 1e-9; m += step) {
      const tst = o.basis === 'kst' ? m + S.eqt + 4 * lon - 60 * tz : m;           // 진태양시(분)
      const ha = (tst / 4 - 180) * D2R;                                             // 시간각
      const cz = Math.sin(lat) * Math.sin(S.decl) + Math.cos(lat) * Math.cos(S.decl) * Math.cos(ha), alt = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, cz)));
      // 방위(북 기준 시계방향)
      const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(S.decl) * Math.cos(lat)) + Math.PI;
      out.push({ m, alt, tan: Math.tan(alt), u: [Math.sin(az), Math.cos(az)] });
    }
    return { pts: out, step, date: `${year}-12-${String(S.day).padStart(2, '0')}`, decl: S.decl / D2R, eqt: S.eqt, basis: o.basis === 'kst' ? 'kst' : 'solar', lon };
  }

  // 동 기둥 목록 — 조각마다 변·외접사각형·높이
  function prisms(blds, Hf) {
    const out = [];
    blds.forEach(b => (b.parts && b.parts.length ? b.parts : [b.poly]).forEach((q, i) => {
      if (!q || q.length < 3) return; const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      // 계단식 동은 조각마다 제 층수(b.partFl)
      out.push({ q, h: b.h != null ? +b.h : Hf(Array.isArray(b.partFl) && b.partFl[i] > 0 ? b.partFl[i] : b.floors), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }));
    return out;
  }
  function inPoly(x, y, q) { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  // 광선(P + s·u, s>0)이 다각형에 처음 닿는 거리 — 안에 있으면 0, 안 닿으면 Infinity
  function entry(P, u, q) {
    if (inPoly(P[0], P[1], q)) return 0;
    let best = Infinity;
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], ex = b[0] - a[0], ey = b[1] - a[1], den = u[0] * ey - u[1] * ex; if (Math.abs(den) < 1e-12) continue;
      const wx = a[0] - P[0], wy = a[1] - P[1], s = (wx * ey - wy * ex) / den, t = (wx * u[1] - wy * u[0]) / den;
      if (s > 1e-6 && t >= -1e-9 && t <= 1 + 1e-9 && s < best) best = s;
    }
    return best;
  }
  // 창 한 점(높이 z)이 그 시각 해를 받는지
  function lit(P, z, sp, PR) {
    if (sp.alt <= 0) return false;
    for (const r of PR) {
      if (r.h <= z) continue;
      const reach = (r.h - z) / sp.tan, ex = P[0] + sp.u[0] * reach, ey = P[1] + sp.u[1] * reach;  // 이 기둥 높이를 넘기 전까지만 봄
      if (Math.max(P[0], ex) < r.x0 || Math.min(P[0], ex) > r.x1 || Math.max(P[1], ey) < r.y0 || Math.min(P[1], ey) > r.y1) continue;
      const s = entry(P, sp.u, r.q); if (s < reach) return false;                                // 들어가는 곳 광선 높이 z + s·tan < h
    }
    return true;
  }
  // 9~15시 최대 연속(분) — 2시간 채우면 바로 멈춤
  function contMin(P, z, T, PR, need) {
    let run = 0, best = 0; const n = T.pts.length;
    for (let i = 0; i < n; i++) {
      if (lit(P, z, T.pts[i], PR)) { run += T.step; if (run > best) best = run; if (best >= need) return best; } else run = 0;
      if (run + (n - 1 - i) * T.step < need) return best;  // 남은 시간으로 못 채움
    }
    return best;
  }

  /* 검산: blds(엔진 동 꼴), us = JbsCheck.unitSun 결과(cols에 pt/pts·floors), o = { fh, groundExtra, lat, lon, basis, year, step, need_min }
     돌려주는 것 { n, agree, rate, diffs:[{id,k,engine,ray}], lost:{engine, ray}, per:{동:{engine,ray,total}}, sun:{date, decl, eqt, basis}, ms } */
  async function check(blds, us, o) {
    const t0 = Date.now(), fh = +o.fh || 2.9, ge = +o.groundExtra || 0, Hf = f => f * fh + ge, need = +o.need_min || 120;
    const T = sunTrack(o), PR = prisms(blds, Hf), cols = (us && us.cols) || [], diffs = [], per = {};
    let agree = 0, lostE = 0, lostR = 0, total = 0;
    const pass = (c, L) => (c.pts || [c.pt]).some(p => contMin(p, (L - 1) * fh, T, PR, need) >= need - 1e-6);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i], F = +c.floors || 1; if (!c.pt && !c.pts) continue;
      let ok;
      if (!pass(c, F)) ok = F + 1;
      else { let lo = 1, hi = F; while (lo < hi) { const mid = (lo + hi) >> 1; if (pass(c, mid)) hi = mid; else lo = mid + 1; } ok = lo; }
      const le = Math.min(F, (c.okFrom || F + 1) - 1), lr = Math.min(F, ok - 1);
      lostE += le; lostR += lr; total += F; if (le === lr) agree += F; else { agree += F - Math.abs(le - lr); diffs.push({ id: c.id, k: c.k, engine: le, ray: lr }); }
      const q = per[c.id] || (per[c.id] = { engine: 0, ray: 0, total: 0 }); q.engine += le; q.ray += lr; q.total += F;
      if (o.onProgress && i % 10 === 9) { o.onProgress(i + 1, cols.length); await new Promise(r => setTimeout(r, 0)); }
    }
    return { n: total, agree, rate: total ? agree / total : 1, diffs, lost: { engine: lostE, ray: lostR }, per, sun: { date: T.date, decl: T.decl, eqt: T.eqt, basis: T.basis, lon: T.lon, step: T.step }, ms: Date.now() - t0 };
  }

  // 결과 문장(화면 공용)
  function html(r, r2, esc) {
    esc = esc || (s => String(s));
    const f = n => Number(n).toLocaleString('ko-KR'), pct = x => (x * 100).toFixed(1) + '%';
    const basisName = b => b === 'kst' ? '한국 표준시 9~15시' : '진태양시 9~15시';
    const diffDong = Object.entries(r.per).filter(([, q]) => q.engine !== q.ray).map(([k, q]) => `${esc(k)}동 엔진 ${q.engine} · 광선 ${q.ray}`);
    return `<p><b>정밀 검산</b>(${esc(r.sun.date)} 동지, 적위 ${r.sun.decl.toFixed(2)}°, ${basisName(r.sun.basis)}, ${r.sun.step}분 간격 광선) — 세대 판정 일치 <b>${pct(r.rate)}</b> · 미달 세대 엔진 ${f(r.lost.engine)} / 광선 ${f(r.lost.ray)}${diffDong.length ? `<br>차이 나는 동: ${diffDong.join(', ')}` : ' · 동별 차이 없음'}`
      + (r2 ? `<br>참고: 시각을 ${basisName(r2.sun.basis)}로 보면(경도 ${r2.sun.lon.toFixed(2)}°, 진태양시보다 약 ${Math.round(-(r2.sun.eqt + 4 * r2.sun.lon - 540))}분 이름) 미달 ${f(r2.lost.ray)}세대` : '')
      + `<br><span class="note">엔진과 다른 방법(따로 계산한 태양 위치·1분 간격·창에서 해 쪽 광선)으로 같은 창을 다시 본 값입니다. 창 위치(세대마다 가장 남쪽을 향한 창 바깥 0.5m, 그 층 바닥 높이)는 엔진과 같습니다. 인허가 제출용 일조분석을 대신하지 않습니다. ${(r.ms / 1000).toFixed(1)}초</span></p>`;
  }

  const api = { solarDay, solsticeDay, sunTrack, prisms, entry, lit, contMin, check, html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.JbsSunVerify = api;
})(typeof window !== 'undefined' ? window : globalThis);
