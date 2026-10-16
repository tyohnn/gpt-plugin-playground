import { describe, expect, it } from "vitest";

import { discover, metadataCandidates } from "./auth";

/**
 * MCP 클라이언트가 인증 서버를 찾는 길. ChatGPT 가 하는 차례를 그대로 밟는다.
 * 401 의 `WWW-Authenticate` → 보호 자원 메타데이터(RFC 9728) → 인증 서버 메타데이터(RFC 8414) → 동적 등록.
 */
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("인증 서버 찾기", () =>
{
    it("인증 서버 메타데이터는 RFC 8414 의 경로 끼우기를 먼저, OpenID 의 자리를 다음에 본다", () =>
    {
        expect(metadataCandidates("http://127.0.0.1:54581/auth/v1")).toEqual([
            "http://127.0.0.1:54581/.well-known/oauth-authorization-server/auth/v1",
            "http://127.0.0.1:54581/.well-known/openid-configuration/auth/v1",
            "http://127.0.0.1:54581/auth/v1/.well-known/openid-configuration",
            "http://127.0.0.1:54581/auth/v1/.well-known/oauth-authorization-server",
        ]);
    });

    it("401 의 resource_metadata 를 따라 인증 서버를 찾고 등록 · 인가 · 토큰의 자리를 얻는다", async () =>
    {
        const seen: Array<string> = [];
        const fetcher = async (input: string | URL | Request): Promise<Response> =>
        {
            const url = String(input);

            seen.push(url);

            if (url === "http://app.test/api/mcp")
            {
                return new Response("", { status: 401, headers: { "www-authenticate": "Bearer resource_metadata=\"http://app.test/.well-known/oauth-protected-resource\"" } });
            }

            if (url === "http://app.test/.well-known/oauth-protected-resource")
            {
                return json({ resource: "http://app.test/api/mcp", authorization_servers: ["http://auth.test/auth/v1"], scopes_supported: ["openid", "email"] });
            }

            if (url === "http://auth.test/.well-known/oauth-authorization-server/auth/v1")
            {
                return json({
                    issuer: "http://auth.test/auth/v1",
                    authorization_endpoint: "http://auth.test/auth/v1/oauth/authorize",
                    token_endpoint: "http://auth.test/auth/v1/oauth/token",
                    registration_endpoint: "http://auth.test/auth/v1/oauth/clients/register",
                });
            }

            return new Response("", { status: 404 });
        };
        const found = await discover("http://app.test/api/mcp", fetcher);

        expect(found).toEqual({
            kind: "oauth",
            resource: "http://app.test/api/mcp",
            authorize: "http://auth.test/auth/v1/oauth/authorize",
            token: "http://auth.test/auth/v1/oauth/token",
            register: "http://auth.test/auth/v1/oauth/clients/register",
            scope: "openid email",
        });
    });

    it("401 이 아니면 인증이 없는 서버로 본다", async () =>
    {
        const found = await discover("http://open.test/mcp", async () => json({ jsonrpc: "2.0", id: 0, result: {} }));

        expect(found).toEqual({ kind: "none" });
    });
});
