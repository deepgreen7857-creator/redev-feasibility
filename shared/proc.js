/* 정비구역 지정 절차 서류(2026-11-08, 인계 남은 일 2 — 주민설명회 통보문·공람 공고문·구의회 의견청취·도시계획위원회 상정 자료·단계별 법정 기간 일정표)
   근거(2026-11-08 law.go.kr 원문 대조):
   - 도시 및 주거환경정비법(법률 제21447호, 2026. 7. 1. 시행) 제8조⑤(구청장 입안 → 광역시장에게 지정 신청, 지방의회 의견 첨부)·
     제15조①(서면 통보 후 주민설명회 + 30일 이상 공람, 타당한 의견 반영)·②(공람과 함께 지방의회 의견, 통지일부터 60일, 넘으면 이의 없음)·③(경미한 변경 생략)·
     ④(정비기반시설·국공유재산 귀속·처분 포함 시 관리청 의견)·제16조①(지방도시계획위원회 심의)·②(공보 고시, 지형도면은 토지이용규제 기본법 제8조)·③(국토교통부장관 보고, 일반인 열람)
   - 같은 법 시행령(대통령령 제36424호, 2026. 7. 1. 시행) 제13조①(공람 요지·장소 공보등 공고, 관계 서류 비치)·②(공람기간 안 서면·전자문서 의견)·③(채택하지 않으면 사유 통지)·④(경미한 변경)
   - 같은 법 시행규칙(국토교통부령 제1561호) 제4조(보고 내용: 도시·군계획·기본계획 주요 내용, 정비계획 요약, 도시·군관리계획 결정조서)
   - 국토의 계획 및 이용에 관한 법률 제30조①(관계 행정기관 협의 — 30일 안 의견)·③(지구단위계획은 건축위원회·도시계획위원회 공동 심의)
   - 인천광역시 도시 및 주거환경정비 조례(제7686호, 2025. 12. 31.) — 설명회·공람에 따로 더한 절차 없음(제10조는 경미한 변경 범위)
   - 기간 계산: 민법 제157조(초일 불산입 — 오전 0시부터 시작하면 산입)·제161조(말일이 토요일·공휴일이면 다음 날 만료). 공휴일은 토·일만 봄(나머지는 화면에서 고침)
   순수 계산 — 브라우저(window.JbsProc)와 node(require) 둘 다. 화면은 proc/proc.js */
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const IN = '(입력)';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 0) => (n == null || n === '' || !isFinite(+n) ? '' : (+n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const need = s => `<span class="need">${esc(s || IN)}</span>`;
  const v = (x, ph) => (x == null || x === '' ? need(ph) : esc(x));

  /* ---------- 날짜 ---------- */
  const parse = s => { if (!s) return null; if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate()); const m = String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const add = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const WD = '일월화수목금토';
  const ds = d => (d ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.(${WD[d.getDay()]})` : '');
  const iso = d => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
  const offDay = (d, hol) => d.getDay() === 0 || d.getDay() === 6 || (hol || []).includes(iso(d));
  const roll = (d, hol) => { let x = d; while (offDay(x, hol)) x = add(x, 1); return x; };   // 민법 제161조
  const diff = (a, b) => Math.round((b - a) / 864e5);

  /* ---------- 일정표 ----------
     m: { notice(서면 통보일), open(공람 시작일 = 공고일), days(공람 일수, 30 이상), brief(설명회 날), councilDate(의회 통지일), consult(관계기관 협의 요청일),
          review(의견 검토 일수, 가정 14), apply(지정 신청일 — 비면 계산), committee(위원회 날 — 비면 신청 + 가정 30), gosi(고시일 — 비면 위원회 + 가정 30), hol[] } */
  const ASSUME = { review: 14, toCommittee: 30, toGosi: 30, consultDays: 30, councilDays: 60, briefAfter: 7, noticeBefore: 7 };
  function schedule(m) {
    m = m || {}; const hol = m.hol || [], A = Object.assign({}, ASSUME, m.assume || {});
    const open = parse(m.open), days = Math.max(30, +m.days || 30);
    if (!open) return { ok: false, rows: [], msg: '공람 시작일(공고일)을 넣으면 일정이 계산됩니다.' };
    const notice = parse(m.notice) || roll(add(open, -A.noticeBefore), hol);   // 서면 통보 → 설명회·공람(제15조① '통보한 후')
    const close = add(open, days - 1);   // 시작일 오전 0시부터 → 초일 산입(민법 제157조 단서)
    const brief = parse(m.brief) || roll(add(open, A.briefAfter), hol);
    const council = parse(m.councilDate) || open, councilEnd = roll(add(council, A.councilDays), hol);   // 통지일부터 60일(초일 불산입)
    const consult = parse(m.consult) || open, consultEnd = roll(add(consult, A.consultDays), hol);
    const reviewEnd = roll(add(close, A.review), hol);
    const applyMin = [reviewEnd, councilEnd, consultEnd].reduce((a, b) => (b > a ? b : a));
    const apply = parse(m.apply) || applyMin;
    const committee = parse(m.committee) || roll(add(apply, A.toCommittee), hol);
    const gosi = parse(m.gosi) || roll(add(committee, A.toGosi), hol);
    const W = [];
    if (notice >= open) W.push('서면 통보일이 공람 시작일보다 늦습니다 — 법 제15조①은 서면으로 통보한 후 설명회·공람을 합니다.');
    if (brief < open || brief > close) W.push('주민설명회가 공람 기간 밖입니다 — 공람 중 의견을 낼 수 있도록 공람 기간 안에 여는 것이 일반적입니다.');
    if (+m.days && +m.days < 30) W.push('공람은 30일 이상이어야 합니다(법 제15조①).');
    if (apply < applyMin) W.push(`지정 신청일이 의견 검토·구의회 의견 기한·관계기관 협의 기한(${ds(applyMin)})보다 빠릅니다 — 구의회 의견을 첨부해야 합니다(법 제8조⑤).`);
    if (committee <= apply) W.push('도시계획위원회 날이 지정 신청일보다 빠르거나 같습니다.');
    if (gosi <= committee) W.push('고시일이 위원회 날보다 빠르거나 같습니다.');
    const R = (step, base, rule, d1, d2, note) => ({ step, base, rule, from: d1, to: d2 || null, note: note || '' });
    const rows = [
      R('주민 서면 통보', '법 제15조①', '설명회·공람 전 토지등소유자 등 주민에게 서면 통보', notice, null, m.notice ? '' : `공람 ${A.noticeBefore}일 전(가정)`),
      R('주민공람 공고', '영 제13조①', '공람 요지·장소를 공보등에 공고, 공람 장소에 관계 서류 비치', open, null, ''),
      R('주민공람', '법 제15조①', `30일 이상(이 일정 ${days}일)`, open, close, '공람 기간 안 서면·전자문서 의견 제출(영 제13조②)'),
      R('주민설명회', '법 제15조①', '공람 기간 중 개최(일반적)', brief, null, m.brief ? '' : `공람 시작 ${A.briefAfter}일 뒤(가정)`),
      R('구의회 의견청취', '법 제15조②', '공람과 함께 통지, 통지일부터 60일 안 의견(넘으면 이의 없음)', council, councilEnd, '말일이 토·공휴일이면 다음 날(민법 제161조)'),
      R('관계기관·관리청 협의', '법 제15조④, 국토계획법 제30조①', '정비기반시설·국공유재산 관리청 의견, 관계 행정기관 30일 안 의견', consult, consultEnd, ''),
      R('주민의견 검토·회신', '영 제13조③', '채택하지 않은 의견은 제출 주민에게 사유 통지', add(close, 1), reviewEnd, `공람 끝 뒤 ${A.review}일(가정)`),
      R('정비구역 지정 신청(구 → 시)', '법 제8조⑤', '정비계획(안)·구의회 의견 첨부', apply, null, m.apply ? '' : '위 세 기한 중 가장 늦은 날(가장 이른 신청일)'),
      R('지방도시계획위원회 심의', '법 제16조①, 국토계획법 제30조③', '지구단위계획 포함 시 건축위원회 공동 심의', committee, null, m.committee ? '' : `신청 ${A.toCommittee}일 뒤(가정 — 위원회 개최 일정 확인)`),
      R('정비구역 지정·고시', '법 제16조②, 토지이용규제 기본법 제8조', '공보 고시 + 지형도면 고시', gosi, null, m.gosi ? '' : `심의 ${A.toGosi}일 뒤(가정)`),
      R('국토교통부장관 보고·열람', '법 제16조③, 시행규칙 제4조', '정비계획 요약·도시·군관리계획 결정조서 등 보고, 관계 서류 일반인 열람', gosi, null, ''),
    ];
    return { ok: true, rows, notice, open, close, days, brief, council, councilEnd, consult, consultEnd, reviewEnd, applyMin, apply, committee, gosi, total: diff(notice, gosi), warn: W, A };
  }

  /* ---------- 문서 ---------- */
  // site: 공통 구역 · m: 입력(일정 + 조직 정보) · D: JbsDecision · FE: JbsFeas(없어도 됨)
  // m 조직: { proposer(입안권자 — ○○구청장), council(○○구의회), designator(지정권자 — 인천광역시장), dept(담당 부서), tel, place(공람 장소), briefPlace, name, loc, gosiNo(구 공고 번호), docNo(공문 번호) }
  function docs(site, m, D, FE) {
    m = m || {}; const S = schedule(m);
    const B = D ? D.build(site, { name: m.name, location: m.loc || IN, feas: FE, assume: FE && FE.get ? FE.get() : null }) : null;
    const F = B ? B.F : { fullName: m.name || site.name || '정비사업', zoneA: 0, ch: null };
    const T = id => (B ? B.parts.flatMap(p => p.tables).find(t => t.id === id) : null);
    const gu = (String(m.loc || '').match(/([가-힣]+구)(?=\s|$)/) || [])[1] || '';
    const proposer = m.proposer || (gu ? `${gu}청장` : ''), council = m.council || (gu ? `${gu}의회` : ''), designator = m.designator || '인천광역시장';
    const nm = F.fullName, zoneName = nm.replace(/(주택재개발|주택재건축|가로주택)?정비사업$/, '').trim() + ' 정비구역';
    const lu = T('landuse'), ch = F.ch || null;
    const tbl = (cols, rows) => `<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c === IN ? need() : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const luTbl = lu ? tbl(lu.cols.map(c => (Array.isArray(c) ? c[0] : c)), lu.rows) : `<p>${need('토지이용계획')}</p>`;
    const plan = [['정비사업 명칭', nm], ['위치', m.loc || IN], ['구역 면적', F.zoneA ? `${fmt(F.zoneA, 1)}㎡` : IN],
      ['건축계획', ch ? `공동주택 ${fmt(ch.units)}세대, 용적률 ${fmt(ch.far, 1)}% 이하, 최고 ${fmt(ch.maxFloors)}층 이하` : IN],
      ['분담금 추산', '토지등소유자 유형별 분담금 추산액 및 산출근거는 공람 서류에 포함(법 제9조①2의2)']];
    const planTbl = tbl(['구분', '내용'], plan);
    const d = x => (x ? ds(x) : need('날짜'));
    const contact = `${v(m.dept, '담당 부서')} (☎ ${v(m.tel, '전화')})`;
    const out = [];
    // 1 일정표
    out.push({ id: 'sched', title: '정비구역 지정 절차 일정표', html: `<h1>${esc(zoneName)} 지정 절차 일정표</h1>`
      + (S.ok ? tbl(['단계', '근거', '법정 기준', '예정일(시작)', '끝(기한)', '비고'], S.rows.map(r => [r.step, r.base, r.rule, ds(r.from), r.to ? ds(r.to) : '', r.note]))
        + `<p class="tnote">※ 서면 통보부터 고시까지 약 ${fmt(S.total)}일(${(S.total / 30.4).toFixed(1)}개월). '가정'이 붙은 소요일은 실무 어림이며 위원회 개최 일정·보완 요구로 늘어날 수 있습니다. 공휴일은 토·일만 반영했습니다.</p>`
        + (S.warn.length ? `<div class="warnbox"><b>확인할 것</b><ul>${S.warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '')
        : `<p>${need(S.msg)}</p>`) });
    // 2 주민 서면 통보문(설명회 + 공람 안내)
    out.push({ id: 'notice', title: '주민 서면 통보문(설명회·공람 안내)', html: `<h1>${esc(zoneName)} 정비계획(안) 주민설명회 개최 및 주민공람 안내</h1>`
      + `<p class="to">수신: ${esc(zoneName)} 안 토지등소유자 및 세입자 등 주민 여러분</p>`
      + `<p>「도시 및 주거환경정비법」 제15조제1항에 따라 ${esc(zoneName)} 지정 및 정비계획(안)을 입안하고자 주민 여러분께 알려 드리며, 아래와 같이 주민설명회를 열고 주민공람을 실시하오니 의견이 있으신 분은 공람 기간 안에 의견을 제출하여 주시기 바랍니다.</p>`
      + `<h2>1. 정비계획(안) 개요</h2>${planTbl}<h3>토지이용계획</h3>${luTbl}`
      + `<h2>2. 주민설명회</h2>${tbl(['구분', '내용'], [['일시', S.ok ? ds(S.brief) + ' ' + (m.briefTime || '19:00') : IN], ['장소', m.briefPlace || IN], ['내용', '정비계획(안) 설명, 분담금 추산액 안내, 질의응답']])}`
      + `<h2>3. 주민공람</h2>${tbl(['구분', '내용'], [['공람 기간', S.ok ? `${ds(S.open)} ~ ${ds(S.close)} (${S.days}일간)` : IN], ['공람 장소', m.place || IN], ['공람 서류', '정비계획(안)·정비구역 지정 도면·분담금 추산액 및 산출근거 등']])}`
      + `<h2>4. 의견 제출</h2><p>공람 기간 안에 서면(전자문서 포함)으로 ${esc(proposer || '입안권자')}에게 제출하십시오(같은 법 시행령 제13조제2항). 제출된 의견은 검토하여 타당한 의견은 정비계획에 반영하며, 반영하지 않은 의견은 제출하신 분께 그 사유를 알려 드립니다(같은 조 제3항).</p>`
      + `<p class="sign">${S.ok ? ds(S.notice) : need('통보일')}<br><b>${v(proposer, '○○구청장')}</b></p><p class="tnote">문의: ${contact}</p>` });
    // 3 공람 공고문
    out.push({ id: 'gongram', title: '주민공람 공고문', html: `<p class="gosi">${v(gu ? gu + ' 공고' : '', '○○구 공고')} 제${v(m.gosiNo, '　　　　')}호</p><h1>${esc(zoneName)} 지정 및 정비계획(안) 주민공람 공고</h1>`
      + `<p>「도시 및 주거환경정비법」 제15조제1항 및 같은 법 시행령 제13조제1항에 따라 ${esc(zoneName)} 지정 및 정비계획(안)에 대하여 주민의 의견을 듣고자 다음과 같이 공고합니다.</p>`
      + `<p class="sign">${S.ok ? ds(S.open) : need('공고일')}<br><b>${v(proposer, '○○구청장')}</b></p>`
      + `<h2>1. 정비계획(안)의 요지</h2>${planTbl}<h3>토지이용계획</h3>${luTbl}`
      + `<h2>2. 공람 기간 및 장소</h2>${tbl(['구분', '내용'], [['공람 기간', S.ok ? `${ds(S.open)} ~ ${ds(S.close)} (${S.days}일간)` : IN], ['공람 장소', m.place || IN]])}`
      + `<h2>3. 의견 제출</h2><p>이 정비계획(안)에 의견이 있는 주민은 공람 기간 안에 서면(전자문서 포함)으로 ${esc(proposer || '입안권자')}(${contact})에게 제출할 수 있습니다.</p>`
      + `<h2>4. 주민설명회</h2><p>${S.ok ? ds(S.brief) + ' ' + esc(m.briefTime || '19:00') : need('일시')}, ${v(m.briefPlace, '장소')}</p>`
      + `<h2>5. 기타</h2><p>관계 서류는 공람 장소에 갖추어 두었습니다. 이 공고에 표시된 내용은 주민 의견, 구의회 의견청취, 관계기관 협의 및 도시계획위원회 심의 과정에서 변경될 수 있습니다.</p>` });
    // 4 구의회 의견청취 의뢰
    out.push({ id: 'council', title: '구의회 의견청취 의뢰(공문)', html: `<p class="doc-no">${v(m.docNo, '문서번호')}</p><p class="to">수신: ${v(council ? council + ' 의장' : '', '○○구의회 의장')}</p><p class="to">제목: ${esc(zoneName)} 지정 및 정비계획(안) 의견청취 요청</p>`
      + `<ol><li>「도시 및 주거환경정비법」 제15조제2항에 따라 ${esc(zoneName)} 지정 및 정비계획(안)에 대하여 의회의 의견을 듣고자 합니다.</li>`
      + `<li>정비계획(안) 개요${planTbl}</li>`
      + `<li>주민공람: ${S.ok ? `${ds(S.open)} ~ ${ds(S.close)}(${S.days}일간)` : need('공람 기간')}에 함께 실시합니다.</li>`
      + `<li>같은 항에 따라 이 통지일부터 60일 이내(${S.ok ? ds(S.councilEnd) + '까지' : need('기한')})에 의견을 제시하여 주시기 바라며, 의견 제시 없이 60일이 지나면 이의가 없는 것으로 봅니다. 의회 의견은 같은 법 제8조제5항에 따라 정비구역 지정 신청 시 첨부합니다.</li></ol>`
      + `<p>붙임 1. 정비계획(안) 1부.<br>　　 2. 정비구역 지정 도면 1부.<br>　　 3. 의견청취안 1부. 끝.</p><p class="sign"><b>${v(proposer, '○○구청장')}</b></p><p class="tnote">담당: ${contact}</p>` });
    // 5 관계기관·관리청 협의
    const depts = (D && D.DEPTS) || [];
    out.push({ id: 'consult', title: '관계기관·관리청 협의 요청(공문)', html: `<p class="doc-no">${v(m.docNo, '문서번호')}</p><p class="to">수신: 수신자 참조</p><p class="to">제목: ${esc(zoneName)} 지정 및 정비계획(안) 관계기관(부서) 협의 요청</p>`
      + `<ol><li>${esc(zoneName)} 지정 및 정비계획(안)을 입안하면서 「도시 및 주거환경정비법」 제15조제4항(정비기반시설 및 국유·공유재산의 관리청 의견)과 「국토의 계획 및 이용에 관한 법률」 제30조제1항에 따라 협의를 요청합니다.</li>`
      + `<li>정비계획(안) 개요${planTbl}</li><li>${S.ok ? ds(S.consultEnd) + '까지' : need('기한')}(30일 이내) 의견을 회신하여 주시기 바랍니다. 교육환경평가·재해영향평가 등은 이 협의 의견 수렴으로 갈음합니다.</li></ol>`
      + `<p>붙임 정비계획(안) 1부. 끝.</p><p class="sign"><b>${v(proposer, '○○구청장')}</b></p><p>수신자: ${depts.map(x => esc(x.부서)).join(', ') || need('협의 부서')}</p><p class="tnote">담당: ${contact}</p>` });
    // 6 주민의견 처리 결과표
    out.push({ id: 'opinion', title: '주민의견 검토 및 처리 결과', html: `<h1>${esc(zoneName)} 주민공람 의견 검토 및 처리 결과</h1>`
      + `<p>공람 기간: ${S.ok ? `${ds(S.open)} ~ ${ds(S.close)}` : need('기간')} · 제출 의견 ${need('건수')}건(채택 ${need('')}건, 일부 채택 ${need('')}건, 미채택 ${need('')}건)</p>`
      + tbl(['연번', '제출인(익명)', '의견 요지', '검토 의견', '처리(채택·일부·미채택)', '미채택 사유 통지일'], [1, 2, 3].map(i => [String(i), IN, IN, IN, IN, IN]))
      + `<p class="tnote">※ 채택하지 않은 의견은 제출한 주민에게 사유를 알려야 합니다(시행령 제13조제3항). 개인 이름·주소는 공개 자료에 넣지 마십시오.</p>` });
    // 7 정비구역 지정 신청
    out.push({ id: 'apply', title: '정비구역 지정 신청(공문, 구 → 시)', html: `<p class="doc-no">${v(m.docNo, '문서번호')}</p><p class="to">수신: ${esc(designator)}(도시정비 담당 부서)</p><p class="to">제목: ${esc(zoneName)} 지정 신청</p>`
      + `<ol><li>「도시 및 주거환경정비법」 제8조제5항에 따라 ${esc(zoneName)} 정비계획을 입안하여 정비구역 지정을 신청합니다.</li><li>정비계획 개요${planTbl}</li>`
      + `<li>추진 경위${S.ok ? tbl(['구분', '일자'], [['주민 서면 통보', ds(S.notice)], ['주민공람', `${ds(S.open)} ~ ${ds(S.close)}`], ['주민설명회', ds(S.brief)], ['구의회 의견청취', `${ds(S.council)} 통지(기한 ${ds(S.councilEnd)})`], ['관계기관 협의', `${ds(S.consult)} 요청(기한 ${ds(S.consultEnd)})`]]) : need('경위')}</li></ol>`
      + `<p>붙임 1. 정비계획(안)(정비계획 결정조서·지구단위계획 결정조서) 1부.<br>　　 2. 정비구역 지정 지형도면(안) 1부.<br>　　 3. 주민공람 공고문 및 주민의견 검토·처리 결과 1부.<br>　　 4. 구의회 의견(법 제8조제5항) 1부.<br>　　 5. 관계기관(부서) 협의 결과 및 조치계획 1부.<br>　　 6. 분담금 추산액 및 산출근거 1부. 끝.</p><p class="sign"><b>${v(proposer, '○○구청장')}</b></p>` });
    // 8 도시계획위원회 상정 안건 개요
    const far = T('far'), dh = T('dheight');
    out.push({ id: 'committee', title: '도시계획위원회 상정 안건 개요', html: `<h1>${esc(zoneName)} 지정 및 정비계획 결정(안)<br><small>(지구단위계획구역 지정 및 지구단위계획 결정 포함)</small></h1>`
      + `<p class="tnote">심의 근거: 도시 및 주거환경정비법 제16조제1항, 국토의 계획 및 이용에 관한 법률 제30조제3항(지구단위계획은 건축위원회·도시계획위원회 공동 심의)</p>`
      + `<h2>1. 제안 사유</h2><p>${need('노후·불량 건축물 현황, 기반시설 상태 등 정비 필요성')}</p><h2>2. 정비계획 주요 내용</h2>${planTbl}<h3>토지이용계획</h3>${luTbl}`
      + (far ? `<h3>용적률 계획</h3>${tbl(far.cols.map(c => (Array.isArray(c) ? c[0] : c)), far.rows)}` : '')
      + (dh ? `<h3>건축물 높이</h3>${tbl(dh.cols.map(c => (Array.isArray(c) ? c[0] : c)), dh.rows)}` : '')
      + `<h2>3. 추진 경위</h2>${S.ok ? tbl(['구분', '일자', '비고'], [['주민공람', `${ds(S.open)} ~ ${ds(S.close)}`, `의견 ${IN}건`], ['주민설명회', ds(S.brief), ''], ['구의회 의견청취', ds(S.council), IN], ['관계기관 협의', ds(S.consult), IN], ['지정 신청', ds(S.apply), '']]) : need('경위')}`
      + `<h2>4. 주민·구의회·관계기관 의견 및 조치</h2>${tbl(['구분', '의견 요지', '조치계획'], [['주민', IN, IN], ['구의회', IN, IN], ['관계기관', IN, IN]])}`
      + `<h2>5. 검토 의견(입안권자)</h2><p>${need('기본계획 부합, 정비구역 지정 요건, 기반시설 확보, 경관·교통·환경 검토 결과 등')}</p>` });
    return { S, list: out, zoneName, proposer, council, designator };
  }

  const api = { schedule, docs, parse, ds, iso, add, roll, ASSUME, IN };
  if (isNode) module.exports = api; else g.JbsProc = api;
})(typeof window !== 'undefined' ? window : globalThis);
