import { useEffect, useState } from "react";

import { Button } from "@host-playground/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@host-playground/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@host-playground/ui/components/native-select";
import { Switch } from "@host-playground/ui/components/switch";
import { isRecord, type Json } from "@host-playground/core";

import { usePlayground } from "../lib/context";

/**
 * 플러그인 화면. 소개 · 구조화 설정(`openai/settings`) · 스킬이 서고, 「설정 시작」이 온보딩 스킬을 모델에게 건넨다.
 */
interface Settings
{
    readonly readTool: string;
    readonly updateTool: string;
}

const SettingsSection = ({ settings }: { settings: Settings }) =>
{
    const playground = usePlayground();
    const [read, setRead] = useState<Json | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() =>
    {
        void playground.host.callTool(settings.readTool).then((result) => setRead(isRecord(result["structuredContent"]) ? result["structuredContent"] : null));
    }, [playground, settings]);

    if (read === null)
    {
        return null;
    }

    const schema = isRecord(read["schema"]) && isRecord(read["schema"]["properties"]) ? read["schema"]["properties"] : {};
    const values = isRecord(read["values"]) ? read["values"] : {};
    const save = async (name: string, value: unknown): Promise<void> =>
    {
        // 바뀐 칸만 보낸다. 서버가 거절하면 읽어 둔 값으로 둔다
        const updated = await playground.host.callTool(settings.updateTool, { set: { [name]: value } });

        if (updated["isError"] === true)
        {
            setError(String((Array.isArray(updated["content"]) && isRecord(updated["content"][0]) ? updated["content"][0]["text"] : null) ?? "고치지 못했어요"));

            return;
        }

        setError(null);
        setRead({ ...read, values: isRecord(updated["structuredContent"]) ? updated["structuredContent"]["values"] : values });
    };

    return (
        <Card>
            <CardHeader><CardTitle>설정</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
                {Object.entries(schema).filter((entry): entry is [string, Json] => isRecord(entry[1])).map(([name, each]) => (
                    <label key={name} className="flex items-center justify-between gap-4 text-sm">
                        {String(each["title"] ?? name)}
                        {each["type"] === "boolean"
                            ? <Switch aria-label={String(each["title"] ?? name)} checked={values[name] === true} onCheckedChange={(checked) => void save(name, checked)} />
                            : (
                                <NativeSelect aria-label={String(each["title"] ?? name)} value={String(values[name] ?? "")} onChange={(event) => void save(name, event.target.value)}>
                                    {(Array.isArray(each["enum"]) ? each["enum"] : []).map((choice) => <NativeSelectOption key={String(choice)} value={String(choice)}>{String(choice)}</NativeSelectOption>)}
                                </NativeSelect>
                            )}
                    </label>
                ))}
                {error !== null && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
        </Card>
    );
};

export const PluginView = () =>
{
    const playground = usePlayground();
    const plugin = playground.config.plugin;
    const [settings, setSettings] = useState<Settings | null>(null);

    useEffect(() =>
    {
        void playground.host.request("server/discover").then((discovered) =>
        {
            const extensions = isRecord(discovered["capabilities"]) && isRecord(discovered["capabilities"]["extensions"]) ? discovered["capabilities"]["extensions"] : {};
            const found = extensions["openai/settings"];

            setSettings(isRecord(found) ? { readTool: String(found["readTool"]), updateTool: String(found["updateTool"]) } : null);
        }).catch(() => setSettings(null));
    }, [playground]);

    const onboard = (): void =>
    {
        const skill = plugin?.skills.find((each) => each.name === plugin.onboardingSkill);
        const thread = playground.newThread("처음 설정");

        playground.show({ kind: "chat", thread: thread.id });
        playground.note(thread.id, `${playground.pluginName()} · 온보딩 스킬(${plugin?.onboardingSkill ?? "없음"})`);
        void playground.send(`${playground.pluginName()} 설정을 시작해 줘`, [], skill === undefined ? undefined : { name: skill.name, body: skill.body });
    };

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-8">
            <div className="flex items-start gap-4">
                {playground.iconOf(undefined) !== null && <img src={playground.iconOf(undefined) ?? ""} alt="" className="size-12 rounded-xl border p-2 dark:invert" />}
                <div className="flex-1">
                    <h1 className="text-xl font-medium">{playground.pluginName()}</h1>
                    <p className="text-sm text-muted-foreground">{plugin?.shortDescription}</p>
                </div>
                {plugin?.onboardingSkill != null && <Button variant="outline" onClick={onboard}>설정 시작</Button>}
                {playground.globalTools()[0] !== undefined && <Button onClick={() => void playground.openGlobal(playground.globalTools()[0]?.name ?? "")}>플러그인 열기</Button>}
            </div>
            {plugin?.longDescription !== undefined && <p className="text-sm">{plugin.longDescription}</p>}
            <Card>
                <CardHeader>
                    <CardTitle>MCP 서버</CardTitle>
                    <CardDescription>{playground.config.server}</CardDescription>
                </CardHeader>
            </Card>
            {settings !== null && <SettingsSection settings={settings} />}
            <Card>
                <CardHeader><CardTitle>스킬 {plugin?.skills.length ?? 0}</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-2">
                    {(plugin?.skills ?? []).map((skill) => (
                        <div key={skill.name} className="text-sm"><strong>{skill.name}</strong> <span className="text-muted-foreground">{skill.description}</span></div>
                    ))}
                    {plugin === null && <p className="text-sm text-muted-foreground">플러그인 묶음을 주지 않았어요. --plugin 으로 plugin.json 이 있는 폴더를 넘겨요.</p>}
                </CardContent>
            </Card>
        </div>
    );
};
