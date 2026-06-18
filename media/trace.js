(function() {
  const vscode = acquireVsCodeApi();

  // Elements
  const filePathEl = document.getElementById('file-path');
  const lineRangeEl = document.getElementById('line-range');
  const loadingContainer = document.getElementById('loading');
  const errorBanner = document.getElementById('error-message');
  const timelineContainer = document.getElementById('timeline-container');

  // Codicon chevron（替代 SVG）
  const chevronHtml = '<i class="codicon codicon-chevron-right chevron"></i>';

  // ========== 加载延迟（防闪烁） ==========
  let loadingTimer = null;
  function showLoading() {
    loadingTimer = setTimeout(() => {
      loadingContainer.classList.remove('hidden');
    }, 150);
  }
  function hideLoading() {
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    loadingContainer.classList.add('hidden');
  }

  // 初始化时触发加载
  showLoading();

  // Listen for messages from host
  window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
      case 'error':
        hideLoading();
        showError(message.error);
        break;
      case 'traceData':
        hideLoading();
        renderTimeline(message.file, message.startLine, message.endLine, message.commits);
        break;
    }
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  // ========== 相对时间 ==========
  function getRelativeTime(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} 个月前`;
    return `${Math.floor(diff / 31536000)} 年前`;
  }

  function renderTimeline(filePath, startLine, endLine, commits) {
    filePathEl.textContent = filePath;
    lineRangeEl.textContent = `${startLine} - ${endLine} 行`;
    timelineContainer.innerHTML = '';

    if (commits.length === 0) {
      timelineContainer.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.5;">没有找到这段代码的修改记录</div>`;
      return;
    }

    commits.forEach((c, index) => {
      const isOriginal = index === commits.length - 1;
      const isLatest = index === 0;

      const card = document.createElement('div');
      card.className = `commit-card ${isOriginal ? 'original' : ''} ${isLatest ? 'latest' : ''}`;

      // 设置入场动画延迟索引
      card.style.setProperty('--card-index', index);

      // Expand the oldest (original) commit by default so user sees who first wrote it!
      if (isOriginal) {
        card.classList.add('expanded');
      }

      // 使用相对时间显示，绝对时间放在 tooltip
      const relativeTimeStr = getRelativeTime(c.timestamp);
      const absoluteDateStr = formatDate(c.timestamp);

      // Create badges
      let badgesHtml = '';
      if (isOriginal) {
        badgesHtml += `<span class="card-badge badge-original">最初创建</span>`;
      }
      if (isLatest) {
        badgesHtml += `<span class="card-badge badge-latest">最新修改</span>`;
      }

      card.innerHTML = `
        <div class="card-header">
          <div class="commit-info-left">
            ${chevronHtml}
            <span class="commit-hash hash-copyable" title="点击复制完整哈希">${c.hash.substring(0, 7)}</span>
            <span class="commit-message" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
            <span class="commit-author" title="${escapeHtml(c.author)} (${escapeHtml(c.email)})">by ${escapeHtml(c.author)}</span>
            <div class="commit-badges">${badgesHtml}</div>
          </div>
          <div class="commit-info-right">
            <span class="commit-date relative-time" title="${absoluteDateStr}">${relativeTimeStr}</span>
            <button class="action-btn select-commit-btn" data-hash="${c.hash}"><i class="codicon codicon-target"></i> 在图表中定位</button>
          </div>
        </div>
        <div class="card-body">
          <!-- Diff content -->
        </div>
      `;

      // Toggle collapse/expand
      const cardHeader = card.querySelector('.card-header');
      cardHeader.addEventListener('click', (e) => {
        // Prevent toggle if clicked the action button
        if (e.target.closest('.action-btn')) return;

        card.classList.toggle('expanded');
      });

      // 点击 hash 复制到剪贴板
      const hashEl = card.querySelector('.commit-hash');
      hashEl.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(c.hash);
        hashEl.textContent = '已复制!';
        setTimeout(() => { hashEl.textContent = c.hash.substring(0, 7); }, 1500);
      });

      // Action button click
      const actionBtn = card.querySelector('.select-commit-btn');
      actionBtn.addEventListener('click', () => {
        vscode.postMessage({
          command: 'showInGraph',
          hash: c.hash
        });
      });

      // Render diff code inside card body
      const cardBody = card.querySelector('.card-body');
      renderDiff(cardBody, c.diffLines);

      timelineContainer.appendChild(card);
    });

    // ========== 提交摘要信息 ==========
    const summaryEl = document.getElementById('commit-summary');
    summaryEl.classList.remove('hidden');
    summaryEl.textContent = `共 ${commits.length} 次修改 · 最初创建于 ${formatDate(commits[commits.length - 1].timestamp)} · 最近修改于 ${formatDate(commits[0].timestamp)}`;
  }

  // tokenRegex matches standard patterns
  const tokenRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|interface|struct|impl|pub|fn|def|elif|try|catch|import|export|await|async|new|this|type|from|in|is|lambda|and|or|not|public|private|protected|static|void|int|double|float|char|bool|boolean|string)\b)|(\b\d+(?:\.\d+)?\b)|(\b[A-Z]\w*\b)|(\b\w+(?=\s*\())/g;

  function highlightCode(text) {
    if (!text) return '';
    tokenRegex.lastIndex = 0; // Reset regex state
    let lastIndex = 0;
    let html = '';
    let match;
    
    while ((match = tokenRegex.exec(text)) !== null) {
      html += escapeHtml(text.substring(lastIndex, match.index));
      
      const [full, comment, string, keyword, number, type, func] = match;
      if (comment) {
        html += `<span class="token-comment">${escapeHtml(full)}</span>`;
      } else if (string) {
        html += `<span class="token-string">${escapeHtml(full)}</span>`;
      } else if (keyword) {
        html += `<span class="token-keyword">${escapeHtml(full)}</span>`;
      } else if (number) {
        html += `<span class="token-number">${escapeHtml(full)}</span>`;
      } else if (type) {
        html += `<span class="token-type">${escapeHtml(full)}</span>`;
      } else if (func) {
        html += `<span class="token-function">${escapeHtml(full)}</span>`;
      } else {
        html += escapeHtml(full);
      }
      
      lastIndex = tokenRegex.lastIndex;
    }
    
    html += escapeHtml(text.substring(lastIndex));
    return html;
  }

  function diffWords(str1, str2) {
    const words1 = str1.split(/(\s+|\b)/).filter(Boolean);
    const words2 = str2.split(/(\s+|\b)/).filter(Boolean);

    const dp = Array(words1.length + 1).fill(null).map(() => Array(words2.length + 1).fill(0));
    for (let i = 1; i <= words1.length; i++) {
      for (let j = 1; j <= words2.length; j++) {
        if (words1[i - 1] === words2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    let i = words1.length;
    let j = words2.length;
    const out1 = [];
    const out2 = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && words1[i - 1] === words2[j - 1]) {
        out1.unshift({ type: 'common', text: words1[i - 1] });
        out2.unshift({ type: 'common', text: words2[j - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        out2.unshift({ type: 'added', text: words2[j - 1] });
        j--;
      } else {
        out1.unshift({ type: 'deleted', text: words1[i - 1] });
        i--;
      }
    }

    return { leftWords: out1, rightWords: out2 };
  }

  function renderDiff(container, diffLines) {
    if (diffLines.length === 0) {
      container.innerHTML = `<div style="padding: 12px; opacity: 0.5; text-align: center;">无代码变动（可能是空白字符变化）</div>`;
      return;
    }

    const { left, right } = alignDiffLines(diffLines);

    const diffContainer = document.createElement('div');
    diffContainer.className = 'diff-container';

    // Left pane (Deleted lines)
    const leftPane = document.createElement('div');
    leftPane.className = 'diff-pane diff-pane-left';
    left.forEach(line => {
      const lineDiv = document.createElement('div');
      lineDiv.className = `diff-line ${line.type === 'deleted' ? 'line-deleted' : (line.type === 'empty' ? 'line-empty' : '')}`;
      
      let htmlContent = '';
      if (line.type === 'empty') {
        htmlContent = '';
      } else if (line.words) {
        line.words.forEach(w => {
          if (w.type === 'common') {
            htmlContent += highlightCode(w.text);
          } else if (w.type === 'deleted') {
            htmlContent += `<span class="word-diff-deleted">${escapeHtml(w.text)}</span>`;
          }
        });
      } else {
        htmlContent = highlightCode(line.text);
      }

      lineDiv.innerHTML = `
        <div class="line-num">${line.lineNum}</div>
        <div class="line-text">${htmlContent}</div>
      `;
      leftPane.appendChild(lineDiv);
    });

    // Right pane (Added lines)
    const rightPane = document.createElement('div');
    rightPane.className = 'diff-pane diff-pane-right';
    right.forEach(line => {
      const lineDiv = document.createElement('div');
      lineDiv.className = `diff-line ${line.type === 'added' ? 'line-added' : (line.type === 'empty' ? 'line-empty' : '')}`;
      
      let htmlContent = '';
      if (line.type === 'empty') {
        htmlContent = '';
      } else if (line.words) {
        line.words.forEach(w => {
          if (w.type === 'common') {
            htmlContent += highlightCode(w.text);
          } else if (w.type === 'added') {
            htmlContent += `<span class="word-diff-added">${escapeHtml(w.text)}</span>`;
          }
        });
      } else {
        htmlContent = highlightCode(line.text);
      }

      lineDiv.innerHTML = `
        <div class="line-num">${line.lineNum}</div>
        <div class="line-text">${htmlContent}</div>
      `;
      rightPane.appendChild(lineDiv);
    });

    diffContainer.appendChild(leftPane);
    diffContainer.appendChild(rightPane);
    container.appendChild(diffContainer);

    // ========== Diff 同步滚动 ==========
    let syncing = false;
    leftPane.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      rightPane.scrollTop = leftPane.scrollTop;
      syncing = false;
    });
    rightPane.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      leftPane.scrollTop = rightPane.scrollTop;
      syncing = false;
    });
  }

  // Align deleted and added lines side by side
  function alignDiffLines(diffLines) {
    const leftSide = [];
    const rightSide = [];

    let leftLineNum = 1;
    let rightLineNum = 1;

    let i = 0;
    while (i < diffLines.length) {
      const delBlock = [];
      const addBlock = [];

      // Collect contiguous diff changes
      while (i < diffLines.length && (diffLines[i].type === 'deleted' || diffLines[i].type === 'added')) {
        if (diffLines[i].type === 'deleted') {
          delBlock.push(diffLines[i]);
        } else {
          addBlock.push(diffLines[i]);
        }
        i++;
      }

      if (delBlock.length > 0 || addBlock.length > 0) {
        const maxLen = Math.max(delBlock.length, addBlock.length);
        for (let k = 0; k < maxLen; k++) {
          let leftLine = null;
          let rightLine = null;

          if (k < delBlock.length) {
            leftLine = { lineNum: leftLineNum++, text: delBlock[k].text, type: 'deleted' };
          }
          if (k < addBlock.length) {
            rightLine = { lineNum: rightLineNum++, text: addBlock[k].text, type: 'added' };
          }

          if (leftLine && rightLine) {
            const { leftWords, rightWords } = diffWords(leftLine.text, rightLine.text);
            leftLine.words = leftWords;
            rightLine.words = rightWords;
          }

          leftSide.push(leftLine || { lineNum: '', text: '', type: 'empty' });
          rightSide.push(rightLine || { lineNum: '', text: '', type: 'empty' });
        }
      }

      // Collect context line
      if (i < diffLines.length && diffLines[i].type === 'context') {
        leftSide.push({ lineNum: leftLineNum++, text: diffLines[i].text, type: 'context' });
        rightSide.push({ lineNum: rightLineNum++, text: diffLines[i].text, type: 'context' });
        i++;
      }
    }

    return { left: leftSide, right: rightSide };
  }

  // Utils
  function formatDate(timestamp) {
    const d = new Date(timestamp * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
