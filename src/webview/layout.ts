import { state } from './state';
import { elements } from './dom';
import { saveCurrentState } from './dataLoader';
import { updateVirtualList } from './virtualList';
import { renderActivityChart } from './statsCharts';
import { setRightPaneVisible } from './rightPane';

export function initLayout() {
  let isDragging = false;

  elements.resizerBar.addEventListener('mousedown', (e) => {
    isDragging = true;
    elements.resizerBar.classList.add('dragging');
    document.body.style.cursor = state.isOverlayMode ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const layoutEl = document.querySelector('.main-layout') as HTMLElement;
    if (state.isOverlayMode) {
      // Stacking mode (vertical resizing)
      const containerHeight = layoutEl.clientHeight;
      const detailsHeight = containerHeight - e.clientY;
      const minHeight = 80;
      const maxHeight = containerHeight * 0.8;
      let finalHeight = Math.max(minHeight, Math.min(maxHeight, detailsHeight));

      elements.detailsPane.style.height = finalHeight + 'px';
      elements.detailsPane.style.width = '100%';

      const leftPaneHeight = containerHeight - finalHeight - 4;
      elements.leftPaneEl.style.height = leftPaneHeight + 'px';
      elements.leftPaneEl.style.flex = 'none';
    } else {
      // Horizontal mode
      const containerWidth = layoutEl.clientWidth;
      const detailsWidth = containerWidth - e.clientX;
      const minWidth = 280;
      const maxWidth = containerWidth * 0.6;
      let finalWidth = Math.max(minWidth, Math.min(maxWidth, detailsWidth));

      elements.detailsPane.style.width = finalWidth + 'px';
      elements.detailsPane.style.height = '100%';
      elements.leftPaneEl.style.height = '100%';
      elements.leftPaneEl.style.flex = '1';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      elements.resizerBar.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveCurrentState();
    }
  });

  window.addEventListener('resize', () => {
    state.lastStartIndex = -1;
    state.lastEndIndex = -1;
    updateVirtualList();
  });

  if (elements.leftPaneEl && window.ResizeObserver) {
    const paneObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const w = entries[0].contentRect.width;
      elements.leftPaneEl.classList.toggle('pane-medium', w < 480);
      elements.leftPaneEl.classList.toggle('pane-compact', w < 320);
      elements.leftPaneEl.classList.toggle('pane-narrow', w < 220);

      if (elements.searchInput) {
        if (w < 320) {
          elements.searchInput.placeholder = '搜索…';
        } else if (w < 480) {
          elements.searchInput.placeholder = '搜索';
        } else {
          elements.searchInput.placeholder = '搜索消息或哈希';
        }
      }
    });
    paneObserver.observe(elements.leftPaneEl);
  }

  const overlayBackdrop = document.getElementById('overlay-backdrop');
  const OVERLAY_BREAKPOINT = 550;

  function closeOverlay() {
    elements.detailsPane.classList.remove('overlay-open');
    if (overlayBackdrop) overlayBackdrop.classList.remove('visible');
  }

  if (overlayBackdrop) {
    overlayBackdrop.addEventListener('click', closeOverlay);
  }
  if (elements.detailsCloseBtn) {
    elements.detailsCloseBtn.addEventListener('click', () => {
      setRightPaneVisible(0);
      saveCurrentState();
    });
  }

  if (elements.mainLayoutEl && window.ResizeObserver) {
    const layoutObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const w = entries[0].contentRect.width;
      const shouldBeNarrow = w < OVERLAY_BREAKPOINT;

      if (shouldBeNarrow === state.isOverlayMode) return;
      state.isOverlayMode = shouldBeNarrow;
      elements.mainLayoutEl.classList.toggle('layout-narrow', state.isOverlayMode);
      elements.detailsPane.style.width = '';
      elements.detailsPane.style.height = '';
      elements.leftPaneEl.style.height = '';
      elements.leftPaneEl.style.flex = '';
    });
    layoutObserver.observe(elements.mainLayoutEl);
  }

  if (elements.tableContainer && window.ResizeObserver) {
    const tableResizeObserver = new ResizeObserver(() => {
      state.lastStartIndex = -1;
      state.lastEndIndex = -1;
      updateVirtualList();
    });
    tableResizeObserver.observe(elements.tableContainer);
  }

  if (elements.activitySvg && elements.activitySvg.parentElement && window.ResizeObserver) {
    let resizeTimer: any = null;
    const chartObserver = new ResizeObserver(() => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        if (state.currentStatsData && state.currentStatsData.dailyActivity) {
          renderActivityChart(state.currentStatsData.dailyActivity);
        }
      });
    });
    chartObserver.observe(elements.activitySvg.parentElement);
  }

  const containerContainer = document.querySelector('.container');
  if (containerContainer) {
    containerContainer.addEventListener('click', (e: any) => {
      if (state.getRightPaneStateNumber() === 3 || state.getRightPaneStateNumber() === 4) {
        return; 
      }
      if (!e.target || !e.target.closest) return;

      const inSvg = e.target.closest('#graph-svg');
      const inList = e.target.closest('.list-pane');
      const isRow = e.target.closest('.commit-row');
      const isNode = e.target.closest('.commit-node');

      if ((inSvg || inList) && !isRow && !isNode) {
        if (state.rightPaneVisible === 1) {
          setRightPaneVisible(0);
          saveCurrentState();
        }
        if (state.selectedCommitHash) {
          import('./commitDetail').then(({ collapseDetail }) => collapseDetail());
        }
      }
    });
  }
}
