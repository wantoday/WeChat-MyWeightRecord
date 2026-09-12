# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## 项目是什么

微信小程序「体重记录」—— 原生小程序 + TypeScript，手写 WXSS，**运行时零第三方依赖**（`typescript` / `vitest` / `miniprogram-api-typings` 都是 devDependencies，只用于类型检查与测试）。功能：每天记一次体重，看趋势、算 BMI、追目标。

**数据只存在手机本地**：小程序用 `wx.setStorageSync` / `wx.getStorageSync` 读写（`weight_records` 记录、`weight_profile` 档案、`weight_unit` 单位偏好）。没有 `wx.cloud`、没有云数据库、没有云函数、没有订阅消息，也不需要本地服务或网络。

已删除的历史方案 —— **看到相关文件 / 旧文档 / 旧报告，不要按它改**：

- `cloudfunctions/remindDaily/`（空目录）、根目录 `cloudbaserc.json` / `.env.local`：历史残留，代码不读取，别照着改。`models/db.ts` 是真的删了。
- 本地 HTTP 数据服务：`local-server/` 保留，仅用于把旧数据导出 CSV；`tests/server.test.ts` 还在测它（提交 41958cf）。
- `local-server/data/` 里是真实体重数据，已 gitignore，不要提交。

## 常用命令

```bash
npm install                          # node v24 可用；node/npm 只服务工具链
npm run typecheck                    # tsc --noEmit，检查 miniprogram/ 下全部 TS
npm test                             # vitest run，10 文件 / 144 用例
npx vitest run tests/record.test.ts  # 只跑某个文件
npx vitest run -t "每天一条"          # 按用例名过滤
```

跑小程序本身：**微信开发者工具 → 导入项目（目录选仓库根）→ 编译**即可，数据自动落在手机本地存储，不需要起任何服务、不需要配置。真机直接点「预览」扫码。

- TS 编译由开发者工具编译插件完成（`project.config.json` → `setting.useCompilerPlugins: ["typescript"]`），工具自带 Node 运行时，因此小程序运行时不引入 npm 依赖；产物 `.js` / `.js.map` 生成在 `.ts` 同目录，已 gitignore。
- `tsconfig.json` 开了 `strict` + `noUnusedLocals`，多一个未使用的 import 就编译不过。`include` 只有 `miniprogram/` 和 `typings/` —— **`tests/` 和 `local-server/` 都不在类型检查范围内**，那边的错误只有跑测试时才暴露。
- 若机器上 node 不在 PATH（`npm` / `npx` 全部 `command not found`），**如实说明「本次改动未经 typecheck / 测试验证」**，不要假装跑过。

## 架构

严格分层，**页面不直接碰 `wx` 存储 API**：

```
pages/*  →  models/{record,profile}  →  models/storage  →  微信本地存储 (wx.setStorageSync)
                    ↑
              utils/{date,bmi,chart,unit,plan}   ← 纯函数，无副作用、不碰 wx API
                                                   (chart 只收 ctx；unit 做斤↔kg 换算；
                                                    plan 负责上传点的裁剪、配色、摘要)
```

- `miniprogram/config.ts` —— **唯一的配置出口**：`PAGE_SIZE`、`WEIGHT_RANGE`、`HEIGHT_RANGE`、`BMI_THRESHOLDS`、`PLAN_*`。新增可配置项加在这里，不要散落到页面。
- `miniprogram/models/storage.ts` —— 本地存储的唯一封装：`loadRecords` / `upsertRecord` / `removeRecordById` / `loadProfile` / `saveProfile` / `loadWeightUnit` / `saveWeightUnit`。数据清洗、「每天一条」查重、区间校验都在这里。
- `miniprogram/models/record.ts` / `profile.ts` —— 数据访问层，**对外保持 Promise 签名**（页面 `await` 调用），页面不需要关心底层是本地存储还是别的后端。
- `miniprogram/models/types.ts` —— 数据模型单一来源（`WeightRecord` / `UserProfile` / `WeightUnit` / `ChartRange`）。
- `miniprogram/app.ts` —— 只做静默更新；数据在本地，不需要健康检查。
- 页面：4 个 tabBar 页 —— `index` 打卡 / `chart` 趋势 / `history` 记录（倒序分页，点击改、长按删）/ `profile` 我的（身高、目标体重、累计记录数）；外加一个非 tab 页 `plan` 好友计划（`navigateTo` 进入）。

