// split DM output into narrator and character segments
// dialogue lines: `>> Name: text` (also tolerates **Name:** "text")
const LINE = /^\s*(?:>>\s*([^:\n]{1,40}):|\*\*([^*:\n]{1,40}):\*\*)\s*(.*)$/;

const SPEECH_VERBS = 'says|said|asks|asked|replies|replied|whispers|whispered|mutters|muttered|gasps|gasped|growls|growled|snaps|snapped|shouts|shouted|calls|called|answers|answered|adds|added|murmurs|murmured|hisses|hissed|laughs|laughed|sighs|sighed|continues|continued|offers|offered|insists|insisted|explains|explained|stammers|stammered|barks|barked|croaks|croaked|warns|warned|grumbles|grumbled|purrs|purred|tells you|told you';
const SPOKEN = new RegExp(`\\b(?:${SPEECH_VERBS})\\b`, 'i');
const QUOTE = /["“]([^"“”]{2,600})["”]/g;
const TITLES = ['sister', 'brother', 'captain', 'old', 'lord', 'lady', 'sir', 'master', 'mother', 'father', 'the'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// NPC speech written into narration ("Crane leans in. "Shut the door," he says.") becomes a ">> Name:" line
export function liftNpcQuotes(text, npcNames = []) {
  const names = [...new Set(npcNames.flatMap(n => [n, ...n.split(' ')]).filter(n => n && n.length >= 3 && !TITLES.includes(n.toLowerCase())))].sort((a, b) => b.length - a.length);
  if (!names.length) return String(text ?? '');
  const nameRe = new RegExp(`\\b(${names.map(esc).join('|')})\\b`, 'i');
  const full = n => npcNames.find(x => x.toLowerCase() === n.toLowerCase()) ?? npcNames.find(x => x.toLowerCase().split(' ').includes(n.toLowerCase())) ?? n;
  let lastSpeaker = null;
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const tag = LINE.exec(line);
    if (tag) {
      lastSpeaker = (tag[1] ?? tag[2]).trim();
      out.push(line);
      continue;
    }
    const mentioned = nameRe.exec(line);
    const quotes = [...line.matchAll(QUOTE)].map(m => m[1].trim());
    if (!quotes.length) {
      if (mentioned) lastSpeaker = full(mentioned[1]);
      out.push(line);
      continue;
    }
    const speaker = mentioned ? full(mentioned[1]) : lastSpeaker;
    // signs, inscriptions and titles in quotes stay; speech has a dialogue tag or ends like a sentence
    const spoken = SPOKEN.test(line) || quotes.some(q => /[.!?,…—-]$/.test(q));
    if (!speaker || !spoken) {
      out.push(line);
      continue;
    }
    lastSpeaker = speaker;
    const who = [speaker, ...speaker.split(' ').filter(w => w.length >= 3)].map(esc).join('|');
    // the dialogue tag and the rest of its clause ("he gasps, his voice raspy")
    const tagRe = new RegExp(`(?:,|:)?\\s*\\b(?:${who}|he|she|they)\\s+(?:${SPEECH_VERBS})\\b[^.!?"“”]*`, 'gi');
    const rest = line
      .replace(QUOTE, ' ')
      .replace(tagRe, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/[,;:]+(?=\s*(?:[.!?]|$))/g, '')
      .replace(/(^|[.!?]\s*)[,;:.]+\s*/g, '$1')
      .replace(/([.!?])(?=\p{Lu})/gu, '$1 ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (/\p{L}{2,}/u.test(rest)) out.push(rest);
    out.push(`>> ${speaker}: "${quotes.join(' ').replace(/,$/, '.')}"`, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const unquote = t => t.trim().replace(/^["“]|["”]$/g, '').trim();

// one NPC talking, with only short beats of narration between their lines, is one speech:
// the lines run together and each beat becomes an italic stage direction inside it
export function mergeMonologues(segs) {
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = out[out.length - 1];
    if (s.speaker && last?.speaker === s.speaker) {
      last.text += ` ${unquote(s.text)}`;
      continue;
    }
    const next = segs[i + 1];
    if (!s.speaker && last?.speaker && next?.speaker === last.speaker && s.text.length <= 200 && !s.text.includes('\n')) {
      last.text += ` *${s.text.replace(/^\*+|\*+$/g, '').trim()}*`;
      continue;
    }
    out.push(s.speaker ? { ...s, text: unquote(s.text) } : { ...s });
  }
  return out;
}

export function parseSegments(text) {
  const segs = [];
  let cur = null;
  for (const raw of String(text ?? '').split('\n')) {
    const m = LINE.exec(raw);
    if (m) {
      if (cur) segs.push(cur);
      const speaker = (m[1] ?? m[2]).trim();
      cur = { speaker, text: m[3].trim() };
      continue;
    }
    if (cur && cur.speaker && raw.trim() === '') {
      segs.push(cur);
      cur = null;
      continue;
    }
    if (cur && cur.speaker) {
      cur.text += `\n${raw}`;
      continue;
    }
    if (!cur) cur = { speaker: null, text: raw };
    else cur.text += `\n${raw}`;
  }
  if (cur) segs.push(cur);
  return segs.map(s => ({ ...s, text: s.text.trim() })).filter(s => s.text);
}
