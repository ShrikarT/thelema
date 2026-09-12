import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_CHECKED_AT,
  MARKET_CATALOG,
  MARKET_CATEGORIES,
  PRIMARY_MARKET_ID,
  findMarket
} from '../packages/markets/catalog.ts';

const checkedAt = new Date(`${CATALOG_CHECKED_AT}T00:00:00Z`);
const prohibitedTradingFields = new Set([
  'probability',
  'yesPrice',
  'noPrice',
  'price',
  'volume',
  'liquidity',
  'participants',
  'openInterest',
  'priceHistory'
]);

test('catalog market identifiers are unique, stable slugs', () => {
  const ids = MARKET_CATALOG.map((market) => market.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('catalog categories cover every market without untyped category labels', () => {
  for (const market of MARKET_CATALOG) {
    assert.ok(MARKET_CATEGORIES.includes(market.category));
  }
});

test('every source is safe HTTPS provenance with a checked date', () => {
  for (const market of MARKET_CATALOG) {
    assert.ok(market.sources.length > 0, `${market.id} needs a source`);
    for (const source of market.sources) {
      const url = new URL(source.url);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username, '');
      assert.equal(url.password, '');
      assert.ok(source.title.trim(), `${market.id} source needs a title`);
      assert.ok(source.publisher.trim(), `${market.id} source needs a publisher`);
      assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number.isFinite(new Date(`${source.checkedAt}T00:00:00Z`).valueOf()));
      if (source.publishedAt) {
        assert.match(source.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(Number.isFinite(new Date(`${source.publishedAt}T00:00:00Z`).valueOf()));
      }
    }
  }
});

test('only the primary market is a demo candidate; research cards remain unlaunched', () => {
  const primary = findMarket(PRIMARY_MARKET_ID);
  assert.ok(primary);
  assert.equal(primary.id, 'china-ai-chips-snvda');
  assert.equal(primary.ticker, 'sNVDA');
  assert.equal(primary.status, 'demo');
  assert.equal(primary.availability, 'demo-oracle-only');
  assert.match(primary.tradingNotice, /does not prove live readiness/i);
  assert.ok(primary.demoOracleSchedule);
  assert.equal(primary.demoOracleSchedule.label, 'DEMO_ORACLE');
  assert.equal(primary.demoOracleSchedule.canonicalResolutionDate, primary.resolutionDate);
  assert.deepEqual(Object.keys(primary.demoOracleSchedule).sort(), ['canonicalResolutionDate', 'label', 'note']);
  assert.match(primary.demoOracleSchedule.note, /read schedule from the verified contract snapshot/i);

  assert.deepEqual(
    MARKET_CATALOG.filter((market) => market.status === 'demo').map((market) => market.id),
    [PRIMARY_MARKET_ID]
  );
  for (const market of MARKET_CATALOG.filter((market) => market.id !== PRIMARY_MARKET_ID)) {
    assert.equal(market.status, 'research');
    assert.equal(market.availability, 'research-unlaunched');
    assert.equal(market.demoOracleSchedule, undefined);
    assert.match(market.tradingNotice, /unlaunched/i);
  }
});

test('catalog questions have future dates, synthetic assets, and explicit binary criteria', () => {
  for (const market of MARKET_CATALOG) {
    assert.ok(new Date(market.resolutionDate) > checkedAt, `${market.id} must resolve after catalog check`);
    assert.match(market.asset, /synthetic/i, `${market.id} must define a synthetic index`);
    assert.ok(market.resolutionRules.length >= 3, `${market.id} needs clear resolution rules`);
    assert.ok(market.resolutionRules.some((rule) => rule.startsWith('YES —')), `${market.id} needs YES criteria`);
    assert.ok(market.resolutionRules.some((rule) => rule.startsWith('NO —')), `${market.id} needs NO criteria`);
  }
});

test('catalog metadata does not invent trading statistics', () => {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!prohibitedTradingFields.has(key), `catalog must not expose invented ${key}`);
      visit(child);
    }
  };

  visit(MARKET_CATALOG);
  assert.equal(findMarket('unknown-market'), undefined);
});
