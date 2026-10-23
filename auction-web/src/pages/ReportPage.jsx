// 물건 검토서 — 물건 하나에 대한 판단 근거를 한 장에: 기본정보 → 권리 → 가치 검토 과정 → 특수물건 → 매수상한·회차 → 돈 → 정비사업 → 판정 근거·확인할 것
// 사이트가 어떻게 판단했는지 과정을 그대로 보여 주고, 정민 님이 그 과정에서 오류를 찾도록 한다. (인쇄 가능)
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getListing, getSettings, getDeals } from '../lib/store.js';
import { analyze, tradeTypeOf, eok, won, pct, SOURCE_LABEL, typeLabel, VERDICT } from '../lib/analyze.js';
import { lawdOf } from '../data/defaults.js';

const ymd = (v) => { const t = String(v || '').replace(/\D/g, ''); return t.length >= 8 ? `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6, 8)}` : v || '—'; };
const sqm = (n) => (n ? `${Math.round(n * 100) / 100}㎡ (${Math.round(n / 3.3058 * 10) / 10}평)` : '—');
const has = (v) => v !== null && v !== undefined && v !== '';

function H({ no, children }) { return <h2 className="mt-6 border-b-2 border-ink pb-1 text-base font-extrabold">{no}. {children}</h2>; }
function KV({ rows }) {
  return (
    <table className="mt-2 w-full text-sm"><tbody>
      {rows.filter(Boolean).map(([k, v], i) => <tr key={i} className="border-b border-line/60"><th className="w-40 bg-paper px-2 py-1 text-left align-top font-medium text-ink/70">{k}</th><td className="px-2 py-1">{has(v) ? v : '—'}</td></tr>)}
    </tbody></table>
  );
}
function T({ head, rows }) {
  return (
    <table className="mt-2 w-full text-sm">
      <thead><tr className="border-b border-ink/40 text-xs text-ink/60">{head.map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line/60 align-top">{r.map((c, j) => <td key={j} className={`px-2 py-1 ${j === 0 ? 'whitespace-nowrap font-medium' : ''}`}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
const Note = ({ children }) => <p className="mt-1 text-xs text-ink/60">{children}</p>;

export default function ReportPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(null);
  const [deals, setDeals] = useState([]); const [aptDeals, setAptDeals] = useState([]); const [rentDeals, setRentDeals] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([getListing(decodeURIComponent(id)), getSettings()]).then(async ([it, s]) => {
      if (!it) { setErr('물건을 찾지 못했습니다.'); return; }
      setItem(it); setSettings(s);
      const lawd = lawdOf(it.sido, it.sgg); const t = tradeTypeOf(it);
      const own = await getDeals(t, lawd, 12); setDeals(own);
      setAptDeals(t === 'apt' ? own : await getDeals('apt', lawd, 12));
      if (['apt', 'rh', 'sh', 'offi'].includes(t)) getDeals(`${t}Rent`, lawd, 12).then(setRentDeals).catch(() => {});
    }).catch((e) => setErr(e.message));
  }, [id]);
  const a = useMemo(() => (item && settings ? analyze(item, { settings, deals, aptDeals, rentDeals }) : null), [item, settings, deals, aptDeals, rentDeals]);
  if (err) return <div className="card text-sm text-hard">{err}</div>;
  if (!item || !a) return <div className="card text-sm text-ink/50">검토서를 만드는 중…</div>;

  const d = item.detail || {};
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const v = a.valuation; const sp = a.special; const m = a.money;
  const verdict = VERDICT[a.verdict]?.label || a.verdict;
  const conclusion = a.anomalies?.length ? `오류 의심 — 계산을 보류했습니다(${a.anomalies[0]})`
    : a.verdict === 'now' ? `지금 최저가 ${eok(item.minBid)}로 들어갈 만합니다(매수상한 ${eok(a.cap)})`
      : a.verdict === 'wait' ? `${a.entry?.label}(${eok(a.entry?.price)})에 들어가면 됩니다(매수상한 ${eok(a.cap)})`
        : a.verdict === 'check' ? '권리(인수 금액 등)를 확인한 뒤 판단해야 합니다'
          : a.verdict === 'hard' ? (a.reasons.length ? `제외: ${a.reasons.join(', ')}` : `하한까지 내려가도 매수상한(${eok(a.cap)})보다 비쌉니다`)
            : '가치를 낼 근거가 부족합니다';

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 shadow-sm print:p-0 print:shadow-none">
      <div className="no-print mb-3 flex gap-2 text-sm">
        <Link to={`/item/${encodeURIComponent(item.id)}`} className="text-brand underline">← 물건 상세</Link>
        <button className="btn ml-auto border border-line bg-white" onClick={() => window.print()}>인쇄·PDF 저장</button>
      </div>

      <div className="flex items-start justify-between gap-4 border-b-4 border-ink pb-2">
        <div>
          <div className="text-xs text-ink/60">정비경매 리포트 · 물건 검토서</div>
          <h1 className="text-xl font-extrabold leading-snug">[{typeLabel(item)}] {item.title}</h1>
          <div className="text-sm text-ink/70">{SOURCE_LABEL[item.source === 'court' ? 'court' : item.category]} · {item.court} · {item.caseNo}{item.round ? ` · ${item.round}회차` : ''}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-ink/60">작성 {today}<br />판단 기준 {item.forecast?.rules || '현재'}</div>
      </div>

      <div className="mt-3 rounded-lg border-2 border-ink p-3">
        <div className="text-sm"><b>판정: {verdict}</b>{a.score ? ` · 매력도 ${a.score.grade} ${a.score.total}점` : ''}{a.certainty ? ` · 확실성 ${a.certainty.grade}` : ''}</div>
        <div className="mt-1 font-bold">{conclusion}</div>
        {m && !m.upside && <div className="mt-1 text-sm">내 돈 {eok(m.own)} · {m.owner === 'corp' ? '세후' : '예상'} 수익 {eok(m.profit)} · 수익률 {m.roi === null ? '—' : pct(m.roi)} · {m.months}개월{sp ? ' (바닥 가치에 팔 때)' : ''}</div>}
        {a.opportunity && <div className="mt-1 text-sm text-now">기회({a.opportunity.kind}): 기대 수익 {eok(a.opportunity.profit)}, 내 돈 {eok(a.opportunity.own)} — {a.opportunity.note}</div>}
      </div>

      <H no="1">물건 기본정보</H>
      <KV rows={[
        ['소재지(지번)', d.addressFull || item.address], d.roadAddress && ['도로명', d.roadAddress],
        ['물건 종류·용도', `${typeLabel(item)} · ${item.usage || '—'}`], ['지목', d.landCategory || item.land?.jimok],
        ['토지 면적', sqm(item.landArea)], ['건물 면적', sqm(item.buildingArea)],
        ['감정가', `${won(item.appraisal)}${d.appraisalDate ? ` (${ymd(d.appraisalDate)} 감정)` : ''}`],
        ['최저가', `${won(item.minBid)}${item.appraisal && item.minBid ? ` (감정가의 ${pct(item.minBid / item.appraisal)})` : ''}`],
        ['유찰·회차', `유찰 ${item.failCount ?? '—'}회${item.round ? ` · ${item.round}회차` : ''}`], ['매각기일(입찰 마감)', item.bidEnd],
        ['재산 종류', item.propertyTypeName || (item.source === 'court' ? '법원경매' : '—')],
        ['지분·일괄', [item.share ? `지분${d.shareText ? `(${d.shareText})` : ''}` : null, item.bulk ? '일괄매각' : null].filter(Boolean).join(' · ') || '해당 없음(자료상)'],
        ['용도지역', item.land?.landUse?.zone], ['개별공시지가', item.land?.officialPrice ? `${item.land.officialPrice.toLocaleString('ko-KR')}원/㎡${item.land.officialPriceYear ? ` (${item.land.officialPriceYear})` : ''}` : null],
        ['주택 공시가격', item.housePrice?.price ? `${won(item.housePrice.price)} (${item.housePrice.kind} ${item.housePrice.year})` : null],
        item.ledger?.titles?.[0] && ['건축물대장', `${item.ledger.titles[0].mainPurpose || ''} · 사용승인 ${item.ledger.useApr || '—'}(${item.ledger.age ?? '—'}년) · ${item.ledger.titles[0].structure || ''}${item.ledger.unit ? ` · ${item.ledger.unit.ho}호 전유 ${item.ledger.unit.exclusiveArea}㎡` : ''}`],
        ['이용현황', d.usageStatus], ['정비구역', item.manual?.zone ? `${item.manual.zone.name} · ${item.manual.zone.stage || ''}` : (item.land?.landUse?.redevelopment || []).join(', ') || '해당 없음(자료상)'],
      ]} />

      <H no="2">권리 관계</H>
      <KV rows={[
        ['말소기준(최선순위)', d.baseRightDate ? ymd(d.baseRightDate) : '자료 없음 — 등기부 확인'], ['배분요구 종기', d.distributionDeadline ? ymd(d.distributionDeadline) : null],
        ['인수되는 권리', d.survivingRights || (d.flags ? '자료상 없음' : '자료 없음')], ['법정지상권', d.superficies || (d.flags ? '자료상 없음' : '자료 없음')],
        ['특수 사정', sp ? sp.types.map((t) => `${t.label}(${String(t.evidence).slice(0, 40)})`).join(' · ') : '자료상 없음'],
        ['유의사항', d.cautions || d.specialConditions],
      ]} />
      {(d.leases || []).length > 0 && (
        <T head={['임차인', '보증금', '월세', '전입', '확정일자', '배당요구', '대항력(말소기준 대비)']} rows={d.leases.map((l) => {
          const base = String(d.baseRightDate || '').replace(/\D/g, ''); const mi = String(l.moveIn || '').replace(/\D/g, '');
          return [l.tenant || '—', eok(l.deposit), l.rent ? eok(l.rent) : '', ymd(l.moveIn), ymd(l.fixedDate), l.claimed ? '함' : '안 함', base && mi ? (mi < base ? '먼저 전입 — 인수 가능' : '나중 전입 — 소멸') : '판단 불가'];
        })} />
      )}
      {a.jeonse && <Note>주변 전세 시세 {eok(a.jeonse.value)} ({a.jeonse.basis}) — 보증금이 30% 넘게 높으면 과다·허위, 30% 미만이면 가장 임차인 의심</Note>}

      <H no="3">가치 검토 과정</H>
      {a.anomalies?.length > 0 && <p className="mt-2 rounded bg-hard/5 p-2 text-sm text-hard"><b>오류 의심:</b> {a.anomalies.join(' · ')}</p>}
      {v ? (
        <>
          <T head={['기준', '값', '근거', '반영']} rows={v.anchors.map((x) => [x.label, x.value ? `${eok(x.value)}${x.low && x.high ? ` (${eok(x.low)}~${eok(x.high)})` : ''}` : '—', `${x.basis || ''}${x.stale ? ' · 감정 1년 넘음' : ''}`, x.used && x.value ? '✔ 반영' : `✘ ${x.why || '값 없음'}`])} />
          <p className="mt-2 text-sm"><b>결과:</b> {v.summary}</p>
          {v.auction && <Note>참고 — 경매 시장가: 감정가 × {pct(v.auction.rate)} = {eok(v.auction.value)} ({v.auction.basis}). 시세가 아니라 보통 이 가격대에 낙찰된다는 뜻입니다.</Note>}
        </>
      ) : <p className="mt-2 text-sm">{a.valueBasis}</p>}
      {a.market?.samples?.length > 0 && (
        <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink/70">비교한 실거래 {a.market.count}건 보기</summary>
          <T head={['거래월', '이름·지번', '면적', '층', '연식', '가격', '㎡당']} rows={a.market.samples.map((s) => [s[11] || '', `${s[5] || ''} ${s[4] || ''}`, `${s[1]}㎡`, s[2] ?? '', s[6] ?? '', eok(s[0]), `${Math.round(s[0] / s[1] / 1e4).toLocaleString('ko-KR')}만`])} />
        </details>
      )}

      {sp && (
        <>
          <H no="4">특수물건 — 바닥 가치와 상승 시나리오</H>
          <KV rows={[['하자 없을 때 가치', eok(a.full)], ['바닥 가치(최악)', sp.floorKnown ? `${eok(sp.floor)} — ${sp.types.map((t) => t.floorBasis).join(' × ')}` : '인수 금액 확인 전 계산 불가'], ['기대 가치(가능성 반영)', sp.expected ? eok(sp.expected) : null], ['바닥 이하로 사는 시점', sp.floorEntry ? `${sp.floorEntry.label} (${eok(sp.floorEntry.price)})` : '없음']]} />
          <T head={['시나리오', '가치', '가능성', '기간', '조건']} rows={sp.scenarios.map((x) => [x.name, x.value ? eok(x.value) : x.annual ? `연 ${eok(x.annual)}` : '—', x.prob, x.months ? `${x.months}개월` : '', (x.conditions || []).join(' / ')])} />
        </>
      )}

      <H no={sp ? 5 : 4}>매수상한과 회차</H>
      <KV rows={[
        [sp ? '바닥 가치' : '판단용 가치', eok(a.value)], ['비용', a.costs ? `${eok(a.costs.total)} (취득세 ${pct(a.costs.taxRate)} ${eok(a.costs.tax)} · 명도 ${eok(a.costs.eviction)} · 수리 ${eok(a.costs.repair)})` : null],
        ['매수상한', a.cap ? `${eok(a.value)} × (1 − 마진 ${pct(settings.marginRate ?? 0.1)}) − 비용 = ${eok(a.cap)}` : null],
        ['진입 시점', a.entry ? `${a.entry.label} — ${eok(a.entry.price)}` : '하한까지도 상한 초과'],
      ]} />
      <T head={['회차', '예상 최저가', '상한 이하']} rows={a.rounds.map((r) => [r.label, eok(r.price), a.cap && r.price <= a.cap ? '✔' : ''])} />

      <H no={sp ? 6 : 5}>돈 계산</H>
      {m && !m.upside ? (
        <KV rows={[
          ['입찰가', won(m.price)], ['대출', `${won(m.loan)} (${pct(m.loanRatio)})`], ['취득세', `${won(m.t.acqTax)} — ${m.t.acq.label}`], ['명도·수리', won(m.other)],
          ['내가 넣어야 할 돈', <b key="own">{won(m.own)}</b>], ['매도가(판단용 가치)', won(a.value)], ['이자', `${won(m.interest)} (${pct(m.rate)} · ${m.months}개월)`], ['중개·부가세', `${won(m.t.broker)}${m.t.vat ? ` · 부가세 ${won(m.t.vat)}` : ''}`],
          ['세전 수익', won(m.preTax)], m.owner === 'corp' && ['법인세·추가세', `${won(m.t.incomeTax)}${m.t.surcharge ? ` + ${won(m.t.surcharge)}` : ''}`],
          [m.owner === 'corp' ? '세후 수익' : '예상 수익(양도세 전)', <b key="p">{won(m.profit)}</b>], ['수익률(내 돈 대비)', m.roi === null ? '—' : pct(m.roi)], ['법인 단타', `${m.fit.grade} — ${m.fit.reason}`],
        ]} />
      ) : <p className="mt-2 text-sm">돈 계산을 하지 못했습니다(가치 미확정).</p>}
      {a.upMoney && <Note>상승 시나리오가 성공하면: 수익 {eok(a.upMoney.profit)}, 내 돈 {eok(a.upMoney.own)}, {a.upMoney.months}개월</Note>}
      {a.renovation && <Note>올수리하면: 수리비 {eok(a.renovation.cost)} → 수리 후 {eok(a.renovation.after)}, 수익 {a.renoMoney ? eok(a.renoMoney.profit) : '—'} ({a.renovation.basis})</Note>}

      <H no={sp ? 7 : 6}>정비사업·분양자격</H>
      <KV rows={[['단계', a.member.stage || '해당 없음(자료상)'], ['판정', { none: '정비사업 해당 없음', member: '조합원 가능', cash: '현금청산', check: '확인 필요' }[a.member.status]], ['근거', a.member.reason]]} />

      <H no={sp ? 8 : 7}>판정 근거와 확인할 것</H>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
        {[...a.reasons.map((r) => `제외 사유: ${r}`), ...(a.anomalies || []), ...a.warnings].map((w, i) => <li key={i}>{w}</li>)}
        {sp && sp.checks.map((c) => <li key={c}>☐ {c}</li>)}
        <li>☐ 등기부: 말소기준권리와 그보다 앞선 권리(가처분·가등기·전세권), 대지권 미등기·토지 별도등기</li>
        <li>☐ 전입세대 열람: 대항력 임차인, 실제 점유자</li>
        <li>☐ 현장: 건물 상태·누수·위반건축물, 관리비 체납, 주변 시세(중개사무소)</li>
        <li>☐ 원문: 매각물건명세서·현황조사서·감정평가서</li>
      </ul>

      {(item.forecast || item.result) && (
        <>
          <H no={sp ? 9 : 8}>예측 기록과 결과</H>
          <KV rows={[item.forecast && ['입찰 전 예측', `${item.forecast.at} · ${VERDICT[item.forecast.verdict]?.label || item.forecast.verdict} · 상한 ${eok(item.forecast.cap)}`], item.result && ['결과', `${item.result.status}${item.result.soldPrice ? ` · 낙찰 ${eok(item.result.soldPrice)} (${pct(item.result.rate)})` : ''}${item.result.bidders ? ` · 입찰자 ${item.result.bidders}명` : ''}`]]} />
        </>
      )}

      <p className="mt-6 border-t border-line pt-2 text-xs text-ink/50">이 검토서는 공개 자료로 자동 계산한 참고 자료입니다. 계산 방식은 사이트의 "판단 기준" 화면에 있습니다. 입찰 전 원문과 등기부, 현장을 반드시 확인하세요.</p>
    </div>
  );
}
