# 体重记录

微信小程序，用来每天记一次体重，看趋势、算 BMI、追目标。

技术栈：原生小程序 + TypeScript + 微信云开发，手写 WXSS，无第三方依赖。

## 功能

| 页面 | 作用 |
|---|---|
| 打卡 | 录入今天的体重，显示与上次的增减、BMI、目标完成度 |
| 趋势 | 近 7 天 / 近 30 天 / 全部的折线图，含目标参考线与区间统计 |
| 记录 | 倒序分页列表，点击改、长按删 |
| 我的 | 身高、目标体重、每日提醒开关与时间 |

## 跑起来

需要先装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。本项目不需要 node/npm。

1. **导入项目** —— 开发者工具 → 导入项目，目录选仓库根目录。`project.config.json` 里 `appid` 是 `touristappid`（游客模式）；有自己的 AppID 就换掉，**云开发必须用真实 AppID**。

2. **开通云开发** —— 工具顶部「云开发」→ 开通 → 记下环境 ID。

3. **填环境 ID** —— 把环境 ID 写进 `miniprogram/config.ts` 的 `CLOUD_ENV_ID`。没填的话启动时会直接弹窗提示。

4. **建数据库集合** —— 云开发控制台 → 数据库，新建两个集合：

   | 集合 | 权限 |
   |---|---|
   | `weight_records` | 仅创建者可读写 |
   | `user_profile` | 仅创建者可读写 |

   权限必须选「仅创建者可读写」，否则用户能读到别人的体重。

5. **编译运行** —— 此时打卡、趋势、记录、身高/目标都可用。

## 每日提醒（可选）

提醒依赖订阅消息 + 定时云函数，比上面几步麻烦，不配也不影响其它功能：

1. 小程序后台 → 订阅消息 → 申请一个模板（关键词类似「提醒事项」+「提醒时间」），拿到模板 ID。
2. 模板 ID 填两处，必须一致：
   - `miniprogram/config.ts` 的 `REMINDER_TMPL_ID`
   - `cloudfunctions/remindDaily/index.js` 的 `TMPL_ID`
3. 核对 `index.js` 里 `data` 的字段名（`thing1` / `time2`）与你申请到的模板一致，不一致微信会报 `47003`。
4. 右键 `cloudfunctions/remindDaily` → 「上传并部署：云端安装依赖」。`config.json` 里的定时触发器会一起生效（每小时整点跑，函数内筛选到点的用户）。

已知限制：这里用的是**一次性订阅**，用户授权一次只能收到一条推送。要做到长期每天提醒，需要在小程序后台申请「长期订阅」权限（仅部分服务类目开放）。

## 目录

```
miniprogram/
  config.ts          全部可配置项集中在这里
  app.ts             云开发初始化
  pages/             index(打卡) / chart(趋势) / history(记录) / profile(我的)
  models/            数据访问层：db / record / profile / types
  utils/             纯函数：date / bmi / chart(绘图)
cloudfunctions/
  remindDaily/       定时提醒
typings/wx.d.ts      手写的小程序 API 类型声明（因为不装 npm）
```
