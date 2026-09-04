jest.mock('./dom', () => {
  const tbody = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    appendChild: jest.fn(),
    innerHTML: ''
  };
  return {
    elements: {
      commitsTbody: tbody,
      tableContainer: { scrollTop: 0, clientHeight: 500 },
      graphSvg: { querySelector: jest.fn() }
    }
  };
});

jest.mock('./svgRenderer', () => ({
  drawSvg: jest.fn(),
  selectCircleInGraph: jest.fn(),
  highlightLane: jest.fn(),
  clearLaneHighlight: jest.fn()
}));

import { initVirtualListEvents } from './virtualList';
import { elements } from './dom';

describe('virtualList event delegation', () => {
  it('registers delegated mouseover and mouseout on commitsTbody', () => {
    initVirtualListEvents();
    expect(elements.commitsTbody.addEventListener).toHaveBeenCalledWith('mouseover', expect.any(Function));
    expect(elements.commitsTbody.addEventListener).toHaveBeenCalledWith('mouseout', expect.any(Function));
  });
});
