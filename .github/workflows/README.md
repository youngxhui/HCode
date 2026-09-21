# GitHub Actions 工作流

当前只有一个工作流：[`desktop-macos-arm64-release.yml`](desktop-macos-arm64-release.yml)。

## desktop-macos-arm64-release

手动触发构建 macOS arm64 桌面安装包，并自动分发到 GitHub Release。

### 触发与输入

仅 `workflow_dispatch` 手动触发。在 Actions 页选择本工作流后填写输入：

| 输入                 | 类型    | 默认值       | 说明                                                             |
| -------------------- | ------- | ------------ | ---------------------------------------------------------------- |
| `tag`                | string  | 空           | 发布标签；留空取 `v<根 package.json version>`                    |
| `release_title`      | string  | 空           | Release 标题；留空使用标签名                                     |
| `zcode_env`          | string  | `production` | 后端环境；`production` 为正式身份 ZCode，`test` 为 ZCode Preview |
| `draft`              | boolean | `true`       | 创建为草稿 Release；取消勾选则直接公开发布                       |
| `prerelease`         | boolean | `false`      | 标记为 Pre-release                                               |
| `enable_mac_signing` | boolean | `false`      | 启用 macOS 代码签名，需要仓库 secret `APPLE_SIGNING_IDENTITY`    |

运行环境：`macos-14`（GitHub 托管 arm64 镜像）、Node `24.14.0`（与 `mise.toml` 一致）、
pnpm `10.33.2`（与根 `package.json` 的 `packageManager` 一致）。

### 构建链

按 README「打包 → 桌面版」的文档链路执行：

1. `pnpm install --frozen-lockfile`（`HUSKY=0`，CI 不安装 git hooks）。
2. `pnpm -r --filter "./packages/*" --filter "!@zcode/desktop" build`，即
   `build:bootstrap` 的前置部分；desktop 产物由第 3 步内部构建。
3. `pnpm bundle:desktop -- --os mac --arch arm64`：
   - 准备本地 runtime 资产（agent bundle、native search、macOS window bounds）；
   - desktop 生产构建（tsup + vite）；
   - `electron-builder --mac --arm64`，产出 dmg 与 zip；
   - 脚本内置 app.asar 运行时依赖校验与体积审计，任一项失败即中止。

产物位于 `packages/desktop/dist/mac-arm64/`，收集 `*.dmg`、`*.zip` 与
`*.blockmap`（zip 的差分更新索引），先上传为 workflow artifact，再分发到
GitHub Release。

### 不变量

- 默认**不签名**。仅当 `enable_mac_signing=true` 且 secret `APPLE_SIGNING_IDENTITY`
  有效时才进入签名链路；electron-builder 的 `notarize` 保持关闭，公证是独立阶段，
  不在本流程内。
- 产物身份由 `zcode_env` 决定：`production` 产出 `ZCode-<version>-mac-arm64.dmg`；
  `test` 产出 `ZCode Preview-<version>-mac-arm64_TEST.dmg`（预览身份，勿用于公开发布）。
- 安装包不包含 mock-cdn 远程资产（SSH/WSL 资源由单独发布链路准备并上传 CDN），
  故以 `ZCODE_SKIP_REMOTE_ASSETS=1` 跳过，与 `pnpm bootstrap` 默认行为一致。
- Release 标签缺省为 `v<根 package.json version>`，新 Release 锚定本次构建的提交
  （`GITHUB_SHA`），标签不存在时由 `gh release create` 创建。
- 同名 Release 已存在时，仅以 `--clobber` 覆盖上传资产，不修改其标题与发布说明。
- `draft` 默认 `true`：避免手动误触直接产生公开 Release；需要全自动公开发布时
  取消勾选。

### 失败语义

- 任一环节失败（安装、构建、打包校验、产物收集、发布）job 即失败，不进入发布步骤；
  workflow artifact 仅在构建成功后才上传。
- electron-builder 的瞬时下载错误由 `scripts/bundle.mjs` 自带的重试兜底，
  真实构建错误直接失败。
- 产物目录为空时发布步骤显式报错，不会创建空 Release。

### 验收场景

1. 默认输入手动触发：产出 `ZCode-<version>-mac-arm64.dmg/.zip`，创建（或更新）
   `v<version>` 的草稿 Release 并附带全部资产。
2. `tag` 指定已存在的 Release：资产覆盖上传，不重复创建 Release。
3. `zcode_env=test`：产物为 `ZCode Preview-<version>-mac-arm64_TEST.dmg`。
4. `enable_mac_signing=true` 且已配置 secret：走签名链路；未配置身份时打包前失败
   （`electron-builder.config.js` 的显式断言）。
5. `draft=false`：Release 创建后即公开。
