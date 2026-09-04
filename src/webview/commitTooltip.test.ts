import { showCommitTooltip, hideCommitTooltip, initCommitTooltip, _resetPopoverForTest } from './commitTooltip';
import { state } from './state';

describe('commitTooltip', () => {
  let mockPopover: any;
  let mockBody: any;

  beforeEach(() => {
    jest.useFakeTimers();
    _resetPopoverForTest();

    state.commits = [
      {
        hash: 'a1b2c3d4e5f6',
        parents: [],
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1600000000,
        decorations: ['main', 'tag: v1.0'],
        message: 'feat: amazing new feature that is quite long and detailed'
      }
    ];

    mockPopover = {
      id: '',
      className: '',
      innerHTML: '',
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(() => false)
      },
      style: {
        left: '',
        top: ''
      },
      getBoundingClientRect: jest.fn(() => ({
        width: 300,
        height: 120,
        top: 0,
        left: 0,
        right: 300,
        bottom: 120
      }))
    };

    mockBody = {
      appendChild: jest.fn()
    };

    (global as any).document = {
      createElement: jest.fn(() => mockPopover),
      body: mockBody,
      addEventListener: jest.fn()
    };

    (global as any).window = {
      innerWidth: 1024,
      innerHeight: 768
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows tooltip with commit details and calculates position', () => {
    const commit = state.commits[0];
    showCommitTooltip(commit, 100, 200);

    expect(mockPopover.innerHTML).toContain('a1b2c3d');
    expect(mockPopover.innerHTML).toContain('feat: amazing new feature');
    expect(mockPopover.innerHTML).toContain('Alice');
    expect(mockPopover.innerHTML).toContain('main');
    expect(mockPopover.classList.add).toHaveBeenCalledWith('visible');
    expect(mockPopover.style.left).toBe('112px');
    expect(mockPopover.style.top).toBe('216px');
  });

  it('hides tooltip properly', () => {
    const commit = state.commits[0];
    showCommitTooltip(commit, 100, 200);
    hideCommitTooltip();
    expect(mockPopover.classList.remove).toHaveBeenCalledWith('visible');
  });

  it('initializes event listeners on tbody and container', () => {
    const tbodyMock = {
      addEventListener: jest.fn()
    };
    const containerMock = {
      addEventListener: jest.fn()
    };

    initCommitTooltip(tbodyMock as any, containerMock as any);

    expect(tbodyMock.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(tbodyMock.addEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));
    expect(containerMock.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    expect(document.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('renders inferred lane branch in tooltip when commit has no decorations', () => {
    state.commitBranchLabel['hash93bba8e'] = {
      name: 'fix/http-proxy-rc-version',
      color: '#10b981'
    };
    const commit = {
      hash: 'hash93bba8e',
      parents: ['parent1'],
      author: 'Yichen Jiang',
      email: 'yj@example.com',
      timestamp: 1600000000,
      decorations: [],
      message: 'fix(http-proxy): withhold NODE_USE_ENV_PROXY'
    };

    showCommitTooltip(commit, 100, 200);
    expect(mockPopover.innerHTML).toContain('fix/http-proxy-rc-version');
    expect(mockPopover.innerHTML).toContain('#10b981');
  });
});
