import { estimateTokens } from './prompt.js';

// a long session is folded into a running chronicle so the DM's prompt stays
// within budget: once the chat since the last fold outgrows about half the
// history budget (or 80 messages), everything but the newest third is folded
const SUMMARY_TRIGGER = 80;
const MIN_KEEP = 8;
const SUMMARY_MAX_TOKENS = 1100;
const msgTokens = m => estimateTokens(m.content) + 8;
const line = m => `${m.speaker ?? m.authorName ?? m.kind}: ${m.content}`;

async function ask(llm, endpoint, system, user, maxTokens) {
  if (!llm?.available) return null;
  try {
    const out = await llm.chat({ endpoint, temperature: 0.3, maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    return out.content?.trim() || null;
  } catch {
    return null;
  }
}

// budget: tokens the DM prompt can spend on chat history
export async function maybeSummarize({ store, llm, campaignId, channel = 'dm', endpoint, budget = 6000 }) {
  const prev = store.latestSummary(campaignId, channel);
  const after = prev?.uptoMessageId ?? 0;
  const pending = store.listMessages(campaignId, { channel, after, limit: 500 }).filter(m => m.kind !== 'system' || m.content.length < 400);
  const total = pending.reduce((s, m) => s + msgTokens(m), 0);
  if (pending.length <= MIN_KEEP * 2 || (total < budget * 0.5 && pending.length < SUMMARY_TRIGGER)) return null;
  // the newest third of the budget stays word for word
  let keep = 0;
  let cut = pending.length;
  while (cut > 0 && keep + msgTokens(pending[cut - 1]) <= budget / 3) keep += msgTokens(pending[--cut]);
  cut = Math.min(cut, pending.length - MIN_KEEP);
  if (cut < MIN_KEEP) return null;
  const chunk = pending.slice(0, cut);
  const upto = chunk[chunk.length - 1].id;
  const transcript = chunk.map(line).join('\n').slice(-30000);
  let content = await ask(llm, endpoint,
    'You keep the chronicle of a D&D campaign for its Dungeon Master. Merge the earlier chronicle and the new events into one updated chronicle. Keep every name, place, quest, promise, debt, item gained or lost, secret learned, enemy made and decision taken; drop banter and dice detail. Past tense. Recent events get the most detail, old ones a sentence each. End with a short "Open threads:" list. Under 400 words.',
    `${prev ? `EARLIER CHRONICLE:\n${prev.content}\n\n` : ''}NEW EVENTS:\n${transcript}`, 900);
  if (!content) content = `${prev ? `${prev.content}\n` : ''}${fallbackSummary(chunk)}`;
  // a chronicle that outgrows its share is condensed, not cut off
  if (estimateTokens(content) > SUMMARY_MAX_TOKENS) {
    const shorter = await ask(llm, endpoint, 'Condense this D&D campaign chronicle to under 300 words. Keep names, places, open quests, promises and unresolved threats; summarize finished episodes in a clause each. Keep the "Open threads:" list.', content, 600);
    content = shorter && estimateTokens(shorter) < estimateTokens(content) ? shorter : content.slice(-SUMMARY_MAX_TOKENS * 3.6);
  }
  store.addSummary({ campaignId, channel, uptoMessageId: upto, content });
  return content;
}

export function fallbackSummary(msgs) {
  const keep = msgs.filter(m => ['dm', 'npc', 'player'].includes(m.kind) || /dies|Combat ends|receives|gain/.test(m.content));
  return keep.slice(-30).map(m => `${m.speaker ?? m.authorName ?? m.kind}: ${m.content.slice(0, 160)}`).join(' / ');
}

export function relevantMemories(store, campaignId, text, { limit = 8 } = {}) {
  const found = store.searchMemories(campaignId, text, { limit });
  const important = store.listMemories(campaignId).filter(m => m.importance >= 4).slice(0, 6);
  const seen = new Set();
  const out = [];
  for (const m of [...important, ...found]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.slice(0, limit + 4);
}
