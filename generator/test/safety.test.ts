import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DENYLIST,
  filterDenied,
  isAllowedBaseUrl,
  isDenied,
} from '../src/safety.js';
import { DedupStore, hashHeadline, normalizeHeadline } from '../src/dedup.js';
import { loadFixtureHeadlines } from '../src/news.js';
import { NEWS_TOPICS } from '../src/config.js';
import type { Headline } from '../src/news.js';

describe('environment lock — allowlist', () => {
  it('allows localhost and 127.0.0.1', () => {
    expect(isAllowedBaseUrl('http://localhost:3000')).toBe(true);
    expect(isAllowedBaseUrl('http://127.0.0.1:3000')).toBe(true);
  });

  it('allows *.test and *.staging hosts', () => {
    expect(isAllowedBaseUrl('https://justify.test')).toBe(true);
    expect(isAllowedBaseUrl('https://demo.justify.staging')).toBe(true);
  });

  it('refuses production-looking and invalid URLs', () => {
    expect(isAllowedBaseUrl('https://justify.example.com')).toBe(false);
    expect(isAllowedBaseUrl('https://polymarket.com')).toBe(false);
    expect(isAllowedBaseUrl('https://api.justify.io')).toBe(false);
    expect(isAllowedBaseUrl('not a url')).toBe(false);
    // suffix must match the hostname suffix, not a substring
    expect(isAllowedBaseUrl('https://staging.evil.com')).toBe(false);
  });

  it('honors extra allowed hosts (compose: EXTRA_ALLOWED_HOSTS=web)', () => {
    expect(isAllowedBaseUrl('http://web:3000')).toBe(false);
    expect(isAllowedBaseUrl('http://web:3000', ['web'])).toBe(true);
    expect(isAllowedBaseUrl('https://evil.com', ['web'])).toBe(false);
  });
});

describe('denylist filter', () => {
  it('skips tragedy/violence headlines', () => {
    expect(isDenied('Earthquake strikes coastal region')).toBe(true);
    expect(isDenied('Dozens killed in highway pileup')).toBe(true);
    expect(isDenied('Hostage negotiations continue')).toBe(true);
    expect(isDenied('Plane crash kills crew')).toBe(true);
  });

  it('matching is case-insensitive', () => {
    expect(isDenied('MASSACRE remembered 30 years on')).toBe(true);
  });

  it('passes benign headlines', () => {
    expect(isDenied('Tesla breaks ground on battery recycling plant')).toBe(false);
    expect(isDenied('Lakers clinch playoff berth')).toBe(false);
  });

  it('supports a custom denylist', () => {
    expect(isDenied('Aliens land in Nevada', ['aliens'])).toBe(true);
    expect(isDenied('Earthquake strikes', ['aliens'])).toBe(false);
  });

  it('filterDenied removes only matching headlines', () => {
    const make = (title: string): Headline => ({
      title,
      link: 'https://news.example.com/x',
      pubDate: '',
      source: 'Test',
      topic: 'WORLD',
    });
    const filtered = filterDenied([
      make('Peace talks resume'),
      make('Earthquake hits region'),
      make('Tech IPO soars'),
    ]);
    expect(filtered.map((h) => h.title)).toEqual(['Peace talks resume', 'Tech IPO soars']);
  });

  it('default denylist covers the documented terms', () => {
    expect(DEFAULT_DENYLIST).toContain('war crime');
    expect(DEFAULT_DENYLIST).toContain('suicide');
  });
});

describe('dedup store', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('normalizes headlines (lowercase, collapsed whitespace)', () => {
    expect(normalizeHeadline('  Tesla   Breaks\tGround  ')).toBe('tesla breaks ground');
    expect(hashHeadline('Tesla Breaks Ground')).toBe(hashHeadline('  tesla   breaks GROUND '));
  });

  it('persists hashes across load/save round-trips', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dedup-'));
    const storePath = path.join(dir, 'dedup.json');

    const store = new DedupStore(storePath);
    await store.load();
    expect(store.has('Some headline')).toBe(false);
    store.add('Some headline');
    store.add('Another headline');
    await store.save();

    const reloaded = new DedupStore(storePath);
    await reloaded.load();
    expect(reloaded.has('some  HEADLINE')).toBe(true);
    expect(reloaded.has('Another headline')).toBe(true);
    expect(reloaded.has('Unseen headline')).toBe(false);
    expect(reloaded.size).toBe(2);

    const raw = JSON.parse(await readFile(storePath, 'utf8')) as { hashes: string[] };
    expect(raw.hashes).toHaveLength(2);
  });

  it('starts fresh when the store file is missing or corrupt', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dedup-'));
    const store = new DedupStore(path.join(dir, 'missing.json'));
    await store.load();
    expect(store.size).toBe(0);
  });
});

describe('fixtures', () => {
  it('bundles ~60 items covering all seven topics, none denylisted', async () => {
    const headlines = await loadFixtureHeadlines(NEWS_TOPICS);
    expect(headlines.length).toBeGreaterThanOrEqual(55);
    const topics = new Set(headlines.map((h) => h.topic));
    for (const topic of NEWS_TOPICS) expect(topics.has(topic)).toBe(true);
    for (const h of headlines) {
      expect(isDenied(h.title)).toBe(false);
      expect(h.link).toMatch(/^https:\/\//);
      expect(h.title.length).toBeGreaterThan(0);
      expect(h.source.length).toBeGreaterThan(0);
    }
  });

  it('respects the topic filter', async () => {
    const sportsOnly = await loadFixtureHeadlines(['SPORTS']);
    expect(sportsOnly.length).toBeGreaterThan(0);
    expect(sportsOnly.every((h) => h.topic === 'SPORTS')).toBe(true);
  });
});
