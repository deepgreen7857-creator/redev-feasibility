// 물건 위치(가까운 순 정렬용) — 필지마다 지도를 부르면 하루 한도를 넘으므로 '법정동' 단위 대략 위치를 쓴다.
//  ① 진행 중 물건을 법정동코드(PNU 앞 10자리)로 묶고, 동마다 대표 필지 하나의 중심점을 브이월드 지적도에서 받는다(동 좌표는 1년 보관)
//  ② PNU가 없는 법원 물건은 같은 시군구·읍면동 이름의 좌표를 빌려 쓴다
//  ③ 물건에 geo: { lat, lng, by: '법정동' } 을 붙인다(정확한 필지 위치가 아니라 동 중심 — 거리 ±1km 안팎)
const YEAR = 365 * 86400e3;

async function run({ db, vworld, key, log = console.log, deadline = Infinity, maxCalls = 400 }) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const snap = await db.collection('listings').select('pnu', 'sido', 'sgg', 'emd', 'bidEnd', 'geo').get();
  const open = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((it) => String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10) >= today);
  const stats = { open: open.length, had: 0, set: 0, calls: 0, noGeo: 0, errors: 0 };
  const bjdOf = (it) => (/^\d{19}$/.test(String(it.pnu || '')) ? String(it.pnu).slice(0, 10) : null);
  const nameOf = (it) => (it.sgg && it.emd ? `${it.sido || ''}|${it.sgg}|${it.emd}` : null);

  // 동 좌표 보관본 읽기
  const bjds = [...new Set(open.map(bjdOf).filter(Boolean))];
  const geoBy = new Map(); // bjd → [lng, lat]
  for (let i = 0; i < bjds.length; i += 300) {
    const refs = bjds.slice(i, i + 300).map((b) => db.collection('landCache').doc(`geoBjd_${b}`));
    const docs = await db.getAll(...refs);
    docs.forEach((d, k) => { const v = d.exists ? d.data() : null; if (v?.geo && Date.now() - new Date(v.checkedAt).getTime() < YEAR) geoBy.set(bjds[i + k], v.geo); });
  }
  // 없는 동은 대표 필지로 받는다
  for (const b of bjds) {
    if (geoBy.has(b)) continue;
    if (stats.calls >= maxCalls || Date.now() > deadline) { stats.stoppedBy = stats.calls >= maxCalls ? 'calls' : 'time'; break; }
    const rep = open.find((it) => bjdOf(it) === b);
    try {
      stats.calls++;
      const g = await vworld.centroid({ pnu: rep.pnu, key });
      if (g) { geoBy.set(b, g); await db.collection('landCache').doc(`geoBjd_${b}`).set({ geo: g, pnu: rep.pnu, checkedAt: new Date().toISOString() }); }
    } catch (e) { stats.errors++; if (stats.errors <= 3) log(`동 위치 오류 ${b}: ${e.message}`); }
  }
  // 이름(시군구·읍면동) → 좌표: PNU 없는 물건용
  const geoByName = new Map();
  open.forEach((it) => { const b = bjdOf(it); const n = nameOf(it); if (b && n && geoBy.has(b) && !geoByName.has(n)) geoByName.set(n, geoBy.get(b)); });

  let batch = db.batch(); let n = 0;
  for (const it of open) {
    const g = (bjdOf(it) && geoBy.get(bjdOf(it))) || (nameOf(it) && geoByName.get(nameOf(it))) || null;
    if (!g) { stats.noGeo++; continue; }
    const geo = { lng: Math.round(g[0] * 1e5) / 1e5, lat: Math.round(g[1] * 1e5) / 1e5, by: '법정동' };
    if (it.geo && it.geo.lat === geo.lat && it.geo.lng === geo.lng) { stats.had++; continue; }
    batch.set(it.ref, { geo }, { merge: true }); n++; stats.set++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  log(`물건 위치: ${JSON.stringify(stats)}`);
  return stats;
}

module.exports = { run };
