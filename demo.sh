#!/bin/sh
# Fakes Claude Code sessions (in a temp ~/.claude) and serves them on :7778. No Claude Code needed.
#   ./demo.sh        two sessions on two floors, one subagent
#   ./demo.sh team   one session sends out four subagents at once
SCENE=${1:-basic}
D=$(mktemp -d)
PORT=${PORT:-7778}
mkdir -p "$D/sessions" "$D/projects/web/sess-a/subagents" "$D/projects/api"
sleep 600 & A=$!   # stand-in processes, so the sessions look alive
sleep 600 & B=$!
CLAUDE_DIR="$D" PORT=$PORT node "$(dirname "$0")/server.js" & S=$!
trap 'kill $A $B $S 2>/dev/null; rm -rf "$D"' EXIT INT TERM
echo "open http://127.0.0.1:$PORT"
[ -n "$OPEN" ] && sleep 1 && open "http://127.0.0.1:$PORT"
sleep "${WAIT:-3}"

WEB="$D/projects/web/sess-a.jsonl" API="$D/projects/api/sess-b.jsonl" SUBS="$D/projects/web/sess-a/subagents"
rec() { # rec <file> <type> <message-json> [sleep]
  printf '{"type":"%s","timestamp":"%s","cwd":"/demo/web-app","message":%s}\n' "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$3" >> "$1"
  sleep "${4:-1.5}"
}
prompt() { rec "$1" user "{\"content\":\"$2\"}" "$3"; }
think()  { rec "$1" assistant "{\"content\":[{\"type\":\"text\",\"text\":\"$2\"}]}" "$3"; }
use()    { rec "$1" assistant "{\"content\":[{\"type\":\"tool_use\",\"id\":\"$2\",\"name\":\"$3\",\"input\":$4}],\"stop_reason\":\"tool_use\"}" "$5"; }
done_()  { rec "$1" user "{\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"$2\",\"is_error\":${3:-false}}]}" "$4"; }
stop()   { rec "$1" assistant "{\"content\":[{\"type\":\"text\",\"text\":\"$2\"}],\"stop_reason\":\"end_turn\"}" "$3"; }
call()   { # call <tool-use-id> <agent-type> <description>: the parent calls a subagent; returns its transcript path
  use "$WEB" "$1" Agent "{\"subagent_type\":\"$2\",\"description\":\"$3\"}" 0.8
  echo "{\"agentType\":\"$2\",\"toolUseId\":\"$1\"}" > "$SUBS/agent-$1.meta.json"
}
session() { echo "{\"pid\":$1,\"sessionId\":\"$2\",\"cwd\":\"$3\"}" > "$D/sessions/$1.json"; }

basic() {
  session $A sess-a /demo/web-app
  session $B sess-b /demo/api-server
  sleep 2
  prompt "$WEB" '로그인하면 가끔 튕기는 버그 고쳐줘'
  think  "$WEB" '먼저 로그인 흐름부터 살펴볼게요.'
  use    "$API" b1 Bash '{"command":"npm test"}' 0.5
  use    "$WEB" t1 Grep '{"pattern":"handleLogin"}'
  done_  "$WEB" t1
  call   ag1 Explore '세션 만료 처리 조사'; sleep 1.7
  X="$SUBS/agent-ag1.jsonl"
  use    "$X" s1 Read '{"file_path":"/demo/web-app/src/auth/session.ts"}' 2
  done_  "$X" s1 false 0.5
  done_  "$API" b1 true
  use    "$X" s2 WebSearch '{"query":"refresh token race condition"}' 2.5
  done_  "$X" s2 false 0.5
  stop   "$X" '토큰 갱신이 동시에 두 번 일어나는 게 원인입니다.' 6
  done_  "$WEB" ag1
  use    "$WEB" t2 TodoWrite '{"todos":[{"content":"토큰 갱신에 락 걸기","status":"in_progress"}]}' 2.5
  done_  "$WEB" t2 false 0.5
  use    "$WEB" t3 Edit '{"file_path":"/demo/web-app/src/auth/session.ts"}' 3
  done_  "$WEB" t3
  use    "$WEB" t4 Bash '{"command":"npm test -- auth"}' 3
  done_  "$WEB" t4
  use    "$WEB" t5 AskUserQuestion '{"questions":[{"question":"PR까지 올릴까요?"}]}' 5
  done_  "$WEB" t5
  stop   "$WEB" '고쳤어요! 토큰 갱신을 한 번만 하도록 막았습니다.' 4
  rm "$D/sessions/$B.json"
}

