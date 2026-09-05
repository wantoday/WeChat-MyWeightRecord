# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

微信小程序「体重记录」：原生小程序 + TypeScript，手写 WXSS，**运行时零第三方依赖**（`typescript` / `vitest` / `miniprogram-api-typings` 都是 devDependencies，仅用于类型检查与测试）。

**数据存在用户自己的电脑上**：小程序通过 HTTP 直连本机跑的 `local-server`（零依赖单文件 Node 脚本），记录落盘成 `local-server/data/*.json`。**微信云开发相关代码已全部删除** —— 没有 `wx.cloud`、没有云数据库、没有云函数、没有订阅消息提醒。看到旧文档或旧报告提到云开发/每日提醒，那是历史信息。

## 构建与验证

```bash
npm run typecheck                    # tsc --noEmit，检查 miniprogram/ 下全部 TS
npm test                             # vitest run，四个文件见下
npx vitest run tests/server.test.ts  # 只跑某个文件
npx vitest run -t "每天一条"          # 按用例名过滤
```

测试分四块，改代码后至少跑 `npm test`：

| 文件 | 覆盖 |
|---|---|
| `tests/server.test.ts` | **端到端**：起真实 HTTP 服务（临时数据目录），走「打卡 → 落盘」全程，校验每天一条、备注保留、入参校验、删除、档案合并、CSV 导出 |
| `tests/record.test.ts` | 数据层：假 `wx.request` 顶替运行时，校验分页/过滤/并发合并/写后作废/错误提示 |
| `tests/date.test.ts` / `tests/bmi.test.ts` | 纯函数 |

⚠️ **先确认 node 在不在 PATH**。这台机器上曾经完全没装 node（`node_modules/` 是从另一台机器经 OneDrive 同步过来的，正是约束 10 警告的事），当时 `npm` / `npx` 全都 `command not found`。不在就**如实说明「本次改动未经 typecheck / 测试验证」**，不要假装跑过。

跑小程序本身还需要本地服务在跑：

```bash
node local-server/server.js          # 或双击 local-server/start-server.bat
curl http://127.0.0.1:8765/api/health
```

TS 编译由开发者工具的编译插件负责（`project.config.json` → `setting.useCompilerPlugins: ["typescript"]`），工具自带 Node 运行时，因此小程序运行时**不引入 npm 依赖**。编译产物 `.js` / `.js.map` 生成在 `.ts` 同目录，已 gitignore。

`tsconfig.json` 开了 `strict` + `noUnusedLocals`，多留一个未使用的 import 就编译不过。注意 `include` 只有 `miniprogram/` 和 `typings/` —— **`tests/` 和 `local-server/` 都不在类型检查范围内**，那边的错误只有跑测试时才暴露。

配置步骤见 `README.md`，本地服务的 API 与约定见 `local-server/README.md`。

## 架构

严格分层，**页面不直接 `wx.request`**：

```
pages/*  →  models/{record,profile}  →  models/http  →  local-server/server.js  →  data/*.json
                    ↑
              utils/{date,bmi,chart}   ← 纯函数，无副作用、不碰 wx API（chart 只收 ctx）
```

- `miniprogram/config.ts` —— **唯一的配置出口**：`LOCAL_SERVER_URL`、`REQUEST_TIMEOUT`、`PAGE_SIZE`、`WEIGHT_RANGE`、`HEIGHT_RANGE`、`BMI_THRESHOLDS`。新增可配置项加在这里，不要散落到页面。
- `miniprogram/models/http.ts` —— `wx.request` 的唯一封装（`httpGet` / `httpPost` / `httpDelete`），非 2xx 与网络失败都 reject 成带中文提示的 `Error`；「连不上」的提示里带地址和启动方式，因为那是最常见的故障。
- `miniprogram/models/record.ts` / `profile.ts` —— 数据访问层，见约束 1。
- `miniprogram/models/types.ts` —— 数据模型单一来源（`WeightRecord` / `UserProfile`），与服务端形状一致。
- `miniprogram/app.ts` —— 启动时探一次 `/api/health`，服务没起就直接弹窗；否则表现成四个页面各自弹「加载失败」，看不出病根。
- `local-server/server.js` —— 零依赖 HTTP 服务。JSON 落盘走「写 `.tmp` 再 rename」的原子写；记录常驻内存并整体持久化；按 `date` 唯一。`PORT` / `WR_DATA_DIR` 可用环境变量覆盖，被 `require` 时不自动监听（单测靠这个起临时实例）。

