/**
 * Headline → market templating — testing-market-generator.md Section 4.
 *
 * Deliberately simple, no LLM: classify by feed topic, extract the leading
 * noun phrase, apply a random template from the category pool, randomize
 * {date}/{n} parameters. All randomness flows through the seeded PRNG so
 * datasets are reproducible (GENERATOR_SEED).
 */

import type { CloseWindow } from './config.js';
import type { Headline } from './news.js';
import type { Prng } from './prng.js';

export type MarketCategory =
  | 'generic'
  | 'world'
  | 'business'
  | 'technology'
  | 'sports'
  | 'science'
  | 'entertainment'
  | 'health';

export type MarketType = 'FUN' | 'CLASSIC' | 'CHALLENGE';

export interface GeneratedMarket {
  question: string;
  description: string;
  category: MarketCategory;
  marketType: MarketType;
  closeTime: Date;
  oracleProofUrl: string;
  templateName: string;
  subject: string;
  headline: Headline;
}

// ── Classification ───────────────────────────────────────────────────────────

const TOPIC_TO_CATEGORY: Record<string, MarketCategory> = {
  WORLD: 'world',
  BUSINESS: 'business',
  TECHNOLOGY: 'technology',
  SPORTS: 'sports',
  SCIENCE: 'science',
  ENTERTAINMENT: 'entertainment',
  HEALTH: 'health',
};

export function classifyCategory(topic: Headline['topic']): MarketCategory {
  return TOPIC_TO_CATEGORY[topic] ?? 'generic';
}

// ── Subject extraction ───────────────────────────────────────────────────────

const SUBJECT_MAX_CHARS = 80;
const QUESTION_MAX_CHARS = 120;

/** Substring delimiters that end the leading noun phrase. */
const CUT_DELIMITERS = [' as ', ' after ', ' amid ', ': ', ' — ', ';', ','] as const;

/** Irregular / common headline verbs that don't match the suffix heuristic. */
const VERB_SET = new Set([
  'sign', 'win', 'launch', 'open', 'host', 'beat', 'edge', 'reach', 'break',
  'roll', 'ship', 'top', 'seal', 'find', 'spot', 'say', 'show', 'plan', 'aim',
  'set', 'hit', 'face', 'warn', 'urge', 'call', 'map', 'tease', 'debut',
  'clinch', 'complete', 'confirm', 'reveal', 'secure', 'release', 'report',
  'propose', 'pledge', 'raise', 'expand', 'acquire', 'endorse', 'commission',
  'greenlight', 'enroll', 'detect', 'link', 'sustain', 'approve', 'schedule',
  'introduce', 'preview', 'unveil', 'announce', 'to', 'will', 'may', 'could',
]);

/** Lowercase tokens that look like verbs but are not (kept inside the subject). */
const VERB_EXEMPT = new Set(['news', 'sports', 'less', 'plus', 'versus', 'vs', 'its', 'this']);

function isVerbish(token: string): boolean {
  if (!/^[a-z][a-z-]*$/.test(token)) return false; // only all-lowercase tokens
  if (VERB_EXEMPT.has(token)) return false;
  if (VERB_SET.has(token)) return true;
  if (token.length >= 4 && token.endsWith('s') && !token.endsWith('ss')) return true;
  if (token.length >= 5 && (token.endsWith('ed') || token.endsWith('ing'))) return true;
  return false;
}

/**
 * Leading noun-phrase heuristic: cut the headline at the first of
 * " as ", " after ", " amid ", ": ", " — ", ";", ",", or a lowercase
 * verb-ish token; cap at 80 chars.
 */
export function extractSubject(title: string): string {
  let cutAt = title.length;
  for (const delim of CUT_DELIMITERS) {
    const idx = title.indexOf(delim);
    if (idx > 0 && idx < cutAt) cutAt = idx;
  }
  // Scan tokens (skipping the leading one) for the first verb-ish token.
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;
  let first = true;
  while ((match = tokenRe.exec(title)) !== null) {
    if (match.index >= cutAt) break;
    if (first) {
      first = false;
      continue;
    }
    const token = match[0].replace(/[^A-Za-z-]/g, '');
    if (token && isVerbish(token) && match.index < cutAt) {
      cutAt = match.index;
      break;
    }
  }
  let subject = title.slice(0, cutAt).trim();
  if (subject.length > SUBJECT_MAX_CHARS) {
    subject = subject.slice(0, SUBJECT_MAX_CHARS).trimEnd();
    const lastSpace = subject.lastIndexOf(' ');
    if (lastSpace > 40) subject = subject.slice(0, lastSpace);
  }
  return subject;
}

// ── Template pools ───────────────────────────────────────────────────────────

export interface MarketTemplate {
  name: string;
  /** May contain {subject}, {date}, {n}. */
  pattern: string;
  /** Inclusive range for {n}, when the pattern uses it. */
  nRange?: readonly [number, number];
}