# Each subagent works in its own background loop, so they run side by side.
explorer() { X="$SUBS/agent-ag1.jsonl"; sleep 2
  use "$X" e1 Glob '{"pattern":"src/payment/**/*.ts"}' 2;    done_ "$X" e1 false 0.5
  use "$X" e2 Read '{"file_path":"/demo/web-app/src/payment/checkout.ts"}' 3; done_ "$X" e2 false 0.5
  use "$X" e3 Grep '{"pattern":"chargeCard"}' 2.5;           done_ "$X" e3 false 0.5
  stop "$X" '결제 흐름은 checkout → charge → receipt 세 단계예요.' 1; }
planner() { X="$SUBS/agent-ag2.jsonl"; sleep 2
  use "$X" p1 Read '{"file_path":"/demo/web-app/docs/payment.md"}' 3; done_ "$X" p1 false 0.5
  use "$X" p2 WebSearch '{"query":"stripe idempotency key best practice"}' 4; done_ "$X" p2 false 0.5
  use "$X" p3 TodoWrite '{"todos":[{"content":"결제 서비스 계층 분리","status":"in_progress"}]}' 4; done_ "$X" p3 false 0.5
  stop "$X" '3단계 리팩터링 계획을 세웠어요.' 1; }
tester() { X="$SUBS/agent-ag3.jsonl"; sleep 2
  use "$X" g1 Read '{"file_path":"/demo/web-app/test/payment.test.ts"}' 2.5; done_ "$X" g1 false 0.5
  use "$X" g2 Edit '{"file_path":"/demo/web-app/test/payment.test.ts"}' 3; done_ "$X" g2 false 0.5
  use "$X" g3 Bash '{"command":"npm test -- payment"}' 3;   done_ "$X" g3 true 2
  use "$X" g4 Edit '{"file_path":"/demo/web-app/test/payment.test.ts"}' 3; done_ "$X" g4 false 0.5
  use "$X" g5 Bash '{"command":"npm test -- payment"}' 3;   done_ "$X" g5 false 0.5
  stop "$X" '테스트 12개 추가, 모두 통과해요.' 1; }
reviewer() { X="$SUBS/agent-ag4.jsonl"; sleep 2
  use "$X" r1 Grep '{"pattern":"apiKey|secret"}' 3;         done_ "$X" r1 false 0.5
  use "$X" r2 WebFetch '{"url":"https://owasp.org/Top10"}' 4; done_ "$X" r2 false 0.5
  use "$X" r3 Read '{"file_path":"/demo/web-app/src/payment/charge.ts"}' 3; done_ "$X" r3 false 0.5
  stop "$X" '카드 번호가 로그에 남는 곳이 한 군데 있어요.' 1; }

team() {
  session $A sess-a /demo/web-app
  sleep 2
  prompt "$WEB" '결제 모듈 전체 리팩터링해줘' 3
  think  "$WEB" '범위가 넓으니 팀을 나눠서 진행할게요.' 2
  call ag1 Explore '결제 흐름 조사';             explorer & P1=$!
  call ag2 Plan '리팩터링 계획 세우기';           planner & P2=$!
  call ag3 general-purpose '결제 테스트 보강';    tester & P3=$!
  call ag4 code-reviewer '보안 점검';            reviewer & P4=$!
  wait $P1 $P2 $P3 $P4
  sleep 6
  for id in ag1 ag2 ag3 ag4; do done_ "$WEB" $id false 0.3; done
  think  "$WEB" '모두 모였으니 결과를 합쳐서 반영할게요.' 2
  use    "$WEB" t1 Edit '{"file_path":"/demo/web-app/src/payment/charge.ts"}' 3; done_ "$WEB" t1 false 0.5
  use    "$WEB" t2 Bash '{"command":"npm test"}' 3; done_ "$WEB" t2 false 0.5
  stop   "$WEB" '리팩터링 끝! 서브에이전트 4명이 나눠서 처리했어요.' 4
}

$SCENE
sleep "${HOLD:-6}"
