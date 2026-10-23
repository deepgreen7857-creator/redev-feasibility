import { listRuleSuggestions, listRecalcReports } from '../lib/store.js';
import { useEffect, useState } from 'react';
import { getSettings, saveSettings, getStatus, callFn, saveListing, signIn, isAdmin, DEMO } from '../lib/store.js';
import { DEFAULT_COURTS, SIDO, RIGHTS77_DEFAULT } from '../data/defaults.js';
import { Card, Field, Row, Badge } from '../components/ui.jsx';
import { parseCourtText } from '../lib/parseCourt.js';
import ZoneUpload from '../components/ZoneUpload.jsx';
import ZoneList from '../components/ZoneList.jsx';

export default function AdminPage({ user }) {
  if (!isAdmin(user)) {
    return (
      <Card title="관리자">
        <p className="mb-3 text-sm text-ink/60">{user ? `${user.email} 계정은 관리자가 아닙니다.` : '관리자 계정으로 로그인하세요.'}</p>
        <button className="btn-primary" onClick={signIn}>{DEMO ? '데모 관리자로 보기' : 'Google 로그인'}</button>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Status />
      <RuleSuggestions />
      <ZoneList />
      <RecalcReport />
      <ZoneUpload />
      <Settings />
      <CourtForm />
    </div>
  );
}

function Status() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState(null);
  const load = () => getStatus().then(setSt).catch((e) => setOut({ error: e.message }));
  useEffect(() => { load(); }, []);
  const run = async (name, data, label) => {
    setBusy(label); setOut(null);
    try { setOut(await callFn(name, data)); } catch (e) { setOut({ error: e.message }); }
    setBusy(''); load();
  };
  const T = { apt: '아파트', rh: '연립다세대', sh: '단독다가구', offi: '오피스텔', land: '토지' };
  return (
    <Card title="수집 현황" right={<button className="btn-ghost" onClick={load}>새로고침</button>}>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1 text-sm font-bold">온비드(공매·파산자산)</div>
          <Row k="마지막 수집" v={st?.state.onbid.lastDay || '—'} />
          <Row k="마지막 전체 수집" v={st?.state.onbid.lastFullDay || '—'} />
        </div>
        <div>
          <div className="mb-1 text-sm font-bold">법원 회생·파산 공고</div>
          <Row k="마지막 수집" v={st?.state.bankrupt.lastDay || '—'} />
          <Row k="마지막 글번호" v={st?.state.bankrupt.maxSeq || '—'} />
          <div className="mb-1 mt-3 text-sm font-bold">인천 정비현황(월간)</div>
          <Row k="마지막 확인" v={st?.state.zones?.lastDay || '—'} />
          <Row k="받은 자료" v={st?.state.zones?.lastResult?.title?.replace('인천광역시 도시정비사업 추진현황', '') || '—'} />
        </div>
        <div>
          <div className="mb-1 text-sm font-bold">실거래가 (남은 작업)</div>
          {Object.entries(T).map(([k, n]) => <Row key={k} k={n} v={st?.progress[k] ? `${st.progress[k].remaining ?? '—'}건 남음` : '시작 전'} />)}
        </div>
      </div>
      {st?.quota?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {st.quota.filter((q) => q.day === st.quota[0].day).map((q) => <Badge key={q.api} tone={q.exhausted ? 'hard' : 'muted'}>{q.api} {q.count}/1000</Badge>)}
        </div>
      )}
      <div className="no-print mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!!busy} onClick={() => run('testApis', {}, 'test')}>{busy === 'test' ? '시험 중…' : 'API 연결 시험'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'onbid' }, 'onbid')}>{busy === 'onbid' ? '수집 중…' : '온비드 지금 수집'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'results' }, 'results')}>{busy === 'results' ? '받는 중…' : '온비드 입찰결과 지금 받기'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'resultList' }, 'resultList')} title="최근 4일 + 과거 1년치를 7일씩 거슬러 받음(하루 한도 안에서)">{busy === 'resultList' ? '받는 중…' : '온비드 과거 입찰결과 받기'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'land' }, 'land')} title="공시지가·토지이용이 없거나 빈 응답이었던 진행 물건을 다시 조회(최대 150건)">{busy === 'land' ? '조회 중…' : '토지이용 빈 값 다시 조회'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'zones' }, 'zones')}>{busy === 'zones' ? '받는 중…' : '인천 정비현황 지금 받기'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'bankrupt' }, 'bankrupt')}>{busy === 'bankrupt' ? '수집 중…' : '파산 공고 지금 수집'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('runNow', { job: 'trades' }, 'trades')}>{busy === 'trades' ? '수집 중…(최대 8분)' : '실거래가 이어 받기'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('seedSettings', {}, 'seed')}>기본 설정 넣기</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('forecastNow', {}, 'forecast')} title="매일 밤 11시 40분에 자동으로 돕니다">입찰 전 예측 지금 기록</button>
      </div>
      {out && (
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-md bg-paper p-3 text-xs">
          {out.results ? out.results.map((r) => (
            <div key={r.name} className="border-b border-line/60 py-1.5 last:border-0">
              <span className={r.ok ? 'text-now' : 'text-hard'}>{r.ok ? '정상' : '실패'}</span> · <b>{r.name}</b>
              {r.ok ? ` — ${r.total ?? ''}${r.sample ? ` · 예: ${typeof r.sample === 'string' ? r.sample.split(' ‖ ')[0] : JSON.stringify(r.sample).slice(0, 120)}` : ''}${r.zone ? ` · ${r.zone}` : ''}` : ` — ${r.message}`}
              {r.ok && r.fields && <DetailFields r={r} />}
            </div>
          )) : <pre className="whitespace-pre-wrap">{JSON.stringify(out, null, 2)}</pre>}
        </div>
      )}
      <p className="mt-3 text-xs text-ink/50">자동 수집: 매일 새벽 0~6시, 20분마다 이어서 받습니다. 한도에 닿으면 다음 날 자동으로 이어 받습니다.</p>
    </Card>
  );
}

