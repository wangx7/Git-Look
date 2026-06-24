export const fileIconMap: Record<string, { icon: string; color: string }> = {
  '.ts': { icon: 'codicon-symbol-class', color: 'file-icon-ts' },
  '.tsx': { icon: 'codicon-symbol-class', color: 'file-icon-ts' },
  '.js': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
  '.mjs': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
  '.cjs': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
  '.jsx': { icon: 'codicon-symbol-event', color: 'file-icon-js' },
  '.vue': { icon: 'codicon-file-code', color: 'file-icon-vue' },
  '.css': { icon: 'codicon-symbol-color', color: 'file-icon-css' },
  '.scss': { icon: 'codicon-symbol-color', color: 'file-icon-css' },
  '.less': { icon: 'codicon-symbol-color', color: 'file-icon-css' },
  '.html': { icon: 'codicon-file-code', color: 'file-icon-html' },
  '.htm': { icon: 'codicon-file-code', color: 'file-icon-html' },
  '.json': { icon: 'codicon-json', color: 'file-icon-json' },
  '.md': { icon: 'codicon-markdown', color: 'file-icon-md' },
  '.py': { icon: 'codicon-symbol-method', color: 'file-icon-py' },
  '.java': { icon: 'codicon-symbol-class', color: 'file-icon-java' },
  '.go': { icon: 'codicon-symbol-method', color: 'file-icon-go' },
  '.rs': { icon: 'codicon-symbol-struct', color: 'file-icon-rs' },
  '.sh': { icon: 'codicon-terminal', color: 'file-icon-sh' },
  '.bash': { icon: 'codicon-terminal', color: 'file-icon-sh' },
  '.zsh': { icon: 'codicon-terminal', color: 'file-icon-sh' },
  '.yaml': { icon: 'codicon-symbol-namespace', color: 'file-icon-yaml' },
  '.yml': { icon: 'codicon-symbol-namespace', color: 'file-icon-yaml' },
  '.xml': { icon: 'codicon-file-code', color: 'file-icon-xml' },
  '.sql': { icon: 'codicon-database', color: 'file-icon-sql' },
  '.swift': { icon: 'codicon-symbol-method', color: 'file-icon-swift' },
  '.kt': { icon: 'codicon-symbol-class', color: 'file-icon-kt' },
  '.kts': { icon: 'codicon-symbol-class', color: 'file-icon-kt' },
  '.rb': { icon: 'codicon-symbol-method', color: 'file-icon-rb' },
  '.php': { icon: 'codicon-file-code', color: 'file-icon-php' },
  '.c': { icon: 'codicon-symbol-method', color: 'file-icon-c' },
  '.h': { icon: 'codicon-symbol-interface', color: 'file-icon-c' },
  '.cpp': { icon: 'codicon-symbol-method', color: 'file-icon-cpp' },
  '.hpp': { icon: 'codicon-symbol-interface', color: 'file-icon-cpp' },
  '.cs': { icon: 'codicon-symbol-class', color: 'file-icon-cs' },
  '.svg': { icon: 'codicon-file-media', color: '' },
  '.png': { icon: 'codicon-file-media', color: '' },
  '.jpg': { icon: 'codicon-file-media', color: '' },
  '.gif': { icon: 'codicon-file-media', color: '' },
  '.ico': { icon: 'codicon-file-media', color: '' },
  '.woff': { icon: 'codicon-file-binary', color: '' },
  '.woff2': { icon: 'codicon-file-binary', color: '' },
  '.ttf': { icon: 'codicon-file-binary', color: '' },
  '.zip': { icon: 'codicon-file-zip', color: '' },
  '.tar': { icon: 'codicon-file-zip', color: '' },
  '.gz': { icon: 'codicon-file-zip', color: '' },
  '.lock': { icon: 'codicon-lock', color: '' },
};

export function getFileIconInfo(fileName: string): { icon: string; color: string } {
  const lowerName = fileName.toLowerCase();
  if (lowerName === 'dockerfile') return { icon: 'codicon-symbol-namespace', color: 'file-icon-go' };
  if (lowerName === 'makefile') return { icon: 'codicon-terminal', color: 'file-icon-sh' };
  if (lowerName === '.gitignore') return { icon: 'codicon-git-commit', color: '' };
  if (lowerName === '.env') return { icon: 'codicon-key', color: '' };

  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return { icon: 'codicon-file', color: '' };
  const ext = fileName.substring(lastDot).toLowerCase();
  return fileIconMap[ext] || { icon: 'codicon-file', color: '' };
}
