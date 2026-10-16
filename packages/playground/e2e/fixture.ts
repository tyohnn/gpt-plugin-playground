import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PlaygroundOptions } from "../src/server";

/** 본보기 플러그인에 붙는 설정. 시나리오마다 플랫폼과 서버 주소만 바꾼다 */
const root = fileURLToPath(new URL("../../../examples/fixture-plugin/", import.meta.url));
const port = Number(process.env.FIXTURE_PORT ?? 4391);

export const fixture = (more: Partial<PlaygroundOptions> = {}): PlaygroundOptions => ({
    server: `http://127.0.0.1:${port}/mcp`,
    plugin: join(root, "plugin"),
    files: [join(root, "files/신청서.fixdoc")],
    ...more,
});

export const fixtureServer = (path: string): string => `http://127.0.0.1:${port}${path}`;