测试（`tests/`）：

| 文件 | 覆盖 |
|---|---|
| `server.test.ts` | 遗留服务端端到端：起真实 HTTP 服务（临时数据目录），走「打卡 → 落盘」全程，校验每天一条、备注保留、入参校验、删除、档案合并、CSV 导出 |
| `record.test.ts` | 数据层：测试内自装假 `wx`（Map 版 storage），校验分页 / 过滤 / 覆盖写 / 备注语义 |
| `unit.test.ts` | 斤↔kg 换算与存储精度 |
| `date.test.ts` / `bmi.test.ts` | 纯函数 |
| `merge.test.ts` | 合并纯函数：逐条 LWW、墓碑双向传播、脏数据清洗与时钟钳位 |
| `sync.test.ts` | 同步层：假 `wx.cloud.callFunction`，覆盖首次同步 / CONFLICT 重试 / 未开启时降级；以及墓碑复活、单位偏好的老格式兼容 |
| `cloud-sync.test.ts` | **真客户端 + 真云函数**：直接加载 `cloudfunctions/weightSync/index.js` 源码（只把 `wx-server-sdk` 换成内存实现），验证两端契约与两台设备往返。**里面用递增时钟替掉了 `Date.now`** —— 真实时间戳只有毫秒精度，连着几个 await 容易撞车，撞车时 LWW 平手判本地赢，测试会随机红 |
| `chart.test.ts` | 图表：假 ctx 收集 `fillText` 校验 kg↔斤 刻度；并按 `beginPath` 分组记录折线路径，校验多人曲线的 x 轴按自然日对齐、y 轴范围跨所有线 |
| `plan.test.ts` | 好友计划：**真客户端 + 真云函数**（加载 `cloudfunctions/weightPlan/index.js`，内存 SDK 实现 `add` / `doc().get|set|update` / `where().get|limit|remove`）。覆盖邀请码归一、NO_PLAN / FULL / NO_COLLECTION、两人 push 互不干扰、`members` 不含 openid、points 清洗与截断、未开启云时降级；以及 `toPlanPoints` 只留日期体重 |

## 云同步（可选能力）

数据仍以手机本地存储为准；云同步只是把本地这份数据挂到微信 openid 下，好让别的设备拉回来。

- **开关是 `miniprogram/config.ts` 的 `CLOUD_ENV_ID`**：留空 = 纯本地模式（`wx.cloud` 不初始化，「我的」页不显示同步卡），填了环境 ID 才启用。
- 客户端**不直连云数据库**，读写都走云函数 `cloudfunctions/weightSync`（`pull` / `push`）。openid 只在云函数里通过 `cloud.getWXContext().OPENID` 拿到 —— 客户端拿不到，也不该拿，所以不需要 `wx.login`。
- 云数据库集合 `user_data`，每个 openid 一条 doc，权限「仅管理端可读写」。
- 一次同步 = `pull`（拿快照 + doc 版本号）→ 本地合并（逐条 last-write-wins，按 `date` 为 key）→ `push`（带 CAS 乐观锁，版本对不上返回 `CONFLICT`，客户端整体重跑一次）。
- 合并逻辑全在 `miniprogram/utils/merge.ts`，纯函数（`now` 由参数传入，不调 `Date.now()`、不碰 wx），可单测。
- **删除是软删除（墓碑）**：`WeightRecord.deleted?: true`。`loadRecords()` 会过滤掉墓碑（页面与 `record.ts` 无感），`loadRawRecords()` 不过滤 —— 墓碑本身也要能同步，否则「删除」传不到别的设备。重新记录同一天会把墓碑清掉（复活）。
- `weight_unit` 现在存的是 `{ unit, updatedAt }`，`loadUnitPref()` 对老版本的裸字符串做了向后兼容兜底。
- 云函数的依赖用开发者工具「上传并部署：云端安装依赖」装，**不要在仓库里 `npm install`**（OneDrive 会同步 node_modules）。

## 好友减肥计划（可选能力）

邀请微信好友进同一个计划，趋势页把彼此的曲线叠在一张图上对比。**只共享「哪天多重」** —— 备注、身高、目标体重一律不上云（裁剪发生在 `utils/plan.toPlanPoints`，只有 `date` + `weight`）。

