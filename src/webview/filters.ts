import { state } from './state';
import { elements } from './dom';


export function getFilters() {
  let sinceVal = undefined;
  let untilVal = undefined;

  const preset = elements.datePresetSelect.value;
  if (preset === '24h') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    sinceVal = d.toISOString().split('T')[0];
  } else if (preset === '7d') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    sinceVal = d.toISOString().split('T')[0];
  } else if (preset === '30d') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    sinceVal = d.toISOString().split('T')[0];
  } else if (preset === 'custom') {
    sinceVal = elements.sinceDate.value || undefined;
    untilVal = elements.untilDate.value || undefined;
  }

  return {
    branch: elements.branchSelect.value || undefined,
    author: elements.authorSelect.value || undefined,
    since: sinceVal,
    until: untilVal,
    query: elements.searchInput.value.trim() || undefined
  };
}

export function adjustSelectWidth(select: HTMLSelectElement) {
  if (select.value === "") {
    select.classList.add('placeholder-selected');
  } else {
    select.classList.remove('placeholder-selected');
  }

  let measurer = document.getElementById('select-width-measurer');
  if (!measurer) {
    measurer = document.createElement('span');
    measurer.id = 'select-width-measurer';
    measurer.style.position = 'absolute';
    measurer.style.visibility = 'hidden';
    measurer.style.whiteSpace = 'pre';
    measurer.style.fontFamily = select.style.fontFamily || 'var(--font-family)';
    measurer.style.fontSize = '11px';
    measurer.style.fontWeight = 'normal';
    document.body.appendChild(measurer);
  }
  const selectedOption = select.options ? select.options[select.selectedIndex] : undefined;
  measurer.textContent = selectedOption ? selectedOption.text : '';
  const width = measurer.offsetWidth + 28;
  select.style.width = `${width}px`;
}

export function updateSelectWidths() {
  adjustSelectWidth(elements.branchSelect);
  adjustSelectWidth(elements.authorSelect);
  adjustSelectWidth(elements.datePresetSelect);
}

export function updateFilterControls() {
  let currentBranchValue = elements.branchSelect.value;
  if (elements.branchSelect.dataset.restoredValue !== undefined) {
    currentBranchValue = elements.branchSelect.dataset.restoredValue;
    delete elements.branchSelect.dataset.restoredValue;
  }
  elements.branchSelect.innerHTML = '<option value="">分支</option>';
  state.branches.forEach(b => {
    const option = document.createElement('option');
    option.value = b;
    option.textContent = b;
    if (b === currentBranchValue) option.selected = true;
    elements.branchSelect.appendChild(option);
  });

  let currentAuthorValue = elements.authorSelect.value;
  if (elements.authorSelect.dataset.restoredValue !== undefined) {
    currentAuthorValue = elements.authorSelect.dataset.restoredValue;
    delete elements.authorSelect.dataset.restoredValue;
  }
  elements.authorSelect.innerHTML = '<option value="">作者</option>';
  state.authors.forEach(a => {
    const option = document.createElement('option');
    option.value = a;
    option.textContent = a;
    if (a === currentAuthorValue) option.selected = true;
    elements.authorSelect.appendChild(option);
  });

  updateSelectWidths();
}

export function initFilters(onFilterChange: () => void) {
  elements.branchSelect.addEventListener('change', () => {
    adjustSelectWidth(elements.branchSelect);
    onFilterChange();
  });
  elements.authorSelect.addEventListener('change', () => {
    adjustSelectWidth(elements.authorSelect);
    onFilterChange();
  });
  elements.datePresetSelect.addEventListener('change', () => {
    adjustSelectWidth(elements.datePresetSelect);
    if (elements.datePresetSelect.value === 'custom') {
      elements.dateRangeGroup.classList.remove('hidden');
    } else {
      elements.dateRangeGroup.classList.add('hidden');
      elements.sinceDate.value = '';
      elements.untilDate.value = '';
    }
    onFilterChange();
  });
  elements.sinceDate.addEventListener('change', () => onFilterChange());
  elements.untilDate.addEventListener('change', () => onFilterChange());

  let searchTimeout: any;
  elements.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    elements.searchInput.style.opacity = '0.55'; // 防抖等待期间给出视觉反馈
    searchTimeout = setTimeout(() => {
      elements.searchInput.style.opacity = '';
      onFilterChange();
    }, 350);
  });

  elements.resetBtn.addEventListener('click', () => {
    elements.branchSelect.value = '';
    elements.authorSelect.value = '';
    elements.datePresetSelect.value = '';
    elements.sinceDate.value = '';
    elements.untilDate.value = '';
    elements.dateRangeGroup.classList.add('hidden');
    elements.searchInput.value = '';
    updateSelectWidths();
    onFilterChange();
  });
}
