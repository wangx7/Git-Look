# 文件顶部 Git 信息功能实现计划

## 一、需求摘要

在 VS Code 编辑器中每个 Git 跟踪文件的顶部（CodeLens 区域）显示一行 Git 摘要信息：

```
jiapengyan，上个月 ｜ 4 作者（你和其他）
```

行为要求：

* 左侧展示当前文件**最近一次变更**的作者与相对时间；如果文件有未提交的本地修改，则显示 **“你，<相对时间>”**（例如 `你，2 小时前`）。

* 点击左侧打开 VS Code 的 `vscode.diff`：

  * 若有未提交修改 → 对比 HEAD 与工作区（看本次改了什么）。

  * 若无未提交修改 → 对比最近一次提交的父版本与该提交（看上次提交改了什么）。

* 右侧展示**参与过该文件的总作者数**；如果当前用户在其中，则显示 `（你和其他）`。

* 点击右侧启用现有的 **Git 行作者** 功能。

## 二、当前代码状态

* 入口：`src/extension.ts` 负责注册命令、Provider、Manager。

* Git 操作集中封装在 `src/gitHelper.ts`，使用 `child_process.execFile` 执行 git，并自带缓存/取消机制。

* 行内 Blame 实现：`src/blameAnnotations.ts` 中的 `BlameAnnotationsManager`，通过 `TextEditorDecorationType` 渲染。

* Webview Diff：`src/panel/gitGraphProvider.ts` 已使用 `toGitUri()` + `vscode.commands.executeCommand('vscode.diff', ...)` 打开 diff。

* 目前**没有 CodeLens**，项目习惯用 `TextEditorDecorationType`；但本需求需要“可点击的两段文本”，CodeLens 是最自然、可点击、位置在文件顶部的方案。

* 测试：`src/test/gitHelper.test.ts` 使用 Jest + ts-jest，mock `child_process` 与 `vscode`。

## 三、实现方案

### 3.1 总体设计

采用 **CodeLens Provider** 方案：

* 注册全局 `CodeLensProvider`（匹配 `scheme: 'file'`）。

* 对 Git 仓库内的文件，在 `range(0,0,0,0)` 处返回两个 `CodeLens`：

  1. `jiapengyan，上个月 ｜` → 命令 `git-visual.openFileRecentDiff`
  2. `4 作者（你和其他）` → 命令 `git-visual.showLineBlame`

* VS Code 会把同一行的 CodeLens 并排渲染，视觉上连成 `jiapengyan，上个月 ｜ 4 作者（你和其他）`。

### 3.2 需要修改/新建的文件

#### 1) `src/gitHelper.ts`（新增 4 个函数）

**a.** **`getCurrentGitUser(gitRoot)`**

* 执行 `git config user.name` 与 `git config user.email`。

* 返回 `{ name?: string; email?: string }`。

* 用于判断“当前用户”是否是某位历史作者。

**b.** **`getFileLastCommit(gitRoot, repoFilePath, signal?)`**

* 执行 `git log -1 --follow --pretty=format:%H%x1f%an%x1f%ae%x1f%at%x1f%s -- <path>`。

* 返回 `{ hash, author, email, timestamp, message }` 或 `undefined`（文件无提交历史）。

**c.** **`getFileAuthors(gitRoot, repoFilePath, signal?)`**

* 执行 `git log --follow --pretty=format:%an%x1f%ae -- <path>`。

* 按 email 去重，返回 `{ name: string; email: string }[]`。

* 用于统计“几人改过这个文件”。

**d.** **`isFileTracked(gitRoot, repoFilePath, signal?)`**

* 执行 `git ls-files -- <path>`。

* 返回布尔值，表示文件是否已被 Git 跟踪（用于区分新文件）。

> 复用 `hasFileLocalModifications(cwd, filePath)` 判断已跟踪文件是否有未提交修改；对未跟踪的新文件，通过 `isFileTracked` + 文件存在且有内容来判定“当前用户正在新增该文件”。

#### 2) `src/fileHeaderCodeLens.ts`（新建）

实现 `FileHeaderCodeLensProvider implements vscode.CodeLensProvider`：

