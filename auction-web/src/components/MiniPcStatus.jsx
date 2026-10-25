// 미니PC 수집기 상태판 — 휴대폰으로 관리자 화면만 열면 이상 유무를 볼 수 있게
import { useEffect, useState } from 'react';
import { getMiniPcStatus } from '../lib/store.js';
import { Card, Badge, Row } from './ui.jsx';

const ago = (iso) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 ${m % 60}분 전` : `${Math.floor(m / 1440)}일 전`;
};
const mins = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity);
const hourKst = () => new Date(Date.now() + 9 * 3600e3).getUTCHours();
const time = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STOP = { login: '마이옥션 로그인 풀림', errors: '오류가 잦아 멈춤', error: '오류로 멈춤', limit: '오늘 한도 채움', hours: '시간대 끝', upload: '서버 전송 실패로 멈춤', blocked: '차단 감지', 'test-limit': '시험 실행' };

// 법원경매: 01~06, 09~14, 17~22시에 돎. 도는 시간인데 1시간 넘게 전송이 없으면 확인 필요
function courtVerdict(c) {
  const h = hourKst();
  const on = [[1, 6], [9, 14], [17, 22]].some(([a, b]) => h >= a && h < b);
  if (['blocked', 'upload', 'error'].includes(c.stoppedBy)) return { tone: 'hard', text: `확인 필요 — ${STOP[c.stoppedBy]}` };
  if (!c.lastRun) return { tone: 'hard', text: '기록 없음' };
  if (on && mins(c.lastRun) > 60) return { tone: 'hard', text: '확인 필요 — 도는 시간인데 1시간 넘게 전송 없음' };
  if (!on && mins(c.lastRun) > 8 * 60) return { tone: 'wait', text: '쉬는 시간 — 다음 구간에 다시 확인' };
  return { tone: 'now', text: on ? '정상 — 도는 중' : '정상 — 쉬는 시간' };
}
// 등기부: 08~23시, 하루 120건. 물건 사이 1~2분 + 15건마다 최대 15분 쉼 → 도는 시간에 30분 넘게 저장이 없으면 확인 필요
function regVerdict(r, today, last) {
  const h = hourKst();
  const on = h >= 8 && h < 23;
  if (r.stoppedBy === 'login' && r.lastDay && mins(r.lastRun) < 24 * 60) return { tone: 'hard', text: '확인 필요 — 마이옥션 로그인 풀림 (미니PC에서 npm run myauction-login)' };
  if (['errors', 'error'].includes(r.stoppedBy) && mins(r.lastRun) < 24 * 60) return { tone: 'hard', text: `확인 필요 — ${STOP[r.stoppedBy]}` };
  // 오늘 한도로 멈춤: 기록 날짜(lastDay)가 비어 있거나 달라도, 마지막 실행이 오늘(한국 시각)이면 정상으로 본다
  //  (10-25: 저장 118건·'오늘 한도 채움'인데 lastDay가 안 맞아 '30분 넘게 저장 없음'으로 빨갛게 뜨던 문제 — 120건 중 2건은 받을 문서 없음 등으로 저장 안 됨)
  const kstDay = (t) => new Date(new Date(t).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const todayKst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (today >= 120 || (r.stoppedBy === 'limit' && (r.lastDay === todayKst || (r.lastRun && kstDay(r.lastRun) === todayKst)))) return { tone: 'now', text: '정상 — 오늘 한도(120건) 채움' };
  if (!today && r.targets === 0 && mins(r.lastRun) < 12 * 60) return { tone: 'now', text: '정상 — 받을 물건 없음(모두 받음)' };
  if (on && h >= 9 && !today) return { tone: 'hard', text: '확인 필요 — 08시에 시작했어야 하는데 오늘 저장 0건' };
  if (on && last && mins(last.at) > 30) return { tone: 'hard', text: '확인 필요 — 30분 넘게 저장 없음' };
  return { tone: 'now', text: on ? '정상 — 도는 중' : '정상 — 쉬는 시간(08시 시작)' };
}

export default function MiniPcStatus() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const load = () => { setErr(''); getMiniPcStatus().then(setS).catch((e) => setErr(e.message)); };
  useEffect(() => { load(); }, []);
  const c = s?.court || {}; const r = s?.registry || {};
  const cv = s && courtVerdict(c); const rv = s && regVerdict(r, s.regToday || 0, s.regLast);
  return (
    <Card title="미니PC 수집기 상태" right={<button className="btn-ghost" onClick={load}>새로고침</button>}>
      {err && <div className="mb-2 text-sm text-hard">{err}</div>}
      {!s ? <div className="text-sm text-ink/50">불러오는 중…</div> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-bold">법원경매 수집 <Badge tone={cv.tone} className="whitespace-normal">{cv.text}</Badge></div>
            <Row k="마지막 전송" v={c.lastRun ? `${time(c.lastRun)} (${ago(c.lastRun)})` : '—'} />
            <Row k="이번 회차" v={c.listed != null ? `목록 ${c.listed} · 상세 ${c.detailed} · 전송 ${c.uploaded}` : '—'} />
            {c.files && <Row k="첨부" v={`원본 저장 ${c.files.saved ?? 0} · 같은 문서 재사용 ${c.files.sharedReuse ?? 0} · 사이트 올림 ${c.files.uploaded ?? 0}${c.files.failed ? ` · 올리기 실패 ${c.files.failed}` : ''}${c.attachErrors ? ` · 첨부 오류 ${c.attachErrors}` : ''}`} />}
            {c.lastError && <div className="mt-1 break-all rounded bg-hard/10 px-2 py-1 text-xs text-hard">마지막 오류: {c.lastError}</div>}
            <div className="mt-1 text-xs text-ink/50">01~06 · 09~14 · 17~22시에 돎</div>
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-bold">등기부 열람본 <Badge tone={rv.tone} className="whitespace-normal">{rv.text}</Badge></div>
            <Row k="오늘 저장" v={s.regToday == null ? '—' : `${s.regToday}건 / 120`} />
            <Row k="마지막 저장" v={s.regLast ? `${time(s.regLast.at)} (${ago(s.regLast.at)}) ${s.regLast.caseNo || ''}` : '—'} />
            <Row k="마지막 회차 끝" v={r.lastRun ? `${time(r.lastRun)} · ${STOP[r.stoppedBy] || (r.stoppedBy ? r.stoppedBy : '정상 종료')} · 저장 ${r.saved ?? 0} · 없음 ${r.missed ?? 0} · 오류 ${r.errors ?? 0}` : '—'} />
            <div className="mt-1 text-xs text-ink/50">08~23시, 물건 사이 1~2분</div>
          </div>
        </div>
      )}
    </Card>
  );
}
