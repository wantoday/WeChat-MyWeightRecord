# 体重记录

微信小程序，用来每天记一次体重，看趋势、算 BMI、追目标。

**数据直接存在手机上** —— 小程序用微信本地存储（`wx.setStorageSync`）读写，打开即用，不依赖电脑、不依赖网络，也不需要开通任何云服务。

技术栈：原生小程序 + TypeScript，手写 WXSS，运行时零第三方依赖。

> 早期版本用「电脑本地服务」（`local-server/`）存数据，需要先跑服务才能用。
> 该目录保留，仅用于把旧数据导出成 CSV；新版本的数据只存在手机里。

## 功能

| 页面 | 作用 |
|---|---|
| 打卡 | 录入今天的体重（支持斤 / kg 切换，默认斤），显示与上次的增减、BMI、目标完成度 |
| 趋势 | 近 7 天 / 近 30 天 / 全部的折线图，含目标参考线与区间统计 |
| 记录 | 倒序分页列表，点击改、长按删 |
| 我的 | 身高、目标体重、累计记录数 |

## 跑起来

只需要 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。

1. **导入项目** —— 开发者工具 → 导入项目，目录选仓库根目录。
2. **编译运行** —— 直接编译即可，数据自动保存在手机本地存储里，无需任何服务或配置。

**真机预览** —— 直接点「预览」生成二维码，手机扫码即可，数据存在手机上。

⚠️ 注意：手机本地存储会随「清理微信缓存 / 卸载重装」丢失，且不跨设备同步。需要长期保留的数据，建议定期导出（见下）。

## 数据怎么看、怎么导出

- 数据存在小程序本地存储里（key：`weight_records` 记录、`weight_profile` 档案），开发者工具里可用「调试器 → Storage」查看。
- 想导出成 Excel：临时把数据存回旧路径 —— 运行 `node local-server/server.js` 后，用浏览器打开 <http://127.0.0.1:8765/api/export.csv>（旧方案遗留能力，只导出旧 `local-server/data/records.json` 里的数据）。

## 开发

node/npm 只用于工具链，小程序运行时不依赖它们。

```bash
npm install
npm run typecheck                    # tsc --noEmit
npm test                             # vitest：服务端(遗留) + 数据层 + 纯函数
npx vitest run tests/record.test.ts  # 只跑某个文件
npx vitest run -t "每天一条"          # 按用例名过滤
```

## 目录

```
miniprogram/
  config.ts          全部可配置项集中在这里（分页步长、体重/身高区间、BMI 阈值）
  app.ts             启动逻辑（静默更新；数据在本地，无需健康检查）
  pages/             index(打卡) / chart(趋势) / history(记录) / profile(我的)
  models/            数据访问层：storage(手机本地存储后端) / record / profile / types
  utils/             纯函数：date / bmi / chart(绘图)
local-server/
  server.js          遗留的零依赖 Node HTTP 服务（旧方案，仅用于 CSV 导出）
  start-server.bat   双击启动（旧方案）
tests/               vitest：server(遗留服务端) / record(数据层) / date / bmi
typings/global.d.ts  引入官方 miniprogram-api-typings 的全局类型入口
```
