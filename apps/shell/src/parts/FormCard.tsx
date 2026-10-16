import { useRef } from "react";

import { Button } from "@host-playground/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@host-playground/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@host-playground/ui/components/native-select";
import { Input } from "@host-playground/ui/components/input";
import { Textarea } from "@host-playground/ui/components/textarea";
import { isRecord, type Json } from "@host-playground/core";

import { usePlayground } from "../lib/context";
import type { Block } from "../lib/store";

/**
 * 도구가 되물은 폼(`openai/elicitation/create`). 스펙의 확장(설명 · 썸네일 · 제안 값 · 자원 고르기)을 아는 만큼 그린다.
 */
type Schema = Json & { title?: string; type?: string; oneOf?: Array<Json>; default?: unknown; maxLength?: number };

const Field = ({ name, schema }: { name: string; schema: Schema }) =>
{
    const title = schema.title ?? name;
    const options = Array.isArray(schema.oneOf) ? schema.oneOf : null;

    if (options !== null && options.length <= 3 && options.every((each) => each["x-openai-thumbnail"] === undefined))
    {
        return (
            <label className="flex flex-col gap-1 text-sm">
                {title}
                <NativeSelect name={name} defaultValue={String(schema.default ?? "")}>
                    {options.map((each) => <NativeSelectOption key={String(each["const"])} value={String(each["const"])}>{String(each["title"] ?? each["const"])}</NativeSelectOption>)}
                </NativeSelect>
            </label>
        );
    }

    if (options !== null)
    {
        return (
            <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="mb-1 text-muted-foreground">{title}</legend>
                {options.map((each, index) => (
                    <label key={String(each["const"])} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent">
                        <input type="radio" name={name} value={String(each["const"])} defaultChecked={schema.default === each["const"]} />
                        <span className="text-muted-foreground">{index + 1}</span>
                        {isRecord(each["x-openai-thumbnail"]) && <img src={String(each["x-openai-thumbnail"]["src"])} alt="" className="size-8 rounded" />}
                        <span>{String(each["title"] ?? each["const"])}{typeof each["description"] === "string" && <small className="block text-muted-foreground">{each["description"]}</small>}</span>
                    </label>
                ))}
            </fieldset>
        );
    }

    if (schema.type === "array")
    {
        const input = isRecord(schema["x-openai-input"]) && Array.isArray(schema["x-openai-input"]["options"]) ? schema["x-openai-input"]["options"].filter(isRecord) : null;
        const items = isRecord(schema["items"]) && Array.isArray(schema["items"]["anyOf"]) ? schema["items"]["anyOf"].filter(isRecord) : [];
        const choices = input?.map((each) => ({ value: String(each["uri"]), title: String(each["title"] ?? each["name"]) })) ?? items.map((each) => ({ value: String(each["const"]), title: String(each["title"] ?? each["const"]) }));

        return (
            <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="mb-1 text-muted-foreground">{title}</legend>
                {choices.map((each) => (
                    <label key={each.value} className="flex items-center gap-2"><input type="checkbox" name={name} value={each.value} />{each.title}</label>
                ))}
            </fieldset>
        );
    }

    if (schema.type === "boolean")
    {
        return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} value="true" />{title}</label>;
    }

    const suggestions = Array.isArray(schema["x-openai-suggestions"]) ? schema["x-openai-suggestions"].filter(isRecord) : [];

    return (
        <label className="flex flex-col gap-1 text-sm">
            {title}
            {(schema.maxLength ?? 0) > 200 ? <Textarea name={name} rows={3} /> : <Input name={name} list={suggestions.length > 0 ? `suggest-${name}` : undefined} />}
            {suggestions.length > 0 && <datalist id={`suggest-${name}`}>{suggestions.map((each) => <option key={String(each["const"])} value={String(each["const"])} />)}</datalist>}
        </label>
    );
};

export const FormCard = ({ thread, form }: { thread: string; form: Extract<Block, { kind: "form" }> }) =>
{
    const playground = usePlayground();
    const ref = useRef<HTMLFormElement>(null);
    const requests = isRecord(form.result["inputRequests"]) ? Object.entries(form.result["inputRequests"]) : [];
    const [key, request] = requests[0] ?? ["", {}];
    const params = isRecord(request) && isRecord(request["params"]) ? request["params"] : {};
    const schema = isRecord(params["requestedSchema"]) ? params["requestedSchema"] : {};
    const properties = isRecord(schema["properties"]) ? Object.entries(schema["properties"]).filter((entry): entry is [string, Schema] => isRecord(entry[1])) : [];

    const answer = (action: "accept" | "decline" | "cancel"): void =>
    {
        const data = new FormData(ref.current ?? undefined);
        const content: Json = {};

        for (const [name, each] of properties)
        {
            const values = data.getAll(name).map(String);

            if (each.type === "array")
            {
                content[name] = values;
            }
            else if (each.type === "boolean")
            {
                content[name] = values.includes("true");
            }
            else if ((values[0] ?? "") !== "")
            {
                content[name] = values[0];
            }
        }

        void playground.answerForm(thread, form, key, action === "accept" ? { action, content } : { action });
    };

    return (
        <Card aria-label="폼" data-answered={form.answered} className={form.answered ? "pointer-events-none opacity-60" : undefined}>
            <CardHeader>
                <CardTitle>{String(params["message"] ?? `${playground.pluginName()}이(가) 정보를 요청해요`)}</CardTitle>
            </CardHeader>
            <CardContent>
                <form ref={ref} className="flex flex-col gap-3" onSubmit={(event) =>
                {
                    event.preventDefault();
                    answer("accept");
                }}>
                    {properties.map(([name, each]) => <Field key={name} name={name} schema={each} />)}
                </form>
            </CardContent>
            <CardFooter className="justify-end gap-2">
                <Button variant="ghost" onClick={() => answer("decline")}>건너뛰기</Button>
                <Button onClick={() => answer("accept")}>계속</Button>
            </CardFooter>
        </Card>
    );
};
