# 정비경매 리포트 화면 (React + Vite + Tailwind) — 원본 소스

배포 위치: https://www.jbslab.co.kr/auction/ (저장소의 `../auction/` 폴더가 빌드 결과)
수집 서버: `../auction-server/` · 법원경매 수집기: `../court-collector/`

## 고친 뒤 올리는 법 (Windows)
```bat
cd C:\notedata\auction-web
npm install
npm test
npm run deploy-local
cd ..
git add auction auction-web
git commit -m "정비경매 리포트 화면 수정"
git push
```
- `.env.production` 은 Firebase **웹** 설정(공개되어도 되는 값)만 들어 있습니다. 비밀키는 없습니다.
- 데모(샘플 데이터 한 파일): `npm run build:demo` → `dist-demo/index.html`

## 구조
- `src/lib/analyze.js` 판정·매력도·돈 계산 · `src/lib/tax.js` 법인 단타 세금 · `src/lib/redevZones.js` 정비사업 현황 엑셀 해석
- `src/pages/` 물건 찾기·상세·파산 공고·시세·관리자
