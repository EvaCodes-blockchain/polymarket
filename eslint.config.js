// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript-specific rules applied to all TS/TSX files
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce explicit return types on exported functions
      "@typescript-eslint/explicit-module-boundary-types": "warn",
      // Disallow any
      "@typescript-eslint/no-explicit-any": "error",
      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      // Unused vars as errors (with underscore-prefix escape hatch)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Turn off rules that conflict with Prettier (must be last)
  prettierConfig,

  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/artifacts/**",
      "**/cache/**",
      "html-polymarket-social-prototype/**",
    ],
  },
);
