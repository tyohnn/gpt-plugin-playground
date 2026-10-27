# gpt-plugin-playground

ChatGPT 의 앱 호스트를 흉내 내서, MCP 플러그인을 실물 ChatGPT 없이 끝까지 돌려 보는 놀이터입니다.
사람이 눈으로 보는 창과 Playwright 고정 장치가 같은 호스트를 씁니다.

```
npx gpt-plugin-playground --server http://127.0.0.1:4200/api/mcp --plugin ./plugin --file ./fixtures/신청서.hwpx
```

창은 `http://127.0.0.1:4300` 에, 화면(위젯)은 `http://127.0.0.1:4301` 에 뜹니다. 서버가 OAuth 로 지켜져 있으면 창이
「연결하기」를 보이고, 누르면 발견 사슬(401 의 `resource_metadata` → RFC 9728 → RFC 8414 → 동적 등록 → PKCE)을 밟습니다.

## 무엇을 흉내 내나

| 자리 | 흉내 내는 것 |
|---|---|
| 대화 | 컴포저 · 도구 호출 · 대화 안의 화면(inline, 전체 화면) · 되묻는 폼(`input_required`) |
| 사이드바 | `global` 진입점의 앱과 그 바로 가기(`quickAction`), 플러그인 화면(설정 · 스킬 · 온보딩), 채팅 목록 |
| 옆 패널 | `thread` · `file` 진입점으로 연 화면의 탭 |
| 파일 | 호스트가 쥔 사람의 파일. 글과 바이트(`representation: "blob"`)로 읽고, `ifMatch` 로 쓰고, 밖에서 바뀌면 구독한 화면에 알립니다 |
| 격리 | 화면은 창과 다른 origin 에서 뜨고, 자원의 `_meta.ui.csp` 로 지은 CSP 머리를 받습니다 |
| 플랫폼 | 데스크톱 · 웹 · 모바일. 파일 진입점과 멘션과 파일 능력은 데스크톱에만 섭니다 |
| 새 판(2026-07-28) | 요청마다 `_meta` 에 판과 능력을 싣고, 화면 자원의 답에 `ttlMs` · `cacheScope` 가 없으면 화면을 띄우지 않습니다 |

규칙마다 근거가 붙어 있습니다(`packages/core/src/rules.ts`). 근거는 셋입니다.

- **스펙**: MCP Apps 와 openai/mcp-extensions 의 문서에 적힌 것
- **녹취**: 실물 ChatGPT 에서 받아 본 것
- **추측**: 아직 확인하지 못한 것. 개발 도구의 「규칙」 칸에 그 수가 보입니다

초록이 실물의 초록은 아닙니다. 「추측」 줄은 실물의 녹취로 바꿀 때까지 흉내일 뿐입니다.

## e2e 에서 쓰기

```ts
import { expect, test } from "gpt-plugin-playground/playwright";

test.use({ playground: { server: "http://127.0.0.1:4200/api/mcp", token: process.env.MCP_TOKEN, files: ["e2e/신청서.hwpx"] } });

test("모델이 칸을 채운다", async ({ host }) =>
{
    await host.openFile("host-resource://file-1");
    host.script([{ when: /채워/, then: (turn) => [{ kind: "call", tool: "fill_form", arguments: { /* … */ } }] }]);
    await host.say("이름에 홍길동을 채워 줘");

    await expect(host.widget("서식 열기").getByRole("textbox", { name: "이름" })).toHaveValue("홍길동");
    expect(await host.sent("openai/resources/write")).toHaveLength(0);
});
```

- 모델 자리에는 시나리오가 적은 대본이 앉습니다. 대본은 Node 쪽에서 돌고, 모델에게 보이는 도구만 부를 수 있습니다.
- `host.sent(method)` 는 화면이 호스트에게 보낸 말의 params 를, `host.log()` 는 오간 말 전부를 줍니다.
- `host.addFile` · `host.touchFile` · `host.fileBytes` 로 호스트의 파일을 다룹니다.
- 대본을 주지 않으면 규칙 모델이 섭니다. 보낸 글에 도구의 이름이 들어 있으면 그 도구를 부릅니다.

## 저장소

| 자리 | 무엇 |
|---|---|
| `packages/core` | 호스트의 규칙과 근거 표, 파일 창고, 모델 자리. 브라우저 없이 vitest 로 잽니다 |
| `packages/playground` | 두 origin 서버, 로그인 사슬, 명령(`gpt-plugin-playground`), Playwright 고정 장치. npm 에 이 이름으로 나갑니다 |
| `apps/shell` | 사람이 보는 창. tyohnn 의 loam 을 입었습니다 |
| `packages/ui` | tyohnn 에서 받아 둔 컴포넌트와 블록. 손으로 고치지 않고 tyohnn 에서 다시 받습니다 |
| `examples/fixture-plugin` | 의존 없이 도는 본보기 MCP 서버. 놀이터가 제 몸을 잴 때 씁니다 |

## 명령

```
npx -y npm@11.6.2 install
npx turbo typecheck test
npm run build -w @host-playground/shell && npm run build -w gpt-plugin-playground
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e -w gpt-plugin-playground
```

e2e 는 본보기 서버를 4391 에 띄우고 그 위에서 돕니다. 설치된 Chromium 의 판이 Playwright 가 찾는 판과 다르면
`PLAYWRIGHT_CHROMIUM_PATH` 로 실행 파일을 가리킵니다.

## 아직 없는 것

- 실물 모델. 도구 설명과 스킬이 모델을 제대로 이끄는지는 아직 재지 못합니다.
- 실물 녹취 대조. 배포 주소가 생기면 실물에서 녹취를 받아 「추측」 줄을 줄입니다.
- 화면의 `sandbox` 속성은 추측입니다(`frame-sandbox`).
