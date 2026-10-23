# 법원경매 수집기 (전용 PC용)

정비경매 리포트(jbslab.co.kr/auction)에 법원경매 물건을 넣는 프로그램입니다. **평소 안 쓰는 컴퓨터 한 대(미니PC)** 에서만 돌립니다.

## 원칙
- 최대한 천천히: 5시간 돌고 3시간 쉼(01~06, 09~14, 17~22시). 하루 1,000화면을 그 시간에 고르게 펴서 화면마다 1분 안팎 쉬고, 30화면마다 4~10분 쉼. 1,000화면을 채우면 그날은 끝.
- 수도권 16개 법원의 진행 물건만. 처음 한 번 전체, 그 뒤로는 바뀐 물건만 상세를 다시 엽니다.
- **차단·보안문자가 나오면 우회하지 않고 멈춥니다.** (`state/blocked.txt` 가 생기면 다음 날도 쉼 → 확인 후 지우면 재개)
- 개인정보·키 파일(.env)과 수집 기록(state, logs)은 저장소에 올리지 않습니다.

## 설치 (미니PC에서 한 번)
1. Node.js 20 이상, Git 설치
2. 저장소 받기: `git clone https://github.com/deepgreen7857-creator/redev-feasibility C:\jbslab`
3. ```bat
   cd C:\jbslab\court-collector
   npm install
   npm run setup-browser
   copy .env.example .env
   ```
4. `.env` 의 `INGEST_TOKEN` 에 서버에 넣은 것과 같은 토큰을 적습니다(아래 「토큰 만들기」).

## 화면 읽기 완성 (처음 한 번, Claude Code가 함)
`src/site.js` 의 TODO 3곳(`listCourt`, `readDetail`, `backToList`)을 실제 법원경매정보 화면을 보면서 채웁니다.
그다음 시험: `npm run test-run` → 3건만 읽고 서버에 올리지 않고 결과를 보여 줍니다.

## 매일 자동 실행 (돌 때마다 저장소 최신판을 스스로 받음 — start.cmd)
```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
```
멈추려면 `config.json` 의 `"enabled": false` 또는 작업 스케줄러에서 삭제.

- **서버 전송 실패:** 504·끊김이면 30초·1분·2분 뒤 다시 보냅니다. 그래도 안 되면 그 묶음은 들고 있다가 다음 묶음과 함께 보내고 수집은 계속합니다. 묶음 세 개가 연달아 실패하면 그 회차만 멈추고(`stoppedBy: "upload"`), 못 보낸 물건은 다음 회차에 상세를 다시 읽습니다. 토큰 오류(401)는 바로 멈춥니다.
- **두 개 동시 실행 방지:** `state/run.lock` 에 돌고 있는 수집기 번호를 적어 둡니다. 작업을 멈췄는데 node 가 남아 있으면 새로 켠 쪽은 "이미 다른 수집기가 돌고 있어" 로그만 남기고 끝납니다. 새 코드로 바로 바꾸려면 남은 node 를 먼저 끕니다.

## 토큰 만들기 (노트북에서, 서버 쪽)
```bat
cd C:\notedata\auction-server
firebase functions:secrets:set COURT_INGEST_TOKEN
firebase deploy --only functions
```
토큰은 아무 긴 문자열이면 됩니다(예: 비밀번호 생성기로 40자). 같은 값을 미니PC `.env` 에 넣습니다.
