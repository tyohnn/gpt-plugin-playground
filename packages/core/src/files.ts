/**
 * 호스트가 쥔 사람의 파일. 화면은 주소(`resourceUri`)만 알고, 읽고 쓰는 일은 호스트가 한다.
 * ChatGPT 데스크톱의 파일 진입점이 사람의 파일을 쥐는 자리를 흉내 낸다.
 */
export interface HostFile
{
    readonly uri: string;
    readonly name: string;
    readonly bytes: Uint8Array;
    readonly etag: string;
    readonly writable: boolean;
    /** 사람의 기기에서의 자리. 화면에는 주지 않는다 */
    readonly path: string;
    readonly mimeType: string;
}

export type NewFile = Omit<HostFile, "etag" | "writable"> & { readonly etag?: string; readonly writable?: boolean };

export type WriteOutcome =
    | { readonly outcome: "saved"; readonly etag: string }
    | { readonly outcome: "conflict"; readonly etag: string };

export interface FileStore
{
    readonly list: () => ReadonlyArray<HostFile>;
    readonly get: (uri: string) => HostFile | undefined;
    readonly add: (file: NewFile) => HostFile;
    /** 밖에서 파일이 바뀐 것처럼 고친다. 개발 도구의 「밖에서 바꾸기」와 테스트가 부른다 */
    readonly touch: (uri: string, bytes: Uint8Array) => void;
    readonly write: (uri: string, bytes: Uint8Array, ifMatch: string | undefined) => WriteOutcome;
    readonly onChange: (listener: (uri: string) => void) => () => void;
}

const nextEtag = (etag: string): string => `v${Number(etag.replace(/^v/, "")) + 1}`;

export const createFileStore = (initial: ReadonlyArray<NewFile> = []): FileStore =>
{
    const files = new Map<string, HostFile>();
    const listeners = new Set<(uri: string) => void>();
    const changed = (uri: string): void => listeners.forEach((listener) => listener(uri));
    const store: FileStore = {
        list: () => [...files.values()],
        get: (uri) => files.get(uri),
        add: (file) =>
        {
            const added = { etag: "v1", writable: true, ...file };

            files.set(added.uri, added);

            return added;
        },
        touch: (uri, bytes) =>
        {
            const file = files.get(uri);

            if (file === undefined)
            {
                return;
            }

            files.set(uri, { ...file, bytes, etag: nextEtag(file.etag) });
            changed(uri);
        },
        write: (uri, bytes, ifMatch) =>
        {
            const file = files.get(uri);

            if (file === undefined || !file.writable)
            {
                throw new Error(`쓸 수 없는 파일이다: ${uri}`);
            }

            if (ifMatch !== undefined && ifMatch !== file.etag)
            {
                return { outcome: "conflict", etag: file.etag };
            }

            const saved = { ...file, bytes, etag: nextEtag(file.etag) };

            files.set(uri, saved);

            return { outcome: "saved", etag: saved.etag };
        },
        onChange: (listener) =>
        {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
    };

    initial.forEach((file) => store.add(file));

    return store;
};

/** 브라우저와 Node 에서 함께 도는 base64. `Buffer` 에 기대지 않는다 */
export const toBase64 = (bytes: Uint8Array): string =>
{
    let binary = "";

    for (let index = 0; index < bytes.length; index += 0x8000)
    {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }

    return btoa(binary);
};

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
