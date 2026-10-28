/**
 * Minimal, dependency-free syntax tokenizer for Live Book code panels.
 * Produces plain text tokens rendered as React spans (never HTML), so it cannot
 * inject markup. Line-based: multi-line comments/strings are not tracked across
 * lines, which is acceptable for lesson-sized snippets.
 */

export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'fn' | 'plain';
export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set(
  (
    'abstract as async await boolean break case catch char class const continue default delete do double else enum export extends ' +
    'false final finally float for from function if implements import in instanceof int interface let long new null package private ' +
    'protected public readonly return short static string super switch this throw throws true try type typeof undefined var void ' +
    'while with yield def elif lambda None True False pass raise self print include namespace std using auto struct template'
  ).split(' ')
);

const HASH_COMMENT = new Set(['python', 'py', 'bash', 'sh', 'shell', 'yaml', 'yml', 'ruby']);

const RULES: Array<[RegExp, TokenKind]> = [
  [/^\/\/.*/, 'comment'],
  [/^\/\*.*?(\*\/|$)/, 'comment'],
  [/^<!--.*?(-->|$)/, 'comment'],
  [/^"(?:[^"\\]|\\.)*"?/, 'string'],
  [/^'(?:[^'\\]|\\.)*'?/, 'string'],
  [/^`(?:[^`\\]|\\.)*`?/, 'string'],
  [/^\b\d[\d_]*(?:\.\d+)?\b/, 'number'],
  [/^<\/?[A-Za-z][\w-]*/, 'keyword'],
  [/^[A-Za-z_$][\w$]*(?=\s*\()/, 'fn'],
  [/^[A-Za-z_$][\w$]*/, 'plain'],
  [/^\s+/, 'plain'],
  [/^./, 'plain'],
];

export function tokenizeLine(line: string, language: string): Token[] {
  const lang = language.toLowerCase();
  const tokens: Token[] = [];
  let rest = line;
  while (rest.length) {
    if (HASH_COMMENT.has(lang) && rest.startsWith('#')) {
      tokens.push({ text: rest, kind: 'comment' });
      break;
    }
    for (const [re, kind] of RULES) {
      const m = re.exec(rest);
      if (!m || !m[0]) continue;
      let k = kind;
      if (kind === 'plain' && KEYWORDS.has(m[0])) k = 'keyword';
      const last = tokens[tokens.length - 1];
      if (k === 'plain' && last?.kind === 'plain') last.text += m[0];
      else tokens.push({ text: m[0], kind: k });
      rest = rest.slice(m[0].length);
      break;
    }
  }
  return tokens;
}
