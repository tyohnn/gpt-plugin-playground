import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 사람이 깐 플러그인의 묶음. 호스트의 플러그인 화면이 이름 · 소개 · 아이콘 · 스킬 · 온보딩을 여기서 읽는다.
 * 묶음의 꼴은 `plugin/plugin.json` 과 `plugin/skills/<이름>/SKILL.md` 다(scaffold 의 plugin 모듈).
 */
export interface PluginPackage
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export const readPlugin = (dir: string | undefined): PluginPackage | null =>
{
    if (dir === undefined || !existsSync(join(dir, "plugin.json")))
    {
        return null;
    }

    const manifest: unknown = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
    const openai = isRecord(manifest) && isRecord(manifest["extensions"]) && isRecord(manifest["extensions"]["com.openai"]) ? manifest["extensions"]["com.openai"] : {};
    const face = isRecord(openai["interface"]) ? openai["interface"] : {};
    const logo = typeof face["logo"] === "string" ? join(dir, face["logo"]) : join(dir, "assets/icon.svg");
    const skillsDir = join(dir, "skills");
    const skills = existsSync(skillsDir)
        ? readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, "SKILL.md"))).map((name) =>
        {
            const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");

            return { name, description: /^description: (.+)$/m.exec(text)?.[1] ?? "", body: text.replace(/^---[\s\S]*?---\n/, "") };
        })
        : [];
    const name = isRecord(manifest) && typeof manifest["name"] === "string" ? manifest["name"] : "plugin";

    return {
        name,
        displayName: typeof face["displayName"] === "string" ? face["displayName"] : name,
        shortDescription: typeof face["shortDescription"] === "string" ? face["shortDescription"] : "",
        longDescription: typeof face["longDescription"] === "string" ? face["longDescription"] : "",
        defaultPrompt: Array.isArray(face["defaultPrompt"]) ? face["defaultPrompt"].map(String) : [],
        onboardingSkill: typeof openai["onboardingSkill"] === "string" ? openai["onboardingSkill"] : null,
        icon: existsSync(logo) ? readFileSync(logo, "utf8") : null,
        skills,
    };
};
