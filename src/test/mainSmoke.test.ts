import { state } from '../webview/state';
import { elements } from '../webview/dom';

// We need to mock dom.ts before main.ts imports it
jest.mock('../webview/dom', () => {
  return {
    elements: new Proxy({}, {
      get: (target, prop) => {
        const el = document.createElement('div');
        el.id = prop as string;
        // Mock style for width
        Object.defineProperty(el, 'style', { value: { width: '100px' } });
        if (prop === 'addEventListener') {
          return jest.fn();
        }
        return {
          innerHTML: '',
          value: '',
          dataset: {},
          appendChild: jest.fn(),
          addEventListener: jest.fn(),
          style: { width: '100px' },
          classList: {
            add: jest.fn(),
            remove: jest.fn(),
            toggle: jest.fn(),
            contains: jest.fn(() => false)
          },
          querySelector: jest.fn(),
          querySelectorAll: jest.fn(() => []),
          id: prop as string
        };
      }
    })
  };
});

describe('main.ts Smoke Test', () => {
  it('should initialize without throwing', async () => {
    (global as any).window = {
      vscode: {
        setState: jest.fn(),
        getState: jest.fn(() => ({})),
        postMessage: jest.fn()
      },
      addEventListener: jest.fn(),
      _pendingForceExpand: false
    };
    (global as any).acquireVsCodeApi = () => (global as any).window.vscode;
    (global as any).document = {
      getElementById: jest.fn(() => ({ addEventListener: jest.fn(), tagName: 'DIV', setAttribute: jest.fn(), appendChild: jest.fn(), style: {}, classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn(), contains: jest.fn(() => false) } })),
      querySelector: jest.fn(() => ({ addEventListener: jest.fn(), tagName: 'DIV', setAttribute: jest.fn(), appendChild: jest.fn(), style: {}, classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn(), contains: jest.fn(() => false) } })),
      createElement: jest.fn((tag) => ({ tagName: tag.toUpperCase(), setAttribute: jest.fn(), appendChild: jest.fn(), style: {} })),
      addEventListener: jest.fn(),
    };

    // Load main.ts
    // Wait, since main.ts has side effects on load, we require it
    expect(() => {
      require('../webview/main');
    }).not.toThrow();
  });
});