* **`provideCodeLenses(document)`**

  * 跳过 `isUntitled` 或 `scheme !== 'file'` 的文档。

  * 解析 `cwd` → `gitRoot` → `repoFilePath`。

  * 并行查询：

    * `hasFileLocalModifications(gitRoot, filePath)`（已跟踪文件的未提交修改）

    * `isFileTracked(gitRoot, repoFilePath)`（是否已跟踪）

    * `getFileLastCommit(gitRoot, repoFilePath)`

    * `getFileAuthors(gitRoot, repoFilePath)`

    * `getCurrentGitUser(gitRoot)`

  * 判定“当前用户有未提交内容”：

    * 已跟踪文件：`hasFileLocalModifications(...) === true`。

    * 未跟踪新文件：`isFileTracked(...) === false` 且文件存在、大小 > 0。

    * 若两者皆非，且 `getFileLastCommit` 为空，则不显示 CodeLens。

  * 确定展示作者：

    * 有未提交内容 → `你`。

    * 无未提交内容 → 上次提交作者；如果与当前用户 name/email 匹配则显示 `你`，否则显示作者名。

  * 确定展示时间：

    * 有未提交内容 → 当前时间。

    * 无未提交内容 → 上次提交时间戳。

  * 格式化相对时间（中文）：今天 / 昨天 / N 天前 / 1 周前 … / 上个月 / N 个月前 / 去年 / N 年前。

  * 统计作者数（边界处理）：

    * 基础集合 = 历史提交作者（按 email 去重）。

    * 若当前用户有未提交内容，则总数 +1（未提交内容代表当前用户也是作者）。

    * 最终文案：

      * 当前用户是作者之一且总数 > 1 → `N 作者（你和其他）`

      * 当前用户是作者之一且总数 == 1 → `1 作者（你）`

      * 当前用户不是作者之一 → `N 作者`

  * 生成两个 `CodeLens`（range 都在第 0 行）：

    * 第一个：`${displayAuthor}, ${relativeTime} ｜` → `git-visual.openFileRecentDiff`，参数带上文件路径、diff 类型（`workingTree`/`commit`）、commit hash。

    * 第二个：`${count} 作者${youSuffix}` → `git-visual.showLineBlame`。

* **模块化核心逻辑**

  * 将“根据 git 数据构造展示信息”的逻辑抽成纯函数 `buildFileHeaderData(...)`（输入：lastCommit、authors、currentUser、hasLocalChanges、isNewFile、now；输出：`{ displayAuthor, relativeTime, authorCount, youSuffix, diffKind, commitHash }`）。

  * 该函数不依赖 `vscode`，可直接单元测试。

* **辅助函数（同文件）**

  * `formatRelativeTimeChinese(timestampSeconds: number): string`

  * `isSameDay(d1, d2): boolean`

* **刷新机制**

  * 提供 `refresh()` 方法，触发 `onDidChangeCodeLenses`。

  * 在 `extension.ts` 中监听：

    * `vscode.workspace.onDidSaveTextDocument` → 调用 `refresh()`。

    * `vscode.workspace.onDidChangeTextDocument` 防抖 1s 后刷新，使未保存修改能及时显示“你”。

#### 3) `src/blameAnnotations.ts`（小改动）

新增 `turnOn()` 方法：

```typescript
public async turnOn(editor?: vscode.TextEditor) {
  if (!this.enabled) {
    await this.toggle(editor);
  }
}
```

#### 4) `src/extension.ts`（注册 Provider 与命令）

* 实例化 `FileHeaderCodeLensProvider(getCwd)`。

* 注册 Provider：

  ```typescript
  vscode.languages.registerCodeLensProvider({ scheme: 'file' }, fileHeaderProvider)
  ```

* 注册命令 `git-visual.openFileRecentDiff`：

  * 根据参数决定 diff 类型。

  * `workingTree`：左 = `toGitUri(fileUri, 'HEAD')`，右 = `fileUri`，标题 `文件名 (HEAD vs 工作区)`。

  * `commit`：左 = parent 的 `toGitUri`（通过 `git log -1 --pretty=%P <hash>` 获取 parent），右 = `toGitUri(fileUri, hash)`，标题 `文件名 (parent vs hash)`。

* 注册命令 `git-visual.showLineBlame`：

  * 调用 `blameAnnotationsManager.turnOn(vscode.window.activeTextEditor)`。

* 将 Provider、命令加入 `context.subscriptions`。

* 监听保存/修改事件以刷新 CodeLens。

#### 5) `package.json`（声明命令与激活事件）

* `commands` 增加：

  * `git-visual.openFileRecentDiff`，title 可为空（不在命令面板显示）。

  * `git-visual.showLineBlame`，title 可为空。

* `activationEvents` 增加 `onStartupFinished`，保证文件一打开就能显示 CodeLens。

#### 6) 测试文件

