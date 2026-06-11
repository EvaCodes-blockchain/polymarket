/**
 * News acquisition — testing-market-generator.md Section 3.
 *
 * Live mode: Google News public RSS feeds (top headlines + per-topic),
 * fetched with native fetch and parsed with fast-xml-parser.
 * Fixture mode: bundled generator/fixtures/headlines.json (hermetic, CI default).
 *
 * On any fetch/parse failure the module logs and returns [] — the generator
 * must degrade silently, never crash the environment (Section 3.2).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { GeneratorConfig, NewsTopic } from './config.js';
import { NEWS_TOPICS } from './config.js';
import { packageRoot } from './paths.js';

export interface Headline {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  topic: NewsTopic | 'TOP';
}

const RSS_BASE = 'https://news.google.com/rss';
const RSS_PARAMS = 'hl=en-US&gl=US&ceid=US:en';

export function topHeadlinesUrl(): string {
  return `${RSS_BASE}?${RSS_PARAMS}`;
}

export function topicHeadlinesUrl(topic: NewsTopic): string {
  return `${RSS_BASE}/headlines/section/topic/${topic}?${RSS_PARAMS}`;
}

const FIXTURES_PATH = path.join(packageRoot(), 'fixtures', 'headlines.json');

// ── RSS parsing ──────────────────────────────────────────────────────────────

interface RssSourceNode {
  '#text'?: string;
}

interface RssItemNode {
  title?: string;
  link?: string;
  pubDate?: string;
  source?: RssSourceNode | string;
}

interface RssDocument {
  rss?: {
    channel?: {
      item?: RssItemNode | RssItemNode[];
    };
  };
}

/** Parse a Google News RSS XML payload into headlines. Exported for tests. */
export function parseRss(xml: string, topic: NewsTopic | 'TOP'): Headline[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as RssDocument;
  const rawItems = doc.rss?.channel?.item;
  if (!rawItems) return [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  const headlines: Headline[] = [];
  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const link = typeof item.link === 'string' ? item.link.trim() : '';
    if (!title || !link) continue;
    let source = '';
    if (typeof item.source === 'string') {
      source = item.source;
    } else if (item.source && typeof item.source['#text'] === 'string') {
      source = item.source['#text'];
    }
    headlines.push({
      title,
      link,
      pubDate: typeof item.pubDate === 'string' ? item.pubDate : '',
      source: source || 'Google News',
      topic,
    });
  }
  return headlines;
}

// ── Fixture mode ─────────────────────────────────────────────────────────────

interface FixtureItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  topic: string;
}

export async function loadFixtureHeadlines(
  topics: readonly NewsTopic[],
  fixturesPath: string = FIXTURES_PATH,
): Promise<Headline[]> {
  try {
    const raw = await readFile(fixturesPath, 'utf8');
    const items = JSON.parse(raw) as FixtureItem[];
    return items
      .filter((item): item is FixtureItem & { topic: NewsTopic } =>
        (topics as readonly string[]).includes(item.topic),
      )
      .map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: item.source,
        topic: item.topic,
      }));
  } catch (err) {
    console.error(`[news] failed to load fixtures from ${fixturesPath}:`, err);
    return [];
  }
}

// ── Live mode ────────────────────────────────────────────────────────────────

async function fetchFeed(url: string, topic: NewsTopic | 'TOP'): Promise<Headline[]> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'justify-market-generator/0.1 (test tooling)' },
  });
  if (!res.ok) {
    throw new Error(`feed ${url} responded ${res.status}`);
  }
  const xml = await res.text();
  return parseRss(xml, topic);
}

async function fetchLiveHeadlines(topics: readonly NewsTopic[]): Promise<Headline[]> {
  const feeds: Array<{ url: string; topic: NewsTopic | 'TOP' }> = [
    { url: topHeadlinesUrl(), topic: 'TOP' },
    ...topics.map((topic) => ({ url: topicHeadlinesUrl(topic), topic })),
  ];
  const results = await Promise.allSettled(
    feeds.map((feed) => fetchFeed(feed.url, feed.topic)),
  );
  const headlines: Headline[] = [];
  results.forEach((result, i) => {
    const feed = feeds[i];
    if (result.status === 'fulfilled') {
      headlines.push(...result.value);
    } else {
      console.error(`[news] fetch failed for ${feed?.url ?? 'unknown feed'}:`, result.reason);
    }
  });
  return headlines;
}

// ── Topic rotation ───────────────────────────────────────────────────────────

/**
 * Interleave headlines by topic (round-robin) so categories stay balanced
 * when only the first N headlines of a cycle are consumed (Section 3.2).
 */
export function rotateByTopic(headlines: readonly Headline[]): Headline[] {
  const buckets = new Map<string, Headline[]>();
  const order: string[] = [...NEWS_TOPICS, 'TOP'];
  for (const h of headlines) {
    const bucket = buckets.get(h.topic);
    if (bucket) bucket.push(h);
    else buckets.set(h.topic, [h]);
  }
  const rotated: Headline[] = [];
  let added = true;
  let round = 0;
  while (added) {
    added = false;
    for (const topic of order) {
      const bucket = buckets.get(topic);
      const item = bucket?.[round];
      if (item) {
        rotated.push(item);
        added = true;
      }
    }
    round++;
  }
  return rotated;
}

/**
 * Fetch headlines for one cycle, already topic-rotated.
 * Never throws — on failure logs and returns [].
 */
export async function fetchHeadlines(config: GeneratorConfig): Promise<Headline[]> {
  try {
    const headlines =
      config.newsSource === 'live'
        ? await fetchLiveHeadlines(config.topics)
        : await loadFixtureHeadlines(config.topics);
    return rotateByTopic(headlines);
  } catch (err) {
    console.error('[news] headline acquisition failed, skipping cycle:', err);
    return [];
  }
}
