import { describe, expect, it } from 'vitest';
import { parseCloseWindow, parseDuration, loadConfig, NEWS_TOPICS } from '../src/config.js';
import { Prng, hashSeed } from '../src/prng.js';
import type { Headline } from '../src/news.js';
import { rotateByTopic } from '../src/news.js';
import {
  buildMarket,
  classifyCategory,
  extractSubject,
  markerLine,
  randomMarketType,
  templatePool,
} from '../src/templating.js';
import { creatorHandleFor, imageForCategory, randomSeedSplit, MarketsApiClient } from '../src/api.js';

const WINDOW = parseCloseWindow('1d-30d');
const NOW = new Date('2026-06-12T00:00:00Z');

function headline(overrides: Partial<Headline> = {}): Headline {
  return {
    title: 'Microsoft raises annual dividend as cloud revenue beats forecasts',
    link: 'https://news.example.com/business/microsoft-dividend-cloud',
    pubDate: 'Wed, 10 Jun 2026 13:30:00 GMT',
    source: 'CNBC',
    topic: 'BUSINESS',
    ...overrides,
  };
}

describe('subject extraction', () => {
  it('cuts at " as "', () => {
    expect(extractSubject('Microsoft raises annual dividend as cloud revenue beats forecasts')).toBe(
      'Microsoft',
    );
  });

  it('cuts at the first lowercase verb-ish token', () => {
    expect(extractSubject('Tesla breaks ground on battery recycling plant in Nevada')).toBe('Tesla');
    expect(extractSubject('European Union unveils sweeping reform of cross-border energy grid rules')).toBe(
      'European Union',
    );
  });

  it('cuts at punctuation delimiters', () => {
    expect(extractSubject('Real Madrid: Copa final preview')).toBe('Real Madrid');
    expect(extractSubject('Real Madrid — Copa final preview')).toBe('Real Madrid');
    expect(extractSubject('Real Madrid, Barcelona renew rivalry')).toBe('Real Madrid');
    expect(extractSubject('Lakers; playoff hopes alive')).toBe('Lakers');
  });

  it('keeps multi-word proper-noun subjects intact', () => {
    expect(extractSubject("NASA's Artemis crew completes final dress rehearsal for lunar landing")).toBe(
      "NASA's Artemis crew",
    );
  });

  it('caps the subject at 80 chars', () => {
    const long = 'A'.repeat(50) + ' ' + 'B'.repeat(50);
    const subject = extractSubject(long);
    expect(subject.length).toBeLessThanOrEqual(80);
  });
});

