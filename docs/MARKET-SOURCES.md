# Market source register

**Catalog checked:** 2026-09-08 (UTC)  
**Canonical metadata:** [`packages/markets/catalog.ts`](../packages/markets/catalog.ts)

THELEMA can support any oracle-reported, synthetic index `S`; it does not put
the real underlying asset in a vault. This register documents candidate
event/index pairs and their public-source basis. It is **not** a quote feed,
an oracle feed, an election forecast, investment research, or proof that any
market is tradable.

No catalog entry claims live Twitter/X access or uses a social-media post as a
resolution source. The source links below were rechecked on the date shown.
`checkedAt` records that repository review, not a source publication date;
`publishedAt` is omitted when the official page does not expose one. Recheck
the authoritative source before a new deployment or settlement decision.

## Availability boundary

- `china-ai-chips-snvda` is the sole **demo** candidate. Its canonical
  public-policy scenario has a 2026-12-31 deadline. Read the active
  `DEMO_ORACLE` event deadline, trading cutoff, and price-fix window from the
  verified contract snapshot at `deployments/demo-manifest.json`; static
  catalog metadata deliberately does not cache them. An owner-set demo outcome
  does not answer the real public-policy question, and catalog metadata does
  not prove live readiness or tradability.
- Every other entry is **research / unlaunched**. It has no assigned contract,
  price, liquidity, volume, participant count, price history, or trading
  status. A future launch requires independent legal, oracle, index, and
  deployment review.

## Candidate pairs

### `china-ai-chips-snvda` — AI policy × sNVDA

- **Question:** Will BIS make a general authorization available for qualifying
  Nvidia advanced AI-chip exports to China by 31 December 2026?
- **Underlying:** `sNVDA`, a synthetic USD-denominated Nvidia-exposure index;
  no NVIDIA security is held, wrapped, or delivered.
- **Resolution:** YES only for an effective BIS/Federal Register general
  authorization covering the defined exports without an individual
  case-by-case licence. Individual licences, proposed rules, company
  statements, and a case-by-case policy are not YES. The authoritative final
  text controls; unresolved legal mapping means no production settlement.
