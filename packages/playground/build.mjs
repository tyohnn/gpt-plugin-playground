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

if (!existsSync(shell))
{
    throw new Error("창을 먼저 굽는다: npm run build -w @host-playground/shell");
}

cpSync(shell, join(here, "dist/shell"), { recursive: true });
