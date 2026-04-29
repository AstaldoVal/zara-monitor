# Zara Montenegro Monitor (Portable Local Product)

This folder is a standalone local product that can be copied to another computer and run there with the same behavior.

It monitors Zara Montenegro (`https://www.zara.com/me/`) in two scopes:
- `Women -> The New`
- `Women -> Full Catalog`

It exports:
- `output/zara-montenegro-matches-*.xlsx` (human-readable result),
- `output/zara-montenegro-scan-*.json` (full debug snapshot).

## Filters Used (all configurable)

Defaults live in `config/default-config.json`. During onboarding (`npm run onboard` / `npm run setup`) or later (`npm run configure`), answers are saved to `config/user-config.json` and drive the same rules below. You get a result tailored to your choices, not a fixed hardcoded profile.

A product is included in `*_matches` only if all checks that you left enabled pass:

- **Color** — substring match against your list (`filters.colorKeywords`).
- **Composition** — strict main-fabric logic; mixed main fabric must reach at least `filters.mixedMainMinTargetPercent` combined share of `filters.targetFabrics` in the main block (secondary/lining does not rescue a fail).
- **Care** — if `filters.rejectDoNotWash` is true, any `Do not wash` in care text fails the item; set to false to ignore this rule.
- **Size** — availability for `filters.requiredSize` (not only `S`; default is `S`).
- **Montenegro availability** — if `filters.requireMontenegroInStock` is true, the usual in-stock / orderable checks apply; set to false to skip this gate (still useful for local experiments).

To change filters after install: `npm run configure` (or ask your agent to run it). Advanced edits: `config/user-config.json` (see keys above).

Excel diagnostics include:
- `main_fabric_raw`, `secondary_fabric_raw`, `unknown_section_raw`,
- `target_fabric_percent`, `target_fabric_percent_secondary`,
- `composition_mode`, `composition_reason`,
- `care_raw`, `care_source`, `washable`, `care_reason`.

## New Computer Setup (Beginner Friendly)

### 0) Prerequisites

Required:
1. Google Chrome stable

Node.js LTS:
- setup wizard will try to install it automatically (best effort) using `brew` (macOS) or `winget/choco` (Windows),
- if auto-install is unavailable/fails, install manually: [https://nodejs.org](https://nodejs.org)

### 1) Run interactive setup

Recommended one-command onboarding:

```bash
npm run onboard
```

From this folder:

- macOS: double-click `setup.command`
- Windows: double-click `setup.bat`

Or in terminal:

```bash
npm run setup
```

The interactive setup will:
1. install npm dependencies,
2. install Playwright Chrome runtime,
3. ask configuration questions one-by-one and save answers,
4. optionally open a dedicated Chrome profile for manual Zara onboarding,
5. optionally install local scheduler.

### 2) Manual onboarding step (if prompted)

During profile onboarding, browser opens with a dedicated profile.
Do these manual actions if Zara asks:
- accept cookies,
- solve captcha/human checks,
- optionally sign in.

Then return to terminal and press Enter.

### 3) Validate environment

```bash
npm run doctor
```

### 4) First full run (recommended)

```bash
npm run run-full
```

## Commands

```bash
# one-command onboarding (recommended)
npm run onboard

# interactive setup wizard
npm run setup

# non-interactive dependency setup only
npm run setup:deps

# environment checks
npm run doctor

# re-open interactive config wizard (one question at a time)
npm run configure

# open dedicated profile onboarding
npm run profile:onboard

# run one incremental scan
npm run run-once

# run full rescan
npm run run-full
```

## Project Docs

- `README.md` - setup and usage
- `ARCHITECTURE.md` - system design and extension points
- `CONTRIBUTING.md` - development workflow and PR checklist
- `AGENTS.md` - how agents should run this project from natural-language user requests
- `LICENSE` - MIT license

## Agent-First Usage (Cursor / Claude Code / Manus)

If user works through an agent, the user can just type plain language, for example:
- "onboarding"
- "set up this project"
- "run full scan"
- "reconfigure filters"

Agent should translate that to project commands (see `AGENTS.md`) and run them.

Default onboarding command for agents:

```bash
npm run onboard
```

This keeps terminal interaction on the agent side, not the user side.

## Configuration

- Defaults live in `config/default-config.json`.
- User answers are stored in `config/user-config.json` (created by setup/configure wizard).
- To update later, run:

```bash
npm run configure
```

Scheduler:

```bash
# macOS
npm run install-schedule:mac
npm run status-schedule:mac
npm run uninstall-schedule:mac

# Windows
npm run install-schedule:win
npm run status-schedule:win
npm run uninstall-schedule:win
```

## Schedule Behavior

- scheduler ticks every 5 minutes,
- actual scraping runs only on **Mon/Thu 10:00 GMT+1** window,
- dedup state is stored in `output/zara-montenegro-state.json`.

## Profile Isolation

By default, dedicated Chrome profile is:
- `.playwright-zara-profile`

You can override with environment variables:

```bash
ZARA_PROFILE_DIR=/absolute/path/to/profile
ZARA_OUTPUT_DIR=/absolute/path/to/output
ZARA_BROWSER_CHANNEL=chrome
ZARA_HEADLESS=1
```

## Troubleshooting

- `Playwright browser not found`:
  - run `npx playwright install chrome`
- `Captcha or blocked requests`:
  - run `npm run profile:onboard` and complete manual checks
- `No schedule activity`:
  - run scheduler status script for your OS
- `Profile lock` errors:
  - close all Chrome instances using that profile path
