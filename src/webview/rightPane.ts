import { state } from './state';
import { elements } from './dom';
import { RightPaneState } from './types';

export function checkBlameState() {
  const stateNum = state.getRightPaneStateNumber();
  window.vscode.postMessage({ command: 'blameVisibilityChanged', state: stateNum });
}

export function setRightPane(paneState: any) {
  state.rightPaneState = paneState;
  elements.overviewStats.classList.add('hidden');
  elements.detailsContent.classList.add('hidden');
  elements.authorStatsPane.classList.add('hidden');
  elements.detailsPlaceholder.classList.add('hidden');
  if (elements.selectionHistoryEl) {
    elements.selectionHistoryEl.classList.add('hidden');
  }
  if (elements.fileHistoryEl) {
    elements.fileHistoryEl.classList.add('hidden');
  }
  const fileBlameStatsEl = document.getElementById('file-blame-stats');
  if (fileBlameStatsEl) {
    fileBlameStatsEl.classList.add('hidden');
  }

  if (paneState === RightPaneState.LOADING) {
    elements.detailsPlaceholder.classList.remove('hidden');
  } else if (paneState === RightPaneState.OVERVIEW) {
    elements.overviewStats.classList.remove('hidden');
  } else if (paneState === RightPaneState.COMMIT) {
    elements.detailsContent.classList.remove('hidden');
  } else if (paneState === RightPaneState.AUTHOR) {
    elements.authorStatsPane.classList.remove('hidden');
  } else if (paneState === RightPaneState.HISTORY) {
    if (elements.selectionHistoryEl) {
      elements.selectionHistoryEl.classList.remove('hidden');
    }
  } else if (paneState === RightPaneState.FILE_HISTORY) {
    if (elements.fileHistoryEl) {
      elements.fileHistoryEl.classList.remove('hidden');
    }
  } else if (paneState === RightPaneState.FILE_BLAME_STATS) {
    if (fileBlameStatsEl) {
      fileBlameStatsEl.classList.remove('hidden');
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

export function setRightPaneStateByNumber(num: number) {
  if (num === 0) {
    setRightPaneVisible(0);
  } else {
    setRightPaneVisible(1);
    if (num === 1) {
      setRightPane(RightPaneState.OVERVIEW);
    } else if (num === 2) {
      if (state.selectedCommitHash) {
        setRightPane(RightPaneState.COMMIT);
      } else if (state.currentFocusedAuthor) {
        setRightPane(RightPaneState.AUTHOR);
      } else {
        setRightPane(RightPaneState.OVERVIEW);
      }
    } else if (num === 3) {
      setRightPane(RightPaneState.HISTORY);
    } else if (num === 4) {
      setRightPane(RightPaneState.FILE_BLAME_STATS);
    } else if (num === 5) {
      setRightPane(RightPaneState.FILE_HISTORY);
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
