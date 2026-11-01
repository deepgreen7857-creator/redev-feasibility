# 지시문: /urban → /arch → 검토서 한 흐름으로 잇기 (/urban 쪽 작업만)

작성: 채팅 Claude (2026-11-01) / 대상: 노트북 Claude Code

/arch와 검토서 도구 쪽은 이미 되어 있음:
- `/arch/?urban=A` 로 열면 /urban의 A안을 바로 불러옴
- /arch에서 [이 안으로 확정]을 누르면 "다음 단계" 버튼(교통성·환경성·높이경관)이 나오고, 누르면 `/traffic/?site=ID&make=1` 로 가서 자동 채우기 후 검토서를 바로 만듦

## /urban에서 할 일
1. 상단 링크 `<a class="back" href="../arch/">개략 건축계획</a>` 를, 지금 보고 있는 안이 반영되게 바꾼다.
   - 안(S.region)이 바뀔 때마다 href를 `../arch/?urban=${S.region}` 으로 갱신
   - 교통성·환경성·높이경관 링크도 같은 방식으로 `../traffic/?urban=${S.region}` 등(검토서 도구는 ?urban= 을 이미 받음)
2. 4번 탭 '개략 건축계획' 패널 위쪽에 버튼 하나:
   `자세한 배치·일조·3D와 교통성 검토서로 → (/arch)` → `../arch/?urban=${S.region}`
   (/urban의 개략 배치는 개략 규모 확인용으로 두고, 확정·검토서는 /arch에서 하는 흐름)
3. 이동 전에 지금 안의 구역계·주변 도로가 저장(saveZ)돼 있는지 확인. 주변 도로를 아직 안 불러왔으면 불러온 뒤 이동하거나 "주변 도로를 불러오는 중" 안내.
4. `urban/index.html` 의 `urban.js?v=` 번호 올리기, 콘솔 오류 확인.

## 커밋
```
git add urban docs/지시문_urban에서_arch로_바로가기.md
git commit -m "urban: 지금 안으로 /arch·검토서 바로가기"
git pull --no-rebase --no-edit
git push
```