## 关键约束

改动相关代码前先读这几条，它们都是踩过或刻意设计的：

1. **数据层的取数策略是「一次拉全量，内存里筛」。** 每天一条，十年也才三千多条，全量传输比在本地服务上再造一套查询协议划算。三个配套机制别拆：

   - **`inflight` 合并同一时刻的多个读**。一次 `onShow` 常同时要「最近两条」和「最早一条」（见 `pages/index`），不合并就把同一份数据拉两遍。settle 后立刻清空 —— **这不是缓存，没有陈旧问题**，下次 `onShow` 照样重新读服务端。
   - **写成功后 `invalidate()`**，作废在飞的读，否则「写完立刻 refresh」可能读到写之前的快照。
   - **`fetchAll()` 返回 `slice()` 副本**，调用方改动不会污染共享数组。

   本地服务是明文 HTTP + 非备案域名，依赖 `project.config.json` 的 `setting.urlCheck: false`。**不要为了「规范」把它改回 true**，否则请求全被拦。

2. **「每天一条记录」是核心不变量。** 所有写入路径必须经过 `record.upsertByDate()`，由服务端 `upsertRecord()` 按 `date` 查重保证。不要在页面里直接 POST。

3. **改体重不带 `note` 就不发这个字段。** 服务端只在收到 `note` 时才覆盖备注 —— 这是修过的 bug：从记录页改体重时若发 `note: ''`，当天已有的备注会被静默清空。客户端和服务端两侧都有这个语义，改一侧要看另一侧（`record.upsertByDate` / `server.js` 的 `upsertRecord`），`tests/server.test.ts` 有对应用例。

4. **日期一律用 `'YYYY-MM-DD'` 字符串**，不要传 `Date` 或时间戳去做「哪一天」的比较。字典序即时间序，也免了时区问题。解析用 `utils/date.fromDateStr()`，**不要 `new Date(str)`** —— iOS 对 `-` 分隔的解析和其它平台不一致。服务端用同一个正则 `/^\d{4}-\d{2}-\d{2}$/` 校验。

5. **数据刷新写在 `onShow` 而非 `onLoad`。** 四个页面都是 tabBar 页，切换不会重新 `onLoad`；在「我的」改完身高、在「记录」删掉记录后切回，必须重算。

6. **Canvas 2D 的三个坑**（`pages/chart/`）：节点只能在 `onReady` 之后用 `createSelectorQuery` 查到；位图尺寸必须设为 CSS 尺寸 × `dpr` 再 `ctx.scale(dpr, dpr)`，否则高分屏上线条发虚。因此 `chart.ts` 缓存 `ctx` / `cssWidth` / `cssHeight` 在实例上（非 `data`）。

   第三个坑最隐蔽、已经踩过一次：**`onReady` 时 `hasData` 还是 `false`，`.chart-canvas.is-hidden` 把高度压成 `0`，那一刻量到的尺寸就是 0** —— 拿它去设位图等于把图表永久画到一张 0 高度的画布上，而 `initCanvas` 又只在 `onReady` 跑一次，结果是趋势页图表永远空白。现在的写法：`initCanvas` 量到零尺寸就放弃（不缓存、不标就绪），`redraw` 在有数据但 `cssHeight` 为 0 时重量一次，且绘制统一由 `setData` 的**回调**触发，保证量到的是更新后的布局。加任何「无数据就折叠/隐藏 canvas」的样式都要重新过一遍这条。

   改 `.chart-canvas` 的高度要回头确认 `utils/chart.ts` 里 `PADDING` 还够用。

7. **`app.json` 的 `"renderer": "webview"` 是修 bug 加的，不要删。** 走 Skyline 渲染时模拟器卡在微信启动页进不去（提交 592e7aa）。想启用 Skyline 就得连带把 Canvas 那套查询/尺寸逻辑重新验证一遍。

