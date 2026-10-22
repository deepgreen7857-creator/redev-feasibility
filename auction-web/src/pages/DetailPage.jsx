import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getListing, getSettings, getDeals, callFn, saveListing, getZones } from '../lib/store.js';
import { zonesForListing, stageForAnalysis } from '../lib/redevZones.js';
import { analyze, tradeTypeOf, courtRate, eok, won, pct, SOURCE_LABEL, typeLabel, areaText } from '../lib/analyze.js';
import { lawdOf } from '../data/defaults.js';
import { Badge, VerdictBadge, Card, Row, Field, Empty } from '../components/ui.jsx';

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
      }
    });
  }, [id]);

  const a = useMemo(() => (item && settings ? analyze(item, { settings, deals, aptDeals }) : null), [item, settings, deals, aptDeals]);
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

  const rate = item.source === 'court' ? courtRate(item, settings) : null;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link to="/" className="text-sm text-brand">← 목록</Link>
        <button className="btn-ghost" onClick={() => window.print()}>결과지 인쇄</button>
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <VerdictBadge verdict={a.verdict} />
          <Badge tone={item.category === 'bankrupt' ? 'cash' : 'muted'}>{SOURCE_LABEL[item.source === 'court' ? 'court' : item.category]}</Badge>
          {item.propertyTypeName && <Badge>{item.propertyTypeName}</Badge>}
          {a.cashType && <Badge tone="cash">현금청산형</Badge>}
          {a.farm && <Badge tone="wait">농지</Badge>}
          {a.excluded && <Badge>관심 제외(재직 중 분석 대상 아님)</Badge>}
        </div>
        <h1 className="text-xl font-extrabold leading-snug"><span className="mr-2 rounded bg-ink px-2 py-0.5 align-middle text-sm text-white">{typeLabel(item)}</span>{item.title}</h1>
        <div className="mt-1 text-sm text-ink/60">{item.address}</div>
        {(areaText(item) || item.usage) && <div className="text-sm text-ink/60">{areaText(item)}{item.usage ? ` · 용도: ${item.usage}` : ''}</div>}
        <div className="mt-1 text-xs text-ink/50">{item.court} · {item.caseNo} {item.round ? `· ${item.round}회차` : ''} {item.status ? `· ${item.status}` : ''}</div>
        {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="no-print mt-2 inline-block text-sm text-brand underline">{item.source === 'court' ? '법원경매정보 원문' : '온비드 원문'}</a>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="판정" className="lg:col-span-1">
          <Row k="감정가" v={won(item.appraisal)} />
          <Row k="현재 최저가" v={`${won(item.minBid)} (${pct(a.ratio)})`} strong />
          <Row k="예상 가치" v={won(a.value)} />
          <Row k="비용(세금·명도·수리)" v={won(a.costs?.total)} />
          <Row k={`매수상한 (마진 ${Math.round((settings.marginRate ?? 0.1) * 100)}%)`} v={won(a.cap)} strong />
          <Row k="진입 시점" v={a.verdict === 'hard' ? '가격으로 해결 안 됨' : a.entry ? a.entry.label : '하한까지도 상한 초과'} strong />
          {a.money && (
            <div className="mt-3 rounded-md border border-line p-2 text-sm">
              <div className="mb-1 font-bold">돈 계산 ({a.verdict === 'now' ? '지금 최저가' : `${a.entry.label} 가격`}에 사서 {a.money.months}개월 뒤 예상 가치에 팔 때)</div>
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
              <div className="font-bold">매력도 {a.score.grade} · {a.score.total}점 <span className="text-xs font-normal text-ink/60">(안전마진 {Math.round(a.score.margin * 100)}%{a.verdict === 'wait' ? ', 진입 회차 기준' : ''})</span></div>
              <div className="mt-1 text-xs text-ink/60">{Object.entries(a.score.parts).map(([k, v]) => `${k} ${v}`).join(' · ')} / 만점 45·20·25·10</div>
            </div>
          )}
          <p className="mt-2 text-xs text-ink/50">{a.valueBasis}</p>
          {a.reasons.length > 0 && <div className="mt-3 rounded-md bg-hard/5 p-2 text-sm text-hard">해결 안 되는 이유: {a.reasons.join(', ')}</div>}
          {a.warnings.length > 0 && <ul className="mt-3 space-y-1 text-sm text-wait">{a.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
        </Card>

        <Card title="회차별 최저가 vs 매수상한" className="lg:col-span-2" right={<span className="text-xs text-ink/50">{rate ? `${rate.name} 저감률 ${Math.round(rate.rate * 100)}%${rate.verified ? '' : ' (확인 전)'}` : '공매: 최초가의 10%씩, 50% 하한'}</span>}>
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
          {Array.isArray(item.history) && item.history.length > 0 && (
            <div className="mt-4 text-xs text-ink/60">
              <div className="mb-1 font-medium">지난 회차 기록</div>
              {item.history.slice(-6).map((h) => <div key={h.at}>{h.at.slice(0, 10)} · {h.round}회차 · {eok(h.minBid)} · {h.status}</div>)}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="시세 근거" right={<span className="text-xs text-ink/50">{TYPE_NAME[a.market.type]} · 최근 12개월</span>}>
          {a.market.value ? (
            <>
              <Row k="비교 면적" v={`${a.market.area}㎡`} />
              <Row k="㎡당 중앙값" v={won(a.market.unit)} />
              <Row k="추정 시세" v={won(a.market.value)} strong />
              <p className="mt-2 text-xs text-ink/50">{a.market.basis}</p>
              <div className="mt-3 max-h-56 overflow-auto text-xs">
                <table className="w-full num">
                  <thead className="text-ink/50"><tr><th className="text-left">계약</th><th className="text-left">이름/동</th><th className="text-right">면적</th><th className="text-right">가격</th></tr></thead>
                  <tbody>{a.market.samples.map((d, i) => <tr key={i} className="border-t border-line/50"><td>{String(d[11] || '').slice(2, 4)}.{String(d[11] || '').slice(4)}.{d[3]}</td><td>{d[5]} {d[9]}</td><td className="text-right">{d[1]}</td><td className="text-right">{eok(d[0])}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : <Empty>{a.market.basis}. 실거래 수집이 끝나면 자동으로 채워집니다.</Empty>}
        </Card>

        <Card title="토지이용·정비구역" right={admin && item.pnu && <button className="btn-ghost no-print" disabled={busy === 'land'} onClick={checkLand}>{busy === 'land' ? '조회 중…' : '브이월드 조회'}</button>}>
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
            </>
          ) : <Empty>{item.pnu ? '아직 조회 전입니다.' : '필지번호(PNU)가 없어 조회할 수 없습니다.'}</Empty>}
          {msg && <p className="mt-2 text-sm text-hard">{msg}</p>}
          <div className="mt-3 rounded-lg bg-paper p-3">
            <div className="mb-1 text-sm font-bold">정비사업 현황(분기 엑셀)에서 같은 동 구역</div>
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
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-2">
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
          {a.member.status !== 'none' && (
            <div className={`mt-3 rounded-lg p-3 text-sm ${a.member.status === 'member' ? 'bg-now/5' : a.member.status === 'cash' ? 'bg-cash/5' : 'bg-wait/10'}`}>
              <div className="font-bold">분양자격: {a.member.status === 'member' ? '조합원 가능(입주권형)' : a.member.status === 'cash' ? '현금청산형' : '확인 필요'}{a.member.overheated ? ' · 투기과열지구' : ''}</div>
              <div className="mt-1 text-xs text-ink/70">{a.member.reason}</div>
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="권리 체크" right={<span className="text-xs text-ink/50">자동 확인은 1차 거르기용</span>}>
          {(() => {
            const d = item.detail; const f = d?.flags;
            const st = (bad, known) => (bad ? 'bad' : known ? 'none' : 'unknown');
            return (
              <>
                <Check state={st(f?.superficies, !!d)} label="법정지상권" note={d?.superficies} />
                <Check state={st(f?.survivingRights, !!d)} label="말소되지 않는 권리(인수)" note={d?.survivingRights} />
                <Check state={st(item.share, item.share !== undefined || !!d)} label="지분 물건" note={d?.shareText} />
                <Check state={st(f?.unclaimedTenants > 0, !!d)} label={`임차인 ${f?.tenants ?? '?'}명`} note={f?.unclaimedTenants ? `배분요구 안 함 ${f.unclaimedTenants}명` : null} />
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
          {item.detail?.deliveryDuty && <p className="mt-2 text-xs text-ink/60">인도 책임: {item.detail.deliveryDuty}</p>}
          {item.detail?.cautions && <p className="mt-1 text-xs text-ink/60">유의사항: {item.detail.cautions}</p>}
          {!item.detail && <p className="mt-2 text-xs text-ink/50">{item.source === 'court' ? '법원경매는 자동 권리 정보가 없습니다. 위 항목은 모두 "확인 안 됨"입니다.' : '상세(권리) 정보 수집 전입니다.'}</p>}
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!admin} checked={Boolean(item.manual?.hard)} onChange={(e) => updateManual({ hard: e.target.checked })} />
            가격으로 해결 안 됨으로 직접 표시
          </label>
          {item.manual?.hard && <input className="input mt-2" disabled={!admin} placeholder="이유 (예: 유치권 신고, 맹지)" value={item.manual?.hardNote || ''} onChange={(e) => updateManual({ hardNote: e.target.value })} />}
        </Card>

        <FundCalc item={item} a={a} />
      </div>

      <InfoSection item={item} />
    </div>
  );
}

const fmtYmd = (v) => { const t = String(v || '').replace(/\D/g, ''); return t.length >= 8 ? `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6, 8)}` : v || '—'; };

// 온비드 상세에서 받아 둔 원자료 — 사진·공고 정보·회차 일정·임차인·등기·현황 설명
function InfoSection({ item }) {
  const d = item.detail;
  const photos = (d?.photos || []).filter(Boolean);
  return (
    <>
      {(photos.length > 0 || item.thumbnail) && (
        <Card title="사진">
          <div className="flex gap-2 overflow-x-auto">
            {(photos.length ? photos : [item.thumbnail]).map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0"><img src={u} alt={`물건 사진 ${i + 1}`} loading="lazy" className="h-40 w-56 rounded-lg border border-line object-cover" /></a>
            ))}
          </div>
          {d?.mapUrls?.length > 0 && <div className="mt-2 flex gap-3 text-sm">{d.mapUrls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="text-brand underline">위치도·지적도 {i + 1}</a>)}</div>}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="공고·입찰 정보">
          <Row k="재산 종류" v={item.propertyTypeName || (item.source === 'court' ? '법원경매' : '—')} />
          <Row k="용도" v={item.usage || '—'} />
          <Row k="지번 주소" v={d?.addressFull || item.address || '—'} />
          {d?.roadAddress && <Row k="도로명 주소" v={d.roadAddress} />}
          {d?.landCategory && <Row k="지목" v={d.landCategory} />}
          <Row k="감정가 / 감정 시점" v={`${won(item.appraisal)}${d?.appraisalDate ? ` (${fmtYmd(d.appraisalDate)})` : ''}`} />
          {d?.plannedPrice ? <Row k="매각 예정가격" v={won(d.plannedPrice)} /> : null}
          <Row k="현재 최저가" v={item.minBidText && !item.minBid ? item.minBidText : won(item.minBid)} />
          <Row k="유찰 / 입찰 진행" v={`${item.failCount ?? '—'}회 / ${item.bidCount ?? '—'}회`} />
          <Row k="입찰 기간" v={item.bidStart || item.bidEnd ? `${item.bidStart || ''} ~ ${item.bidEnd || ''}` : '—'} />
          {d?.openDate && <Row k="개찰일" v={fmtYmd(d.openDate)} />}
          {d?.firstNoticeDate && <Row k="최초 공고일" v={fmtYmd(d.firstNoticeDate)} />}
          {d?.deposit && <Row k="입찰 보증금" v={d.deposit} />}
          <Row k="입찰 방식" v={[item.bidMethod, item.privateContract ? '수의계약 가능' : null, item.bulk ? '일괄입찰' : null].filter(Boolean).join(' · ') || '—'} />
          <Row k="공고 기관" v={item.court || '—'} />
          {d?.baseRightDate && <Row k="최선순위 설정일(말소기준)" v={fmtYmd(d.baseRightDate)} />}
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {d?.appraisalFile && <a href={d.appraisalFile} target="_blank" rel="noreferrer" className="text-brand underline">감정평가서 보기</a>}
            {(d?.documents || []).map((doc, i) => <a key={i} href={doc.url} target="_blank" rel="noreferrer" className="text-brand underline">{doc.name}</a>)}
          </div>
        </Card>

        <Card title="회차별 일정">
          {d?.rounds?.length ? (
            <table className="w-full text-sm num">
              <thead className="text-left text-xs text-ink/50"><tr><th>회차</th><th>입찰 기간</th><th>개찰</th><th className="text-right">최저가</th></tr></thead>
              <tbody>{d.rounds.map((r, i) => <tr key={i} className={`border-t border-line/50 ${String(r.round) === String(item.round) ? 'font-bold text-brand' : ''}`}><td>{r.round}</td><td>{r.start ? `${r.start.slice(5, 10)}~${(r.end || '').slice(5, 10)}` : '—'}</td><td>{fmtYmd(r.open)}</td><td className="text-right">{eok(r.minBid)}</td></tr>)}</tbody>
            </table>
          ) : <Empty>회차 일정 자료가 없습니다{item.source === 'court' ? '(법원경매는 원문 확인)' : '(상세 수집 후 표시)'}.</Empty>}
        </Card>
      </div>

      {(d?.leases?.length > 0 || d?.rights?.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`임차인·점유 (${d?.leases?.length || 0}명)`}>
            {d?.leases?.length ? (
              <table className="w-full text-xs num">
                <thead className="text-left text-ink/50"><tr><th>임차인</th><th>부분</th><th className="text-right">보증금</th><th className="text-right">월세</th><th>전입</th><th>확정</th><th>배분요구</th></tr></thead>
                <tbody>{d.leases.map((l, i) => <tr key={i} className="border-t border-line/50"><td>{l.tenant || '—'}</td><td>{l.part || ''}</td><td className="text-right">{eok(l.deposit)}</td><td className="text-right">{l.rent ? eok(l.rent) : ''}</td><td>{fmtYmd(l.moveIn)}</td><td>{fmtYmd(l.fixedDate)}</td><td className={l.claimed ? 'text-now' : 'text-hard'}>{l.claimed ? '함' : '안 함'}</td></tr>)}</tbody>
              </table>
            ) : <Empty>임차 자료 없음</Empty>}
            <p className="mt-2 text-[11px] text-ink/50">전입일이 말소기준권리보다 빠르면 보증금을 인수할 수 있습니다. 등기부와 대조하세요.</p>
          </Card>
          <Card title="등기 주요 정보">
            {d?.rights?.length ? (
              <table className="w-full text-xs num">
                <thead className="text-left text-ink/50"><tr><th>권리</th><th>권리자</th><th>설정일</th><th className="text-right">금액</th></tr></thead>
                <tbody>{d.rights.map((r, i) => <tr key={i} className="border-t border-line/50"><td>{r.kind || '—'}</td><td>{r.holder || ''}</td><td>{fmtYmd(r.date)}</td><td className="text-right">{r.amount ? eok(r.amount) : ''}</td></tr>)}</tbody>
              </table>
            ) : <Empty>등기 자료 없음(압류재산만 제공)</Empty>}
            {d?.extinguished && <p className="mt-2 text-xs text-ink/60">매각으로 소멸: {d.extinguished}</p>}
          </Card>
        </div>
      )}

      {(d?.usageStatus || d?.location || d?.conditions) && (
        <Card title="현황 설명 (공고 원문)">
          {d.location && <Desc k="위치 및 부근 현황" v={d.location} />}
          {d.usageStatus && <Desc k="이용 현황" v={d.usageStatus} />}
          {d.conditions && <Desc k="부대 조건" v={d.conditions} />}
          {d.deliveryDuty && <Desc k="인도 책임" v={d.deliveryDuty} />}
          {d.cautions && <Desc k="유의사항" v={d.cautions} />}
        </Card>
      )}
    </>
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
