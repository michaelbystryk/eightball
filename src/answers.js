// The 20 answers printed on the icosahedron inside a real Magic 8 Ball.
// Line breaks mirror how the words are stacked on the die's triangular faces.
export const ANSWERS = [
  // affirmative
  { text: 'IT IS\nCERTAIN', kind: 'yes' },
  { text: 'IT IS\nDECIDEDLY\nSO', kind: 'yes' },
  { text: 'WITHOUT\nA\nDOUBT', kind: 'yes' },
  { text: 'YES\nDEFINITELY', kind: 'yes' },
  { text: 'YOU MAY\nRELY\nON IT', kind: 'yes' },
  { text: 'AS I\nSEE IT,\nYES', kind: 'yes' },
  { text: 'MOST\nLIKELY', kind: 'yes' },
  { text: 'OUTLOOK\nGOOD', kind: 'yes' },
  { text: 'YES', kind: 'yes' },
  { text: 'SIGNS\nPOINT\nTO YES', kind: 'yes' },
  // non-committal
  { text: 'REPLY\nHAZY,\nTRY AGAIN', kind: 'maybe' },
  { text: 'ASK\nAGAIN\nLATER', kind: 'maybe' },
  { text: 'BETTER\nNOT TELL\nYOU NOW', kind: 'maybe' },
  { text: 'CANNOT\nPREDICT\nNOW', kind: 'maybe' },
  { text: 'CONCENTRATE\nAND ASK\nAGAIN', kind: 'maybe' },
  // negative
  { text: "DON'T\nCOUNT\nON IT", kind: 'no' },
  { text: 'MY\nREPLY\nIS NO', kind: 'no' },
  { text: 'MY\nSOURCES\nSAY NO', kind: 'no' },
  { text: 'OUTLOOK\nNOT SO\nGOOD', kind: 'no' },
  { text: 'VERY\nDOUBTFUL', kind: 'no' },
];

// Secret codes: visiting /<code> or /#<code> makes the die land on that answer.
// Index-aligned with ANSWERS; they look like random hex so the link gives nothing away.
export const CODES = [
  'c3', 'd5', 'a7', 'e9', 'b2', '4f', '6d', '1b', 'f0', '8e',
  '2c', '5a', '9d', '7b', '3e',
  'e4', '0d', 'b8', 'f6', '61',
];

export function answerIndexForCode(code) {
  const i = CODES.indexOf(String(code).trim().toLowerCase());
  return i >= 0 ? i : null;
}

// Uniformly random, like the real toy: each face is equally likely.
export function randomAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

// Custom message links: /m.<payload> or /#m.<payload>, where payload is the message as
// base64url UTF-8 so the link doesn't spell out the surprise.
export const MAX_MESSAGE = 60;

export function encodeMessage(text) {
  const bytes = new TextEncoder().encode(text.slice(0, MAX_MESSAGE));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeMessage(code) {
  const m = /^m\.([A-Za-z0-9_-]+)$/.exec(String(code).trim());
  if (!m) return null;
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))).trim();
    return text ? text.slice(0, MAX_MESSAGE) : null;
  } catch {
    return null;
  }
}

// Stack a message onto a die face like the real ones: uppercase, a few short lines,
// widest at the bottom of the triangle. Explicit line breaks are kept.
export function layoutMessage(text) {
  const words = text.toUpperCase().split(/[ \t]+/).filter(Boolean);
  if (text.includes('\n')) return text.toUpperCase().split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5).join('\n');
  const len = words.join(' ').length;
  const nLines = len <= 9 ? 1 : len <= 20 ? 2 : len <= 36 ? 3 : len <= 50 ? 4 : 5;
  const width = Math.max(...words.map((w) => w.length), Math.ceil(len / nLines));
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= width) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }
  return lines.join('\n');
}
