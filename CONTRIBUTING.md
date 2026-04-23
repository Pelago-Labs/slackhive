# Contributing to SlackHive

Thanks for your interest in contributing to SlackHive. This document covers everything you need to get set up and land a PR.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Repository Structure](#repository-structure)
- [Branch Naming](#branch-naming)
- [Commit Style](#commit-style)
- [Pull Request Process](#pull-request-process)
- [Code Standards](#code-standards)
- [Reporting Bugs and Requesting Features](#reporting-bugs-and-requesting-features)

---

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| [Node.js](https://nodejs.org/) | 20+ | Runs the web, runner, and CLI |
| [git](https://git-scm.com/) | 2.38+ | |
| Claude Code CLI or Anthropic API key | — | The runner uses one or the other to talk to Claude |

SlackHive runs on **SQLite by default** — no Docker, Postgres, or Redis required. If you want to run against Postgres, set `DATABASE_TYPE=postgres` and the relevant connection env vars; see `.env.example`.

---

## Local Development Setup

### 1. Fork and clone

```bash
git clone https://github.com/<your-username>/slackhive.git
cd slackhive
git remote add upstream https://github.com/pelago-labs/slackhive.git
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in at minimum:

- `ADMIN_PASSWORD` — any strong password
- `AUTH_SECRET` and `ENV_SECRET_KEY` — generate with `openssl rand -hex 32`
- Either `ANTHROPIC_API_KEY`, or leave it unset and run `claude login` on your host

### 3. Install dependencies and build shared packages

```bash
npm install
npm run build --workspace=packages/shared
npm run build --workspace=cli
```

`npm install` installs every workspace (`apps/web`, `apps/runner`, `packages/shared`, `cli`). The shared package and CLI are compiled ahead of time and must be built before the apps can start.

### 4. Start the stack

Easiest — use the SlackHive CLI you just built:

```bash
./cli/dist/bin.js start
# or, if you've linked it globally: slackhive start
```

This boots the web UI (http://localhost:3001) and the runner. Stop with `slackhive stop`. Logs land in `~/.slackhive/logs/` and the SQLite DB at `~/.slackhive/data.db`.

Manual two-terminal alternative:

```bash
# Terminal 1 — Next.js web app
npm run dev --workspace=apps/web

# Terminal 2 — Runner (Bolt apps + job scheduler)
npm run dev --workspace=apps/runner
```

### 5. Sign in

Open http://localhost:3001 and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`.

---

## Repository Structure

```
slackhive/
├── apps/
│   ├── web/          # Next.js 15 dashboard and REST API routes
│   └── runner/       # Bolt-based Slack agent runner + job scheduler
├── packages/
│   └── shared/       # Shared TypeScript types, DbAdapter, utilities
├── cli/              # `slackhive` CLI (init, start, stop, status, logs)
├── docs/             # Mintlify docs site (published at docs.slackhive.ai)
├── .env.example
├── CHANGELOG.md
└── README.md
```

---

## Branch Naming

Branch from `main`:

| Prefix | Use for |
|--------|---------|
| `feat/` | New features (`feat/mcp-paste-json`) |
| `fix/` | Bug fixes (`fix/slack-oauth-redirect`) |
| `chore/` | Maintenance, deps, tooling (`chore/bump-version`) |
| `docs/` | Documentation only (`docs/contributing-refresh`) |

---

## Commit Style

SlackHive follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short description>
```

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `chore` | Tooling, deps, versioning |
| `docs` | Documentation only |
| `refactor` | Code change that's neither a fix nor a feature |
| `test` | Adding or updating tests |
| `perf` | Performance improvements |
| `ci` | CI configuration changes |

Examples from the repo:

- `feat(web): add paste-JSON config for MCP servers`
- `fix(slack): surface files and text from forwarded/shared messages`
- `chore: bump version to 0.1.50`

Keep the subject under 72 characters and use the imperative mood ("add", not "added").

---

## Pull Request Process

1. Branch from `main`.
2. Implement — keep the PR focused on one logical change.
3. Verify locally: `slackhive start` and exercise the affected flow end-to-end. Run `npm test --workspace=apps/web` (and runner if touched).
4. Push and open a PR against `main` of `pelago-labs/slackhive`.
5. Fill in the PR template, with screenshots for any UI change.
6. Address review feedback.

Large refactors — file a GitHub Discussion or Issue first so we can agree on scope.

Maintainers merge via squash-and-merge.

---

## Code Standards

- **TypeScript strict** — avoid `any`; prefer `unknown` + narrowing.
- **Docstrings** — TSDoc/JSDoc for exported functions, classes, and types. Google-style `@param` / `@returns`.
- **Formatting** — run `npm run lint --workspace=apps/web` (and the corresponding workspace) before pushing. ESLint + Prettier via Next.js defaults.
- **Tests** — Vitest in `apps/web/src/lib/__tests__/` and `apps/runner/src/__tests__/`. New parsers, API route handlers, and DB helpers should ship with tests.
- **No secrets** — everything secret goes through `.env` or the platform env-var store; both are gitignored / DB-encrypted.

---

## Reporting Bugs and Requesting Features

- **Bugs:** [bug report issue](https://github.com/pelago-labs/slackhive/issues/new?template=bug_report.yml)
- **Features:** [feature request issue](https://github.com/pelago-labs/slackhive/issues/new?template=feature_request.yml)
- **Questions / discussions:** [GitHub Discussions](https://github.com/pelago-labs/slackhive/discussions)

Do **not** file security vulnerabilities as public issues. See [SECURITY.md](SECURITY.md) for responsible disclosure.
