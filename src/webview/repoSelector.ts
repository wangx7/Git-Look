import { state } from './state';
import { elements } from './dom';
import { adjustSelectWidth } from './filters';

/** Populate the repo selector dropdown from state.repos. */
export function updateRepoSelector() {
  if (!elements.repoSelect) {
    return;
  }

  const prevValue = elements.repoSelect.value;

  elements.repoSelect.innerHTML = '';

  if (state.repos.length === 0) {
    elements.repoSelect.innerHTML = '<option value="">无仓库</option>';
    adjustSelectWidth(elements.repoSelect);
    return;
  }

  state.repos.forEach((repo, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = repo.name;
    if (index === state.selectedRepoIndex) {
      option.selected = true;
    }
    elements.repoSelect.appendChild(option);
  });

  adjustSelectWidth(elements.repoSelect);

  // Restore selection if it was programmatically changed
  if (prevValue && prevValue !== elements.repoSelect.value) {
    // selection changed externally — already reflected in state
  }
}

/** Show the empty state (no git repo found). */
export function showEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.classList.remove('hidden');
  }
  // Hide filter bar elements that are irrelevant without a repo
  if (elements.repoSelectorGroup) {
    elements.repoSelectorGroup.classList.remove('hidden');
  }
}

/** Hide the empty state (repos available). */
export function hideEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.classList.add('hidden');
  }
}

/** Show or hide the repo selector based on number of repos. */
export function updateRepoSelectorVisibility() {
  if (!elements.repoSelect || !elements.repoSelectorGroup) {
    return;
  }
  // Hide the selector when there's only one repo (nothing to switch)
  if (state.repos.length <= 1) {
    elements.repoSelectorGroup.classList.add('hidden');
  } else {
    elements.repoSelectorGroup.classList.remove('hidden');
  }
}
