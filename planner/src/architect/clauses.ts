/**
 * Clause split + negation scope for local extraction. One place for "not X" / "moved from X".
 */

export type ClauseScope = 'negated' | 'past' | 'future' | 'hypothetical' | 'asserted';

export type MentionHit = {
  clause: string;
  index: number;
  scope: ClauseScope;
  match: string;
};

const NEG_CUE = /\b(?:not|no|never|dont|don't|do not|without|isnt|isn't|arent|aren't|wont|won't|cant|can't|refuse|skip)\b/i;
const PAST_CUE = /\b(?:used to|formerly|had been|moved from|switching from|switched from|dropped|cancelled|canceled|got rid of|no longer|quit|left)\b/i;
const FUTURE_CUE = /\b(?:later|next year|when we grow|maybe|might|someday|eventually|not at launch|not yet|thinking about)\b/i;
const HYP_CUE = /\b(?:if|would|could|should|whenever|suppose)\b/i;

export function foldClause(s: string) {
  return s.toLowerCase().replace(/['']/g, '');
}

export function splitClauses(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized)
    return [];
  const parts = normalized
    .split(/\s*(?:[.!?]+|;|(?:\s+)(?:but|except|although|however)\s+)\s*/i)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [normalized];
}

/** Scope for a specific token (negation is tied to the matched term, not any "not" in the clause). */
export function scopeOf(clause: string, matchIndex: number, matchText = ''): ClauseScope {
  const term = foldClause(matchText);
  const slice = clause.slice(Math.max(0, matchIndex - 48), Math.min(clause.length, matchIndex + matchText.length + 24));
  const folded = foldClause(slice);
  const termEsc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term && new RegExp(`\\b(?:not|no|never|dont|don't|without)\\s+${termEsc}\\b`).test(folded))
    return 'negated';
  if (term && new RegExp(`\\bnot switching to\\s+${termEsc}\\b`).test(folded))
    return 'negated';
  if (term && /\bmoved from\b/.test(folded) && new RegExp(`\\bto\\s+${termEsc}\\b`).test(folded))
    return 'asserted';
  const before = foldClause(clause.slice(Math.max(0, matchIndex - 32), matchIndex));
  if (term && new RegExp(`\\bmoved from\\s+${termEsc}\\b`).test(folded))
    return 'past';
  if (term && new RegExp(`\\bfrom\\s+${termEsc}\\s+to\\b`).test(folded))
    return 'past';
  if (PAST_CUE.test(before) && term && before.includes(' from'))
    return 'past';
  if (FUTURE_CUE.test(before))
    return 'future';
  if (HYP_CUE.test(before))
    return 'hypothetical';
  return 'asserted';
}

export function mentions(text: string, term: RegExp, opts: { scopes?: ClauseScope[] } = {}): MentionHit[] {
  const allowed = opts.scopes || ['asserted'];
  const hits: MentionHit[] = [];
  for (const clause of splitClauses(text)) {
    const re = new RegExp(term.source, term.flags.includes('g') ? term.flags : term.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(clause))) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const scope = scopeOf(clause, m.index, m[0]);
      if (allowed.includes(scope))
        hits.push({ clause, index: m.index, scope, match: m[0] });
    }
  }
  return hits;
}

/** First asserted hit, or any hit if onlyAsserted false. */
export function firstAsserted(text: string, term: RegExp): MentionHit | null {
  const hits = mentions(text, term, { scopes: ['asserted'] });
  return hits[0] || null;
}

/** True if term appears only under negated/past scope (safe to ignore for positive extraction). */
export function onlyNegatedOrPast(text: string, term: RegExp): boolean {
  const all = mentions(text, term, { scopes: ['asserted', 'negated', 'past', 'future', 'hypothetical'] });
  if (!all.length)
    return false;
  return !all.some(h => h.scope === 'asserted');
}

export function assertedText(text: string): string {
  return splitClauses(text)
    .filter(clause => {
      const f = foldClause(clause);
      return !NEG_CUE.test(f.slice(0, 40)) && !/^not\s/.test(f);
    })
    .join(' ');
}