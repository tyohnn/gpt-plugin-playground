import { parseArgs } from "node:util";

import { createPlayground } from "./server";

/**
 *   npx host-playground --server http://127.0.0.1:4200/api/mcp --plugin ./plugin --file ./신청서.hwpx
 */
const { values } = parseArgs({
    options: {
        server: { type: "string" },
        port: { type: "string", default: "4300" },
        token: { type: "string" },
        plugin: { type: "string" },
        file: { type: "string", multiple: true },
        platform: { type: "string", default: "desktop" },
        legacy: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
    },
});

if (values.help || values.server === undefined)
{
    console.log("host-playground --server <MCP 주소> [--plugin <폴더>] [--file <파일>]… [--port 4300] [--token <토큰>] [--platform desktop|web|mobile] [--legacy]");
    process.exit(values.help ? 0 : 1);
}

const platform = values.platform === "web" || values.platform === "mobile" ? values.platform : "desktop";

await createPlayground({
    server: values.server,
    port: Number(values.port),
    ...(values.token === undefined ? {} : { token: values.token }),
    ...(values.plugin === undefined ? {} : { plugin: values.plugin }),
    files: values.file ?? [],
    platform,
    legacy: values.legacy,
});
