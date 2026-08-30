import { getRelativeTime, formatDate, formatDateShort, formatCommitDate, escapeHtml, hexToRgba, getAvatarColor, getInitials, fmtNum } from './format';

describe('Format Utils', () => {
  it('getRelativeTime should format timestamps correctly', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(getRelativeTime(now - 30)).toBe('刚刚');
    expect(getRelativeTime(now - 120)).toBe('2 分钟前');
    expect(getRelativeTime(now - 7200)).toBe('2 小时前');
    expect(getRelativeTime(now - 172800)).toBe('2 天前');
  });

  it('formatDate should return YYYY-MM-DD HH:MM', () => {
    // 2023-01-01 12:30:00 (depends on timezone, so let's use a specific offset or regex)
    const formatted = formatDate(1672547400); // timestamp
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('formatCommitDate should format dates relative to reference time', () => {
    // Mock "now" as 2026-07-04 12:00:00 local time
    const mockNow = new Date(2026, 6, 4, 12, 0, 0); // Month is 0-indexed, so 6 is July

    // Case 1: 30 seconds ago
    expect(formatCommitDate(Math.floor(mockNow.getTime() / 1000) - 30, mockNow)).toBe('刚刚');

    // Case 2: 2 minutes ago
    expect(formatCommitDate(Math.floor(mockNow.getTime() / 1000) - 120, mockNow)).toBe('2 分钟前');

    // Case 3: 2 hours ago
    expect(formatCommitDate(Math.floor(mockNow.getTime() / 1000) - 7200, mockNow)).toBe('2 小时前');

    // Case 4: 2 days ago
    expect(formatCommitDate(Math.floor(mockNow.getTime() / 1000) - 172800, mockNow)).toBe('2 天前');

    // Case 5: 2 months ago (using 2592000 * 2 = 5184000 seconds)
    expect(formatCommitDate(Math.floor(mockNow.getTime() / 1000) - 5184000, mockNow)).toBe('2 个月前');

    // Case 6: 2 years ago (using 31536000 * 2 = 63072000 seconds)
    expect(formatCommitDate(Math.floor(mockNow.getTime() / 1000) - 63072000, mockNow)).toBe('2 年前');
  });

  it('escapeHtml should escape special characters', () => {
    expect(escapeHtml('<script>alert("1")</script>&')).toBe('&lt;script&gt;alert(&quot;1&quot;)&lt;/script&gt;&amp;');
  });

  it('hexToRgba should convert correctly', () => {
    expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(hexToRgba('#00ff00', 1)).toBe('rgba(0, 255, 0, 1)');
  });

  it('getInitials should extract initials', () => {
    expect(getInitials('John Doe')).toBe('JD');
    expect(getInitials('John')).toBe('JO');
    expect(getInitials('李四')).toBe('四'); // Chinese support
    expect(getInitials('王五六')).toBe('六');
    expect(getInitials('不见月')).toBe('月');
  });

  it('fmtNum should format numbers compactly', () => {
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(500)).toBe('500');
    expect(fmtNum(1500)).toBe('1.5k');
    expect(fmtNum(2500000)).toBe('2.5M');
  });
});
