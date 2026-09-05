# 体重记录

微信小程序，用来每天记一次体重，看趋势、算 BMI、追目标。

**数据存在你自己的电脑上** —— 小程序通过 HTTP 直连本机跑的 `local-server`，不使用微信云开发，也不需要开通任何云服务。记录落盘成 `local-server/data/records.json`，随时能用文本编辑器或 Excel 打开。

技术栈：原生小程序 + TypeScript，手写 WXSS，运行时无第三方依赖；本地服务是零依赖的单文件 Node 脚本。

## 功能

| 页面 | 作用 |
|---|---|
| 打卡 | 录入今天的体重，显示与上次的增减、BMI、目标完成度 |
| 趋势 | 近 7 天 / 近 30 天 / 全部的折线图，含目标参考线与区间统计 |
| 记录 | 倒序分页列表，点击改、长按删 |
| 我的 | 身高、目标体重、累计记录数 |

## 跑起来

需要 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 和 [Node.js](https://nodejs.org/)（本地数据服务靠它跑）。

1. **启动本地数据服务** —— 双击 `local-server/start-server.bat`，或命令行：

   ```bash
   node local-server/server.js
   ```

   看到「本地数据服务已启动」即可，保持窗口开着。首次启动会自动建 `local-server/data/`。

2. **导入项目** —— 开发者工具 → 导入项目，目录选仓库根目录。

3. **编译运行** —— 模拟器直接用默认地址 `http://127.0.0.1:8765`，无需改动。项目已设置「不校验合法域名」（`project.config.json` 的 `setting.urlCheck: false`），本地 HTTP 请求不会被拦。

   服务没启动时，小程序启动就会弹窗提示，不会让你对着空白页猜。

4. **真机预览**（可选）—— 手机和电脑连同一个 Wi-Fi，把 `miniprogram/config.ts` 的 `LOCAL_SERVER_URL` 改成电脑的局域网 IP（`ipconfig` 查看），如 `http://192.168.1.5:8765`，再用「预览」生成开发版二维码。手机连不上就看看 Windows 防火墙有没有放行 Node。

## 数据怎么看、怎么导出

- 记录文件：`local-server/data/records.json`（每天一条，按日期升序）
- 档案文件：`local-server/data/profile.json`（身高、目标体重）
- 导出 Excel：浏览器打开 <http://127.0.0.1:8765/api/export.csv>，或 `curl http://127.0.0.1:8765/api/export.csv -o records.csv`（带 BOM，Excel 打开不乱码）

完整 API 见 `local-server/README.md`。

## 开发

node/npm 只用于工具链，小程序运行时不依赖它们。

```bash
npm install
npm run typecheck                    # tsc --noEmit
npm test                             # vitest：本地服务端到端 + 数据层 + 纯函数
npx vitest run tests/server.test.ts  # 只跑某个文件
npx vitest run -t "每天一条"          # 按用例名过滤
```

## 目录

```
miniprogram/
  config.ts          全部可配置项集中在这里（服务地址、体重/身高区间、BMI 阈值）
  app.ts             启动时探一次本地服务健康检查
  pages/             index(打卡) / chart(趋势) / history(记录) / profile(我的)
  models/            数据访问层：http / record / profile / types
  utils/             纯函数：date / bmi / chart(绘图)
local-server/
  server.js          零依赖 Node HTTP 服务，数据落盘在 data/（已 gitignore）
  start-server.bat   双击启动
tests/               vitest：server(端到端) / record(数据层) / date / bmi
typings/global.d.ts  引入官方 miniprogram-api-typings 的全局类型入口
```