- 同样由 `CLOUD_ENV_ID` 开关：留空时 `isPlanEnabled()` 为 false，趋势页与「我的」页的计划入口都不显示，`pushMyPoints()` 直接 no-op。
- 邀请方式 = **6 位邀请码**：创建者拿到码发给好友，好友在 `pages/plan/plan` 里输入加入。没做转发分享卡 / 小程序码。
- 云数据库两个集合（**要在控制台先建好**，权限「仅管理端可读写」；没建时云函数返回 `NO_COLLECTION`）：
  - `plans`：`{ _id: 邀请码, code, name, createdAt, createdBy }`
  - `plan_members`：`{ _id: '<planId>_<openid>', planId, openid, nickname, joinedAt, updatedAt, points: [{date, weight}] }`
- **一人一个 member doc 是刻意的**：`push` 只写自己那条，天然没有并发覆盖，不需要 CAS，也不受单 doc 16MB 上限约束。`create` 只能用 `add`（`set` 是 upsert，码撞车会静默覆盖别人的计划），`join` / 首次 `push` 用 `set`，`push` 用 `update` + `updated:0` 回退 `set`。
- **不泄露 openid**：`members` 剥掉 `openid` 与 `_id`，按 `joinedAt` 排序后另发 `id: 'm<i>'`；调用者自己那条打 `isMe: true` —— 客户端拿不到自己的 openid，只能靠服务端标记。
- 计划名 ≤12、昵称 ≤8、成员 ≤10、点数 ≤366（`PLAN_POINT_LIMIT`）。**这些常量在 `cloudfunctions/weightPlan/index.js` 里有一份手抄副本**（同 `WEIGHT_RANGE` 与 `local-server` 的既有约定），改一边要改另一边。
- 打卡成功后在 `pages/index/index.ts` 静默 `void pushMyPoints()`：失败只 `console.warn`，不打扰用户。趋势页 `onShow` 拉成员，30 秒内复用缓存（`FETCH_TTL`），拉取失败只丢好友那几条线。
- 客户端入口：`miniprogram/models/plan.ts`（唯一联网层，出错抛可直接 toast 的人话 Error）、`miniprogram/utils/plan.ts`（纯函数）、`pages/plan/plan`（创建 / 加入 / 邀请码 / 成员 / 改昵称 / 退出）。本机记住的计划存在 storage 的 `weight_plan`（走 `models/storage.ts`，页面不碰 wx 存储 API）。
- 改昵称复用 `join`（云端整条覆盖），所以没有单独的 rename action。

## 关键约束

改相关代码前先读这几条，都是踩过或刻意设计的：

1. **数据层取数策略是「一次全量读，内存里筛」。** 每天一条，十年才三千多条，全量处理比在存储层再造查询协议划算。每次 `loadRecords()` 重新读一份新数组，天然没有陈旧快照问题，不需要 `inflight` 合并 / `invalidate()` 那套网络缓存机制；读接口返回的数组被调用方改动也不会污染后续读取。
2. **「每天一条记录」是核心不变量。** 所有写入路径必须经过 `record.upsertByDate()`，由 `storage.upsertRecord()` 按 `date` 查重保证。不要在页面里另写写入路径。
3. **改体重不带 `note` 就不改备注。** `upsertRecord` 只在收到 `note` 时才覆盖 —— 这是修过的 bug：从记录页改体重时若传 `note: ''`，当天已有备注会被静默清空。语义在 `storage.ts` 和遗留 `server.js` 两侧一致，改一侧要看另一侧，`record.test.ts` 和 `server.test.ts` 都有对应用例。
4. **日期一律用 `'YYYY-MM-DD'` 字符串**，不要传 `Date` 或时间戳去做「哪一天」的比较。字典序即时间序，也免了时区问题。解析用 `utils/date.fromDateStr()`，**不要 `new Date(str)`** —— iOS 对 `-` 分隔的解析和其它平台不一致。校验正则 `/^\d{4}-\d{2}-\d{2}$/`。
5. **数据刷新写在 `onShow` 而非 `onLoad`。** 四个页面都是 tabBar 页，切换不会重新 `onLoad`；在「我的」改完身高、在「记录」删掉记录后切回，必须重算。
6. **Canvas 2D 的三个坑**（`pages/chart/`）：节点只能在 `onReady` 之后用 `createSelectorQuery` 查到；位图尺寸必须设为 CSS 尺寸 × `dpr` 再 `ctx.scale(dpr, dpr)`，否则高分屏线条发虚（`chart.ts` 把 `ctx` / `cssWidth` / `cssHeight` 缓存在实例上，不放 `data`）。
   第三个坑最隐蔽、已经踩过：**`onReady` 时 `hasData` 还是 `false`，`.chart-canvas.is-hidden` 把高度压成 `0`，那一刻量到的尺寸就是 0** —— 拿它设位图等于把图表永久画到 0 高度的画布上，而 `initCanvas` 又只在 `onReady` 跑一次，结果是趋势页图表永远空白。现在的写法：`initCanvas` 量到零尺寸就放弃（不缓存、不标就绪），`redraw` 在有数据但 `cssHeight` 为 0 时重量一次，且绘制统一由 `setData` 的**回调**触发，保证量到的是更新后的布局。加任何「无数据就折叠 / 隐藏 canvas」的样式都要重新过一遍这条。改 `.chart-canvas` 的高度要回头确认 `utils/chart.ts` 里 `PADDING` 还够用。