// API 연결 시험 — 온비드 상세 원본 응답의 항목 이름·사진/지도 값 모양
function DetailFields({ r }) {
  return (
    <div className="mt-2 space-y-2 rounded border border-line bg-white p-2">
      <div className="text-ink/60">물건 {r.cltrMngNo} / 조건 {r.pbctCdtnNo}</div>
      {r.media && (
        <table className="w-full">
          <thead className="text-left text-ink/50"><tr><th>사진·지도 항목</th><th>형태</th><th>구분자</th><th>예시</th></tr></thead>
          <tbody>{Object.entries(r.media).map(([k, m]) => <tr key={k} className="border-t border-line/50 align-top"><td className="font-mono">{k}</td><td>{m.형태}</td><td>{m.구분자 || '—'}</td><td className="break-all">{m.예시 ? String(m.예시).slice(0, 140) : '—'}</td></tr>)}</tbody>
        </table>
      )}
      {r.shapes && (
        <div><b>목록형 항목</b>: {Object.entries(r.shapes).map(([k, v]) => <div key={k}><span className="font-mono">{k}</span> — {v}</div>)}</div>
      )}
      <div className="break-all"><b>항목 {r.fields.length}개</b>: <span className="font-mono">{r.fields.join(', ')}</span></div>
    </div>
  );
}

