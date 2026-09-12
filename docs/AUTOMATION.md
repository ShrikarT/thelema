# THELEMA automation

## Scope

This bundle covers the **THELEMA** build/test/release evidence gate. It does not deploy, execute trades, transmit private trade sizes, or handle `MAX_NOTIONAL`.

## Saved n8n workflow

- Name: **THELEMA — Build and Release Gate**
- URL: https://shrikar.app.n8n.cloud/workflow/FNDL5ToiOk1LGrol
- State: **inactive / unpublished**
- Project: personal n8n project
- Credentials: none
- Evidence table: `THELEMA Release Evidence Submissions`

The form requires n8n-user authentication and project execute access. A submission records status and artifact references for:

1. Unit tests
2. Application build
3. UI checks
4. Foundry tests
5. Arc receipt
6. Live Graph evidence
7. CRE simulation and evidence
8. Explicit human approval and approval reference

The gate emits `READY` only when every submitted status/reference passes. `READY` means **ready according to submitted evidence**, not independently verified. It never deploys automatically.

## n8n tests performed

The workflow SDK and all seven node configurations passed validation. Two safe pinned tests were executed with persistence pinned so no test rows were written:

- Blocked fixture: success; routed to `NO-GO — Blocked Gate Report`; blocked `unit_tests`, `foundry_tests`, `arc_receipt_submitted`, `cre_simulation`, and `human_approval`.
- Ready fixture: success; routed to `READY — Evidence Gate Passed`; no blocked gates.
- Evidence table check after testing: zero rows.

Fixtures are in `automation/n8n/fixtures/`.

## GitHub Actions template

Copy `automation/github/thelema-ci.yml` to `.github/workflows/thelema-ci.yml` after reviewing commands against the actual repository.

The template can run JavaScript unit/build/UI checks and Foundry build/tests when the corresponding project files exist. It validates an Arc/Graph/CRE/human-approval evidence manifest. It was **not executed** here because the repository was not available in this sandbox.

No repository URL, endpoint, credentials, chain IDs, Graph endpoint, CRE endpoint, or deployment target is guessed. Configure those later from trusted project documentation.

## Evidence contract

`automation/schemas/release-evidence.schema.json` documents the minimum release evidence shape. Use durable links to immutable CI artifacts, transaction receipts, live Graph query evidence, CRE simulation output, and the human approval record.

Do not put secrets, private trade sizes, or `MAX_NOTIONAL` in n8n submissions, workflow inputs, CI logs, or artifacts.

## Import and maintenance

- The canonical reviewed source is `automation/n8n/THELEMA-build-release-gate.sdk.ts`.
- The remote workflow is already saved; keep it inactive until owners review security, retention, and access.
- If rebuilding with the n8n SDK, re-run node validation, workflow validation, and both fixtures.
- Add trusted CI integration only after repository coordinates and credentials exist.
- A future GitHub dispatch integration must be credentialed, repository-scoped, and remain separate from release deployment.

## Main-agent verification and corrections

The remote workflow was re-read after import and confirmed to have seven nodes, `active=false`, no published version, and a description explicitly saying it does not run CI. Its raw-submission table is real, but persistence was bypassed in the two pinned tests. This is not evidence of a tested production form or live evidence ingestion.

The GitHub template was corrected for Node 22, the actual Node test runner, package installation without a fabricated lockfile, the real Foundry working directory, reliable pipeline exit codes and explicit browser installation. No job is silently skipped using a pre-checkout file test. It is still authored/unexecuted; place it under `.github/workflows/` only after repository-owner review.

The delivered `automation/evidence/release-evidence.json` truthfully reports local checks and missing external gates. `npm run release:check` is expected to return NO_GO. This local preflight is stricter about commit/link syntax but still does not verify remote proofs.
