import { createContext, useContext, useSyncExternalStore } from "react";

import type { Playground } from "./store";

const PlaygroundContext = createContext<Playground | null>(null);

export const PlaygroundProvider = PlaygroundContext.Provider;

/** 창의 상태를 읽는다. 상태가 바뀌면 다시 그린다 */
export const usePlayground = (): Playground =>
{
    const playground = useContext(PlaygroundContext);

    if (playground === null)
    {
        throw new Error("PlaygroundProvider 밖이다");
    }

    useSyncExternalStore(playground.subscribe, playground.snapshot);

    return playground;
};
