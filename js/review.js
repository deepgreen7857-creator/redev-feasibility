'use strict';

// =====================================================================
// 8. 검토 모드 (추진주체 제출 전 확인 / 구청 담당자 검토)
//   명부(별지 제9호 엑셀) → 공부 조회(브이월드 토지특성·연속지적, 건축물대장) → 구역 자동 생성 → 신청 도면(PDF) 구역선 정합
//   → 명부 ↔ 공부 불일치 판단(기본 공부 우선) → 검토 완료 → 토지·건축물 조서(별지 제4호) 엑셀, 사업성 탭 연결
//   개인정보는 이 브라우저 안에서만 다룸(서버 전송 없음)
//   필요: Leaflet, Turf 6.5, XLSX, VWorld, jsonp, App, Tabs, S, Forms (forms.js)
// =====================================================================

const Review = (() => {
  const PY = 3.305785;
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const PUBLIC_RE = /(대한민국|^국$|국유|인천광역시|서울특별시|광역시|특별시|[가-힣]+(시|구|군)$|미추홀구|남구청|한국토지주택공사|LH|도시공사|철도공단|국가철도)/;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const R = {                 // 현재 검토 상태 (메모리에만 보관)
    name: '', sigungu: '인천광역시 미추홀구', dongCodes: {}, defaultDong: '',
    rows: [], map: {}, header: [], hdrRow: 0, sheetName: '',
    parcels: [], owners: [], cad: {}, cadAll: {}, zone: null, drawn: null, fit: null,
    checks: [], leaflet: null, layers: {}, busy: false,
    items: [], choices: {}, fetched: false, confirmed: null,
  };

  // ---------------------------------------------------------------
  // 화면
  // ---------------------------------------------------------------
  function css() {
    if (document.getElementById('review-css')) return;
    const st = document.createElement('style'); st.id = 'review-css';
    st.textContent = `
#tab-review .rv-step{border:1px solid #d9dee6;border-radius:10px;padding:14px 16px;margin:12px 0;background:#fff}
#tab-review .rv-step h3{margin:0 0 8px;font-size:16px}
#tab-review .rv-step h3 b{display:inline-block;width:24px;height:24px;border-radius:12px;background:#1f4e79;color:#fff;text-align:center;line-height:24px;margin-right:6px;font-size:13px}
#tab-review .rv-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
#tab-review .rv-row label{font-size:13px;color:#444}
#tab-review .rv-row input[type=text],#tab-review .rv-row input[type=number],#tab-review .rv-row select{padding:5px 7px;border:1px solid #c5ccd6;border-radius:6px;font-size:13px}
#tab-review .rv-msg{font-size:13px;color:#333;margin:6px 0;white-space:pre-wrap}
#tab-review .rv-msg.err{color:#b00020}
#tab-review .rv-prog{height:6px;background:#eef1f5;border-radius:3px;overflow:hidden;margin:6px 0}
#tab-review .rv-prog i{display:block;height:100%;width:0;background:#2e75b6;transition:width .2s}
#tab-review table.rv-t{border-collapse:collapse;font-size:12px;width:100%}
#tab-review table.rv-t th,#tab-review table.rv-t td{border:1px solid #e1e5ea;padding:3px 6px;text-align:left}
#tab-review table.rv-t td.n{text-align:right;font-variant-numeric:tabular-nums}
#tab-review table.rv-t tr.warn td{background:#fff4e5}
#tab-review table.rv-t tr.bad td{background:#fde8e8}
#tab-review .rv-map{height:calc(100vh - 110px);min-height:560px;border:1px solid #d9dee6;border-radius:8px;margin-top:8px;resize:vertical;overflow:hidden}
#tab-review .roadcut-panel .rc-fold{float:right;margin:-2px 0 0 8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit;font-size:.8rem}
#tab-review .roadcut-panel.folded .rc-opts,#tab-review .roadcut-panel.folded .rc-note,#tab-review .roadcut-panel.folded p,#tab-review .roadcut-panel.folded .rc-pieces{display:none}
#tab-review .rv-scroll{max-height:360px;overflow:auto;border:1px solid #e1e5ea;border-radius:6px}
#tab-review .rv-kpi{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}
#tab-review .rv-kpi div{border:1px solid #e1e5ea;border-radius:8px;padding:8px 12px;min-width:140px}
#tab-review .rv-kpi b{display:block;font-size:18px}
#tab-review .rv-kpi span{font-size:12px;color:#666}
#tab-review .rv-legend span{display:inline-block;margin-right:12px;font-size:12px}
#tab-review .rv-legend i{display:inline-block;width:14px;height:10px;margin-right:4px;vertical-align:middle}
#tab-review details{margin-top:6px}
#tab-review .rv-need{display:inline-block;padding:0 6px;border-radius:4px;background:#fde8e8;color:#b00020;font-size:12px}
#tab-review .rv-auto{display:inline-block;padding:0 6px;border-radius:4px;background:#eef1f5;color:#555;font-size:12px}
#tab-review table.rv-t tr.need td{background:#fde8e8}
#tab-review table.rv-t select{font-size:12px;padding:2px 4px}
#tab-review .rv-pv h4{margin:12px 0 4px}
#tab-review .rv-guide{border:1px solid #d9dee6;border-radius:8px;padding:8px 12px;margin-top:8px;background:#f8fafc}
#tab-review .rv-guide h4{margin:0 0 6px;font-size:14px}
#tab-review .rv-guide ol{margin:0;padding-left:20px}
#tab-review .rv-guide li{margin:3px 0;font-size:13px;cursor:pointer}
#tab-review .rv-guide li b.s{display:inline-block;min-width:54px;text-align:center;border-radius:4px;padding:0 5px;margin-right:6px;font-size:12px}
#tab-review .rv-guide .ok b.s{background:#e3f4e8;color:#1e7b3a}
#tab-review .rv-guide .todo b.s{background:#fde8e8;color:#b00020}
#tab-review .rv-guide .warn b.s{background:#fff4e5;color:#a35a00}
#tab-review .rv-guide .wait b.s{background:#eef1f5;color:#666}
#tab-review .rv-guide li small{color:#555}`;
    document.head.appendChild(st);
  }

  function html() {
    return `
<div class="card"><h2>검토 모드 <small class="muted">— 제출된 명부·도면을 공부와 대조해 토지·건축물 조서를 만듭니다 (자료는 이 PC 브라우저 안에서만 처리)</small></h2>
<div class="rv-row"><label>사용자 <select id="rvRole"><option value="applicant">추진주체 — 제출 전 자가 확인</option><option value="officer">구청 담당자 — 제출 자료 검토</option></select></label></div>
<p class="small muted">순서: ① 명부(별지 제9호) → ② 공부 조회(토지·건축물대장) → ③ 구역 확인 → ④ 신청 도면 대조(선택) → ⑤ 대조 결과 판단 → ⑥ 검토 완료 → 토지·건축물 조서(별지 제4호) → ⑦ 그 밖의 서식·사업성</p>
<div class="rv-row"><button class="btn" id="rvWorkSave">💾 검토 작업 저장(파일)</button> <label class="btn">📂 검토 작업 불러오기 <input type="file" id="rvWorkLoad" accept=".json" hidden></label>
 <span class="small muted">공부 조회 결과·도면 구역선·판단·직접 자른 모양을 파일 하나로 저장해 다른 PC에서 이어서 합니다(소유자 정보 제외)</span></div>
<div class="rv-msg" id="rvMsgW"></div>
<div id="rvGuide" class="rv-guide"></div></div>

<div class="rv-step" id="rvS1"><h3><b>1</b>토지등소유자 명부 올리기</h3>
 <div class="rv-row"><label>구역 이름 <input type="text" id="rvName" placeholder="예: 용현1구역(B안)" size="22"></label>
  <label>시·군·구 <input type="text" id="rvSigungu" value="인천광역시 미추홀구" size="18"></label>
  <label>기본 법정동 <input type="text" id="rvDong" placeholder="예: 용현동" size="8"></label></div>
 <div class="rv-row"><input type="file" id="rvFile" accept=".xlsx,.xls,.csv"> <button class="btn" id="rvReparse">열 지정 다시 읽기</button></div>
 <div class="rv-msg" id="rvMsg1"></div>
 <details id="rvMapBox"><summary>읽은 열 확인·수정</summary><div id="rvMapping"></div></details>
</div>

<div class="rv-step" id="rvS2"><h3><b>2</b>공부 조회 (브이월드)</h3>
 <div class="rv-row"><button class="btn primary" id="rvFetch">지적도·토지특성 조회</button>
  <label><input type="checkbox" id="rvChar" checked> 토지특성(대장면적·지목·용도지역·공시지가)도 조회 (필지당 1건, 시간 걸림)</label></div>
 <div class="rv-prog"><i id="rvProg"></i></div><div class="rv-msg" id="rvMsg2"></div>
 <div class="rv-row"><button class="btn primary" id="rvLedger">건축물대장 조회</button> <span class="small muted">명부의 건축물(동수·허가유무·연면적 등)과 대조합니다</span></div>
 <div class="rv-row"><label>내 공공데이터 인증키 <input type="password" id="rvMyKey" size="40" placeholder="비우면 홈페이지 공용 키 사용"></label>
  <button class="btn" id="rvMyKeySave">이 PC에 저장</button> <button class="btn" id="rvCacheClear">저장된 대장 지우기</button> <span id="rvCacheInfo" class="rv-note"></span></div>
 <div class="rv-msg" id="rvMsgL"></div>
</div>

<div class="rv-step" id="rvS3"><h3><b>3</b>구역 확인 · 경계 도로 자르기</h3>
 <div class="rv-kpi" id="rvKpi"></div>
 <div class="rv-row"><button class="btn" id="rvCut">경계 도로 자동 자르기</button> <button class="btn primary" id="rvCutMan">✂ 직접 자르기</button> <button class="btn" id="rvJudgeDoc">구역계 판단 설명자료(인쇄용)</button>
  <span class="small muted">구역 경계에 걸친 도로(지목 도로·구거·하천)는 기본으로 <b>접도 도로 불포함</b>(구역계 = 도로에 접한 대지 경계선, 관통하는 도로는 그 선을 이어 끊음)으로 편입합니다. <b>접도 도로 포함</b>을 고르면 구역계 = 도로 건너편 지적선, 관통하는 도로는 그 선을 이어 끊습니다. 공부 조회 뒤 자동으로 하며, 필지마다 [직접 자르기]에서 바꾸거나(중심선까지·전체·빼기도 있음) 선을 그어 자를 수 있습니다.</span></div>
 <div class="rv-msg" id="rvMsg3"></div>
 <div class="rv-legend"><span><i style="background:#ffd27f"></i>명부 필지(전체편입)</span><span><i style="background:#ffa94d"></i>명부상 일부편입</span><span><i style="background:#ff4d4d"></i>도면 구역선 밖으로 나간 부분</span><span><i style="background:#7fb2ff"></i>구역선 안인데 명부에 없음</span><span><i style="border-top:2px solid #333;height:0"></i>지적선</span><span><i style="background:#a78bfa;border:1px dashed #7c3aed"></i>구역계 선형 점검 위치</span><span><i style="background:#fde68a;border:1px solid #ca8a04"></i>도시계획도로(소로)</span><span><i style="background:#fdba74;border:1px solid #ea580c"></i>도시계획도로(중로)</span><span><i style="background:#fca5a5;border:1px solid #dc2626"></i>도시계획도로(대로)</span><span><i style="border-top:2px dotted #111;height:0"></i>실제 길 중심선(도로명주소)</span><span><i style="background:#bbf7d0;border:1px dashed #15803d"></i>실제 길이 지나는 대지</span><span><i style="background:#6b7280"></i>경계 도로 중 잘라낸 부분</span><span><i style="border-top:5px solid #d00000;height:0"></i>구역 경계(도로 자른 뒤)</span><span><i style="border-top:3px dashed #1a1aff;height:0"></i>신청 도면 구역선</span></div>
 <div class="rv-map" id="rvMap"></div>
 <div id="rvRvBox" hidden style="margin-top:8px"><div class="rv-row"><b>로드뷰</b> <span class="small muted" id="rvRvInfo"></span> <button class="btn" id="rvRvClose">로드뷰 닫기</button></div>
  <div class="rv-legend" style="margin:4px 0"><span><i style="background:#e11;border-radius:6px"></i>필지 경계점</span><span><i style="background:#ffd400;border-radius:6px"></i>자른 선(적용됨)</span><span><i style="background:#16a34a;border-radius:6px"></i>지금 찍는 점(번호)</span><span><i style="background:#dbeafe;border:1px solid #1d4ed8"></i>넣은 부분</span><span><i style="background:#e5e7eb;border:1px solid #555"></i>뺀 부분</span></div>
  <div id="rvRv" style="height:420px;border:1px solid #d9dee6;border-radius:8px"></div></div>
</div>

<div class="rv-step" id="rvS4"><h3><b>4</b>신청 도면 구역선 대조 (선택)</h3>
 <p class="small muted">편입지적도 PDF(빨간 구역선)를 올리면, 도면의 지번 글자를 기준점으로 지적도에 맞춘 뒤 경계 필지마다 구역선 안/밖 면적을 계산합니다.</p>
 <div class="rv-row"><input type="file" id="rvPdf" accept=".pdf"> <label>선 색 <select id="rvColor"><option value="red">빨강</option><option value="blue">파랑</option></select></label></div>
 <div class="rv-msg" id="rvMsg4"></div>
</div>

<div class="rv-step" id="rvS5"><h3><b>5</b>대조 결과 판단</h3>
 <div id="rvChecks" class="rv-msg">명부와 공부를 조회하면 결과가 나옵니다.</div>
 <div class="rv-scroll" id="rvTableBox"></div>
 <h4 style="margin:12px 0 4px">명부 ↔ 공부 불일치 <small class="muted" id="rvItemsSum"></small></h4>
 <p class="small muted">기본값은 공부(토지대장·건축물대장) 우선입니다. <span class="rv-need">판단 필요</span> 항목은 직접 골라야 검토를 마칠 수 있습니다.</p>
 <div class="rv-row"><button class="btn" id="rvItemsXlsx">판단표 엑셀 내려받기</button>
  <label class="small">판단표 올려서 반영 <input type="file" id="rvItemsIn" accept=".xlsx,.xls"></label>
  <span class="small muted">엑셀의 "내 선택" 칸에 고를 수 있는 값 중 하나를 적어 올리면 그대로 반영합니다.</span></div>
 <div class="rv-msg" id="rvMsg5"></div>
 <div class="rv-scroll" id="rvItems"></div>
</div>

<div class="rv-step" id="rvS6"><h3><b>6</b>검토 완료 → 토지·건축물 조서 (별지 제4호)</h3>
 <div class="rv-row"><label>작성자 직 <input type="text" id="rvWTitle" size="8"></label><label>성명 <input type="text" id="rvWName" size="8"></label>
  <label>확인자 직 <input type="text" id="rvCTitle" size="8"></label><label>성명 <input type="text" id="rvCName" size="8"></label></div>
 <div class="rv-row"><button class="btn primary" id="rvConfirm">검토 완료 · 조서 만들기</button> <span class="small" id="rvPending"></span>
  <button class="btn" id="rvFrame">최종 결과 틀(공부 기준) 엑셀</button> <span class="small muted">토지·건축물 조서 + 별지 제9호 작성 틀(소유자 칸은 열람으로 기재)</span></div>
 <div class="rv-msg" id="rvMsgC"></div>
 <div id="rvPreview"></div>
</div>

<div class="rv-step" id="rvS7"><h3><b>7</b>그 밖의 서식 · 사업성</h3>
 <div class="rv-row"><button class="btn" id="rvForms">법정서식 엑셀 (별지 제4·5·6·9호, 확정 전 참고용)</button>
  <button class="btn" id="rvReviewXlsx">검토표 엑셀</button>
  <button class="btn" id="rvFromArea">2구역계 탭의 구역으로 서식 만들기</button></div>
 <div class="rv-row"><label>공시지가 배율 <input type="number" id="rvMult" value="1.4" step="0.1" style="width:60px"></label>
  <label>동의율(분양대상) <input type="number" id="rvConsent" value="80" step="5" style="width:60px">%</label>
  <label>계획 연면적(㎡) <input type="number" id="rvGfa" placeholder="비우면 용적률로 추정" style="width:130px"></label>
  <label>용적률(%) <input type="number" id="rvFar" value="250" style="width:60px"></label>
  <label>평당 공사비(원) <input type="number" id="rvConst" value="7000000" step="100000" style="width:100px"></label>
  <label>단가 기준 <select id="rvPreset"><option value="">자동(규모로 판단)</option><option value="small">소규모·가로주택(구청 검토 엑셀)</option><option value="redev">재개발 대규모</option></select></label></div>
 <div class="rv-row"><label>평형 <input type="text" id="rvUnits" size="70" value="59형:82.78:59.98:0:0:17800000, 84형:112.45:84.98:0:0:17500000"></label>
  <span class="small muted">타입:공급㎡:전용㎡:조합원세대:일반세대:일반평당분양가</span></div>
 <div class="rv-row"><label>상가 분양면적(㎡) <input type="number" id="rvRetail" value="0" style="width:90px"></label>
  <button class="btn primary" id="rvFeas">사업성 검토표 엑셀</button>
  <button class="btn" id="rvToApp">사업성 탭(4~7)으로 보내기</button> <button class="btn" id="rvRoad">접도 판정 지도</button></div>
 <div class="rv-msg" id="rvMsg6"></div>
</div>`;
  }

  const $r = id => document.getElementById(id);
  const msg = (id, t, err) => { const e = $r(id); if (e) { e.textContent = t; e.classList.toggle('err', !!err); } };
  const prog = f => { const e = $r('rvProg'); if (e) e.style.width = Math.round(f * 100) + '%'; };
  const fmtN = (v, d = 1) => v == null || isNaN(v) ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

  function install() {
    if (document.getElementById('tab-review')) return;
    if (typeof Ledger !== 'undefined') hookDataGoKr();
    css();
    const nav = document.getElementById('tabs'), main = document.querySelector('main');
    if (!nav || !main) return;
    const a = document.createElement('a');
    a.href = '#review'; a.dataset.tab = 'review'; a.innerHTML = '<b>8</b>검토 모드';
    a.addEventListener('click', e => { e.preventDefault(); App.go('review'); });
    nav.appendChild(a);
    const sec = document.createElement('section');
    sec.id = 'tab-review'; sec.className = 'panel'; sec.hidden = true; sec.innerHTML = html();
    main.appendChild(sec);
    bind();
  }

  function bind() {
    $r('rvFile').onchange = e => e.target.files[0] && readFile(e.target.files[0]);
    $r('rvReparse').onclick = () => { if (R.rows.length) { applyMapping(); } };
    $r('rvFetch').onclick = () => fetchAll().catch(err => msg('rvMsg2', '조회 오류: ' + err.message, true));
    $r('rvPdf').onchange = e => e.target.files[0] && matchPdf(e.target.files[0]).catch(err => msg('rvMsg4', '도면 처리 오류: ' + err.message, true));
    $r('rvForms').onclick = () => { const z = zoneData(); if (!z) return; Forms.exportForms(z, `${z.name}_법정서식.xlsx`, { sign: signInfo() }); };
    $r('rvConfirm').onclick = confirmReview;
    $r('rvItemsXlsx').onclick = exportItems;
    $r('rvFrame').onclick = () => { const z = zoneData(); if (!z) return; if (R.confirmed) z.confirm = R.confirmed; Forms.exportFrame(z, `${z.name}_최종결과틀.xlsx`, { sign: signInfo() }); };
    $r('rvItemsIn').onchange = e => e.target.files[0] && importItems(e.target.files[0]).catch(err => msg('rvMsg5', '판단표 반영 오류: ' + err.message, true)).finally(() => { e.target.value = ''; });
    $r('rvCut').onclick = () => cutRoads().catch(err => msg('rvMsg3', '경계 도로 자르기 오류: ' + err.message, true));
    $r('rvCutMan').onclick = () => Cutter.open();
    $r('rvJudgeDoc').onclick = judgeReport;
    $r('rvWorkSave').onclick = saveWork;
    $r('rvWorkLoad').onchange = e => e.target.files[0] && loadWork(e.target.files[0]).catch(err => msg('rvMsgW', '불러오기 오류: ' + err.message, true)).finally(() => { e.target.value = ''; });
    $r('rvRvClose').onclick = closeRoadview;
    try { const v = localStorage.getItem(ROLE_LS); if (v) $r('rvRole').value = v; } catch (e) { }
    $r('rvRole').onchange = () => { try { localStorage.setItem(ROLE_LS, $r('rvRole').value); } catch (e) { } roleUi(); };
    roleUi(); renderGuide();
    $r('rvReviewXlsx').onclick = exportReview;
    $r('rvFeas').onclick = () => { const z = zoneData(); if (!z) return; Forms.feasibility(z, feasParams(), `${z.name}_사업성검토.xlsx`); };
    $r('rvToApp').onclick = toApp;
    try { $r('rvMyKey').value = localStorage.getItem(KEY_LS) || ''; } catch (e) { }
    $r('rvMyKeySave').onclick = () => { const v = $r('rvMyKey').value.trim(); try { v ? localStorage.setItem(KEY_LS, v) : localStorage.removeItem(KEY_LS); } catch (e) { } msg('rvMsg6', v ? '내 인증키를 이 PC에 저장했습니다. 건축물대장 조회는 이제 내 키로 합니다.' : '내 인증키를 지웠습니다. 공용 키로 조회합니다.'); };
    $r('rvCacheClear').onclick = async () => { await Cache.clear(); cacheInfo(); msg('rvMsg6', '저장된 건축물대장을 지웠습니다. 다음 조회는 처음부터 받습니다.'); };
    cacheInfo();
    $r('rvRoad').onclick = toggleRoadLayer;
    $r('rvLedger').onclick = () => ledger().catch(err => msg('rvMsgL', '건축물대장 오류: ' + err.message, true));
    $r('rvFromArea').onclick = () => fromArea().catch(err => msg('rvMsg6', '오류: ' + err.message, true));
  }

  // ---------------------------------------------------------------
  // 1. 명부 읽기 (열 자동 인식)
  // ---------------------------------------------------------------
  // 명부 열: [키, 화면 이름, (열 이름, 위 칸의 묶음 이름) => 맞는지]
  //   별지 제9호처럼 "토지 / 건축물" 묶음 아래 같은 이름(소유면적·공유·소유권지분·동)이 또 나오므로 묶음 이름으로 가름
  //   배열 순서 = 열을 찾는 순서 (구체적인 것부터)
  const isOwnerG = g => /소유자\s*번호/.test(g);
  const isBldgG = g => /건축물|건물/.test(g) && !/대장|등본|표제/.test(g);
  const isLandG = g => /토지/.test(g) && !/소유자|대장|등본/.test(g);
  const FIELDS = [
    ['ownerNo', '소유자 번호', (l, g) => /소유자\s*번호|^번호$/.test(l) || (isOwnerG(g) && (/본번/.test(l) || !l))],
    ['ownerNo2', '소유자 번호(부번)', (l, g) => isOwnerG(g) && /부번/.test(l)],
    ['bon', '본번', (l, g) => /본번/.test(l) && !isOwnerG(g)],
    ['bu', '부번', (l, g) => /부번/.test(l) && !isOwnerG(g)],
    ['areaIn', '편입면적', (l, g) => /편입/.test(l) && !isBldgG(g)],
    ['own', '토지 소유면적', (l, g) => /소유\s*면적|지분\s*면적/.test(l) && !isBldgG(g)],
    ['bOwn', '건축물 소유면적', (l, g) => /소유\s*면적|전유/.test(l) && isBldgG(g)],
    ['bRes', '건축물 주거면적', l => /주거\s*면적/.test(l)],
    ['bArch', '건축면적', l => /건축\s*면적/.test(l)],
    ['bFloor', '연면적', l => /연\s*면적/.test(l)],
    ['area1', '공부(1필지)면적', (l, g) => /공부|1\s*필지|필지면적|대장면적|토지면적/.test(l) && !isBldgG(g)],
    ['bBaseUse', '지하층 용도', l => /지하\s*층?\s*용도/.test(l)],
    ['bBase', '지하층수', l => /^지하\s*(층|층수)?$/.test(l)],
    ['bFloors', '지상층수', l => /^지상\s*(층|층수)?$|^층\s*수$/.test(l)],
    ['aprDate', '사용승인일', l => /사용\s*승인|준공|건축\s*연도/.test(l)],
    ['bDong', '건축물 동(동수·동명)', (l, g) => /^동\s*(수|명)?$/.test(l) && isBldgG(g)],
    ['bShared', '건축물 공유여부', (l, g) => /^공유(\s*여부)?$/.test(l) && isBldgG(g)],
    ['bShare', '건축물 소유권지분', (l, g) => /소유권\s*지분|^지\s*분$/.test(l) && isBldgG(g)],
    ['landShared', '토지 공유여부', (l, g) => /^공유(\s*여부)?$/.test(l) && !isBldgG(g)],
    ['landShare', '토지 소유권지분', (l, g) => /소유권\s*지분/.test(l) && isLandG(g)],
    ['share', '지분', (l, g) => /^지\s*분$|지분율|공유지분/.test(l) && !isBldgG(g)],
    ['bldgName', '건물명', l => /건물\s*명|아파트\s*명|단지\s*명/.test(l)],
    ['bdong', '동(소재지)', (l, g) => /^동$|^동\s*명$|건물\s*동/.test(l) && !isBldgG(g)],
    ['ho', '호', (l, g) => /^호$|^호\s*수$|호실/.test(l) && !isBldgG(g)],
    ['permit', '허가유무', (l, g) => /허가/.test(l || g)],
    ['superficies', '지상권', l => /지상권/.test(l)],
    ['head', '세대주 성명', l => /세대주/.test(l)],
    ['consent', '동의여부', l => /동의/.test(l)],
    ['name', '성명', l => /성\s*명|소유자명|^소유자$/.test(l) && !/세대주/.test(l)],
    ['birth', '생년월일·주민번호', l => /생년|주민/.test(l)],
    ['addr', '주소', l => /주\s*소/.test(l)],
    ['phone', '전화', l => /전화|연락/.test(l)],
    ['jimok', '지목', l => /지\s*목/.test(l)],
    ['bUse', '건축물 용도', (l, g) => /^(주\s*)?용\s*도$/.test(l) && (isBldgG(g) || !isLandG(g))],
    ['bStruct', '구조', l => /구\s*조/.test(l)],
    ['type', '소유구분', l => /소유\s*구분|^구\s*분$|국공유/.test(l)],
    ['ldong', '법정동', l => /법정동|행정동|^동\s*리$|동리/.test(l)],
    ['jibun', '지번(소재지)', (l, g) => /지\s*번|소재지/.test(l) && !isBldgG(g)],
    ['note', '비고', l => /비\s*고/.test(l)],
  ];
  const BLDG_KEYS = ['bOwn', 'bRes', 'bArch', 'bFloor', 'bBase', 'bFloors', 'aprDate', 'bDong', 'bShared', 'bShare', 'permit', 'bUse', 'bStruct'];

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    // 가장 행이 많은 시트 = 명부
    let best = null;
    wb.SheetNames.forEach(n => { const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', blankrows: true }); if (!best || a.length > best.a.length) best = { n, a }; });
    R.sheetName = best.n; R.rows = best.a;
    // 병합 칸(묶음 머리글) - sheet_to_json 배열 기준으로 옮김
    const ws = wb.Sheets[best.n], rg = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 };
    R.merges = (ws['!merges'] || []).map(m => ({ s: { r: m.s.r - rg.r, c: m.s.c - rg.c }, e: { r: m.e.r - rg.r, c: m.e.c - rg.c } }));
    R.name = $r('rvName').value || file.name.replace(/\.[^.]+$/, '');
    if (!$r('rvName').value) $r('rvName').value = R.name;
    detectHeader(); renderMapping(); applyMapping();
  }

  function detectHeader() {
    let hr = 0, score = -1;
    for (let i = 0; i < Math.min(15, R.rows.length); i++) {
      const t = R.rows[i].map(String).join('|');
      const sc = (/성\s*명|소유자/.test(t) ? 2 : 0) + (/지\s*번|소재지|본번/.test(t) ? 2 : 0) + (/면적/.test(t) ? 1 : 0) + (/지\s*목/.test(t) ? 1 : 0);
      if (sc > score) { score = sc; hr = i; }
    }
    // 머리글: 열 이름(l) + 위 칸의 묶음 이름(g). 2단(바로 아래 행이 세부 이름)과 묶음 행이 위에 있는 형식 모두
    const T = v => String(v ?? '').replace(/\s+/g, ' ').trim();
    const isNum = v => v !== '' && !isNaN(+String(v).replace(/,/g, ''));
    const cover = (r, c) => { const m = (R.merges || []).find(m => m.s.r <= r && r <= m.e.r && m.s.c <= c && c <= m.e.c); return T((R.rows[m ? m.s.r : r] || [])[m ? m.s.c : c]); };
    const h2 = R.rows[hr + 1] || [];
    // 바로 아래 행이 세부 머리글인지: 머리글 낱말(면적·성명·지분 …)이 2칸 이상이어야 함 (명부 첫 행을 머리글로 잘못 보지 않게)
    const two = h2.filter(v => T(v) && !isNum(v) && (FIELDS.some(f => f[2](T(v), '')) || /면적|유무|여부|번호/.test(T(v)))).length >= 2;
    const width = Math.max(0, ...R.rows.slice(0, hr + 2).map(r => r.length));
    R.cols = []; let last = '';
    for (let c = 0; c < width; c++) {
      let l, g = '';
      if (two) { const a = cover(hr, c), b = T(h2[c]); if (a) last = a; l = b || a || last; if (b) g = a || last; }
      else {
        l = cover(hr, c);
        for (let r = hr - 1; r >= 0; r--) { const v = cover(r, c); if (v && !isNum(v)) { if (v !== l) g = v; break; } }
      }
      R.cols.push({ l, g });
    }
    R.header = R.cols.map(x => x.g && x.l && x.g !== x.l ? `${x.g} ${x.l}` : (x.l || x.g));
    R.hdrRow = hr + (two ? 2 : 1);
    // 명부 위에 적힌 "총 토지등소유자수"
    R.declaredOwners = null;
    for (let r = 0; r < hr && R.declaredOwners == null; r++) (R.rows[r] || []).forEach((v, c) => {
      if (R.declaredOwners != null || !/총\s*토지등\s*소유자\s*수/.test(T(v))) return;
      for (let k = r; k <= hr + 1; k++) { const x = (R.rows[k] || [])[c]; if (isNum(x)) { R.declaredOwners = +String(x).replace(/,/g, ''); break; } }
    });
    R.map = {};
    const used = new Set();
    FIELDS.forEach(([k, , test]) => {
      const c = R.cols.findIndex((x, i) => !used.has(i) && test(x.l || x.g, x.l ? x.g : ''));
      if (c >= 0) { R.map[k] = c; used.add(c); }
    });
    // 명부에 '면적' 하나만 있으면 공부면적으로
    if (R.map.area1 == null) { const c = R.header.findIndex((h, i) => !used.has(i) && /면적/.test(h) && !isBldgG(R.cols[i].g)); if (c >= 0) R.map.area1 = c; }
  }

  function renderMapping() {
    const opts = ['<option value="">(없음)</option>', ...R.header.map((h, i) => `<option value="${i}">${XLSX.utils.encode_col(i)}열: ${esc(h || '-')}</option>`)].join('');
    $r('rvMapping').innerHTML = `<p class="small">시트 "${esc(R.sheetName)}", 머리글 ${R.hdrRow}행 아래부터 읽음</p>` +
      FIELDS.map(([k, lab]) => `<label style="display:inline-block;margin:3px 10px 3px 0">${lab} <select data-k="${k}">${opts}</select></label>`).join('');
    $r('rvMapping').querySelectorAll('select').forEach(s => { s.value = R.map[s.dataset.k] ?? ''; s.onchange = () => { s.value === '' ? delete R.map[s.dataset.k] : (R.map[s.dataset.k] = +s.value); }; });
  }

  const cleanName = n => String(n || '').replace(/\(\d+\)\s*$/, '').replace(/(?<=[가-힣])[A-Z]$/, '').trim();
  const num = v => { if (v === '' || v == null) return null; const x = +String(v).replace(/,/g, ''); return isNaN(x) ? null : x; };

  function normJibun(row) {
    const m = R.map;
    if (m.bon != null && String(row[m.bon]).trim()) {
      const b = String(row[m.bon]).trim().replace(/\.0$/, ''), s = m.bu != null ? String(row[m.bu]).trim().replace(/\.0$/, '') : '';
      return s && s !== '0' ? `${+b}-${+s}` : `${+b}`;
    }
    if (m.jibun == null) return '';
    const t = String(row[m.jibun]);
    const mm = t.match(/(산\s*)?(\d+)(?:\s*-\s*(\d+))?/);
    return mm ? (mm[3] && +mm[3] ? `${+mm[2]}-${+mm[3]}` : `${+mm[2]}`) : '';
  }

  function applyMapping() {
    const m = R.map; const body = R.rows.slice(R.hdrRow);
    const txt = (row, k) => m[k] != null ? String(row[m[k]] ?? '').trim() : '';
    const nv = (row, k) => m[k] != null ? num(row[m[k]]) : null;
    let lastJ = '', lastA1 = null, lastJm = '', lastDong = '', lastNo = '';
    const recs = [];
    R.gaps = [];   // 명부 기재 누락 (행별): { row: 엑셀 행 번호, no, jibun, fields: [빠진 칸] }
    const CORP = /(주식회사|㈜|\(주\)|법인|재단|교회|조합|회사|공사|공단|학교|종중)/;
    body.forEach((row, ri) => {
      if (!row || !row.some(v => String(v).trim())) return;
      let j = normJibun(row);
      const nm = m.name != null ? cleanName(row[m.name]) : '';
      if (!j && nm) j = lastJ;                 // 같은 필지의 공유자 행
      if (!j) return;
      const newParcel = j !== lastJ;
      if (newParcel) { lastA1 = null; lastJm = ''; }
      const a1 = nv(row, 'area1'); if (a1 != null) lastA1 = a1;
      const jm = txt(row, 'jimok'); if (jm) lastJm = jm;
      const ld = txt(row, 'ldong'); if (ld) lastDong = ld;
      lastJ = j;
      // 토지등소유자 번호: 본번은 묶음 첫 행에만 적는 명부가 많으므로 비면 윗행 번호를 이어 씀 (본번 = 토지등소유자 1인 단위)
      let no1 = txt(row, 'ownerNo').replace(/\.0$/, ''); const no2 = txt(row, 'ownerNo2').replace(/\.0$/, '');
      if (no1) lastNo = no1; else if (m.ownerNo != null && (no2 || nm)) no1 = lastNo;
      const rec = {
        jibun: j, ldong: ld || lastDong, name: nm, birth: txt(row, 'birth'), addr: txt(row, 'addr'), phone: txt(row, 'phone'),
        jimok: jm || lastJm, area1: a1 ?? lastA1, areaIn: nv(row, 'areaIn'), own: nv(row, 'own'),
        share: txt(row, 'share') || txt(row, 'landShare'), landShared: txt(row, 'landShared'),
        bldgName: txt(row, 'bldgName'), bdong: txt(row, 'bdong'), ho: txt(row, 'ho').replace(/\.0$/, ''),
        type: txt(row, 'type'), ownerNo: no2 && no2 !== '0' ? `${no1}-${no2}` : no1, ownerBase: no1,
        superficies: txt(row, 'superficies'), head: txt(row, 'head'), consent: txt(row, 'consent'), note: txt(row, 'note'),
      };
      // 이 행에 적힌 건축물 (명부의 건축물 칸)
      if (BLDG_KEYS.some(k => txt(row, k))) {
        rec.bldg = {
          arch: nv(row, 'bArch'), floor: nv(row, 'bFloor'), own: nv(row, 'bOwn'), res: nv(row, 'bRes'),
          shared: txt(row, 'bShared'), share: txt(row, 'bShare'), aprDate: toDate(m.aprDate != null ? row[m.aprDate] : ''),
          dong: txt(row, 'bDong').replace(/\.0$/, ''), base: nv(row, 'bBase'), floors: nv(row, 'bFloors'), baseUse: txt(row, 'bBaseUse'),
          use: txt(row, 'bUse'), structure: txt(row, 'bStruct'), permit: permitOf(txt(row, 'permit')),
        };
      }
      // 기재 누락(행별): 인적 사항(개인만 — 국공유·법인 제외)과 토지 소유면적. 필지·건축물 칸은 아래에서 필지·건물 단위로 봄
      //   (명부는 필지·건물 칸을 묶음 첫 행에만 적고 아래 행은 비워 두는 일이 많음)
      rec.row = R.hdrRow + ri + 1;
      const g = [], person = nm && !PUBLIC_RE.test(nm) && !CORP.test(nm);
      if (m.name != null && !nm) g.push('성명');
      if (m.ownerNo != null && !no1) g.push('소유자 번호');
      if (m.birth != null && person && !rec.birth) g.push('생년월일');
      if (m.addr != null && person && !rec.addr) g.push('주소');
      if (m.own != null && rec.own == null && !rec.bldg) g.push('토지 소유면적');
      if (g.length) R.gaps.push({ row: rec.row, no: rec.ownerNo, jibun: j, fields: g });
      recs.push(rec);
    });
    // 필지
    const P = new Map();
    recs.forEach(r => {
      const key = (r.ldong ? r.ldong + ' ' : '') + r.jibun;
      if (!P.has(key)) P.set(key, { key, jibun: r.jibun, dong: r.ldong || $r('rvDong').value || '', jimok: r.jimok, area1: r.area1, areaIn: r.areaIn, rows: [] });
      const p = P.get(key);
      if (p.area1 == null && r.area1 != null) p.area1 = r.area1;
      if (p.areaIn == null && r.areaIn != null) p.areaIn = r.areaIn;
      if (!p.jimok && r.jimok) p.jimok = r.jimok;
      p.rows.push(r);
    });
    R.parcels = [...P.values()].map(p => {
      const names = p.rows.map(r => r.name).filter(Boolean);
      const typ = p.rows.map(r => r.type).find(Boolean) || '';
      const pub = names.some(n => PUBLIC_RE.test(n));
      return { ...p, area: p.areaIn ?? p.area1, ownerType: typeLabel(typ, names), isPublic: pub || /국|시|구|공/.test(typ), rosterB: rosterBuildings(p.rows) };
    });
    R.hasBldgCols = BLDG_KEYS.some(k => m[k] != null);
    // 기재 누락(필지·건물 단위): 필지에 한 번도 안 적힌 칸, 건물(묶은 뒤)에 한 번도 안 적힌 칸
    R.parcels.forEach(p => {
      const g = [], r0 = p.rows[0];
      if (m.area1 != null && p.area1 == null) g.push('공부면적');
      if (m.areaIn != null && p.areaIn == null) g.push('편입면적');
      if (m.jimok != null && !p.jimok) g.push('지목');
      p.rosterB.forEach(b => {
        if (m.permit != null && !b.permit) g.push('건축물 허가유무');
        if (m.bUse != null && !b.use) g.push('건축물 용도');
        if (m.bStruct != null && !b.structure) g.push('건축물 구조');
        if (m.bFloor != null && b.floor == null) g.push('건축물 연면적');
        if (m.aprDate != null && !b.aprDate) g.push('사용승인일');
      });
      if (g.length) R.gaps.push({ row: r0.row, no: r0.ownerNo, jibun: p.jibun, fields: [...new Set(g)], unit: g.filter(f => /^건축물|사용승인/.test(f)).length ? '필지·건물' : '필지' });
    });
    R.gaps.sort((a, b) => a.row - b.row);
    // 소유자 (성명 + 생년 6자리, 국공유는 명의만)
    const O = new Map();
    const inOf = r => { const p = P.get((r.ldong ? r.ldong + ' ' : '') + r.jibun); return r.own != null && p && p.areaIn != null && p.area1 ? Math.round(r.own * p.areaIn / p.area1 * 10) / 10 : r.own; };
    recs.forEach(r => {
      if (!r.name) return;
      const pub = PUBLIC_RE.test(r.name);
      const k = pub ? 'PUB|' + r.name : r.name + '|' + String(r.birth).replace(/\D/g, '').slice(0, 6);
      if (!O.has(k)) O.set(k, { key: k, name: r.name, birth: r.birth, addr: r.addr, phone: r.phone, head: r.head, consent: r.consent, isPublic: pub, nos: new Set(), parcels: [] });
      const o = O.get(k); if (r.ownerBase) o.nos.add(r.ownerBase);
      if (!o.head && r.head) o.head = r.head;
      const b = r.bldg;
      const sole = s => !s || /^(1\/1|1|1\.0|100\s*%?)$/.test(String(s).replace(/\s+/g, ''));
      o.parcels.push({ jibun: r.jibun, dong: r.ldong, ho: [r.bldgName, r.bdong, r.ho].filter(Boolean).join(' '), ownArea: r.own, inArea: inOf(r), share: sole(r.share) ? '' : r.share,
        shared: r.landShared ? (/^(o|y|예|공유|유|○|●)$/i.test(r.landShared) ? `공유${sole(r.share) ? '' : `(${r.share})`}` : r.landShared) : '',
        bldgCount: b ? (/^\d+$/.test(b.dong) && +b.dong < 50 ? +b.dong : 1) : '', permit: b ? b.permit : '', bldgShare: b ? (b.shared || (b.share ? '공유' : '')) : '',
        superficies: r.superficies, consent: r.consent, note: r.note });
    });
    R.owners = [...O.values()].map((o, i) => ({ ...o, no: i + 1, nos: [...o.nos] }));
    R.ownerGroups = m.ownerNo != null ? new Set(recs.map(r => r.ownerBase).filter(Boolean)).size : null;   // 명부의 토지등소유자 번호(본번) 개수
    const noArea = R.parcels.filter(p => p.area == null).length;
    const nb = R.parcels.reduce((a, p) => a + p.rosterB.length, 0);
    msg('rvMsg1', `읽음: ${recs.length.toLocaleString()}행 → 필지 ${R.parcels.length.toLocaleString()}개, 소유자(성명+생년) ${R.owners.length.toLocaleString()}명` +
      (R.hasBldgCols ? `, 명부상 건축물 ${nb.toLocaleString()}동` : '') +
      `\n열: 지번=${colName('jibun', 'bon')}, 성명=${colName('name')}, 공부면적=${colName('area1')}, 편입면적=${colName('areaIn')}, 지목=${colName('jimok')}` +
      (R.hasBldgCols ? `, 건축물 연면적=${colName('bFloor')}, 용도=${colName('bUse')}, 허가유무=${colName('permit')}` : '\n⚠ 건축물 칸이 없습니다 → 건축물조서는 건축물대장으로만 만듭니다(명부와 대조 불가).') +
      (m.areaIn == null ? '\n⚠ 편입면적 열이 없습니다 → 공부면적을 편입면적으로 봅니다(일부편입 필지 확인 필요).' : '') +
      (noArea ? `\n⚠ 면적이 비어 있는 필지 ${noArea}개` : ''));
    R.cad = {}; R.zone = null; R.zoneFull = null; R.drawn = null; R.fetched = false; R.cutDone = false; R.choices = {};
    runChecks();
  }

  // 날짜 칸(엑셀 일련번호, 1985-03-02, 19850302, 1985.3.2, 1985) → 'YYYY-MM-DD' (연도만이면 'YYYY')
  function toDate(v) {
    if (v === '' || v == null) return '';
    if (typeof v === 'number' && v > 3000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    const s = String(v).trim(); let mm;
    if ((mm = s.match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})/))) return `${mm[1]}-${mm[2].padStart(2, '0')}-${mm[3].padStart(2, '0')}`;
    if ((mm = s.match(/^(\d{4})/))) return mm[1];
    return '';
  }
  const permitOf = t => !t ? '' : /무|미|없|x|n/i.test(t) ? '무허가' : /유|허가|있|o|y|○/i.test(t) ? '유허가' : t;
  // 용도·구조 글자 → 건축물대장(ledger.js)과 같은 구분
  const useStd = t => /아파트/.test(t) ? '아파트' : /연립/.test(t) ? '연립주택' : /다세대/.test(t) ? '다세대주택' : /다가구/.test(t) ? '다가구주택' : /공동\s*주택/.test(t) ? '공동주택'
    : /단독|주택|다중/.test(t) ? '단독주택' : /근린|소매|점포|사무소|음식|상가|조산|의원|이용원|미용|세탁|학원|교습|독서실|부동산/.test(t) ? '근린생활시설' : t ? '기타' : '';
  const structStd = t => /콘크리트|CON|R\s*[.,]?\s*C\b|라멘/i.test(t) ? '철근콘크리트' : /벽돌|블럭|블록|부럭|브럭|부록|조적|연와|석조|시멘트|세멘|흙/.test(t) ? '조적'
    : /철골|강구조/.test(t) ? '철골' : /목/.test(t) ? '목조' : t ? '기타' : '';

  // 명부 행들(한 필지) → 건축물 목록. 같은 건물이 소유자·호마다 되풀이되므로 건물명·동·사용승인일·연면적으로 묶음
  function rosterBuildings(rows) {
    const M = new Map();
    rows.forEach(r => {
      const b = r.bldg; if (!b) return;
      if (!b.floor && !b.arch && !b.use && !b.structure && !b.aprDate && !b.permit) return;
      const k = [r.bldgName, /^\d+$/.test(b.dong) ? '' : b.dong, b.aprDate, b.floor || '', b.use].join('|');
      if (!M.has(k)) M.set(k, { bname: [r.bldgName, /^\d+$/.test(b.dong) ? '' : b.dong].filter(Boolean).join(' '), arch: b.arch, floor: b.floor, aprDate: b.aprDate,
        floors: b.floors, base: b.base, use: b.use, structure: b.structure, permit: b.permit, dongs: /^\d+$/.test(b.dong) && +b.dong < 50 ? +b.dong : 1, hos: new Set(), owners: 0, resBasement: /주택|주거/.test(b.baseUse || '') });
      const x = M.get(k); x.owners++; if (r.ho) x.hos.add(r.ho);
      ['arch', 'floor', 'floors', 'base'].forEach(f => { if (x[f] == null && b[f] != null) x[f] = b[f]; });
      ['use', 'structure', 'permit', 'aprDate'].forEach(f => { if (!x[f] && b[f]) x[f] = b[f]; });
    });
    return [...M.values()].map(x => ({ ...x, units: x.hos.size || (/단독|다가구|주택/.test(x.use) && !/공동|아파트|연립|다세대/.test(x.use) ? 1 : 0), hos: undefined }));
  }
  const colName = (...ks) => { const k = ks.find(x => R.map[x] != null); return k ? `${XLSX.utils.encode_col(R.map[k])}열(${R.header[R.map[k]] || ''})` : '없음'; };
  function typeLabel(t, names) {
    if (/국/.test(t)) return '국유지'; if (/시유/.test(t)) return '시유지'; if (/구유|군유/.test(t)) return '구유지';
    if (/공공|공사/.test(t)) return '공공기관';
    const n = names.join(' ');
    if (/대한민국|^국$| 국 |국유/.test(n) || names.includes('국')) return '국유지';
    if (/광역시|특별시|도청/.test(n) && !/구$/.test(n)) return '시유지';
    if (/구청|미추홀구|남구|[가-힣]구$|[가-힣]군$/.test(n)) return '구유지';
    if (/한국토지주택공사|도시공사|공단/.test(n)) return '공공기관';
    if (names.some(x => /^[가-힣]{1,4}시$/.test(x.trim()))) return '시유지';   // "인천시"처럼 줄여 쓴 명의
    return '사유지';
  }

  // ---------------------------------------------------------------
  // 2. 공부 조회
  // ---------------------------------------------------------------
  async function dongCode(dong) {
    if (R.dongCodes[dong]) return R.dongCodes[dong];
    const sg = $r('rvSigungu').value.trim();
    const sample = R.parcels.find(p => (p.dong || '') === dong) || R.parcels[0];
    const res = await VWorld.search(`${sg} ${dong} ${sample.jibun}`);
    const hit = (res || []).find(x => x.precise) || (res || [])[0];
    if (!hit) throw new Error(`"${sg} ${dong}" 위치를 찾지 못했습니다`);
    const f = await VWorld.parcelAt(hit.lat, hit.lon);
    const pnu = f && (f.properties ? f.properties.pnu : f.pnu);
    if (!pnu) throw new Error(`"${dong}" 법정동 코드를 찾지 못했습니다`);
    R.dongCodes[dong] = { code: pnu.slice(0, 10), lat: hit.lat, lon: hit.lon };
    return R.dongCodes[dong];
  }
  const pnuOf = (code, j) => { const [b, s] = String(j).split('-'); return code + '1' + String(b).padStart(4, '0') + String(s || 0).padStart(4, '0'); };

  async function fetchAll() {
    if (!R.parcels.length) return msg('rvMsg2', '먼저 명부를 올려 주세요.', true);
    if (R.busy) return; R.busy = true;
    try {
      const dongs = [...new Set(R.parcels.map(p => p.dong || $r('rvDong').value || ''))];
      if (dongs.includes('') && !$r('rvDong').value) throw new Error('명부에 법정동 열이 없으면 "기본 법정동"을 입력해 주세요 (예: 용현동)');
      for (const d of dongs) { await dongCode(d || $r('rvDong').value); }
      R.parcels.forEach(p => { const d = p.dong || $r('rvDong').value; p.dong = d; p.pnu = pnuOf(R.dongCodes[d].code, p.jibun); });
      // 지적도: 대표 위치에서 바둑판으로 넓혀 가며 받기
      msg('rvMsg2', '지적도 받는 중…');
      const need = new Set(R.parcels.map(p => p.pnu));
      const done = new Set(); const DX = 0.004, DY = 0.003;
      const seeds = Object.values(R.dongCodes).map(c => [Math.floor(c.lon / DX), Math.floor(c.lat / DY)]);
      const queue = [...seeds]; let n = 0;
      while (queue.length && n < 120) {
        const [ix, iy] = queue.shift(); const k = ix + ',' + iy; if (done.has(k)) continue; done.add(k); n++;
        const box = `BOX(${(ix * DX).toFixed(4)},${(iy * DY).toFixed(4)},${((ix + 1) * DX).toFixed(4)},${((iy + 1) * DY).toFixed(4)})`;
        let feats = [];
        try { feats = await VWorld.dataAll('LP_PA_CBND_BUBUN', box, 10); } catch (e) { await sleep(1500); try { feats = await VWorld.dataAll('LP_PA_CBND_BUBUN', box, 10); } catch (e2) { feats = []; } }
        let hit = 0; feats.forEach(f => { R.cadAll[f.properties.pnu] = f; if (need.has(f.properties.pnu)) hit++; });
        const found = [...need].filter(p => R.cadAll[p]).length;
        prog(found / need.size * 0.5);
        msg('rvMsg2', `지적도: 구획 ${n}개 조회, 명부 필지 ${found}/${need.size} 찾음`);
        if (found === need.size) break;
        if (hit > 0 || n <= seeds.length) [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(([a, b]) => queue.push([ix + a, iy + b]));
        await sleep(300);
      }
      R.parcels.forEach(p => { p.feat = R.cadAll[p.pnu] || null; if (p.feat) { p.jiga = +p.feat.properties.jiga || p.jiga || 0; p.cadArea = turf.area(p.feat); } });
      const miss = R.parcels.filter(p => !p.feat);
      // 토지특성
      if ($r('rvChar').checked) {
        const yr = new Date().getFullYear();
        for (let i = 0; i < R.parcels.length; i++) {
          const p = R.parcels[i];
          try {
            let d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu: p.pnu, key: VWorld.key, domain: VWorld.domain, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(yr) }, 15000);
            let f = d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0];
            if (!f) { d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu: p.pnu, key: VWorld.key, domain: VWorld.domain, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(yr - 1) }, 15000); f = d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0]; }
            if (f) { p.ledgerArea = +f.lndpclAr; p.ledgerJimok = f.lndcgrCodeNm; p.zoning = [f.prposArea1Nm, f.prposArea2Nm].filter(x => x && x !== '지정되지않음').join(', '); p.jiga = +f.pblntfPclnd || p.jiga; p.baseYear = f.stdrYear; p.landUse = f.ladUseSittnNm; }
            else p.charMissing = true;
          } catch (e) { p.charError = e.message; await sleep(1200); }
          if (i % 5 === 0) { prog(0.5 + 0.5 * (i + 1) / R.parcels.length); msg('rvMsg2', `토지특성 ${i + 1}/${R.parcels.length}`); }
          await sleep(250);
        }
      }
      prog(1);
      R.fetched = true;
      buildZone();
      await cutRoads().catch(e => msg('rvMsg3', '경계 도로 자르기 오류: ' + e.message, true));
      msg('rvMsg2', `완료: 지적도 ${R.parcels.length - miss.length}/${R.parcels.length}필지` + (miss.length ? `\n지적도에서 못 찾은 필지: ${miss.slice(0, 30).map(p => p.jibun).join(', ')}${miss.length > 30 ? ' …' : ''}` : ''));
    } finally { R.busy = false; }
  }

  // ---------------------------------------------------------------
  // 3. 구역 (명부 필지 전체를 합친 경계)
  // ---------------------------------------------------------------
  function unionAll(F) {
    if (!F.length) return null;
    let U = typeof RoadCut !== 'undefined' ? RoadCut.treeUnion(F) : F.reduce((a, f) => { try { return turf.union(a, f); } catch (e) { return a; } });
    try { U = turf.buffer(turf.buffer(U, 0.4, { units: 'meters' }), -0.4, { units: 'meters' }); } catch (e) { }
    return U;
  }
  function buildZone() {
    const F = R.parcels.filter(p => p.feat).map(p => p.feat);
    if (!F.length) return;
    R.zoneFull = R.zone = unionAll(F);
    if (R.cutDone) R.zone = unionAll(zoneFeats()) || R.zoneFull;
    checkShape();
    runChecks(); drawMap();
  }

  // 구역계 선형 점검: 지적선 그대로인 구간도 포함해 경계가 매끄럽지 않은 곳을 찾음
  //   함몰부 = 폭 20m 이하로 움푹 들어간 곳(닫힘 연산으로 메워지는 곳), 돌출부 = 폭 10m 이하로 튀어나온 곳(열림 연산으로 깎이는 곳)
  //   구멍 = 구역 안에 둘러싸인 빈칸(5㎡ 이상), 조각 = 본 구역과 떨어진 덩어리. 20㎡ 미만은 지적 오차로 봄
  function checkShape() {
    R.shapeIssues = [];
    const Z = R.zone; if (!Z) return;
    const own = new Set(R.parcels.map(p => p.pnu));
    const polyList = g => !g ? [] : (g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.type === 'MultiPolygon' ? g.geometry.coordinates : []).filter(c => c[0] && c[0].length >= 4).map(c => turf.polygon(c));
    const lotsIn = f => { const bb = turf.bbox(f); return Object.values(R.cadAll).filter(x => { const b = turf.bbox(x); if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) return false; try { const i = turf.intersect(x, f); return i && turf.area(i) > 3; } catch (e) { return false; } })
      .map(x => ({ jibun: String(x.properties.jibun || '').replace(/\s+/g, ''), roster: own.has(x.properties.pnu) })).slice(0, 10); };
    const add = (type, f) => { const a = turf.area(f); R.shapeIssues.push({ type, geom: f, area: a, lots: lotsIn(f) }); };
    try { polyList(turf.difference(turf.buffer(turf.buffer(Z, 10, { units: 'meters' }), -10, { units: 'meters' }), Z)).filter(f => turf.area(f) >= 20).forEach(f => add('notch', f)); } catch (e) { }
    try { polyList(turf.difference(Z, turf.buffer(turf.buffer(Z, -5, { units: 'meters' }), 5, { units: 'meters' }))).filter(f => turf.area(f) >= 20).forEach(f => add('spike', f)); } catch (e) { }
    const zs = polyList(Z);
    zs.forEach(pl => pl.geometry.coordinates.slice(1).filter(h => h.length >= 4).map(h => turf.polygon([h])).filter(h => turf.area(h) >= 5).forEach(h => add('hole', h)));
    if (zs.length > 1) { const big = zs.reduce((a, b) => turf.area(a) > turf.area(b) ? a : b); zs.filter(z => z !== big).forEach(z => add('island', z)); }
    checkPlanEdges();
  }
  const SHAPE_NAME = { notch: '움푹 들어간 곳(함몰부)', spike: '튀어나온 곳(돌출부)', hole: '구역 안 빈칸(구멍)', island: '본 구역과 떨어진 조각', noplan: '도시계획도로를 따르지 않는 경계 구간' };

  // ---------------------------------------------------------------
  // 3-4. 판단 화면 그림: 추진위원회 등에 설명할 수 있게 필지마다 판단 화면을 그림으로 남김
  //   배경 지도 없이 지적선·명부 필지·구역 경계·신청 도면 구역선·들어가는 부분/잘라낸 부분·지번을 직접 그림
  // ---------------------------------------------------------------
  function judgeLines(p) {
    const it = (R.items || []).find(i => i.id === `L|${p.key}|cut` || i.id === `L|${p.key}|in`);
    const c = it ? it.choice : cutChoice(p);
    const lab = it ? ((it.opts.find(o => o[0] === c) || [])[1] || '판단 전') : '';
    return { it, c, lab, basis: it ? (it.manual ? '직접 선택' : it.basis || '') : '' };
  }
  function parcelGeomFor(p, k) {
    const f = cutField(k); if (f) return p[f] && p[f].geom;
    if (k === 'none' || k === 'drop') return null;
    if (k === 'drawn' && R.drawn) { try { const x = turf.intersect(p.feat, R.drawn); return x && x.geometry; } catch (e) { return null; } }
    return p.feat.geometry;
  }
  // 위치도(축소도): 구역 전체 윤곽 위에 지금 보는 범위(bb = [서,남,동,북])를 빨간 네모로
  function drawOverview(g, x, y, w, h, bb) {
    if (!R.zone) return;
    g.save();
    g.fillStyle = 'rgba(255,255,255,.95)'; g.fillRect(x, y, w, h); g.strokeStyle = '#555'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const zb = turf.bbox(R.zone), lat0 = (zb[1] + zb[3]) / 2, kx = Math.cos(lat0 * Math.PI / 180), pad = 8;
    const s = Math.min((w - 2 * pad) / ((zb[2] - zb[0]) * kx), (h - 2 * pad - 14) / (zb[3] - zb[1]));
    const ox = x + (w - (zb[2] - zb[0]) * kx * s) / 2, oy = y + 14 + (h - 14 - (zb[3] - zb[1]) * s) / 2;
    const X = lon => ox + (lon - zb[0]) * kx * s, Y = lat => oy + (zb[3] - lat) * s;
    const geom = R.zone.geometry, polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    g.beginPath(); polys.forEach(pl => pl.forEach(r => { r.forEach(([a, b], i) => i ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b))); g.closePath(); }));
    g.fillStyle = '#fbe7c0'; g.fill('evenodd'); g.strokeStyle = '#e67e00'; g.lineWidth = 1.5; g.stroke();
    if (bb) {
      let rx = X(bb[0]), ry = Y(bb[3]), rw = X(bb[2]) - rx, rh = Y(bb[1]) - ry;
      if (rw < 8) { rx -= (8 - rw) / 2; rw = 8; } if (rh < 8) { ry -= (8 - rh) / 2; rh = 8; }
      g.strokeStyle = '#d10000'; g.lineWidth = 2; g.strokeRect(rx, ry, rw, rh);
    }
    g.fillStyle = '#333'; g.font = 'bold 11px "Malgun Gothic", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('위치도(구역 전체)', x + 6, y + 3);
    g.restore();
  }
  // 검토 지도 지번 글자: 18 이상 확대하면 보이는 범위의 필지마다(최대 400개). 명부 필지는 진하게, 명부 밖은 "(밖)"
  function mapLabels() {
    if (!R.leaflet) return;
    if (!R.lblLayer) { R.lblLayer = L.layerGroup().addTo(R.leaflet); R.leaflet.on('moveend zoomend', mapLabels); }
    R.lblLayer.clearLayers();
    if (R.leaflet.getZoom() < 18) return;
    const b = R.leaflet.getBounds(), own = new Set(R.parcels.map(p => p.pnu));
    Object.values(R.cadAll).filter(f => { const x = turf.bbox(f); return !(x[2] < b.getWest() || x[0] > b.getEast() || x[3] < b.getSouth() || x[1] > b.getNorth()); }).slice(0, 400).forEach(f => {
      let pt; try { pt = turf.pointOnFeature(f).geometry.coordinates; } catch (e) { return; }
      const r = own.has(f.properties.pnu), t = String(f.properties.jibun || '').replace(/\s+/g, '');
      R.lblLayer.addLayer(L.marker([pt[1], pt[0]], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', iconSize: null, html: `<span style="font:${r ? 'bold ' : ''}11px 'Malgun Gothic',sans-serif;color:${r ? '#111' : '#666'};white-space:nowrap;text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 2px #fff;transform:translate(-50%,-50%);display:inline-block">${esc(t)}${r ? '' : '(밖)'}</span>` }) }));
    });
  }
  // 검토 지도 오른쪽 위의 위치도(지도를 움직이면 빨간 네모가 따라감)
  function mapOverview() {
    if (!R.leaflet || R.ovCtl) return;
    const Ctl = L.Control.extend({ options: { position: 'topright' }, onAdd() { const c = L.DomUtil.create('canvas'); c.width = 200; c.height = 150; c.style.cssText = 'border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.3)'; L.DomEvent.disableClickPropagation(c); this.c = c; return c; } });
    R.ovCtl = new Ctl(); R.ovCtl.addTo(R.leaflet);
    const redraw = () => { const c = R.ovCtl.c, g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); const b = R.leaflet.getBounds(); drawOverview(g, 0, 0, c.width, c.height, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); };
    R.leaflet.on('moveend zoomend', redraw); R.ovRedraw = redraw; setTimeout(redraw, 200);
  }
  function drawJudge(p, W = 1000, H = 720) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const top = 70, bottom = 46;
    let bb = turf.bbox(turf.buffer(p.feat, 25, { units: 'meters' }));
    const lat0 = (bb[1] + bb[3]) / 2, kx = Math.cos(lat0 * Math.PI / 180);
    let w = (bb[2] - bb[0]) * kx, h = bb[3] - bb[1];
    const ar = W / (H - top - bottom); if (w / h < ar) { const d = (h * ar - w) / 2 / kx; bb = [bb[0] - d, bb[1], bb[2] + d, bb[3]]; w = h * ar; } else { const d = (w / ar - h) / 2; bb = [bb[0], bb[1] - d, bb[2], bb[3] + d]; h = w / ar; }
    const sx = W / w, X = lon => (lon - bb[0]) * kx * sx, Y = lat => top + (bb[3] - lat) * sx;
    const path = geom => { if (!geom) return; const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []; polys.forEach(pl => pl.forEach(r => { r.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); })); };
    const inView = f => { const b = turf.bbox(f); return !(b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]); };
    const geomOf = f => f.geometry || f;
    const own = new Set(R.parcels.map(q => q.pnu));
    const cads = Object.values(R.cadAll).filter(inView);
    g.save(); g.beginPath(); g.rect(0, top, W, H - top - bottom); g.clip();
    // 필지 면 + 지적선
    cads.forEach(f => { g.beginPath(); path(f.geometry); g.fillStyle = own.has(f.properties.pnu) ? '#fbe7c0' : '#ffffff'; g.fill('evenodd'); });
    // 잘라낸 부분(회색)·들어가는 부분(파랑)
    const { c } = judgeLines(p), inG = parcelGeomFor(p, c || 'roster');
    let outG = null; try { outG = inG ? turf.difference(p.feat, turf.feature(inG)) : p.feat; } catch (e) { }
    if (outG) { g.beginPath(); path(geomOf(outG)); g.fillStyle = 'rgba(107,114,128,.55)'; g.fill('evenodd'); }
    if (inG) { g.beginPath(); path(inG); g.fillStyle = 'rgba(59,130,246,.45)'; g.fill('evenodd'); }
    g.lineWidth = 0.9; g.strokeStyle = '#444'; cads.forEach(f => { g.beginPath(); path(f.geometry); g.stroke(); });
    // 구역 경계(주황), 신청 도면 구역선(파란 점선), 이 필지(검은 점선)
    if (R.zone) { g.beginPath(); path(geomOf(R.zone)); g.lineWidth = 7; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 4; g.strokeStyle = '#d00000'; g.stroke(); }
    if (R.drawn) { g.beginPath(); path(geomOf(R.drawn)); g.lineWidth = 2; g.setLineDash([10, 4, 2, 4]); g.strokeStyle = '#1a1aff'; g.stroke(); g.setLineDash([]); }
    g.beginPath(); path(p.feat.geometry); g.lineWidth = 2.5; g.setLineDash([8, 5]); g.strokeStyle = '#111'; g.stroke(); g.setLineDash([]);
    // 지번 글자
    g.font = '11px "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    cads.forEach(f => {
      const a = turf.area(f); if (a < 25 && f.properties.pnu !== p.pnu) return;
      let pt; try { pt = turf.pointOnFeature(f).geometry.coordinates; } catch (e) { return; }
      const x = X(pt[0]), y = Y(pt[1]); if (x < 10 || x > W - 10 || y < top + 8 || y > H - bottom - 8) return;
      const t = String(f.properties.jibun || '').replace(/\s+/g, '');
      g.fillStyle = f.properties.pnu === p.pnu ? '#000' : '#555'; g.font = f.properties.pnu === p.pnu ? 'bold 14px "Malgun Gothic", sans-serif' : '11px "Malgun Gothic", sans-serif';
      g.fillText(t, x, y);
    });
    g.restore();
    // 위치도: 오른쪽 위에 구역 전체와 이 그림 범위
    drawOverview(g, W - 214, top + 8, 206, 156, bb);
    // 제목·판단 내용
    const j = judgeLines(p), base = p.ledgerArea || p.area1;
    const inA = j.c && cutField(j.c) ? p[cutField(j.c)].inArea : j.c === 'roster' ? base : j.c === 'drawn' ? Math.round((p.drawnIn || 0) * 10) / 10 : j.c === 'none' || j.c === 'drop' ? 0 : base;
    g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = 'bold 20px "Malgun Gothic", sans-serif';
    g.fillText(`${$r('rvName').value || ''}  ${p.dong || ''} ${p.jibun}  (${p.ledgerJimok || p.jimok || ''} · 토지대장 ${fmtN(base)}㎡)`, 14, 28);
    g.font = '15px "Malgun Gothic", sans-serif';
    g.fillText(`판단: ${j.lab || '전체 편입'} → 편입 ${fmtN(inA)}㎡ · 구역 밖 ${fmtN(Math.max(0, (base || 0) - (inA || 0)))}㎡${j.basis ? `   (근거: ${j.basis})` : ''}`, 14, 54);
    // 범례·축척 (아래 띠를 흰색으로 지운 뒤 그림)
    g.fillStyle = '#fff'; g.fillRect(0, H - bottom, W, bottom);
    g.strokeStyle = '#ccc'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H - bottom + 0.5); g.lineTo(W, H - bottom + 0.5); g.stroke();
    const ly = H - 20; let lx = 14; g.textBaseline = 'middle'; g.textAlign = 'left';
    const leg = (draw, t) => { g.save(); draw(lx, ly); g.restore(); g.fillStyle = '#333'; g.font = '12px "Malgun Gothic", sans-serif'; g.fillText(t, lx + 26, ly); lx += 26 + g.measureText(t).width + 16; };
    leg((x, y) => { g.fillStyle = 'rgba(59,130,246,.45)'; g.fillRect(x, y - 6, 20, 12); }, '구역에 들어가는 부분');
    leg((x, y) => { g.fillStyle = 'rgba(107,114,128,.55)'; g.fillRect(x, y - 6, 20, 12); }, '구역 밖(잘라낸 부분)');
    leg((x, y) => { g.strokeStyle = '#d00000'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20, y); g.stroke(); }, '구역 경계');
    leg((x, y) => { g.strokeStyle = '#1a1aff'; g.lineWidth = 2; g.setLineDash([6, 3, 2, 3]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20, y); g.stroke(); g.setLineDash([]); }, '신청 도면 구역선');
    leg((x, y) => { g.strokeStyle = '#444'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20, y); g.stroke(); }, '지적선');
    leg((x, y) => { g.fillStyle = '#fbe7c0'; g.fillRect(x, y - 6, 20, 12); g.strokeStyle = '#444'; g.strokeRect(x, y - 6, 20, 12); }, '명부 필지');
    const ppm = sx / 110574;   // sx는 위도 1도당 픽셀 → 1m당 픽셀
    const m = [100, 50, 20, 10, 5, 2, 1].find(v => v * ppm <= 160) || 1, bw = m * ppm, bx = W - 20 - bw;   // 축척 막대는 160px 이하로
    g.strokeStyle = '#111'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, ly); g.lineTo(bx + bw, ly); g.moveTo(bx, ly - 5); g.lineTo(bx, ly + 5); g.moveTo(bx + bw, ly - 5); g.lineTo(bx + bw, ly + 5); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.fillText(`${m}m`, bx + bw / 2, ly - 11);
    g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.font = '11px "Malgun Gothic", sans-serif'; g.fillStyle = '#777'; g.fillText(`지적: 연속지적도(브이월드) · 면적: 토지대장 × 편입 비율 · ${new Date().toLocaleDateString('ko-KR')}`, W - 14, 28);
    return cv;
  }
  // 로드뷰 링크(카카오맵·다음지도): 필지 안의 한 점(도로는 도로 위) 좌표로 새 창에서 엶. 인증키 필요 없음
  function roadviewLinks(p) {
    let c; try { c = turf.pointOnFeature(p.feat).geometry.coordinates; } catch (e) { return null; }
    const ll = `${c[1].toFixed(6)},${c[0].toFixed(6)}`;
    // 네이버는 좌표로 거리뷰를 바로 여는 링크가 없어 그 위치의 네이버 지도를 엶(지도에서 "거리뷰" 단추)
    return { kakao: `https://map.kakao.com/link/roadview/${ll}`, daum: `https://map.daum.net/link/roadview/${ll}`, naver: `https://map.naver.com/p?c=${c[0].toFixed(6)},${c[1].toFixed(6)},19,0,0,0,dh` };
  }

  // 화면 안 로드뷰(카카오): 필지에서 가까운 로드뷰를 지도 아래에 띄우고, 사진 위에 필지 경계점·지번 글자를 얹음
  //   지도에는 로드뷰 촬영 위치와 보는 방향을 표시. 카카오 키(config.js KAKAO_JS_KEY)와 도메인 등록이 필요
  const KRV = { rv: null, client: null, overlays: [], cam: null, p: null };
  function kakaoReady() {
    if (window.kakao && kakao.maps && kakao.maps.Roadview) return Promise.resolve();
    if (typeof KAKAO_JS_KEY === 'undefined' || !KAKAO_JS_KEY) return Promise.reject(new Error('카카오 지도 키가 없습니다(config.js)'));
    return new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`;
      s.onload = () => { try { kakao.maps.load(ok); } catch (e) { no(e); } };
      s.onerror = () => no(new Error('카카오 지도를 불러오지 못했습니다(도메인 등록·카카오맵 사용 설정 확인)'));
      document.head.appendChild(s);
    });
  }
  // 직접 자를 때: 지도에 찍는 점을 로드뷰 사진에도 노란 점으로 보여 주고 그쪽을 바라봄
  function rvShowDrawing(latlngs) {
    if (!KRV.rv || $r('rvRvBox').hidden) return;
    (KRV.drawOv || []).forEach(o => o.setMap(null)); KRV.drawOv = [];
    latlngs.forEach((ll, i) => {
      const el = document.createElement('div');
      el.style.cssText = 'min-width:18px;height:18px;padding:0 3px;border-radius:9px;background:#16a34a;border:2px solid #fff;box-shadow:0 0 3px #000;font:bold 11px sans-serif;color:#fff;text-align:center;line-height:18px';
      el.textContent = String(i + 1);
      const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(ll.lat, ll.lng), content: el, yAnchor: 0.5, xAnchor: 0.5 }); o.setMap(KRV.rv); KRV.drawOv.push(o);
    });
    const last = latlngs[latlngs.length - 1], pos = KRV.rv.getPosition();
    if (last && pos) KRV.rv.setViewpoint({ pan: (turf.bearing(turf.point([pos.getLng(), pos.getLat()]), turf.point([last.lng, last.lat])) + 360) % 360, tilt: 0, zoom: 0 });
  }
  function closeRoadview() {
    $r('rvRvBox').hidden = true; $r('rvMap').style.height = '';
    (KRV.drawOv || []).forEach(o => o.setMap(null)); KRV.drawOv = [];
    if (R.leaflet) setTimeout(() => R.leaflet.invalidateSize(), 50);
    KRV.overlays.forEach(o => o.setMap(null)); KRV.overlays = [];
    if (KRV.cam && R.leaflet) { R.leaflet.removeLayer(KRV.cam); KRV.cam = null; }
  }
  async function openRoadview(p) {
    if (!p || !p.feat) return;
    const box = $r('rvRvBox'), info = $r('rvRvInfo');
    box.hidden = false; info.textContent = `${p.jibun} 근처 로드뷰를 찾는 중…`;
    // 지도와 로드뷰가 한 화면에 들어오게 지도 높이를 줄임
    $r('rvMap').style.height = 'calc(100vh - 160px)'; $r('rvRv').style.height = '420px'; if (R.leaflet) setTimeout(() => R.leaflet.invalidateSize(), 50);
    try { await kakaoReady(); } catch (e) { info.textContent = e.message; return; }
    const div = $r('rvRv');
    if (!KRV.rv) {
      KRV.rv = new kakao.maps.Roadview(div); KRV.client = new kakao.maps.RoadviewClient();
      kakao.maps.event.addListener(KRV.rv, 'init', () => onRvInit());
      kakao.maps.event.addListener(KRV.rv, 'viewpoint_changed', () => drawCam());
      kakao.maps.event.addListener(KRV.rv, 'position_changed', () => drawCam());
    }
    KRV.p = p; KRV.cut = cutLineOf(p);
    // 자른 필지면 자른 선 가운데에서, 아니면 필지 안 한 점에서 가장 가까운 로드뷰
    const c = KRV.cut ? KRV.cut.mid : turf.pointOnFeature(p.feat).geometry.coordinates, ll = new kakao.maps.LatLng(c[1], c[0]);
    const tryR = r => new Promise(res => KRV.client.getNearestPanoId(ll, r, id => res(id)));
    let id = await tryR(30); if (!id) id = await tryR(80);
    if (!id) { info.textContent = `${p.jibun} 근처 80m 안에 로드뷰 사진이 없습니다.`; return; }
    KRV.rv.setPanoId(id, ll);
    info.textContent = `${p.dong || ''} ${p.jibun} — 사진 위 빨간 점은 이 필지의 지적 경계점, 글자는 필지 위치입니다(사진 촬영 위치 오차로 1~2m 어긋날 수 있음). 끌어서 둘러볼 수 있습니다.`;
    setTimeout(() => KRV.rv.relayout(), 50);
  }
  // 지금 판단으로 이 필지를 자른 선: 들어가는 부분의 경계 중 필지 바깥 경계가 아닌 곳(=자른 선)에 2m마다 점
  function cutLineOf(p) {
    const c = cutChoice(p), f = cutField(c), g = f && p[f] && p[f].geom;
    if (!g) return null;
    const outer = turf.polygonToLine(p.feat), lines = outer.type === 'FeatureCollection' ? outer.features : [outer];
    const nearOuter = pt => lines.some(l => turf.pointToLineDistance(turf.point(pt), l, { units: 'meters' }) < 0.4);
    const pts = [];
    (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach(pl => {
      const ring = pl[0];
      for (let k = 0; k + 1 < ring.length; k++) {
        const L2 = turf.distance(turf.point(ring[k]), turf.point(ring[k + 1]), { units: 'meters' }), n = Math.max(1, Math.round(L2 / 2));
        for (let s = 0; s < n; s++) { const t = s / n, pt = [ring[k][0] + (ring[k + 1][0] - ring[k][0]) * t, ring[k][1] + (ring[k + 1][1] - ring[k][1]) * t]; if (!nearOuter(pt)) pts.push(pt); }
      }
    });
    if (!pts.length) return null;
    let inC = null, outC = null;
    try { inC = turf.pointOnFeature(turf.feature(g)).geometry.coordinates; } catch (e) { }
    try { const o = turf.difference(p.feat, turf.feature(g)); if (o) outC = turf.pointOnFeature(o).geometry.coordinates; } catch (e) { }
    return { pts, mid: pts[Math.floor(pts.length / 2)], inC, outC };
  }
  function onRvInit() {
    const p = KRV.p; if (!p) return;
    KRV.overlays.forEach(o => o.setMap(null)); KRV.overlays = [];
    const put = (xy, el, ya = 0.5) => { const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(xy[1], xy[0]), content: el, yAnchor: ya, xAnchor: 0.5 }); o.setMap(KRV.rv); KRV.overlays.push(o); };
    const dot = (size, color) => { const el = document.createElement('div'); el.style.cssText = `width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${color};border:2px solid #fff;box-shadow:0 0 3px #000`; return el; };
    const tag = (text, border, bg) => { const el = document.createElement('div'); el.style.cssText = `padding:4px 8px;background:${bg};border:2px solid ${border};border-radius:6px;font:bold 14px "Malgun Gothic",sans-serif;color:#111;white-space:nowrap`; el.textContent = text; return el; };
    // 필지 경계점(작은 빨간 점): 외곽 꼭짓점, 많으면 고르게 30개까지
    const ring = (p.feat.geometry.type === 'Polygon' ? p.feat.geometry.coordinates : p.feat.geometry.coordinates[0])[0];
    const step = Math.max(1, Math.ceil(ring.length / 30));
    ring.filter((_, i) => i % step === 0).forEach(xy => put(xy, dot(9, '#e11')));
    const j = judgeLines(p), cut = KRV.cut;
    if (cut) {
      // 자른 선(노란 점)과 넣은/뺀 부분 글자
      cut.pts.forEach(xy => put(xy, dot(14, '#ffd400')));
      put(cut.mid, tag(`✂ 자른 선 (${p.jibun})`, '#c99a00', 'rgba(255,248,200,.95)'), 1.4);
      const base = p.ledgerArea || p.area1, co = cutOf(p);
      if (cut.inC) put(cut.inC, tag(`넣은 부분 ${fmtN(co.inArea)}㎡`, '#1d4ed8', 'rgba(219,234,254,.95)'), 1);
      if (cut.outC) put(cut.outC, tag(`뺀 부분 ${fmtN(Math.max(0, (base || 0) - co.inArea))}㎡`, '#555', 'rgba(229,231,235,.95)'), 1);
    } else {
      const c = turf.pointOnFeature(p.feat).geometry.coordinates;
      put(c, tag(`${p.jibun} ${p.ledgerJimok || p.jimok || ''} · ${j.lab || '판단 전'}`, '#e11', 'rgba(255,255,255,.92)'), 1);
    }
    // 자른 선(없으면 필지) 쪽을 바라보게
    const target = cut ? cut.mid : turf.pointOnFeature(p.feat).geometry.coordinates;
    const pos = KRV.rv.getPosition(), b = turf.bearing(turf.point([pos.getLng(), pos.getLat()]), turf.point(target));
    KRV.rv.setViewpoint({ pan: (b + 360) % 360, tilt: 0, zoom: 0 });
    $r('rvRvInfo').textContent = `${p.dong || ''} ${p.jibun} — 사진 촬영 위치 오차로 점이 1~2m 어긋날 수 있습니다. 끌어서 둘러볼 수 있습니다.`;
    drawCam();
  }
  // 지도에 로드뷰 촬영 위치(점)와 보는 방향(부채꼴)
  function drawCam() {
    if (!KRV.rv || !R.leaflet) return;
    const pos = KRV.rv.getPosition(); if (!pos) return;
    const vp = KRV.rv.getViewpoint(), at = [pos.getLng(), pos.getLat()];
    const fan = [at, ...[-30, -15, 0, 15, 30].map(d => turf.destination(turf.point(at), 0.025, vp.pan + d).geometry.coordinates), at];
    if (KRV.cam) R.leaflet.removeLayer(KRV.cam);
    KRV.cam = L.layerGroup([
      L.polygon(fan.map(([x, y]) => [y, x]), { color: '#e11', weight: 1, fillColor: '#ff5a5a', fillOpacity: 0.3, interactive: false }),
      L.circleMarker([at[1], at[0]], { radius: 6, color: '#fff', weight: 2, fillColor: '#e11', fillOpacity: 1, interactive: false }),
    ]).addTo(R.leaflet);
  }

  // 판단할 때마다 자동 기록 (그 순간의 화면 그림 + 판단 내용). 설명자료의 "변경 이력"과 필지별 최종 화면에 씀
  function snapJudge(p, how) {
    if (!p || !p.feat) return;
    try {
      const j = judgeLines(p);
      R.snapLog = R.snapLog || [];
      R.snapLog.push({ key: p.key, jibun: p.jibun, at: new Date().toLocaleString('ko-KR'), lab: j.lab || '전체 편입', how: how || '', img: drawJudge(p, 800, 576).toDataURL('image/png') });
    } catch (e) { console.warn('판단 화면 기록 실패', e); }
  }
  function saveJudgePng(p) {
    const cv = drawJudge(p);
    cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${$r('rvName').value || '정비구역'}_${p.jibun}_구역계판단.png`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }, 'image/png');
  }
  // 경계 필지 전체 판단 설명자료 (새 창, 인쇄·PDF 저장용)
  //   judgeHtml(): 설명자료 HTML (필지별 최종 화면·판단·근거·비교 + 판단 변경 이력). 검토 완료 때 자동으로 파일로 내려받고, 버튼으로 새 창에서도 봄
  function judgeReport() {
    const html = judgeHtml(); if (!html) return;
    const win = window.open('', '_blank'); if (!win) return msg('rvMsg3', '새 창이 막혀 있습니다(팝업 차단 해제 필요).', true);
    win.document.write(html.replace('</body>', '<script>setTimeout(()=>window.print(),600)<\/script></body>')); win.document.close();
  }
  // 검토 작업 저장·불러오기: 공부 조회 결과·신청 도면 구역선·판단·직접 자른 모양·판단 화면 기록을 파일 하나로.
  //   소유자 등 개인정보(명부 행)는 넣지 않음 → 다른 PC에서 이어서 구역계 검토 가능(명부 대조·조서 소유자 칸은 명부를 다시 올려야 함)
  const WORK_KIND = 'jbslab-review-work';
  const PKEEP = ['key', 'pnu', 'feat', 'cadArea', 'ledgerArea', 'ledgerJimok', 'zoning', 'jiga', 'landUse', 'baseYear', 'dong', 'jibun', 'jimok', 'area1', 'areaIn', 'area'];
  function saveWork() {
    if (!R.parcels.length || !R.fetched) return msg('rvMsgW', '② 공부 조회까지 한 뒤에 저장할 수 있습니다.', true);
    const W = { kind: WORK_KIND, v: 1, savedAt: new Date().toISOString(),
      name: $r('rvName').value, sigungu: $r('rvSigungu').value, dong: $r('rvDong').value,
      parcels: R.parcels.map(p => Object.fromEntries(PKEEP.map(k => [k, p[k] ?? null]))),
      cadAll: R.cadAll, dongCodes: R.dongCodes, lands: (S.lands || []).map(({ owner, ...l }) => l), buildings: S.buildings, expos: S.exposUnits,
      drawn: R.drawn || null, fit: R.fit || null, choices: R.choices,
      cutM: Object.fromEntries(R.parcels.filter(p => p.cutM && p.cutM.geom).map(p => [p.key, p.cutM.geom])),
      snapLog: R.snapLog || [] };
    const d = new Date(), stamp = `${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(W)], { type: 'application/json' }));
    a.download = `${W.name || '정비구역'}_검토작업_${stamp}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    msg('rvMsgW', `저장했습니다: 필지 ${fmtN(W.parcels.length)}개, 판단 ${Object.keys(W.choices).length}건, 직접 자른 필지 ${Object.keys(W.cutM).length}개, 판단 화면 ${W.snapLog.length}장 (소유자 정보는 넣지 않음)`);
  }
  async function loadWork(file) {
    const W = JSON.parse(await file.text());
    if (!W || W.kind !== WORK_KIND) throw new Error('검토 작업 파일이 아닙니다.');
    msg('rvMsgW', '불러오는 중… (경계 도로를 다시 자르느라 1분쯤 걸립니다)');
    $r('rvName').value = W.name || ''; if (W.sigungu) $r('rvSigungu').value = W.sigungu; $r('rvDong').value = W.dong || '';
    R.rows = []; R.owners = []; R.gaps = []; R.map = { area1: 1 }; R.hasBldgCols = false;
    R.parcels = W.parcels.map(p => ({ ...p, rows: [], rosterB: [], ownerType: '', isPublic: false }));
    R.cadAll = W.cadAll || {}; R.dongCodes = W.dongCodes; S.lands = W.lands || []; S.buildings = W.buildings || []; S.exposUnits = W.expos || [];
    R.fetched = true; R.cutDone = false; R.zone = null; R.zoneFull = null; R.drawn = null; R.choices = {}; R.confirmed = null; R.planRoads = null; R.roadLines = null;
    buildZone(); await cutRoads();
    if (W.drawn) { R.drawn = W.drawn; R.fit = W.fit; compareDrawn(); await cutRoads(); compareDrawn(); }
    Object.assign(R.choices, W.choices || {});
    Object.entries(W.cutM || {}).forEach(([k, g]) => { const p = R.parcels.find(q => q.key === k); if (p) p.cutM = makeCut(p, g, { manual: true }); });
    R.snapLog = W.snapLog || [];
    R.zone = null; buildZone();
    msg('rvMsgW', `불러왔습니다 (${new Date(W.savedAt).toLocaleString()} 저장): 필지 ${fmtN(R.parcels.length)}개, 판단 ${Object.keys(W.choices || {}).length}건, 직접 자른 필지 ${Object.keys(W.cutM || {}).length}개. 명부 대조·조서 소유자 칸이 필요하면 ①에 명부를 다시 올리세요.`);
  }
  function downloadJudgeHtml() {
    const html = judgeHtml(); if (!html) return false;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = `${$r('rvName').value || '정비구역'}_구역계판단설명자료.html`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }
  function judgeHtml() {
    if (!R.parcels.some(p => p.feat)) { msg('rvMsg3', '② 공부 조회를 먼저 해 주세요.', true); return null; }
    buildItems();
    const list = (R.items || []).filter(i => /\|(cut|in)$/.test(i.id)).map(i => R.parcels.find(p => p.key === i.id.split('|')[1])).filter(p => p && p.feat);
    if (!list.length) { msg('rvMsg3', '구역계 판단 대상 필지가 없습니다.', true); return null; }
    const z = R.zone ? turf.area(R.zone) : 0, zd = zoneData(), total = zd ? zd.parcels.reduce((a, q) => a + (+q.area || 0), 0) : 0;
    const log = (R.snapLog || []).map(x => `<tr><td>${esc(x.at)}</td><td>${esc(x.jibun)}</td><td>${esc(x.lab)}</td><td>${esc(x.how)}</td></tr>`).join('');
    const rows = list.map(p => {
      const j = judgeLines(p), base = p.ledgerArea || p.area1;
      const alt = CUT_MODES.filter(m => p[m[1]]).map(m => `${m[2]} ${fmtN(p[m[1]].inArea)}㎡`).concat(p.drawnIn != null ? [`신청 도면 약 ${fmtN(p.drawnIn)}㎡`] : []).join(' / ');
      const rv = roadviewLinks(p);
      return `<section><img src="${drawJudge(p).toDataURL('image/png')}"><table><tr><th>필지</th><td>${esc(`${p.dong || ''} ${p.jibun}`)} (${esc(p.ledgerJimok || p.jimok || '')}, 토지대장 ${fmtN(base)}㎡)</td></tr>
        ${rv ? `<tr><th>로드뷰</th><td><a href="${rv.kakao}" target="_blank">카카오맵 로드뷰</a> · <a href="${rv.daum}" target="_blank">다음지도 로드뷰</a> · <a href="${rv.naver}" target="_blank">네이버 지도(거리뷰)</a></td></tr>` : ''}
        <tr><th>판단</th><td><b>${esc(j.lab || '전체 편입')}</b>${j.c == null ? ' <span style="color:#b00020">(판단 필요)</span>' : ''}</td></tr><tr><th>근거</th><td>${esc(j.basis || '')}</td></tr>${alt ? `<tr><th>비교</th><td>${esc(alt)}</td></tr>` : ''}</table></section>`;
    }).join('');
    return (`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc($r('rvName').value || '정비구역')} 구역계 판단 설명자료</title>
