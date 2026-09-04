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

    it('renders a branch badge with overrideColor', () => {
      const html = makeBadgeHtml('feature', undefined, '#ff00ff');
      expect(html).toContain('badge-branch');
      expect(html).toContain('feature');
      expect(html).toContain('#ff00ff');
    });

    it('renders a Working Tree badge', () => {
      const html = makeBadgeHtml('Working Tree');
      expect(html).toContain('badge-working-tree');
      expect(html).toContain('工作区');
      expect(html).toContain('codicon-edit');
    });

    it('renders worktree indicator when branch is checked out in another worktree', () => {
      state.worktrees = [
        { path: '/mock/path', headHash: '111', isBare: false, isLocked: false, isCurrent: true },
        { path: '/mock/worktrees/hotfix', headHash: '222', branch: 'hotfix', isBare: false, isLocked: false, isCurrent: false }
      ];
      const html = makeBadgeHtml('hotfix');
      expect(html).toContain('hotfix ⎇ hotfix');
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
      let innerHTML = '';
      const classListSet = new Set<string>();
      mockContainer = {
        get innerHTML() {
          return innerHTML;
        },
        set innerHTML(val: string) {
          innerHTML = val;
        },
        classList: {
          add: (cls: string) => classListSet.add(cls),
          remove: (cls: string) => classListSet.delete(cls),
          contains: (cls: string) => classListSet.has(cls)
        }
      };
    });

    it('renders all badges in container', () => {
      const commit = {
        decorations: ['tag: v2.1.251', 'origin/main']
      };
      renderDetailBadges(commit, 'hash123', mockContainer);
      expect(mockContainer.innerHTML).toContain('v2.1.251');
      expect(mockContainer.innerHTML).toContain('origin/main');
      expect(mockContainer.classList.contains('hidden')).toBe(false);
    });

    it('does not duplicate inferred lane branch if origin/remote already exists', () => {
      state.commitBranchLabel['hash123'] = { name: 'feature-abc', color: '#ff0000' };
      const commit = {
        decorations: ['origin/feature-abc']
      };
      renderDetailBadges(commit, 'hash123', mockContainer);
      expect(mockContainer.innerHTML).toContain('origin/feature-abc');
      // Should only contain 1 badge and not duplicate feature-abc
      const matches = mockContainer.innerHTML.match(/feature-abc/g);
      expect(matches?.length).toBe(2); // One in title attribute, one in span text of the single badge
    });

    it('renders inferred lane branch if commit has no decorations', () => {
      state.commitBranchLabel['hash123'] = { name: 'feature-xyz', color: '#00ff00' };
      const commit = { decorations: [] };
      renderDetailBadges(commit, 'hash123', mockContainer);
      expect(mockContainer.innerHTML).toContain('feature-xyz');
      expect(mockContainer.classList.contains('hidden')).toBe(false);
    });

    it('hides container when no badges exist and no lane branch', () => {
      const commit = { decorations: [] };
      renderDetailBadges(commit, 'hash123', mockContainer);
      expect(mockContainer.innerHTML).toBe('');
      expect(mockContainer.classList.contains('hidden')).toBe(true);
    });
  });
});
