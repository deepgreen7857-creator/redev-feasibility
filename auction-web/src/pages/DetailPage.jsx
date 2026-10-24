import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getListing, getSettings, getDeals, callFn, saveListing, getZones } from '../lib/store.js';
import { zonesForListing, stageForAnalysis } from '../lib/redevZones.js';
import { ZONE_STATUS_LABEL, ART77, rightsCheck } from '../lib/zoneMatch.js';
import { analyze, tradeTypeOf, courtRate, eok, won, pct, SOURCE_LABEL, typeLabel, areaText } from '../lib/analyze.js';
import { shareInfo } from '../lib/special.js';
import { lawdOf } from '../data/defaults.js';
import { Badge, VerdictBadge, Card, Row, Field, Empty } from '../components/ui.jsx';
import RegistryCard from '../components/RegistryCard.jsx';

const STAGES = ['', '정비예정구역', '구역지정', '추진위원회 승인', '조합설립인가 전(임박)', '조합설립인가 후', '사업시행인가 후', '관리처분인가 후'];
const ZLABEL = { designated: '구역지정', committee: '추진위', union: '조합설립', implementation: '사업시행', management: '관리처분', construction: '착공', completion: '준공', transfer: '이전고시' };
const TYPE_NAME = { apt: '아파트', rh: '연립·다세대', sh: '단독·다가구', offi: '오피스텔', land: '토지' };

