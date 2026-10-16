import { createHash, randomBytes } from "node:crypto";

/**
 * MCP 클라이언트의 로그인 사슬. ChatGPT 가 커넥터를 붙일 때 밟는 차례를 그대로 밟는다.
 *
 *   1. 토큰 없이 MCP 를 부르고 401 의 `WWW-Authenticate` 에서 보호 자원 메타데이터의 자리를 읽는다(RFC 9728)
 *   2. 거기 적힌 인증 서버의 메타데이터를 찾는다(RFC 8414)
 *   3. 클라이언트를 동적으로 등록하고(RFC 7591) PKCE 로 인가를 청한다
 *   4. 사람이 서버의 로그인과 동의를 지나 돌아오면 코드를 토큰으로 바꾼다
 */
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Discovered =
    | { readonly kind: "none" }
    | {
        readonly kind: "oauth";
        readonly resource: string;
        readonly authorize: string;
        readonly token: string;
        readonly register: string;
        readonly scope: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** RFC 8414 의 경로 끼우기를 먼저, OpenID 와 그 밖의 흔한 자리를 다음에 본다 */
export const metadataCandidates = (issuer: string): ReadonlyArray<string> =>
{
    const url = new URL(issuer);
    const path = url.pathname.replace(/\/$/, "");

    return [
        `${url.origin}/.well-known/oauth-authorization-server${path}`,
        `${url.origin}/.well-known/openid-configuration${path}`,
        `${url.origin}${path}/.well-known/openid-configuration`,
        `${url.origin}${path}/.well-known/oauth-authorization-server`,
    ];
};

const resourceMetadataOf = (header: string | null, server: string): ReadonlyArray<string> =>
{
    const quoted = /resource_metadata="([^"]+)"/.exec(header ?? "")?.[1];
    const url = new URL(server);

    return [
        ...(quoted === undefined ? [] : [quoted]),
        `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`,
        `${url.origin}/.well-known/oauth-protected-resource`,
    ];
};

const firstJson = async (fetcher: Fetcher, urls: ReadonlyArray<string>): Promise<Record<string, unknown> | null> =>
{
    for (const url of urls)
    {
        const response = await fetcher(url).catch(() => null);

        if (response?.ok)
        {
            const body: unknown = await response.json().catch(() => null);

            if (isRecord(body))
            {
                return body;
            }
        }
    }

    return null;
};

export const discover = async (server: string, fetcher: Fetcher = fetch): Promise<Discovered> =>
{
    const probe = await fetcher(server, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping", params: {} }),
    });

    if (probe.status !== 401)
    {
        return { kind: "none" };
    }

    const resource = await firstJson(fetcher, resourceMetadataOf(probe.headers.get("www-authenticate"), server));
    const issuer = Array.isArray(resource?.["authorization_servers"]) ? String(resource["authorization_servers"][0]) : null;

    if (issuer === null)
    {
        throw new Error(`${server} 가 401 로 답했지만 인증 서버를 알리지 않았다(RFC 9728)`);
    }

    const metadata = await firstJson(fetcher, metadataCandidates(issuer));

    if (metadata === null || typeof metadata["registration_endpoint"] !== "string")
    {
        throw new Error(`인증 서버(${issuer})의 메타데이터나 동적 등록 자리를 찾지 못했다`);
    }

    const scopes = Array.isArray(resource?.["scopes_supported"]) ? resource["scopes_supported"].map(String) : ["openid", "email"];

    return {
        kind: "oauth",
        resource: typeof resource?.["resource"] === "string" ? resource["resource"] : server,
        authorize: String(metadata["authorization_endpoint"]),
        token: String(metadata["token_endpoint"]),
        register: metadata["registration_endpoint"],
        scope: scopes.join(" "),
    };
};

export interface PendingAuthorization
{
    readonly clientId: string;
    readonly verifier: string;
    readonly state: string;
    readonly redirectUri: string;
}

const base64url = (buffer: Buffer): string => buffer.toString("base64url");

/** 클라이언트를 등록하고 사람을 보낼 인가 주소를 짓는다 */
export const beginAuthorization = async (found: Extract<Discovered, { kind: "oauth" }>, redirectUri: string, fetcher: Fetcher = fetch): Promise<{ readonly pending: PendingAuthorization; readonly url: string }> =>
{
    const registered = await fetcher(found.register, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client_name: "호스트 플레이그라운드",
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
        }),
    });

    if (!registered.ok)
    {
        throw new Error(`클라이언트를 등록하지 못했다(${registered.status}): ${await registered.text()}`);
    }

    const body: unknown = await registered.json();
    const clientId = isRecord(body) ? String(body["client_id"]) : "";
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(16));
    const url = new URL(found.authorize);

    url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: base64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        state,
        scope: found.scope,
        resource: found.resource,
    }).toString();

    return { pending: { clientId, verifier, state, redirectUri }, url: url.toString() };
};

export const finishAuthorization = async (found: Extract<Discovered, { kind: "oauth" }>, pending: PendingAuthorization, code: string, fetcher: Fetcher = fetch): Promise<string> =>
{
    const exchanged = await fetcher(found.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: pending.redirectUri,
            client_id: pending.clientId,
            code_verifier: pending.verifier,
            resource: found.resource,
        }),
    });

    if (!exchanged.ok)
    {
        throw new Error(`토큰을 받지 못했다(${exchanged.status}): ${await exchanged.text()}`);
    }

    const body: unknown = await exchanged.json();

    return isRecord(body) ? String(body["access_token"]) : "";
};