7. **`app.json` 的 `"renderer": "webview"` 是修 bug 加的，不要删。** 走 Skyline 渲染时模拟器卡在微信启动页进不去（提交 592e7aa）。想启用 Skyline 就得连带把 Canvas 那套查询 / 尺寸逻辑重新验证一遍。
8. **wx API 类型用官方 `miniprogram-api-typings`**（通过 `typings/global.d.ts` 的 `/// <reference types="miniprogram-api-typings" />` 引入；早先手写的 `wx.d.ts` 已删除）。用到新 API 时**不要 `(wx as any)` 绕过**，那等于放弃唯一的静态检查手段。注意事件类型只有 `WechatMiniprogram.CustomEvent<Detail>`（`TapEvent` / `InputEvent` / `PickerEvent` 这些手写别名已不存在）。
9. **不要用路径别名**（`@/foo`）。小程序运行时按相对路径 `require`，编译插件不做路径重写，别名会在运行时找不到模块。全部用相对路径。
10. **新增页面照抄 `chart.ts` / `history.ts` 的写法。** 官方类型的 `Page()` 是单泛型 + `ThisType`：自定义实例属性（`ctx`、`cssWidth`、`raw`、`points`）必须**直接写在传给 `Page()` 的 options 字面量里**，`this.xxx` 才有类型；写在外面或事后赋值都会丢类型。非渲染状态（画布上下文、原始数据数组）放实例属性而不是 `data`，避免无意义 setData。
11. **不做数据迁移。** 新增模型字段一律给可选、并在读取处兜默认值。遗留 `server.js` 的 `updateProfile()` 只接受 `PROFILE_DEFAULTS` 里的已知键 —— 新增 profile 字段必须同步加到 `server.js`，否则客户端存了服务端静默丢弃；反过来 `normalizeProfile()` 会丢掉文件里的未知残留键。
12. **体重 / 身高区间在 `config.ts`，但遗留 `server.js` 有一份手抄副本**（`WEIGHT_MIN` / `WEIGHT_MAX`，它没法 import TS）。客户端三处校验（打卡、记录页改写、目标体重）都读 `WEIGHT_RANGE` / `HEIGHT_RANGE`；改一处要改两处，`tests/server.test.ts` 里有断言会拦住不一致。
13. **`local-server/server.js` 是给 Node 跑的 plain CommonJS**，不受 `tsconfig` 检查：不要写 TS 语法或 ESM import。末尾的 `if (require.main === module) start()` 守卫和 `module.exports` **不能删** —— `tests/server.test.ts` 靠它 `require` 进来再指定临时端口，删了测试会在导入时抢占 8765。`PORT` / `WR_DATA_DIR` 可用环境变量覆盖；JSON 落盘走「写 `.tmp` 再 rename」的原子写。
14. **仓库位于 OneDrive 同步目录内。** 别把 `node_modules` / `miniprogram_npm` 引进来（已 gitignore，但 OneDrive 不看 gitignore，大量小文件会拖垮同步）。
15. **`project.config.json` 被 git 跟踪，而开发者工具每次打开都会改写它**（补 `editorSetting`、`packOptions`、`babelSetting` 等）。所以它时不时处于 modified 状态、diff 有噪音；提交前只挑真正的改动（尤其别把 `urlCheck` 的改动混进去）。个人本地配置在 `project.private.config.json`，已 gitignore。
16. **趋势图的 x 轴按「自然日」而不是点序**（`utils/chart.ts`）。多人对比时各人记录的日子对不上，按点序画会把「3 号」和「10 号」画到同一个位置。现在起止取所有线的日期并集、`diffDays` 定比例；跨度 0（只有一天）时回退到居中。改这块注意 `tests/chart.test.ts` 里按 `beginPath` 分组断言折线路径的两个用例。