- **Sources:**
  - [Department of Commerce Revises License Review Policy for Semiconductors
    Exported to China](https://www.bis.gov/press-release/department-commerce-revises-license-review-policy-semiconductors-exported-china)
    — U.S. Department of Commerce, Bureau of Industry and Security; published
    2026-01-13; checked 2026-09-08.
  - [Department of Commerce Announces Rescission of Biden-Era Artificial
    Intelligence Diffusion Rule, Strengthens Chip-Related Export
    Controls](https://www.bis.gov/press-release/department-commerce-announces-rescission-biden-era-artificial-intelligence-diffusion-rule-strengthens)
    — U.S. Department of Commerce, Bureau of Industry and Security; published
    2025-05-13; checked 2026-09-08.

### `fomc-autumn-rate-cut-sgold` — monetary policy × sGOLD

- **Question:** Will the FOMC lower the federal-funds target range at either
  its 28 October or 9 December 2026 decision relative to the range in force
  immediately before the 27–28 October meeting?
- **Underlying:** `sGOLD`, a synthetic USD-denominated gold reference index;
  not bullion, an ETF, or a claim on metal.
- **Resolution:** YES if either named decision lowers both target-range bounds
  from the pre-October baseline. Administered-rate changes, projections, or
  wording alone do not qualify. The Federal Reserve statement and
  implementation note control; a delayed publication delays settlement.
- **Sources:**
  - [Federal Open Market Committee announces its tentative meeting schedule
    for 2025 and 2026](https://www.federalreserve.gov/newsevents/pressreleases/monetary20240809a.htm)
    — Board of Governors of the Federal Reserve System; published 2024-08-09;
    checked 2026-09-08.
  - [Meeting calendars and information](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
    — Board of Governors of the Federal Reserve System; checked 2026-09-08.

### `us-house-majority-2026-ssmallcap` — U.S. elections × sSMALLCAP

- **Question:** Will Democratic-affiliated Members hold at least 218 voting
  seats in the U.S. House at 12:00 p.m. Eastern Time on 3 January 2027?
- **Underlying:** `sSMALLCAP`, a synthetic USD-denominated U.S. small-cap
  reference index; it conveys no equity, fund, or voting ownership.
- **Resolution:** YES only if the Clerk's official roster identifies at least
  218 Democratic-affiliated full voting Members at 12:00 p.m. Eastern Time on
  3 January 2027. The Twentieth Amendment fixes the beginning of Members’
  terms at noon that day; a changed congressional meeting date does not change
  this membership snapshot. Delegates, the Resident Commissioner, vacancies,
  and projections do not count. If the official roster is incomplete,
  settlement waits for the Clerk record rather than substituting a projection.
- **Sources:**
  - [Election results and voting information](https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/)
    — Federal Election Commission; checked 2026-09-08. The FEC identifies
    3 November 2026 as the next regularly scheduled federal general-election
    date and notes that states certify results.
  - [U.S. Constitution — Twentieth Amendment](https://constitution.congress.gov/constitution/amendment-20/)
    — Constitution Annotated, Congress.gov, Library of Congress; checked
    2026-09-08.
  - [Member Profiles](https://clerk.house.gov/Members/) — Office of the Clerk,
    U.S. House of Representatives; checked 2026-09-08.

### `digital-asset-clarity-act-sbtc` — digital-asset policy × sBTC

- **Question:** Will H.R. 3633, the Digital Asset Market Clarity Act, become
  law before the end of the 119th Congress?
- **Underlying:** `sBTC`, a synthetic USD-denominated Bitcoin reference index;
  no bitcoin, fund share, custody claim, or redemption right is held.
- **Resolution:** YES only if Congress.gov records **Became Law** for the exact
  bill number H.R. 3633 by 12:00 p.m. Eastern Time on 3 January 2027. Similar
  bills, executive actions, and one-chamber passage do not count.
- **Source:** [H.R. 3633 — Digital Asset Market Clarity Act](https://www.congress.gov/bill/119th-congress/house-bill/3633)
  — Congress.gov, Library of Congress; published 2025-05-29; checked
  2026-09-08.

### `jitosol-etf-approval-ssol` — digital-asset ETF × sSOL

- **Question:** Will the SEC approve SR-NASDAQ-2026-016 to list and trade
  shares of the VanEck JitoSOL ETF by 31 December 2026?
- **Underlying:** `sSOL`, a synthetic USD-denominated Solana reference index;
  not SOL, JitoSOL, an ETF share, or a right to staking rewards.
- **Resolution:** YES only on an SEC order approving the exact Nasdaq file
  number. A notice, extension, proceeding, prospectus, exchange statement, or
  action on a different product does not count. SEC records control.
- **Sources:**
  - [Notice of Filing of Proposed Rule Change to List and Trade Shares of the
    VanEck JitoSOL ETF](https://www.sec.gov/rules-regulations/self-regulatory-organization-rulemaking/sr-nasdaq-2026-016)
    — U.S. Securities and Exchange Commission; published 2026-03-17; checked
    2026-09-08.
  - [Order Instituting Proceedings to Determine Whether to Approve or
    Disapprove a Proposed Rule Change to List and Trade Shares of the VanEck
    JitoSOL ETF](https://www.sec.gov/files/rules/sro/nasdaq/2026/34-105723.pdf)
    — U.S. Securities and Exchange Commission; published 2026-06-17; checked
    2026-09-08.

### `eia-december-brent-outlook-soil` — energy × sOIL

- **Question:** Will EIA’s December 2026 Short-Term Energy Outlook estimate
  the 2026 annual-average Brent spot price at $87 per barrel or more?
- **Underlying:** `sOIL`, a synthetic USD-denominated Brent-like energy
  reference index; not physical crude, a futures position, or a commodity
  interest.
- **Resolution:** YES only if the published December STEO data table gives an
  annual-average 2026 Brent crude oil spot-price value of at least $87.00/b.
  The threshold is the EIA’s August 2026 estimate, used as an event criterion,
  not a THELEMA quote or forecast. If EIA does not publish a December 2026
  STEO by 31 December, the event resolves NO.
- **Sources:**
  - [Short-Term Energy Outlook — August 2026](https://www.eia.gov/outlooks/steo/archives/aug26.pdf)
    — U.S. Energy Information Administration; published 2026-08-11; checked
    2026-09-08.
  - [Short-Term Energy Outlook — Release Schedule](https://www.eia.gov/outlooks/steo/release_schedule.php)
    — U.S. Energy Information Administration; checked 2026-09-08.

## Implementation notes

The catalog is deliberately pure static metadata with no SDK, environment
variables, credentials, API keys, or client-side Graph request. The Graph can
provide a separately labelled external reference for an eventually deployed
market, but it must never substitute for the official event-resolution source
or silently fill a missing value. See the catalog’s `resolutionRules` and
`oracleDescription` before mapping any card into a contract or UI action.
