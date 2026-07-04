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

  it('formatCommitDate should format dates according to context rules', () => {
    // Mock "now" as 2026-07-04 12:00:00 local time
    const mockNow = new Date(2026, 6, 4, 12, 0, 0); // Month is 0-indexed, so 6 is July

    // Case 1: Today (2026-07-04 08:30:00 local)
    const todayDate = new Date(2026, 6, 4, 8, 30, 0);
    const todayTimestamp = Math.floor(todayDate.getTime() / 1000);
    expect(formatCommitDate(todayTimestamp, mockNow)).toBe('08时30分');

    // Case 2: Within this month, but not today (2026-07-03 08:30:00 local)
    const thisMonthDate = new Date(2026, 6, 3, 8, 30, 0);
    const thisMonthTimestamp = Math.floor(thisMonthDate.getTime() / 1000);
    expect(formatCommitDate(thisMonthTimestamp, mockNow)).toBe('03日08时');

    // Case 3: Within this year, but not this month (2026-05-15 14:45:00 local)
    const thisYearDate = new Date(2026, 4, 15, 14, 45, 0); // May
    const thisYearTimestamp = Math.floor(thisYearDate.getTime() / 1000);
    expect(formatCommitDate(thisYearTimestamp, mockNow)).toBe('05月15日');

    // Case 4: Outside/before this year (2025-11-20 09:15:00 local)
    const beforeYearDate = new Date(2025, 10, 20, 9, 15, 0); // Nov
    const beforeYearTimestamp = Math.floor(beforeYearDate.getTime() / 1000);
    expect(formatCommitDate(beforeYearTimestamp, mockNow)).toBe('25年11月');
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
    expect(getInitials('李四')).toBe('李四'); // Chinese support
    expect(getInitials('王五六')).toBe('五六');
  });

  it('fmtNum should format numbers compactly', () => {
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(500)).toBe('500');
    expect(fmtNum(1500)).toBe('1.5k');
    expect(fmtNum(2500000)).toBe('2.5M');
  });
});
