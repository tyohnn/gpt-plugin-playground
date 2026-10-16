import { isRecord, type Json, type Platform } from "./protocol";

/** 서버가 `tools/list` 로 내준 도구. 호스트가 읽는 칸만 이름을 붙였다 */
export interface Tool
{
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly inputSchema?: Json;
    readonly icons?: ReadonlyArray<{ readonly src: string }>;
    readonly _meta?: Json;
}

export type EntrypointType = "global" | "thread" | "file";

export interface Entrypoint
{
    readonly type: EntrypointType;
    readonly extensions?: ReadonlyArray<string>;
    readonly quickAction?: { readonly title: string; readonly target: { readonly type: string; readonly name: string; readonly arguments?: Json } };
}

export const resourceUriOf = (tool: Tool): string | undefined =>
{
    const ui = tool._meta?.["ui"];

    return isRecord(ui) && typeof ui["resourceUri"] === "string" ? ui["resourceUri"] : undefined;
};

export const entrypointsOf = (tool: Tool): ReadonlyArray<Entrypoint> =>
{
    const ui = tool._meta?.["openai/ui"];
    const entries = isRecord(ui) && Array.isArray(ui["entrypoints"]) ? ui["entrypoints"] : [];

    return entries.filter((entry): entry is Entrypoint => isRecord(entry) && typeof entry["type"] === "string");
};

/** 화면만 부를 수 있는 도구인가(`app-only-tools`) */
export const isAppOnly = (tool: Tool): boolean =>
{
    const ui = tool._meta?.["ui"];
    const visibility = isRecord(ui) && Array.isArray(ui["visibility"]) ? ui["visibility"] : ["model", "app"];

    return !visibility.includes("model");
};

/** 데스크톱에서만 서는 진입점(`desktop-only`). 사이드바와 대화 옆 패널은 어디서나 선다 */
const ENTRY_PLATFORMS: Record<EntrypointType, ReadonlyArray<Platform>> = {
    global: ["desktop", "web", "mobile"],
    thread: ["desktop", "web", "mobile"],
    file: ["desktop"],
};

export const toolsWith = (tools: ReadonlyArray<Tool>, type: EntrypointType, platform: Platform): ReadonlyArray<Tool> =>
    ENTRY_PLATFORMS[type].includes(platform) ? tools.filter((tool) => entrypointsOf(tool).some((entry) => entry.type === type)) : [];

/** 파일 이름으로 그 파일을 여는 도구를 찾는다 */
export const fileToolFor = (tools: ReadonlyArray<Tool>, name: string, platform: Platform): Tool | undefined =>
    toolsWith(tools, "file", platform).find((tool) =>
        entrypointsOf(tool).some((entry) => entry.type === "file" && (entry.extensions ?? []).some((extension) => name.toLowerCase().endsWith(extension.toLowerCase()))));

export const mentionToolOf = (tools: ReadonlyArray<Tool>): Tool | undefined =>
    tools.find((tool) => isRecord(tool._meta?.["openai/extensions"]) && (tool._meta["openai/extensions"] as Json)["mentions/search"] !== undefined);
