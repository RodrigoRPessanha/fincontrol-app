# Repository Guidelines

## Project Structure & Module Organization

FinControl is a Next.js 16 and React 19 application written in TypeScript. Routes live under `src/app/`; dashboard pages are grouped in `src/app/(dashboard)/`. Reusable UI belongs in `src/components/`, grouped by feature such as `accounts/`, `transactions/`, and `layout/`. Business types, financial calculations, mock data, Supabase clients, and React contexts live in `src/lib/`. Keep tests in `src/lib/__tests__/` and name them `*.test.ts` or `*.test.tsx`. Database changes belong in sequentially numbered files under `supabase/migrations/`. Generated coverage, `.next/`, and `output/` are not source files.

## Build, Test, and Development Commands

- `npm run dev` starts the local Next.js development server.
- `npm run typecheck` regenerates route types and runs strict TypeScript checks.
- `npm run lint` applies the ESLint flat configuration and React Hooks rules.
- `npm test` runs the Vitest suite once; `npm run test:watch` runs it interactively.
- `npm run test:coverage` creates V8 coverage reports for the configured financial modules.
- `npm run build` produces the production build; `npm start` serves it.
- `npm run audit` checks installed dependencies for known vulnerabilities.

Before submitting a change, run typecheck, lint, coverage, build, and audit.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes in TypeScript, and semicolons. Components and exported types use `PascalCase`; functions, variables, and hooks use `camelCase`; hooks begin with `use`. Prefer the `@/` alias for imports from `src/`. Keep route filenames aligned with Next.js conventions (`page.tsx`, `layout.tsx`). Perform monetary arithmetic through `toCents` and `fromCents`; avoid accumulating currency with raw floating-point operations.

## Testing Guidelines

Vitest runs in a Node environment. Exercise real domain functions and public `FinanceProvider` APIs instead of copying production logic into tests. Add regression coverage for balance conservation, payment history, workspace isolation, rounding, and batched React updates. Coverage currently measures `financial-engine.ts` and `utils.ts`; passing percentages do not replace integration tests.

## Commit & Pull Request Guidelines

History uses short version commits such as `v35`; follow the current release convention unless maintainers request a descriptive subject. Keep commits focused. Pull requests should explain the trigger and resulting behavior, list validation commands, link relevant issues, and include screenshots for visible UI changes. Call out migration or financial-domain effects explicitly.

## Security & Architecture

Never commit secrets; copy `.env.example` for local configuration. Preserve workspace boundaries and validate inactive or foreign entities before mutation. FinControl does not store receipts, uploads, attachments, or Base64 file payloads.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
