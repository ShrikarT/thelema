/**
 * Research-only market metadata. This catalog deliberately contains no
 * probabilities, prices, liquidity, volume, participants, or price history.
 */

export const CATALOG_CHECKED_AT = '2026-09-08';

export const MARKET_CATEGORIES = Object.freeze([
  'AI policy',
  'Monetary policy',
  'US elections',
  'Digital-asset policy',
  'Digital-asset ETF',
  'Energy'
] as const);

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];
export type MarketArt = 'chip' | 'rates' | 'ballot' | 'crypto' | 'energy';
export type MarketStatus = 'demo' | 'research';
export type MarketAvailability = 'demo-oracle-only' | 'research-unlaunched';

export interface MarketSource {
  readonly title: string;
  readonly url: `https://${string}`;
  readonly publisher: string;
  readonly publishedAt?: string;
  readonly checkedAt: string;
}

export interface DemoOracleSchedule {
  readonly label: 'DEMO_ORACLE';
  readonly canonicalResolutionDate: string;
  readonly note: string;
}

/**
 * A candidate pair of a binary event and a synthetic index. `asset` always
 * describes an oracle-reported reference, never an asset held by the vault.
 */
export interface MarketDefinition {
  readonly id: string;
  readonly question: string;
  readonly shortTitle: string;
  readonly ticker: string;
  readonly asset: string;
  readonly category: MarketCategory;
  readonly description: string;
  readonly resolutionDate: string;
  readonly oracleDescription: string;
  readonly resolutionRules: readonly string[];
  readonly sources: readonly MarketSource[];
  readonly status: MarketStatus;
  readonly availability: MarketAvailability;
  readonly tradingNotice: string;
  readonly art: MarketArt;
  readonly demoOracleSchedule?: DemoOracleSchedule;
}

export const PRIMARY_MARKET_ID = 'china-ai-chips-snvda' as const;

