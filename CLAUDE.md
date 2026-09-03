# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

微信小程序「体重记录」：原生小程序 + TypeScript + 微信云开发，手写 WXSS，零第三方依赖。

## 构建与验证

**本机没有 node/npm，也没装微信开发者工具** —— 没有可用的命令行构建、lint 或测试链路。改完代码无法在本机验证，只能靠类型正确性和代码审查。不要凭空写出 `npm run build` 之类的命令。

TS 编译由开发者工具的编译插件负责（`project.config.json` → `setting.useCompilerPlugins: ["typescript"]`），工具自带 Node 运行时，因此**刻意不引入 npm 依赖**。编译产物 `.js` / `.js.map` 生成在 `.ts` 同目录，已 gitignore。

若之后装了 node，唯一有价值的检查是类型：

```bash
npm i -D typescript
npx tsc --noEmit          # 按仓库根 tsconfig.json 检查 miniprogram/ 下全部 TS
```

`tsconfig.json` 开了 `strict` + `noUnusedLocals`，多留一个未使用的 import 就编译不过。`typeRoots` 只指向 `./typings`；`cloudfunctions/` 在 `exclude` 里，**云函数完全不受类型检查** —— 它是给云端 Node 跑的 plain CommonJS（`require` / `exports.main`），不要在里面写 TS 语法或 ESM import。

本项目没有测试。云函数部署走 GUI：右键 `cloudfunctions/remindDaily` → 「上传并部署：云端安装依赖」（`config.json` 里的定时触发器随之生效，cron `0 0 * * * * *` 是微信的 7 段秒级格式 = 每小时整点）。

首次运行的配置步骤（环境 ID、建集合、订阅消息模板）见 `README.md`，不在此重复。

## 架构

严格分层，**页面不直连 `wx.cloud.database()`**：

```
pages/*  →  models/{record,profile}  →  models/db  →  云数据库
                    ↑
              utils/{date,bmi,chart}   ← 纯函数，无副作用、不碰 wx API（chart 只收 ctx）
```

- `miniprogram/config.ts` —— **唯一的配置出口**：`CLOUD_ENV_ID`、集合名、订阅模板 ID、分页大小、BMI 阈值。新增可配置项加在这里，不要散落到页面。
- `miniprogram/models/db.ts` —— 懒初始化 `wx.cloud.database()` 并导出集合引用。**必须懒**：`init()` 在 `app.ts` 的 `onLaunch` 里，模块顶层直接取 `database()` 在某些启动时序下拿到未初始化实例。
- `miniprogram/models/types.ts` —— 数据模型单一来源（`WeightRecord` / `UserProfile`）。
- `cloudfunctions/remindDaily/` —— 每小时整点触发，函数内按北京时间筛出该提醒的用户。

云数据库两个集合：`weight_records`（每用户每天一条）、`user_profile`（每用户一条）。权限均为「仅创建者可读写」，`_openid` 由云端自动写入，客户端查询不要手动带 `_openid` 条件。

## 关键约束

改动相关代码前先读这几条，它们都是踩过或刻意设计的：

1. **「每天一条记录」是核心不变量。** 靠 `record.upsertByDate()` 保证，数据库层没有唯一索引。所有写入路径必须经过它 —— 不要在页面里直接 `add()`，否则同一天会出现多条，`buildRows` 的 delta 计算和图表都会错。

2. **日期一律用 `'YYYY-MM-DD'` 字符串**，不要传 `Date` 或时间戳去做「哪一天」的比较。字典序即时间序，也免了时区问题。解析用 `utils/date.fromDateStr()`，**不要 `new Date(str)`** —— iOS 对 `-` 分隔的解析和其它平台不一致。

3. **单次查询条数上限**：小程序端 `collection.get()` 最多 20 条，云函数端 100 条。任何可能超限的查询都要分页，范本见 `record.fetchAllSince()` 和云函数的 `targetsForHour()`。图表的「近 30 天」已经超过 20，天然需要分页。

4. **数据刷新写在 `onShow` 而非 `onLoad`。** 四个页面都是 tabBar 页，切换不会重新 `onLoad`；在「我的」改完身高、在「记录」删掉记录后切回，必须重算。

