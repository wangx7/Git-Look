import { makeBadgeHtml, renderInlineBadges, renderDetailBadges } from './badgeRenderer';
import { state } from './state';

describe('badgeRenderer', () => {
  beforeEach(() => {
    state.branchColorMap.clear();
    state.remoteBranches = ['origin/main', 'origin/feature'];
    state.commitBranchLabel = {};
  });

  describe('makeBadgeHtml', () => {
    it('renders a branch badge', () => {
      state.branchColorMap.set('main', '#00ff00');
      const html = makeBadgeHtml('main');
      expect(html).toContain('badge-branch');
      expect(html).toContain('main');
      expect(html).toContain('codicon-git-branch');
    });

    it('renders a tag badge', () => {
      const html = makeBadgeHtml('tag: v2.1.251');
      expect(html).toContain('badge-tag');
      expect(html).toContain('v2.1.251');
      expect(html).toContain('codicon-tag');
    });

    it('renders a remote branch badge', () => {
      const html = makeBadgeHtml('origin/main');
      expect(html).toContain('badge-remote-branch');
      expect(html).toContain('origin/main');
      expect(html).toContain('codicon-cloud');
    });

    it('renders a HEAD badge', () => {
      const html = makeBadgeHtml('HEAD');
      expect(html).toContain('badge-head');
      expect(html).toContain('HEAD');
      expect(html).toContain('codicon-circle-filled');
    });
  });

  describe('renderInlineBadges', () => {
    it('returns empty string if no decorations', () => {
      expect(renderInlineBadges({})).toBe('');
      expect(renderInlineBadges({ decorations: [] })).toBe('');
    });

    it('renders single badge when only one decoration exists', () => {
      const html = renderInlineBadges({ decorations: ['tag: v2.1.251'] });
      expect(html).toContain('v2.1.251');
      expect(html).not.toContain('badge-overflow');
    });

    it('renders top 2 priority badges + overflow count for remaining', () => {
      const html = renderInlineBadges({
        decorations: ['tag: v2.1.251', 'origin/main', 'origin/HEAD']
      });
      expect(html).toContain('v2.1.251');
      expect(html).toContain('origin/main');
      expect(html).toContain('badge-overflow');
      expect(html).toContain('+1');
      expect(html).toContain('title="origin/HEAD"');
    });

    it('prioritizes local branch and tags over remotes', () => {
      const html = renderInlineBadges({
        decorations: ['origin/HEAD', 'tag: v2.1.251', 'origin/main', 'main']
      });
      expect(html).toContain('main');
      expect(html).toContain('v2.1.251');
      expect(html).toContain('badge-overflow');
      expect(html).toContain('+2');
      expect(html).toContain('title="origin/main, origin/HEAD"');
    });

    it('handles HEAD with local branch and remotes properly', () => {
      const html = renderInlineBadges({
        decorations: ['HEAD', 'main', 'origin/main', 'origin/HEAD']
      });
      expect(html).toContain('HEAD → main');
      expect(html).toContain('origin/main');
      expect(html).toContain('badge-overflow');
      expect(html).toContain('+1');
      expect(html).toContain('title="origin/HEAD"');
    });
  });

  describe('renderDetailBadges', () => {
    let mockContainer: any;

    beforeEach(() => {
      const children: any[] = [];
      const classListSet = new Set<string>();
      mockContainer = {
        children,
        innerHTML: '',
        classList: {
          add: (cls: string) => classListSet.add(cls),
          remove: (cls: string) => classListSet.delete(cls),
          contains: (cls: string) => classListSet.has(cls)
        },
        appendChild: (child: any) => {
          children.push(child);
        }
      };

      (global as any).document = {
        createElement: (tag: string) => {
          let innerHTML = '';
          return {
            tagName: tag.toUpperCase(),
            style: { cssText: '' },
            className: '',
            get innerHTML() {
              return innerHTML;
            },
            set innerHTML(val: string) {
              innerHTML = val;
              if (val) {
                this.firstElementChild = {
                  tagName: 'SPAN',
                  className: 'ref-badge'
                };
              }
            },
            firstElementChild: null
          };
        }
      };
    });

    it('renders all badges in container', () => {
      const commit = {
        decorations: ['tag: v2.1.251', 'origin/main']
      };
      renderDetailBadges(commit, 'hash123', mockContainer);
      expect(mockContainer.children.length).toBe(2);
      expect(mockContainer.classList.contains('hidden')).toBe(false);
    });

    it('hides container when no badges exist', () => {
      const commit = { decorations: [] };
      renderDetailBadges(commit, 'hash123', mockContainer);
      expect(mockContainer.classList.contains('hidden')).toBe(true);
    });
  });
});
