import { StateManager } from './state';
import { RightPaneState } from './types';

describe('StateManager', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
    (global as any).window = {
      vscode: {
        setState: jest.fn(),
        getState: jest.fn(),
        postMessage: jest.fn()
      }
    };
  });

  it('should initialize with default values', () => {
    expect(state.commits).toEqual([]);
    expect(state.rightPaneVisible).toBe(1);
    expect(state.rightPaneState).toBe(RightPaneState.LOADING);
  });

  it('should correctly map right pane state to number', () => {
    expect(state.getRightPaneStateNumber()).toBe(1); // LOADING defaults to 1

    state.rightPaneState = RightPaneState.OVERVIEW;
    expect(state.getRightPaneStateNumber()).toBe(1);

    state.rightPaneState = RightPaneState.COMMIT;
    expect(state.getRightPaneStateNumber()).toBe(2);

    state.rightPaneState = RightPaneState.HISTORY;
    expect(state.getRightPaneStateNumber()).toBe(3);

    state.rightPaneState = RightPaneState.FILE_BLAME_STATS;
    expect(state.getRightPaneStateNumber()).toBe(4);

    state.rightPaneVisible = 0;
    expect(state.getRightPaneStateNumber()).toBe(0);
  });

  it('should mock VS Code state saving', () => {
    const setStateMock = jest.fn();
    (global as any).window = {
      vscode: {
        setState: setStateMock,
        getState: jest.fn(),
        postMessage: jest.fn()
      }
    };

    state.currentPage = 2;
    state.hasMoreCommits = false;
    state.saveCurrentState({ branch: 'main' }, '300px');

    expect(setStateMock).toHaveBeenCalledWith(expect.objectContaining({
      currentPage: 2,
      hasMoreCommits: false,
      filters: { branch: 'main' },
      detailsWidth: '300px'
    }));
  });
});
