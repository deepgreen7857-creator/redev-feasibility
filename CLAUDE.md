# jbslab.co.kr — 정비사업 사업성 검토

저장소: https://github.com/deepgreen7857-creator/redev-feasibility (GitHub Pages, `main`에 push하면 배포)

## 사이트 구조
- `index.html` + `css/style.css` + `js/`
  - `config.js` 인증키(브이월드·공공데이터) · `util.js` · `state.js` · `calc.js` · `map.js` · `ledger.js`(건축물대장) · `pdfsave.js` · `overlay.js` · `export.js` · `roadcut.js` · `assume.js` · `app.js` · `forms.js`(법정서식·사업성 검토표 엑셀) · `review.js`(8 검토 모드)
- 1~7단계 사업성 탭 + 8 검토 모드
- 1단계는 계획 조건만. 면적(구역 → 기반시설 공제 → 건축 대지 → 연면적)은 2단계 면적 요약에서 다룸
- 검토 모드: 명부(별지 제9호) → 공부 조회(브이월드 토지특성·연속지적, 건축물대장) → 명부 ↔ 공부 불일치 판단(기본 공부 우선) → 검토 완료 → 별지 제4호 토지·건축물 조서 엑셀
  - 서식 근거: 「인천광역시 도시 및 주거환경정비 조례 시행규칙」 별지 제4·5·6·9호

## 수정 후 확인 순서
1. `node --check js/<수정한 파일>.js`
2. `index.html`의 `?v=` 번호 올리기 (모든 스크립트·CSS 같은 번호)
3. 1~8탭을 차례로 열어 콘솔 오류가 없는지 확인
4. 그다음 push

## 주의
- `_비공개/` 폴더(명부 등 개인정보)는 절대 커밋 금지 (`.gitignore`에 있음)
- 브이월드 키는 `www.jbslab.co.kr` 도메인 전용. 로컬에서 시험할 때는 콘솔에서 `VWorld.domain`을 `'www.jbslab.co.kr'`로 바꿔야 지적도·토지특성이 조회됨