* `src/test/gitHelper.test.ts`：新增 `getCurrentGitUser`、`getFileLastCommit`、`getFileAuthors`、`isFileTracked` 的单元测试，mock `execFile` 输出。

* `src/test/fileHeaderCodeLens.test.ts`（新建）：

  * 重点测试纯函数 `buildFileHeaderData(...)`，覆盖用户提到的边界：

    * 有本地修改 → 显示 `你，刚刚`。

    * 无本地修改 → 显示上次提交作者。

    * 新文件（无提交历史、未跟踪但有内容）→ 显示 `你，刚刚` + `1 作者（你）`。

    * 当前文件只有一个人提交过一次，且就是当前用户 → `1 作者（你）`。

    * 当前文件只有一个人提交过，当前用户又改了 → `2 作者（你和其他）`。

    * 当前用户不是历史作者 → `N 作者`（无“你”）。

  * mock `vscode`（`CodeLens`、`Range`、`languages` 等），测试 Provider 的 `provideCodeLenses` 能正确返回 CodeLens。

## 四、关键命令与 Diff 逻辑

### `git-visual.openFileRecentDiff`

```typescript
const filePath = args[0] as string;
const diffKind = args[1] as 'workingTree' | 'commit';
const hash = args[2] as string | undefined;

const fileUri = vscode.Uri.file(filePath);

if (diffKind === 'workingTree') {
  const leftUri = await toGitUri(fileUri, 'HEAD');
  await vscode.commands.executeCommand('vscode.diff', leftUri, fileUri, `${basename(filePath)} (HEAD vs 工作区)`);
} else if (hash) {
  const parentHash = (await execGit(['log', '-1', '--pretty=%P', hash], gitRoot)).trim() || 'empty';
  const leftUri = parentHash === 'empty'
    ? vscode.Uri.from({ scheme: 'git-visual', path: filePath })
    : await toGitUri(fileUri, parentHash);
  const rightUri = await toGitUri(fileUri, hash);
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${basename(filePath)} (${parentHash.slice(0,7)} vs ${hash.slice(0,7)})`);
}
```

### `git-visual.showLineBlame`

```typescript
await blameAnnotationsManager.turnOn(vscode.window.activeTextEditor);
```

## 五、假设与决定

1. **可点击实现方式**：使用 CodeLens（而非 Decoration + hover 链接），因为 Decoration 本身不可点击，而 CodeLens 天然支持点击并位于文件顶部，与截图效果一致。
2. **“你”的判定**：未提交内容一律显示 `你`；历史提交中通过 `git config user.name` / `user.email` 识别当前用户，若配置未设置，则无法将历史作者标记为“你”。
3. **本地修改判定**：已跟踪文件复用 `hasFileLocalModifications`（`git diff HEAD -- path` 非空）；未跟踪新文件通过 `git ls-files` 判断，存在内容即视为当前用户新增。
4. **相对时间**：采用中文相对时间（今天 / 昨天 / N 天前 / 上个月 / N 个月前 / 去年 / N 年前），与示例“上个月”风格一致。
5. **作者数统计**：按提交作者 email 去重；若当前用户有未提交内容，则总数 +1。
6. **模块化**：将“根据 git 数据构造展示信息”的逻辑抽成纯函数 `buildFileHeaderData`，便于单元测试和维护。
7. **常驻显示**：通过 `onStartupFinished` 激活事件 + 全局 `registerCodeLensProvider` 实现默认显示。
8. **刷新时机**：保存文档时刷新；可选防抖监听文本修改，以及时反映“未提交修改”状态。

## 六、验证步骤

1. 运行 `npm run compile` 确保 TypeScript 编译通过。
2. 运行 `npm test` 确保新增与现有测试通过。
3. 在 VS Code 中按 F5 启动 Extension Host，打开一个 Git 项目中的文件：

   * 确认文件顶部出现类似 `jiapengyan，上个月 ｜ 4 作者（你和其他）` 的 CodeLens。

   * 修改并保存文件，确认左侧变为 `你，刚刚`。

   * 点击左侧打开 diff，确认对比正确（HEAD vs 工作区）。

   * 提交修改后，确认左侧恢复为最新提交作者与时间；点击左侧打开该提交的 diff。

   * 点击右侧启用行作者注解，确认左侧出现 blame 信息。

   * 新建一个未跟踪文件并写入内容，确认顶部显示 `你，刚刚 ｜ 1 作者（你）`。

4. 打开非 Git 文件 / 空的新文件，确认不显示该 CodeLens