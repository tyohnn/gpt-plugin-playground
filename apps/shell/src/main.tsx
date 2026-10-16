import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, Failure } from "./App";
import { loadConfig } from "./lib/config";
import { PlaygroundProvider } from "./lib/context";
import { startPlayground } from "./lib/store";
// tyohnn:begin entry-css
import "./index.css";
// tyohnn:end entry-css

const root = createRoot(document.getElementById("root") as HTMLElement);

const boot = async (): Promise<void> =>
{
    try
    {
        const config = await loadConfig();

        if (config.auth === "oauth" && !config.connected)
        {
            root.render(<Failure connect message={`${config.server} 는 OAuth 로 지켜져 있어요.`} />);

            return;
        }

        const playground = await startPlayground(config);

        root.render(<StrictMode><PlaygroundProvider value={playground}><App /></PlaygroundProvider></StrictMode>);
    }
    catch (error)
    {
        root.render(<Failure connect={false} message={error instanceof Error ? error.message : String(error)} />);
    }
};

void boot();
