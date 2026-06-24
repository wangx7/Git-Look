import { state } from './state';
import { RightPaneState } from './types';
import {
  setRightPane,
  setRightPaneVisible,
  setRightPaneStateByNumber,
  ensureDetailsExpanded,
  onRightPaneStateChange
} from './rightPane';

// Mock dom.ts
jest.mock('./dom', () => {
  const mockEl = () => {
    const classList = {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn(() => false)
    };
    return {
      classList,
      style: {},
      innerHTML: '',
      addEventListener: jest.fn()
    };
  };
  return {
    elements: {
      overviewStats: mockEl(),
      detailsContent: mockEl(),
      authorStatsPane: mockEl(),
      detailsPlaceholder: mockEl(),
      selectionHistoryEl: mockEl(),
      mainLayoutEl: mockEl(),
    }
  };
});

describe('rightPane', () => {
  beforeEach(() => {
    // Reset state
    state.rightPaneVisible = 1;
    state.rightPaneState = RightPaneState.LOADING;
    state.selectedCommitHash = null;
    state.currentFocusedAuthor = null;

    // Mock VS Code API and window
    (global as any).window = {
      vscode: {
        postMessage: jest.fn()
      },
      dispatchEvent: jest.fn()
    };

    // Mock document.getElementById
    const mockElement = { classList: { add: jest.fn(), remove: jest.fn() } };
    (global as any).document = {
      getElementById: jest.fn(() => mockElement)
    };
  });

  it('should set right pane visibility and dispatch events', () => {
    setRightPaneVisible(0);
    expect(state.rightPaneVisible).toBe(0);
    expect(window.vscode.postMessage).toHaveBeenCalledWith({
      command: 'blameVisibilityChanged',
      state: 0
    });
  });

  it('should transition pane state correctly', () => {
    setRightPane(RightPaneState.OVERVIEW);
    expect(state.rightPaneState).toBe(RightPaneState.OVERVIEW);
    expect(state.rightPaneVisible).toBe(1); // Auto-expand when a view is activated

    setRightPane(RightPaneState.LOADING);
    expect(state.rightPaneState).toBe(RightPaneState.LOADING);
  });

  it('should support callback registration on state change', () => {
    const callback = jest.fn();
    onRightPaneStateChange(callback);

    setRightPaneStateByNumber(1); // Overview
    expect(state.rightPaneState).toBe(RightPaneState.OVERVIEW);
    expect(callback).toHaveBeenCalledTimes(1);

    ensureDetailsExpanded();
    expect(state.rightPaneVisible).toBe(1);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should handle different pane numbers correctly', () => {
    setRightPaneStateByNumber(0);
    expect(state.rightPaneVisible).toBe(0);

    state.selectedCommitHash = '1234567';
    setRightPaneStateByNumber(2);
    expect(state.rightPaneState).toBe(RightPaneState.COMMIT);

    state.selectedCommitHash = null;
    state.currentFocusedAuthor = 'Author Name';
    setRightPaneStateByNumber(2);
    expect(state.rightPaneState).toBe(RightPaneState.AUTHOR);
  });
});