export const GENERIC_TEMPLATES: readonly MarketTemplate[] = [
  {
    name: 'generic-top10',
    pattern: 'Will «{subject}» still be a top-10 Google News story on {date}?',
  },
  {
    name: 'generic-statement',
    pattern: 'Will «{subject}» be followed by an official statement before {date}?',
  },
];

export const CATEGORY_TEMPLATES: Record<Exclude<MarketCategory, 'generic'>, readonly MarketTemplate[]> = {
  world: [
    { name: 'world-press-conference', pattern: 'Will {subject} hold a press conference before {date}?' },
    { name: 'world-inquiry', pattern: 'Will «{subject}» lead to an official inquiry by {date}?' },
  ],
  business: [
    { name: 'business-close-higher', pattern: 'Will {subject} stock close higher on {date}?' },
    {
      name: 'business-further-news',
      pattern: 'Will {subject} announce further news within {n} days?',
      nRange: [3, 14],
    },
  ],
  technology: [
    { name: 'tech-public-release', pattern: 'Will {subject} ship a public release before {date}?' },
    {
      name: 'tech-adoption',
      pattern: 'Will {subject} be adopted by more than {n} major platforms by {date}?',
      nRange: [2, 10],
    },
  ],
  sports: [
    { name: 'sports-next-match', pattern: 'Will {subject} win their next match?' },
    {
      name: 'sports-score',
      pattern: 'Will {subject} score more than {n} in their next game?',
      nRange: [1, 5],
    },
  ],
  science: [
    {
      name: 'science-replication',
      pattern: 'Will «{subject}» be replicated by an independent team before {date}?',
    },
    {
      name: 'science-peer-review',
      pattern: 'Will «{subject}» appear in a peer-reviewed journal by {date}?',
    },
  ],
  entertainment: [
    { name: 'entertainment-charts', pattern: 'Will {subject} top the charts on {date}?' },
    {
      name: 'entertainment-followup',
      pattern: 'Will {subject} get a follow-up within {n} weeks?',
      nRange: [2, 12],
    },
  ],
  health: [
    {
      name: 'health-regulatory',
      pattern: 'Will «{subject}» receive regulatory follow-up before {date}?',
    },
    {
      name: 'health-guidance',
      pattern: 'Will «{subject}» be cited in official health guidance by {date}?',
    },
  ],
};

export function templatePool(category: MarketCategory): readonly MarketTemplate[] {
  if (category === 'generic') return GENERIC_TEMPLATES;
  return [...GENERIC_TEMPLATES, ...CATEGORY_TEMPLATES[category]];
}

// ── Marker line (Section 4.1 — EXACT format) ─────────────────────────────────

export function markerLine(headline: Headline): string {
  return `⚠ Auto-generated test market — resolves randomly. Source headline: "${headline.title}" (${headline.source}, ${headline.pubDate})`;
}

// ── Generation ───────────────────────────────────────────────────────────────

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function formatDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()] ?? '???'} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function randomCloseTime(prng: Prng, window: CloseWindow, now: Date): Date {
  const hours = prng.float(window.minHours, window.maxHours);
  return new Date(now.getTime() + Math.round(hours * 3_600_000));
}

export function randomMarketType(prng: Prng): MarketType {
  const r = prng.next();
  if (r < 0.7) return 'FUN';
  if (r < 0.9) return 'CLASSIC';
  return 'CHALLENGE';
}

function renderQuestion(template: MarketTemplate, subject: string, closeTime: Date, n: number): string {
  const fill = (s: string): string =>
    template.pattern
      .replace('{subject}', s)
      .replace('{date}', formatDate(closeTime))
      .replace('{n}', String(n));
  let question = fill(subject);
  if (question.length > QUESTION_MAX_CHARS) {
    const overflow = question.length - QUESTION_MAX_CHARS;
    const shorter = subject.slice(0, Math.max(1, subject.length - overflow - 1)).trimEnd() + '…';
    question = fill(shorter);
  }
  return question;
}

/**
 * Build one market from a headline. Deterministic for a given PRNG state,
 * headline, and `now`.
 */
export function buildMarket(
  headline: Headline,
  prng: Prng,
  window: CloseWindow,
  now: Date = new Date(),
): GeneratedMarket {
  const category = classifyCategory(headline.topic);
  const subject = extractSubject(headline.title);
  const template = prng.pick(templatePool(category));
  const closeTime = randomCloseTime(prng, window, now);
  const n = template.nRange ? prng.int(template.nRange[0], template.nRange[1]) : 0;
  const question = renderQuestion(template, subject, closeTime, n);
  const marketType = randomMarketType(prng);
  const description = [
    markerLine(headline),
    headline.link,
    `Template: ${template.name}`,
  ].join('\n');

  return {
    question,
    description,
    category,
    marketType,
    closeTime,
    oracleProofUrl: headline.link,
    templateName: template.name,
    subject,
    headline,
  };
}
