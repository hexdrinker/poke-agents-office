# poke-agents-office

Claude Code가 터미널에서 뭘 하고 있는지, 파이어레드 **실프주식회사**에서 일하는 1세대 포켓몬으로 보여주는 로컬 대시보드.
설치할 것 없이 Claude Code가 남기는 세션 기록(`~/.claude`)을 0.25초마다 읽는다.

## 실행

```sh
node server.js   # http://127.0.0.1:7777  (PORT, CLAUDE_DIR 로 변경 가능)
./demo.sh        # Claude Code 없이 가짜 세션 2개로 미리보기 → http://127.0.0.1:7778
./demo.sh team   # 서브에이전트 4마리가 동시에 일하는 장면 (OPEN=1 이면 브라우저도 띄움)
```

## 사무실

방마다 맡은 일이 있다.

| 방 | 하는 일 | 연출 |
|---|---|---|
| 자료실 | Read / Grep / Glob | 상자 더미 앞 |
| 개발실 | Edit / Write | 노트북 화면에 코드가 흐름 |
| 서버실 | Bash | 실행 중엔 랙 불빛이 빨라짐 |
| 정보검색실 | WebSearch / WebFetch / MCP | 모니터 스캔라인, 파형 |
| 회의실 | TodoWrite / Task* / 플랜 모드 | 보고서 책상 |
| 내 자리 | 질문(AskUserQuestion), 응답 끝 | `!` + PAR, 끝나면 SLP |

- 생각 중엔 Claude가 쓴 글 요약이 구름 말풍선으로, 도구가 실패하면 식은땀 + 빨간 말풍선.
- 서브에이전트: 자리에서 전화 → 엘리베이터로 출근 → 일하고 → 부른 포켓몬 옆에서 보고 → "퇴근합니다!"
- 프로젝트마다 층이 하나. 층마다 실프주식회사의 실제 다른 층 지도를 쓰고, 방은 그 층의 설비(서버 장비·컴퓨터·설계도·전화)를 찾아 자동 배치한다.
  왼쪽 층별 안내에서 일하는 층엔 초록불, 누르면 `▲ 3F` 엘리베이터로 이동.
  `/clear` 해도 같은 프로세스면 같은 포켓몬이 같은 층에서 이어서 일한다.

## 트레이너

파이어레드 주인공(레드)이 나다. 방향키/WASD로 걷고 Shift로 달리고, Z(Space/Enter)로 앞의 포켓몬에게 말을 걸면 지금 하는 일을 알려준다.
Claude Code에 메시지를 보내면 트레이너가 그 세션의 포켓몬에게 걸어가 말을 건다 (다른 층이면 엘리베이터를 타고 간다).

## 진화

레벨 = Lv5 + 도구 호출 수. 원작 진화 레벨에 도달하면 진화 연출과 함께 진화한다
(이상해씨·파이리·꼬부기 16, 구구 18, …). 돌·통신교환 진화(피카츄→라이츄, 고우스트→팬텀 등)는 임의 레벨을 쓴다.

## 메모

- Node 18+, 의존성 없음. 서버는 `127.0.0.1`에만 바인딩. 세션 기록은 브라우저로만 나가고 외부로 보내지 않는다.
- 에셋은 레포에 포함하지 않고 런타임 로드:
  - 맵·대사창·메뉴·아이콘: [pret/pokefirered](https://github.com/pret/pokefirered) 디컴프 데이터를 브라우저에서 직접 디코딩
  - 맵 스프라이트(걷기/대기/잠): [PMDCollab/SpriteCollab](https://github.com/PMDCollab/SpriteCollab) (CC BY-NC 4.0, 각 작가)
  - 폰트: [Galmuri](https://github.com/quiple/galmuri) (OFL)
- Pokémon 관련 저작권은 Nintendo / Game Freak / The Pokémon Company에 있음. 비공식·비상업 팬 프로젝트.
