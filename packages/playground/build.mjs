import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/** 서버 · 명령 · Playwright 고정 장치를 묶고, 창의 빌드를 `dist/shell` 에 싣는다 */
const here = dirname(fileURLToPath(import.meta.url));
const shell = join(here, "../../apps/shell/dist");

rmSync(join(here, "dist"), { recursive: true, force: true });

await build({
    entryPoints: { server: "src/server.ts", cli: "src/cli.ts", playwright: "src/playwright.ts" },
    outdir: "dist",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["@playwright/test"],
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "warning",
});

// CommonJS 로 도는 Playwright 설정(`type` 이 없는 패키지)도 고정 장치를 require 한다. 같은 것을 .cjs 로도 낸다
await build({
    entryPoints: { server: "src/server.ts", playwright: "src/playwright.ts" },
    outdir: "dist",
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["@playwright/test"],
    define: { "import.meta.url": "__importMetaUrl" },
    banner: { js: "const __importMetaUrl = require(\"node:url\").pathToFileURL(__filename).href;" },
    logLevel: "warning",
});

if (!existsSync(shell))
{
    throw new Error("창을 먼저 굽는다: npm run build -w @host-playground/shell");
}

cpSync(shell, join(here, "dist/shell"), { recursive: true });