## 已验证到哪一步

- `npm run typecheck` 与 `npm test`（10 文件 / 144 用例）在装了 node 的机器上可以通过 —— 但别默认它是绿的，交付时以实际执行结果为准。
- **未在微信开发者工具 / 真机上验证过**：`wx.setStorageSync` 实际读写、Canvas 渲染、tabBar 切换刷新这些运行时行为，只有装了开发者工具的机器能走查。
- 开发者工具的 `libVersion` 两份配置不一致（`project.config.json` 3.5.5 vs `project.private.config.json` 3.17.2）。
- 遇到早期会话产出的诊断报告（如仓库根目录下的 `WeightRecord-问题分析报告.html`，未跟踪、可能已被清掉）**不要照着改**。那类报告通篇假设项目跑在微信云开发上，列的「阻断级问题」（缺云环境 ID、缺订阅模板、`console` 未声明、0 测试）现在全都不成立。

---

# CloudBase AI Development Rules Guide

> 以下部分是 CloudBase 工具链自动生成的投影（源：`.rules/cloudbase-rules.md` / `codebuddy-plugin/rules/cloudbase_rules.md`），如上所述，**本项目已移除云开发，数据走手机本地存储，下面这些 CloudBase 路由规则对本项目的数据层不适用**。只有在真的要把本项目迁回云开发 / 云函数 / CloudBase 托管时才需要照它走。

## Activation Contract

This file is a **compatibility projection** of the CloudBase routing contract. Keep semantics aligned with the CloudBase source guideline. Prefer stable skill identifiers; load full skill bodies on demand (local `rules/` / `.codebuddy/skills/` / `searchKnowledgeBase(mode="skill")`) — do **not** expand this entry into a full skill dump.

## Existing Implementation First

When the workspace already has an application with TODOs, fixed routes, or pre-created pages/services:

- Do **not** start with `ui-design` / visual exploration unless the user asks for redesign.
- Do **not** broad-read unrelated skills first.
- Inspect surfaces that already own the flow (`src/lib/backend.*`, `auth.*`, `*service.*`, route guards, submit handlers).
- Prefer patching TODOs in-place over parallel helpers or detached demos.
- Login + CRUD: inspect → verify providers if needed → patch active handlers → validate.

## Path resolution

When this document references `{skill-id}` or a rule name, resolve in order:

1. `.codebuddy/skills/{skill-id}/SKILL.md` or `.claude/skills/{skill-id}/SKILL.md`
2. `.codebuddy/rules/tcb/rules/{skill-id}/rule.md`
3. `rules/{skill-id}/rule.md` (or `rules/{skill-id}/SKILL.md`)
4. Search: `*{skill-id}*SKILL.md` / `*{skill-id}*rule.md`

Files already written as `rules/...` work across editors.

| Shorthand | Skill / rule id |
|-----------|-----------------|
| `auth-tool` | `auth-tool-cloudbase` |
| `auth-web` | `auth-web-cloudbase` |
| `auth-wechat` | `auth-wechat-miniprogram` |
| `auth-nodejs` | `auth-nodejs-cloudbase` |
| `web-development` | `web-development` |
| `miniprogram-development` | `miniprogram-development` |
| `cloudrun-development` | `cloudrun-development` |
| `cloud-functions` | `cloud-functions` |
| `http-api` | `http-api-cloudbase` |
| `no-sql-web-sdk` | `cloudbase-document-database-web-sdk` |
| `no-sql-wx-mp-sdk` | `cloudbase-document-database-in-wechat-miniprogram` |
| `relational-database-tool` | `relational-database-mcp-cloudbase` |
| `relational-database-web` | `relational-database-web-cloudbase` |
| `postgresql-development` | `postgresql-development-cloudbase` |
| `cloud-storage-web` | `cloud-storage-web` |
| `ui-design` | `ui-design` |
| `minimal-web-baas-demo` | `minimal-web-baas-demo` |
| `cloudbase-platform` | `cloudbase-platform` |
| `spec-workflow` | `spec-workflow` |

