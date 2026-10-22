# 정비경매 리포트 수집 서버 (Firebase 프로젝트: jbslab-auction)

화면은 `../auction/`(jbslab.co.kr/auction), 이 폴더는 매일 새벽 자료를 받아 오는 서버입니다.

## 처음 한 번 (Windows 명령 프롬프트, 이 폴더에서)

```bat
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase functions:secrets:set DATA_GO_KR_KEY
firebase functions:secrets:set VWORLD_KEY
firebase deploy --only functions,firestore:rules
```
- `secrets:set` 뒤에 키를 붙여 넣고 Enter (공공데이터포털: 일반 인증키 Decoding / 브이월드: 「정비경매 리포트」 키)
- 끝나면 https://www.jbslab.co.kr/auction/#/admin → Google 로그인 → 기본 설정 넣기 → API 연결 시험

## 고친 뒤 다시 올리기
```bat
firebase deploy --only functions
```
