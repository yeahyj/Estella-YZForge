# Estella 通用游戏模板

用 Estella 打开 [project.esproject](project.esproject)，点击 Play。默认入口是工作台。设置页可以更改音量、语言和字号。样例空间按需加载，暂停、返回和重新进入分别演示模拟时间、UI 栈和原生场景的生命周期。

## 创建下一款游戏

在模板根目录执行下面的命令。最后一个参数是新的项目目录。

```sh
npm run game:new -- orchard ../orchard
```

生成器会带上源码、资产及其 UUID、Luban 表源、生成物、验证工具和编辑器交付配置，并为新游戏设置独立的存档标识。工程名称和存档标识保留输入的大小写，npm 包名统一使用小写。打开新目录的 `project.esproject` 一次，让编辑器生成 SDK，再在新目录运行 `npm ci` 和 `npm run check`。已发布游戏的 `gameTemplate.id` 是存档标识，改显示名称时应保留它。

## 功能放在哪里

| 要改的东西 | 入口 |
|---|---|
| 本作的 ID、模板版本、可选模块 | [package.json](package.json) 中的 `gameTemplate`。设置 `settings: false` 可关闭设置功能，`experience: null` 可只保留启动壳和已启用的公共模块。 |
| 启动与装配 | [src/app/start.ts](src/app/start.ts)。每个 World 持有独立的路由和模拟会话。 |
| 新增页面 | 参考 [设置模块](src/modules/settings/pages.ts)。用 `PageHost.register` 登记页面、预制体、文本绑定和按钮动作，用 `layer: 'hud'` 或 `layer: 'modal'` 选择展示层。节点名在该预制体内解析。 |
| 新增玩法 | 在 `src/game/features/` 创建功能，将组件声明汇集到 [src/components.ts](src/components.ts)，在装配入口选用。场景系统可以通过 `Res(GameSession)` 读取本局时间和运行状态。 |
| 新增内容包 | 在 [资源组配置](.esengine/asset-groups.json) 登记目录，在 [体验表](config/luban/data/experiences.csv) 填稳定 ID、组名和预制体。选择该 ID 即可使用相同的样例控制逻辑。新玩法可以提供自己的控制逻辑和预制体。 |
| 跨版本存档 | [存档槽](src/framework/storage/slot.ts) 提供游戏命名空间、验证和顺序写入，业务模块声明自己的结构、默认值和迁移。当前设备设置的结构版本为 2。 |
| 发布取舍 | 产品开关决定运行时启用的功能。要同时缩减包体，应移除相应的模块注册、资产及交付组，并检查导出报告。脚本拆分和 CDN 部署由目标平台单独验证。 |

## 开发与验证

首版环境为 Estella SDK 0.109.1、TypeScript 5.9 和本机 Chrome。执行编辑器命令前，打开当前项目并允许 Estella MCP 连接与编辑。脚本会按当前项目的绝对路径连接。非默认安装位置可通过 `ESTELLA_MCP_SCRIPT` 指向编辑器随附的 `editor-mcp.mjs`。

```sh
npm ci
npm run check
npm run editor:smoke
npm run export:web
npm run test:web
```

- `check` 校验资源标识、分包归属、生成物一致性和 TypeScript 类型，再运行路由、生命周期和存档回归测试。
- `editor:smoke` 运行 [MCP 验收用例](acceptance/framework.case)，从实际主场景判定脚本、实体、错误和画面。启用默认样例时还会确认原生场景实体在暂停时停止计时、恢复后继续、退出后销毁。
- `export:web` 写入 `dist-web/`。浏览器通过 HTTP 运行导出包。`test:web` 自动创建临时本机服务和隔离浏览器，验证默认样例的真实鼠标与键盘操作、失败重试、迟到请求、存档和分包。可通过 `CHROME_PATH` 指定兼容的 Chrome 可执行文件。
- 更换首页或移除样例时，一并替换针对原页面的验收用例。通用层的回归测试可继续使用。

### 修改配置表

日常开发直接使用已提交的 [生成代码](src/gen/schema.ts) 和 [客户端数据](assets/data/content_experiences.json)。修改表源或 schema 后运行 `npm run config:generate`。使用 Luban 5.1.0 和 .NET 8。可把 Luban 工具目录放在 `.tools/luban/`，也可设置 `LUBAN_DLL`。脚本支持系统 `dotnet`、项目内 `.tools/dotnet/` 或由 `DOTNET_EXE` 指定的独立运行时。输入、代码、数据的内容摘要随生成物提交，`npm run check:content` 会发现漏生成或手工改动。[已验证的 Luban 工具版本](https://github.com/focus-creative-games/luban_examples/tree/c52e273f1f50a263e9257dddb35c8e222d9777b8/Tools/Luban)

### 资源和版本

本机编辑器会收集项目中的普通 JSON 数据。制作表使用 CSV，MCP 用例使用 JSON 内容的 `.case` 文件，导出包测试会检查制作目录意外入包。更改交付组后，若已打开的编辑器仍使用旧清单，重新打开项目后再 Play。编辑器的工程缓存及各平台导出目录由各游戏自行生成。

框架版本在 `gameTemplate.frameworkVersion`，游戏构建版本在 `package.json` 的 `version`，发布时与工程版本同步。内容修订由导出清单记录。存档结构版本由各模块单独管理。架构边界、行业案例与后续平台能力见[架构设计](docs/architecture.md)。
