import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  // Top-level ignore. Lint never walks into these directories at all,
  // even when invoked as `eslint .`. The android/ios build outputs in
  // particular contain Capacitor's bundled native-bridge.js whose own
  // eslint-disable comments reference rule names (e.g. @typescript-
  // eslint/no-unused-vars) that aren't installed in our config.
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "android/**",
      "ios/**",
      ".vercel/**",
      ".vite/**",
      "supabase/.temp/**",
    ],
  },
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
  // ----------------------------------------------------------------
  // Sprint 1 — design-system enforcement (warning only).
  // ----------------------------------------------------------------
  // Goal: surface every inline hex/rgb color in src/pages/* so the
  // sprint 2 visual-polish migration has a concrete to-do list. Set
  // to "warn" intentionally — flipping to "error" before the migration
  // would make `npm run lint` fail across ~200 spots immediately.
  //
  // The rule is a `no-restricted-syntax` matcher that fires on JSX
  // string literals (style="..." / className="...") AND on Object
  // expressions inside `style={{ }}` whose values look like a hex code.
  // Files in src/pages/_dev/ and the design system itself are exempt.
  {
    files: ["src/pages/**/*.{js,mjs,cjs,jsx}"],
    ignores: [
      "src/pages/DevComponents.jsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // Inline style object: style={{ background: '#FEF2F2' }}
          selector: "JSXAttribute[name.name='style'] Property > Literal[value=/^(#[0-9A-Fa-f]{3,8}|rgb\\(|rgba\\()/]",
          message:
            "Inline hex/rgb in style is forbidden in src/pages/*. Use a design token from @/design/tokens.css " +
            "(e.g. var(--cr-status-danger-bg)) or a Tailwind class (bg-cr-status-danger-bg). " +
            "See /dev/components for the full token catalog.",
        },
      ],
    },
  },
];
