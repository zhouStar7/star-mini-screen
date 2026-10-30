# Star Mini Screen

为 macOS 7 英寸横向副屏打造的深色极简 Dashboard。适配 1024×600、1280×800，支持石墨、深海、琥珀等主题。MIT 开源。

## 安装

从 [Releases](https://github.com/zhouStar7/star-mini-screen/releases/latest) 下载 `Star-Mini-Screen-1.1.0-universal.dmg`，打开后将 **Star Mini Screen.app** 拖入“应用程序”，再双击运行。也提供应用 ZIP。

要求 macOS 14 或更新版本，支持 Apple Silicon 与 Intel。应用内置两种架构的运行环境，无需安装 Node.js、Homebrew、Python 或 Xcode。源码构建才需要开发工具。

**当前发布包采用临时签名，尚无 Apple Developer ID 签名或公证。** 首次下载可能被 Gatekeeper 拦截。核对来源后，可前往“系统设置 → 隐私与安全性”选择“仍要打开”；项目不要求关闭系统安全保护。

## 使用

- **日常模式**：实时时间、可翻月月历、Apple 天气、可配置的应用／网址快捷启动。
- **工作模式**：实时时间、飞书待办、真实 CPU／内存／磁盘监控。
- 右上角开关切换模式，设置中切换主题、编辑天气位置和快捷启动。全屏按钮控制原生窗口。
- 程序坞图标默认隐藏；菜单栏图标可显示面板、切换全屏和退出。关闭窗口只隐藏，退出请使用菜单栏。
- 拖到副屏后开启全屏。窗口位置、主题、模式和快捷配置会保留。

### Apple 天气

首次点击“添加天气”，在系统快捷指令中添加并运行一次，按系统提示允许定位。导入名 `Apple-Weather` 与 `副屏天气` 均可识别。

多城市：复制指令，命名为 `副屏天气 上海` 等，在“获取当前天气”动作中设置城市，再在 Dashboard 设置中添加相同指令名。天气卡片下拉框可切换位置。每15分钟更新，也可手动刷新；失败时保留上次值并标记状态。

不读取天气 App 的私人数据库或收藏城市，不需要 WeatherKit 开发者密钥。详细说明见 [天气配置](integrations/weather/README.md)。首次系统授权须在用户自己的 Mac 完成，安装包不包含授权。

### 飞书待办（可选）

通过用户自行安装、登录的 [官方飞书 CLI](https://github.com/larksuite/cli) 只读获取“我负责的”未完成任务。CLI 不随本应用打包；没有 CLI 时，其他功能仍可使用。

```sh
lark-cli auth login --scope "task:task:read"
```

支持常见 Homebrew、npm、Volta、fnm default 安装路径，也可通过启动环境变量 `FOCUS_FEISHU_CLI` 指定 CLI 绝对路径。不会复制或上传 CLI 密钥。每60秒读取，最多显示4项；点击任务文字在浏览器／飞书中打开，不修改任务。

### 监控与日历的口径

CPU 为全机归一化0–100%，由 Mach 累计 tick 差值计算；曲线保存最近约60秒本次页面采样。内存估算 active＋wired＋compressed，不等同于活动监视器的“内存压力”；磁盘读取 APFS 数据卷 `statfs`，共享空间和快照可能造成口径差异。容量显示 GiB。

日常模式的日历是月历，不显示事件。原版界面的本地三项任务、持久化番茄钟和 EventKit 下一场会议仍可通过 `--classic-interface` 使用，日历事件需要单独授权。

## 数据和隐私

配置与原版任务状态在当前用户的：

```text
~/Library/Application Support/StarMiniScreen/
```

目录0700、文件0600、原子保存；损坏时提示，不静默覆盖。天气和飞书内容只在内存中缓存，不写入发布包或访问日志。主题与模式存于应用专用 WebKit 本地存储。

应用启动自己持有的本机服务，使用系统分配的空闲端口，仅监听127.0.0.1；退出应用时服务一起退出。请求有会话令牌、Host／Origin 校验、CSP 和 no-store。固定接口只允许启动已保存的应用或 http／https 网址，以及限定名称的天气指令，不允许网页执行任意 shell 命令。

本机 HTTP 不隔离恶意本机进程／其他登录用户。飞书／Apple 天气会使用各自服务网络；点击网址会访问对应网站。没有遥测、远程字体或 CDN。项目不打包个人配置、账号或授权资料。

## 从源码构建

需要 macOS、Apple Command Line Tools、Python 3。构建脚本下载两份官方 Node.js 运行环境并核对 `runtime.lock.json` 的 SHA256，仅打包二进制和完整许可证，不安装 npm 运行依赖。

```sh
xcode-select --install # 仅尚未安装开发工具时执行
FOCUS_BUILD_ARCH=universal ./scripts/build.sh
open "build/Star Mini Screen.app"
```

也可 `FOCUS_BUILD_ARCH=arm64`／`x86_64` 只构建一个主程序架构。安装包统一携带两个运行环境。应用图标和 Dashboard 都从仓库中的源码生成。

```sh
node --test integrations/*.test.mjs
./scripts/test.sh
python3 tests/test_standalone.py
./scripts/package.sh
```

最后一步输出 `dist/` 中的 DMG、应用 ZIP 和 SHA256。`test_standalone.py` 会打开测试窗口，使用临时数据目录并禁用飞书读取，验证内置环境、真实监控与退出清理；天气指令可能沿用当前用户的系统授权。可用 `STAR_TEST_APP` 指向移位后的 `.app` 验证安装。

可选浏览器测试需开发依赖：`npm install --ignore-scripts` 后 `npm run test:browser`（原版界面），或执行 `tests/dashboard.cjs`（新界面）；测试使用临时状态和合成天气／待办，截图不包含个人任务。

登录自启可将已安装的 `.app` 作为脚本参数：

```sh
./scripts/install-launchd.sh "/Applications/Star Mini Screen.app"
# 取消自启：
./scripts/uninstall-launchd.sh
```

安装登录项会启动应用；只在当前用户登录桌面后运行，无需 sudo。安装脚本不是应用正常运行的前提，也不会默认执行。

## 结构与贡献

`Sources/` 是 Swift 窗口、系统采集、状态和本机 HTTP；`integrations/` 是随应用自动启动的 Node 服务；`design-demos/` 是当前主题页面，生成源在 `scripts/build-dashboard.py` 和 `web/daily-mode.js`；`web/` 还保留原版界面。

欢迎提交 Issue／PR。请不要在截图、日志、Issue 中提交任务内容、定位、App Secret 或访问令牌。请为行为变更添加能检验边界的测试。许可证见 [LICENSE](LICENSE)，内置运行环境说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
