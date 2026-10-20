import { normalizeMessage, splitMessage } from '../git/message';

describe('commit message helpers', () => {
  it('normalizes CRLF/CR line endings and trailing whitespace', () => {
    expect(normalizeMessage('a\r\nb\rc\n\n  ')).toBe('a\nb\nc');
  });

  it('splits subject and body', () => {
    expect(splitMessage('Fix bug\n\nline 1\nline 2\n')).toEqual({ subject: 'Fix bug', body: 'line 1\nline 2' });
  });

  it('returns an empty body for a one-line message', () => {
    expect(splitMessage('Fix bug\n')).toEqual({ subject: 'Fix bug', body: '' });
    expect(splitMessage('')).toEqual({ subject: '', body: '' });
  });

  it('does not leave a trailing CR on the subject of a CRLF message', () => {
    expect(splitMessage('Fix bug\r\n\r\nDetails\r\n')).toEqual({ subject: 'Fix bug', body: 'Details' });
  });

  it('keeps indentation of the first body line', () => {
    expect(splitMessage('Subject\n\n  - item\n  - item 2')).toEqual({ subject: 'Subject', body: '  - item\n  - item 2' });
  });
});
