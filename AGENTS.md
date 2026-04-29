# Agent Operating Guide

This project is designed to be operated through coding agents (Cursor Agent, Claude Code, Manus) so the end user can use natural language and avoid terminal interaction.

## Primary Agent Command

When user intent is onboarding/setup, run:

```bash
npm run onboard
```

`onboard` is the single entrypoint for first-time setup.

## Intent to Command Mapping

If user says anything like:
- "onboarding"
- "set up this project"
- "initialize zara monitor"
- "prepare monitor on this machine"
- "install and configure"

Agent should run:

```bash
npm run onboard
```

If user says:
- "reconfigure filters/settings/schedule/timezone" -> `npm run configure`
- "check environment" -> `npm run doctor`
- "run now" -> `npm run run-once`
- "full scan" -> `npm run run-full`

## UX Rule

- User communicates in plain language.
- Agent executes terminal commands and reports progress.
- User should not be asked to type terminal commands manually unless explicitly requested.

## Manual Human Steps (when unavoidable)

During onboarding/profile bootstrap, user may need to manually:
- accept cookies,
- solve anti-bot/captcha,
- optionally sign in.

Agent should pause and ask user to complete those UI actions, then continue automatically.
