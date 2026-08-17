import { state } from './state';
import { elements } from './dom';
import { RightPaneState } from './types';

export function checkBlameState() {
  const stateNum = state.getRightPaneStateNumber();
  window.vscode.postMessage({ command: 'blameVisibilityChanged', state: stateNum });
}

// Map each pane state to its corresponding element getter
const paneElementMap: Record<string, () => HTMLElement | null> = {
  [RightPaneState.LOADING]:          () => elements.detailsPlaceholder,
  [RightPaneState.OVERVIEW]:         () => elements.overviewStats,
  [RightPaneState.COMMIT]:           () => elements.detailsContent,
  [RightPaneState.AUTHOR]:           () => elements.authorStatsPane,
  [RightPaneState.HISTORY]:          () => elements.selectionHistoryEl,
  [RightPaneState.FILE_HISTORY]:     () => elements.fileHistoryEl,
  [RightPaneState.FILE_BLAME_STATS]: () => document.getElementById('file-blame-stats'),
};

// All pane elements that need to be hidden when switching
function getAllPaneElements(): (HTMLElement | null)[] {
  return Object.values(paneElementMap).map(getter => getter());
}

export function setRightPane(paneState: any) {
  state.rightPaneState = paneState;

  // 用户主动切换到非 OVERVIEW/LOADING 视图后，应取消后续 statsLoaded 的"强制切回 OVERVIEW"
  // 否则在 panel 首次打开、消息入队与 statsLoaded 返回的竞态下，会覆盖用户刚选中的视图
  if (paneState !== RightPaneState.OVERVIEW && paneState !== RightPaneState.LOADING) {
    window._pendingForceExpand = false;
  }

  // Hide all pane elements and remove animation class
  getAllPaneElements().forEach(el => {
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('pane-animate');
    }
  });

  // Show the target pane element and trigger fade-in animation
  const getter = paneElementMap[paneState];
  if (getter) {
    const el = getter();
    if (el) {
      el.classList.remove('hidden');
      // Trigger reflow to restart CSS animation
      void el.offsetWidth;
      el.classList.add('pane-animate');
    }
  }

  // Auto-expand when a view is activated (except for loading)
  if (paneState !== RightPaneState.LOADING) {
    setRightPaneVisible(1);
  } else {
    checkBlameState();
  }
}

export function updateDetailsCollapseUI() {
  if (elements.mainLayoutEl) {
    elements.mainLayoutEl.classList.toggle('details-collapsed', state.rightPaneVisible === 0);
    elements.mainLayoutEl.classList.toggle('right-pane-hidden', state.rightPaneVisible === 0);
    if (elements.toggleDetailsBtn) {
      const iconEl = elements.toggleDetailsBtn.querySelector('i');
      elements.toggleDetailsBtn.classList.toggle('active', state.rightPaneVisible === 0);
      if (state.rightPaneVisible === 0) {
        // Panel hidden: off/hollow icon
        if (iconEl) iconEl.className = 'codicon codicon-layout-sidebar-right-off';
        elements.toggleDetailsBtn.title = '显示详情面板';
      } else {
        // Panel visible: on/filled icon
        if (iconEl) iconEl.className = 'codicon codicon-layout-sidebar-right';
        elements.toggleDetailsBtn.title = '隐藏详情面板';
      }
    }
    if (state.rightPaneVisible !== 0) {
      window.dispatchEvent(new Event('detailsExpanded'));
    }
  }
  checkBlameState();
}

export function setRightPaneVisible(visible: number) {
  state.rightPaneVisible = visible;
  updateDetailsCollapseUI();
}

let stateChangeCallback: (() => void) | null = null;

export function onRightPaneStateChange(callback: () => void) {
  stateChangeCallback = callback;
}

const numToStateMap: Record<number, string> = {
  1: RightPaneState.OVERVIEW,
  3: RightPaneState.HISTORY,
  4: RightPaneState.FILE_BLAME_STATS,
  5: RightPaneState.FILE_HISTORY,
};

export function setRightPaneStateByNumber(num: number) {
  if (num === 0) {
    setRightPaneVisible(0);
  } else {
    setRightPaneVisible(1);
    if (num === 2) {
      // Special case: num 2 can be COMMIT or AUTHOR depending on context
      if (state.selectedCommitHash) {
        setRightPane(RightPaneState.COMMIT);
      } else if (state.currentFocusedAuthor) {
        setRightPane(RightPaneState.AUTHOR);
      } else {
        setRightPane(RightPaneState.OVERVIEW);
      }
    } else {
      setRightPane(numToStateMap[num] || RightPaneState.OVERVIEW);
    }
  }
  
  if (stateChangeCallback) {
    stateChangeCallback();
  }
}

export function ensureDetailsExpanded() {
  setRightPaneVisible(1);
  if (stateChangeCallback) {
    stateChangeCallback();
  }
}
