import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// tyohnn:begin imports
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
// tyohnn:end imports

export default defineConfig({
    // tyohnn:begin resolve
    resolve: {
        alias: [
            { find: /^@host-playground\/ui\/icons$/, replacement: fileURLToPath(new URL("../../packages/ui/src/icons/libraries/hugeicons.tsx", import.meta.url)) },
        ],
    },
    // tyohnn:end resolve
    plugins: [react(), tailwindcss() /* tyohnn */],
    base: "./",
});
