// RFC 5322 mailbox formatting shared by every delivery adapter.
//
// The public schema already refuses separators in display names, but messages
// stored before that rule (and any future caller) must still never be able to
// turn one display name into several recipients. An ASCII name is therefore
// always a quoted-string with `"` and `\` escaped, and a non-ASCII name is a
// sequence of RFC 2047 encoded-words, which can never contain a separator
// (RFC 2047 forbids encoded-words inside a quoted-string, so it is one or the other).

const ENCODED_WORD_PREFIX = "=?UTF-8?B?";
const ENCODED_WORD_SUFFIX = "?=";
// An encoded-word is at most 75 characters: 12 for the delimiters leave 63
// for Base64, i.e. 60 usable characters carrying 45 bytes.
const MAX_ENCODED_WORD_BYTES = 45;

function encodedWords(value: string) {
  const words: string[] = [];
  let current: Buffer[] = [];
  let currentBytes = 0;
  const flush = () => {
    if (!current.length) return;
    words.push(`${ENCODED_WORD_PREFIX}${Buffer.concat(current).toString("base64")}${ENCODED_WORD_SUFFIX}`);
    current = [];
    currentBytes = 0;
  };
  // Iterate by code point so a multi-byte character (accent, emoji) is never
  // split across two encoded-words, as RFC 2047 section 5 requires.
  for (const character of value) {
    const bytes = Buffer.from(character, "utf8");
    if (currentBytes + bytes.length > MAX_ENCODED_WORD_BYTES) flush();
    current.push(bytes);
    currentBytes += bytes.length;
  }
  flush();
  return words.join(" ");
}

export function formatDisplayName(name: string) {
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/["\\]/g, (character) => `\\${character}`)}"`;
  return encodedWords(name);
}

export function formatMailbox(value: { email: string; name?: string | null }) {
  const name = value.name
    ?.replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name ? `${formatDisplayName(name)} <${value.email}>` : value.email;
}
