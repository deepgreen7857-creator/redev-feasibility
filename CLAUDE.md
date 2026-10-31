# jbslab.co.kr — 정비사업 사업성 검토

저장소: https://github.com/deepgreen7857-creator/redev-feasibility (GitHub Pages, `main`에 push하면 배포)

## 사이트 구조
- `index.html` + `css/style.css` + `js/`
  - `config.js` 인증키(브이월드·공공데이터) · `util.js` · `state.js` · `calc.js` · `map.js` · `ledger.js`(건축물대장) · `pdfsave.js` · `overlay.js` · `export.js` · `roadcut.js` · `assume.js` · `app.js` · `forms.js`(법정서식·사업성 검토표 엑셀) · `review.js`(8 검토 모드)
- 1~7단계 사업성 탭 + 8 검토 모드
- 1단계는 계획 조건만. 면적(구역 → 기반시설 공제 → 건축 대지 → 연면적)은 2단계 면적 요약에서 다룸
- 검토 모드: 명부(별지 제9호) → 공부 조회(브이월드 토지특성·연속지적, 건축물대장) → 명부 ↔ 공부 불일치 판단(기본 공부 우선) → 검토 완료 → 별지 제4호 토지·건축물 조서 엑셀
  - 서식 근거: 「인천광역시 도시 및 주거환경정비 조례 시행규칙」 별지 제4·5·6·9호

## 구역계 만들기 공통 코드 (js/zonekit.js)
- 브이월드(VWorld)·jsonp·필지 합치기(safeUnion)·splitJibun과 구역계 계산(ZoneKit: 지번 목록 → 필지, 그린 범위 → 필지 맞추기, 위치 지번+면적 추정, 도로 잇기·갇힌 필지, 필지 넣고 빼기, 지적 경계 맞음 확인, 대조표)은 `js/zonekit.js`에 있음
- 본 화면(`js/map.js`)과 정비계획 검토(`urban/urban.js`)가 같이 씀 → **구역계 그리는 방법을 고칠 때는 zonekit.js에서 고칠 것**(화면 코드에만 넣으면 한쪽에만 반영됨)
- 새 구역계 기능을 본 화면에 붙이면 `/urban`의 '지번 목록·필지 경계로 구역계 만들기' 패널에도 같은 버튼을 붙일 것
- zonekit.js를 고치면 `index.html`과 `urban/index.html`의 `?v=` 번호를 둘 다 올릴 것

## /urban (정비구역 지정·정비계획 검토)
- 목적: ① 정비구역을 새로 지정하려 할 때 구역계·요건·계획을 잡아 보기 ② 제출된 정비구역(토지조서·구역계)의 적정성 검토. 검토 기능은 '자동으로 고쳐 주기'보다 '문제를 찾아 보여 주기'가 먼저(예: 제출 조서 폐합 검토는 갇힌 필지·도로를 자동으로 채우지 않음)
- 구역계·조서 검토 기능은 사업성 검토(본 화면)에도 똑같이 붙일 것
- `urban/index.html` + `urban/urban.js` + `urban/rules/incheon.json`(인천 조례 기준값, 원문 대조본)
- 지도에서 안(A~E)별 구역계 → 연속지적·GIS건물·토지특성·건축물대장 자동 조회 → 요건판정·정비계획·개략 배치·사업성

## 수정 후 확인 순서
1. `node --check js/<수정한 파일>.js`
2. `index.html`의 `?v=` 번호 올리기 (모든 스크립트·CSS 같은 번호)
3. 1~8탭을 차례로 열어 콘솔 오류가 없는지 확인
4. 그다음 push

## 주의
- `_비공개/` 폴더(명부 등 개인정보)는 절대 커밋 금지 (`.gitignore`에 있음)
- 브이월드 키는 `www.jbslab.co.kr` 도메인 전용. 로컬에서 시험할 때는 콘솔에서 `VWorld.domain`을 `'www.jbslab.co.kr'`로 바꿔야 지적도·토지특성이 조회됨
