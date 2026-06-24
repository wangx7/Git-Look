const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') {
    return {
      Uri: { file: (f) => f },
      extensions: { getExtension: () => null }
    };
  }
  return originalRequire.apply(this, arguments);
};
