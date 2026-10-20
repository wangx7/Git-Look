/**
 * Normalizes a raw commit message: CRLF/CR line endings become LF and trailing whitespace is dropped.
 */
export function normalizeMessage(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trimEnd();
}

/**
 * Splits a raw commit message (%B) into its subject (first line) and body.
 * Leading blank lines of the body are removed, indentation of its first line is kept.
 */
export function splitMessage(raw: string): { subject: string; body: string } {
  const message = normalizeMessage(raw);
  const firstLineEnd = message.indexOf('\n');
  if (firstLineEnd === -1) {
    return { subject: message, body: '' };
  }
  return {
    subject: message.substring(0, firstLineEnd).trimEnd(),
    body: message.substring(firstLineEnd + 1).replace(/^(?:[ \t]*\n)+/, '')
  };
}
