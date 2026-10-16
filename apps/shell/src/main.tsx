import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// tyohnn:begin entry-css
import "./index.css";
// tyohnn:end entry-css

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><App /></StrictMode>);
