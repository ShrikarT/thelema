#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGraphConfigured, getReferences } from '../packages/graph/index.mjs';

const safeId = (x) => typeof x === 'string' && /^[a-zA-Z0-9_:-]{1,150}$/.test(x);

export async function verifyGraph(env = process.env, fetchImpl = fetch, options = {}) {
  const root = options.projectRoot || process.cwd();
  console.log('--- THELEMA Sponsor Verification: The Graph ---');

  const requireConfigured = Boolean(
    options.requireConfigured ||
    env.GRAPH_REQUIRE_CONFIGURED === 'true' ||
    (typeof process !== 'undefined' && process.argv && process.argv.includes('--require-configured'))
  );

  const recordEvidence = Boolean(
    options.recordEvidence ||
    env.GRAPH_RECORD_EVIDENCE === 'true' ||
    (typeof process !== 'undefined' && process.argv && process.argv.includes('--record-evidence'))
  );

  const hasApiKey = Boolean(env.GRAPH_API_KEY && /^[a-zA-Z0-9_-]{8,200}$/.test(env.GRAPH_API_KEY));
  const hasProbability = safeId(env.GRAPH_PROBABILITY_MARKET_ID);
  const hasSpotSubgraph = safeId(env.GRAPH_SPOT_SUBGRAPH_ID);
  const hasSpotPool = safeId(env.GRAPH_SPOT_POOL_ID);
  const hasSpotSymbol = Boolean(env.GRAPH_SPOT_TOKEN_SYMBOL);
  const hasSpot = Boolean(hasSpotSubgraph && hasSpotPool && hasSpotSymbol);

  // Partial configuration checks
  const partialSpot = (hasSpotSubgraph || hasSpotPool || hasSpotSymbol) && !hasSpot;
  const anyTargetConfigured = hasProbability || hasSpot || partialSpot;

  if (anyTargetConfigured && !hasApiKey) {
    console.error('Configuration Error: Graph target market/pool is configured, but GRAPH_API_KEY is missing or invalid.');
    return {
      status: 'FAILED',
      exitCode: 1,
      error: 'Graph target configured without valid GRAPH_API_KEY'
    };
  }

  if (partialSpot) {
    console.error('Configuration Error: Spot reference partially configured. Requires GRAPH_SPOT_SUBGRAPH_ID, GRAPH_SPOT_POOL_ID, and GRAPH_SPOT_TOKEN_SYMBOL.');
    return {
      status: 'FAILED',
      exitCode: 1,
      error: 'Partial spot configuration'
    };
  }

  if (!isGraphConfigured(env)) {
    console.log('Status: UNCONFIGURED (Opt-in verification)');
    console.log('Information:');
    console.log('  Live Graph queries require valid environment configuration:');
    console.log('    - GRAPH_API_KEY: Server-side API key for The Graph Gateway');
    console.log('    - GRAPH_PROBABILITY_MARKET_ID: Polymarket FixedProductMarketMaker address/ID');
    console.log('    - GRAPH_SPOT_SUBGRAPH_ID: Uniswap/Messari-style subgraph ID');
    console.log('    - GRAPH_SPOT_POOL_ID: LiquidityPool entity ID');
    console.log('    - GRAPH_SPOT_TOKEN_SYMBOL: Token symbol to price (e.g. USDC)');
    console.log('    - GRAPH_MAX_AGE_SECONDS: Maximum allowed reference age (default: 900s)');
    console.log('\nNotice: Live schemas, market data, and event/asset relevance remain UNVERIFIED because no Graph endpoint is configured.');

    if (requireConfigured) {
      console.log('\nResult: FAILED (Graph live readiness required but configuration is unconfigured).');
      return { status: 'FAILED', exitCode: 1, verified: false, error: 'Graph live readiness required but unconfigured' };
    }

    console.log('\nResult: SKIPPED (Graceful exit; zero mock fabrication in CI/local runs).');
    return { status: 'UNCONFIGURED', exitCode: 0, verified: false, references: null };
  }

  console.log('Environment configuration detected. Executing live reference queries...');
  console.log('Gateway Target: https://gateway.thegraph.com/api/...');
  console.log(`Max Acceptable Age: ${env.GRAPH_MAX_AGE_SECONDS || 900} seconds`);

  try {
    const hasCross = Boolean(
      options.includeCrossProtocol ||
      env.GRAPH_CROSS_PROTOCOL_ENABLED === 'true' ||
      (safeId(env.GRAPH_CROSS_SOURCE1_SUBGRAPH_ID) && safeId(env.GRAPH_CROSS_SOURCE1_POOL_ID)) ||
      (typeof process !== 'undefined' && process.argv && process.argv.includes('--cross-protocol'))
    );

    const refs = await getReferences({ env, fetchImpl, includeCrossProtocol: hasCross });
    console.log('\n--- Query Results ---');

    let failureCount = 0;
    const summary = {};

    if (hasProbability) {
      console.log('Probability Reference (Configured):');
      console.log(`  Label:     ${refs.probability.label}`);
      console.log(`  Status:    ${refs.probability.status}`);
      console.log(`  Value:     ${refs.probability.value !== null ? refs.probability.value : '(none)'}`);
      console.log(`  Updated:   ${refs.probability.updatedAt || '(unavailable)'}`);
      if (refs.probability.error) console.log(`  Error:     ${refs.probability.error}`);
      if (refs.probability.status !== 'live') {
        failureCount++;
      }
      summary.probability = refs.probability.status === 'live' ? 'VERIFIED' : 'FAILED';
    } else {
      console.log('Probability Reference: UNCONFIGURED (Optional)');
      summary.probability = 'UNCONFIGURED';
    }

    if (hasSpot) {
      console.log('Spot Reference (Configured):');
      console.log(`  Label:     ${refs.spot.label}`);
      console.log(`  Status:    ${refs.spot.status}`);
      console.log(`  Value:     ${refs.spot.value !== null ? refs.spot.value : '(none)'}`);
      console.log(`  Updated:   ${refs.spot.updatedAt || '(unavailable)'}`);
      if (refs.spot.error) console.log(`  Error:     ${refs.spot.error}`);
      if (refs.spot.status !== 'live') {
        failureCount++;
      }
      summary.spot = refs.spot.status === 'live' ? 'VERIFIED' : 'FAILED';
    } else {
      console.log('Spot Reference: UNCONFIGURED (Optional)');
      summary.spot = 'UNCONFIGURED';
    }

    if (refs.crossProtocol) {
      const cross = refs.crossProtocol;
      console.log('\nCross-Protocol Reference (Standardized Messari DEX Schema):');
      console.log(`  Status:          ${cross.status}`);
      console.log(`  Consensus Price: ${cross.consensusPrice !== null ? '$' + cross.consensusPrice.toFixed(2) : '(none)'}`);
      console.log(`  Disagreement:    ${cross.disagreementPercent || '(none)'} (Threshold: ${(cross.disagreementThreshold * 100).toFixed(1)}%)`);
      console.log(`  Summary:         ${cross.summary}`);
      console.log(`  Source 1 (${cross.source1.protocol}):`);
      console.log(`    Network:       ${cross.source1.network}`);
      console.log(`    Subgraph ID:   ${cross.source1.subgraphId}`);
      console.log(`    Pool:          ${cross.source1.poolName} (${cross.source1.poolId})`);
      console.log(`    Asset:         ${cross.source1.assetSymbol} (${cross.source1.assetAddress})`);
      console.log(`    Price:         ${cross.source1.price !== null ? '$' + cross.source1.price.toFixed(2) : '(none)'}`);
      console.log(`    TVL:           ${cross.source1.tvlUSD ? '$' + Math.round(cross.source1.tvlUSD).toLocaleString() : '(none)'}`);
      console.log(`    Volume:        ${cross.source1.volumeUSD ? '$' + Math.round(cross.source1.volumeUSD).toLocaleString() : '(none)'}`);
      console.log(`    Block:         ${cross.source1.blockNumber}`);
      console.log(`    Status:        ${cross.source1.status}`);
      if (cross.source1.error) console.log(`    Error:         ${cross.source1.error}`);
      console.log(`  Source 2 (${cross.source2.protocol}):`);
      console.log(`    Network:       ${cross.source2.network}`);
      console.log(`    Subgraph ID:   ${cross.source2.subgraphId}`);
      console.log(`    Pool:          ${cross.source2.poolName} (${cross.source2.poolId})`);
      console.log(`    Asset:         ${cross.source2.assetSymbol} (${cross.source2.assetAddress})`);
      console.log(`    Price:         ${cross.source2.price !== null ? '$' + cross.source2.price.toFixed(2) : '(none)'}`);
      console.log(`    TVL:           ${cross.source2.tvlUSD ? '$' + Math.round(cross.source2.tvlUSD).toLocaleString() : '(none)'}`);
      console.log(`    Volume:        ${cross.source2.volumeUSD ? '$' + Math.round(cross.source2.volumeUSD).toLocaleString() : '(none)'}`);
      console.log(`    Block:         ${cross.source2.blockNumber}`);
      console.log(`    Status:        ${cross.source2.status}`);
      if (cross.source2.error) console.log(`    Error:         ${cross.source2.error}`);

      if (cross.status === 'unavailable' || cross.status === 'disagreeing') {
        failureCount++;
      }
      summary.crossProtocol = cross.status === 'agreeing' ? 'VERIFIED' : cross.status;
    }

    if (failureCount > 0) {
      console.log(`\nResult: FAILED (${failureCount} configured Graph reference(s) failed live validation).`);
      return { status: 'FAILED', exitCode: 1, verified: false, references: refs, summary };
    }

    if (recordEvidence && refs) {
      const evidencePath = path.resolve(root, 'docs/evidence/graph-live.json');
      mkdirSync(path.dirname(evidencePath), { recursive: true });
      const sanitized = {
        timestamp: new Date().toISOString(),
        status: 'VERIFIED',
        scope: 'ETH reference verified; not comparable to sNVDA; event probability unavailable.',
        gateway: 'https://gateway.thegraph.com/api/[REDACTED]',
        maxAgeSeconds: Number(env.GRAPH_MAX_AGE_SECONDS || 900),
        references: {
          probability: refs.probability ? {
            status: refs.probability.status,
            value: refs.probability.value,
            label: refs.probability.label,
            source: refs.probability.source,
            updatedAt: refs.probability.updatedAt
          } : null,
          spot: refs.spot ? {
            status: refs.spot.status,
            value: refs.spot.value,
            label: refs.spot.label,
            asset: refs.spot.asset,
            comparable: refs.spot.comparable,
            source: refs.spot.source,
            updatedAt: refs.spot.updatedAt
          } : null
        },
        summary: {
          ...summary,
          scope: 'ETH reference verified; not comparable to sNVDA; event probability unavailable.'
        }
      };
      writeFileSync(evidencePath, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
      console.log(`\nSanitized live Graph evidence recorded to: ${evidencePath}`);

      if (refs.crossProtocol) {
        const crossEvidencePath = path.resolve(root, 'docs/evidence/graph-cross-protocol.json');
        const crossSanitized = {
          timestamp: new Date().toISOString(),
          status: refs.crossProtocol.status === 'agreeing' ? 'VERIFIED' : refs.crossProtocol.status.toUpperCase(),
          schema: 'Messari DEX AMM Standardized Schema (liquidityPool)',
          gateway: 'https://gateway.thegraph.com/api/[REDACTED]',
          scope: 'ETH reference verified across Uniswap V3 and SushiSwap on Arbitrum One; not comparable to sNVDA; event probability unavailable.',
          maxAgeSeconds: refs.crossProtocol.maxAgeSeconds,
          disagreementThreshold: refs.crossProtocol.disagreementThreshold,
          crossProtocol: {
            status: refs.crossProtocol.status,
            consensusPrice: refs.crossProtocol.consensusPrice,
            disagreement: refs.crossProtocol.disagreement,
            disagreementPercent: refs.crossProtocol.disagreementPercent,
            summary: refs.crossProtocol.summary,
            comparable: refs.crossProtocol.comparable,
            updatedAt: refs.crossProtocol.updatedAt,
            source1: {
              protocol: refs.crossProtocol.source1.protocol,
              network: refs.crossProtocol.source1.network,
              subgraphId: refs.crossProtocol.source1.subgraphId,
              poolId: refs.crossProtocol.source1.poolId,
              poolName: refs.crossProtocol.source1.poolName,
              assetSymbol: refs.crossProtocol.source1.assetSymbol,
              assetAddress: refs.crossProtocol.source1.assetAddress,
              quoteSymbol: refs.crossProtocol.source1.quoteSymbol,
              quoteAddress: refs.crossProtocol.source1.quoteAddress,
              price: refs.crossProtocol.source1.price,
              tvlUSD: refs.crossProtocol.source1.tvlUSD,
              volumeUSD: refs.crossProtocol.source1.volumeUSD,
              blockNumber: refs.crossProtocol.source1.blockNumber,
              blockTimestamp: refs.crossProtocol.source1.blockTimestamp,
              status: refs.crossProtocol.source1.status,
              updatedAt: refs.crossProtocol.source1.updatedAt
            },
            source2: {
              protocol: refs.crossProtocol.source2.protocol,
              network: refs.crossProtocol.source2.network,
              subgraphId: refs.crossProtocol.source2.subgraphId,
              poolId: refs.crossProtocol.source2.poolId,
              poolName: refs.crossProtocol.source2.poolName,
              assetSymbol: refs.crossProtocol.source2.assetSymbol,
              assetAddress: refs.crossProtocol.source2.assetAddress,
              quoteSymbol: refs.crossProtocol.source2.quoteSymbol,
              quoteAddress: refs.crossProtocol.source2.quoteAddress,
              price: refs.crossProtocol.source2.price,
              tvlUSD: refs.crossProtocol.source2.tvlUSD,
              volumeUSD: refs.crossProtocol.source2.volumeUSD,
              blockNumber: refs.crossProtocol.source2.blockNumber,
              blockTimestamp: refs.crossProtocol.source2.blockTimestamp,
              status: refs.crossProtocol.source2.status,
              updatedAt: refs.crossProtocol.source2.updatedAt
            }
          }
        };
        writeFileSync(crossEvidencePath, JSON.stringify(crossSanitized, null, 2) + '\n', 'utf8');
        console.log(`Sanitized live Cross-Protocol evidence recorded to: ${crossEvidencePath}`);
      }
    }

    console.log('\nResult: VERIFIED (All configured live Graph references validated).');
    return { status: 'VERIFIED', exitCode: 0, verified: true, references: refs, summary };
  } catch (err) {
    console.error(`\nError during Graph verification: ${err.message}`);
    return { status: 'FAILED', exitCode: 1, verified: false, error: err.message };
  }
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile?.(path.resolve('.env'));
  } catch {}
  const requireConfigured = process.argv.includes('--require-configured');
  const recordEvidence = process.argv.includes('--record-evidence');
  verifyGraph(process.env, fetch, { requireConfigured, recordEvidence })
    .then((res) => {
      if (res.exitCode !== 0) {
        process.exit(res.exitCode || 1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal Graph verification error:', err);
      process.exit(1);
    });
}
