const fs = require('fs');

let content = fs.readFileSync('src/webview/main.ts', 'utf8');

const stateVars = [
  'commits', 'branches', 'remoteBranches', 'authors',
  'selectedCommitHash', 'expandedRow', 'currentGraphWidth',
  'cachedLines', 'cachedCommitNodes', 'branchColorMap',
  'currentStatsData', 'currentFocusedAuthor', 'commitBranchLabel',
  'isOverlayMode', 'rightPaneVisible', 'lastStartIndex', 'lastEndIndex',
  'rightPaneState', 'isFetching', 'hasMoreCommits', 'currentPage', 'pageSize'
];

const domVars = [
  'branchSelect', 'authorSelect', 'datePresetSelect', 'dateRangeGroup',
  'sinceDate', 'untilDate', 'searchInput', 'resetBtn', 'loadingOverlay',
  'errorBanner', 'commitsTbody', 'graphSvg', 'tableContainer',
  'detailsPane', 'resizerBar', 'detailsCloseBtn', 'detailsPlaceholder',
  'detailsContent', 'detailHashBadge', 'detailMergeBadge', 'detailAuthorAvatar',
  'detailAuthorName', 'detailAuthorDate', 'detailMsgSubject', 'detailMsgBody',
  'detailStatsRow', 'detailFilesTree', 'leftPaneEl', 'mainLayoutEl',
  'selectionHistoryEl', 'statsStrip', 'stripCommitsVal', 'stripAdd',
  'stripDel', 'stripContributorsVal', 'stripRange', 'statsToggleBtn',
  'overviewStats', 'overviewRange', 'ovCommits', 'ovAdd', 'ovDel',
  'activitySvg', 'contributorsList', 'topFilesList', 'authorStatsPane',
  'authorStatsAvatar', 'authorStatsName', 'authorStatsEmail', 'auCommits',
  'auAdd', 'auDel', 'weekdayChart', 'authorTopFiles', 'authorHighlightBtn'
];

stateVars.forEach(v => {
  const regex = new RegExp(`(?<![a-zA-Z0-9_\\.])\\b${v}\\b(?!\\s*:)`, 'g');
  content = content.replace(regex, `state.${v}`);
});

domVars.forEach(v => {
  const regex = new RegExp(`(?<![a-zA-Z0-9_\\.])\\b${v}\\b(?!\\s*:)`, 'g');
  content = content.replace(regex, `elements.${v}`);
});

// Remove declarations
content = content.replace(/\/\/ Elements[\s\S]*?\/\/ State\n/, '// Elements removed\n');
content = content.replace(/\/\/ State[\s\S]*?\/\/ Helper to map UI state/m, '// State removed\n\n  // Helper to map UI state');

fs.writeFileSync('src/webview/main.ts', content);
console.log('Done replacing state and dom variables');