5. **Canvas 2D 的三个坑**（`pages/chart/`）：节点只能在 `onReady` 之后用 `createSelectorQuery` 查到；位图尺寸必须设为 CSS 尺寸 × `dpr` 再 `ctx.scale(dpr, dpr)`，否则高分屏上线条发虚。因此 `chart.ts` 缓存 `ctx` / `cssWidth` / `cssHeight` 在实例上（非 `data`）。

   第三个坑最隐蔽、已经踩过一次：**`onReady` 时 `hasData` 还是 `false`，`.chart-canvas.is-hidden` 把高度压成 `0`，那一刻量到的尺寸就是 0** —— 拿它去设位图等于把图表永久画到一张 0 高度的画布上，而 `initCanvas` 又只在 `onReady` 跑一次，结果是趋势页图表永远空白。现在的写法：`initCanvas` 量到零尺寸就放弃（不缓存、不标就绪），`redraw` 在有数据但 `cssHeight` 为 0 时重量一次，且绘制统一由 `setData` 的**回调**触发，保证量到的是更新后的布局。加任何「无数据就折叠/隐藏 canvas」的样式都要重新过一遍这条。

   改 `.chart-canvas` 的高度要回头确认 `utils/chart.ts` 里 `PADDING` 还够用。

6. **wx API 类型是手写的**（`typings/wx.d.ts`），只覆盖本项目用到的部分。用到新 API 时**去补声明**，不要 `(wx as any)` 绕过 —— 那等于放弃了这里唯一的静态检查手段。装了 npm 后可换成官方 `miniprogram-api-typings` 并删掉该文件。

7. **不要用路径别名**（`@/foo`）。小程序运行时按相对路径 `require`，编译插件不做路径重写，别名会在运行时找不到模块。全部用相对路径。

8. **订阅消息是一次性订阅**：授权一次 = 可推一条。`remindDaily` 每天推送会逐日消耗额度，长期可用需后台申请「长期订阅」。云函数里 `data` 的字段名（`thing1` / `time2`）取决于后台申请到的模板，**改模板必须同步 `index.js`**，对不上会报 `47003`。模板 ID 在 `config.ts` 和云函数里各存一份，改一处要改两处。

9. **不做数据库迁移。** 新增模型字段一律给可选、并在读取处兜默认值（范本：`profile.ensureProfile()` 里 `{ ...DEFAULTS, ...found }`）。线上已有文档不会自动补字段。

10. **仓库位于 OneDrive 同步目录内。** 别把 `node_modules` / `miniprogram_npm` 引进来（已 gitignore，但 OneDrive 不看 gitignore，大量小文件会拖垮同步）。

11. **新增页面照抄 `chart.ts` / `history.ts` 的写法。** `typings/wx.d.ts:270` 的 `Page()` 是单泛型 + `ThisType`：自定义实例属性（`ctx`、`cssWidth`、`raw`、`points`）必须**直接写在传给 `Page()` 的 options 字面量里**，才能让 `this.xxx` 有类型。写在外面或事后赋值都会丢类型。非渲染状态（画布上下文、原始数据数组）放实例属性而不是 `data`，避免无意义的 setData。

12. **`project.config.json` 被 git 跟踪，而开发者工具每次打开都会改写它**（补 `editorSetting`、`packOptions`、`babelSetting` 等）。所以它长期处于 modified 状态、diff 有噪音；提交前只挑真正的改动。个人本地配置在 `project.private.config.json`，已 gitignore。

13. **体重合法区间 20–300kg 硬编码在两处**：`pages/index/index.ts` 的 `onSave()` 和 `pages/history/history.ts` 的 `onTapRow()`。它是「配置项集中在 config.ts」的一个例外 —— 要改校验就改两处，或顺手提到 `config.ts` 去。

## 现状

git 已初始化，分支 `main`，目前只有一个提交（骨架）。工作区常态是 `project.config.json` 为 modified（见约束 12）。

**跑起来还缺三个值，全是空字符串**，按重要性：

| 位置 | 变量 | 不填的后果 |
|---|---|---|
| `miniprogram/config.ts` | `CLOUD_ENV_ID` | 启动即弹「未配置云开发环境」，所有页面无数据 |
| `miniprogram/config.ts` | `REMINDER_TMPL_ID` | 「我的」页提醒开关点了会弹窗拒绝并回滚 |
| `cloudfunctions/remindDaily/index.js` | `TMPL_ID` | 云函数每次执行直接 return `{skipped:'no-template'}` |

AppID 已填真实值（不再是 README 里写的 `touristappid`，README 这段没更新）。

**代码的运行状况未经本机验证** —— 本机既无 node 也无微信开发者工具（已确认不在 `Program Files*` / `%LOCALAPPDATA%\Programs` / 卸载注册表里）。项目已在**某台**装了工具的机器上打开过（`project.private.config.json` 存在，`libVersion` 3.17.2，与 `project.config.json` 里的 3.5.5 不一致），但没有证据表明编译通过或功能跑通过。首次编译时预期要修一些类型或配置上的小问题；`typings/wx.d.ts` 是手写的、只覆盖用到的 API，最可能是问题来源。
