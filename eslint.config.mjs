export default [
  {
    files: ["dist/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Blob: "readonly",
        Buffer: "readonly",
        console: "readonly",
        document: "readonly",
        navigator: "readonly",
        process: "readonly",
        self: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        Worker: "readonly",
      },
    },
    rules: {
      "no-constant-condition": "error",
      "no-duplicate-imports": "error",
      "no-fallthrough": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
