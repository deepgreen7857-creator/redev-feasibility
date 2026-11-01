# 지시문: /urban 4탭(개략 건축계획) 결과를 교통성 검토서로 넘기기 (/urban 쪽 작업만)

작성: 채팅 Claude (2026-11-01) / 대상: 노트북 Claude Code

## 받는 쪽은 이미 되어 있음
- `shared/site-store.js` 에 `JbsSite.applyUrbanPlan(key, plan)` 이 있음. /urban 안(key='A' 등)의 계획값을 공통 구역에 넣음.
- 그 뒤 `../traffic/?urban=A&make=1` 로 열면 자동 채우기(도로 규모·위계, 위치, 역·정류장) 후 교통성 검토서를 바로 만듦. `../env/`, `../landscape/` 도 같음.
- 계획 폭(pw)이 현황 폭보다 크면 진입도로 판정은 계획 폭으로 하고, 검토서 표에 현황/계획 폭을 함께 적음.

## plan 객체 형식
```js
JbsSite.applyUrbanPlan(S.region, {
  units: pl.units,                                   // 총 세대수(임대 포함)
  byType: { 59: n59, 84: n84, 114: n114 },           // 평형별 세대수 — 임대 포함 합계로(지금 pl.n59 등은 분양만이므로 임대분을 평형별로 더할 것)
  far: pl.farUse, bcr: P.bcr, floors: pl.floorsTower, towers: pl.towers,
  gfa: pl.gfa,                                       // 지상 연면적(아파트)
  retailGFA: (근생 연면적이 있으면, 없으면 생략),
  roads: z.roads.edge.map(r => ({                    // 경계 도로
    pnu: r.pnu, jibun: r.jibun, w: r.w,              // 현황 폭(필지 모양 추정)
    pw: (inf.entry.per[r.pnu] || {}).pw || r.w,      // 정비계획에서 정한 계획 폭(현황 유지면 r.w)
    role: '진입도로' | '두 번째 진입도로' | '주변 도로',  // entrySection의 role()과 같은 판단
    dec: r.dec || '',                                // 도시계획도로 결정 등급
    partial: partialOf(r),                           // 짧게 닿은 도로(부분 확폭 걸러내기 결과)
  })),
});
```

## /urban에서 할 일
1. `urban/index.html` 에 `<script src="../shared/site-store.js?v=4"></script>` 추가(urban.js 앞).
2. 4탭(개략 건축계획) 패널 맨 아래에 버튼 세 개:
   - `교통성 검토서로 →` / `환경성 검토서로 →` / `높이·경관계획으로 →`
   - 누르면 위 `applyUrbanPlan(S.region, …)` 실행 후 `location.href = '../traffic/?urban=' + S.region + '&make=1'` (env, landscape도 같은 식)
   - 지도 모드가 아니거나(예시 구역), 구역계·주변 도로가 아직 없으면 버튼을 막고 "구역계와 주변 도로를 먼저 불러오세요" 안내
3. 버튼 옆 안내 한 줄: "지금 정비계획·개략 건축계획 값(세대수·평형·용적률·층수·도로 계획 폭)이 검토서로 넘어갑니다. 동 배치·일조·3D까지 보려면 /arch(자세한 배치)에서 확정하세요."
4. 3탭 정비계획에서 도로 계획 폭을 바꾼 뒤 다시 넘기면 최신 값으로 덮어써짐(같은 구역 id 사용) — 확인.
5. `urban.js?v=` 번호 올리기, 콘솔 오류 확인. 숭의2구역 A안으로: 버튼 → 교통성 검토서가 바로 열리고 "계획값 출처: /urban 개략 건축계획 A안"이 보이는지, 492-34가 "현황 유지 · 구역에 짧게 닿음"인지.
6. CLAUDE.md /urban 항목에 한 줄: "4탭 결과는 JbsSite.applyUrbanPlan으로 검토서 도구에 넘김(?urban=키&make=1)".

## 커밋
```
git add urban CLAUDE.md docs/지시문_urban_개략건축계획에서_교통성검토로.md
git commit -m "urban: 개략 건축계획 결과를 교통성·환경성·높이경관 검토서로 바로 넘기기"
git pull --no-rebase --no-edit
git push
```
