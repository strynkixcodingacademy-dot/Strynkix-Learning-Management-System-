/**
 * Strynkix Live Books — help assistant engine.
 * Answers "how do I…" questions from the User Guide only, entirely in the
 * browser: no external AI service, no cost, and nothing the user types leaves
 * the device. It never invents features; if the guide has no good match it
 * says so and suggests topics instead.
 */

import { UserRole } from '@/types/domain';
import { GUIDE, GuideTopic, ROLE_NAMES, topicsForRole } from './guide';

export interface AssistantAnswer {
  kind: 'answer' | 'greeting' | 'fallback';
  text: string;
  topic?: GuideTopic;
  /** Set when the best topic belongs to another role. */
  otherRoleNote?: string;
  related: GuideTopic[];
  suggestions: string[];
}

const STOP = new Set(
  'a an the to of in on for and or is are am be can could would should do does did how what where when why which who i me my we our you your it this that with from at by as please want need help about there any some get make'.split(' ')
);

// Words people use → the words the guide uses.
const SYNONYMS: Record<string, string[]> = {
  homework: ['assignment'], task: ['assignment'], project: ['assignment'], exercise: ['assignment'],
  mark: ['marks', 'grade'], marks: ['grade'], score: ['marks', 'grade'], result: ['marks', 'feedback'], grading: ['grade'], evaluate: ['grade', 'review'],
  teacher: ['instructor'], trainer: ['instructor'], faculty: ['instructor'], tutor: ['instructor'], mentor: ['instructor'],
  class: ['batch'], cohort: ['batch'], group: ['batch'], section: ['batch'],
  campus: ['branch'], franchise: ['branch'], centre: ['branch'], center: ['branch'],
  enrol: ['enroll'], admit: ['enroll'], admission: ['enroll'], register: ['enroll'], join: ['enroll'],
  login: ['sign'], logon: ['sign'], signin: ['sign'], log: ['sign'],
  pwd: ['password'], pass: ['password'], forgot: ['password', 'reset'], forgotten: ['password', 'reset'],
  report: ['analytics'], reports: ['analytics'], stats: ['analytics'], statistics: ['analytics'], performance: ['analytics'], insights: ['analytics'],
  chapter: ['lesson'], lecture: ['lesson'], module: ['module', 'lesson'], content: ['course', 'lesson'],
  timetable: ['schedule', 'plan'], today: ['today', 'plan'],
  remove: ['withdraw'], delete: ['withdraw', 'archive'], block: ['suspend'], disable: ['suspend'], approve: ['approve', 'activate'],
  upload: ['submit'], send: ['submit'], turn: ['submit'],
};

// Light plural/tense folding: "courses" ↔ "course", "batches" ↔ "batch", "submitted" ↔ "submit".
function stem(word: string): string {
  let w = word.replace(/[’']/g, '');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (/(ch|sh|ss|x)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  // Fold a final silent "e" and a doubled final consonant: grade/grading, submit/submitted.
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9’'\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of raw) {
    if (STOP.has(w)) continue;
    out.push(stem(w));
    for (const s of SYNONYMS[w] ?? []) out.push(stem(s));
  }
  return [...new Set(out)];
}

function topicIndex(t: GuideTopic) {
  return {
    title: new Set(tokenize(t.title)),
    keywords: new Set(t.keywords.flatMap(tokenize)),
    body: new Set(tokenize(`${t.summary} ${t.steps.join(' ')}`)),
  };
}
const INDEX = new Map(GUIDE.map((t) => [t.id, topicIndex(t)]));

/** Share of the question's meaningful words that this topic covers (0..1). */
export function coverage(topic: GuideTopic, question: string): number {
  const idx = INDEX.get(topic.id)!;
  const words = question.toLowerCase().replace(/[^a-z0-9’'\s-]/g, ' ').split(/[\s-]+/).filter((w) => w && !STOP.has(w));
  if (!words.length) return 0;
  const hit = (w: string) => tokenize(w).some((t) => idx.title.has(t) || idx.keywords.has(t) || idx.body.has(t));
  return words.filter(hit).length / words.length;
}

export function scoreTopic(topic: GuideTopic, tokens: string[], role?: UserRole): number {
  const idx = INDEX.get(topic.id)!;
  let score = 0;
  for (const tok of tokens) {
    if (idx.keywords.has(tok)) score += 3;
    if (idx.title.has(tok)) score += 2.5;
    if (idx.body.has(tok)) score += 0.75;
  }
  if (score > 0 && role && (topic.roles.length === 0 || topic.roles.includes(role as never))) score += 1.5;
  return score;
}

const GREETING = /^(hi|hello|hey|hii+|namaste|good (morning|afternoon|evening)|yo)\b/i;
const THANKS = /^(thanks|thank you|thx|ok|okay|great|cool)\b/i;

export function suggestionsFor(role?: UserRole): string[] {
  switch (role) {
    case 'student': return ['How do I submit an assignment?', 'Where do I see my marks?', 'How do I mark a lesson complete?', 'I forgot my password'];
    case 'instructor': return ['How do I plan a day?', 'How do I grade a submission?', 'How do I request a correction?', 'Where are my batch analytics?'];
    case 'branch_admin': return ['How do I add a new student?', 'How do I create a batch?', 'How do I approve a pending student?', 'How do I add an instructor?'];
    case 'super_admin': return ['How do I open a new branch?', 'How do I add a branch manager?', 'How do I see branch performance?', 'How do I publish a course?'];
    default: return ['How do I sign in?', 'I forgot my password', 'Where is the User Guide?'];
  }
}

export function answer(question: string, role?: UserRole): AssistantAnswer {
  const q = question.trim();
  const suggestions = suggestionsFor(role);
  if (!q || GREETING.test(q)) {
    return {
      kind: 'greeting',
      text: `Hi! I can explain how to do anything in Strynkix Live Books${role && role !== 'university_admin' ? ` as a ${ROLE_NAMES[role]}` : ''}. Ask me a question, or pick one below.`,
      related: [],
      suggestions,
    };
  }
  if (THANKS.test(q) && q.split(/\s+/).length <= 3) {
    return { kind: 'greeting', text: 'Happy to help. Ask me anything else whenever you need.', related: [], suggestions };
  }

  const tokens = tokenize(q);
  const ranked = GUIDE.map((t) => ({ t, s: scoreTopic(t, tokens, role) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  // Answer only when the top topic is a strong match AND explains most of the
  // question; "weather today" must not be answered with "today's plan".
  if (!ranked.length || ranked[0].s < 3 || coverage(ranked[0].t, q) <= 0.5) {
    return {
      kind: 'fallback',
      text: 'I couldn’t find that in the User Guide. Try different words, or choose one of these common questions. For account problems, contact your branch manager.',
      related: topicsForRole(role).slice(0, 3),
      suggestions,
    };
  }

  const best = ranked[0].t;
  const forOtherRole = role && best.roles.length > 0 && !best.roles.includes(role as never);
  return {
    kind: 'answer',
    text: best.summary,
    topic: best,
    otherRoleNote: forOtherRole
      ? `This is done by ${best.roles.map((r) => ROLE_NAMES[r]).join(' or ')}. If you need it, ask them for help.`
      : undefined,
    related: ranked.slice(1, 4).map((r) => r.t).filter((t) => !role || t.roles.length === 0 || t.roles.includes(role as never)).slice(0, 2),
    suggestions,
  };
}