## Global must-read rules

- Identify the scenario first; read the matching skill **before** implementation.
- **Environment first:** call `envQuery({ action: "info" })` (or `tcb env list` / `tcb env use` if MCP missing). Use the returned `envId` everywhere. When the identifier is an alias, nickname, or other short form, **do not pass alias-like short forms directly** to `auth.set_env`, SDK init, console URLs, or generated config — first resolve to the canonical full `EnvId` with `envQuery(action=list, alias=..., aliasExact=true)`. If multiple environments match or no exact alias exists, stop and clarify.
- **Auth:** any login/register mention → read `{auth-tool}` first, configure providers, then platform auth (`{auth-web}` / `{auth-wechat}`). Management login ≠ app auth (`auth` vs `queryAppAuth` / `manageAppAuth`).
- **UI:** visual generation/redesign → read `{ui-design}` and output the design spec before UI code. Skip when the task is functional completion on existing pages.
- **Templates:** greenfield projects → `downloadTemplate` (`react` / `vue` / `miniprogram` / `uniapp`) before hand-scaffolding.
- **Native App / Flutter / RN** → `{http-api}`, not Web SDK rules.
- **Cloud Functions** → `{cloud-functions}` (not CloudRun unless containers are required).
- When writing MCP/tool results to files, pass serialized text (`JSON.stringify(result, null, 2)`), not raw objects. If a write tool says `content` expected a string but received an object, do not retry with the same raw object. Serialize the object first, then retry once with the serialized text, and make sure the retried call actually passes the serialized string rather than the original object.
- Generated / mirrored IDE artifacts are compatibility outputs, not the semantic source.
- After 2–3 failed attempts on the same path, stop and reroute (skill, runtime, auth domain, permission model, SDK boundary).

## Engineering constitution

Overrides convenience. Full rationale lives in `{web-development}`.

- Prepare backend resources (auth providers, tables/collections, storage domains, security rules) **before** frontend code. Prefer MCP; if MCP is missing in this session, configure MCP for next time and use `tcb` CLI now (see skill `cloudbase-cli` / tooling-fallback) — do **not** stall, and do **not** default to `tcb deploy`.
- **Do NOT use `any`** to bypass type errors (`: any`, `as any`, `@ts-ignore`, `@ts-nocheck`). Prefer `unknown` + guards / precise interfaces.
- **Self-verify before claiming done:** static (`tsc` / lint / build / tests) and runtime (user-visible flows). Name gaps explicitly if a layer cannot run.
- **Do not paper over failures:** no empty `try/catch`, no deleting failing tests to go green.
- **`ai.createModel(...)` / `wx.cloud.extend.AI.createModel(provider)` takes a GroupName**, not a vendor/model id. Legal: `"cloudbase"`, `"hunyuan-exp"`, or `"custom-<name>"`. Model ids go in `generateText` / `streamText` `model`. See `{ai-model-web}` / `{ai-model-nodejs}` / `{ai-model-wechat}`.
- **PostgreSQL / CloudBase PG / `app.rdb()`** → `{postgresql-development}`; do not use NoSQL or MySQL MCP for that path.
- **Web auth proof:** `auth.getSession()` with `data.session`. Do not use deprecated `getLoginState()` / `auth.getUser()` as login proof.
- **First frontend deploy** of a new app: `manageApps(action="createApp", ...)`. `manageHosting` is only for incremental updates of hosting-origin projects.

## High-priority routing table

