export const colors = [
  '#3b82f6', // modern blue
  '#10b981', // emerald green
  '#f59e0b', // amber yellow
  '#8b5cf6', // violet purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
  '#84cc16', // lime
  '#6366f1', // indigo
  '#ef4444'  // red
];

export function getRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} 个月前`;
  return `${Math.floor(diff / 31536000)} 年前`;
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatDateShort(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

export function formatCommitDate(timestamp: number, nowInput?: Date): string {
  const now = nowInput || new Date();
  const d = new Date(timestamp * 1000);
  
  const isToday = d.getFullYear() === now.getFullYear() &&
                  d.getMonth() === now.getMonth() &&
                  d.getDate() === now.getDate();
                  
  const hours = String(d.getHours()).padStart(2, '0');
  
  if (isToday) {
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}时${minutes}分`;
  }
  
  const isThisMonth = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth();
                      
  const day = String(d.getDate()).padStart(2, '0');
  
  if (isThisMonth) {
    return `${day}日${hours}时`;
  }
  
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const isThisYear = d.getFullYear() === now.getFullYear();
  
  if (isThisYear) {
    return `${month}月${day}日`;
  }
  
  const yearTwoDigit = String(d.getFullYear()).slice(-2);
  return `${yearTwoDigit}年${month}月`;
}

export function escapeHtml(str: string | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getAvatarColor(name: string | undefined): string {
  if (!name) return colors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  return colors[colorIndex];
}

export function getAvatarGradient(name: string | undefined): string {
  const baseColor = getAvatarColor(name);
  const secondaryColor = getAvatarColor(name ? name.split('').reverse().join('') : 'fallback');
  // Create a mesh-like diagonal gradient
  return `linear-gradient(135deg, ${baseColor} 0%, ${secondaryColor} 100%)`;
}

export function getInitials(name: string | undefined): string {
  if (!name) return '';
  name = name.trim();
  const isChinese = /[\u4e00-\u9fa5]/.test(name);
  if (isChinese) {
    return name.length > 2 ? name.substring(name.length - 2) : name;
  }
  const parts = name.split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

/**
 * Format a Date object to YYYY-MM-DD in LOCAL timezone (not UTC).
 * This is critical because Git interprets date strings in the user's local timezone.
 * Using toISOString() gives UTC date, which can be off by one day for users in non-UTC timezones.
 */
export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