describe('classification and template pools', () => {
  it('maps the seven topics to categories and TOP to generic', () => {
    expect(classifyCategory('SPORTS')).toBe('sports');
    expect(classifyCategory('BUSINESS')).toBe('business');
    expect(classifyCategory('TOP')).toBe('generic');
  });

  it('every category pool has at least 2 generic + 2 category templates', () => {
    expect(templatePool('generic').length).toBeGreaterThanOrEqual(2);
    for (const topic of NEWS_TOPICS) {
      const category = classifyCategory(topic);
      expect(templatePool(category).length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('market generation', () => {
  it('question never exceeds 120 chars, even for very long subjects', () => {
    const prng = new Prng('len-test');
    for (let i = 0; i < 50; i++) {
      const h = headline({
        title:
          'The Extraordinarily Long-Named International Consortium For Advanced Renewable Megaprojects And Infrastructure Finance Holdings announces plans',
        topic: 'BUSINESS',
      });
      const market = buildMarket(h, prng, WINDOW, NOW);
      expect(market.question.length).toBeLessThanOrEqual(120);
    }
  });

  it('description starts with the exact Section 4.1 marker line and includes link + template name', () => {
    const h = headline();
    const market = buildMarket(h, new Prng('marker'), WINDOW, NOW);
    const expectedMarker =
      '⚠ Auto-generated test market — resolves randomly. Source headline: ' +
      '"Microsoft raises annual dividend as cloud revenue beats forecasts" (CNBC, Wed, 10 Jun 2026 13:30:00 GMT)';
    expect(markerLine(h)).toBe(expectedMarker);
    const lines = market.description.split('\n');
    expect(lines[0]).toBe(expectedMarker);
    expect(lines[1]).toBe(h.link);
    expect(lines[2]).toBe(`Template: ${market.templateName}`);
  });

  it('oracleProofUrl is the article link', () => {
    const market = buildMarket(headline(), new Prng('proof'), WINDOW, NOW);
    expect(market.oracleProofUrl).toBe('https://news.example.com/business/microsoft-dividend-cloud');
  });

  it('closeTime falls inside the configured window', () => {
    const prng = new Prng('window');
    for (let i = 0; i < 100; i++) {
      const market = buildMarket(headline(), prng, WINDOW, NOW);
      const offsetH = (market.closeTime.getTime() - NOW.getTime()) / 3_600_000;
      expect(offsetH).toBeGreaterThanOrEqual(24);
      expect(offsetH).toBeLessThanOrEqual(720);
    }
  });

  it('marketType distribution is roughly FUN 70 / CLASSIC 20 / CHALLENGE 10', () => {
    const prng = new Prng('dist');
    const counts = { FUN: 0, CLASSIC: 0, CHALLENGE: 0 };
    const total = 5000;
    for (let i = 0; i < total; i++) counts[randomMarketType(prng)]++;
    expect(counts.FUN / total).toBeGreaterThan(0.65);
    expect(counts.FUN / total).toBeLessThan(0.75);
    expect(counts.CLASSIC / total).toBeGreaterThan(0.16);
    expect(counts.CLASSIC / total).toBeLessThan(0.24);
    expect(counts.CHALLENGE / total).toBeGreaterThan(0.07);
    expect(counts.CHALLENGE / total).toBeLessThan(0.13);
  });

  it('is deterministic: same seed → same questions', () => {
    const headlines: Headline[] = [
      headline(),
      headline({ title: 'Lakers clinch playoff berth with buzzer-beater against Suns', topic: 'SPORTS' }),
      headline({ title: 'CERN physicists report strongest evidence yet of rare Higgs decay', topic: 'SCIENCE' }),
    ];
    const run = (seed: string): string[] => {
      const prng = new Prng(seed);
      return headlines.map((h) => {
        const m = buildMarket(h, prng, WINDOW, NOW);
        return `${m.question}|${m.marketType}|${m.closeTime.toISOString()}`;
      });
    };
    expect(run('seed-a')).toEqual(run('seed-a'));
    expect(run('seed-a')).not.toEqual(run('seed-b'));
  });
});

describe('prng', () => {
  it('hashSeed is stable for the same string', () => {
    expect(hashSeed('justify')).toBe(hashSeed('justify'));
    expect(hashSeed('justify')).not.toBe(hashSeed('justify2'));
  });

  it('int stays within inclusive bounds', () => {
    const prng = new Prng('bounds');
    for (let i = 0; i < 1000; i++) {
      const v = prng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe('api mapping helpers', () => {
  it('routes creator handles by category', () => {
    expect(creatorHandleFor('sports')).toBe('bot-sports');
    expect(creatorHandleFor('business')).toBe('bot-business');
    expect(creatorHandleFor('technology')).toBe('bot-business');
    expect(creatorHandleFor('world')).toBe('bot-news');
    expect(creatorHandleFor('generic')).toBe('bot-news');
  });

  it('maps categories to bundled images with a fallback', () => {
    expect(imageForCategory('sports')).toBe('/img/el-classico.png');
    expect(imageForCategory('crypto')).toBe('/img/ETHfullsize.webp');
    expect(imageForCategory('science')).toBe('/img/trend1.jpg');
  });

  it('seed split totals 1000 within 20/80..80/20', () => {
    const prng = new Prng('split');
    for (let i = 0; i < 500; i++) {
      const { seedYesUsdc, seedNoUsdc } = randomSeedSplit(prng);
      expect(seedYesUsdc + seedNoUsdc).toBe(1000);
      expect(seedYesUsdc).toBeGreaterThanOrEqual(200);
      expect(seedYesUsdc).toBeLessThanOrEqual(800);
    }
  });

  it('buildCreateBody produces the frozen POST /api/markets shape', () => {
    const client = new MarketsApiClient('http://localhost:3000', 'dev-generator-key');
    const market = buildMarket(headline(), new Prng('body'), WINDOW, NOW);
    const body = client.buildCreateBody(market, new Prng('body-split'));
    expect(body.question).toBe(market.question);
    expect(body.category).toBe('business');
    expect(body.creatorHandle).toBe('bot-business');
    expect(body.createPost).toBe(true);
    expect(body.oracleProofUrl).toBe(market.oracleProofUrl);
    expect(body.seedYesUsdc + body.seedNoUsdc).toBe(1000);
    expect(['FUN', 'CLASSIC', 'CHALLENGE']).toContain(body.marketType);
    expect(new Date(body.closeTime).getTime()).toBe(market.closeTime.getTime());
  });
});

describe('config parsing', () => {
  it('parses CLOSE_WINDOW with h/d units', () => {
    expect(parseCloseWindow('1d-30d')).toEqual({ minHours: 24, maxHours: 720 });
    expect(parseCloseWindow('2h-48h')).toEqual({ minHours: 2, maxHours: 48 });
    expect(() => parseCloseWindow('30d-1d')).toThrow();
    expect(() => parseCloseWindow('bogus')).toThrow();
  });

  it('parses POLL_INTERVAL durations', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(() => parseDuration('15x')).toThrow();
  });

  it('applies documented defaults and derives a seed when unset', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.newsSource).toBe('fixture');
    expect(config.apiBaseUrl).toBe('http://localhost:3000');
    expect(config.apiKey).toBe('dev-generator-key');
    expect(config.marketsPerHour).toBe(12);
    expect(config.maxLiveMarkets).toBe(100);
    expect(config.closeWindow).toEqual({ minHours: 24, maxHours: 720 });
    expect(config.topics).toEqual([...NEWS_TOPICS]);
    expect(config.pollIntervalMs).toBe(900_000);
    expect(config.resolveYesBias).toBe(0.5);
    expect(config.seedWasDerived).toBe(true);
    expect(config.seed.length).toBeGreaterThan(0);
    expect(config.enabled).toBe(false);
    expect(config.extraAllowedHosts).toEqual([]);
  });

  it('honors EXTRA_ALLOWED_HOSTS', () => {
    const config = loadConfig({ EXTRA_ALLOWED_HOSTS: 'web, api.internal' } as NodeJS.ProcessEnv);
    expect(config.extraAllowedHosts).toEqual(['web', 'api.internal']);
  });
});

describe('topic rotation', () => {
  it('interleaves headlines across topics', () => {
    const items: Headline[] = [
      headline({ title: 'b1', topic: 'BUSINESS' }),
      headline({ title: 'b2', topic: 'BUSINESS' }),
      headline({ title: 's1', topic: 'SPORTS' }),
      headline({ title: 'w1', topic: 'WORLD' }),
    ];
    const rotated = rotateByTopic(items).map((h) => h.title);
    expect(rotated).toEqual(['w1', 'b1', 's1', 'b2']);
  });
});
