# Architecture

## Overview

The project runs a local monitor for Zara Montenegro with reproducible filtering and traceable output.

Main goals:
- scrape catalog scopes,
- evaluate products with deterministic rules,
- export both user-friendly and audit-friendly artifacts.

## Runtime Flow

1. `src/scheduler.cjs` decides whether to run now:
   - manual run (`--run-now`)
   - scheduled run (`--scheduled`, Mon/Thu 10:00 GMT+1 gate)
2. `src/monitor.cjs`:
   - loads catalog cards for each scope (`women_new`, `women_full`),
   - parses product detail and `extra-detail` payload,
   - evaluates filters (color, composition, care, size, availability),
   - writes:
     - `output/zara-montenegro-scan-*.json`
     - `output/zara-montenegro-matches-*.xlsx`
3. State files:
   - `output/zara-montenegro-state.json` (catalog dedupe)
   - `output/scheduler-state.json` (daily scheduler guard)

## Scopes

- `women_new`: listing URL based.
- `women_full`: category traversal and aggregate fetch.

Results are exported per scope and in `combined_summary`.

## Filtering Model

- **Color**: keyword matching with buckets and diagnostics.
- **Composition**:
  - strict main-fabric first,
  - secondary tracked separately,
  - ambiguous unknown sections rejected.
- **Care**:
  - if care contains `Do not wash` -> reject.
- **Size**:
  - require `S` availability from product metadata/text.
- **Availability**:
  - Montenegro in-stock check from product availability endpoint.

Final inclusion requires all checks to pass.

## Setup Tooling

- `scripts/setup-interactive.cjs`: end-user setup wizard.
- `scripts/profile-onboarding.cjs`: manual profile bootstrap.
- `scripts/doctor.cjs`: environment validation.
- platform scheduler scripts in `scripts/`.

## Extension Points

- Add new filters in `src/monitor.cjs` and extend `buildDecisionReason`.
- Add new scopes in `SCOPE_CONFIGS`.
- Add new export columns in `toAuditRow` and `matchRows`.
- Add new scheduler strategies in `src/scheduler.cjs`.
