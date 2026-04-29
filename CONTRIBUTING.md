# Contributing

Thanks for contributing to `zara-montenegro-monitor`.

## Development Setup

1. Install Node.js LTS and Chrome.
2. Run:

```bash
npm run setup
```

3. Validate environment:

```bash
npm run doctor
```

## Branching and Commits

- Create a feature branch from `main`.
- Keep commits small and focused.
- Use clear commit messages, for example:
  - `feat: add care filter do-not-wash`
  - `fix: parse main/secondary fabric sections correctly`
  - `docs: improve onboarding for new users`

## Before Opening a PR

Run:

```bash
node --check src/monitor.cjs
node --check src/scheduler.cjs
node --check scripts/setup-interactive.cjs
node --check scripts/profile-onboarding.cjs
node --check scripts/doctor.cjs
npm run run-once
```

Check that:
- `output/zara-montenegro-matches-*.xlsx` is generated,
- expected diagnostics columns are present,
- no local secrets or private profile data are committed.

## Manual-Only Steps

Some actions cannot be fully automated and require human interaction:
- solving Zara anti-bot challenge/captcha,
- confirming cookies/privacy prompts,
- optional account sign-in.

Use:

```bash
npm run profile:onboard
```

## Security and Data

- Do not commit `.playwright-zara-profile/`.
- Do not commit `output/` files from personal runs unless needed for debugging.
- Never add API keys, tokens, or personal credentials to the repository.
