import type { Platform } from "@host-playground/core";

/** 플레이그라운드 서버가 창에 알려 주는 것(`/api/config`) */
export interface PluginInfo
{
    readonly name: string;
    readonly displayName: string;
    readonly shortDescription: string;
    readonly longDescription: string;
    readonly defaultPrompt: ReadonlyArray<string>;
    readonly onboardingSkill: string | null;
    readonly icon: string | null;
    readonly skills: ReadonlyArray<{ readonly name: string; readonly description: string; readonly body: string }>;
}

export interface Config
{
    readonly server: string;
    readonly platform: Platform;
    readonly modern: boolean;
    readonly frameOrigin: string;
    readonly auth: "none" | "oauth";
    readonly connected: boolean;
    readonly plugin: PluginInfo | null;
    readonly files: ReadonlyArray<{ readonly index: number; readonly name: string; readonly mimeType: string; readonly size: number; readonly path: string }>;
}

export const loadConfig = async (): Promise<Config> =>
{
    const config = await (await fetch("/api/config")).json() as Config;
    const wanted = new URLSearchParams(location.search).get("platform");

    // 주소의 ?platform= 이 서버의 기본을 이긴다. 플랫폼을 바꾸면 창을 새로 띄워 화면들이 새 능력으로 악수한다
    return wanted === "desktop" || wanted === "web" || wanted === "mobile" ? { ...config, platform: wanted } : config;
};
