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

## 검토서 도구 (/traffic, /env, /arch, /landscape) — 2026-11-01 추가
- 교통성·환경성·경관 검토서 초안을 Claude 없이 브라우저에서 만드는 독립 도구. 정비구역 외(지구단위계획·도시계획시설·건축물)에도 씀
- 공통: `shared/site-store.js`(구역 저장 'jbs.sites.v1', /urban 안 가져오기) · `shared/review-ui.js`(지도·입력·검토서·워드/인쇄) · `shared/review.css`
- 기준표: `shared/criteria/{traffic,environment,landscape}.json` — 법령 숫자는 여기만. `상태`에 '확인필요'가 있으면 문서에 '※ 기준 확인 필요'가 자동으로 붙음. 숫자를 추정해 넣지 말 것(채팅 Claude가 조문 대조 후 채움)
- 문장 틀: `shared/templates/*_ko.json`
- 도구별: `<도구>/<도구>-calc.js`(순수 계산, `node <도구>/test-calc.js`로 테스트) + `<도구>/<도구>.js`(입력 칸·문서)
- 각 검토서는 배치 조건을 `site.constraints.<도구>`에 저장 → 개략 배치(/arch)와 경관 검토가 이어받음. 흐름: 구역계 → 교통·환경 1차 → 배치 조건 → /arch → 교통 2차·경관
- 수정 후: `node --check` + `node traffic/test-calc.js && node env/test-calc.js && node landscape/test-calc.js`
- /arch 개략 건축계획: `shared/arch-geom.js`(배치 엔진·태양 위치·그림자·일조시간, `node arch/test-geom.js`) + `shared/mass3d.js`(three.js r128 3D, /landscape도 씀) + `arch/arch-draw.js`(배치도·표준평면 SVG) + `arch/arch.js`. 기준표 `shared/criteria/arch.json`(인동간격 0.8은 검토 가정값 — 인천 건축조례 확인 필요)
  - 경계 변마다 성격(대지경계·도로·간선도로·정북 인접대지·저층 주거 인접)을 지정 → 변별 이격, 정북 일조 층수 상한, 인동간격, 남저북고로 3개 대안(다동형·중간형·소동형) 생성, 주동 방향 자동
  - [이 안으로 확정] → site.arch.chosen 저장, site.v(세대수·층수·전용면적 합계)를 갱신해 교통·환경·경관 검토에 이어짐
- /landscape 높이·경관계획: 정비구역 지정 단계 수준(높이·스카이라인·통경축·조망). /arch 확정안으로 입면·통경축 개방률·조망점 3D 그림 자동. 경관심의 수준 확장은 이 도구에서