8. **wx API 类型用官方 `miniprogram-api-typings`**（通过 `typings/global.d.ts` 的 `/// <reference types="miniprogram-api-typings" />` 引入；`typings/` 下只有这一个文件，早先手写的 `wx.d.ts` 已删除）。用到新 API 时**不要 `(wx as any)` 绕过** —— 那等于放弃了静态检查手段。注意事件类型只有 `CustomEvent<Detail>`（`TapEvent`/`InputEvent`/`PickerEvent` 这些手写别名已不存在，页面里直接标 `WechatMiniprogram.CustomEvent<...>`）。

9. **不要用路径别名**（`@/foo`）。小程序运行时按相对路径 `require`，编译插件不做路径重写，别名会在运行时找不到模块。全部用相对路径。

10. **仓库位于 OneDrive 同步目录内。** 别把 `node_modules` / `miniprogram_npm` 引进来（已 gitignore，但 OneDrive 不看 gitignore，大量小文件会拖垮同步）。`local-server/data/` 也在 gitignore 里 —— 那是真实体重数据，不要提交。

11. **不做数据迁移。** 新增模型字段一律给可选、并在读取处兜默认值。服务端已有的 JSON 文件不会自动补字段，而且 **`updateProfile()` 只接受 `PROFILE_DEFAULTS` 里的已知键 —— 新增 profile 字段必须同步加到 `server.js`**，否则客户端存了服务端静默丢弃。反过来，`normalizeProfile()` 会丢掉文件里的未知残留键（提醒功能删掉后留下的 `reminderEnabled` / `reminderHour` 就是这么清掉的）。

12. **`local-server/server.js` 是给 Node 跑的 plain CommonJS**，不受 `tsconfig` 检查：不要写 TS 语法或 ESM import。末尾的 `if (require.main === module) start()` 守卫和 `module.exports` **不能删** —— `tests/server.test.ts` 靠它 `require` 进来再指定临时端口，删了测试会在导入时抢占 8765。

13. **新增页面照抄 `chart.ts` / `history.ts` 的写法。** 官方类型的 `Page()` 是单泛型 + `ThisType`：自定义实例属性（`ctx`、`cssWidth`、`raw`、`points`）必须**直接写在传给 `Page()` 的 options 字面量里**，才能让 `this.xxx` 有类型。写在外面或事后赋值都会丢类型。非渲染状态（画布上下文、原始数据数组）放实例属性而不是 `data`，避免无意义的 setData。

14. **`project.config.json` 被 git 跟踪，而开发者工具每次打开都会改写它**（补 `editorSetting`、`packOptions`、`babelSetting` 等）。所以它时不时处于 modified 状态、diff 有噪音；提交前只挑真正的改动（尤其别把 `urlCheck` 的改动混进去，见约束 1）。个人本地配置在 `project.private.config.json`，已 gitignore。

15. **体重/身高区间在 `config.ts`，但服务端有一份手抄的。** 客户端三处校验（打卡、记录页改写、目标体重）都读 `WEIGHT_RANGE` / `HEIGHT_RANGE`；`server.js` 的 `WEIGHT_MIN` / `WEIGHT_MAX` 是同值副本，**它没法 import TS，改一处要改两处**，`tests/server.test.ts` 里有断言会拦住不一致。

## 现状

分支 `main`。`project.config.json` 的 `appid` 是真实值；`cloudfunctions/` 与 `models/db.ts` 已随云开发一起删除。

**验证到哪一步了（谨慎对待，别高估）**：

- `tests/` 四个文件覆盖了「打卡写入 → 落盘」的服务端全程和数据层逻辑。**跑没跑过取决于当时机器上有没有 node**，交付时以实际执行结果为准，别默认它是绿的。
- **未在微信开发者工具 / 真机上验证过**：`wx.request` 打本地服务、Canvas 渲染、tabBar 切换刷新这些运行时行为，只有装了开发者工具的机器能走查。本机没装。
- 开发者工具的 `libVersion` 两份配置不一致（`project.config.json` 3.5.5 vs `project.private.config.json` 3.17.2）。

**`WeightRecord-问题分析报告.html`（未跟踪）已严重过期，不要照着它改。** 它是早前某次会话生成的诊断报告，通篇假设项目跑在微信云开发上，列的「阻断级问题」（缺云环境 ID、缺订阅模板、`console` 未声明、0 测试）现在全都不成立。当历史快照看，别当待办清单。
