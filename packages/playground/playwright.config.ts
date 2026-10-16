import { defineConfig } from "@playwright/test";

/**
 * 플레이그라운드가 제 몸을 잰다. 본보기 플러그인(`examples/fixture-plugin`)을 띄우고 그 위에서 돈다.
 *
 * ⚠ 브라우저는 설치된 Chromium 을 쓴다. 판이 다르면 `PLAYWRIGHT_CHROMIUM_PATH` 로 실행 파일을 가리킨다.
 */
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 4391);

export default defineConfig({
    testDir: "e2e",
    timeout: 30_000,
    fullyParallel: true,
    reporter: process.env.CI === undefined ? "list" : "github",
    use: {
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH === undefined ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
        trace: "retain-on-failure",
    },
    webServer: {
        command: "node ../../examples/fixture-plugin/server.mjs",
        port: FIXTURE_PORT,
        env: { FIXTURE_PORT: String(FIXTURE_PORT) },
        reuseExistingServer: false,
    },
});
