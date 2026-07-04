import { state } from './state';
import {
  getFilters,
  adjustSelectWidth,
  updateSelectWidths,
  updateFilterControls,
  initFilters
} from './filters';

// Mock dom.ts
jest.mock('./dom', () => {
  const mockSelect = () => {
    const options = [
      { text: 'Option 1', value: 'opt1', selected: false },
      { text: 'Option 2', value: 'opt2', selected: false }
    ];
    const classList = {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn(() => false)
    };
    const parentClassList = {
      add: jest.fn(),
      remove: jest.fn()
    };
    return {
      classList,
      options,
      selectedIndex: 0,
      value: '',
      innerHTML: '',
      addEventListener: jest.fn(),
      appendChild: jest.fn(),
      style: {},
      dataset: {},
      parentElement: {
        classList: parentClassList
      }
    };
  };

  const mockInput = () => {
    const parentClassList = {
      add: jest.fn(),
      remove: jest.fn()
    };
    return {
      value: '',
      style: {},
      addEventListener: jest.fn(),
      parentElement: {
        classList: parentClassList
      }
    };
  };

  const mockEl = () => {
    return {
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        toggle: jest.fn(),
        contains: jest.fn(() => false)
      },
      addEventListener: jest.fn()
    };
  };

  return {
    elements: {
      branchSelect: mockSelect(),
      authorSelect: mockSelect(),
      datePresetSelect: mockSelect(),
      sinceDate: mockInput(),
      untilDate: mockInput(),
      searchInput: mockInput(),
      dateRangeGroup: mockEl(),
      resetBtn: mockEl()
    }
  };
});

describe('filters', () => {
  beforeEach(() => {
    // Reset state lists
    state.branches = ['main', 'dev'];
    state.authors = ['John Doe', 'Alice'];

    // Mock document methods
    (global as any).document = {
      body: {
        appendChild: jest.fn()
      },
      createElement: jest.fn(() => {
        return {
          id: '',
          style: {},
          textContent: '',
          offsetWidth: 50,
          value: '',
          textContentSetter: jest.fn()
        };
      }),
      getElementById: jest.fn(() => {
        return {
          id: 'select-width-measurer',
          style: {},
          textContent: '',
          offsetWidth: 50
        };
      })
    };
  });

  it('should return correct filters object', () => {
    const { elements } = require('./dom');
    elements.branchSelect.value = 'main';
    elements.authorSelect.value = 'John Doe';
    elements.datePresetSelect.value = '';
    elements.searchInput.value = '   feat: test   ';

    const filters = getFilters();
    expect(filters).toEqual({
      branch: 'main',
      author: 'John Doe',
      since: undefined,
      until: undefined,
      query: 'feat: test'
    });
  });

  it('should adjust select width based on measuring element', () => {
    const { elements } = require('./dom');
    adjustSelectWidth(elements.branchSelect as any);
    expect(elements.branchSelect.style.width).toBe('78px'); // 50 offsetWidth + 28
  });

  it('should build filter options correctly during updateFilterControls', () => {
    const { elements } = require('./dom');
    updateFilterControls();
    expect(elements.branchSelect.innerHTML).toContain('分支');
    expect(elements.authorSelect.innerHTML).toContain('作者');
  });

  it('should add is-empty class to select parent if value is empty', () => {
    const { elements } = require('./dom');
    elements.branchSelect.value = '';
    adjustSelectWidth(elements.branchSelect as any);
    expect(elements.branchSelect.parentElement.classList.add).toHaveBeenCalledWith('is-empty');

    elements.branchSelect.value = 'main';
    adjustSelectWidth(elements.branchSelect as any);
    expect(elements.branchSelect.parentElement.classList.remove).toHaveBeenCalledWith('is-empty');
  });

  it('should add/remove has-value class to search input parent based on value', () => {
    const { elements } = require('./dom');
    elements.searchInput.value = '';
    updateSelectWidths();
    expect(elements.searchInput.parentElement.classList.remove).toHaveBeenCalledWith('has-value');

    elements.searchInput.value = 'test query';
    updateSelectWidths();
    expect(elements.searchInput.parentElement.classList.add).toHaveBeenCalledWith('has-value');
  });

  it('should bind change and click events on initFilters', () => {
    const { elements } = require('./dom');
    const onFilterChange = jest.fn();
    initFilters(onFilterChange);

    expect(elements.branchSelect.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(elements.authorSelect.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(elements.datePresetSelect.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(elements.resetBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });
});
