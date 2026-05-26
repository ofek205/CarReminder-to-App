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
      // Claude Code agent worktrees — each agent run creates a
      // shadow checkout under .claude/worktrees/<name>/. Their src/
      // is a snapshot of an OTHER branch's code and isn't ours to
      // fix; linting them blocks pushes from the main worktree on
      // unrelated upstream errors.
      ".claude/worktrees/**",
    ],
  },
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/lib/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    // src/components/ui/** stays out — those are shadcn primitives we
    // copy verbatim from the library. JSX-specific rules trip on them
    // (e.g. react/no-unknown-property for cmdk-input-wrapper).
    //
    // src/lib/** USED to be excluded too — that's how v5.4.4-hotfix1
    // happened (an `import { C }` line nested inside a JSDoc comment
    // in src/lib/permissions.js shipped to prod and ROLE_INFO threw
    // "C is not defined" the moment any role-display screen mounted).
    // It's back in the scan list now so no-undef + the rest of our
    // rules cover lib code too.
    ignores: ["src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: {
        ...globals.browser,
        // Vite-replaced build-time constants. Listed here so the
        // no-undef rule below doesn't flag legitimate `__APP_VERSION__`
        // references in Layout.jsx / Settings.jsx / UserProfile.jsx
        // (read via package.json → vite.config.js define block). Add
        // any new `__VITE_FOO__`-style constants from vite.config.js
        // here too.
        __APP_VERSION__: "readonly",
      },
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
      // TDZ catcher — fires when a `let`/`const` is referenced before
      // its declaration in the same scope. Real bug magnet: this is what
      // crashed the AI Assistant page in Sprint A and /AddVehicle in
      // v4.8.7 (the AI-scan-gate useEffect referenced `selectedCategory`
      // in its deps array several lines above the const declaration —
      // minified to `r`, threw "Cannot access 'r' before initialization"
      // on every first render on staging).
      //
      // Hoisted function declarations are intentionally allowed because
      // there's no TDZ for those, and forbidding them would force a
      // mass refactor of helper-below-component patterns.
      //
      // Set to "error" 2026-05-21 after cleaning the 28 pre-existing
      // violations as part of the v4.8.7 post-mortem. KEEP IT AT "error"
      // — every time this rule got demoted to "warn" we burned someone.
      "no-use-before-define": [
        "error",
        {
          functions: false,
          classes: false,
          variables: true,
          allowNamedExports: true,
        },
      ],
      // The big one — catches references to identifiers that are neither
      // declared nor imported. Was previously inherited from
      // `pluginJs.configs.recommended` (which spreads above), but spreading
      // a config object and THEN providing a `rules:` block replaces the
      // recommended rules entirely. The omission let v5.4.1 ship with 14
      // files calling `C.token` without importing C — production users hit
      // "C is not defined" toasts until the hot-fix landed.
      //
      // Set to error 2026-05-26 as part of the v5.4.1-hotfix1 post-mortem.
      // KEEP IT AT "error" — every refactor (manual or scripted) that
      // introduces a typo / forgotten import is a production crash waiting
      // for the first user to land on that screen. The lint check is fast,
      // local, and free.
      "no-undef": "error",
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
  // ----------------------------------------------------------------
  // Sprint A — anti-base64-in-DB enforcement (warning only).
  // ----------------------------------------------------------------
  // Goal: surface every `FileReader.readAsDataURL()` call in the app
  // so the Sprint A migration can pick them off one by one. Each such
  // call typically ends with the resulting data: URL being saved into
  // a Postgres column, which is the exact pattern that bloated the
  // documents/vehicles/accidents tables and broke the document-viewer
  // ("כתובת לא מאובטחת"). The replacement is `useFileUpload()` →
  // upload to Storage → save the storage_path.
  //
  // Set to "warn" intentionally — flipping to "error" right now would
  // make `npm run lint` fail in 13 existing files (Documents.jsx,
  // AddVehicle.jsx, AddAccident.jsx, EditVehicle.jsx, ...). We escalate
  // to "error" once the migration removes them.
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/hooks/**/*.{js,mjs,cjs,jsx}",
    ],
    // Mirrors the ignore list of the main config block. Without these,
    // ESLint walks into shadcn/ui primitives that live outside our
    // parser config and fails with "Unexpected token <" on every JSX.
    ignores: [
      "scripts/**",
      "src/components/ui/**/*",
      "src/lib/**/*",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // Inline style object: style={{ background: '#FEF2F2' }}
          // (duplicated from the rule above because no-restricted-syntax
          // entries are merged per-file and we want both to fire here.)
          selector: "JSXAttribute[name.name='style'] Property > Literal[value=/^(#[0-9A-Fa-f]{3,8}|rgb\\(|rgba\\()/]",
          message:
            "Inline hex/rgb in style is forbidden. Use a design token from @/design/tokens.css " +
            "or a Tailwind cr-* class. See /dev/components for the catalog.",
        },
        {
          // FileReader.readAsDataURL(file) — the Base44-era pattern that
          // ends up persisting a base64 data: URL into the DB. Replace
          // with: const { upload } = useFileUpload({ accountId, ... });
          // const { fileUrl, storagePath } = await upload(file);
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='readAsDataURL']",
          message:
            "readAsDataURL() is forbidden — it produces base64 strings that get saved into the DB " +
            "and bloat tables. Use `useFileUpload()` from @/hooks/useFileUpload to upload to Supabase " +
            "Storage and persist the storage_path. See supabase-base64-to-storage-migration.sql.",
        },
      ],
    },
  },
];
