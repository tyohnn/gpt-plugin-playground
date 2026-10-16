import { defineConfig } from "vitest/config";

// e2e/*.spec.ts 는 Playwright 의 몫이다
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