<style>body{font-family:"Malgun Gothic",sans-serif;margin:24px;color:#111}h1{font-size:22px;margin:0 0 6px}p.s{color:#444;margin:0 0 18px}section{page-break-inside:avoid;margin:0 0 28px}img{width:100%;max-width:1000px;border:1px solid #ccc}table{border-collapse:collapse;width:100%;max-width:1000px;font-size:13px;margin-top:6px}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{width:70px;background:#f3f4f6}@media print{body{margin:10mm}section{page-break-after:always}}</style></head><body>
<h1>${esc($r('rvName').value || '정비구역')} 구역계 판단 설명자료</h1>
<p class="s">작성 ${new Date().toLocaleString('ko-KR')} · ${esc(roleLabel())} · 판단 대상 경계 필지 ${list.length}개 · 조서 편입면적 합계 ${fmtN(total)}㎡ · 구역(연속지적) ${fmtN(z, 0)}㎡<br>
원칙: 구역경계는 대지경계·도로경계(지적선) 기준, 경계 도로는 접도 도로 불포함(구역계 = 접도 대지 경계선, 관통 도로는 그 선을 이어 끊음). 신청 도면 구역선은 선이 굵어(±1~2m) 어느 쪽인지 참고로만 씀.</p>
${rows}
${log ? `<section><h2 style="font-size:17px">판단 변경 이력</h2><table><tr><th style="width:150px">시각</th><th>필지</th><th>판단</th><th>방식</th></tr>${log}</table></section>` : ''}
</body></html>`);
  }

  // ---------------------------------------------------------------
  // 3-3. 경계 도로 직접 자르기 (지도 아래 판)
  //   자동으로 자른 경계 도로를 하나씩 크게 보며 [직접 자른 대로 / 중심선까지 / 전체 / 빼기 / 도면 구역선대로]를 고르고,
  //   [선 그어 자르기]로 필지를 가로지르는 선을 그어 조각을 나눈 뒤 넣을 조각을 골라 적용. 다른 필지도 지도에서 눌러 자를 수 있음
  // ---------------------------------------------------------------
  // 이 필지의 구역계 판단 항목(경계 도로 cut 또는 도면 구역선 in)
  const itemOf = p => (R.items || []).find(i => i.id === `L|${p.key}|cut`) || (R.items || []).find(i => i.id === `L|${p.key}|in`) || (R.items || []).find(i => i.id === `L|${p.key}|hroad`);
  // 구역계 경계 필지 목록: 판단 항목이 있는 필지를 구역 둘레 시계 방향(북서쪽에서 시작)으로
  function boundaryList() {
    buildItems();
    const ps = R.parcels.filter(p => p.feat && itemOf(p));
    if (!R.zone || !ps.length) return ps;
    const c = turf.centroid(R.zone).geometry.coordinates;
    const ang = p => { const b = turf.bearing(turf.point(c), turf.pointOnFeature(p.feat)); return (b + 360 + 45) % 360; };   // -45°(북서) = 0
    return ps.sort((a, b) => ang(a) - ang(b));
  }
  const Cutter = {
    list: [], i: 0, p: null, pieces: null, picking: false, drawing: false, handler: null, layer: null, panel: null,
    COLORS: ['#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c'],
    LABEL: { manual: '직접 자른 대로', edge: '접도 도로 불포함', lot: '접도 도로 포함', cut: '중심선까지', roster: '전체 넣기(명부대로)', none: '빼기', drawn: '신청 도면 구역선대로' },

    open() {
      if (!R.leaflet || !R.zone) return msg('rvMsg3', '② 공부 조회를 먼저 해 주세요.', true);
      this.close(); this._z = null;
      this.list = boundaryList();
      this.panel = L.DomUtil.create('div', 'roadcut-panel', R.leaflet.getContainer());
      L.DomEvent.disableClickPropagation(this.panel); L.DomEvent.disableScrollPropagation(this.panel);
      this.layer = L.layerGroup().addTo(R.leaflet);
      $r('rvMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (this.list.length) this.show(0); else this.pick();
    },
    close() {
      this.stopDraw(); this.picking = false; this.p = null; this.pieces = null;
      if (this.layer) { this.layer.remove(); this.layer = null; }
      if (this.panel) { this.panel.remove(); this.panel = null; }
      if (R.leaflet) R.leaflet.getContainer().style.cursor = '';
    },
    stopDraw() { this.drawing = false; if (this.handler) { this.handler.disable(); this.handler = null; } },
    bind() {
      // 자르기 창 접기/펼치기(접으면 제목·이동 버튼만 남아 지도가 넓게 보임)
      if (!this.panel.querySelector('.rc-fold')) {
        const f = document.createElement('button'); f.type = 'button'; f.className = 'rc-fold';
        f.textContent = this.folded ? '▴ 펼치기' : '▾ 접기';
        f.onclick = () => { this.folded = !this.folded; this.panel.classList.toggle('folded', this.folded); f.textContent = this.folded ? '▴ 펼치기' : '▾ 접기'; };
        this.panel.prepend(f);
      }
      this.panel.classList.toggle('folded', !!this.folded);
      this.panel.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'prev') this.show(this.i - 1); else if (a === 'next') this.show(this.i + 1);
        else if (a === 'pick') this.pick(); else if (a === 'list') this.list.length ? this.show(this.i) : this.pick();
        else if (a === 'line') this.startLine(); else if (a === 'apply') this.applyPieces(); else if (a === 'plan') this.applyPlan(this.p);
        else if (a === 'png') saveJudgePng(this.p);
        else if (a === 'ok') { const it = itemOf(this.p); if (it) { R.choices[it.id] = it.choice; R.confirmed = null; runChecks(); this.render(); snapJudge(this.p, '자동 판단을 확인함'); if (this.i < this.list.length - 1) this.show(this.i + 1); } }
        else if (a === 'rvIn') openRoadview(this.p);
        else if (a === 'rvK' || a === 'rvD' || a === 'rvN') { const l = roadviewLinks(this.p); if (l) window.open(a === 'rvK' ? l.kakao : a === 'rvD' ? l.daum : l.naver, '_blank', 'noopener'); }
        else if (a === 'undo') { this.stopDraw(); this.pieces = null; this.draw(); this.render(); }
        else this.close();
      });
      const dl = this.panel.querySelector('#rcDelta'), dl0 = dl && dl.innerHTML;
      this.panel.querySelectorAll('[data-k]').forEach(b => {
        b.onclick = () => this.setChoice(b.dataset.k);
        b.onmouseenter = () => {
          this.draw(b.dataset.k);
          if (dl && this.areaOf) { const g = this.geomFor(b.dataset.k); dl.innerHTML = `"${this.LABEL[b.dataset.k]}"로 하면 ` + this.delta(this.areaOf(b.dataset.k), g ? turf.area(turf.feature(g)) : 0); }
        };
        b.onmouseleave = () => { this.draw(); if (dl) dl.innerHTML = dl0; };
      });
      this.panel.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const x = this.pieces[+b.dataset.p]; x.on = !x.on; this.draw(); this.renderPieces(); });
    },
    pick() {
      this.stopDraw(); this.p = null; this.pieces = null; this.picking = true;
      if (this.layer) this.layer.clearLayers();
      R.leaflet.getContainer().style.cursor = 'crosshair';
      this.panel.innerHTML = `<div class="rc-head"><b>직접 자르기</b> · 자를 필지를 지도에서 누르세요. <span class="muted">명부 필지만 고를 수 있습니다.</span></div>
        <div class="rc-nav">${this.list.length ? '<button type="button" data-a="list">경계 도로 목록으로</button>' : ''}<button type="button" data-a="close">닫기</button></div>`;
      this.bind();
    },
    onParcelClick(p) {
      if (!this.panel || !this.picking) return;
      this.picking = false; R.leaflet.getContainer().style.cursor = '';
      if (!this.list.includes(p)) this.list.push(p);
      this.show(this.list.indexOf(p));
    },
    // 판단표 [보기] 등에서 특정 필지로 바로
    showParcel(p) {
      if (!this.panel) this.open();
      if (!this.list.includes(p)) { this.list.push(p); }
      this.show(this.list.indexOf(p));
    },
    show(i) {
      this.stopDraw();
      this.i = Math.max(0, Math.min(this.list.length - 1, i)); this.p = this.list[this.i]; this.pieces = null;
      const b = L.geoJSON(this.p.feat).getBounds();
      R.leaflet.invalidateSize();
      R.leaflet.fitBounds(b, { paddingTopLeft: [50, 40], paddingBottomRight: [50, 210], maxZoom: 20 });   // 아래쪽은 판에 가리므로 비워 둠
      this.totals(); this.draw(); this.render();
    },
    // 지금 조서 편입면적 합계와 이 필지 몫, 구역(연속지적) 면적 → 고를 때 "적용하면 얼마로 바뀌는지" 미리 보여 줌
    totals(re) {
      if (re || !this._z) this._z = zoneData();   // 조서 계산은 무거우므로 바꿀 때만 다시
      const z = this._z; if (!z) return;
      this.T = z.parcels.reduce((a, x) => a + (+x.area || 0), 0);
      this.cur = (z.parcels.find(x => x.key === this.p.key) || { area: 0 }).area || 0;
      this.Z = turf.area(R.zone);
      const g = this.geomFor(cutChoice(this.p) || 'roster');
      this.curCad = g ? turf.area(turf.feature(g)) : 0;
    },
    // 이 필지를 (조서 면적 a, 연속지적 면적 ca)로 바꾸면
    delta(a, ca) {
      const t = this.T - this.cur + a, z = this.Z - this.curCad + ca, d = t - this.T, sgn = x => (x >= 0 ? '+' : '') + fmtN(x);
      return `조서 편입면적 합계 ${fmtN(this.T)} → <b>${fmtN(t)}㎡</b> (${sgn(d)}) · 구역(연속지적) ${fmtN(this.Z, 0)} → <b>${fmtN(z, 0)}㎡</b> (${sgn(Math.round(z - this.Z))})`;
    },
    geomFor(k) {
      const p = this.p;
      const f = cutField(k); if (f) return p[f] && p[f].geom; if (k === 'none') return null;
      if (k === 'drawn' && R.drawn) { try { const x = turf.intersect(p.feat, R.drawn); return x && x.geometry; } catch (e) { return null; } }
      return p.feat.geometry;
    },
    draw(preview) {
      if (!this.layer || !this.p) return;
      const p = this.p; this.layer.clearLayers();
      if (this.pieces) {
        this.pieces.forEach((x, k) => L.geoJSON(x.f, { style: { color: x.color, weight: 2, fillColor: x.color, fillOpacity: x.on ? 0.5 : 0.06, dashArray: x.on ? null : '4 4' } })
          .bindTooltip(`조각 ${k + 1} · ${fmtN(turf.area(x.f))}㎡`, { permanent: true, direction: 'center', className: 'rc-label' })
          .on('click', () => { if (this.drawing) return; x.on = !x.on; this.draw(); this.renderPieces(); }).addTo(this.layer));
      } else {
        const it = itemOf(p), cur = it && /\|in$/.test(it.id) ? ({ drop: 'none', roster: 'roster', drawn: 'drawn' }[it.choice] || 'roster') : (cutChoice(p) || 'roster');
        const g = this.geomFor(preview || cur);
        if (g) L.geoJSON(g, { style: { color: '#1d4ed8', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.45 }, interactive: false }).addTo(this.layer);
      }
      L.geoJSON(p.feat, { style: { color: '#111', weight: 3, dashArray: '8 5', fill: false }, interactive: false })
        .bindTooltip(`${p.jibun} ${p.ledgerJimok || p.jimok || ''} · 대장 ${fmtN(p.ledgerArea)}㎡`, { permanent: true, direction: 'top', className: 'rc-label' }).addTo(this.layer);
    },
    render() {
      const p = this.p, base = p.ledgerArea || p.area1;
      const it = itemOf(p), inItem = it && /\|in$/.test(it.id);
      const c = inItem ? ({ drop: 'none', roster: 'roster', drawn: 'drawn' }[it.choice] || 'roster') : (cutChoice(p) || 'roster');
      const keys = [...CUT_MODES.filter(m => p[m[1]]).map(m => m[0]), 'roster', 'none', ...(p.drawnIn != null ? ['drawn'] : [])];
      const status = !it ? '' : it.choice == null ? '<span class="rc-small">판단 필요</span>' : it.needCheck ? `<span class="rc-small">자동 — 확인 필요 (근거: ${esc(it.basis || '')})</span>` : '<span class="muted">✓ 확인함</span>';
      const areaOf = this.areaOf = k => cutField(k) ? p[cutField(k)].inArea : k === 'roster' ? base : k === 'drawn' ? Math.round(p.drawnIn * 10) / 10 : 0;
      const n = this.list.length;
      this.panel.innerHTML = `
        <div class="rc-head"><b>구역계 경계 필지 ${this.i + 1}/${n}</b> · ${esc(p.jibun)} <span class="muted">${esc(p.ledgerJimok || p.jimok || '')} · 대장 ${fmtN(base)}㎡</span> ${status}
          ${it && it.needCheck ? '<button type="button" data-a="ok" class="primary" style="margin-left:6px">✓ 이대로 확인</button>' : ''}
          ${isRoadP(p) ? '' : '<span class="rc-small">도로가 아닌 필지 — 자르면 분할 측량이 필요합니다</span>'}
          ${!R.choices[`L|${p.key}|cut`] && !p.cutM && p.cutAsk && p.cutAsk.length ? `<br><span class="rc-small">판단 필요: 건너편이 자투리 명부 필지 ${esc(p.cutAsk.join(', '))}라 관통 도로로 본 부분이 있습니다. 넣을지(접도 도로 불포함 그대로) 뺄지 골라 주세요</span>` : ''}</div>
        <div class="rc-opts">${keys.map(k => `<button type="button" data-k="${k}" class="${c === k ? 'on' : ''}">${this.LABEL[k]}<small>${k === 'none' ? '편입 안 함' : fmtN(areaOf(k)) + '㎡ 편입'}</small></button>`).join('')}
          <button type="button" data-a="line">✂ 선 그어 자르기<small>필지를 가로지르는 선</small></button>${planCutGeom(p) ? `<button type="button" data-a="plan">도시계획도로 경계로<small>도로 부분 빼고 관통</small></button>` : ''}</div>
        <p class="rc-note" id="rcDelta">지금 조서 편입면적 합계 <b>${fmtN(this.T)}㎡</b> · 구역(연속지적) <b>${fmtN(this.Z, 0)}㎡</b> · 이 필지 편입 ${fmtN(this.cur)}㎡</p>
        <p class="rc-note muted">파란 면이 구역에 들어가는 부분입니다(조서 면적 = 토지대장 면적 × 들어가는 비율). 버튼에 마우스를 올리면 미리 보고, 바뀌는 면적도 위에 나옵니다.</p>
        <div class="rc-nav"><button type="button" data-a="prev" ${this.i ? '' : 'disabled'}>◀ 이전</button><button type="button" data-a="next" ${this.i < n - 1 ? '' : 'disabled'}>다음 ▶</button>
          <button type="button" data-a="pick">다른 필지 고르기</button><button type="button" data-a="png">📷 이 화면 저장</button><button type="button" data-a="rvIn" class="primary">로드뷰 바로 보기</button><button type="button" data-a="rvK">로드뷰(카카오)</button><button type="button" data-a="rvD">로드뷰(다음)</button><button type="button" data-a="rvN">거리뷰(네이버 지도)</button><button type="button" data-a="close">닫기</button></div>`;
      this.bind();
    },
    setChoice(k) {
      const p = this.p, it = itemOf(p);
      // 도면 구역선 판단 필지(대지 등): 필지 전체/제외/도면대로 → 대지 쪽이 바뀌니 경계 도로도 다시 자름
      if (it && /\|in$/.test(it.id)) {
        R.choices[it.id] = k === 'none' ? 'drop' : k; R.confirmed = null;
        const self = this; cutRoads().then(() => { self.refresh(); snapJudge(p, '경계 필지 판에서 선택'); });
        return;
      }
      if (!hasCut(p) && k === 'roster') return;
      if (!hasCut(p)) p.cutM = makeCut(p, p.feat.geometry, { manual: true });   // 판단 항목을 만들기 위한 자리 (전체)
      R.choices[`L|${p.key}|cut`] = k;
      this.refresh();
      snapJudge(p, '직접 자르기 판에서 선택');
    },
    refresh() {
      R.confirmed = null;
      R.zone = unionAll(zoneFeats()) || R.zoneFull;
      checkShape(); runChecks(); drawMap(true);
      if (this.layer) { this.layer.remove(); this.layer.addTo(R.leaflet); }   // 다시 그린 구역 위에 보이게
      const T0 = this.T, Z0 = this.Z;
      this.totals(true); this.draw(); this.render();
      if (T0 != null) msg('rvMsg3', `${this.p.jibun} 바꿈 → 조서 편입면적 합계 ${fmtN(T0)} → ${fmtN(this.T)}㎡ (${this.T >= T0 ? '+' : ''}${fmtN(this.T - T0)}), 구역(연속지적) ${fmtN(Z0, 0)} → ${fmtN(this.Z, 0)}㎡`);
    },
    startLine() {
      if (!L.Draw) return;
      const p = this.p;
      if (!this.pieces) this.pieces = [{ f: p.feat, on: (cutChoice(p) || 'roster') !== 'none', color: this.COLORS[0] }];
      this.stopDraw(); this.drawing = true; this.draw();
      // 현장 사진을 보며 긋도록 로드뷰를 자동으로 엶(이미 이 필지면 그대로)
      if ($r('rvRvBox').hidden || KRV.p !== p) openRoadview(p);
      this.panel.innerHTML = `<div class="rc-head"><b>선 그어 자르기</b> · ${esc(p.jibun)}</div>
        <p class="rc-note">필지를 <b>완전히 가로지르도록</b> 선을 그으세요. 점을 차례로 누르고 마지막 점을 한 번 더 누르면 끝납니다. 선 끝은 필지 밖으로 조금 나가게 그리면 됩니다.</p>
        <div class="rc-nav"><button type="button" data-a="undo">취소</button></div>`;
      this.bind();
      this.handler = new L.Draw.Polyline(R.leaflet, { shapeOptions: { color: '#16a34a', weight: 3 }, showLength: true, metric: true });   // 지금 긋는 선 = 초록(로드뷰의 찍는 점과 같은 색)
      this.handler.enable();
    },
    onLine(layer) {
      if (!this.drawing || !this.p) return;
      this.stopDraw();
      const line = layer.toGeoJSON(), c = line.geometry.coordinates;
      if (c.length >= 2) {   // 선 양 끝을 3m씩 늘려 경계선 위에서 끝나도 확실히 가로지르게
        const ext = (a, b) => turf.destination(turf.point(a), 0.003, turf.bearing(turf.point(b), turf.point(a)), { units: 'kilometers' }).geometry.coordinates;
        c[0] = ext(c[0], c[1]); c[c.length - 1] = ext(c[c.length - 1], c[c.length - 2]);
      }
      const blade = turf.buffer(line, 0.005, { units: 'meters' });
      const hint = (cutOf(this.p) || this.p.cut || {}).geom;
      const next = []; let split = false;
      this.pieces.forEach(pc => {
        let rest = null; try { rest = turf.difference(pc.f, blade); } catch (e) { }
        const g = rest && rest.geometry, polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        const ps = polys.map(x => turf.polygon(x)).filter(x => turf.area(x) >= 0.05);
        if (ps.length < 2) { next.push(pc); return; }
        split = true;
        ps.forEach(x => {   // 새 조각: 자동 중심선 결과와 반 넘게 겹치면 넣음, 아니면 원래 조각 상태를 따름
          let on = pc.on;
          if (hint) { try { const y = turf.intersect(x, turf.feature(hint)), ya = y ? turf.area(y) : 0; on = ya / turf.area(x) >= 0.5 || ya / turf.area(turf.feature(hint)) >= 0.5; } catch (e) { } }
          next.push({ f: x, on });
        });
      });
      next.forEach((x, k) => { x.color = this.COLORS[k % this.COLORS.length]; });
      this.pieces = next;
      this.draw();
      this.renderPieces(split ? '' : '<b class="warn">선이 필지를 완전히 가로지르지 않았습니다.</b> 필지 바깥에서 시작해 바깥에서 끝나게 다시 그어 주세요.');
    },
    renderPieces(note) {
      const inA = this.pieces.filter(x => x.on).reduce((a, x) => a + turf.area(x.f), 0), A = this.p.cadArea || turf.area(this.p.feat), base = this.p.ledgerArea || this.p.area1 || A;
      const newA = Math.round(base * inA / A * 10) / 10;
      this.panel.innerHTML = `<div class="rc-head"><b>선 그어 자르기</b> · ${esc(this.p.jibun)} <span class="muted">조각 ${this.pieces.length}개</span></div>
        <div class="rc-opts">${this.pieces.map((x, k) => `<button type="button" data-p="${k}" class="${x.on ? 'on' : ''}" style="border-color:${x.color}">조각 ${k + 1} ${x.on ? '– 넣음' : '– 뺌'}<small>${fmtN(turf.area(x.f))}㎡</small></button>`).join('')}</div>
        <p class="rc-note">${note || `조각(버튼이나 지도)을 누르면 넣고 빼기가 바뀝니다. 이 필지 편입 <b>${fmtN(newA)}㎡</b> / 대장 ${fmtN(base)}㎡`}</p>
        <p class="rc-note">적용하면 ${this.delta(newA, inA)}</p>
        <div class="rc-nav"><button type="button" data-a="line">선 하나 더 긋기</button><button type="button" data-a="apply" class="primary">적용</button><button type="button" data-a="undo">취소</button></div>`;
      this.bind();
    },
    // 도시계획도로 경계로 관통: 필지에서 도시계획도로 부분을 뺀 나머지만 구역에
    applyPlan(p) {
      const g = planCutGeom(p); if (!g) return msg('rvMsg3', `${p.jibun}: 겹치는 도시계획도로가 없습니다.`, true);
      if (this.p !== p) this.showParcel(p);
      p.cutM = makeCut(p, g, { manual: true });
      R.choices[`L|${p.key}|cut`] = 'manual';
      if ((R.items || []).some(i => i.id === `L|${p.key}|in`)) R.choices[`L|${p.key}|in`] = 'roster';
      R.choices[`L|${p.key}|hroad`] = 'plan';
      this.pieces = null;
      this.refresh();
      snapJudge(p, '도시계획도로 경계로 관통');
    },
    applyPieces() {
      const p = this.p, on = this.pieces.filter(x => x.on);
      const u = on.length ? unionAll(on.map(x => x.f)) : null;
      p.cutM = makeCut(p, u ? u.geometry : null, { manual: true });
      R.choices[`L|${p.key}|cut`] = 'manual';
      if ((R.items || []).some(i => i.id === `L|${p.key}|in`)) R.choices[`L|${p.key}|in`] = 'roster';   // 도면 판단 필지를 직접 잘랐으면 자른 대로
      if ((R.items || []).some(i => i.id === `L|${p.key}|hroad`)) R.choices[`L|${p.key}|hroad`] = 'cut';   // 실제 길이 지나는 대지를 직접 잘랐음
      this.pieces = null;
      this.refresh();
      snapJudge(p, '선을 그어 직접 자름');
      if (!$r('rvRvBox').hidden) { (KRV.drawOv || []).forEach(o => o.setMap(null)); KRV.drawOv = []; openRoadview(p); }   // 새로 자른 선을 로드뷰에 다시 표시
    },
  };

  // ---------------------------------------------------------------
  // 3-2. 경계 도로 자르기
  //   명부에 도로 필지가 통째로 들어 있어 구역 밖으로 길게 나가는 경우(예: 구역 경계를 따라가는 도로, 구역 밖으로 뻗은 도로)
  //   구역 쪽 대지(명부의 도로 아닌 필지)와 바깥 대지(명부에 없는 도로 아닌 필지) 사이 중심선까지만 편입 (2구역계 탭 RoadCut.centerPiece 재사용)
  //   조서 면적 = 토지대장 면적 × (자른 면적 ÷ 연속지적 면적)
  // ---------------------------------------------------------------
  const ROAD_RE = /^(도|도로|구|구거|천|하천)$/;
  const isRoadP = p => ROAD_RE.test(p.ledgerJimok || p.jimok || '');
  //   p.cut: 자동(중심선까지), p.cutM: 직접 자르기. 판단 기본값은 직접 자른 것이 있으면 그것, 없으면 중심선까지
  //   경계 도로를 자르는 방식 [판단 값, 필지에 담는 칸, 이름] — 순서 = 기본값 우선순위
  //   구역계는 접도 대지 경계(도로 쪽 지적선)로 긋는 경우가 많아 그것을 자동 방식 중 기본으로 함
  const CUT_MODES = [
    ['manual', 'cutM', '직접 자른 대로'],
    ['edge', 'cutE', '접도 도로 불포함(대지 경계선)'],
    ['lot', 'cutL', '접도 도로 포함(건너편 지적선)'],
    ['cut', 'cut', '중심선까지'],
  ];
  const hasCut = p => CUT_MODES.some(m => p[m[1]]);
  //   p.cutDef: 신청 도면에 가장 가까운 방식(buildItems에서 정함)
  const cutChoice = p => {
    if (!hasCut(p)) return null;
    const ok = k => { const f = (CUT_MODES.find(m => m[0] === k) || [])[1]; return !f || p[f]; };   // 직접 자른 것을 되돌려 cutM이 없어진 경우 등
    return [R.choices[`L|${p.key}|cut`], p.cutDef].find(k => k && ok(k)) || CUT_MODES.find(m => p[m[1]])[0];
  };
  const cutField = k => (CUT_MODES.find(m => m[0] === k) || [])[1];
  const cutOf = p => { const f = cutField(cutChoice(p)); return f ? p[f] : null; };
  // 필지(p)에서 geom만 편입할 때의 면적 (조서 면적 = 토지대장 면적 × 자른 비율)
  function makeCut(p, geom, extra) {
    const A = p.cadArea || turf.area(p.feat), a = geom ? turf.area(turf.feature(geom)) : 0;
    const base = p.ledgerArea || p.area1 || A, inArea = Math.round(base * a / A * 10) / 10;
    let outGeom = null; try { outGeom = geom ? turf.difference(p.feat, turf.feature(geom)) : p.feat; } catch (e) { }
    return { geom, cadIn: a, inArea, outArea: Math.round((base - inArea) * 10) / 10, outGeom, ...extra };
  }
  // 조서에 들어가는 필지 모양 (경계 도로 판단 반영)
  function zoneFeats() {
    const out = [];
    R.parcels.forEach(p => {
      if (!p.feat || R.choices[`L|${p.key}|noarea`] === 'drop') return;
      const ci = R.choices[`L|${p.key}|in`] || (p.drawnCut ? p.inDef : null);
      if (ci === 'drop') return;
      if (ci === 'drawn' && R.drawn) { try { const x = turf.intersect(p.feat, R.drawn); if (x) out.push(x); } catch (e) { } return; }
      const c = cutChoice(p);
      if (c === 'none') return;
      if (cutField(c)) { const g = cutOf(p).geom; if (g) out.push(turf.feature(g)); return; }
      if (c === 'drawn' && R.drawn) { try { const x = turf.intersect(p.feat, R.drawn); if (x) out.push(x); } catch (e) { } return; }
      out.push(p.feat);
    });
    return out;
  }
  // 지적선까지(도로 폭 전체): 도로에 맞닿은 구역 쪽 대지의 경계선(지적선)을 도로 건너편까지 수직으로 밀어 낸 부분만 편입
  //   구역 경계를 따라가는 도로는 폭 전체가 들어가고, 구역 밖으로 뻗은 도로는 대지 모서리(지적선 연장)에서 끊김
  //   계산은 RoadCut.P 평면 좌표(m)에서 하고 경위도로 되돌림. RoadCut.core(구역 쪽 대지)가 준비돼 있어야 함
  //   near = true: 접도 대지 경계까지 — 건너편도 구역 쪽 대지인 부분(구역 안을 지나는 도로)만 넣고, 구역 경계를 따라가는 부분은 뺌
  function lotPiece(p, near) {
    const RC = RoadCut, road = RC.P.to(p.feat.geometry);
    const polys = road.type === 'Polygon' ? [road.coordinates] : road.coordinates;
    const inRing = (pt, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
    const inRoad = pt => polys.some(pl => inRing(pt, pl[0]) && !pl.slice(1).some(h => inRing(pt, h)));
    const segD = (pt, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy); };
    const edges = []; let area2 = 0, per = 0;
    polys.forEach(pl => pl.forEach((ring, ri) => { for (let k = 0; k + 1 < ring.length; k++) { edges.push([ring[k], ring[k + 1]]); per += Math.hypot(ring[k + 1][0] - ring[k][0], ring[k + 1][1] - ring[k][1]); if (!ri) area2 += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1]; } }));
    const W = Math.max(6, Math.min(40, Math.abs(area2) / per * 2.4));   // 도로 폭 어림(길쭉한 띠: 폭 ≈ 2×면적÷둘레)에 여유
    const distRoad = pt => edges.reduce((m, [a, b]) => Math.min(m, segD(pt, a, b)), Infinity);
    const [x0, y0, x1, y1] = turf.bbox(road), M = W + 2;
    const quads = [], nearBox = r => r.mb[0] <= x1 + M && r.mb[2] >= x0 - M && r.mb[1] <= y1 + M && r.mb[3] >= y0 - M;
    const cores = RC.core.filter(nearBox), outs = near ? RC.out.filter(nearBox) : [];
    // 건너편 판단용 "구역 쪽": 구역 대지 + 명부의 다른 도로(구역 안 골목 입구 등). 이 도로 자신은 제외
    const sides = near ? [...cores, ...(RC.zoneRoads || []).filter(r => r.f !== p.feat && nearBox(r))] : cores;
    const inLot = (pt, r) => pt[0] >= r.mb[0] && pt[0] <= r.mb[2] && pt[1] >= r.mb[1] && pt[1] <= r.mb[3] && (r.m.type === 'Polygon' ? [r.m.coordinates] : r.m.coordinates).some(pl => inRing(pt, pl[0]));
    // 지적선 중점에서 도로 건너편으로 나아가 처음 닿는 대지: 구역 쪽이면 그 거리, 바깥 대지거나 없으면 null
    //   도로를 벗어난 바로 그 자리(1.5m 안)만 봄 — 더 멀리 있는 구역 대지에 닿아 경계 도로를 넣지 않게
    const hits = new Set();   // 건너편에서 닿은 구역 쪽 대지 (작은 필지 때문에 관통 도로로 본 것인지 물어보려고)
    // 닿은 대지의 가장 가까운 지적선이 도로 쪽으로 향하는 방향 (밖으로 향한 법선)
    const facing = (r, q) => {
      let best = null, bd = Infinity;
      (r.m.type === 'Polygon' ? [r.m.coordinates] : r.m.coordinates).forEach(pl => { const ring = pl[0]; for (let k = 0; k + 1 < ring.length; k++) { const d = segD(q, ring[k], ring[k + 1]); if (d < bd) { bd = d; best = [ring[k], ring[k + 1]]; } } });
      if (!best) return null;
      const [a, b] = best, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let nn = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      if (inLot([m[0] + nn[0] * 0.4, m[1] + nn[1] * 0.4], r)) nn = [-nn[0], -nn[1]];
      return nn;
    };
    const across = (mid, n, self) => {
      for (let t = 0.8; t <= W + 2; t += 0.5) {
        const pt = [mid[0] + n[0] * t, mid[1] + n[1] * t];
        if (inRoad(pt)) continue;
        for (let s = 0; s <= 1.5; s += 0.5) {
          const q = [pt[0] + n[0] * s, pt[1] + n[1] * s];
          const hit = sides.find(r => r !== self && inLot(q, r));
          // 건너편 대지의 지적선이 이쪽을 마주 볼 때만(거의 평행) 구역 안을 지나는 도로로 봄
          //   도로 입구 모서리에서 비스듬히 건너편 모서리 대지에 닿은 것은 제외 → 경계 대지선을 이어 끊김
          if (hit) { const nh = facing(hit, q); if (nh && n[0] * nh[0] + n[1] * nh[1] > -0.8) return null; hits.add(hit); return t; }
          if (outs.some(r => inLot(q, r))) return null;
        }
        return null;
      }
      return null;
    };
    // 지적선 중점에서 도로를 건너 빠져나가는 거리 (도로 안에서 안 끝나면 Infinity — 밖으로 뻗은 도로 쪽으로 향한 경우)
    const exitAt = (mid, n) => { for (let t = 0.8; t <= 40; t += 0.25) if (!inRoad([mid[0] + n[0] * t, mid[1] + n[1] * t])) return t; return Infinity; };
    const rays = [];
    cores.forEach(r => {
      (r.m.type === 'Polygon' ? [r.m.coordinates] : r.m.coordinates).forEach(pl => {
        const ring = pl[0];
        for (let k = 0; k + 1 < ring.length; k++) {
          const a = ring[k], b = ring[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 0.3) continue;
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (distRoad(mid) > 1.0) continue;                       // 도로에 맞닿은 지적선만
          const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; let n = [-ty, tx];
          if (!inRoad([mid[0] + n[0] * 0.8, mid[1] + n[1] * 0.8])) { n = [ty, -tx]; if (!inRoad([mid[0] + n[0] * 0.8, mid[1] + n[1] * 0.8])) continue; }
          const e = 0.3;   // 모서리 틈 메우기
          rays.push({ r, n, a2: [a[0] - tx * e, a[1] - ty * e], b2: [b[0] + tx * e, b[1] + ty * e], len: near ? (d => d == null ? null : d + 0.3)(across(mid, n, r)) : exitAt(mid, n) });
        }
      });
    });
    if (!near) {
      // 접도 도로 포함: 건너편 지적선에서 멈춤. 밖으로 뻗은 도로 쪽(도로 안에서 안 끝남)은 같은 대지에서 잰 도로 폭까지만 → 건너편 지적선을 이어 그은 선에서 끊김
      const med = xs => { const s = xs.filter(isFinite).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
      const all = med(rays.map(x => x.len)) || W / 2;
      const byLot = new Map(); rays.forEach(x => { if (!byLot.has(x.r)) byLot.set(x.r, []); byLot.get(x.r).push(x.len); });
      rays.forEach(x => { const w = (med(byLot.get(x.r)) || all) * 1.05 + 0.3; x.len = Math.min(x.len + 0.3, w); });
    }
    rays.forEach(({ n, a2, b2, len }) => {
      if (len == null || !isFinite(len)) return;
      quads.push(turf.polygon([[a2, b2, [b2[0] + n[0] * len, b2[1] + n[1] * len], [a2[0] + n[0] * len, a2[1] + n[1] * len], a2]]));
    });
    if (!quads.length) return null;
    // 도형 계산이 좌표 오차로 실패하면 1cm 단위로 반올림해 다시, 그래도 안 되면 조각마다 따로 잘라 합침
    const roadF = turf.feature(road);
    let x = null;
    try { x = turf.intersect(RC.treeUnion(quads), roadF); }
    catch (e) {
      try { x = turf.intersect(turf.truncate(RC.treeUnion(quads.map(q => turf.truncate(q, { precision: 2 }))), { precision: 2 }), turf.truncate(roadF, { precision: 2 })); }
      catch (e2) { x = RC.treeUnion(quads.map(q => { try { return turf.intersect(q, roadF); } catch (e3) { return null; } }).filter(Boolean)); }
    }
    if (!x) return null;
    const g = RC.P.from(x.geometry), parts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).filter(c => turf.area(turf.polygon(c)) >= 0.5);
    const geom = parts.length ? (parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts }) : null;
    if (near && geom) lotPiece.hits = [...hits].map(r => r.f);
    return geom;
  }

  // 실제 길(브이월드 도로명주소 도로구간 중심선)을 받아, 대지 안쪽(경계에서 1.5m 안쪽)을 8m 넘게 지나는 대지를 찾음
  //   = 지적상 대지인데 실제로는 길이 지나가는 곳(대지가 도로를 막는 모양). 경계 대지는 구역계 판단 필요로 띄움
  async function findRoadOnLots() {
    if (!R.roadLines) {
      const zb = turf.bbox(turf.buffer(R.zoneFull || R.zone, 0.03, { units: 'kilometers' })), DX = 0.004, DY = 0.003, seen = new Set(), lines = [];
      for (let x = Math.floor(zb[0] / DX); x <= Math.floor(zb[2] / DX); x++) for (let y = Math.floor(zb[1] / DY); y <= Math.floor(zb[3] / DY); y++) {
        const box = `BOX(${(x * DX).toFixed(4)},${(y * DY).toFixed(4)},${((x + 1) * DX).toFixed(4)},${((y + 1) * DY).toFixed(4)})`;
        try { (await VWorld.dataAll('LT_L_SPRD', box, 10)).forEach(f => { const k = JSON.stringify(f.geometry.coordinates).slice(0, 100); if (!seen.has(k)) { seen.add(k); lines.push(f); } }); } catch (e) { }
        await sleep(150);
      }
      R.roadLines = lines;
    }
    const outer = R.zoneFull ? turf.polygonToLine(R.zoneFull) : null, outerLines = !outer ? [] : outer.type === 'FeatureCollection' ? outer.features : [outer];
    R.parcels.forEach(p => {
      p.hroad = null;
      if (!p.feat || isRoadP(p)) return;
      let inner = null; try { inner = turf.buffer(p.feat, -1.5, { units: 'meters' }); } catch (e) { } if (!inner) return;
      const b = turf.bbox(p.feat); let len = 0; const names = new Set();
      R.roadLines.forEach(l => {
        const lb = turf.bbox(l); if (lb[2] < b[0] || lb[0] > b[2] || lb[3] < b[1] || lb[1] > b[3]) return;
        (l.geometry.type === 'MultiLineString' ? l.geometry.coordinates : [l.geometry.coordinates]).forEach(s => {
          for (let i = 0; i + 1 < s.length; i++) {
            const a = s[i], c = s[i + 1], d = turf.distance(turf.point(a), turf.point(c), { units: 'meters' }), n = Math.max(1, Math.ceil(d));
            for (let k = 0; k < n; k++) { const pt = [a[0] + (c[0] - a[0]) * (k + 0.5) / n, a[1] + (c[1] - a[1]) * (k + 0.5) / n]; if (turf.booleanPointInPolygon(turf.point(pt), inner)) { len += d / n; names.add(l.properties.rn); } }
          }
        });
      });
      if (len < 8) return;
      const edge = outerLines.some(l => { try { return turf.pointToLineDistance(turf.pointOnFeature(p.feat), l, { units: 'meters' }) < 40 && turf.booleanIntersects(turf.buffer(p.feat, 1.5, { units: 'meters' }), l); } catch (e) { return false; } });
      p.hroad = { len: Math.round(len), names: [...names].filter(Boolean).join(', '), edge };
    });
  }

  // 도시계획도로(UPIS 도시계획시설 도로): 구역경계의 기본 기준. 등급(대로·중로·소로)·집행 여부와 함께 받음
  //   필지마다 도시계획도로와 겹치는 면적이 있으면 토지조서 "도시계획시설" 칸에 씀
  async function loadPlanRoads() {
    if (R.planRoads) return;
    const zb = turf.bbox(turf.buffer(R.zoneFull || R.zone, 0.05, { units: 'kilometers' }));
    let fs = []; try { fs = await VWorld.dataAll('LT_C_UPISUQ151', `BOX(${zb.map(v => v.toFixed(5)).join(',')})`, 10); } catch (e) { console.warn(e); }
    R.planRoads = fs.map(f => ({ f, grade: f.properties.dgm_nm || f.properties.atr_nam || '도로', exec: f.properties.exc_nam || '', bb: turf.bbox(f) }));
    R.parcels.forEach(p => {
      if (!p.feat) return; const b = turf.bbox(p.feat), hit = new Set();
      R.planRoads.forEach(r => { if (r.bb[2] < b[0] || r.bb[0] > b[2] || r.bb[3] < b[1] || r.bb[1] > b[3]) return; try { const x = turf.intersect(p.feat, r.f); if (x && turf.area(x) >= 1) hit.add(`도로(${r.grade}${r.exec === '미집행' ? ', 미집행' : ''})`); } catch (e) { } });
      p.facility = [...hit].join(', ');
    });
  }
  // 구역 경계가 도시계획도로를 따라가는지: 경계를 2m마다 점으로 찍어 도시계획도로에서 3m 안이면 "따라감"
  //   따라가지 않는 구간이 15m 넘게 이어지면 점검 대상(구역계 선형 점검에 함께 넣음)
  // 필지 − 도시계획도로(5㎡ 미만 조각은 버림). 겹침이 5㎡ 미만이면 null
  function planCutGeom(p) {
    if (!p.feat || !R.planRoads) return null;
    let rest = turf.truncate(p.feat, { precision: 7 }), cut = 0;
    R.planRoads.forEach(r => { try { const x = turf.intersect(rest, r.f); if (!x || turf.area(x) < 1) return; const d = turf.difference(rest, r.f); cut += turf.area(x); rest = d; } catch (e) { } });
    if (cut < 5 || !rest) return null;
    const polys = rest.geometry.type === 'MultiPolygon' ? rest.geometry.coordinates : [rest.geometry.coordinates];
    let keep = polys.filter(c => turf.area(turf.polygon(c)) >= 5);
    if (keep.length > 1) {
      // 여러 조각이면 구역 안 대지(도로 아닌 명부 필지)에 붙은 조각만 — 구역 밖으로 뻗은 도로 필지의 바깥 조각은 버림
      const nb = R.parcels.filter(q => q !== p && q.feat && !/도로/.test(q.ledgerJimok || q.jimok || '') && !(q.inChoice === 'drop'));
      const touches = c => { const f = turf.buffer(turf.polygon(c), 1, { units: 'meters' }), b = turf.bbox(f);
        return nb.some(q => { const qb = turf.bbox(q.feat); if (qb[2] < b[0] || qb[0] > b[2] || qb[3] < b[1] || qb[1] > b[3]) return false; try { return turf.booleanIntersects(f, q.feat); } catch (e) { return false; } }); };
      const t = keep.filter(touches); if (t.length) keep = t;
    }
    return keep.length ? (keep.length === 1 ? { type: 'Polygon', coordinates: keep[0] } : { type: 'MultiPolygon', coordinates: keep }) : null;
  }
  function checkPlanEdges() {
    R.planEdge = null;
    if (!R.zone || !R.planRoads || !R.planRoads.length) return;
    const near = R.planRoads.map(r => r.f), buf = (() => { try { return turf.buffer(RoadCut.treeUnion(near.map(f => turf.truncate(f, { precision: 7 }))), 3, { units: 'meters' }); } catch (e) { return null; } })();
    if (!buf) return;
    const o = turf.polygonToLine(R.zone), rings = (o.type === 'FeatureCollection' ? o.features : [o]).flatMap(l => l.geometry.type === 'MultiLineString' ? l.geometry.coordinates : [l.geometry.coordinates]);
    let total = 0, along = 0; const runs = [];
    rings.forEach(ring => {
      let cur = null;
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i], c = ring[i + 1], d = turf.distance(turf.point(a), turf.point(c), { units: 'meters' }), n = Math.max(1, Math.ceil(d / 2));
        for (let k = 0; k < n; k++) {
          const pt = [a[0] + (c[0] - a[0]) * (k + 0.5) / n, a[1] + (c[1] - a[1]) * (k + 0.5) / n], seg = d / n; total += seg;
          if (turf.booleanPointInPolygon(turf.point(pt), buf)) { along += seg; if (cur) { runs.push(cur); cur = null; } }
          else { if (!cur) cur = { len: 0, pts: [] }; cur.len += seg; cur.pts.push(pt); }
        }
      }
      if (cur) runs.push(cur);
    });
    R.planEdge = { total, along, runs: runs.filter(r => r.len >= 15 && r.pts.length >= 2) };
    R.planEdge.runs.forEach(r => {
      const line = turf.lineString(r.pts);
      (R.shapeIssues = R.shapeIssues || []).push({ type: 'noplan', geom: turf.buffer(line, 2, { units: 'meters' }), area: r.len, lots: (() => { const own = new Set(R.parcels.map(p => p.pnu)), bb = turf.bbox(line); return Object.values(R.cadAll).filter(x => { const b = turf.bbox(x); if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) return false; try { return turf.booleanIntersects(turf.buffer(line, 1, { units: 'meters' }), x); } catch (e) { return false; } }).slice(0, 8).map(x => ({ jibun: String(x.properties.jibun || '').replace(/\s+/g, ''), roster: own.has(x.properties.pnu) })); })() });
    });
  }

  async function cutRoads() {
    if (!R.parcels.some(p => p.feat)) return msg('rvMsg3', '② 공부 조회를 먼저 해 주세요.', true);
    msg('rvMsg3', '도시계획도로·실제 길(도로명주소 도로 중심선) 받는 중…');
    try { await loadPlanRoads(); } catch (e) { console.warn(e); }
    try { await findRoadOnLots(); } catch (e) { console.warn(e); }
    if (typeof RoadCut === 'undefined') return msg('rvMsg3', '도로 자르기 기능(roadcut.js)을 불러오지 못했습니다.', true);
    const RC = RoadCut, full = R.zoneFull || R.zone, c = turf.centroid(full).geometry.coordinates;
    RC.P = RC.proj(c[1], c[0]);
    const own = new Set(R.parcels.map(p => p.pnu));
    const zb = turf.bbox(turf.buffer(full, 0.06, { units: 'kilometers' }));
    const inBox = f => { const b = turf.bbox(f); return !(b[2] < zb[0] || b[0] > zb[2] || b[3] < zb[1] || b[1] > zb[3]); };
    const rec = f => { const m = RC.P.to(f.geometry); return { f, m, mb: turf.bbox(m) }; };
    const jm = f => (String(f.properties.jibun || '').match(/[가-힣]+$/) || [''])[0];
    // 구역 쪽 대지: 신청 도면 판단(과반 기준)이나 직접 판단으로 뺀 필지는 제외 → 대지 경계를 먼저 정하고 도로를 그에 맞춰 자름
    const dropped = p => (R.choices[`L|${p.key}|in`] || (p.drawnCut ? p.inDef : null)) === 'drop' || R.choices[`L|${p.key}|noarea`] === 'drop';
    RC.core = R.parcels.filter(p => p.feat && !isRoadP(p) && !dropped(p)).map(p => rec(p.feat));
    RC.zoneRoads = R.parcels.filter(p => p.feat && isRoadP(p) && !dropped(p)).map(p => rec(p.feat));
    // 골목 입구를 "양쪽 대지 모서리를 잇는 선"에서 끊기 위한 테두리: 구역 쪽 대지 + 구역 안 도로(구역 안을 지나는 골목)를 합쳐
    //   8m 닫힘(넓혔다 좁힘)한 모양. 닫힘은 오목한 곳만 메우므로 대지 모서리를 잇는 선 밖으로는 나가지 않음
    msg('rvMsg3', '경계 도로 자를 테두리 계산 중…'); await sleep(0);
    let mouth = null;
    try { const cu = unionAll(R.parcels.filter(p => p.feat && !isRoadP(p) && !dropped(p)).map(p => p.feat)); mouth = turf.buffer(turf.buffer(cu, 8, { units: 'meters' }), -8, { units: 'meters' }); } catch (e) { console.warn(e); }
    RC.out = Object.values(R.cadAll).filter(f => !own.has(f.properties.pnu) && !RC.ROAD.includes(jm(f)) && inBox(f)).map(rec);
    const roads = R.parcels.filter(p => p.feat && isRoadP(p));
    let n = 0, outSum = 0;
    for (let i = 0; i < roads.length; i++) {
      const p = roads[i]; p.cut = null; p.cutL = null; p.cutE = null; p.cutDef = null;   // 도면 기준 기본값은 판단표를 다시 만들 때 새로 정함
      if (i % 15 === 0) { msg('rvMsg3', `경계 도로 찾는 중… ${i}/${roads.length}`); await sleep(0); }
      let r; try { r = RC.centerPiece({ f: p.feat }); } catch (e) { continue; }
      const A = p.cadArea || turf.area(p.feat), a = r.geom ? turf.area(turf.feature(r.geom)) : 0;
      if (a >= A * 0.98) continue;
      p.cut = makeCut(p, r.geom);
      // 접도 도로 불포함(기본): 구역 안을 지나는 부분만 (없으면 도로 전부 뺌)
      let eg = null; lotPiece.hits = []; try { eg = lotPiece(p, true); } catch (e) { console.warn(e); }
      // 골목 입구가 양쪽 대지 모서리를 잇는 선 밖으로 튀어나오지 않게 테두리로 잘라냄(1㎡ 미만 부스러기 버림)
      if (eg && mouth) { try { const x = turf.intersect(turf.feature(eg), mouth); if (x) { const g = x.geometry, parts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).filter(c => turf.area(turf.polygon(c)) >= 1); eg = parts.length ? (parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts }) : null; } else eg = null; } catch (e) { } }
      p.cutE = makeCut(p, eg);
      const hitsE = lotPiece.hits;
      // 접도 도로 포함: 구역 쪽 대지 지적선을 도로 건너편 지적선까지 연장 (불포함 부분은 당연히 들어감)
      let lg = null; try { lg = lotPiece(p); } catch (e) { console.warn(e); }
      if (eg) { if (!lg) lg = eg; else { try { const u = turf.union(turf.feature(lg), turf.feature(eg)); if (u) lg = u.geometry; } catch (e) { } } }
      p.cutL = makeCut(p, lg);
      lotPiece.hits = hitsE;
      // 건너편이 띠 모양 자투리 필지(폭 1.5m 미만·둘레 40m 넘음)나 20㎡ 미만 잡종지여서 관통 도로로 본 경우 → 기본값 없이 물어봄
      const sliver = q => { const A = q.cadArea || turf.area(q.feat), P = turf.length(turf.polygonToLine(q.feat), { units: 'meters' }); return (2 * A / P < 1.5 && P > 40) || (A < 20 && /^잡/.test(q.ledgerJimok || q.jimok || '')); };
      p.cutAsk = eg ? (lotPiece.hits || []).map(f => R.parcels.find(q => q.pnu === f.properties.pnu)).filter(q => q && q.feat && sliver(q)).map(q => `${q.jibun}(${q.ledgerJimok || q.jimok} ${fmtN(q.ledgerArea || q.area1)}㎡)`) : [];
      n++; outSum += (cutOf(p) || p.cutE || p.cut).outArea;
    }
    R.cutDone = true;
    if (Cutter.panel) Cutter.close();
    buildZone();
    msg('rvMsg3', n ? `구역 경계에 걸친 도로 ${n}필지를 잘랐습니다(기본: 접도 도로 불포함 — 구역계를 접도 대지 경계선으로 긋고, 관통하는 도로는 그 선을 이어 끊음) — 구역 밖 ${fmtN(outSum)}㎡ 제외, 구역 면적 ${fmtN(turf.area(R.zone), 0)}㎡ (자르기 전 ${fmtN(turf.area(R.zoneFull), 0)}㎡).\n필지마다 ⑤에서 "도로 전체(명부대로)"·"빼기"${R.drawn ? '·"신청 도면 구역선대로"' : ''}로 바꿀 수 있습니다.`
      : '구역 경계에 걸친 도로가 없습니다.');
  }

  function drawMap(keepView) {
    if (!R.zone) return;
    if (!R.leaflet) {
      R.leaflet = L.map('rvMap', { preferCanvas: true, maxZoom: 21 });
      if (VWorld.enabled) L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWorld.key}/white/{z}/{y}/{x}.png`, { maxZoom: 21, maxNativeZoom: 19, opacity: 0.6 }).addTo(R.leaflet);
      // 지도 오른쪽 아래 모서리를 끌어 높이를 바꾸면 지도도 다시 맞춤
      if (window.ResizeObserver) new ResizeObserver(() => R.leaflet && R.leaflet.invalidateSize()).observe($r('rvMap'));
      // 필지 고르기: 도시계획도로·실제 길 등 위에 덮인 층을 눌러도 그 아래 명부 필지가 골라지게
      R.leaflet.on('click', e => {
        if (!Cutter.picking) return;
        const pt = turf.point([e.latlng.lng, e.latlng.lat]);
        const p = R.parcels.find(x => x.feat && turf.booleanPointInPolygon(pt, x.feat));
        if (p) Cutter.onParcelClick(p);
      });
      if (L.Draw) {
        R.leaflet.on(L.Draw.Event.CREATED, e => Cutter.onLine(e.layer));
        // 점을 찍을 때마다 로드뷰에도 표시
        R.leaflet.on(L.Draw.Event.DRAWVERTEX, e => { const lls = []; e.layers.eachLayer(l => lls.push(l.getLatLng())); rvShowDrawing(lls); });
      }
    }
    const m = R.leaflet;
    Object.values(R.layers).forEach(l => m.removeLayer(l)); R.layers = {};
    const bb = turf.bbox(turf.buffer(R.zone, 0.05, { units: 'kilometers' }));
    const bg = Object.values(R.cadAll).filter(f => { const b = turf.bbox(f); return !(b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]); });
    // 지적선이 판단 기준이므로 진하게 (명부 필지 #333 1px, 그 밖 #666 0.8px)
    R.layers.bg = L.geoJSON(turf.featureCollection(bg), { style: { color: '#666', weight: 0.8, fill: false }, interactive: false }).addTo(m);
    const fc = turf.featureCollection(R.parcels.filter(p => p.feat).map(p => ({ ...p.feat, properties: { ...p.feat.properties, _p: p } })));
    R.layers.parcels = L.geoJSON(fc, {
      style: f => { const p = f.properties._p; const part = p.ledgerArea && p.area != null && p.area < p.ledgerArea - 0.05; return { color: '#333', weight: 1, fillColor: part ? '#ffa94d' : '#ffd27f', fillOpacity: 0.35 }; },
      onEachFeature: (f, l) => { const p = f.properties._p; l.bindTooltip(`${p.dong} ${p.jibun} ${p.jimok || ''}<br>명부 공부 ${fmtN(p.area1)}㎡ / 편입 ${fmtN(p.area)}㎡<br>대장 ${fmtN(p.ledgerArea)}㎡${p.outArea ? `<br>도면 구역선 밖 ${fmtN(p.outArea)}㎡` : ''}`, { sticky: true }); l.on('click', () => Cutter.onParcelClick(p)); },
    }).addTo(m);
    const cutOuts = R.parcels.map(p => ({ p, c: cutOf(p) })).filter(x => x.c && x.c.outGeom).map(({ p, c }) => ({ ...c.outGeom, properties: { j: p.jibun, a: c.outArea } }));
    if (cutOuts.length) R.layers.cutOut = L.geoJSON(turf.featureCollection(cutOuts), { style: { color: '#1f2937', weight: 1, dashArray: '3 3', fillColor: '#6b7280', fillOpacity: 0.7 },
      onEachFeature: (f, l) => l.bindTooltip(`${f.properties.j} — 구역 밖으로 잘라낸 부분 ${fmtN(f.properties.a)}㎡`, { sticky: true }) }).addTo(m);
    // 구역계: 흰 테두리 위에 굵은 빨강 선(지적선·도로 색과 구별되게)
    R.layers.zoneHalo = L.geoJSON(R.zone, { style: { color: '#fff', weight: 9, opacity: 0.9, fill: false }, interactive: false }).addTo(m);
    R.layers.zone = L.geoJSON(R.zone, { style: { color: '#d00000', weight: 5, fill: false }, interactive: false }).addTo(m);
    // 도시계획도로(등급별 색: 대로 빨강, 중로 주황, 소로 노랑 / 미집행은 점선)
    if (R.planRoads && R.planRoads.length) R.layers.plan = L.geoJSON(turf.featureCollection(R.planRoads.map(r => ({ ...r.f, properties: { g: r.grade, e: r.exec } }))), {
      style: f => ({ color: /대로/.test(f.properties.g) ? '#dc2626' : /중로/.test(f.properties.g) ? '#ea580c' : '#ca8a04', weight: 2, dashArray: f.properties.e === '미집행' ? '6 4' : null, fillColor: /대로/.test(f.properties.g) ? '#fca5a5' : /중로/.test(f.properties.g) ? '#fdba74' : '#fde68a', fillOpacity: 0.3 }),
      onEachFeature: (f, l) => l.bindTooltip(`도시계획도로: ${f.properties.g}${f.properties.e ? ` (${f.properties.e})` : ''}`, { sticky: true }) }).addTo(m);
    // 실제 길 중심선(도로명주소 도로구간, 검은 점선)과 실제 길이 지나는 대지(초록 점선)
    if (R.roadLines && R.roadLines.length) {
      const near = R.roadLines.filter(f => { const b = turf.bbox(f); return !(b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]); });
      R.layers.roadLines = L.geoJSON(turf.featureCollection(near), { style: { color: '#111', weight: 2, dashArray: '2 5', opacity: 0.8 }, onEachFeature: (f, l) => l.bindTooltip(`실제 길: ${f.properties.rn || ''}`, { sticky: true }) }).addTo(m);
    }
    const hr = R.parcels.filter(p => p.hroad && p.feat);
    if (hr.length) R.layers.hroad = L.geoJSON(turf.featureCollection(hr.map(p => ({ ...p.feat, properties: { j: p.jibun, h: p.hroad } }))), { style: f => ({ color: '#15803d', weight: f.properties.h.edge ? 3 : 1.5, dashArray: '6 4', fillColor: '#22c55e', fillOpacity: f.properties.h.edge ? 0.25 : 0.1 }),
      onEachFeature: (f, l) => l.bindTooltip(`${f.properties.j}: 실제 길(${f.properties.h.names})이 대지 안을 약 ${f.properties.h.len}m 지남${f.properties.h.edge ? ' — 구역 경계 대지(판단 필요)' : ''}`, { sticky: true }) }).addTo(m);
    // 구역계 선형 점검 위치(보라 점선)
    if ((R.shapeIssues || []).length) R.layers.shape = L.geoJSON(turf.featureCollection(R.shapeIssues.map(s => ({ ...s.geom, properties: { t: SHAPE_NAME[s.type], a: s.area, l: s.lots.map(x => x.jibun).join(', ') } }))),
      { style: { color: '#7c3aed', weight: 2.5, dashArray: '5 4', fillColor: '#a78bfa', fillOpacity: 0.35 }, onEachFeature: (f, l) => l.bindTooltip(`선형 점검: ${f.properties.t} 약 ${fmtN(f.properties.a, 0)}㎡${f.properties.l ? ` (${f.properties.l})` : ''}`, { sticky: true }) }).addTo(m);
    if (R.drawn) {
      R.layers.drawn = L.geoJSON(R.drawn, { style: { color: '#1a1aff', weight: 2.5, dashArray: '10 4 2 4', fill: false }, interactive: false }).addTo(m);
      const outs = R.parcels.filter(p => p.outGeom && !hasCut(p)).map(p => p.outGeom);   // 경계 도로는 회색(잘라낸 부분)으로만 보임
      if (outs.length) R.layers.outs = L.geoJSON(turf.featureCollection(outs), { style: { color: '#b00000', weight: 1, fillColor: '#ff4d4d', fillOpacity: 0.6 }, interactive: false }).addTo(m);
      if (R.extra && R.extra.length) R.layers.extra = L.geoJSON(turf.featureCollection(R.extra.map(e => e.geom)), { style: { color: '#1f5fbf', weight: 1, fillColor: '#7fb2ff', fillOpacity: 0.6 } }).addTo(m);
    }
    if (!keepView) m.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]]);
    setTimeout(() => m.invalidateSize(), 100);
    mapOverview(); if (R.ovRedraw) setTimeout(R.ovRedraw, 150);   // 구역이 바뀌면 위치도도 다시
    mapLabels();
  }

  // ---------------------------------------------------------------
  // 4. 신청 도면(PDF) 구역선 정합
  // ---------------------------------------------------------------
  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js'; s.onload = ok; s.onerror = () => no(new Error('pdf.js를 불러오지 못했습니다')); document.head.appendChild(s); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    return window.pdfjsLib;
  }

  async function matchPdf(file) {
    if (!R.parcels.some(p => p.feat)) return msg('rvMsg4', '먼저 ② 공부 조회를 해 주세요(기준점이 될 지적도가 필요합니다).', true);
    msg('rvMsg4', '도면 읽는 중…');
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.max(1, 3400 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    // 지번 글자
    const tc = await page.getTextContent();
    const labels = [];
    tc.items.forEach(it => {
      const s = (it.str || '').replace(/\s+/g, '');
      const m = s.match(/^(\d{1,4}(?:-\d{1,4})?)([가-힣])$/);
      if (!m) return;
      const [a, b, , , e, f] = it.transform;
      const len = Math.hypot(a, b) || 1;
      const w = it.width || 0, h = it.height || len;
      // 글자 중심(PDF 좌표) -> 캔버스 좌표
      const cx = e + (a / len) * w / 2 - (b / len) * h / 3, cy = f + (b / len) * w / 2 + (a / len) * h / 3;
      const [px, py] = vp.convertToViewportPoint(cx, cy);
      labels.push({ jibun: m[1], px, py, size: w * h });
    });
    msg('rvMsg4', `도면 지번 글자 ${labels.length}개, 구역선 찾는 중…`);
    await sleep(30);
    const ring = extractRing(ctx, cv.width, cv.height, $r('rvColor').value);
    if (!ring) throw new Error('도면에서 닫힌 구역선을 찾지 못했습니다(선 색 확인)');
    // 기준점: 같은 지번이 하나뿐인 필지의 중심
    const byJ = {};
    Object.values(R.cadAll).forEach(f => { const j = String(f.properties.jibun || '').replace(/[^\d-]/g, ''); if (!j) return; (byJ[j] = byJ[j] || []).push(f); });
    const c0 = turf.center(R.zone).geometry.coordinates; const lon0 = c0[0], lat0 = c0[1];
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const toM = ([lo, la]) => [(lo - lon0) * kx, (la - lat0) * ky], toLL = ([x, y]) => [lon0 + x / kx, lat0 + y / ky];
    const zb = turf.bbox(turf.buffer(R.zone, 0.3, { units: 'kilometers' }));
    let pairs = [];
    labels.sort((a, b) => b.size - a.size).forEach(l => {
      const c = (byJ[l.jibun] || []).filter(f => { const p = turf.centerOfMass(f).geometry.coordinates; return p[0] > zb[0] && p[0] < zb[2] && p[1] > zb[1] && p[1] < zb[3]; });
      if (c.length !== 1) return;
      const [X, Y] = toM(turf.centerOfMass(c[0]).geometry.coordinates);
      pairs.push({ u: l.px, v: l.py, X, Y });
    });
    if (pairs.length < 12) throw new Error(`도면 지번과 지적도를 맞출 기준점이 부족합니다(${pairs.length}개)`);
    let T, res;
    for (let it = 0; it < 5; it++) {
      T = affine(pairs);
      res = pairs.map(p => Math.hypot(T[0][0] * p.u + T[0][1] * p.v + T[0][2] - p.X, T[1][0] * p.u + T[1][1] * p.v + T[1][2] - p.Y));
      const srt = res.slice().sort((a, b) => a - b); const thr = Math.max(3, srt[Math.floor(srt.length * 0.8)] * 2);
      const keep = pairs.filter((p, i) => res[i] < thr); if (keep.length === pairs.length || keep.length < 12) break; pairs = keep;
    }
    res = pairs.map(p => Math.hypot(T[0][0] * p.u + T[0][1] * p.v + T[0][2] - p.X, T[1][0] * p.u + T[1][1] * p.v + T[1][2] - p.Y)).sort((a, b) => a - b);
    const med = res[Math.floor(res.length / 2)];
    const mpp = Math.sqrt(Math.abs(T[0][0] * T[1][1] - T[0][1] * T[1][0]));    // m / 캔버스 픽셀
    const ptsPerPx = 1 / scale; const denom = mpp / (ptsPerPx * 0.0254 / 72);   // 축척 분모
    let poly = turf.polygon([ring.map(([u, v]) => toLL([T[0][0] * u + T[0][1] * v + T[0][2], T[1][0] * u + T[1][1] * v + T[1][2]]))]);
    try { poly = turf.buffer(turf.buffer(poly, 1.2, { units: 'meters' }), -1.2, { units: 'meters' }); } catch (e) { }
    R.drawn = poly; R.fit = { n: pairs.length, med, denom };
    compareDrawn();
    // 도면으로 대지 쪽(과반 기준) 판단이 정해졌으니 경계 도로를 그 대지 경계에 맞춰 다시 자름
    if (R.cutDone) { await cutRoads(); compareDrawn(); }
    msg('rvMsg4', `정합 완료: 기준점 ${pairs.length}개, 중앙오차 ${med.toFixed(2)}m, 도면 축척 약 1/${Math.round(denom / 100) * 100}` +
      `\n도면 구역선 안 면적 ${fmtN(turf.area(poly), 0)}㎡ (명부 필지 합친 면적 ${fmtN(turf.area(R.zone), 0)}㎡)` + (med > 3 ? '\n⚠ 오차가 큽니다. 도면 글자 위치가 필지 중심과 다를 수 있으니 결과를 참고만 하세요.' : ''));
  }

  function affine(P) {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    P.forEach(p => { const r = [p.u, p.v, 1]; for (let i = 0; i < 3; i++) { for (let k = 0; k < 3; k++) S[i][k] += r[i] * r[k]; bx[i] += r[i] * p.X; by[i] += r[i] * p.Y; } });
    const solve = (A, b) => { A = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < 3; i++) { let m = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; for (let k = 0; k < 3; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let c = i; c < 4; c++) A[k][c] -= f * A[i][c]; } } return A.map((r, i) => r[3] / r[i]); };
    return [solve(S, bx), solve(S, by)];
  }

  // 빨간(또는 파란) 점선 구역선 → 닫힌 외곽선 (캔버스 좌표)
  function extractRing(ctx, W, H, color) {
    const d = ctx.getImageData(0, 0, W, H).data;
    const red = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      red[p] = color === 'blue' ? (b > 160 && r < 110 && g < 140) : (r > 170 && g < 110 && b < 110);
    }
    const rad = Math.max(6, Math.round(Math.max(W, H) / 170));
    const dil = dilate(red, W, H, rad);
    // 바깥쪽 채우기
    const out = new Uint8Array(W * H); const st = [];
    for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
    while (st.length) { const p = st.pop(); if (out[p] || dil[p]) continue; out[p] = 1; const x = p % W; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < W * (H - 1)) st.push(p + W); }
    // 안쪽 영역 중 가장 큰 덩어리
    const lab = new Int32Array(W * H); let best = 0, bestSize = 0, id = 0;
    for (let p0 = 0; p0 < W * H; p0++) {
      if (out[p0] || dil[p0] || lab[p0]) continue;
      id++; let size = 0; st.push(p0);
      while (st.length) { const p = st.pop(); if (lab[p] || out[p] || dil[p]) continue; lab[p] = id; size++; const x = p % W; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < W * (H - 1)) st.push(p + W); }
      if (size > bestSize) { bestSize = size; best = id; }
    }
    if (!best || bestSize < W * H * 0.01) return null;
    const inner = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) inner[p] = lab[p] === best ? 1 : 0;
    const zone = dilate(inner, W, H, rad);
    const ring = trace(zone, W, H);
    return ring ? rdp(ring, 1.5) : null;
  }

  function dilate(src, W, H, r) {   // 정사각형 팽창 (가로·세로 분리)
    const tmp = new Uint8Array(W * H), dst = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let c = 0; const o = y * W;
      for (let x = 0; x < Math.min(r, W); x++) c += src[o + x];
      for (let x = 0; x < W; x++) { if (x + r < W) c += src[o + x + r]; if (x - r - 1 >= 0) c -= src[o + x - r - 1]; tmp[o + x] = c > 0 ? 1 : 0; } }
    for (let x = 0; x < W; x++) { let c = 0;
      for (let y = 0; y < Math.min(r, H); y++) c += tmp[y * W + x];
      for (let y = 0; y < H; y++) { if (y + r < H) c += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * W + x]; dst[y * W + x] = c > 0 ? 1 : 0; } }
    return dst;
  }

  function trace(m, W, H) {        // 무어 이웃 외곽선 추적
    let s = -1; for (let p = 0; p < W * H; p++) if (m[p]) { s = p; break; }
    if (s < 0) return null;
    const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
    const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
    let x = s % W, y = (s / W) | 0, dir = 7; const pts = [[x, y]]; const sx = x, sy = y;
    for (let n = 0; n < 4 * W * H; n++) {
      let found = false;
      for (let k = 0; k < 8; k++) { const d2 = (dir + 6 + k) % 8; const nx = x + dx[d2], ny = y + dy[d2]; if (at(nx, ny)) { x = nx; y = ny; dir = d2; found = true; break; } }
      if (!found) break;
      if (x === sx && y === sy) break;
      pts.push([x, y]);
    }
    pts.push(pts[0]);
    return pts;
  }

  // 더글러스-포커 단순화. 닫힌 선(처음 = 끝)은 기준선이 점 하나가 되어 다 지워지므로, 처음에서 가장 먼 점에서 둘로 나눠 줄인 뒤 다시 닫음
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const line = q => {
      const keep = new Uint8Array(q.length); keep[0] = keep[q.length - 1] = 1; const st = [[0, q.length - 1]];
      while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [x1, y1] = q[a], [x2, y2] = q[b]; const L2 = Math.hypot(x2 - x1, y2 - y1) || 1;
        for (let i = a + 1; i < b; i++) { const d = Math.abs((y2 - y1) * q[i][0] - (x2 - x1) * q[i][1] + x2 * y1 - y2 * x1) / L2; if (d > md) { md = d; mi = i; } }
        if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
      return q.filter((p, i) => keep[i]);
    };
    const f = pts[0], l = pts[pts.length - 1];
    let out;
    if (f[0] === l[0] && f[1] === l[1] && pts.length > 4) {
      let fi = 1, fd = -1; pts.forEach((p, i) => { const d = Math.hypot(p[0] - f[0], p[1] - f[1]); if (d > fd) { fd = d; fi = i; } });
      out = [...line(pts.slice(0, fi + 1)).slice(0, -1), ...line(pts.slice(fi))];
    } else out = line(pts);
    if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) out.push(out[0]);
    return out;
  }

  function compareDrawn() {
    const Z = R.drawn; if (!Z) return;
    R.parcels.forEach(p => {
      p.inDrawn = null; p.outArea = 0; p.outGeom = null;
      if (!p.feat) return;
      let x = null; try { x = turf.intersect(p.feat, Z); } catch (e) { }
      const a = p.cadArea || turf.area(p.feat), ia = x ? turf.area(x) : 0;
      p.inDrawn = ia; p.outArea = a - ia; p.drawnCut = false; p.outThick = 0;
      // 도면 선이 필지를 실제로 자른 것인지, 대지 경계를 따라가는 선과 연속지적이 조금 어긋난 것인지:
      //   구역선 밖 조각의 두께(2×면적÷둘레)가 2m 이상이거나 필지의 반 넘게 밖이면 "자름", 아니면 어긋남(필지 전체 편입으로 봄)
      if (p.outArea >= 5) {
        try { p.outGeom = turf.difference(p.feat, Z); } catch (e) { }
        if (p.outGeom) (p.outGeom.geometry.type === 'Polygon' ? [p.outGeom.geometry.coordinates] : p.outGeom.geometry.coordinates).forEach(c => {
          const f = turf.polygon(c), A = turf.area(f); if (A < 3) return;
          p.outThick = Math.max(p.outThick, 2 * A / turf.length(turf.polygonToLine(f), { units: 'meters' }));
        });
        p.drawnCut = p.outThick >= 2 || (a > 0 && p.outArea / a >= 0.5);
        if (!p.drawnCut) p.outGeom = null;
      }
      // 대장 면적 기준으로 환산한 도면 편입면적 (어긋남이면 필지 전체)
      p.drawnIn = p.drawnCut ? (p.ledgerArea ? p.ledgerArea * (a ? ia / a : 0) : ia) : (p.ledgerArea ?? a);
    });
    const own = new Set(R.parcels.map(p => p.pnu));
    const zb = turf.bbox(Z); R.extra = [];
    Object.values(R.cadAll).forEach(f => {
      if (own.has(f.properties.pnu)) return; const b = turf.bbox(f); if (b[2] < zb[0] || b[0] > zb[2] || b[3] < zb[1] || b[1] > zb[3]) return;
      let x = null; try { x = turf.intersect(f, Z); } catch (e) { }
      const ia = x ? turf.area(x) : 0; if (ia > 5) R.extra.push({ jibun: f.properties.jibun, area: turf.area(f), inArea: ia, geom: x });
    });
    runChecks();                                            // 판단 항목과 도면 기준 기본값(cutDef·inDef)을 정한 뒤
    if (R.zoneFull) { R.zone = unionAll(zoneFeats()) || R.zoneFull; checkShape(); runChecks(); }   // 그 기본값으로 구역을 다시 그림
    drawMap();
  }

  // ---------------------------------------------------------------
  // 5. 자동 검사
  // ---------------------------------------------------------------
  function runChecks() {
    const P = R.parcels; if (!P.length) return;
    const sum = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
    const areaSum = sum(P, p => p.area);
    const ledSum = sum(P, p => p.ledgerArea ?? p.area);
    const partial = P.filter(p => p.ledgerArea && p.area != null && p.area < p.ledgerArea - 0.05);
    const diff = P.filter(p => p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05);
    const jmDiff = P.filter(p => p.ledgerJimok && p.jimok && norm(p.jimok) !== norm(p.ledgerJimok));
    const noArea = P.filter(p => p.area == null);
    const noJiga = P.filter(p => p.feat && !p.jiga);
    const multi = R.owners.filter(o => !o.isPublic && o.nos.length > 1);
    const outs = P.filter(p => p.drawnCut);
    const kp = [
      ['명부 필지', P.length.toLocaleString() + '개'], ['명부 편입면적 합', fmtN(areaSum) + '㎡'], ['토지대장 면적 합', fmtN(ledSum) + '㎡'],
      ['소유자(성명+생년)', R.owners.length.toLocaleString() + '명'], ['일부편입(명부)', partial.length + '필지'],
    ];
    if (R.zoneFull) kp.push(['명부 필지 합친 면적(연속지적)', fmtN(turf.area(R.zoneFull), 0) + '㎡']);
    if (R.cutDone && R.zone) kp.push(['경계 도로 자른 뒤 구역(연속지적)', fmtN(turf.area(R.zone), 0) + '㎡']);
    if (R.drawn) kp.push(['도면 구역선 안 면적', fmtN(turf.area(R.drawn), 0) + '㎡']);
    $r('rvKpi').innerHTML = kp.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('');
    const C = [];
    if (diff.length) C.push(`명부 공부면적 ≠ 토지대장: ${diff.length}필지 (분할·합병 전 면적 기재 의심) — ${diff.slice(0, 12).map(p => `${p.jibun}(${fmtN(p.area1)}→${fmtN(p.ledgerArea)})`).join(', ')}${diff.length > 12 ? ' …' : ''}`);
    if (jmDiff.length) C.push(`지목 불일치: ${jmDiff.map(p => `${p.jibun}(${p.jimok}→${p.ledgerJimok})`).join(', ')}`);
    if (noArea.length) C.push(`면적 미기재: ${noArea.map(p => p.jibun).join(', ')}`);
    if (R.map.areaIn == null) C.push('편입면적 열 없음: 경계에 걸친 필지도 전체면적으로 산입됨 → 편입면적 기재 요구');
    if (partial.length) C.push(`명부상 일부편입 ${partial.length}필지: ${partial.map(p => `${p.jibun}(${fmtN(p.area)}/${fmtN(p.ledgerArea)})`).join(', ')}`);
    if (outs.length) C.push(`도면 구역선 밖으로 나간 필지 ${outs.length}개 (명부엔 ${R.map.areaIn == null ? '전체면적' : '해당 면적'}) — ${outs.sort((a, b) => b.outArea - a.outArea).slice(0, 15).map(p => `${p.jibun} 밖 ${fmtN(p.outArea, 0)}㎡`).join(', ')}`);
    if (R.extra && R.extra.length) C.push(`도면 구역선 안인데 명부에 없는 필지 ${R.extra.length}개: ${R.extra.slice(0, 20).map(e => `${e.jibun}(${fmtN(e.inArea, 0)}㎡)`).join(', ')}`);
    if (multi.length) C.push(`같은 사람(성명+생년)에게 소유자 번호가 2개 이상: ${multi.length}명 — ${multi.slice(0, 15).map(o => `${o.name}(${o.nos.join('/')})`).join(', ')}${multi.length > 15 ? ' …' : ''}`);
    if (noJiga.length) C.push(`공시지가 없음 ${noJiga.length}필지 (사업성 종전자산에서 0원 처리)`);
    if (R.fit) C.push(`도면 정합: 기준점 ${R.fit.n}개, 중앙오차 ${R.fit.med.toFixed(2)}m`);
    if (R.declaredOwners != null && R.ownerGroups != null && R.declaredOwners !== R.ownerGroups) C.push(`명부에 적힌 총 토지등소유자수 ${R.declaredOwners.toLocaleString()}명 ≠ 명부의 토지등소유자 번호(본번) ${R.ownerGroups.toLocaleString()}개`);
    else if (R.declaredOwners != null && R.ownerGroups == null && R.declaredOwners !== R.owners.length) C.push(`명부에 적힌 총 토지등소유자수 ${R.declaredOwners.toLocaleString()}명 ≠ 성명+생년으로 센 소유자 ${R.owners.length.toLocaleString()}명 (공유 대표·동일인 산정 기준 확인)`);
    if (R.fetched && R.parcels.some(p => p.pnu)) {
      const q = ledgerQueried();
      if (!q.size) C.push('건축물대장 미조회: ② 건축물대장 조회를 해야 명부의 건축물과 대조합니다(지금은 명부 기준).');
      else {
        buildPairs(q);
        const pr = Object.values(R.pairs).filter(x => x.side === 'roster');
        if (pr.length) C.push(`같은 건물이 명부와 건축물대장에 다른 지번으로 등재 ${pr.length}건 (연면적·사용승인일 일치): ${pr.map(x => `명부 ${P.find(p => R.pairs[p.key] === x).jibun} ↔ 대장 ${x.other.jibun}`).join(', ')}`);
        const noL = P.filter(p => q.has(p.pnu) && !ledgerRows(p).length && p.rosterB.length && !R.pairs[p.key]), noR = P.filter(p => ledgerRows(p).length && !p.rosterB.length && !R.pairs[p.key]);
        if (noL.length) C.push(`명부엔 건축물이 있는데 건축물대장 없음 ${noL.length}필지: ${noL.slice(0, 15).map(p => `${p.jibun}(${p.rosterB.map(b => b.permit || '허가 미기재').join('·')})`).join(', ')}${noL.length > 15 ? ' …' : ''}`);
        if (R.hasBldgCols && noR.length) C.push(`건축물대장엔 있는데 명부에 건축물 없음 ${noR.length}필지: ${noR.slice(0, 15).map(p => p.jibun).join(', ')}${noR.length > 15 ? ' …' : ''}`);
      }
    }
    R.checks = C;
    $r('rvChecks').innerHTML = C.length ? '<ul>' + C.map(c => `<li>${esc(c)}</li>`).join('') + '</ul>' : '특이사항 없음';
    // 표
    const rows = [...P].sort((a, b) => jk(a.jibun) - jk(b.jibun)).map(p => {
      const cls = (p.drawnCut || (p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05)) ? 'bad' : (p.ledgerArea && p.area < p.ledgerArea - 0.05) ? 'warn' : '';
      return `<tr class="${cls}"><td>${esc(p.dong || '')} ${esc(p.jibun)}</td><td>${esc(p.jimok || '')}${p.ledgerJimok && norm(p.ledgerJimok) !== norm(p.jimok) ? '→' + esc(p.ledgerJimok) : ''}</td><td class="n">${fmtN(p.area1)}</td><td class="n">${fmtN(p.area)}</td><td class="n">${fmtN(p.ledgerArea)}</td><td class="n">${p.inDrawn != null ? fmtN(p.drawnIn) : ''}</td><td class="n">${p.outArea ? fmtN(p.outArea, 0) : ''}</td><td>${esc(p.zoning || '')}</td><td class="n">${fmtN(p.jiga, 0)}</td><td>${esc(p.ownerType)}</td><td class="n">${p.rows.length}</td></tr>`;
    }).join('');
    $r('rvTableBox').innerHTML = `<table class="rv-t"><thead><tr><th>지번</th><th>지목</th><th>명부 공부면적</th><th>명부 편입면적</th><th>토지대장</th><th>도면 편입(환산)</th><th>도면 밖(㎡)</th><th>용도지역</th><th>공시지가</th><th>소유구분</th><th>명부 행</th></tr></thead><tbody>${rows}</tbody></table>`;
    renderItems();
  }

  // ---------------------------------------------------------------
  // 5-2. 명부 ↔ 공부 불일치 항목과 판단 (기본값: 공부 우선, 판단 필요 항목은 직접 선택)
  // ---------------------------------------------------------------
  // 건축물대장을 조회한 필지(pnu) - 대장이 있든 없든
  function ledgerQueried() {
    const q = new Set();
    (S.lands || []).forEach(l => { if (l.ledgerEmpty && l.pnu) q.add(l.pnu); });
    (S.buildings || []).forEach(b => { if (b.ledger && b.pnu) q.add(b.pnu); });
    return q;
  }
  const ledgerRows = p => (S.buildings || []).filter(b => b.ledger && ((p.pnu && b.pnu === p.pnu) || (!b.pnu && b.jibun === p.jibun)));
  const sumF = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);

  // 같은 건물이 명부와 건축물대장에 다른 지번으로 올라 있는 경우 짝짓기:
  //   명부엔 건축물이 있는데 대장이 없는 필지(A) ↔ 대장엔 있는데 명부에 건축물이 없는 필지(B), 연면적(±0.5㎡)·사용승인일이 같으면 같은 건물로 봄
  function buildPairs(q) {
    R.pairs = {};
    if (!R.hasBldgCols) return;
    const A = R.parcels.filter(p => p.pnu && q.has(p.pnu) && p.rosterB.length && !ledgerRows(p).length);
    const B = R.parcels.filter(p => ledgerRows(p).length && !p.rosterB.length);
    const used = new Set();
    A.forEach(a => {
      const hit = B.find(b => !used.has(b.key) && a.rosterB.every(rb => ledgerRows(b).some(lb => Math.abs((+lb.floorArea || 0) - (+rb.floor || 0)) <= 0.5 && (!rb.aprDate || !lb.aprDate || lb.aprDate.startsWith(rb.aprDate)))));
      if (!hit) return;
      used.add(hit.key);
      const id = `P|${a.key}|${hit.key}`;
      R.pairs[a.key] = { id, side: 'roster', other: hit }; R.pairs[hit.key] = { id, side: 'ledger', other: a };
    });
  }

  function buildItems() {
    const I = [], q = ledgerQueried();
    // basis: 기본값을 그렇게 둔 근거 (단계가 진행되면 바뀔 수 있음 — 직접 고른 값은 그대로 둠)
    const add = it => I.push({ ...it, basis: it.basis || (it.def ? '공부 우선' : ''), choice: R.choices[it.id] ?? it.def ?? null, manual: R.choices[it.id] != null });
    const L = (p, t) => `${p.dong || ''} ${p.jibun}${t ? ' ' + t : ''}`.trim();
    // 1. 명부 기재: 빠진 칸 종류별 한 줄 (공부면적은 필지별 "면적 미기재" 항목으로 따로), 소유자 수 산정 확인
    const RQ = [['req', '보완 요청'], ['ok', '확인함(그대로)']];
    const byF = new Map(); (R.gaps || []).forEach(gp => gp.fields.forEach(f => { if (f === '공부면적') return; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(gp); }));
    const unitOf = f => /^건축물|사용승인/.test(f) ? '필지' : /^(편입면적|지목)$/.test(f) ? '필지' : '행';
    const totalOf = f => /^건축물|사용승인/.test(f) ? R.parcels.filter(p => p.rosterB.length).length : unitOf(f) === '필지' ? R.parcels.length : null;
    byF.forEach((list, f) => add({ id: `M|${f}`, kind: '명부', loc: '명부', label: `${f} 미기재 ${list.length.toLocaleString()}${unitOf(f) === '행' ? '행' : '필지'}${totalOf(f) && list.length === totalOf(f) ? ' (칸 전체가 비어 있음)' : totalOf(f) ? ` / ${totalOf(f).toLocaleString()}` : ''}`,
      roster: list.slice(0, 6).map(x => `${x.jibun}(${x.row}행)`).join(', ') + (list.length > 6 ? ' …' : ''), ledger: '행별 목록은 판단표 엑셀 "명부 기재 누락(행별)" 시트', opts: RQ }));
    if (R.declaredOwners != null && R.ownerGroups != null && R.declaredOwners !== R.ownerGroups) add({ id: 'M|count', kind: '명부', loc: '명부', label: `명부에 적힌 총 토지등소유자수 ${R.declaredOwners}명 ≠ 토지등소유자 번호 ${R.ownerGroups}개`, roster: R.declaredOwners + '명', ledger: R.ownerGroups + '개', opts: RQ });
    const multi = R.owners.filter(o => !o.isPublic && o.nos.length > 1);
    if (multi.length) add({ id: 'M|multi', kind: '명부', loc: '명부', label: `같은 사람(성명+생년)이 서로 다른 토지등소유자 번호에 있음 ${multi.length}명 — 토지등소유자 수 산정(시행령 제33조) 확인`,
      roster: multi.slice(0, 6).map(o => o.nos.join('/')).join(', ') + (multi.length > 6 ? ' …' : ''), ledger: '번호 목록은 검토표 엑셀 "복수번호" 시트', opts: RQ });
    buildPairs(q);
    Object.values(R.pairs).filter(x => x.side === 'ledger').forEach(x => {
      const a = x.other, b = R.parcels.find(p => R.pairs[p.key] === x);
      add({ id: x.id, kind: '건축물', loc: `${L(a)} ↔ ${b.jibun}`, label: `같은 건물이 다른 지번에 등재 — 명부 ${a.jibun}, 건축물대장 ${b.jibun}`, roster: `${a.jibun}: ${rbText(a.rosterB)}`, ledger: `${b.jibun}: ${lbText(ledgerRows(b))}`,
        opts: [['ledger', `건축물대장 지번(${b.jibun})으로 기재`], ['roster', `명부 지번(${a.jibun})으로 기재`]], def: 'ledger', basis: '연면적·사용승인일이 같아 같은 건물로 봄, 대장 지번 우선' });
    });
    R.parcels.forEach(p => {
      if (R.fetched && !p.feat) add({ id: `L|${p.key}|miss`, kind: '토지', loc: L(p), label: '지적도에서 못 찾음(분할·합병·지번 오기 의심)', roster: `${p.jibun} ${fmtN(p.area)}㎡`, ledger: '없음',
        opts: [['keep', '명부대로 조서에 기재'], ['drop', '조서에서 제외']] });
      // 명부에 면적이 비어 있는 필지: 명부 합계에는 빠졌지만 조서에는 토지대장 면적으로 넣음(기본)
      if (p.area1 == null && p.areaIn == null) add({ id: `L|${p.key}|noarea`, kind: '토지', loc: L(p), label: '명부 면적 미기재 (명부 합계에서 빠져 있음)', roster: '빈칸', ledger: p.ledgerArea ? fmtN(p.ledgerArea) + '㎡' : '대장 면적 없음',
        opts: [['ledger', `토지대장 면적으로 포함 ${fmtN(p.ledgerArea)}㎡`], ['drop', '조서에서 제외']], def: p.ledgerArea ? 'ledger' : undefined, basis: '명부에 필지가 있으므로 토지대장 면적으로 채움' });
      if (p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05) add({ id: `L|${p.key}|area`, kind: '토지', loc: L(p), label: '공부면적', roster: fmtN(p.area1) + '㎡', ledger: fmtN(p.ledgerArea) + '㎡',
        opts: [['ledger', '토지대장 면적'], ['roster', '명부 면적']], def: 'ledger' });
      if (p.ledgerJimok && p.jimok && norm(p.jimok) !== norm(p.ledgerJimok)) add({ id: `L|${p.key}|jimok`, kind: '토지', loc: L(p), label: '지목', roster: p.jimok, ledger: p.ledgerJimok,
        opts: [['ledger', '토지대장 지목'], ['roster', '명부 지목']], def: 'ledger' });
      // 지적도(연속지적) 그림 면적과 대장 면적이 크게 다름 → 구역에 다 들어왔는지 지도만으로 판단하기 어려움
      if (p.ledgerArea && p.cadArea && Math.abs(p.cadArea - p.ledgerArea) >= 10 && Math.abs(p.cadArea - p.ledgerArea) / p.ledgerArea >= 0.2) add({ id: `L|${p.key}|cadarea`, kind: '토지', loc: L(p),
        label: `지적도 면적 차이 ${Math.round((p.cadArea / p.ledgerArea - 1) * 100)}% (지적도 그림 ${fmtN(p.cadArea, 0)}㎡)`, roster: p.area1 != null ? fmtN(p.area1) + '㎡' : '', ledger: fmtN(p.ledgerArea) + '㎡',
        opts: [['ledger', '대장 면적대로(지적도는 참고)'], ['survey', '지적 확인 필요(지적측량·지적도 등본)']], def: 'ledger', basis: '조서 면적은 대장 기준. 지적도 그림이 작거나 커서 일부 편입 비율 계산이 틀릴 수 있음' });
      if (hasCut(p)) {
        const road = isRoadP(p), o = [];
        CUT_MODES.forEach(([k, f, lab]) => { if (p[f]) o.push([k, `${lab} ${fmtN(p[f].inArea)}㎡`]); });
        o.push(['roster', `${road ? '도로' : '필지'} 전체(명부대로) ${fmtN(p.ledgerArea ?? p.area)}㎡`], ['none', '구역에서 뺌']);
        if (p.drawnIn != null) o.push(['drawn', `신청 도면 구역선대로 ${fmtN(p.drawnIn)}㎡`]);
        const m0 = CUT_MODES.find(m => p[m[1]]), c0 = p[m0[1]];
        const ask = !p.cutM && m0[0] === 'edge' && p.cutAsk && p.cutAsk.length;   // 작은 필지 때문에 관통 도로로 본 경우 물어봄
        // 신청 도면이 있으면: 도면 구역선(굵은 이점쇄선이라 1m 안팎 오차)은 어느 쪽인지만 보고, 경계는 지적선 기준 방식 중 도면에 가장 가까운 것으로
        //   가까운 것이 없으면(15㎡·15% 넘게 차이) 물어봄. 도면이 있으면 자투리 필지 질문은 도면으로 갈음
        let def = m0[0], askD = false, snapNote = '';
        if (p.drawnIn != null && !p.cutM) {
          const cand = [...CUT_MODES.filter(m => p[m[1]] && m[0] !== 'manual').map(m => [m[0], p[m[1]].inArea, m[2]]), ['roster', p.ledgerArea ?? p.area, '전체'], ['none', 0, '빼기']];
          const best = cand.reduce((b, x) => Math.abs(x[1] - p.drawnIn) < Math.abs(b[1] - p.drawnIn) ? x : b);
          const dd = Math.abs(best[1] - p.drawnIn);
          if (dd <= Math.max(15, Math.max(best[1], p.drawnIn) * 0.15)) { def = best[0]; snapNote = ` · 도면 구역선(${fmtN(p.drawnIn)}㎡)에 가장 가까운 "${best[2]}"(${fmtN(best[1])}㎡)로 둠`; }
          else { askD = true; snapNote = ` · 신청 도면 구역선(${fmtN(p.drawnIn)}㎡)이 지적선 기준 어느 방식과도 맞지 않습니다 — 골라 주세요`; }
        }
        const askAny = (p.drawnIn == null && ask) || askD;
        p.cutDef = askAny ? null : def;
        add({ id: `L|${p.key}|cut`, kind: '토지', loc: L(p), label: `${road ? '경계 도로' : '경계 필지(분할 측량 필요)'} — 구역 밖 ${fmtN(c0.outArea)}㎡${p.cutM ? ' · 직접 자름' : ''}` +
            (p.drawnIn == null && ask ? ` · 건너편이 자투리 명부 필지 ${p.cutAsk.join(', ')}라 관통 도로로 본 부분이 있습니다 — 넣을지 뺄지 골라 주세요` : '') + snapNote, roster: `편입 ${fmtN(p.area)}㎡`,
          ledger: `대장 ${fmtN(p.ledgerArea)}㎡ 중 ${m0[2]} ${fmtN(c0.inArea)}㎡${p.drawnIn != null ? ` · 도면 ${fmtN(p.drawnIn)}㎡` : ''}`, opts: o, def: askAny ? undefined : def,
          basis: p.cutM ? '직접 자름' : p.drawnIn != null ? (askD ? '신청 도면과 맞는 방식 없음' : '신청 도면에 가장 가까운 지적선 기준') : ask ? '건너편이 자투리 필지' : `${m0[2]}(기본 방식)` });
      } else if (p.drawnCut) {
        // 신청 도면 구역선이 이 필지를 자르거나 통째로 밖에 둠 (명부에는 있음) → 물어봄
        // 도면 선은 굵어 1m 안팎 오차가 있으므로 지적선 기준으로: 구역선 안 70% 이상이면 필지 전체, 30% 이하면 뺌, 그 사이만 물어봄
        const inR = p.cadArea ? p.inDrawn / p.cadArea : 0, road = isRoadP(p);
        const def = inR >= 0.7 ? 'roster' : inR <= 0.3 ? 'drop' : undefined;
        p.inDef = def || null;
        add({ id: `L|${p.key}|in`, kind: '토지', loc: L(p), label: `신청 도면 구역선 안 ${Math.round(inR * 100)}% — ` + (def === 'drop' ? '도면상 구역 밖(명부에는 있음)' : def === 'roster' ? '도면상 구역 안(선 어긋남, 필지 전체)' : `도면 구역선이 ${road ? '필지' : '대지'} 가운데를 지남 — 골라 주세요`),
          roster: `편입 ${fmtN(p.area)}㎡`, ledger: `도면 구역선 안 약 ${fmtN(p.drawnIn)}㎡`,
          opts: [['roster', `필지 전체 넣기 ${fmtN(p.ledgerArea ?? p.area)}㎡`], ['drop', '조서에서 제외'], ['drawn', `도면대로 일부 편입 약 ${fmtN(p.drawnIn)}㎡${road ? '' : '(분할 측량 필요)'}`]], def,
          basis: def ? `신청 도면 구역선 안 ${Math.round(inR * 100)}% (70% 이상 전체·30% 이하 제외)` : '도면 구역선이 필지 가운데를 지남' });
      }
      // 건축물
      if (!p.pnu || !q.has(p.pnu) || R.pairs[p.key]) return;
      const LB = ledgerRows(p), RB = p.rosterB;
      if (!LB.length && RB.length) {
        const unl = RB.every(b => b.permit === '무허가');
        add({ id: `B|${p.key}`, kind: '건축물', loc: L(p), label: unl ? '건축물대장 없음 — 명부상 무허가건축물' : '건축물대장 없음 — 명부엔 건축물 있음', roster: rbText(RB), ledger: '대장 없음',
          opts: [['roster', unl ? '무허가건축물로 기재' : '명부대로 기재(대장 없음 표기)'], ['drop', '건축물 없음(조서 제외)']], def: unl ? 'roster' : undefined, basis: unl ? '명부에 무허가로 적힘' : '' });
      } else if (LB.length && !RB.length && R.hasBldgCols) {
        add({ id: `B|${p.key}`, kind: '건축물', loc: L(p), label: '명부에 건축물 기재 없음', roster: '없음', ledger: lbText(LB), opts: [['ledger', '건축물대장대로 기재'], ['drop', '조서 제외']], def: 'ledger' });
      } else if (LB.length && RB.length) {
        // 명부는 한 칸에 용도·구조를 여럿 적거나(주택,근린생활시설 / 연와조,세멘블럭조) 부속건물을 동수에 넣는 일이 많으므로
        //   연면적이 같으면 동수 차이는 부속건물로 보고, 용도·구조는 명부에 적힌 것 중 하나라도 대장과 같으면 일치로 봄
        const d = []; let badYear = false;
        const fL = sumF(LB, b => b.floorArea), fR = sumF(RB, b => b.floor);
        const sameArea = !fR || Math.abs(fL - fR) <= Math.max(1, fL * 0.01);
        if (!sameArea) d.push(`연면적 ${fmtN(fR)}≠${fmtN(fL)}㎡`);
        const nL = sumF(LB, b => b.dongs || 1), nR = sumF(RB, b => b.dongs || 1);
        if (nL !== nR && !(sameArea && nR > nL)) d.push(`동수 ${nR}≠${nL}`);
        if (LB.length === 1 && RB.length === 1) {
          const a = LB[0], b = RB[0], parts = t => String(t || '').replace(/R\s*[.,]\s*C/gi, 'RC').split(/[,·\/]|외\s*\d*/).map(s => s.trim()).filter(Boolean);
          const apt = ['아파트', '연립주택', '다세대주택'].includes(a.use), house = apt || ['단독주택', '다가구주택'].includes(a.use);
          const useOk = u => { const s = useStd(u); return s === a.use || (s === '공동주택' && apt) || (/^주택$/.test(u) && house); };
          if (b.use && !parts(b.use).some(useOk)) d.push(`용도 ${b.use}≠${a.use}`);
          if (b.structure && !parts(b.structure).some(s => structStd(s) === a.structure)) d.push(`구조 ${b.structure}≠${a.structureName || a.structure}`);
          if (b.aprDate && a.aprDate && b.aprDate.slice(0, b.aprDate.length) !== a.aprDate.slice(0, b.aprDate.length)) { d.push(`사용승인 ${b.aprDate}≠${a.aprDate}${+a.aprDate.slice(0, 4) < 1900 ? '(대장 연도 오류 의심)' : ''}`); if (+a.aprDate.slice(0, 4) < 1900) badYear = true; }
        }
        if (d.length) add({ id: `B|${p.key}`, kind: '건축물', loc: L(p), label: d.join(', '), roster: rbText(RB), ledger: lbText(LB), opts: [['ledger', '건축물대장대로'], ['roster', '명부대로']], def: badYear ? 'roster' : 'ledger', basis: badYear ? '건축물대장 연도 오류 의심이라 명부' : '공부 우선' });
      }
    });
    // 실제 길이 지나가는 경계 대지(대지가 도로를 막는 모양): 대지 경계를 그대로 쓰면 안 될 수 있어 판단 필요로 띄움
    // 경계 대지인지는 지금 구역 경계(도로를 자른 뒤)에서 2m 안에 닿는지로 봄
    if (R.zone && R._edgeZone !== R.zone) { const o = turf.polygonToLine(R.zone); R._edgeLines = o.type === 'FeatureCollection' ? o.features : [o]; R._edgeZone = R.zone; }
    R.parcels.forEach(p => { if (p.hroad) { try { const bf = turf.buffer(p.feat, 2, { units: 'meters' }); p.hroad.edge = (R._edgeLines || []).some(l => turf.booleanIntersects(bf, l)); } catch (e) { } } });
    R.parcels.filter(p => p.hroad && p.hroad.edge).forEach(p => add({ id: `L|${p.key}|hroad`, kind: '구역계', loc: L(p),
      label: `실제 길(${p.hroad.names || '도로명 없음'})이 대지 안을 약 ${p.hroad.len}m 지남 — 지적상 대지가 도로를 막는 모양`,
      roster: `${p.ledgerJimok || p.jimok || ''} ${fmtN(p.ledgerArea)}㎡`, ledger: '도로명주소 도로 중심선 기준',
      opts: [['keep', '대지 경계대로 둠'], ...(planCutGeom(p) ? [['plan', `도시계획도로 경계로 관통(${p.facility || '도시계획도로'} 부분 제외)`]] : []), ['cut', '직접 잘라 정함(현황 도로 기준)'], ['note', '현황 도로로 표시만(구역 안 기반시설)']], basis: '' }));
    // 구역계 선형 점검 결과: 이대로 둘지, 고칠지(필지 넣기·빼기 검토) 확인
    (R.shapeIssues || []).forEach(s => {
      const lots = s.lots.map(l => l.jibun + (l.roster ? '(명부)' : '(명부 밖)')).join(', ');
      const cc = turf.centroid(s.geom).geometry.coordinates;   // 같은 필지에 여러 곳이 있어도 구별되게 위치(약 10m 단위)를 id에 넣음
      add({ id: `Z|${s.type}|${s.lots.map(l => l.jibun).join(',')}|${Math.round(cc[0] * 1e4)},${Math.round(cc[1] * 1e4)}`, kind: '구역계', loc: lots || '경계', label: `구역계 선형: ${SHAPE_NAME[s.type]} ${s.type === 'noplan' ? `약 ${fmtN(s.area, 0)}m` : `약 ${fmtN(s.area, 0)}㎡`}`,
        roster: lots, ledger: '', opts: [['ok', '이대로 둠'], ['fix', '고칠 필요(필지 넣기·빼기 검토)']], basis: '' , geom: s.geom });
    });
    (R.extra || []).forEach(e => add({ id: `X|${e.jibun}`, kind: '토지', loc: e.jibun, label: '신청 도면 구역선 안인데 명부에 없음', roster: '없음', ledger: `구역선 안 ${fmtN(e.inArea, 0)}㎡`,
      opts: [['skip', '조서에 넣지 않음'], ['add', '조서에 추가(소유자 미상)']] }));
    // 검토 순서대로: ① 구역계 → ② 토지(공부 대조) → ③ 건축물, 단계 안에서는 판단 필요 먼저, 그다음 지번 순
    //   4·5단계(구역계)에서 프로그램이 기본값으로 정한 것은 "자동 — 확인 필요": 직접 고르거나 [확인]해야 검토를 마칠 수 있음
    I.forEach(it => { it.step = stepOf(it.id); it.needCheck = it.step.n >= 4 && it.choice != null && !it.manual; });
    const jkey = it => jk(String(it.loc).replace(/^\S+동\s*/, ''));
    const rank = it => it.choice == null ? 0 : it.needCheck ? 1 : 2;
    I.sort((a, b) => a.step.n - b.step.n || rank(a) - rank(b) || jkey(a) - jkey(b));
    R.items = I;
    return I;
  }
  // 검토 안내와 같은 번호·이름 (판단표의 "검토 단계")
  const GSTEP = { 1: '1. 명부 기재', 2: '2. 토지 공부 대조', 3: '3. 건축물대장 대조', 4: '4. 구역계(경계 도로·선형)', 5: '5. 신청 도면 구역선' };
  const stepOf = id => { const n = /^M\|/.test(id) || /\|noarea$/.test(id) ? 1 : /\|(area|jimok|miss|cadarea)$/.test(id) ? 2 : /^(P|B)\|/.test(id) ? 3 : /\|(cut|hroad)$/.test(id) || /^Z\|/.test(id) ? 4 : 5; return { n, name: GSTEP[n] }; };
  const rbText = RB => RB.map(b => [b.bname, b.use, b.structure, b.floor ? fmtN(b.floor) + '㎡' : '', b.aprDate, b.permit].filter(Boolean).join(' ')).join(' / ');
  const lbText = LB => LB.map(b => [b.name, b.use, b.structureName || b.structure, b.floorArea ? fmtN(b.floorArea) + '㎡' : '', b.aprDate].filter(Boolean).join(' ')).join(' / ');
  const choiceOf = id => { const it = (R.items || []).find(x => x.id === id); return it ? it.choice : null; };

  function renderItems() {
    const box = $r('rvItems'); if (!box) return;
    const I = buildItems();
    const pend = I.filter(it => it.choice == null), chk = I.filter(it => it.needCheck);
    $r('rvItemsSum').textContent = I.length ? `${I.length}건 (판단 필요 ${pend.length}건 · 자동 확인 필요 ${chk.length}건)` : '';
    $r('rvPending').innerHTML = pend.length || chk.length ? `<span class="rv-need">판단 필요 ${pend.length}건 · 자동 판단 확인 ${chk.length}건 남음</span>` : I.length ? '<span class="rv-auto">모든 항목 판단·확인됨</span>' : '';
    renderGuide();
    if (!I.length) { box.innerHTML = '<p class="small muted" style="margin:6px">불일치 항목이 없습니다.</p>'; return; }
    const canSee = it => /^[LBPXZ]\|/.test(it.id);
    box.innerHTML = `<table class="rv-t"><thead><tr><th>검토 단계</th><th>위치</th><th>항목</th><th>명부(제출)</th><th>공부</th><th>조서에 쓸 값</th></tr></thead><tbody>${I.map((it, i) =>
      `<tr class="${it.choice == null ? 'need' : it.needCheck ? 'warn' : ''}"><td>${it.step.name}</td><td>${esc(it.loc)}${canSee(it) ? ` <button type="button" class="btn" data-see="${i}" style="padding:1px 6px;font-size:11px">보기</button>` : ''}</td><td>${esc(it.label)}</td><td>${esc(String(it.roster ?? ''))}</td><td>${esc(String(it.ledger ?? ''))}</td>` +
      `<td><select data-i="${i}">${it.choice == null ? '<option value="">— 선택 —</option>' : ''}${it.opts.map(([v, t]) => `<option value="${v}"${it.choice === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` +
      `${it.needCheck ? ` <span class="rv-need">자동 — 확인 필요</span> <button type="button" class="btn" data-ok="${i}" style="padding:1px 6px;font-size:11px">✓ 확인</button>` : it.manual ? ' <span class="rv-auto">확인함</span>' : it.def ? ' <span class="rv-auto">기본</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
    // [✓ 확인]: 자동으로 정한 값을 그대로 확정(직접 고른 것과 같게 기록)
    box.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => {
      const it = I[+b.dataset.ok]; R.choices[it.id] = it.choice; R.confirmed = null;
      const pp = /\|(cut|in)$/.test(it.id) ? R.parcels.find(q => q.key === it.id.split('|')[1]) : null;
      renderItems(); if (pp) snapJudge(pp, '자동 판단을 확인함');
    });
    // [보기]: 그 필지(또는 선형 점검 위치)로 지도 이동
    box.querySelectorAll('[data-see]').forEach(b => b.onclick = () => seeItem(I[+b.dataset.see]));
    box.querySelectorAll('select').forEach(s => s.onchange = () => {
      const it = I[+s.dataset.i]; if (s.value) R.choices[it.id] = s.value; else delete R.choices[it.id]; R.confirmed = null; Cutter._z = null;
      const pp = /\|(cut|in|hroad)$/.test(it.id) ? R.parcels.find(q => q.key === it.id.split('|')[1]) : null;
      if (/\|hroad$/.test(it.id) && s.value === 'plan' && pp) { Cutter.applyPlan(pp); renderItems(); return; }
      if (/\|hroad$/.test(it.id)) { renderItems(); if (s.value === 'cut' && pp) { Cutter.showParcel(pp); msg('rvMsg3', `${pp.jibun}: 실제 길(검은 점선)을 보며 [✂ 선 그어 자르기]로 잘라 주세요.`); } else if (pp) snapJudge(pp, '판단표에서 선택'); return; }
      if (/\|(in|noarea)$/.test(it.id) && R.cutDone) { cutRoads().then(() => { drawMap(true); snapJudge(pp, '판단표에서 선택'); }); }   // 대지 쪽이 바뀌면 경계 도로도 다시
      else if (/\|cut$/.test(it.id)) { R.zone = unionAll(zoneFeats()) || R.zoneFull; checkShape(); runChecks(); drawMap(true); snapJudge(pp, '판단표에서 선택'); } else renderItems();
    });
  }

  // 판단 항목 위치로 지도를 옮기고 강조(필지는 직접 자르기 판도 그 필지로)
  function seeItem(it) {
    if (!R.leaflet) return;
    const key = it.id.split('|')[1], p = /^[LB]\|/.test(it.id) ? R.parcels.find(q => q.key === key) : /^P\|/.test(it.id) ? R.parcels.find(q => q.key === key) : null;
    let g = it.geom || (p && p.feat);
    if (!g && /^X\|/.test(it.id)) { const e = (R.extra || []).find(x => `X|${x.jibun}` === it.id); g = e && e.geom; }
    if (!g) return;
    $r('rvMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (R.layers.see) R.leaflet.removeLayer(R.layers.see);
    R.layers.see = L.geoJSON(g, { style: { color: '#d10000', weight: 4, fill: true, fillColor: '#ff0000', fillOpacity: 0.25, dashArray: '6 4' }, interactive: false }).addTo(R.leaflet);
    R.leaflet.fitBounds(L.geoJSON(g).getBounds(), { padding: [80, 80], maxZoom: 20 });
    if (p && /\|(cut|in)$/.test(it.id)) { Cutter.showParcel(p); }
  }

  // ⑤ 판단표 엑셀: 내려받아 "내 선택" 칸을 채운 뒤 다시 올리면 반영 (id 칸으로 항목을 찾음)
  const ITEM_HEAD = ['번호', '검토 단계', '위치', '항목', '명부(제출)', '공부·도면', '지금 값', '상태', '기본값 근거', '고를 수 있는 값', '내 선택', 'id', '로드뷰(카카오)', '로드뷰(다음)', '네이버 지도(거리뷰)'];
  function exportItems() {
    const I = buildItems(); if (!I.length) return msg('rvMsg5', '판단할 항목이 없습니다.', true);
    const lab = it => ((it.opts.find(o => o[0] === it.choice) || [])[1]) || '';
    const rows = I.map((it, i) => [i + 1, it.step.name, it.loc, it.label, String(it.roster ?? ''), String(it.ledger ?? ''), lab(it),
      it.choice == null ? '판단 필요' : it.manual ? '직접 선택' : '기본값', it.manual ? '직접 선택(다음 단계에서도 유지)' : it.basis || '', it.opts.map(o => o[1]).join(' / '), '', it.id,
      ...(() => { const p = /^[LB]\|/.test(it.id) ? R.parcels.find(q => q.key === it.id.split('|')[1]) : null, l = p && p.feat ? roadviewLinks(p) : null; return l ? [l.kakao, l.daum, l.naver] : ['', '', '']; })()]);
    const ws = XLSX.utils.aoa_to_sheet([[`${$r('rvName').value || '정비구역'} — 명부 ↔ 공부 대조 판단표 (${new Date().toLocaleString('ko-KR')})`], ['검토 안내 순서(2 토지 공부 → 3 건축물대장 → 4 경계 도로 → 5 신청 도면)대로, 단계 안에서는 판단 필요 먼저. 뒤 단계가 진행되면 기본값이 바뀔 수 있고(기본값 근거 칸), 직접 고른 값은 유지됩니다.'], ['"내 선택" 칸에 "고를 수 있는 값" 중 하나를 그대로 적어(앞부분만 적어도 됨) 검토 모드 ⑤에 올리면 반영됩니다. 빈칸은 지금 값 그대로. id 칸은 고치지 마세요.'], ITEM_HEAD, ...rows]);
    ws['!cols'] = [6, 18, 22, 60, 30, 36, 30, 10, 34, 70, 28, 30, 44, 44, 50].map(w => ({ wch: w }));
    // 로드뷰 칸은 누르면 열리는 하이퍼링크로
    rows.forEach((r, i) => [12, 13, 14].forEach(c => { const a = XLSX.utils.encode_cell({ r: 4 + i, c }); if (ws[a] && ws[a].v) ws[a].l = { Target: ws[a].v }; }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: ITEM_HEAD.length - 1 } }) };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '판단표');
    if ((R.gaps || []).length) {   // 보완 요청에 바로 쓰는 행별 목록 (개인정보 없이 행·번호·지번만)
      const gs = XLSX.utils.aoa_to_sheet([['명부 엑셀 행', '토지등소유자 번호', '지번', '확인 단위', '빠진 칸'], ...R.gaps.map(x => [x.row, x.no, x.jibun, x.unit || '행', x.fields.join(', ')])]);
      gs['!cols'] = [12, 18, 14, 10, 60].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, gs, '명부 기재 누락(행별)');
    }
    XLSX.writeFile(wb, `${$r('rvName').value || '정비구역'}_판단표.xlsx`);
    msg('rvMsg5', `판단표 ${I.length}건(판단 필요 ${I.filter(i => i.choice == null).length}건)을 내려받았습니다.`);
  }
  async function importItems(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const a = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const hr = a.findIndex(r => r.includes('id') && r.includes('내 선택')); if (hr < 0) throw new Error('판단표 형식이 아닙니다("내 선택"·"id" 칸 없음)');
    const ci = a[hr].indexOf('id'), cs = a[hr].indexOf('내 선택');
    const I = buildItems(), byId = new Map(I.map(it => [it.id, it]));
    let ok = 0; const bad = [], changed = [];
    a.slice(hr + 1).forEach(r => {
      const id = String(r[ci] || '').trim(), sel = String(r[cs] || '').trim(); if (!id || !sel) return;
      const it = byId.get(id); if (!it) { bad.push(`${sel}(항목 없음)`); return; }
      const n = s => s.replace(/\s+/g, '');
      const o = it.opts.find(x => x[0] === sel || n(x[1]) === n(sel)) || it.opts.find(x => n(x[1]).startsWith(n(sel)));
      if (!o) { bad.push(`${it.loc}: "${sel}"`); return; }
      R.choices[id] = o[0]; ok++; if (/\|(cut|in)$/.test(id)) changed.push(id.split('|')[1]);
    });
    R.confirmed = null; Cutter._z = null;
    if (R.zoneFull) { R.zone = unionAll(zoneFeats()) || R.zoneFull; checkShape(); }
    runChecks(); drawMap(true);
    changed.forEach(k => snapJudge(R.parcels.find(q => q.key === k), '판단표 엑셀에서 반영'));
    const pend = (R.items || []).filter(i => i.choice == null).length;
    msg('rvMsg5', `판단표에서 ${ok}건을 반영했습니다. 남은 판단 필요 ${pend}건.` + (bad.length ? `\n못 알아본 값 ${bad.length}건: ${bad.slice(0, 10).join(', ')}` : ''), !!bad.length);
  }

  // ---------------------------------------------------------------
  // 검토 안내: 자료를 올리면 지금 무엇이 됐고 무엇이 더 필요한지 단계별로 보여 줌 (runChecks마다 갱신)
  // ---------------------------------------------------------------
  function renderGuide() {
    const box = $r('rvGuide'); if (!box) return;
    const P = R.parcels, rows = [];
    const add = (st, step, title, note) => rows.push({ st, step, title, note });
    const S_ = { ok: '완료', todo: '필요', warn: '확인', wait: '대기' };
    if (!P.length) add('todo', 'rvS1', '토지등소유자 명부(별지 제9호 엑셀)를 올려 주세요', '명부를 올리면 필요한 자료와 할 일을 여기에 안내합니다.');
    else {
      const w = [];
      if (R.map.areaIn == null) w.push('편입면적 칸 없음');
      if (!R.hasBldgCols) w.push('건축물 칸 없음(건축물조서는 대장으로만)');
      const noA = P.filter(p => p.area1 == null && p.areaIn == null).length; if (noA) w.push(`면적 빈 필지 ${noA}개`);
      if (R.declaredOwners != null && R.ownerGroups != null && R.declaredOwners !== R.ownerGroups) w.push(`총 토지등소유자수 ${R.declaredOwners} ≠ 번호 ${R.ownerGroups}`);
      const c1 = (R.items || []).filter(i => i.step && i.step.n === 1), k1 = c1.filter(i => i.choice == null).length;
      if (c1.length) w.push(`판단표 ${c1.length}건${k1 ? `(확인 필요 ${k1})` : ''}`);
      add(k1 ? 'todo' : w.length ? 'warn' : 'ok', 'rvS1', `명부 기재: 필지 ${P.length.toLocaleString()}개 · 토지등소유자 ${(R.ownerGroups ?? R.owners.length).toLocaleString()}명${R.hasBldgCols ? ` · 건축물 ${P.reduce((a, p) => a + p.rosterB.length, 0).toLocaleString()}동` : ''}`, w.join(' · '));
    }
    if (P.length) {
      // 2~5번은 판단표의 "검토 단계"와 같은 번호. 각 줄에 그 단계에서 나온 판단 건수를 붙임
      const I = R.items || [], pend = I.filter(i => i.choice == null || i.needCheck).length;
      const cnt = n => { const a = I.filter(i => i.step && i.step.n === n), k = a.filter(i => i.choice == null).length, q = a.filter(i => i.needCheck).length;
        return a.length ? `판단표 ${a.length}건${k ? ` · 판단 필요 ${k}` : ''}${q ? ` · 자동 판단 확인 ${q}` : ''}` : ''; };
      const st = (base, n) => I.some(i => i.step && i.step.n === n && (i.choice == null || i.needCheck)) ? 'todo' : base;
      const join = (...xs) => xs.filter(Boolean).join(' · ');
      // 2. 토지 공부 대조
      if (!R.fetched) add('todo', 'rvS2', '토지 공부 대조 — ② 지적도·토지특성 조회를 해 주세요', `필지 ${P.length.toLocaleString()}개 — 약 ${Math.max(1, Math.round(P.length * 0.45 / 60))}분. 대장면적·지목·용도지역·공시지가와 대조합니다.`);
      else {
        const miss = P.filter(p => !p.feat).length, dA = P.filter(p => p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05).length, dJ = P.filter(p => p.ledgerJimok && p.jimok && norm(p.jimok) !== norm(p.ledgerJimok)).length;
        add(st(miss || dA || dJ ? 'warn' : 'ok', 2), 'rvS2', '토지 공부 대조 완료', join(miss ? `지적도에 없는 필지 ${miss}` : '', dA ? `공부면적 다름 ${dA}` : '', dJ ? `지목 다름 ${dJ}` : '', cnt(2)) || '명부와 공부 일치');
      }
      // 3. 건축물대장 대조
      const q = ledgerQueried();
      if (!R.fetched) add('wait', 'rvS2', '건축물대장 대조', '토지 공부 조회 뒤에 합니다.');
      else if (!q.size) add('todo', 'rvS2', '건축물대장 대조 — ② 건축물대장 조회를 해 주세요', `건축물조서와 ${R.hasBldgCols ? '명부의 건축물(동수·연면적·용도·허가유무) 대조' : '노후도 계산'}에 필요합니다. 필지 수에 따라 몇 분 걸립니다.`);
      else {
        const nb = (S.buildings || []).filter(b => b.ledger && P.some(p => p.pnu === b.pnu)).length, pr = Object.keys(R.pairs || {}).length / 2;
        add(st(cnt(3) ? 'warn' : 'ok', 3), 'rvS2', `건축물대장 대조 완료: 대장 ${nb.toLocaleString()}동`, join(pr ? `다른 지번에 등재된 같은 건물 ${pr}건` : '', cnt(3)) || '명부와 일치');
      }
      // 4. 경계 도로
      if (!R.fetched) add('wait', 'rvS3', '경계 도로', '토지 공부 조회 뒤에 자동으로 합니다.');
      else {
        const cuts = P.filter(hasCut);
        add(st(cuts.length ? 'warn' : 'ok', 4), 'rvS3', cuts.length ? `경계 도로 ${cuts.length}필지 자동 처리(기본: 접도 도로 불포함${R.drawn ? ', 신청 도면에 가장 가까운 지적선 기준' : ''})` : '경계 도로 — 구역 경계에 걸친 도로 없음',
          join(R.planEdge && R.planEdge.total ? `구역 경계의 ${Math.round(R.planEdge.along / R.planEdge.total * 100)}%가 도시계획도로를 따름(안 따르는 구간 ${R.planEdge.runs.length}곳)` : '', cnt(4), cuts.length ? '③ [직접 자르기]나 판단표에서 바꿀 수 있습니다' : ''));
      }
      // 5. 신청 도면 구역선
      if (!R.fetched) add('wait', 'rvS4', '신청 도면 구역선', '공부 조회 뒤에 편입지적도 PDF를 ④에 올립니다.');
      else if (!R.drawn) add('todo', 'rvS4', '신청 도면 구역선 — 구역계를 확정하려면 편입지적도 PDF를 ④에 올려 주세요',
        '도면 구역선과 맞춰 구역선 밖 필지·대지를 자르는 곳·명부에 없는 필지를 찾고, 경계 도로 기본값도 도면에 맞춰 다시 정합니다.');
      else {
        const ex = (R.extra || []).length;
        add(st(cnt(5) || ex ? 'warn' : 'ok', 5), 'rvS4', `신청 도면 대조 완료 (기준점 ${R.fit ? R.fit.n : '-'}개, 오차 ${R.fit ? R.fit.med.toFixed(1) : '-'}m)`, join(ex ? `구역선 안인데 명부에 없는 필지 ${ex}` : '', cnt(5)) || '도면 구역선과 명부 일치');
      }
      // 6. 판단 마무리
      if (!R.fetched) add('wait', 'rvS5', '판단 마무리', '공부 조회 뒤에 판단표가 만들어집니다.');
      else add(pend ? 'todo' : 'ok', 'rvS5', I.length ? `판단 마무리 — 판단표 ${I.length}건${pend ? ` 중 판단 필요 ${pend}건` : ' 모두 판단됨'}` : '판단 마무리 — 불일치 없음',
        pend ? '⑤ 표나 판단표 엑셀에서 골라 주세요. 뒤 단계(건축물대장·도면)가 진행되면 기본값이 바뀔 수 있고, 직접 고른 값은 그대로 둡니다.' : '필요하면 ⑤에서 바꿀 수 있습니다.');
      // 7. 검토 완료
      if (R.confirmed) add('ok', 'rvS6', `검토 완료 (${R.confirmed.roleLabel} ${R.confirmed.at}) — 토지·건축물 조서를 내려받았습니다`, '');
      else add(R.fetched && !pend ? 'todo' : 'wait', 'rvS6', '검토 완료 → 토지·건축물 조서(별지 제4호)', R.fetched && !pend ? '⑥ [검토 완료 · 조서 만들기]를 누르면 조서 엑셀이 나옵니다.' : '위 단계가 끝나면 누를 수 있습니다.');
    }
    box.innerHTML = `<h4>검토 안내 <small class="muted">— 누르면 해당 단계로 갑니다</small></h4><ol>${rows.map(x => `<li class="${x.st}" data-go="${x.step}"><b class="s">${S_[x.st]}</b>${esc(x.title)}${x.note ? ` <small>${esc(x.note)}</small>` : ''}</li>`).join('')}</ol>`;
    box.querySelectorAll('[data-go]').forEach(li => li.onclick = () => { const e = $r(li.dataset.go); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  // ---------------------------------------------------------------
  // 6. 검토 완료 → 토지·건축물 조서
  // ---------------------------------------------------------------
  const ROLE_LS = 'jbs_reviewRole';
  const roleLabel = () => ($r('rvRole') || {}).value === 'officer' ? '구청 담당자' : '추진주체';
  function roleUi() {
    const off = $r('rvRole').value === 'officer';
    $r('rvConfirm').textContent = off ? '검토 완료 · 조서 만들기' : '제출 전 확인 완료 · 조서 만들기';
  }
  const signInfo = () => ({ writerTitle: $r('rvWTitle').value.trim(), writer: $r('rvWName').value.trim(), checkerTitle: $r('rvCTitle').value.trim(), checker: $r('rvCName').value.trim() });

  function confirmReview() {
    if (!R.parcels.length) return msg('rvMsgC', '먼저 ① 명부를 올려 주세요.', true);
    if (!R.fetched) return msg('rvMsgC', '② 공부 조회(지적도·토지특성)를 먼저 해 주세요. 공부와 대조해야 조서를 확정할 수 있습니다.', true);
    const I = buildItems(); renderItems();
    const pend = I.filter(it => it.choice == null || it.needCheck);
    if (pend.length) { msg('rvMsgC', `⑤에서 판단 필요·자동 판단 확인이 남은 항목 ${pend.length}건을 먼저 정해 주세요: ${pend.slice(0, 8).map(it => `${it.loc} ${it.label}${it.needCheck ? '(자동 — 확인 필요)' : ''}`).join(' / ')}${pend.length > 8 ? ' …' : ''}`, true); $r('rvItems').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const z = zoneData(); if (!z) return;
    const now = new Date(), at = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    z.confirm = { role: $r('rvRole').value, roleLabel: roleLabel(), at };
    R.confirmed = z.confirm;
    renderGuide();
    renderPreview(z);
    Forms.exportForms(z, `${z.name}_토지및건축물조서.xlsx`, { sign: signInfo() });
    // 구역계 판단 설명자료는 시스템이 자동으로 함께 만듦 (필지별 최종 판단 화면 + 변경 이력)
    const doc = setTimeout(() => downloadJudgeHtml(), 300);
    const nb = z.buildings.length;
    msg('rvMsgC', `${roleLabel()} ${at} 검토 완료 → 토지조서 ${z.parcels.length}필지(편입 ${fmtN(z.parcels.reduce((a, p) => a + (+p.area || 0), 0))}㎡), 건축물조서 ${nb}동을 엑셀로, 구역계 판단 설명자료(필지별 판단 화면)를 함께 내려받았습니다.` +
      (z.ledgerQueried ? '' : '\n※ 건축물대장을 조회하지 않아 건축물조서는 명부 기준입니다.') + (I.length ? `\n불일치 ${I.length}건의 판단 내용은 [제4호_대조표] 시트에 남겼습니다.` : ''));
  }

  function renderPreview(z) {
    const N = 300, P = [...z.parcels].sort((a, b) => jk(a.jibun) - jk(b.jibun)), B = z.buildings || [];
    const own = p => { const u = [...new Set((p.owners || []).map(o => o.name).filter(Boolean))]; return u.length > 1 ? `${u[0]} 외 ${u.length - 1}인` : u[0] || ''; };
    const lt = P.slice(0, N).map((p, i) => `<tr><td class="n">${i + 1}</td><td>${esc(`${p.dong || ''} ${p.jibun}`)}</td><td>${esc(p.jimok || '')}</td><td class="n">${fmtN(p.area)}</td><td>${esc(p.zoning || '')}</td><td>${esc(own(p))}</td><td>${esc(p.landUse || '')}</td></tr>`).join('');
    const bt = B.slice(0, N).map((b, i) => `<tr><td class="n">${i + 1}</td><td>${esc(`${b.dong || ''} ${b.jibun}${b.bname ? ' ' + b.bname : ''}`)}</td><td>${esc(b.use || '')}</td><td>${esc(b.structure || '')}</td><td class="n">${b.dongs || 1}</td><td class="n">${b.units ?? ''}</td><td class="n">${b.households ?? ''}</td><td>${esc(String(b.year || ''))}</td><td class="n">${fmtN(b.archArea)}</td><td class="n">${fmtN(b.floorArea)}</td><td>${esc(b.floorsLabel || '')}</td><td>${esc(b.note || '')}</td></tr>`).join('');
    $r('rvPreview').innerHTML = `<div class="rv-pv"><h4>1. 토지조서 <small class="muted">${P.length}필지, 계 ${fmtN(P.reduce((a, p) => a + (+p.area || 0), 0))}㎡${P.length > N ? ` (앞 ${N}필지만 표시)` : ''}</small></h4>
<div class="rv-scroll"><table class="rv-t"><thead><tr><th>연번</th><th>위치</th><th>지목</th><th>면적(㎡)</th><th>용도지역</th><th>소유주</th><th>용도</th></tr></thead><tbody>${lt}</tbody></table></div>
<h4>2. 건축물 조서 <small class="muted">${B.length}동, 연면적 계 ${fmtN(B.reduce((a, b) => a + (+b.floorArea || 0), 0))}㎡${B.length > N ? ` (앞 ${N}동만 표시)` : ''}</small></h4>
<div class="rv-scroll"><table class="rv-t"><thead><tr><th>연번</th><th>위치</th><th>용도</th><th>구조</th><th>동수</th><th>호수</th><th>세대수</th><th>준공연도</th><th>건축면적</th><th>연면적</th><th>층수(지하/지상)</th><th>비고</th></tr></thead><tbody>${bt}</tbody></table></div></div>`;
  }
  const norm = s => String(s || '').replace('도로', '도').replace('잡종지', '잡').replace('대지', '대').trim().slice(0, 1);
  const jk = j => { const n = String(j).match(/\d+/g) || [0]; return (+n[0]) * 100000 + (+(n[1] || 0)); };

  // ---------------------------------------------------------------
  // 6. 산출물
  // ---------------------------------------------------------------
  // ---- 주택접도율 추정 (도정법 시행령 별표 1) ----
  // 폭 4m 이상 도로(지목 '도로' 필지)에 길이 4m 이상 접한 대지인지 필지마다 판정.
  // 도로 폭: 대지 경계에서 바깥(도로 쪽)으로 수직선을 그어 도로 반대편 경계까지 거리.
  //   도로 필지끼리 맞닿은 경계(도로를 가로로 나눈 선)는 지움 → 여러 필지로 나뉜 도로도 한 덩어리로 잼.
  function roadAccess(features, parcels, opt = {}) {
    const MINW = opt.minWidth || 4, MINL = opt.minLength || 4, STEP = 0.5, OFF = 0.3, MAXW = 60;
    const all = features.filter(f => f && f.geometry);
    if (!all.length) return null;
    let lat0 = 0; all.slice(0, 50).forEach(f => { lat0 += turf.centroid(f).geometry.coordinates[1]; }); lat0 /= Math.min(50, all.length);
    const lon0 = turf.centroid(all[0]).geometry.coordinates[0];
    const KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110540;
    const P = c => [(c[0] - lon0) * KX, (c[1] - lat0) * KY];
    const rings = f => { const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return polys.map(pl => pl.map(r => r.map(P))); };
    const isRoad = f => /도$/.test(String(f.properties.jibun || '')) || f.properties.jimok === '도로';
    // 도로 폴리곤과 경계선
    const roads = all.filter(isRoad).map(f => ({ f, polys: rings(f) }));
    const key = (a, b) => { const k = p => Math.round(p[0] * 5) + ',' + Math.round(p[1] * 5); const x = k(a), y = k(b); return x < y ? x + '|' + y : y + '|' + x; };
    const cnt = new Map(), edges = [];
    roads.forEach(r => r.polys.forEach(pl => pl.forEach(ring => { for (let i = 0; i + 1 < ring.length; i++) { const k = key(ring[i], ring[i + 1]); cnt.set(k, (cnt.get(k) || 0) + 1); edges.push([ring[i], ring[i + 1], k]); } })));
    const G = 20, grid = new Map();
    const cellsOf = (a, b) => { const out = []; const x0 = Math.floor(Math.min(a[0], b[0]) / G), x1 = Math.floor(Math.max(a[0], b[0]) / G), y0 = Math.floor(Math.min(a[1], b[1]) / G), y1 = Math.floor(Math.max(a[1], b[1]) / G); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x + ',' + y); return out; };
    edges.forEach(e => { if (cnt.get(e[2]) > 1) return; cellsOf(e[0], e[1]).forEach(c => { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(e); }); });
    // 도로 폴리곤 bbox 색인(점이 도로 안인지)
    const rgrid = new Map();
    roads.forEach(r => r.polys.forEach(pl => { const xs = pl[0].map(p => p[0]), ys = pl[0].map(p => p[1]); const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; const item = { pl, bb }; cellsOf([bb[0], bb[1]], [bb[2], bb[3]]).forEach(c => { if (!rgrid.has(c)) rgrid.set(c, []); rgrid.get(c).push(item); }); }));
    const inRing = (pt, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
    const inRoad = pt => { const c = Math.floor(pt[0] / G) + ',' + Math.floor(pt[1] / G); return (rgrid.get(c) || []).some(it => pt[0] >= it.bb[0] && pt[0] <= it.bb[2] && pt[1] >= it.bb[1] && pt[1] <= it.bb[3] && inRing(pt, it.pl[0]) && !it.pl.slice(1).some(h => inRing(pt, h))); };
    // 반직선과 도로 바깥 경계의 첫 교점까지 거리
    const cast = (o, d) => {
      let best = Infinity; const seen = new Set();
      for (let t = 0; t <= MAXW; t += G / 2) {
        const p = [o[0] + d[0] * t, o[1] + d[1] * t]; const c = Math.floor(p[0] / G) + ',' + Math.floor(p[1] / G);
        if (seen.has(c)) continue; seen.add(c);
        (grid.get(c) || []).forEach(e => {
          const [a, b] = e; const ex = b[0] - a[0], ey = b[1] - a[1]; const den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-9) return;
          const ax = a[0] - o[0], ay = a[1] - o[1]; const tt = (ax * ey - ay * ex) / den, u = (ax * d[1] - ay * d[0]) / den;
          if (tt > 0.05 && u >= 0 && u <= 1 && tt < best) best = tt;
        });
        if (best < t) break;
      }
      return best;
    };
    const res = [];
    parcels.forEach(p => {
      const f = p.feat; if (!f || !f.geometry) return;
      if (isRoad(f) || /^(도|도로|구|하천|공|공원|철|철도|수|제|제방)$/.test(String(p.jimok || ''))) return;
      let best = 0, run = 0, total = 0, maxW = 0;
      rings(f).forEach(pl => { const ring = pl[0];
        // 바깥 방향 판단: 링의 회전 방향
        let area2 = 0; for (let i = 0; i + 1 < ring.length; i++) area2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        const ccw = area2 > 0;
        run = 0;
        for (let i = 0; i + 1 < ring.length; i++) {
          const a = ring[i], b = ring[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
          const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; const n = ccw ? [ty, -tx] : [-ty, tx];   // 바깥쪽 법선
          const k = Math.max(1, Math.round(L / STEP));
          for (let s = 0; s < k; s++) {
            const t = (s + 0.5) / k; const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const q = [m[0] + n[0] * OFF, m[1] + n[1] * OFF];
            const seg = L / k;
            if (inRoad(q)) {
              let w = Infinity; for (const ang of [-45, -30, -15, 0, 15, 30, 45]) { const ra = ang * Math.PI / 180, c = Math.cos(ra), sn = Math.sin(ra); const x = cast(q, [n[0] * c - n[1] * sn, n[0] * sn + n[1] * c]) * c; if (x < w) w = x; } w += OFF;   // 도로와 비스듬히 만나도 최소폭
              total += seg; if (isFinite(w)) maxW = Math.max(maxW, Math.min(w, MAXW));
              if (isFinite(w) && w >= MINW) { run += seg; best = Math.max(best, run); } else run = 0;
            } else run = 0;
          }
        }
      });
      res.push({ jibun: p.jibun, pnu: p.pnu, jimok: p.ledgerJimok || p.jimok, touchLen: total, longest4: best, maxWidth: maxW, ok: best >= MINL, none: total === 0 });
    });
    return { lots: res, minWidth: MINW, minLength: MINL };
  }

  function roadInfo() {
    const k = R.parcels.length + ':' + Object.keys(R.cadAll || {}).length;
    if (R.road && R.roadKey === k) return R.road;
    R.road = Object.keys(R.cadAll || {}).length ? roadAccess(Object.values(R.cadAll), R.parcels) : null; R.roadKey = k;
    return R.road;
  }
  function toggleRoadLayer() {
    const m = R.leaflet, ra = roadInfo(); if (!m || !ra) return msg('rvMsg6', '② 공부 조회를 먼저 해 주세요.', true);
    if (R.layers.road) { m.removeLayer(R.layers.road); delete R.layers.road; return msg('rvMsg6', '접도 판정 지도를 껐습니다.'); }
    const by = new Map(ra.lots.map(x => [x.jibun, x]));
    const fs = R.parcels.filter(p => by.has(p.jibun) && p.feat).map(p => ({ ...p.feat, properties: { j: p.jibun } }));
    R.layers.road = L.geoJSON({ type: 'FeatureCollection', features: fs }, {
      style: f => { const x = by.get(f.properties.j); return { weight: 0.5, color: '#333', fillOpacity: 0.75, fillColor: x.ok ? '#2e9d4a' : x.none ? '#9a9a9a' : '#d9342b' }; },
      onEachFeature: (f, l) => { const x = by.get(f.properties.j); l.bindTooltip(`${x.jibun} · 도로에 접한 길이 ${x.touchLen.toFixed(1)}m · 4m↑도로 연속 ${x.longest4.toFixed(1)}m · 최대폭 ${x.maxWidth.toFixed(1)}m`); },
    }).addTo(m);
    const ok = ra.lots.filter(x => x.ok).length, none = ra.lots.filter(x => x.none).length;
    msg('rvMsg6', `접도 판정(대지 필지): 접도 ${ok} · 미접도 ${ra.lots.length - ok - none} · 맹지 ${none} → ${(ok / ra.lots.length * 100).toFixed(1)}% (초록 접도, 빨강 미접도, 회색 맹지). 건축물 기준 비율은 건축물대장 조회 후 서식의 [별표1_요건검토]에 나옵니다.`);
  }

  // 별표 1 요건: 사업성 탭의 판정식(Calc)을 구역 자료로 돌림 + 주택접도율 자동 추정값 반영
  // 시군구가 인천이면 인천 조례 기준(노후 연수·선택요건 비율)으로 판정 (사업성 탭에서 직접 고른 경우는 그대로)
  function critFor() {
    const c = JSON.parse(JSON.stringify(S.criteria || {}));
    const sg = ($r('rvSigungu') || {}).value || '';
    if (!c.regionManual && typeof applyRegion === 'function' && typeof REGION_PRESETS !== 'undefined') {
      const reg = Object.keys(REGION_PRESETS).find(k => sg.includes(REGION_PRESETS[k].label.slice(0, 2)));
      if (reg) applyRegion(c, reg);
    }
    return c;
  }

  function zoneReq(parcels, rawB) {
    if (typeof Calc === 'undefined' || !Calc.survey || !Calc.requirements) return { req: [], baseDate: '' };
    const lands = parcels.map(p => ({ id: p.pnu || p.jibun, pnu: p.pnu, jibun: p.jibun, jimok: (p.jimok || '').slice(0, 1) === '잡' ? '잡' : (p.jimok || '').replace('도로', '도').slice(0, 2), area: p.area, owner: '', ownerType: Forms.isPublic(p.ownerType) ? '국공유지' : '사유지', price: p.jiga || 0 }));
    const s2 = { ...S, criteria: critFor(), lands, buildings: rawB };
    let req = [], bd = '';
    try { const sv = Calc.survey(s2); req = Calc.requirements(s2, sv).map(q => ({ ...q })); const d = Calc.baseDate(s2); bd = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''; } catch (e) { console.warn(e); }
    const ra = roadInfo(), bj = ra ? new Map(ra.lots.map(x => [x.jibun, x.ok])) : null;
    const hb = bj ? rawB.filter(b => bj.has(b.jibun)) : [];
    const q = req.find(x => /접도율/.test(x.label));
    if (q && hb.length) {
      const pct = hb.filter(b => bj.get(b.jibun)).length / hb.length * 100, lim = parseFloat(String(q.need)) || 40;
      q.value = `${pct.toFixed(1)}% (자동 추정, 건축물 ${hb.length}동)`; q.pass = pct <= lim;
    }
    return { req, baseDate: bd };
  }

  // 건축물조서: 필지마다 건축물대장(S.buildings) 또는 명부의 건축물 중 ⑤에서 고른 쪽을 씀
  //   판단 전 기본값: 대장이 있으면 대장, 대장이 없거나 조회 전이면 명부
  //   calc: 노후도·요건 계산(Calc)에 넘길 원자료 (용도·구조는 건축물대장과 같은 구분)
  function zoneBuildings(parcels) {
    const q = ledgerQueried();
    const ra = roadInfo(), bj = ra ? new Map(ra.lots.map(x => [x.jibun, x.ok])) : new Map();
    const s2 = { ...S, criteria: critFor() }, C = typeof Calc !== 'undefined' ? Calc : null;
    const ann = b => { if (!C) return {}; try { return { age: C.age(s2, b), limit: C.limitYears(s2, b), old: C.isOld(s2, b) }; } catch (e) { return {}; } };
    const out = [], incl = new Set(parcels.map(p => p.key));
    parcels.forEach(p => {
      let LB = (S.buildings || []).filter(b => (p.pnu && b.pnu === p.pnu) || (!b.pnu && b.jibun === p.jibun));
      const RB = p.rosterB || [], queried = !!(p.pnu && q.has(p.pnu));
      const road = bj.has(p.jibun) ? bj.get(p.jibun) : null;
      // 지번이 엇갈린 짝: 고른 쪽 지번에만 대장 내용으로 한 번 기재
      const pr = p.key && R.pairs && R.pairs[p.key];
      let pairNote = '';
      if (pr) {
        const pc = choiceOf(pr.id);
        // 고른 쪽 필지가 구역에서 빠졌으면(경계 도로 빼기 등) 다른 쪽 필지에 기재
        const otherSide = pr.side === 'roster' ? 'ledger' : 'roster';
        if (pc !== pr.side && !(pc === otherSide && !incl.has(pr.other.key))) return;
        if (pr.side === 'roster') LB = (S.buildings || []).filter(b => b.ledger && b.pnu === pr.other.pnu);
        pairNote = pr.side === 'roster' ? `건축물대장 지번 ${pr.other.jibun}` : `명부 지번 ${pr.other.jibun}`;
      }
      const ch = p.key && !pr ? choiceOf(`B|${p.key}`) : null;
      if (ch === 'drop') return;
      const src = pr ? 'ledger' : ch === 'roster' || ch === 'ledger' ? ch : (LB.length && (queried || !RB.length)) ? 'ledger' : 'roster';
      if (src === 'ledger') LB.forEach(b => {
        const apt = ['아파트', '연립주택', '다세대주택'].includes(b.use), house = apt || ['단독주택', '다가구주택'].includes(b.use);
        out.push({ ...ann(b), calc: b, source: b.ledger ? '건축물대장' : '직접 입력', permit: b.ledger ? '유허가' : '', aprDate: b.aprDate || '', road,
          jibun: p.jibun, pnu: p.pnu, dong: p.dong || '', bname: b.name || '', use: b.use, useStd: b.use, structure: b.structureName || b.structure,
          year: b.year || (b.aprDate || '').slice(0, 4), floorArea: b.floorArea, archArea: b.archArea || '', floors: b.floors || 0, basement: b.basement || 0,
          floorsLabel: b.floors || b.basement ? `${b.basement || 0}/${b.floors || 0}` : '', dongs: b.dongs || 1, units: b.units || '',
          households: house ? b.households || (apt ? b.units : b.families || b.units) || '' : '', note: pairNote || (b.ledger ? '' : '대장 없음(현황조사 필요)') });
      });
      else RB.forEach(b => {
        const cb = { jibun: p.jibun, pnu: p.pnu, use: useStd(b.use) === '공동주택' ? '다세대주택' : useStd(b.use), structure: structStd(b.structure), aprDate: /^\d{4}-\d{2}-\d{2}$/.test(b.aprDate) ? b.aprDate : '',
          year: +String(b.aprDate || '').slice(0, 4) || 0, floorArea: b.floor || 0, archArea: b.arch || 0, units: b.units, resBasement: b.resBasement };
        out.push({ ...ann(cb), calc: cb, source: '명부', permit: b.permit || '', aprDate: b.aprDate || '', road,
          jibun: p.jibun, pnu: p.pnu, dong: p.dong || '', bname: b.bname || '', use: b.use || cb.use, useStd: cb.use, structure: b.structure || '',
          year: cb.year || '', floorArea: b.floor || '', archArea: b.arch || '', floors: b.floors || 0, basement: b.base || 0,
          floorsLabel: b.floors || b.base ? `${b.base || 0}/${b.floors || 0}` : '', dongs: b.dongs || 1, units: b.units || '', households: /주택|아파트|연립|다세대/.test(cb.use) ? b.units || '' : '',
          note: b.permit === '무허가' ? '무허가건축물' : queried ? '건축물대장 없음(명부 기준)' : '건축물대장 미조회(명부 기준)' });
      });
    });
    return out;
  }

  // 전유부(집합건물 호별) → 집합건축물조서
  function zoneUnits(parcels) {
    const set = new Set(parcels.map(p => p.pnu || p.jibun));
    const dongOf = j => (parcels.find(p => p.jibun === j) || {}).dong || '';
    return (S.exposUnits || []).filter(u => set.has(u.pnu) || set.has(u.jibun)).map(u => ({
      dong: dongOf(u.jibun), jibun: u.jibun, bldgName: u.bldNm || '', use: u.purpose || '', dongNo: u.dong || '',
      ho: [u.floor ? u.floor + '층' : '', u.ho || ''].filter(Boolean).join(' '), excl: u.area ?? '' }));
  }

  // ---- 공공데이터(건축HUB) 호출: 내 키로 바꿔 쓰기 + 받은 결과를 이 PC에 30일 저장 ----
  const KEY_LS = 'jbs_myDataKey', TTL = 30 * 864e5;
  const Cache = (() => {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((ok, no) => { try { const r = indexedDB.open('jbs_cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('api'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } }));
    const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('api', mode), st = t.objectStore('api'); const r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); }); };
    return {
      get: k => tx('readonly', st => st.get(k)).catch(() => null),
      put: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => null),
      clear: () => tx('readwrite', st => st.clear()).catch(() => null),
      count: () => tx('readonly', st => st.count()).catch(() => 0),
    };
  })();
  async function cacheInfo() { const n = await Cache.count(); const el = document.getElementById('rvCacheInfo'); if (el) el.textContent = n ? `이 PC에 저장된 대장 응답 ${n}건(30일간 다시 조회 안 함)` : ''; }
  function myKey() { try { return (localStorage.getItem(KEY_LS) || '').trim(); } catch (e) { return ''; } }
  function hookDataGoKr() {
    if (window.__jbsFetchHooked) return; window.__jbsFetchHooked = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!/^https?:\/\/apis\.data\.go\.kr\//.test(url)) return orig(input, init);
      const u = new URL(url); let mk = myKey(); if (mk) { if (/%[0-9A-Fa-f]{2}/.test(mk)) { try { mk = decodeURIComponent(mk); } catch (e) { } } u.searchParams.set('serviceKey', mk); }
      const ck = (() => { const c = new URL(u); c.searchParams.delete('serviceKey'); return c.toString(); })();
      const hit = await Cache.get(ck);
      if (hit && Date.now() - hit.t < TTL) return new Response(hit.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      const res = await orig(u.toString(), init);
      try {
        const body = await res.clone().text(); const j = JSON.parse(body); const h = j && j.response && j.response.header;
        if (h && h.resultCode === '00') Cache.put(ck, { t: Date.now(), body });
      } catch (e) { }
      return res;
    };
    // 공용 키가 없어도 내 키가 있으면 조회 가능하게
    try { const d = Object.getOwnPropertyDescriptor(Ledger, 'enabled'); if (d && d.get && d.configurable) Object.defineProperty(Ledger, 'enabled', { configurable: true, get() { return !!myKey() || d.get.call(Ledger); } }); } catch (e) { }
  }

  // 건축물대장 조회: 구역 필지를 사업성 탭에 넘긴 뒤 기존 Ledger.fill(건축HUB) 실행
  async function ledger() {
    if (typeof Ledger !== 'undefined') hookDataGoKr();
    if (typeof Ledger === 'undefined' || !Ledger.enabled) return msg('rvMsgL', '건축물대장 인증키가 없어 조회할 수 없습니다.', true);
    if (!R.parcels.length) return msg('rvMsgL', '먼저 ① 명부를 올려 주세요.', true);
    const z = zoneData(); if (!z) return;
    if (!z.parcels.some(p => p.pnu)) return msg('rvMsgL', '위의 지적도·토지특성 조회를 먼저 해 주세요(필지 고유번호가 필요).', true);
    const want = new Set(z.parcels.map(p => p.pnu));
    if (!(S.lands || []).some(l => want.has(l.pnu))) toApp();
    msg('rvMsgL', `건축물대장 조회 중… 필지 ${z.parcels.length}개 (필지 수에 따라 몇 분 걸림)`);
    const box = document.getElementById('ledgerMsg');
    const tick = setInterval(() => { if (box && box.textContent) msg('rvMsgL', '건축물대장: ' + box.textContent); }, 1000);
    try {
      await Ledger.fill();
      for (let i = 0; i < 2 && box && /조회 실패/.test(box.textContent); i++) { await sleep(5000); await Ledger.fill(); }   // 실패 필지만 자동 재조회
    } finally { clearInterval(tick); }
    cacheInfo();
    const n = (S.buildings || []).filter(b => b.ledger && want.has(b.pnu));
    runChecks();
    const pend = (R.items || []).filter(it => it.choice == null).length;
    msg('rvMsgL', `건축물대장 조회 끝: 대장 건축물 ${n.length}동 (${new Set(n.map(b => b.pnu)).size}필지). 명부와 대조한 결과는 ⑤에 있습니다` + (pend ? ` (판단 필요 ${pend}건).` : '.'));
  }

  function zoneData(useDrawn) {
    if (!R.parcels.length) { msg('rvMsg6', '먼저 명부를 올리거나 구역을 불러와 주세요.', true); return null; }
    const name = $r('rvName').value || R.name || '정비구역';
    buildItems();
    const ch = (p, k) => choiceOf(`L|${p.key}|${k}`);
    // 빼기를 고르거나 잘라서 편입면적이 0이 된 경계 필지는 조서에서 뺌 (대조표의 판단 기록에는 남음)
    const parcels = R.parcels.filter(p => ch(p, 'miss') !== 'drop' && ch(p, 'noarea') !== 'drop' && ch(p, 'in') !== 'drop' && cutChoice(p) !== 'none' && !(cutField(cutChoice(p)) && !(cutOf(p).inArea > 0))).map(p => {
      const areaC = ch(p, 'area'), jmC = ch(p, 'jimok'), cutC = cutChoice(p), inC = cutC === 'drawn' ? 'drawn' : ch(p, 'in');
      const ledA = areaC === 'roster' ? p.area1 : (p.ledgerArea ?? p.area1);
      const full = p.areaIn == null || (p.area1 != null && Math.abs(p.areaIn - p.area1) < 0.05);   // 명부상 전체편입이면 편입면적 = 고른 공부면적
      let area = full ? (ledA ?? p.area ?? 0) : (p.area ?? 0);
      if (cutField(cutC)) area = cutOf(p).inArea;
      if (p.drawnIn != null && (useDrawn || inC === 'drawn')) area = Math.round(p.drawnIn * 10) / 10;
      const dA = p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05;
      return {
        key: p.key, jibun: p.jibun, pnu: p.pnu, dong: p.dong, jimok: jmC === 'roster' ? p.jimok : (p.ledgerJimok || p.jimok), rosterJimok: p.jimok,
        ledgerArea: ledA, rosterArea: p.area1, area, zoning: p.zoning || '', landUse: p.landUse || '', facility: p.facility || '', jiga: p.jiga || 0, baseYear: p.baseYear,
        ownerType: p.ownerType, owners: p.rows.map(r => ({ name: r.name })), rosterB: p.rosterB, rosterNos: [...new Set(p.rows.map(r => r.ownerBase).filter(Boolean))],
        note: [dA ? (areaC === 'roster' ? `토지대장 ${p.ledgerArea}㎡(명부 면적 사용)` : `명부 공부면적 ${p.area1}㎡`) : '', jmC === 'roster' ? `토지대장 지목 ${p.ledgerJimok}(명부 지목 사용)` : '',
          cutC === 'manual' ? `직접 잘라 일부 편입(전체 ${ledA}㎡)${isRoadP(p) ? '' : ' — 분할 측량 필요'}` : cutField(cutC) ? `경계 도로 ${CUT_MODES.find(m => m[0] === cutC)[2]} 편입(전체 ${ledA}㎡)` : cutC === 'roster' ? '경계 필지 전체 편입(명부대로)' :
          inC === 'drawn' ? `신청 도면 구역선대로 일부 편입(전체 ${ledA}㎡)${isRoadP(p) ? '' : ' — 분할 측량 필요'}` : ch(p, 'in') === 'roster' ? `신청 도면 구역선 밖 ${Math.round(p.outArea)}㎡ 포함(필지 전체 편입)` : '', ch(p, 'miss') === 'keep' ? '지적도 미확인' : '',
          p.hroad && ch(p, 'hroad') === 'note' ? `현황 도로(${p.hroad.names}) 통과 — 구역 안 기반시설 검토` : ''].filter(Boolean).join(' / '),
      };
    });
    (R.extra || []).forEach(e => {
      if (choiceOf(`X|${e.jibun}`) !== 'add') return;
      const j = String(e.jibun).replace(/[^\d-]/g, ''), jm = (String(e.jibun).match(/[가-힣]+$/) || [''])[0];
      parcels.push({ key: 'X|' + e.jibun, jibun: j, dong: $r('rvDong').value || (parcels[0] || {}).dong || '', jimok: jm, area: Math.round(e.inArea * 10) / 10,
        ledgerArea: Math.round(e.area * 10) / 10, zoning: '', jiga: 0, ownerType: '사유지', owners: [], rosterB: [], note: '명부 누락(신청 도면 구역선 안) — 소유자 확인 필요' });
    });
    const buildings = zoneBuildings(parcels);
    const decisions = (R.items || []).map(it => ({ kind: it.kind, loc: it.loc, label: it.label, roster: String(it.roster ?? ''), ledger: String(it.ledger ?? ''),
      choice: ((it.opts.find(o => o[0] === it.choice) || [])[1]) || '(미판단)', manual: it.manual }));
    return { name, location: `${$r('rvSigungu').value} ${parcels[0]?.dong || ''} 일원`, baseYear: R.parcels.find(p => p.baseYear)?.baseYear || '',
      parcels, buildings, units: zoneUnits(parcels), road: roadInfo(), decisions, ledgerQueried: ledgerQueried().size > 0,
      ledgerDone: [...(S.lands || []).filter(l => l.ledgerEmpty).map(l => l.jibun), ...(S.buildings || []).filter(b => b.ledger).map(b => b.jibun)],
      ...zoneReq(parcels, buildings.map(b => b.calc)),
      // 명부(제9호)도 조서에 남은 필지의 권리만 (구역 밖으로 빠진 필지만 가진 소유자는 빠짐)
      owners: (() => { const keep = new Set(parcels.map(p => p.key)); let no = 0;
        return R.owners.map(o => ({ o, ps: o.parcels.filter(q => keep.has((q.dong ? q.dong + ' ' : '') + q.jibun)) })).filter(x => x.ps.length)
          .map(({ o, ps }) => ({ no: ++no, name: o.name, birth: o.birth, addr: o.addr, phone: o.phone, head: o.head, consent: o.consent, isPublic: o.isPublic, parcels: ps })); })() };
  }

  function feasParams() {
    const units = $r('rvUnits').value.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [type, supply, excl, member, general, genPy] = s.split(':'); return { type, supply: +supply, excl: +excl, member: +member || 0, general: +general || 0, genPy: +genPy || 0 };
    });
    return { multiplier: +$r('rvMult').value || 1.4, consent: (+$r('rvConsent').value || 80) / 100, gfaM2: +$r('rvGfa').value || null, far: +$r('rvFar').value || 250,
      constPerPy: +$r('rvConst').value || 7000000, preset: $r('rvPreset').value || undefined, units, retail: { areaM2: +$r('rvRetail').value || 0 } };
  }

  function exportReview() {
    if (!R.parcels.length) return;
    const head = ['지번', '법정동', '명부 지목', '대장 지목', '명부 공부면적', '명부 편입면적', '토지대장 면적', '연속지적 면적', '도면 구역선 안(연속지적)', '도면 편입(대장 환산)', '도면 밖', '용도지역', '공시지가', '소유구분', '명부 행수'];
    const rows = [...R.parcels].sort((a, b) => jk(a.jibun) - jk(b.jibun)).map(p => [p.jibun, p.dong, p.jimok, p.ledgerJimok || '', p.area1, p.area, p.ledgerArea ?? '', p.cadArea ? Math.round(p.cadArea * 10) / 10 : '', p.inDrawn != null ? Math.round(p.inDrawn * 10) / 10 : '', p.drawnIn != null ? Math.round(p.drawnIn * 10) / 10 : '', p.outArea ? Math.round(p.outArea * 10) / 10 : '', p.zoning || '', p.jiga || '', p.ownerType, p.rows.length]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['검토 결과'], ...R.checks.map(c => [c])]), '검사결과');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), '필지대조');
    if (R.extra && R.extra.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['지번', '필지면적', '구역선 안 면적'], ...R.extra.map(e => [e.jibun, Math.round(e.area * 10) / 10, Math.round(e.inArea * 10) / 10])]), '명부누락의심');
    const multi = R.owners.filter(o => o.nos.length > 1);
    if (multi.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['성명', '생년', '소유자 번호', '필지'], ...multi.map(o => [o.name, o.birth, o.nos.join(', '), o.parcels.map(q => q.jibun + (q.ho ? ' ' + q.ho : '')).join(', ')])]), '복수번호(비공개)');
    XLSX.writeFile(wb, `${$r('rvName').value || '정비구역'}_검토표.xlsx`);
  }

  // 검토 결과를 사업성 탭(S.lands, S.area)으로 보냄
  function toApp() {
    const z = zoneData(); if (!z || !R.zone) { msg('rvMsg6', '공부 조회까지 끝나야 보낼 수 있습니다.', true); return; }
    S.lands = z.parcels.map(p => ({ id: uid(), pnu: p.pnu || '', jibun: p.jibun, jimok: (p.jimok || '').slice(0, 1) === '잡' ? '잡' : (p.jimok || '').replace('도로', '도').slice(0, 2), area: p.area, owner: (p.owners[0] || {}).name || '', ownerType: Forms.isPublic(p.ownerType) ? '국공유지' : '사유지', price: p.jiga || 0 }));
    const c = turf.center(R.zone).geometry.coordinates;
    S.area = { ...S.area, mode: 'drawn', geojson: R.drawn || R.zone, drawnArea: turf.area(R.drawn || R.zone), center: [c[1], c[0]], zoom: 17 };
    S.meta.name = z.name; S.meta.location = z.location; S.meta.locationManual = true;
    S.criteria = critFor();
    const fp = feasParams(); S.plan.far = fp.far; if (fp.gfaM2) S.plan.gfaManual = fp.gfaM2;
    S.plan.infraMode = 'auto';   // 기반시설은 보낸 토지조서의 지목(도로 등)으로
    // 분양 수입표(S.sales)도 채움: 평형별 세대수가 비어 있으면 자동 배분(건축 대지 연면적 × 공급비율)
    const pp = { ...Forms.DEFAULTS, ...fp };
    const gfa = fp.gfaM2 || Forms.netSite(z.parcels, fp.infraM2).net * fp.far / 100 * pp.gfaFactor;
    const AU = Forms.autoUnits(pp, gfa, z);
    S.sales = [];
    AU.units.forEach(u => {
      if (u.member) S.sales.push({ id: uid(), cat: '조합원', name: u.type, units: u.member, area: u.supply, price: Math.round(u.genPy * pp.memberRatio / 1e4) });
      if (u.general) S.sales.push({ id: uid(), cat: '일반', name: u.type, units: u.general, area: u.supply, price: Math.round(u.genPy / 1e4) });
    });
    S.area.importedKey = zoneKey(S.area.geojson);   // 보낸 토지조서가 이 구역 기준 (3단계 자동 불러오기가 덮어쓰지 않게)
    App.update(true); App.persist && App.persist();
    msg('rvMsg6', `사업성 탭으로 보냄: 토지 ${S.lands.length}필지, 구역 ${fmtN(S.area.drawnArea, 0)}㎡, 분양 ${S.sales.reduce((a, r) => a + r.units, 0)}세대${AU.auto ? '(자동 배분)' : ''}. 3조서·요건 → 7민감도 탭에서 확인하세요(건축물은 3탭 "건축물대장 채우기"로).`);
  }

  // 설정 모드 연결: 2구역계 탭에서 그린 구역으로 필지·편입면적을 만들어 서식에 씀
  async function fromArea() {
    const g = S.area && S.area.geojson;
    if (!g) return msg('rvMsg6', '2구역계 탭에서 구역을 먼저 그려 주세요.', true);
    const poly = g.type === 'Feature' ? g : turf.feature(g);
    const bb = turf.bbox(poly); msg('rvMsg6', '구역 안 필지 조회 중…');
    const DX = 0.004, DY = 0.003;
    for (let x = Math.floor(bb[0] / DX); x <= Math.floor(bb[2] / DX); x++) for (let y = Math.floor(bb[1] / DY); y <= Math.floor(bb[3] / DY); y++) {
      const box = `BOX(${(x * DX).toFixed(4)},${(y * DY).toFixed(4)},${((x + 1) * DX).toFixed(4)},${((y + 1) * DY).toFixed(4)})`;
      try { (await VWorld.dataAll('LP_PA_CBND_BUBUN', box, 10)).forEach(f => { R.cadAll[f.properties.pnu] = f; }); } catch (e) { }
      await sleep(300);
    }
    const list = [];
    Object.values(R.cadAll).forEach(f => {
      const b = turf.bbox(f); if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) return;
      let x = null; try { x = turf.intersect(f, poly); } catch (e) { }
      if (!x) return; const ia = turf.area(x), a = turf.area(f); if (ia < 1 || ia / a < 0.01) return;
      const jb = String(f.properties.jibun || ''); const jm = (jb.match(/[가-힣]+$/) || [''])[0];
      const own = (S.lands || []).find(l => l.jibun === jb.replace(/[^\d-]/g, ''));
      list.push({ key: f.properties.pnu, pnu: f.properties.pnu, jibun: jb.replace(/[^\d-]/g, ''), dong: (f.properties.addr || '').split(' ').slice(-2, -1)[0] || '', jimok: jm, area1: null,
        feat: f, cadArea: a, area: Math.round(ia * 10) / 10, jiga: +f.properties.jiga || 0, ownerType: own && own.ownerType === '국공유지' ? '구유지' : '사유지', rows: own ? [{ name: own.owner }] : [], rosterB: [] });
    });
    R.parcels = list; R.owners = []; R.map = { areaIn: 1 }; R.fetched = true; R.choices = {}; R.hasBldgCols = false;
    buildZone();
    msg('rvMsg6', `2구역계 탭 구역에서 필지 ${list.length}개를 만들었습니다(편입면적 = 구역 안 연속지적 면적). 토지대장 면적은 ② 조회로 보완할 수 있습니다.`);
  }

  // 탭 등록 (app.js의 Tabs·App 사용)
  //  app.js의 boot(DOMContentLoaded)가 Tabs 목록으로 단계 버튼을 만들 때 아직 없는 탭이 끼면 멈추므로,
  //  boot가 끝난 뒤에 탭 링크·화면·Tabs 등록을 한꺼번에 함
  function register() {
    install();
    if (typeof Tabs !== 'undefined' && !Tabs.review) Tabs.review = { render() { install(); if (R.leaflet) setTimeout(() => R.leaflet.invalidateSize(), 50); }, refresh() { } };
    if (location.hash === '#review' && typeof App !== 'undefined') { try { App.show('review'); } catch (e) { } }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(register, 0)); else register();

  return { R, Cutter, drawJudge, judgeHtml, snapJudge, install, readFile, fetchAll, buildZone, matchPdf, runChecks, zoneData, feasParams, toApp, ledger, roadAccess, roadInfo, toggleRoadLayer, fromArea, extractRing };
})();