| Scenario | Read first | Then read | Do NOT route to first | Must check before action |
|----------|------------|-----------|------------------------|--------------------------|
| Minimal Web BaaS demo (Todo/Notes/Chat) | `{minimal-web-baas-demo}` | `{web-development}`, `{no-sql-web-sdk}` or `{postgresql-development}` | `{cloud-functions}`, `{cloudrun-development}`, `{spec-workflow}`, `{ui-design}` | BaaS-first Web SDK CRUD; MCP schema only; **zero cloud functions** unless secrets / cron / rules-cannot-express |
| Web login / registration | `{auth-tool}` | `{auth-web}`, `{web-development}` | `{cloud-functions}`, `{http-api}` | Provider status and publishable key |
| WeChat mini program + CloudBase | `{miniprogram-development}` | `{auth-wechat}`, `{no-sql-wx-mp-sdk}` | `{auth-web}`, `{web-development}` | Whether the project uses `wx.cloud` |
| Native App / raw HTTP (Flutter / RN) | `{http-api}` | `{auth-tool}`, `{relational-database-tool}` | `{auth-web}`, `{no-sql-web-sdk}` | SDK boundary, OpenAPI, auth method |
| Web + NoSQL | `{web-development}` | `{no-sql-web-sdk}`, `{auth-web}` | `{relational-database-tool}`, `{http-api}` | Login state and DB permission model |
| CloudBase PostgreSQL / PG | `{postgresql-development}` | `{auth-tool}`, `{auth-web}`, `{web-development}` | `{relational-database-tool}`, `{no-sql-web-sdk}` | PG schema, usernamePassword, RLS |
| MySQL (legacy relational) | `{relational-database-tool}` | `{relational-database-web}`, `{http-api}` | `{no-sql-web-sdk}` | MCP manage vs app access; prefer PG for new envs |
| Cloud Functions | `{cloud-functions}` | domain skill | `{cloudrun-development}` | Event vs HTTP, runtime, `scf_bootstrap` |
| CloudRun backend | `{cloudrun-development}` | domain skill | `{cloud-functions}` | Container boundary, Dockerfile, CORS |
| AI Agent | `{cloudbase-agent}` | `{cloud-functions}` / `{cloudrun-development}` | — | AG-UI, SSE streaming |
| AI model (text/image/stream) | `{ai-model-web}` (or node/wechat) | sibling AI skills | `{cloudbase-agent}` first | Token Credits / Growth Plan preflight |
| UI generation | `{ui-design}` | platform skill | backend-only skills | Design specification first |
| Ops / troubleshooting | `{ops-inspector}` | `{cloud-functions}`, `{cloudrun-development}` | `{ui-design}`, `{spec-workflow}` | CLS, log time range |
| Spec / architecture | `{spec-workflow}` | platform guideline | jumping straight to code | Requirements → design → tasks |

### Routing reminders

- Web auth failures: usually skipped provider config, not missing UI snippets.
- Native failures: usually Web SDK misuse, not missing HTTP knowledge.
- Mini program failures: treating `wx.cloud` like Web auth/SDK.
- PG failures: falling back to MySQL/NoSQL or guessing raw HTTP instead of `app.rdb()`.
- AI model failures: missing Token Credits / Growth Plan — check packages before rewriting code.
- “最小前后端 / Todo / 留言板”: use `{minimal-web-baas-demo}` — **browser SDK CRUD**, not cloud-function middleware.

## Platform auth (never mix)

- **Web:** CloudBase Web SDK built-in auth (e.g. `auth.toDefaultLoginPage()`). Never invent OPENID-only Web flows.
- **Mini Program:** native / `wxContext.OPENID` in cloud functions. Never use Web SDK auth pages.
- **CloudRun / Node:** `@cloudbase/node-sdk` server-side; verify tokens, never trust client claims blindly.

## MCP + CLI

Prefer CloudBase MCP for manage/deploy when tools are loaded in **this** session. If MCP is missing (first session / after install), configure MCP for the next session and finish with `tcb` via `cloudbase-cli` — **never** default to `tcb deploy`.

## Deployment (pointer)

Full steps live in `{web-development}` / guideline `deployment-workflow` reference. Short form:

1. Backend first when the frontend depends on it (`manageFunctions` / `manageCloudRun`).
2. New static/Web apps: `manageApps` create/deploy path; do not silently switch an existing `manageHosting` site to a new URL shape.
3. After deploy, give CDN-cache-aware URLs (random query) and update README with env resources.

## Console links

Pattern: `https://tcb.cloud.tencent.com/dev?envId=${envId}#/{path}` — overview, `#/db/doc`, `#/db/mysql`, `#/scf`, `#/platform-run`, `#/storage`, `#/static-hosting`, `#/identity`, `#/ai`, `#/env`.

## Quality gate (before “done”)

1. EnvId known and used consistently.
2. Correct skill(s) read for the scenario.
3. Auth providers configured when login is in scope.
4. UI design spec only when visual work was requested.
5. Static + runtime verification evidence, or explicit gaps.
6. No cloud functions for pure BaaS CRUD demos unless secrets/cron/rules-cannot-express.