function Settings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState('');
  useEffect(() => { getSettings().then(setS); }, []);
  if (!s) return null;
  const save = async () => { await saveSettings(s); setSaved('저장했습니다.'); setTimeout(() => setSaved(''), 2000); };
  const courts = s.courts?.length ? s.courts : DEFAULT_COURTS;
  const setCourt = (i, patch) => setS({ ...s, courts: courts.map((c, j) => (i === j ? { ...c, ...patch } : c)) });
  const ex = s.analysisExclude || [];
  return (
    <Card title="분석 설정" right={<span className="flex items-center gap-2 text-sm text-now">{saved}<button className="btn-primary" onClick={save}>저장</button></span>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="마진율(%)" hint="예상 가치에서 이만큼 빼고 매수상한을 잡습니다"><input className="input num" value={Math.round((s.marginRate ?? 0.1) * 100)} onChange={(e) => setS({ ...s, marginRate: Number(e.target.value) / 100 })} /></Field>
        <Field label="현금청산 비율(%)" hint="예상 청산금 = 감정가 × 이 비율"><input className="input num" value={Math.round((s.settlementRatio ?? 0.9) * 100)} onChange={(e) => setS({ ...s, settlementRatio: Number(e.target.value) / 100 })} /></Field>
        <Field label="실거래 과거 수집 개월" hint="처음 채울 기간(최근 2개월은 매일 갱신)"><input className="input num" value={s.backfillMonths ?? 12} onChange={(e) => setS({ ...s, backfillMonths: Number(e.target.value) || 12 })} /></Field>
        <Field label="명도비 기본(원)"><input className="input num" value={s.evictionCost ?? 3000000} onChange={(e) => setS({ ...s, evictionCost: Number(e.target.value) || 0 })} /></Field>
        <Field label="수리비 기본(원)"><input className="input num" value={s.repairCost ?? 5000000} onChange={(e) => setS({ ...s, repairCost: Number(e.target.value) || 0 })} /></Field>
        <Field label="올수리 평당 비용(원)" hint="전용면적 평당"><input className="input num" value={s.renoPerPyeong ?? 1200000} onChange={(e) => setS({ ...s, renoPerPyeong: Number(e.target.value) || 0 })} /></Field>
        <Field label="올수리 기간(개월)" hint="사서 수리하고 팔기까지"><input className="input num" value={s.renoMonths ?? 5} onChange={(e) => setS({ ...s, renoMonths: Number(e.target.value) || 5 })} /></Field>
        <Field label="수리 후 가격 기준(분위)" hint="0.75 = 같은 동 거래 상위 25%"><input className="input num" value={s.renoQuantile ?? 0.75} onChange={(e) => setS({ ...s, renoQuantile: Number(e.target.value) || 0.75 })} /></Field>
        <Field label="명의" hint="법인이면 취득세 중과·법인세·부가세로 계산">
          <select className="input" value={s.owner || 'corp'} onChange={(e) => setS({ ...s, owner: e.target.value })}><option value="corp">법인 (단기매매)</option><option value="person">개인</option></select>
        </Field>
        <Field label="법인세율(%) — 지방소득세 포함" hint="과세표준 구간에 맞게. 기본 11%(2억 이하 구간 추정)"><input className="input num" value={((s.corpTaxRate ?? 0.11) * 100).toFixed(1)} onChange={(e) => setS({ ...s, corpTaxRate: Number(e.target.value) / 100 })} /></Field>
        <Field label="주택·토지 추가 법인세(%)" hint="토지등 양도소득 추가과세, 기본 22%"><input className="input num" value={((s.surchargeRate ?? 0.22) * 100).toFixed(1)} onChange={(e) => setS({ ...s, surchargeRate: Number(e.target.value) / 100 })} /></Field>
        <Field label="중개수수료(%)"><input className="input num" value={((s.brokerRate ?? 0.005) * 100).toFixed(2)} onChange={(e) => setS({ ...s, brokerRate: Number(e.target.value) / 100 })} /></Field>
        <Field label="건물분 비율(%)" hint="부가세 계산용(상가·85㎡ 초과)"><input className="input num" value={Math.round((s.buildingRatio ?? 0.5) * 100)} onChange={(e) => setS({ ...s, buildingRatio: Number(e.target.value) / 100 })} /></Field>
        <Field label="대출 비율(%) — 주택" hint="입찰가 대비. 필요 자기자본 계산에 씀"><input className="input num" value={Math.round((s.loanRatio ?? 0.6) * 100)} onChange={(e) => setS({ ...s, loanRatio: Number(e.target.value) / 100 })} /></Field>
        <Field label="대출 비율(%) — 토지·농지"><input className="input num" value={Math.round((s.landLoanRatio ?? 0.4) * 100)} onChange={(e) => setS({ ...s, landLoanRatio: Number(e.target.value) / 100 })} /></Field>
        <Field label="대출 비율(%) — 현금청산형"><input className="input num" value={Math.round((s.cashLoanRatio ?? 0.5) * 100)} onChange={(e) => setS({ ...s, cashLoanRatio: Number(e.target.value) / 100 })} /></Field>
        <Field label="대출 금리(%)"><input className="input num" value={((s.interestRate ?? 0.045) * 100).toFixed(1)} onChange={(e) => setS({ ...s, interestRate: Number(e.target.value) / 100 })} /></Field>
        <Field label="브이월드 도메인" hint="인증키에 등록한 서비스 URL과 같게. 'API 연결 시험'의 도메인 후보별 결과를 보고 고르세요"><input className="input" placeholder="https://jbslab.co.kr (기본값)" value={s.vworldDomain || ''} onChange={(e) => setS({ ...s, vworldDomain: e.target.value.trim() })} /></Field>
        <Field label="보유 기간(개월)" hint="이자 계산 기간"><input className="input num" value={s.holdMonths ?? 12} onChange={(e) => setS({ ...s, holdMonths: Number(e.target.value) || 12 })} /></Field>
        <div className="space-y-1.5 pt-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.excludeDirect !== false} onChange={(e) => setS({ ...s, excludeDirect: e.target.checked })} /> 시세에서 직거래 제외</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.collectOnbid !== false} onChange={(e) => setS({ ...s, collectOnbid: e.target.checked })} /> 온비드 자동 수집</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.collectTrades !== false} onChange={(e) => setS({ ...s, collectTrades: e.target.checked })} /> 실거래가 자동 수집</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.collectZones !== false} onChange={(e) => setS({ ...s, collectZones: e.target.checked })} /> 인천 정비현황 자동 수집</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.collectBankrupt !== false} onChange={(e) => setS({ ...s, collectBankrupt: e.target.checked })} /> 파산 공고 자동 수집</label>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-1 text-sm font-bold">관심 제외 지역</div>
        <p className="mb-2 text-xs text-ink/60">수집·목록에는 그대로 두고, 분석 대상(기본 목록)에서만 조용히 뺍니다. "정비구역 물건만"은 토지이용 조회 전 물건도 안전하게 뺍니다.</p>
        {ex.map((r, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <select className="input" value={r.sido} onChange={(e) => setS({ ...s, analysisExclude: ex.map((x, j) => (j === i ? { ...x, sido: e.target.value } : x)) })}>{SIDO.map((x) => <option key={x}>{x}</option>)}</select>
            <input className="input" value={r.sgg} onChange={(e) => setS({ ...s, analysisExclude: ex.map((x, j) => (j === i ? { ...x, sgg: e.target.value } : x)) })} />
            <select className="input" value={r.scope} onChange={(e) => setS({ ...s, analysisExclude: ex.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)) })}>
              <option value="redevelopment">정비구역 물건만</option><option value="all">전체</option>
            </select>
            <button className="btn-danger" onClick={() => setS({ ...s, analysisExclude: ex.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        ))}
        <button className="btn-ghost" onClick={() => setS({ ...s, analysisExclude: [...ex, { sido: '인천광역시', sgg: '', scope: 'redevelopment' }] })}>+ 추가</button>
      </div>

      <div className="mt-5">
        <div className="mb-1 text-sm font-bold">투기과열지구 (분양자격 판정용)</div>
        <p className="mb-2 text-xs text-ink/60">한 줄에 "시도 시군구" 하나. 시도 전체면 "서울특별시 *". 지정·해제 발표가 나면 여기만 고치면 됩니다. (기본값: 2025.10.16 지정 — 서울 전역, 경기 12곳)</p>
        <textarea className="input h-32 font-mono text-xs" value={(s.overheated || []).map((r) => `${r.sido} ${r.sgg}`).join('\n')} onChange={(e) => setS({ ...s, overheated: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [sido, ...rest] = l.split(/\s+/); return { sido, sgg: rest.join(' ') || '*' }; }) })} />
      </div>

      <Rights77Editor s={s} setS={setS} />

      <div className="mt-5">
        <div className="mb-1 text-sm font-bold">법원별 유찰 저감률</div>
        <p className="mb-2 text-xs text-ink/60">확인 전 값은 공고문에서 확인한 뒤 "확인"을 체크하세요. (출처: 서울 20%, 인천·경기 30%, 안양지원 20% — 2022년 기사 기준)</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {courts.map((c, i) => (
            <div key={c.name} className="grid grid-cols-[1fr_84px_60px] items-center gap-2 text-sm">
              <span>{c.name}</span>
              <select className="input py-1" value={c.rate} onChange={(e) => setCourt(i, { rate: Number(e.target.value) })}><option value={0.2}>20%</option><option value={0.3}>30%</option></select>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!c.verified} onChange={(e) => setCourt(i, { verified: e.target.checked })} />확인</label>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// 권리산정기준일 판정 규칙(도시정비법 제77조①) — 법이 바뀌면 여기만 고친다(코드 수정 없이)
const APPLIES = [['all', '모든 물건'], ['building', '건물 있음·토지/건물 따로 매각'], ['collective', '집합건물 호실']];
function Rights77Editor({ s, setS }) {
  const cfg = s.rights77?.rules?.length ? s.rights77 : RIGHTS77_DEFAULT;
  const put = (patch) => setS({ ...s, rights77: { ...cfg, ...patch } });
  const setRule = (i, patch) => put({ rules: cfg.rules.map((r, j) => (i === j ? { ...r, ...patch } : r)) });
  return (
    <div className="mt-5">
      <div className="mb-1 text-sm font-bold">권리산정기준일 판정 규칙 ({cfg.law})</div>
      <p className="mb-2 text-xs text-ink/60">기준일 '다음 날' 이후 아래 사유가 생기면 분양권 제한(현금청산 위험). 비교 날짜 이름(splitDate 등)은 물건 상세에서 넣는 날짜 칸과 이어집니다(useAprDate는 건축물대장 사용승인일 자동). 법 개정 때 사유를 고치거나 더하세요.</p>
      <Field label="근거 법조문"><input className="input" value={cfg.law} onChange={(e) => put({ law: e.target.value })} /></Field>
      {cfg.rules.map((r, i) => (
        <div key={i} className="mt-1.5 grid grid-cols-[3rem_1fr_9rem_8rem_10rem_auto] gap-1.5 text-xs">
          <input className="input py-1" value={r.ho} onChange={(e) => setRule(i, { ho: Number(e.target.value) || e.target.value })} title="호" />
          <input className="input py-1" value={r.text} onChange={(e) => setRule(i, { text: e.target.value })} title="사유" />
          <input className="input py-1" value={r.dateLabel} onChange={(e) => setRule(i, { dateLabel: e.target.value })} title="비교 날짜 이름(화면)" />
          <input className="input py-1 font-mono" value={r.date} onChange={(e) => setRule(i, { date: e.target.value })} title="비교 날짜 칸(영문)" />
          <select className="input py-1" value={r.applies} onChange={(e) => setRule(i, { applies: e.target.value })}>{APPLIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="btn-danger py-1" onClick={() => put({ rules: cfg.rules.filter((_, j) => j !== i) })}>삭제</button>
        </div>
      ))}
      <div className="mt-1.5 flex gap-2">
        <button className="btn-ghost" onClick={() => put({ rules: [...cfg.rules, { ho: cfg.rules.length + 1, text: '', date: `ho${cfg.rules.length + 1}Date`, dateLabel: '', applies: 'all' }] })}>+ 사유 추가</button>
        <button className="btn-ghost" onClick={() => setS({ ...s, rights77: { ...RIGHTS77_DEFAULT, ordinance: { ...RIGHTS77_DEFAULT.ordinance, ...(cfg.ordinance || {}) } } })}>사유를 기본값(현행 1~5호)으로</button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {SIDO.map((sido) => (
          <Field key={sido} label={`${sido} 조례 기준 메모`} hint="분양 대상·면적 기준 등(판정 화면에 표시)">
            <textarea className="input h-20 text-xs" value={cfg.ordinance?.[sido] || ''} onChange={(e) => put({ ordinance: { ...(cfg.ordinance || {}), [sido]: e.target.value } })} />
          </Field>
        ))}
      </div>
    </div>
  );
}

const EMPTY = { court: '인천지방법원', caseNo: '', title: '', address: '', sido: '인천광역시', sgg: '', emd: '', usage: '', appraisal: '', minBid: '', failCount: '0', round: '1', bidEnd: '', landArea: '', buildingArea: '', pnu: '', url: '' };

function CourtForm() {
  const [v, setV] = useState(EMPTY);
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async () => {
    if (!v.caseNo || !v.minBid) { setMsg('사건번호와 최저가는 꼭 넣어 주세요.'); return; }
    const id = `court_${v.court.replace(/\s/g, '')}_${v.caseNo.replace(/\s/g, '')}`;
    const num = (x) => (x === '' ? null : Number(String(x).replace(/,/g, '')));
    await saveListing({
      ...v, id, source: 'court', category: 'court', title: v.title || `${v.address.split(' ').slice(1, 4).join(' ')} ${v.usage}`.trim(),
      appraisal: num(v.appraisal), minBid: num(v.minBid), failCount: num(v.failCount), landArea: num(v.landArea), buildingArea: num(v.buildingArea),
      status: '진행', url: v.url || 'https://www.courtauction.go.kr', firstSeenAt: new Date().toISOString(),
    });
    setMsg(`등록했습니다: ${v.caseNo}`); setV(EMPTY); setPaste('');
  };
  return (
    <Card title="법원경매 물건 등록" right={<span className="text-sm text-now">{msg}</span>}>
      <p className="mb-2 text-xs text-ink/60">대법원 경매는 공개 API가 없어 한 건씩 넣습니다. 법원경매정보 물건 화면의 글자를 통째로 복사해 붙여 넣으면 알아서 채웁니다.</p>
      <textarea className="input h-24" placeholder="여기에 붙여넣기" value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button className="btn-ghost mt-2" onClick={() => setV({ ...v, ...parseCourtText(paste) })}>붙여넣은 내용으로 채우기</button>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="법원"><input className="input" value={v.court} onChange={set('court')} /></Field>
        <Field label="사건번호"><input className="input" value={v.caseNo} onChange={set('caseNo')} placeholder="2026타경1234" /></Field>
        <Field label="용도"><input className="input" value={v.usage} onChange={set('usage')} placeholder="아파트·다세대·답…" /></Field>
        <Field label="매각기일"><input className="input" type="date" value={v.bidEnd} onChange={set('bidEnd')} /></Field>
        <Field label="주소"><input className="input" value={v.address} onChange={set('address')} /></Field>
        <Field label="시도"><select className="input" value={v.sido} onChange={set('sido')}>{SIDO.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="시군구"><input className="input" value={v.sgg} onChange={set('sgg')} /></Field>
        <Field label="읍면동"><input className="input" value={v.emd} onChange={set('emd')} /></Field>
        <Field label="감정가(원)"><input className="input num" value={v.appraisal} onChange={set('appraisal')} /></Field>
        <Field label="최저가(원)"><input className="input num" value={v.minBid} onChange={set('minBid')} /></Field>
        <Field label="유찰 횟수"><input className="input num" value={v.failCount} onChange={set('failCount')} /></Field>
        <Field label="필지번호(PNU, 선택)"><input className="input num" value={v.pnu} onChange={set('pnu')} /></Field>
        <Field label="토지면적(㎡)"><input className="input num" value={v.landArea} onChange={set('landArea')} /></Field>
        <Field label="건물/전용면적(㎡)"><input className="input num" value={v.buildingArea} onChange={set('buildingArea')} /></Field>
        <Field label="제목(선택)"><input className="input" value={v.title} onChange={set('title')} /></Field>
        <Field label="원문 주소(선택)"><input className="input" value={v.url} onChange={set('url')} /></Field>
      </div>
      <button className="btn-primary mt-3" onClick={submit}>등록</button>
    </Card>
  );
}

// 분석기 재계산(수정 후 참고값) — 기록된 예측은 보존, 크게 달라진 물건·새로 연결된 정비구역 목록
const VL = { now: '지금 매력', wait: '유찰 대기', check: '권리 확인', suspect: '오류 의심', shareUnknown: '지분비율 미확인', hard: '가격 안 맞음', unknown: '시세 부족' };
function RecalcReport() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => listRecalcReports().then(setRows).catch((e) => { setRows([]); setMsg(e.message); });
  useEffect(() => { load(); }, []);
  const run = async (reset) => {
    setBusy(true); setMsg('');
    try { const r = await callFn('recalcNow', { reset }); setMsg(r.partial ? '시간이 모자라 중간에 멈췄습니다 — 한 번 더 누르면 이어서 합니다.' : '재계산을 마쳤습니다.'); } catch (e) { setMsg(e.message); }
    setBusy(false); load();
  };
  const r = rows?.[0];
  const won = (v) => (v === null || v === undefined ? '없음' : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);
  return (
    <Card title="분석기 재계산 (수정 후 참고값)" right={<span className="flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => run(false)}>{busy ? '계산 중…(최대 9분)' : r && !r.done ? '이어서 재계산' : '전체 재계산'}</button><button className="btn-ghost" disabled={busy} onClick={() => run(true)}>처음부터</button></span>}>
      <p className="mb-2 text-xs text-ink/60">계산식을 고친 뒤 기존 물건 전체를 지금 분석기로 다시 계산해 <b>수정 후 참고값</b>(forecastRevised)에만 넣습니다. 입찰 전 기록(forecast·이전 회차 기록)은 그대로이고 완료 물건 채점도 기록된 값 그대로입니다.</p>
      {msg && <p className="mb-2 text-sm text-brand">{msg}</p>}
      {!r ? <p className="text-sm text-ink/50">{rows ? '아직 재계산하지 않았습니다.' : '불러오는 중…'}</p> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge tone={r.done ? 'now' : 'wait'}>{r.analyzerVersion} · {r.done ? '완료' : `진행 중(${r.phase})`}</Badge>
            <Badge>계산 {r.counts?.processed ?? 0}건</Badge><Badge>참고값 저장 {r.counts?.written ?? 0}</Badge><Badge>이미 최신 {r.counts?.current ?? 0}</Badge><Badge>기록 없음 {r.counts?.noBaseline ?? 0}</Badge>
            <Badge tone="hard">크게 달라짐 {r.counts?.bigChanges ?? 0}</Badge><Badge tone="brand">정비구역 새로 연결 {r.counts?.newZoneLinks ?? 0}</Badge><Badge tone="hard">계산 이상 {r.counts?.calcAnomaly ?? 0}</Badge>{r.counts?.errors > 0 && <Badge tone="hard">오류 {r.counts.errors}</Badge>}
          </div>
          <div className="text-xs text-ink/70">지분 물건 {r.share?.total ?? 0}건 중 지분비율 미확인 <b>{r.share?.unknown ?? 0}</b>건 · 읽은 곳: {Object.entries(r.share?.bySource || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}</div>
          <div className="text-xs text-ink/70">감정가 없는 물건 {r.noAppraisal?.total ?? 0}건 · 추정 기준: {Object.entries(r.noAppraisal?.by || {}).map(([k, v]) => `${{ none: '추정 못 함', official: '공시지가', trade: '실거래', jeonse: '전세', asking: '호가' }[k] || k} ${v}`).join(', ') || '—'}</div>
          <div>
            <div className="mb-1 font-bold">수정 전/후 크게 달라진 물건 ({r.bigChanges?.length ?? 0})</div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-ink/50"><tr><th>물건</th><th>수정 전(기록)</th><th>수정 후(참고)</th><th>무엇이</th></tr></thead>
                <tbody>{(r.bigChanges || []).map((x) => (
                  <tr key={x.id} className="border-t border-line/50 align-top">
                    <td><a className="text-brand underline" href={`#/item/${encodeURIComponent(x.id)}`}>{x.title?.slice(0, 30) || x.id}</a></td>
                    <td>{VL[x.before.verdict] || x.before.verdict} · {won(x.before.value)} · 상한 {won(x.before.cap)}<div className="text-ink/40">{x.before.version}</div></td>
                    <td>{VL[x.after.verdict] || x.after.verdict} · {won(x.after.value)} · 상한 {won(x.after.cap)}</td>
                    <td>{(x.why || []).join(' · ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="mb-1 font-bold">정비구역이 새로 연결된 물건 ({r.newZoneLinks?.length ?? 0})</div>
            <ul className="max-h-60 overflow-auto text-xs">{(r.newZoneLinks || []).map((x) => <li key={x.id} className="border-b border-line/50 py-0.5"><a className="text-brand underline" href={`#/item/${encodeURIComponent(x.id)}`}>{x.title?.slice(0, 30) || x.id}</a> → <b>{x.zone}</b> · {x.stage} ({x.by} 일치, 전: {x.before}){x.rights ? ` · 권리산정 ${x.rights}` : ''}</li>)}</ul>
          </div>
        </div>
      )}
    </Card>
  );
}

// Claude 검토가 모아 둔 규칙 수정 제안 — 같은 제안이 여러 물건에서 나오면 규칙을 고칠 때
function RuleSuggestions() {
  const [rows, setRows] = useState(null);
  useEffect(() => { listRuleSuggestions().then(setRows).catch(() => setRows([])); }, []);
  if (!rows || !rows.length) return null;
  const flat = rows.flatMap((r) => (r.items || []).map((x) => ({ ...x, title: r.title, at: r.at, listingId: r.listingId })));
  const byStep = flat.reduce((m, x) => { (m[x.step] ||= []).push(x); return m; }, {});
  return (
    <Card title={`Claude 검토의 규칙 수정 제안 (${flat.length}건)`}>
      <p className="mb-2 text-xs text-ink/60">단계별로 모았습니다. 같은 취지가 여러 번 나오면 그 규칙을 고칠 때입니다. 대화창에서 "규칙 수정 제안 반영해 줘"라고 하시면 됩니다.</p>
      {Object.entries(byStep).map(([step, xs]) => (
        <div key={step} className="mb-2 text-sm"><b>{step}</b> ({xs.length})
          <ul className="list-disc pl-5 text-xs">{xs.slice(0, 8).map((x, i) => <li key={i}>{x.rule} — {x.why} <a className="text-brand underline" href={`#/report/${encodeURIComponent(x.listingId)}`}>{x.title?.slice(0, 20)}</a></li>)}</ul>
        </div>
      ))}
    </Card>
  );
}
