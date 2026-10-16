import { isRecord, type Json } from "@host-playground/core";

/**
 * 창이 서버를 부르는 길. 플레이그라운드 서버의 `/rpc` 가 토큰을 붙여 MCP 서버로 넘긴다.
 * 창은 토큰을 모른다.
 */
let sequence = 0;

export class ServerError extends Error
{
    constructor(readonly code: number, message: string, readonly data?: unknown)
    {
        super(message);
    }
}

export const rpc = async (method: string, params: Json = {}): Promise<Json> =>
{
    sequence += 1;

    const response = await fetch("/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: sequence, method, params }),
    });

    if (response.status === 401)
    {
        location.href = "/connect";

        throw new ServerError(401, "다시 연결해요");
    }

    const answered: unknown = await response.json();

    if (!isRecord(answered))
    {
        throw new ServerError(-32700, `서버가 JSON-RPC 가 아닌 답을 했어요(${response.status})`);
    }

    if (isRecord(answered["error"]))
    {
        throw new ServerError(Number(answered["error"]["code"] ?? -32000), String(answered["error"]["message"] ?? "오류"), answered["error"]["data"]);
    }

    return isRecord(answered["result"]) ? answered["result"] : {};
};