export default function DetailPage({ admin }) {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(null);
  const [deals, setDeals] = useState([]);
  const [aptDeals, setAptDeals] = useState([]);
  const [silvDeals, setSilvDeals] = useState([]);
  const [rentDeals, setRentDeals] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [zones, setZones] = useState([]);

  useEffect(() => {
    Promise.all([getListing(decodeURIComponent(id)), getSettings()]).then(async ([it, s]) => {
      setItem(it); setSettings(s);
      if (it) {
        getZones(it.sido).then((z) => setZones(zonesForListing(it, z.zones))).catch(() => {});
        const lawd = lawdOf(it.sido, it.sgg);
        const t = tradeTypeOf(it);
        const own = await getDeals(t, lawd, 12);
        setDeals(own);
        setAptDeals(t === 'apt' ? own : await getDeals('apt', lawd, 12));
        getDeals('silv', lawd, 12).then(setSilvDeals).catch(() => {});
        if (['apt', 'rh', 'sh', 'offi'].includes(t)) getDeals(`${t}Rent`, lawd, 12).then(setRentDeals).catch(() => {});
      }
    });
  }, [id]);

  const a = useMemo(() => (item && settings ? analyze(item, { settings, deals, aptDeals, rentDeals }) : null), [item, settings, deals, aptDeals, rentDeals]);
  if (item === null && settings) return <Empty>물건을 찾을 수 없습니다. <Link className="text-brand underline" to="/">목록으로</Link></Empty>;
  if (!item || !a) return <div className="card text-sm text-ink/50">불러오는 중…</div>;

  const updateManual = async (patch) => {
    const next = { ...item, manual: { ...(item.manual || {}), ...patch } };
    setItem(next);
    if (admin) await saveListing({ id: item.id, manual: next.manual });
  };

  const checkLand = async () => {
    setBusy('land'); setMsg('');
    try {
      const land = await callFn('landCheck', { pnu: item.pnu, listingId: item.id });
      setItem({ ...item, land, ...(land.housePrice ? { housePrice: land.housePrice } : {}) });
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  // 관리자: 주변 필지가 맹지인지 브이월드로 확인(도로·맹지 물건)
  const checkNeighbors = async () => {
    setBusy('nb'); setMsg('');
    try {
      const r = await callFn('landCheck', { pnu: item.pnu, listingId: item.id, neighbors: true });
      setItem({ ...item, neighbors: r.neighbors });
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  // 관리자: 이 물건 상세(사진·권리)를 지금 받기 — 온비드만
  const fetchDetail = async () => {
    setBusy('detail'); setMsg('');
    try {
      const r = await callFn('fetchDetailNow', { listingId: item.id });
      if (r.ok && r.listing) setItem(r.listing); else setMsg(r.message || '상세를 받지 못했습니다.');
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  const rate = item.source === 'court' ? courtRate(item, settings) : null;
  const d = item.detail;
  // 상세가 없는 칸은 숨기지 않고 '수집 대기'로 표시(법원경매는 수집기가 주지 않는 값이 많아 '원문 확인')
  const waitText = item.source === 'court' ? '원문 확인' : '수집 대기';
  const dv = (v) => (v === null || v === undefined || v === '' ? (d ? '—' : waitText) : v);

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link to="/" className="text-sm text-brand">← 목록</Link>
        <Link to={`/report/${encodeURIComponent(item.id)}`} className="btn bg-ink text-white">검토서 보기</Link>
        <button className="btn-ghost" onClick={() => window.print()}>결과지 인쇄</button>
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <VerdictBadge verdict={a.verdict} />
          {a.calcAnomaly && <Badge tone="hard">계산 이상</Badge>}
          <Badge tone={item.category === 'bankrupt' ? 'cash' : 'muted'}>{SOURCE_LABEL[item.source === 'court' ? 'court' : item.category]}</Badge>
          {item.propertyTypeName && <Badge>{item.propertyTypeName}</Badge>}
          {a.cashType && <Badge tone="cash">현금청산형</Badge>}
          {a.farm && <Badge tone="wait">농지</Badge>}
          {a.excluded && <Badge>관심 제외(재직 중 분석 대상 아님)</Badge>}
        </div>
        <h1 className="text-xl font-extrabold leading-snug"><span className="mr-2 rounded bg-ink px-2 py-0.5 align-middle text-sm text-white">{typeLabel(item)}</span>{item.title}</h1>
        <div className="mt-1 text-xs text-ink/50">{item.court} · {item.caseNo} {item.round ? `· ${item.round}회차` : ''} {item.status ? `· ${item.status}` : ''}</div>
        <div className="no-print mt-2 flex flex-wrap items-center gap-3 text-sm">
          {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-brand underline">{item.source === 'court' ? '법원경매정보 원문' : '온비드 원문'}</a>}
          <span className="text-xs text-ink/50">{d ? `상세 수집 ${String(item.detailAt || '').slice(0, 10) || '완료'}` : item.source === 'court' ? '상세 자료 없음(원문 확인)' : '상세 수집 대기'}</span>
          {admin && item.source === 'onbid' && <button className="btn-ghost py-1 text-xs" disabled={busy === 'detail'} onClick={fetchDetail}>{busy === 'detail' ? '받는 중…' : '이 물건 상세 지금 받기'}</button>}
        </div>
        {msg && <p className="mt-2 text-sm text-hard">{msg}</p>}
      </Card>

      {/* ① 물건 기본현황 */}
      <BasicSection item={item} d={d} dv={dv} waitText={waitText} />

      {/* ② 권리 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="② 권리 체크" right={<span className="text-xs text-ink/50">자동 확인은 1차 거르기용</span>}>
          {(() => {
            const f = d?.flags;
            const st = (bad, known) => (bad ? 'bad' : known ? 'none' : 'unknown');
            return (
              <>
                <Check state={st(f?.survivingRights, !!d)} label="말소되지 않는 권리(인수)" note={d?.survivingRights} />
                <Check state={st(f?.superficies, !!d)} label="법정지상권" note={d?.superficies} />
                <Check state={st(a.share.share, item.share !== undefined || !!d)} label="지분 물건" note={a.share.share ? (a.share.ratio ? `지분 ${a.share.num}/${a.share.den} (${a.share.how}, ${a.share.source})${a.share.coOwners ? ` · 공유자 ${a.share.coOwners}명` : ''}` : `지분비율 미확인 — 금액 계산 안 함${d?.shareText ? ` · ${d.shareText}` : ''}`) : d?.shareText} />
                <Check state={st(f?.unclaimedTenants > 0, !!d)} label={`임차인 ${f?.tenants ?? '?'}명${f?.tenantsUnknown ? ` (+ 조사 안 됨 ${f.tenantsUnknown})` : ''}`} note={f?.unclaimedTenants ? `배분요구 안 함 ${f.unclaimedTenants}명` : d?.distributionDeadline ? `배분요구 종기 ${fmtYmd(d.distributionDeadline)}` : null} />
                <Check state={st(f?.qualification, !!d)} label="매수인 자격 제한" note={d?.buyerQualification} />
              </>
            );
          })()}
          <div className="mt-3 rounded-md bg-wait/10 p-2 text-xs text-ink/80">
            <div className="mb-1 font-bold">자동으로 못 보는 것 — 입찰 전 꼭 직접 확인</div>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>등기부: 말소기준권리와 그보다 앞선 권리·가처분·가등기, 토지 별도등기, 대지권 미등기</li>
              <li>임차인 대항력: 전입일이 말소기준권리보다 빠른지(인수 보증금), 확정일자·배분요구 여부</li>
              <li>유치권 신고, 체납 관리비, 위반건축물(건축물대장), 맹지·도로 접함</li>
              <li>현장: 실제 점유자, 건물 상태{item.source === 'court' ? ', 매각물건명세서·현황조사서·감정평가서' : ', 온비드 공고문·감정평가서'}</li>
            </ul>
          </div>
          {admin && a.share.share && <ShareForm item={item} onSave={updateManual} />}
          {!d && <p className="mt-2 text-xs text-ink/50">{item.source === 'court' ? '법원경매는 자동 권리 정보가 없습니다. 위 항목은 모두 "확인 안 됨"입니다.' : '상세(권리) 정보 수집 대기 중입니다.'}</p>}
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!admin} checked={Boolean(item.manual?.hard)} onChange={(e) => updateManual({ hard: e.target.checked })} />
            분석 대상에서 직접 제외
          </label>
          {item.manual?.hard && <input className="input mt-2" disabled={!admin} placeholder="이유 (예: 유치권 신고, 맹지)" value={item.manual?.hardNote || ''} onChange={(e) => updateManual({ hardNote: e.target.value })} />}
        </Card>
        <div className="space-y-4">
          <Card title={`임차인·점유 (${d?.leases?.length || 0}명)`}>
            {d?.leases?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs num">
                  <thead className="text-left text-ink/50"><tr><th>구분</th><th>임차인</th><th className="text-right">보증금</th><th className="text-right">월세</th><th>전입</th><th>확정</th><th>배분요구</th></tr></thead>
                  <tbody>{d.leases.map((l, i) => <tr key={i} className="border-t border-line/50"><td>{l.kind || l.part || ''}</td><td>{l.tenant || '—'}</td><td className="text-right">{l.deposit ? eok(l.deposit) : ''}</td><td className="text-right">{l.rent ? eok(l.rent) : ''}</td><td>{l.moveIn ? fmtYmd(l.moveIn) : ''}</td><td>{l.fixedDate ? fmtYmd(l.fixedDate) : ''}</td><td className={l.claimed === true ? 'text-now' : l.claimed === false ? 'text-hard' : 'text-ink/40'}>{l.claimed === true ? '함' : l.claimed === false ? '안 함' : '확인'}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <Empty>{d ? '임차 자료 없음' : `임차 정보 ${waitText}`}</Empty>}
            <p className="mt-2 text-[11px] text-ink/50">전입일이 말소기준권리보다 빠르면 보증금을 인수할 수 있습니다. 등기부와 대조하세요.</p>
          </Card>
          <Card title="등기 주요 정보">
            {d?.rights?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs num">
                  <thead className="text-left text-ink/50"><tr><th>권리</th><th>권리자</th><th>설정일</th><th className="text-right">금액</th></tr></thead>
                  <tbody>{d.rights.map((r, i) => <tr key={i} className="border-t border-line/50"><td>{r.kind || '—'}</td><td>{r.holder || ''}</td><td>{fmtYmd(r.date)}</td><td className="text-right">{r.amount ? eok(r.amount) : ''}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <Empty>{d ? '등기 자료 없음(압류재산만 제공)' : `등기 정보 ${waitText}`}</Empty>}
            {d?.baseRightDate && <p className="mt-2 text-xs text-ink/60">최선순위 설정일(말소기준): {fmtYmd(d.baseRightDate)}</p>}
            {d?.extinguished && <p className="mt-2 text-xs text-ink/60">매각으로 소멸: {d.extinguished}</p>}
          </Card>
        </div>
      </div>
      <Card title="공고 원문 (위치·조건·유의사항)">
        {d && (d.location || d.conditions || d.deliveryDuty || d.cautions || d.extraNotes) ? (
          <>
            {d.location && <Desc k="위치 및 부근 현황" v={d.location} />}
            {d.conditions && <Desc k="부대 조건" v={d.conditions} />}
            {d.deliveryDuty && <Desc k="인도 책임" v={d.deliveryDuty} />}
            {d.cautions && <Desc k="유의사항" v={d.cautions} />}
            {d.extraNotes && <Desc k="기타" v={d.extraNotes} />}
          </>
        ) : <Empty>{d ? '공고 원문 설명 없음' : `공고 원문 ${waitText}`}</Empty>}
      </Card>

      {item.bidInfo?.history?.length > 0 && <BidHistory info={item.bidInfo} appraisal={item.appraisal} />}
      {(item.ledger?.titles?.length > 0 || item.permits?.total !== undefined) && <BuildingCard item={item} />}

      {/* ③ 토지이용·정비구역·분양자격 */}
      <Card title="③ 토지이용·정비구역·분양자격" right={admin && item.pnu && <button className="btn-ghost no-print" disabled={busy === 'land'} onClick={checkLand}>{busy === 'land' ? '조회 중…' : '브이월드 조회'}</button>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            {item.land?.landUse ? (
              <>
                <Row k="용도지역" v={item.land.landUse.zone || '—'} />
                <Row k="정비 관련" v={a.redev.length ? a.redev.join(', ') : '없음'} />
                <Row k="농업진흥구역" v={item.land.landUse.farmPromotion ? '해당' : '아님'} />
                <Row k="개발제한구역" v={item.land.landUse.greenbelt ? '해당' : '아님'} />
                <Row k="도로 저촉" v={item.land.landUse.roadConflict?.length ? item.land.landUse.roadConflict.join(', ') : '없음'} />
                <Row k="개별공시지가" v={item.land.officialPrice ? `${won(item.land.officialPrice)}/㎡${item.land.officialPriceYear ? ` (${item.land.officialPriceYear}년)` : ''}` : '—'} />
                {item.land.officialPrice && item.landArea ? <Row k="공시지가 × 토지면적" v={won(item.land.officialPrice * item.landArea)} /> : null}
                {item.housePrice && <Row k={`주택 공시가격(${item.housePrice.kind} ${item.housePrice.year})`} v={item.housePrice.price ? won(item.housePrice.price) : `${won(item.housePrice.min)} ~ ${won(item.housePrice.max)} (호 미확인)`} />}
                {item.pnuSource && <p className="mt-1 text-[11px] text-ink/50">필지번호 {item.pnu} — {item.pnuSource}</p>}
              </>
            ) : <Empty>{item.pnu ? '아직 조회 전입니다(상세 수집 때 함께 조회).' : '필지번호(PNU)가 없습니다 — 상세 수집 때 주소로 찾아 조회합니다.'}</Empty>}
          </div>
          <div>
            <ZoneMatchBox item={item} admin={admin} onSave={updateManual} />
            <div className="mt-3 rounded-lg bg-paper p-3">
              <div className="mb-1 text-sm font-bold">정비사업 현황 엑셀(참고)에서 같은 동 구역</div>
              {item.manual?.zone ? (
                <div className="text-sm">
                  <div><Badge tone="brand">연결됨</Badge> {item.manual.zone.name} · <b>{item.manual.zone.stage || '단계 미상'}</b></div>
                  <div className="mt-1 text-xs text-ink/60">{item.manual.zone.location} {Object.entries(item.manual.zone.dates || {}).map(([k, v]) => `${ZLABEL[k] || k} ${v}`).join(' · ')}</div>
                  {admin && <button className="mt-1 text-xs text-hard underline" onClick={() => updateManual({ zone: null, redevStage: '' })}>연결 해제</button>}
                </div>
              ) : zones.length ? (
                <div className="space-y-1.5">
                  {zones.slice(0, 6).map((z) => (
                    <div key={z.name} className="flex items-center justify-between gap-2 text-sm">
                      <span>{z.strong && <Badge tone="now" className="mr-1">지번 일치</Badge>}{z.name} <span className="text-xs text-ink/60">· {z.stage || '단계 미상'} · {z.location}</span></span>
                      {admin && <button className="btn-ghost shrink-0 py-1 text-xs" onClick={() => updateManual({ zone: { name: z.name, location: z.location, stage: z.stage, dates: z.dates, type: z.type || null, kind: z.kind || null, quarter: z.quarter || null }, redevStage: stageForAnalysis(z.stage) })}>이 구역으로 연결</button>}
                    </div>
                  ))}
                  <p className="text-xs text-ink/50">대표지번만 적힌 자료라 구역 안인지는 토지이용계획(정비구역 표시)과 함께 확인하세요.</p>
                </div>
              ) : <p className="text-xs text-ink/50">같은 동의 구역이 없거나 이 시도의 엑셀을 아직 안 올렸습니다(관리자 화면).</p>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="정비사업 단계(직접 표시)" hint="엑셀 구역을 연결하면 자동">
                <select className="input" disabled={!admin || !!item.manual?.zone} value={item.manual?.redevStage || ''} onChange={(e) => updateManual({ redevStage: e.target.value })}>
                  {STAGES.map((s) => <option key={s} value={s}>{s || '해당 없음/모름'}</option>)}
                </select>
              </Field>
              <Field label="사업 유형" hint="재건축·재개발에 따라 제한 시점이 다름">
                <select className="input" disabled={!admin || !!item.manual?.zone?.type} value={item.manual?.zone?.type || item.manual?.projectType || ''} onChange={(e) => updateManual({ projectType: e.target.value })}>
                  <option value="">모름</option><option>재개발</option><option>재건축</option><option>가로주택·소규모</option>
                </select>
              </Field>
            </div>
          </div>
        </div>
        {a.member.status !== 'none' && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${a.member.status === 'member' ? 'bg-now/5' : a.member.status === 'cash' ? 'bg-cash/5' : 'bg-wait/10'}`}>
            <div className="font-bold">분양자격: {a.member.status === 'member' ? '조합원 가능(입주권형)' : a.member.status === 'cash' ? '현금청산형' : '확인 필요'}{a.member.overheated ? ' · 투기과열지구' : ''}</div>
            <div className="mt-1 text-xs text-ink/70">{a.member.reason}</div>
            <div className="mt-1 text-xs text-ink/70">근거 값: {memberBasis(item, d, waitText)}</div>
            {a.member.overheated && a.member.status !== 'member' && item.source === 'court' && (
              <Field label="경매 신청 채권자(등기부 확인)">
                <select className="input mt-1" disabled={!admin} value={item.manual?.creditor || ''} onChange={(e) => updateManual({ creditor: e.target.value || undefined })}>
                  <option value="">모름</option><option value="public">국가·지자체·금융기관(은행 등)</option><option value="other">개인·대부업체 등 그 밖</option>
                </select>
              </Field>
            )}
            <p className="mt-1 text-[11px] text-ink/50">근거: 도시정비법 제39조제2항, 시행령 제37조제3항제5호(국가·지자체·금융기관 채무 불이행 경매·공매 예외). 투기과열지구 목록은 관리자 설정에서 관리.</p>
          </div>
        )}
        {a.member.status === 'member' && a.member.rank >= 3 && <RightCalc item={item} a={a} admin={admin} onSave={(econ) => updateManual({ econ })} silvDeals={silvDeals} zoneName={item.manual?.zone?.name} />}
      </Card>

      {(item.forecast || item.forecastRevised) && <ForecastCard item={item} />}
      {a.special && <SpecialCard item={item} a={a} admin={admin} onSave={updateManual} onNeighbors={checkNeighbors} busy={busy === 'nb'} />}

      {admin && item.source === 'court' && <RegistryCard item={item} />}

      {a.renovation && <RenoCard a={a} />}

      {/* ④ 판정·돈 계산·회차별 최저가 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="④ 판정·돈 계산" className="lg:col-span-1">
          <Row k="감정가" v={won(item.appraisal)} />
          <Row k="현재 최저가" v={`${won(item.minBid)} (${pct(a.ratio)})`} strong />
          {a.special && <Row k="하자 없을 때 가치" v={won(a.full)} />}
          {a.jeonse && <Row k="주변 전세 시세" v={`${won(a.jeonse.value)} (${a.jeonse.count}건)`} />}
          <Row k={a.special ? '바닥 가치(최악)' : '예상 가치'} v={won(a.value)} />
          <Row k="비용(세금·명도·수리)" v={won(a.costs?.total)} />
          <Row k={`매수상한 (마진 ${Math.round((settings.marginRate ?? 0.1) * 100)}%)`} v={won(a.cap)} strong />
          <Row k="진입 시점" v={a.reasons.length ? '제외' : a.verdict === 'check' ? '권리 확인 후' : a.entry ? a.entry.label : '하한까지도 상한 초과'} strong />
          {a.money && !a.money.upside && (
            <div className="mt-3 rounded-md border border-line p-2 text-sm">
              <div className="mb-1 font-bold">돈 계산 ({a.verdict === 'wait' && a.entry ? `${a.entry.label} 가격` : '지금 최저가'}에 사서 {a.money.months}개월 뒤 {a.special ? '바닥 가치' : '예상 가치'}에 팔 때){a.verdict === 'hard' && <span className="ml-1 text-hard">— 가격이 안 맞아 손해 예상</span>}</div>
              {a.money.owner === 'corp' && <div className={`mb-2 rounded px-2 py-1 text-xs ${{ A: 'bg-now/10 text-now', B: 'bg-wait/10 text-wait', X: 'bg-hard/10 text-hard' }[a.money.fit.grade] || 'bg-ink/5'}`}>법인 단타 {a.money.fit.grade} — {a.money.fit.reason}</div>}
              <Row k="입찰가" v={won(a.money.price)} />
              <Row k={`대출 (${Math.round(a.money.loanRatio * 100)}%)`} v={won(a.money.loan)} />
              <Row k={`취득세 ${(a.money.t.acq.rate * 100).toFixed(1)}%`} v={won(a.money.t.acqTax)} />
              <p className="-mt-1 mb-1 text-right text-[11px] text-ink/50">{a.money.t.acq.label}</p>
              <Row k="명도·수리" v={won(a.money.other)} />
              <Row k="내가 넣어야 할 돈" v={won(a.money.own)} strong />
              {a.money.later > 0 && <Row k="나중에 낼 추가분담금" v={won(a.money.later)} />}
              <div className="mt-2 text-xs font-bold text-ink/60">팔 때</div>
              <Row k="예상 매도가(예상 가치)" v={won(a.value)} />
              <Row k={`이자 (${(a.money.rate * 100).toFixed(1)}% · ${a.money.months}개월)`} v={won(a.money.interest)} />
              <Row k="중개수수료" v={won(a.money.t.broker)} />
              {a.money.t.vat > 0 && <Row k="부가세(건물분)" v={won(a.money.t.vat)} />}
              <Row k="세전 수익" v={won(a.money.preTax)} />
              {a.money.owner === 'corp' && <>
                <Row k="법인세(지방소득세 포함)" v={won(a.money.t.incomeTax)} />
                {a.money.t.surcharge > 0 && <Row k="주택·토지 추가 법인세" v={won(a.money.t.surcharge)} />}
              </>}
              <Row k={a.money.owner === 'corp' ? '세후 수익' : '예상 수익(양도세 전)'} v={won(a.money.profit)} strong />
              <Row k="수익률 (내 돈 대비)" v={a.money.roi === null ? '—' : `${Math.round(a.money.roi * 100)}%`} strong />
              <p className="mt-1 text-[11px] text-ink/50">세율·대출·보유기간은 관리자 설정값의 추정입니다. 실제 신고 전 세무사 확인이 필요합니다.</p>
            </div>
          )}
          {a.score && (
            <div className="mt-2 rounded-md bg-paper p-2 text-sm">
              <div className="font-bold">매력도 {a.score.grade} · {a.score.total}점 {a.score.margin !== undefined && <span className="text-xs font-normal text-ink/60">(안전마진 {Math.round(a.score.margin * 100)}%{a.verdict === 'wait' ? ', 진입 회차 기준' : ''})</span>}</div>
              <div className="mt-1 text-xs text-ink/60">{Object.entries(a.score.parts).map(([k, v]) => `${k} ${v}`).join(' · ')} / 만점 {a.special ? '40·30·20·10' : '45·20·25·10'}</div>
            </div>
          )}
          <p className="mt-2 text-xs text-ink/50">{a.valueBasis}</p>
          {a.reasons.length > 0 && <div className="mt-3 rounded-md bg-hard/5 p-2 text-sm text-hard">제외 이유: {a.reasons.join(', ')}</div>}
          {a.estimateBasis && <p className="mt-1 text-xs text-wait">{a.estimateBasis} — 확실성 최대 C</p>}
          {a.calcAnomaly && <div className="mt-3 rounded-md bg-hard/5 p-2 text-sm text-hard"><b>계산 이상 — 지금 매력·A등급에서 제외.</b> {a.calcAnomaly.join(' · ')} 지분비율·면적·단가를 원문과 대조하세요.</div>}
          {a.anomalies?.length > 0 && <div className="mt-3 rounded-md bg-hard/5 p-2 text-sm text-hard"><b>오류 의심 — 계산 보류.</b> {a.anomalies.join(' · ')} 법원 원문(매각물건명세서·감정평가서)을 확인하세요.</div>}
          {a.warnings.length > 0 && <ul className="mt-3 space-y-1 text-sm text-wait">{a.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card title="회차별 최저가 vs 매수상한" right={<span className="text-xs text-ink/50">{rate ? `${rate.name} 저감률 ${Math.round(rate.rate * 100)}%${rate.verified ? '' : ' (확인 전)'}` : '공매: 최초가의 10%씩, 50% 하한'}</span>}>
            <div className="space-y-1.5">
              {a.rounds.map((r) => {
                const ok = a.cap !== null && r.price <= a.cap;
                const w = Math.max(4, Math.min(100, (r.price / (item.appraisal || r.price)) * 100));
                return (
                  <div key={r.step} className="grid grid-cols-[88px_1fr_120px] items-center gap-2 text-sm">
                    <span className="text-ink/60">{r.label}</span>
                    <div className="h-5 rounded bg-paper"><div className={`h-5 rounded ${ok ? 'bg-now/70' : 'bg-ink/20'}`} style={{ width: `${w}%` }} /></div>
                    <span className={`num text-right ${ok ? 'font-bold text-now' : ''}`}>{eok(r.price)}{r.floor ? ' (하한)' : ''}</span>
                  </div>
                );
              })}
              {a.cap !== null && <div className="pt-1 text-xs text-ink/50">초록 막대 = 매수상한 {eok(a.cap)} 이하로 내려온 회차</div>}
            </div>
            {d?.rounds?.length > 0 && (
              <table className="mt-4 w-full text-sm num">
                <thead className="text-left text-xs text-ink/50"><tr><th>회차</th><th>입찰 기간</th><th>개찰</th><th className="text-right">최저가</th></tr></thead>
                <tbody>{d.rounds.map((r, i) => <tr key={i} className={`border-t border-line/50 ${String(r.round) === String(item.round) ? 'font-bold text-brand' : ''}`}><td>{r.round}</td><td>{r.start ? `${r.start.slice(5, 10)}~${(r.end || '').slice(5, 10)}` : '—'}</td><td>{fmtYmd(r.open)}</td><td className="text-right">{eok(r.minBid)}</td></tr>)}</tbody>
              </table>
            )}
            {Array.isArray(item.history) && item.history.length > 0 && (
              <div className="mt-4 text-xs text-ink/60">
                <div className="mb-1 font-medium">지난 회차 기록</div>
                {item.history.slice(-6).map((h) => <div key={h.at}>{h.at.slice(0, 10)} · {h.round}회차 · {eok(h.minBid)} · {h.status}</div>)}
              </div>
            )}
          </Card>
          <FundCalc item={item} a={a} />
        </div>
      </div>

      {/* ⑤ 시세 근거 */}
      <Card title="⑤ 시세 근거" right={<span className="text-xs text-ink/50">{TYPE_NAME[a.market.type]} · 최근 12개월</span>}>
        {a.market.value ? (
          <>
            <Row k="비교 면적" v={`${a.market.area}㎡`} />
            <Row k={a.market.compWhy ? "㎡당 시세(닮은 거래 가중)" : "㎡당 중앙값"} v={won(a.market.unit)} />
            {a.market.low && a.market.high && <Row k="닮은 거래끼리 범위" v={`${won(a.market.low)} ~ ${won(a.market.high)}${a.market.wide ? " — 폭 큼, 개별 확인" : ""}`} />}
            <Row k="추정 시세" v={won(a.market.value)} strong />
            <p className="mt-2 text-xs text-ink/50">{a.market.basis}</p>
            <div className="mt-3 max-h-56 overflow-auto text-xs">
              <table className="w-full num">
                <thead className="text-ink/50"><tr><th className="text-left">계약</th><th className="text-left">이름/동</th><th className="text-right">면적</th><th className="text-right">층</th><th className="text-right">연식</th><th className="text-right">가격</th><th className="text-left">이 물건과 다른 점</th></tr></thead>
                <tbody>{a.market.samples.map((x, i) => <tr key={i} className="border-t border-line/50"><td>{String(x[11] || '').slice(2, 4)}.{String(x[11] || '').slice(4)}.{x[3]}</td><td>{x[5]} {x[9]}</td><td className="text-right">{x[1]}</td><td className="text-right">{x[2] ?? ''}</td><td className="text-right">{x[6] ?? ''}</td><td className="text-right">{eok(x[0])}</td><td className="pl-2 text-ink/60">{a.market.compWhy?.[i] || (a.market.compWhy ? '거의 같음' : '')}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        ) : <Empty>{a.market.basis}. 실거래 수집이 끝나면 자동으로 채워집니다.</Empty>}
      </Card>
    </div>
  );
}

const fmtYmd = (v) => { const t = String(v || '').replace(/\D/g, ''); return t.length >= 8 ? `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6, 8)}` : v || '—'; };
const isUrl = (u) => /^https?:\/\//.test(String(u || ''));
// 온비드 사진 주소의 downloadImageKind(썸네일)를 빼면 원본 크기
const fullImg = (u) => String(u).replace(/&downloadImageKind=[A-Z_]+/, '');
const sqm = (n) => (n ? `${Math.round(n * 100) / 100}㎡ (${Math.round((n / 3.3058) * 10) / 10}평)` : null);

// 분양자격 판단에 쓴 값: 토지면적 · 용도 · 지분 여부
function memberBasis(item, d, waitText) {
  const landRow = (d?.areas || []).find((x) => /^토지/.test(x.kind || ''));
  const land = item.landArea ? sqm(item.landArea) : landRow ? landRow.area : null;
  const usage = item.usageSmall || item.usage || d?.landCategory || null;
  const shareFlag = item.share ?? d?.flags?.share;
  const share = shareFlag ? '지분 매각' : shareFlag === false ? '전부 매각' : '모름';
  const landShare = landRow?.share && /분의/.test(landRow.share) ? ` (대지권 ${landRow.share.replace(/^지분\(|\)$/g, '')})` : '';
  return `토지면적 ${land || (d ? '—' : waitText)}${landShare} · 용도 ${usage || '—'} · 지분 여부 ${share}`;
}

// 지목 28종(공간정보관리법 제67조) — 온비드 용도 소분류가 지목 이름이면 그대로 지목으로 쓴다
const JIMOK = ['전', '답', '과수원', '목장용지', '임야', '광천지', '염전', '대', '공장용지', '학교용지', '주차장', '주유소용지', '창고용지', '도로', '철도용지', '제방', '하천', '구거', '유지', '양어장', '수도용지', '공원', '체육용지', '유원지', '종교용지', '사적지', '묘지', '잡종지'];
function jimokOf(item, d) {
  const direct = d?.landCategory || item.land?.jimok;
  if (direct) return direct;
  const small = String(item.usageSmall || String(item.usage || '').split('>').pop() || '').trim();
  if (JIMOK.includes(small)) return `${small} (온비드 용도 기준 — 토지대장 확인 전)`;
  return null;
}
// 도로명 주소: 상세 값 → 법원 주소가 도로명이면 그대로
function roadOf(item, d) {
  if (d?.roadAddress) return d.roadAddress;
  if (item.roadAddress) return item.roadAddress; // 서버가 브이월드 도로명 검색으로 찾은 값
  const addr = item.source === 'court' ? (d?.addressFull || item.address || '') : '';
  if (/[가-힣\d]+(로|길)\s?\d+/.test(addr)) return addr;
  return null;
}

// ① 물건 기본현황 — 사진 칸은 항상, 상세가 없는 값은 '수집 대기'
function BasicSection({ item, d, dv, waitText }) {
  // 예전 해석기로 받은 상세에는 '[object Object]' 같은 깨진 값이 있어 http 주소만 쓴다(밤 수집 때 다시 받음)
  const photos = (d?.photos || []).filter(isUrl);
  const shown = photos.length ? photos : item.thumbnail ? [item.thumbnail] : [];
  const maps = (d?.mapUrls || []).filter(isUrl);
  return (
    <Card title="① 물건 기본현황">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0">
          {shown.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {shown.map((u, i) => (
                <a key={i} href={fullImg(u)} target="_blank" rel="noreferrer" className="shrink-0"><img src={u} alt={`물건 사진 ${i + 1}`} loading="lazy" className="h-44 w-60 rounded-lg border border-line bg-paper object-cover" /></a>
              ))}
            </div>
          ) : (
            <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-line bg-paper text-sm text-ink/50">
              {d ? '사진 없음' : `사진 없음(${item.source === 'court' ? '원문 확인' : '상세 수집 대기'})`}
            </div>
          )}
          {maps.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {maps.map((u, i) => <a key={i} href={fullImg(u)} target="_blank" rel="noreferrer" className="shrink-0" title={`위치도·지적도 ${i + 1}`}><img src={u} alt={`위치도·지적도 ${i + 1}`} loading="lazy" className="h-20 w-28 rounded-md border border-line bg-paper object-cover" /></a>)}
            </div>
          )}
          {!photos.length && item.thumbnail && <p className="mt-1 text-[11px] text-ink/50">목록 썸네일입니다. 상세 사진은 {d ? '제공되지 않았습니다' : item.source === 'court' ? '원문에서 확인하세요' : '상세 수집 대기 중입니다'}.</p>}
        </div>
        <div className="min-w-0">
          <Row k="지번 주소" v={item.parcelAddress || (/[가-힣\d]+(로|길)\s?\d+/.test(d?.addressFull || item.address || '') ? dv(null) : d?.addressFull || item.address) || '—'} />
          <Row k="도로명 주소" v={roadOf(item, d) || dv(null)} />
          <Row k="지목" v={jimokOf(item, d) || dv(null)} />
          <Row k="용도" v={item.usage || '—'} />
          <Row k="토지 면적" v={sqm(item.landArea) || dv(null)} />
          {shareInfo(item).share && <Row k="지분" v={areaText(item)} />}
          <Row k="건물 면적" v={sqm(item.buildingArea) || (item.landArea ? '— (토지만)' : dv(null))} />
          <Row k="감정가" v={`${won(item.appraisal)}${d?.appraisalDate ? ` (${fmtYmd(d.appraisalDate)} 감정)` : ''}`} />
          <Row k="최저가" v={item.minBidText && !item.minBid ? item.minBidText : `${won(item.minBid)}${item.appraisal && item.minBid ? ` (${Math.round((item.minBid / item.appraisal) * 100)}%)` : ''}`} strong />
          <Row k="유찰" v={`${item.failCount ?? '—'}회${item.bidCount !== null && item.bidCount !== undefined ? ` · 입찰 진행 ${item.bidCount}회` : ''}`} />
          <Row k="매각기일(입찰 기간)" v={item.bidStart || item.bidEnd ? `${item.bidStart || ''} ~ ${item.bidEnd || ''}` : '—'} />
          <Row k="이용현황" v={<span className="whitespace-pre-line">{dv(d?.usageStatus)}</span>} />
        </div>
      </div>
      <div className="mt-3 grid gap-x-6 border-t border-line/60 pt-2 sm:grid-cols-2">
        <Row k="재산 종류" v={item.propertyTypeName || (item.source === 'court' ? '법원경매' : '—')} />
        <Row k="입찰 방식" v={[d?.bidMethod || item.bidMethod, item.privateContract ? '수의계약 가능' : null, item.bulk ? '일괄입찰' : null].filter(Boolean).join(' · ') || '—'} />
        <Row k="공고 기관" v={`${item.court || '—'}${d?.requestOrg ? ` (위임 ${d.requestOrg})` : ''}`} />
        <Row k="최초 공고일" v={d?.firstNoticeDate ? fmtYmd(d.firstNoticeDate) : dv(null)} />
        {d?.openDate && <Row k="개찰일" v={fmtYmd(d.openDate)} />}
        {d?.deposit && <Row k="입찰 보증금" v={d.deposit} />}
        {d?.plannedPrice ? <Row k="매각 예정가격" v={won(d.plannedPrice)} /> : null}
        <Row k="배분요구 종기" v={d?.distributionDeadline ? fmtYmd(d.distributionDeadline) : dv(null)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {d?.appraisalFile && <a href={d.appraisalFile} target="_blank" rel="noreferrer" className="text-brand underline">감정평가서 보기{d.appraisalOrg ? ` (${d.appraisalOrg})` : ''}</a>}
        {(d?.documents || []).map((doc, i) => <a key={i} href={doc.url} target="_blank" rel="noreferrer" className="text-brand underline">{doc.name}</a>)}
      </div>
    </Card>
  );
}

function Desc({ k, v }) {
  return <div className="border-b border-line/60 py-2 text-sm last:border-0"><div className="mb-0.5 text-xs font-bold text-ink/60">{k}</div><div className="whitespace-pre-line leading-relaxed">{v}</div></div>;
}

function Check({ state, label, note }) {
  const look = { bad: ['bg-hard', '확인 필요'], none: ['bg-now', '자료상 표시 없음'], unknown: ['bg-ink/25', '확인 안 됨(자료 없음)'] }[state];
  return (
    <div className="flex items-start gap-2 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${look[0]}`} />
      <div><div>{label} — {look[1]}</div>{note && <div className="text-xs text-ink/60">{String(note).slice(0, 200)}</div>}</div>
    </div>
  );
}

function FundCalc({ item, a }) {
  const [bid, setBid] = useState(Math.round((a.entry?.price || item.minBid || 0) / 1e4));
  const [loan, setLoan] = useState(item.source === 'court' ? 70 : 60);
  const [rate, setRate] = useState(4.5);
  const [months, setMonths] = useState(12);
  const price = bid * 1e4;
  const loanAmt = Math.round(price * (loan / 100));
  const tax = Math.round(price * (a.costs?.taxRate ?? 0.011));
  const other = (a.costs?.eviction || 0) + (a.costs?.repair || 0);
  const own = price - loanAmt + tax + other;
  const interest = Math.round(loanAmt * (rate / 100) * (months / 12));
  const profit = a.value ? a.value - price - tax - other - interest : null;
  return (
    <Card title="자금 계산기">
      <div className="grid grid-cols-2 gap-2">
        <Field label="입찰가(만원)"><input className="input num" inputMode="numeric" value={bid} onChange={(e) => setBid(Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
        <Field label="대출 비율(%)"><input className="input num" inputMode="numeric" value={loan} onChange={(e) => setLoan(Number(e.target.value) || 0)} /></Field>
        <Field label="금리(%)"><input className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} /></Field>
        <Field label="보유 기간(개월)"><input className="input num" inputMode="numeric" value={months} onChange={(e) => setMonths(Number(e.target.value) || 0)} /></Field>
      </div>
      <div className="mt-3">
        <Row k="대출" v={won(loanAmt)} />
        <Row k={`취득세 등(${((a.costs?.taxRate ?? 0.011) * 100).toFixed(1)}%)`} v={won(tax)} />
        <Row k="명도·수리" v={won(other)} />
        <Row k="필요 자기자본" v={won(own)} strong />
        <Row k="보유 기간 이자" v={won(interest)} />
        <Row k="예상 차익(세전)" v={won(profit)} strong />
      </div>
      <p className="mt-2 text-xs text-ink/50">세율·대출 조건은 단순화한 값입니다. 실제 입찰 전 세무·대출 조건을 확인하세요.</p>
    </Card>
  );
}

function RightCalc({ item, a, admin, onSave, silvDeals, zoneName }) {
  const e = item.manual?.econ || {};
  const [v, setV] = useState({ ratio: Math.round((e.ratio ?? 1) * 100), memberPrice: e.memberPrice ? Math.round(e.memberPrice / 1e4) : '', newPrice: e.newPrice ? Math.round(e.newPrice / 1e4) : '', area: e.area || 84 });
  const r = a.right;
  const save = () => onSave({ ratio: Number(v.ratio) / 100 || 1, memberPrice: v.memberPrice ? Number(v.memberPrice) * 1e4 : null, newPrice: v.newPrice ? Number(v.newPrice) * 1e4 : null, area: Number(v.area) || 84 });
  const token = String(zoneName || '').replace(/[[\]\s]|샘플|구역|주택|재개발|재건축|정비사업/g, '').slice(0, 4);
  const near = (silvDeals || []).filter((d) => d[10] === '입주권' || !d[10]);
  const same = token ? near.filter((d) => String(d[5] || '').includes(token)) : [];
  const show = (same.length ? same : near).slice(0, 8);
  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <div className="mb-2 text-sm font-bold">입주권 가치 계산</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="비례율(%)"><input className="input num" disabled={!admin} value={v.ratio} onChange={(x) => setV({ ...v, ratio: x.target.value })} /></Field>
        <Field label="신청 평형(㎡)"><input className="input num" disabled={!admin} value={v.area} onChange={(x) => setV({ ...v, area: x.target.value })} /></Field>
        <Field label="조합원분양가(만원)"><input className="input num" disabled={!admin} value={v.memberPrice} onChange={(x) => setV({ ...v, memberPrice: x.target.value })} /></Field>
        <Field label="신축 시세(만원)" hint={r?.newPriceAuto ? `비우면 주변 5년 이내 신축 ${r.newPriceAuto.count}건 기준 ${Math.round(r.newPriceAuto.price / 1e4).toLocaleString('ko-KR')}만` : '비우면 주변 신축 실거래로 추정'}><input className="input num" disabled={!admin} value={v.newPrice} onChange={(x) => setV({ ...v, newPrice: x.target.value })} /></Field>
      </div>
      {admin && <button className="btn-ghost mt-2" onClick={save}>저장하고 다시 계산</button>}
      <div className="mt-2">
        <Row k="권리가액 (감정가 × 비례율)" v={won(r?.rightPrice)} />
        <Row k="추가분담금 (조합원분양가 − 권리가액)" v={r?.contribution === null || r?.contribution === undefined ? '조합원분양가 입력 필요' : won(r.contribution)} />
        <Row k="입주권 가치 (신축 시세 − 분담금)" v={won(r?.value)} strong />
      </div>
      <p className="mt-1 text-[11px] text-ink/50">종전자산평가액 대신 경매 감정가를 쓴 추정입니다. 관리처분계획의 실제 권리가액·분양가가 있으면 그 값으로 바꿔 넣으세요.</p>
      {show.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="mb-1 font-medium">{same.length ? `「${token}」 입주권 거래` : '같은 시군구 입주권·분양권 거래'} (최근 12개월)</div>
          <table className="w-full num"><tbody>{show.map((d, i) => <tr key={i} className="border-t border-line/50"><td>{String(d[11] || '').slice(2, 4)}.{String(d[11] || '').slice(4)}.{d[3]}</td><td>{d[5]}</td><td>{d[10] || ''}</td><td className="text-right">{d[1]}㎡</td><td className="text-right">{eok(d[0])}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

// 특수물건: 바닥 가치 / 상승 시나리오 / 확인할 것
function SpecialCard({ item, a, admin, onSave, onNeighbors, busy }) {
  const sp = a.special;
  const sv = item.manual?.special || {};
  const save = (k) => (e) => onSave({ special: { ...sv, [k]: Number(String(e.target.value).replace(/\D/g, '')) * 1e4 || 0 } });
  return (
    <Card title="권리 분석으로 보는 가치" right={<span className="text-xs text-ink/50">버리지 않고 계산합니다 — 최악과 잘 풀릴 때를 함께</span>}>
      <div className="mb-3 flex flex-wrap gap-1.5">{sp.types.map((t) => <Badge key={t.key} tone="cash">{t.label}<span className="ml-1 font-normal opacity-70">({String(t.evidence).slice(0, 30)})</span></Badge>)}</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-paper p-3">
          <div className="text-xs text-ink/50">바닥 가치 (아무 일도 안 풀릴 때)</div>
          <div className="num text-lg font-extrabold">{sp.floorKnown ? eok(sp.floor) : a.full ? '인수 금액 확인 필요' : '시세 자료 부족'}</div>
          <div className="text-xs text-ink/60">{sp.types.map((t) => t.floorBasis).join(' × ')}</div>
          {sp.floorEntry && <div className="mt-1 text-xs font-bold text-now">바닥 이하로 사는 시점: {sp.floorEntry.label} ({eok(sp.floorEntry.price)})</div>}
        </div>
        <div className="rounded-lg bg-paper p-3">
          <div className="text-xs text-ink/50">가장 좋은 시나리오</div>
          <div className="num text-lg font-extrabold text-now">{sp.best ? eok(sp.best.value) : '—'}</div>
          <div className="text-xs text-ink/60">{sp.best ? `${sp.best.name} · 약 ${sp.best.months}개월 · 가능성 ${sp.best.prob}` : '금액을 낼 수 있는 시나리오 없음'}</div>
          {sp.expected && <div className="mt-1 text-xs font-bold text-ink/70">가능성 반영 기대 가치 {eok(sp.expected)} <span className="font-normal text-ink/50">(점수는 이 값으로)</span></div>}
        </div>
        <div className="rounded-lg bg-paper p-3">
          <div className="text-xs text-ink/50">지금 최저가로 사서 잘 풀리면</div>
          {a.upMoney ? <>
            <div className={`num text-lg font-extrabold ${a.upMoney.profit < 0 ? 'text-hard' : 'text-now'}`}>{eok(a.upMoney.profit)}</div>
            <div className="text-xs text-ink/60">내 돈 {eok(a.upMoney.own)} · 수익률 {a.upMoney.roi === null ? '—' : `${Math.round(a.upMoney.roi * 100)}%`} · {a.upMoney.months}개월 보유</div>
          </> : <div className="text-sm text-ink/50">—</div>}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {sp.scenarios.map((sc, i) => (
          <div key={i} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-bold">{sc.name}</span>
              <span className="text-xs text-ink/50">{sc.type}</span>
              <span className="ml-auto num font-bold">{sc.value ? eok(sc.value) : sc.annual ? `연 ${eok(sc.annual)}` : '금액 계산 불가'}</span>
              <Badge tone={{ 높음: 'now', 보통: 'wait', 낮음: 'hard' }[sc.prob] || 'muted'}>{sc.prob}</Badge>
            </div>
            <div className="mt-1 text-xs text-ink/60">{sc.basis}{sc.months ? ` · 약 ${sc.months}개월` : ''}</div>
            {sc.conditions?.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-ink/80">{sc.conditions.map((c) => <li key={c} className={c.startsWith('✔') ? 'font-bold text-now' : ''}>{c.startsWith('✔') ? c : `☐ ${c}`}</li>)}</ul>}
          </div>
        ))}
      </div>
      {sp.types.some((t) => ['road', 'landlocked'].includes(t.key)) && (
        <div className="mt-4 rounded-lg border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">주변 필지 맹지 확인</span>
            <span className="text-xs text-ink/50">{item.neighbors?.checkedAt ? `${String(item.neighbors.checkedAt).slice(0, 10)} 확인 · ${item.neighbors.note || ''}` : '아직 확인 안 함(수집 때 자동, 또는 버튼)'}</span>
            {admin && item.pnu && <button className="btn ml-auto border border-line bg-white" disabled={busy} onClick={onNeighbors}>{busy ? '확인 중…' : '지금 확인'}</button>}
          </div>
          {item.neighbors?.list?.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-ink/50"><tr><th className="text-left">지번</th><th className="text-left">지목</th><th className="text-left">도로접면</th></tr></thead>
              <tbody>{item.neighbors.list.map((n) => <tr key={n.pnu} className={`border-t border-line/50 ${n.landlocked ? 'font-bold text-now' : ''}`}><td>{n.jibun}</td><td>{n.jimok || '—'}</td><td>{n.roadSide || (/(도|구|천)/.test(n.jimok || '') ? '도로·하천 필지' : '—')}{n.landlocked ? ' ← 매수 후보' : ''}</td></tr>)}</tbody>
            </table>
          )}
          {item.neighbors?.error && <p className="mt-1 text-xs text-hard">{item.neighbors.error}</p>}
        </div>
      )}
      <div className="mt-4 rounded-lg bg-wait/5 p-3 text-sm">
        <div className="mb-1 font-bold text-wait">정확히 판단하려면 확인할 것</div>
        <ul className="grid gap-0.5 text-xs sm:grid-cols-2">{sp.checks.map((c) => <li key={c}>• {c}</li>)}</ul>
      </div>
      {admin && (
        <div className="no-print mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <label>확인한 인수 금액(만원)<input className="input mt-1" inputMode="numeric" defaultValue={sv.assume ? sv.assume / 1e4 : ''} onBlur={save('assume')} placeholder="예: 선순위 보증금 5000" /></label>
          <label>내가 본 바닥 가치(만원, 직접 입력 시 우선)<input className="input mt-1" inputMode="numeric" defaultValue={sv.floor ? sv.floor / 1e4 : ''} onBlur={save('floor')} /></label>
        </div>
      )}
    </Card>
  );
}

// 올수리 후 매도
function RenoCard({ a }) {
  const r = a.renovation; const m = a.renoMoney; const base = a.money;
  return (
    <Card title="올수리하고 팔면" right={<span className="text-xs text-ink/50">평당 {Math.round(r.perPyeong / 1e4)}만 원 · {r.months}개월 기준 (관리자 설정)</span>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-paper p-3"><div className="text-xs text-ink/50">지금 상태 시세</div><div className="num text-lg font-extrabold">{eok(a.market.value)}</div></div>
        <div className="rounded-lg bg-paper p-3"><div className="text-xs text-ink/50">올수리 비용</div><div className="num text-lg font-extrabold">{eok(r.cost)}</div><div className="text-xs text-ink/60">전용 {Math.round(r.area / 3.3058)}평</div></div>
        <div className="rounded-lg bg-paper p-3"><div className="text-xs text-ink/50">수리 후 예상 매도가</div><div className="num text-lg font-extrabold text-now">{eok(r.after)}</div><div className="text-xs text-ink/60">시세보다 {eok(Math.abs(r.uplift))} {r.uplift >= 0 ? "↑" : "↓"}</div></div>
        <div className="rounded-lg bg-paper p-3"><div className="text-xs text-ink/50">{m?.owner === 'corp' ? '세후 수익' : '예상 수익'}</div>
          <div className={`num text-lg font-extrabold ${m && m.profit < 0 ? 'text-hard' : 'text-now'}`}>{m ? eok(m.profit) : '—'}</div>
          <div className="text-xs text-ink/60">{m ? `내 돈 ${eok(m.own)} · 수익률 ${m.roi === null ? '—' : Math.round(m.roi * 100) + '%'}` : ''}{base?.profit != null ? ` · 수리 안 하면 ${eok(base.profit)}` : ''}</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink/50">수리 후 가격 근거: {r.basis}. {r.worth ? '수리비보다 오르는 폭이 커서 해볼 만합니다.' : '오르는 폭이 수리비에 비해 크지 않습니다.'} 실제 내부 상태·누수·구조는 현장 확인이 필요합니다.</p>
    </Card>
  );
}

// 온비드 회차별 입찰 결과(물건상세 입찰정보)
function BidHistory({ info, appraisal }) {
  return (
    <Card title="회차별 입찰 결과" right={<span className="text-xs text-ink/50">온비드 물건상세 입찰정보 · 보증금 {info.deposit || '—'}</span>}>
      <table className="w-full text-sm">
        <thead className="text-xs text-ink/50"><tr><th className="text-left">회차</th><th className="text-left">개찰</th><th className="text-left">결과</th><th className="text-right">최저가</th><th className="text-right">낙찰가</th><th className="text-right">감정가 대비</th></tr></thead>
        <tbody>{info.history.map((h, i) => (
          <tr key={i} className="border-t border-line/50"><td>{h.round}회</td><td>{h.openAt || '—'}</td><td className={/낙찰/.test(h.status || '') ? 'font-bold text-now' : ''}>{h.status || '—'}</td>
            <td className="text-right num">{h.minBid ? eok(h.minBid) : '—'}</td><td className="text-right num">{h.soldPrice ? eok(h.soldPrice) : '—'}</td>
            <td className="text-right num">{h.rateToAppraisal ? `${Math.round(h.rateToAppraisal)}%` : h.soldPrice && appraisal ? pct(h.soldPrice / appraisal) : '—'}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

// 건축HUB: 건축물대장(교차 확인)·같은 동 최근 건축 허가
function BuildingCard({ item }) {
  const lg = item.ledger; const pm = item.permits; const t = lg?.titles?.[0];
  return (
    <Card title="건축물대장·주변 건축 허가" right={<span className="text-xs text-ink/50">국토교통부 건축HUB</span>}>
      {t && (
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Row k="건물" v={[t.bldNm, t.dongNm].filter(Boolean).join(' ') || '—'} />
          <Row k="주용도" v={t.mainPurpose || '—'} />
          <Row k="사용승인" v={lg.useApr ? `${lg.useApr} (${lg.age}년)` : '—'} />
          <Row k="구조·층수" v={`${t.structure || '—'} · 지상 ${t.floors ?? '—'}층${t.basements ? ` / 지하 ${t.basements}층` : ''}`} />
          {lg.unit && <Row k={`${lg.unit.dong ? lg.unit.dong + '동 ' : ''}${lg.unit.ho}호 전유면적`} v={`${lg.unit.exclusiveArea}㎡${item.buildingArea ? ` (읽어 온 면적 ${item.buildingArea}㎡)` : ''}`} strong />}
          <Row k="건폐율·용적률" v={`${t.bcRat ?? '—'}% · ${t.vlRat ?? '—'}%`} />
        </div>
      )}
      {lg?.error && <p className="text-xs text-hard">건축물대장 조회 실패: {lg.error}</p>}
      {pm && !pm.error && (
        <div className="mt-2 text-sm">
          <div className="font-bold">같은 법정동 최근 {pm.years}년 건축 허가 {pm.total}건 (신축 {pm.newBuild}건)</div>
          {pm.recent?.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-ink/70">{pm.recent.map((r, i) => <li key={i}>{r.permitDay} · {r.kind} · {r.purpose || ''} · {r.place}{r.totArea ? ` · ${Math.round(r.totArea)}㎡` : ''}</li>)}</ul>}
        </div>
      )}
      {pm?.error && <p className="text-xs text-hard">건축 허가 조회 실패: {pm.error}</p>}
    </Card>
  );
}

// 관리자: 지분비율·공유자 수를 원문(공고·등기부)에서 확인해 넣기 — 원본에서 자동으로 못 읽은 경우
function ShareForm({ item, onSave }) {
  const ms = item.manual?.share || {};
  const [v, setV] = useState({ num: ms.num || '', den: ms.den || '', coOwners: ms.coOwners || '', note: ms.note || '' });
  const save = () => onSave({ share: { num: Number(v.num) || null, den: Number(v.den) || null, coOwners: Number(v.coOwners) || null, note: v.note || null, at: new Date().toISOString() } });
  return (
    <div className="mt-3 rounded-md border border-line p-2 text-xs">
      <div className="mb-1 font-bold">지분비율(원문 확인 후 입력)</div>
      <div className="grid grid-cols-[1fr_auto_1fr_1fr] items-center gap-1.5">
        <input className="input py-1" placeholder="분자" value={v.num} onChange={(e) => setV({ ...v, num: e.target.value })} />
        <span>/</span>
        <input className="input py-1" placeholder="분모" value={v.den} onChange={(e) => setV({ ...v, den: e.target.value })} />
        <input className="input py-1" placeholder="등기상 공유자 수" value={v.coOwners} onChange={(e) => setV({ ...v, coOwners: e.target.value })} />
      </div>
      <input className="input mt-1.5 py-1" placeholder="근거(예: 등기부 갑구 3번, 공고문 2쪽)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      <div className="mt-1.5 flex gap-2"><button className="btn-ghost py-1 text-xs" onClick={save}>저장</button><button className="text-hard underline" onClick={() => onSave({ share: { ...ms, notShare: !ms.notShare } })}>{ms.notShare ? '지분 물건으로 되돌리기' : '지분 매각 아님(대지지분 등 오인)'}</button></div>
    </div>
  );
}

// 정비구역 목록 연계 결과(서버가 매일 붙임) + 권리산정기준일(도시정비법 제77조①) 판정
function ZoneMatchBox({ item, admin, onSave }) {
  const m = item.redevMatch;
  const r = m?.status === 'listed' ? rightsCheck(item, m) : null;
  const m77 = item.manual?.rights77 || {};
  const tone = { listed: 'brand', unlisted: 'wait', none: 'muted', unchecked: 'muted' }[m?.status] || 'muted';
  const setFlag = (k, v) => onSave({ rights77: { ...m77, [k]: v } });
  const FLAG = [['split', 1], ['toCollective', 2], ['separated', 3], ['newBuild', 4]];
  return (
    <div className="rounded-lg border border-brand/20 p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-1.5 font-bold">정비구역 목록 연계 <Badge tone={tone}>{m ? ZONE_STATUS_LABEL[m.status] : '연결 전(새벽 수집 때)'}</Badge></div>
      {m?.status === 'listed' && (
        <>
          <div><b>{m.name}</b> · {m.type || '유형 미상'} · 단계 <b>{m.stage}</b> <span className="text-xs text-ink/50">({m.by} 일치)</span></div>
          <div className="mt-0.5 text-xs text-ink/60">
            확인일 {m.confirmedAt || '—'}{m.recheck && <Badge tone="wait" className="ml-1">재확인 필요</Badge>}
            {m.permitZone?.yes ? ` · 토지거래허가구역 ${m.permitZone.from || ''}~${m.permitZone.to || ''}` : ''}{m.actRestriction?.yes ? ' · 행위제한 고시' : ''}
          </div>
          {m.sourceUrls?.length > 0 && <div className="mt-0.5 text-xs">{m.sourceUrls.map((u, i) => <a key={u} className="mr-2 text-brand underline" href={u} target="_blank" rel="noreferrer">근거{i + 1}</a>)}</div>}
          {r && (
            <div className={`mt-2 rounded-md p-2 text-xs ${r.status === 'restricted' ? 'bg-hard/5 text-hard' : r.status === 'risk' ? 'bg-wait/10' : 'bg-paper'}`}>
              <div className="font-bold">권리산정기준일{r.basisDate ? ` ${r.basisDate}(${r.basisFrom || '—'}) → ${r.effectiveFrom}부터 적용` : ''}</div>
              <div>{r.text}</div>
              {[...(r.hits || []), ...(r.risks || [])].map((h, i) => <div key={i}>· 제{h.ho}호 {h.text} — {h.evidence}</div>)}
              {r.checks?.length > 0 && <div className="mt-1 text-ink/60">확인할 서류: {r.checks.join(', ')}</div>}
              <div className="mt-1 text-[11px] text-ink/50">{r.law}: 기준일 다음 날 이후 분할·집합건물 전환·토지/건물 분리 소유·신축이면 분양받을 권리를 제한</div>
            </div>
          )}
          {admin && r && r.status !== 'pending' && (
            <div className="mt-2 grid gap-1 text-xs">
              <div className="font-bold">서류로 확인한 값(기준일 다음 날 이후 생겼나)</div>
              {FLAG.map(([k, ho]) => (
                <label key={k} className="flex items-center gap-2">
                  <select className="input w-24 py-0.5" value={m77[k] === true ? 'y' : m77[k] === false ? 'n' : ''} onChange={(e) => setFlag(k, e.target.value === 'y' ? true : e.target.value === 'n' ? false : undefined)}>
                    <option value="">모름</option><option value="y">해당</option><option value="n">아님</option>
                  </select>
                  제{ho}호 {ART77[ho]}
                </label>
              ))}
              <p className="text-ink/50">바꾸면 분양자격 판정에 바로 반영됩니다.</p>
            </div>
          )}
        </>
      )}
      {m?.status === 'unlisted' && <div className="text-xs">브이월드 토지이용계획: {m.vworld.join(', ')} — 관리자 정비구역 목록에 아직 없음(관리자 화면 알림).</div>}
      {m?.status === 'none' && <div className="text-xs text-ink/60">목록·토지이용계획 모두 정비구역 아님. 지정 전 구역(후보지 등)은 목록에 있어야만 잡힙니다.</div>}
      {m?.status === 'unchecked' && <div className="text-xs text-ink/60">토지이용계획 조회 전이고 목록과도 맞지 않음 — 조회 뒤 다시 판정.</div>}
    </div>
  );
}

// 예측 기록: 입찰 전에 기록한 값(채점은 이 값 그대로) + 분석기 수정 뒤 재계산 참고값
function ForecastCard({ item }) {
  const f = item.forecast; const r = item.forecastRevised;
  const line = (x) => `${x.at} · ${x.verdict}${x.grade ? ` · ${x.grade} ${x.score}점` : ''} · 가치 ${eok(x.value)} · 매수상한 ${eok(x.cap)}${x.profit !== null && x.profit !== undefined ? ` · 수익 ${eok(x.profit)}` : ''}${x.calcAnomaly ? ' · 계산 이상' : ''}`;
  return (
    <Card title="예측 기록">
      {f && <div className="text-sm"><b>기록된 예측</b> ({f.analyzerVersion || `규칙 ${f.rules}`}): {line(f)} <span className="text-xs text-ink/50">— 완료 채점은 이 값 그대로</span></div>}
      {r && <div className="mt-1 text-sm text-ink/70"><b>수정 후 참고값</b> ({r.analyzerVersion}): {line(r)}</div>}
    </Card>
  );
}