export const MARKET_CATALOG: readonly MarketDefinition[] = Object.freeze([
  {
    id: PRIMARY_MARKET_ID,
    question: 'Will BIS make a general authorization available for qualifying Nvidia advanced AI-chip exports to China by 31 December 2026?',
    shortTitle: 'China AI-chip authorization',
    ticker: 'sNVDA',
    asset: 'sNVDA is a synthetic, USD-denominated Nvidia-exposure index reported by an oracle. No NVIDIA shares, options, or other securities are held, wrapped, or delivered.',
    category: 'AI policy',
    description: 'The canonical scenario asks about a broad public authorization, not an individual export licence or a case-by-case review policy. It measures the conditional settlement value of sNVDA in two policy worlds.',
    resolutionDate: '2026-12-31T23:59:59Z',
    oracleDescription: 'For a production candidate, use the final BIS or Federal Register publication named in the resolution rules and an independently reviewed index observation. The current demonstration instead uses an owner-controlled DEMO_ORACLE and is not a public-policy adjudication.',
    resolutionRules: [
      'YES — by 23:59:59 UTC on 31 December 2026, BIS or the Federal Register has published an effective rule, licence exception, or general licence that expressly authorizes qualifying Nvidia advanced-computing IC exports or reexports to eligible end users in the People’s Republic of China without an individual case-by-case BIS licence.',
      'A case-by-case licensing policy, an individual licence, a company announcement, an enforcement statement, or a proposed rule does not satisfy the YES condition.',
      'NO — no qualifying effective general authorization has been published by the deadline.',
      'The final BIS or Federal Register text controls; if a future deployment cannot map the text to this definition without legal review, the market must remain unlaunched rather than be settled by inference.'
    ],
    sources: [
      {
        title: 'Department of Commerce Revises License Review Policy for Semiconductors Exported to China',
        url: 'https://www.bis.gov/press-release/department-commerce-revises-license-review-policy-semiconductors-exported-china',
        publisher: 'U.S. Department of Commerce, Bureau of Industry and Security',
        publishedAt: '2026-01-13',
        checkedAt: CATALOG_CHECKED_AT
      },
      {
        title: 'Department of Commerce Announces Rescission of Biden-Era Artificial Intelligence Diffusion Rule, Strengthens Chip-Related Export Controls',
        url: 'https://www.bis.gov/press-release/department-commerce-announces-rescission-biden-era-artificial-intelligence-diffusion-rule-strengthens',
        publisher: 'U.S. Department of Commerce, Bureau of Industry and Security',
        publishedAt: '2025-05-13',
        checkedAt: CATALOG_CHECKED_AT
      }
    ],
    status: 'demo',
    availability: 'demo-oracle-only',
    tradingNotice: 'Demo candidate. Catalog metadata does not prove live readiness, current contract bindings, liquidity, price, or tradability; verify the active deployment snapshot before exposing a wallet action.',
    art: 'chip',
    demoOracleSchedule: {
      label: 'DEMO_ORACLE',
      canonicalResolutionDate: '2026-12-31T23:59:59Z',
      note: 'Read schedule from the verified contract snapshot (`deployments/demo-manifest.json`). The catalog does not cache the active event deadline, trading cutoff, or price-fix window; DEMO_ORACLE output does not resolve, predict, or replace the canonical 31 December 2026 BIS scenario.'
    }
  },
  {
    id: 'fomc-autumn-rate-cut-sgold',
    question: 'Will the FOMC lower the federal-funds target range at either its 28 October or 9 December 2026 decision relative to the range in force immediately before the 27–28 October meeting?',
    shortTitle: 'Autumn FOMC rate cut',
    ticker: 'sGOLD',
    asset: 'sGOLD is a synthetic, USD-denominated gold reference index reported by an oracle. It is not allocated bullion, an ETF, or a claim on physical metal.',
    category: 'Monetary policy',
    description: 'A monetary-policy candidate that compares conditional settlement values for a synthetic gold index, rather than trading a rate decision alone.',
    resolutionDate: '2026-12-09T23:59:59Z',
    oracleDescription: 'Use the Federal Reserve’s FOMC statement and implementation note as the event source. A future launch also needs a separately specified synthetic-index observation source and cutoff.',
    resolutionRules: [
      'YES — either the 28 October 2026 or 9 December 2026 FOMC statement and implementation note sets the target range’s upper and lower bounds below the bounds in force immediately before the 27–28 October meeting.',
      'A change to administered rates, balance-sheet policy, projections, or language without a lower target range does not satisfy the YES condition.',
      'NO — neither of those two decisions lowers the target range relative to the stated baseline.',
      'The Federal Reserve’s published statement and implementation note control; a delayed publication delays settlement rather than permitting a news summary to decide it.'
    ],
    sources: [
      {
        title: 'Federal Open Market Committee announces its tentative meeting schedule for 2025 and 2026',
        url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20240809a.htm',
        publisher: 'Board of Governors of the Federal Reserve System',
        publishedAt: '2024-08-09',
        checkedAt: CATALOG_CHECKED_AT
      },
      {
        title: 'Meeting calendars and information',
        url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
        publisher: 'Board of Governors of the Federal Reserve System',
        checkedAt: CATALOG_CHECKED_AT
      }
    ],
    status: 'research',
    availability: 'research-unlaunched',
    tradingNotice: 'Research candidate only — unlaunched, with no contract, liquidity, price, volume, participant, or historical-trading claim.',
    art: 'rates'
  },
  {
    id: 'us-house-majority-2026-ssmallcap',
    question: 'Will Democratic-affiliated Members hold at least 218 voting seats in the U.S. House at 12:00 p.m. Eastern Time on 3 January 2027?',
    shortTitle: '2026 House majority',
    ticker: 'sSMALLCAP',
    asset: 'sSMALLCAP is a synthetic, USD-denominated U.S. small-cap reference index reported by an oracle. It does not hold or convey ownership of equities, funds, or voting rights.',
    category: 'US elections',
    description: 'An election-impact research candidate pairing the 2026 federal general election with a synthetic small-cap index. It is not an election forecast, poll, or live market.',
    resolutionDate: '2027-01-03T17:00:00Z',
    oracleDescription: 'Use the Clerk of the U.S. House membership roster after state certification, not a projection desk, a social-media post, or a media call. A future launch must document its party-affiliation mapping before trading opens.',
    resolutionRules: [
      'YES — the first Clerk of the U.S. House roster published after 12:00 p.m. Eastern Time on 3 January 2027 identifies at least 218 seated Members with full voting rights as Democratic-affiliated at that timestamp.',
      'Only full voting House seats count. Delegates, the Resident Commissioner, vacant seats, and projected or uncertified results do not count.',
      'NO — the Clerk roster does not identify at least 218 such voting Members at that timestamp.',
      'If the official roster is incomplete or a party-affiliation classification is disputed, defer settlement until the Clerk record is complete; do not substitute a projection or caucus announcement.'
    ],
    sources: [
      {
        title: 'Election results and voting information',
        url: 'https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/',
        publisher: 'Federal Election Commission',
        checkedAt: CATALOG_CHECKED_AT
      },
      {
        title: 'U.S. Constitution — Twentieth Amendment',
        url: 'https://constitution.congress.gov/constitution/amendment-20/',
        publisher: 'Constitution Annotated, Congress.gov, Library of Congress',
        checkedAt: CATALOG_CHECKED_AT
      },
      {
        title: 'Member Profiles',
        url: 'https://clerk.house.gov/Members/',
        publisher: 'Office of the Clerk, U.S. House of Representatives',
        checkedAt: CATALOG_CHECKED_AT
      }
    ],
    status: 'research',
    availability: 'research-unlaunched',
    tradingNotice: 'Research candidate only — unlaunched, with no contract, liquidity, price, volume, participant, or historical-trading claim.',
    art: 'ballot'
  },
  {
    id: 'digital-asset-clarity-act-sbtc',
    question: 'Will H.R. 3633, the Digital Asset Market Clarity Act, become law before the end of the 119th Congress?',
    shortTitle: 'Digital Asset Market Clarity Act',
    ticker: 'sBTC',
    asset: 'sBTC is a synthetic, USD-denominated Bitcoin reference index reported by an oracle. No bitcoin, fund share, custody claim, or token redemption right is held in the market vault.',
    category: 'Digital-asset policy',
    description: 'A legislative-impact research candidate tied to the exact bill identifier H.R. 3633 and a synthetic Bitcoin index. It does not treat materially similar legislation as the same event.',
    resolutionDate: '2027-01-03T17:00:00Z',
    oracleDescription: 'Use Congress.gov’s action history for the exact bill identifier. A production candidate needs a separately defined synthetic-index observation source, settlement cutoff, and legal review of the legislative record.',
    resolutionRules: [
      'YES — Congress.gov records the status “Became Law” for H.R. 3633 on or before 12:00 p.m. Eastern Time on 3 January 2027.',
      'A different bill, executive action, committee action, passage by only one chamber, or a substantively similar law does not satisfy the YES condition.',
      'NO — Congress.gov does not record H.R. 3633 as “Became Law” by the deadline.',
      'Congress.gov’s action history for H.R. 3633 controls; if its record is unavailable, settlement waits for the official record rather than relying on a news report.'
    ],
    sources: [
      {
        title: 'H.R. 3633 — Digital Asset Market Clarity Act',
        url: 'https://www.congress.gov/bill/119th-congress/house-bill/3633',
        publisher: 'Congress.gov, Library of Congress',
        publishedAt: '2025-05-29',
        checkedAt: CATALOG_CHECKED_AT
      }
    ],
    status: 'research',
    availability: 'research-unlaunched',
    tradingNotice: 'Research candidate only — unlaunched, with no contract, liquidity, price, volume, participant, or historical-trading claim.',
    art: 'crypto'
  },
  {
    id: 'jitosol-etf-approval-ssol',
    question: 'Will the SEC approve SR-NASDAQ-2026-016 to list and trade shares of the VanEck JitoSOL ETF by 31 December 2026?',
    shortTitle: 'JitoSOL ETF rule change',
    ticker: 'sSOL',
    asset: 'sSOL is a synthetic, USD-denominated Solana reference index reported by an oracle. It is not SOL, JitoSOL, an ETF share, or a right to staking rewards.',
    category: 'Digital-asset ETF',
    description: 'An ETF-rulemaking research candidate keyed to a specific SEC file number. The proposal and its review process are source context, not evidence of a live or investable product.',
    resolutionDate: '2026-12-31T23:59:59Z',
    oracleDescription: 'Use an SEC order for the exact file number SR-NASDAQ-2026-016. A future launch needs a separately specified synthetic-index observation and must not infer an outcome from a prospectus, comment period, or press coverage.',
    resolutionRules: [
      'YES — by 23:59:59 UTC on 31 December 2026, the SEC publishes an order approving the proposed Nasdaq rule change with file number SR-NASDAQ-2026-016.',
      'A filing notice, extension, order instituting proceedings, prospectus filing, exchange announcement, or approval of a different product does not satisfy the YES condition.',
      'NO — the SEC has not published an approval order for that exact file number by the deadline.',
      'The SEC’s order page and issued order control; if a court or agency action makes the record ambiguous, keep the candidate unlaunched until the exact disposition can be verified.'
    ],
    sources: [
      {
        title: 'Notice of Filing of Proposed Rule Change to List and Trade Shares of the VanEck JitoSOL ETF under Nasdaq Rule 5711(d) (Commodity-Based Trust Shares)',
        url: 'https://www.sec.gov/rules-regulations/self-regulatory-organization-rulemaking/sr-nasdaq-2026-016',
        publisher: 'U.S. Securities and Exchange Commission',
        publishedAt: '2026-03-17',
        checkedAt: CATALOG_CHECKED_AT
      },
      {
        title: 'Order Instituting Proceedings to Determine Whether to Approve or Disapprove a Proposed Rule Change to List and Trade Shares of the VanEck JitoSOL ETF',
        url: 'https://www.sec.gov/files/rules/sro/nasdaq/2026/34-105723.pdf',
        publisher: 'U.S. Securities and Exchange Commission',
        publishedAt: '2026-06-17',
        checkedAt: CATALOG_CHECKED_AT
      }
    ],
    status: 'research',
    availability: 'research-unlaunched',
    tradingNotice: 'Research candidate only — unlaunched, with no contract, liquidity, price, volume, participant, or historical-trading claim.',
    art: 'crypto'
  },
  {
    id: 'eia-december-brent-outlook-soil',
    question: 'Will EIA’s December 2026 Short-Term Energy Outlook estimate the 2026 annual-average Brent spot price at $87 per barrel or more?',
    shortTitle: 'December Brent outlook',
    ticker: 'sOIL',
    asset: 'sOIL is a synthetic, USD-denominated Brent-like energy reference index reported by an oracle. It is not physical crude, a futures position, or a commodity interest.',
    category: 'Energy',
    description: 'An energy-outlook research candidate. The $87 threshold is the EIA’s August 2026 annual-average Brent estimate used as a transparent event criterion, not a THELEMA market price or forecast.',
    resolutionDate: '2026-12-31T23:59:59Z',
    oracleDescription: 'Use EIA’s December 2026 STEO table for the event and a separately specified synthetic energy-index observation for the asset leg. No live price feed is asserted by this catalog.',
    resolutionRules: [
      'YES — EIA’s December 2026 Short-Term Energy Outlook reports an annual-average 2026 “Brent crude oil spot price” of at least $87.00 per barrel in its published data table.',
      'Use EIA’s published table value rather than a rounded media summary, an intraday Brent quote, or a forecast from another institution.',
      'NO — the December 2026 STEO reports a value below $87.00 per barrel, or EIA does not publish a December 2026 STEO by 23:59:59 UTC on 31 December 2026.',
      'The relevant EIA release controls; corrections published by EIA before settlement supersede the earlier table.'
    ],
    sources: [
      {
        title: 'Short-Term Energy Outlook — August 2026',
        url: 'https://www.eia.gov/outlooks/steo/archives/aug26.pdf',
        publisher: 'U.S. Energy Information Administration',
        publishedAt: '2026-08-11',
        checkedAt: CATALOG_CHECKED_AT
      },
      {
        title: 'Short-Term Energy Outlook — Release Schedule',
        url: 'https://www.eia.gov/outlooks/steo/release_schedule.php',
        publisher: 'U.S. Energy Information Administration',
        checkedAt: CATALOG_CHECKED_AT
      }
    ],
    status: 'research',
    availability: 'research-unlaunched',
    tradingNotice: 'Research candidate only — unlaunched, with no contract, liquidity, price, volume, participant, or historical-trading claim.',
    art: 'energy'
  }
] as const satisfies readonly MarketDefinition[]);

export function findMarket(id: string): MarketDefinition | undefined {
  return MARKET_CATALOG.find((market) => market.id === id);
}
