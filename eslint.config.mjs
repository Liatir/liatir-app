import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ESLint (flat config) scoped to the shippable TypeScript packages — the SDK,
 * CLI, API and core that users install and that run .lia plugins. Type-aware
 * so it can catch real bugs (unhandled promises, misused async, unsafe casts),
 * not just style.
 *
 * The Svelte frontend (34k lines, Svelte 5 runes) is intentionally NOT covered
 * yet — that is a separate, larger rollout. This config is the foundation.
 *
 * Rule policy: bug-catching rules are errors (they must be visible); rules that
 * are noisy on the current baseline are warnings so they surface without
 * drowning the signal. In CI this runs as an advisory (non-blocking) job.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-sdk/**",
      "**/node_modules/**",
      "**/.svelte-kit/**",
      "**/build/**",
      "**/target/**",
      "frontend/**",
      "src-ts/**",
      "sdk/**",
      "tests/**",
      "scripts/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "**/*.d.ts",
    ],
  },
  {
    files: ["packages/*/src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Bug catchers — keep as errors, must be seen ──────────────────────
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",

      // ── Noisy on the current baseline — surface as warnings, don't drown ─
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/require-await": "warn",
      // Empty interfaces that extend another are used deliberately as semantic
      // domain aliases (AI-model vs python-runtime naming) — surface, not block.
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
);
