# 本地数据服务（绕开云开发，数据直传本地电脑）

小程序打卡的数据不再走微信云开发，而是直接存到你电脑上。

## 怎么用

1. 双击 `start-server.bat`（或命令行 `node server.js`），看到「本地数据服务已启动」即可。
   - 首次启动会自动创建 `data/` 目录：`data/records.json`（体重记录）、`data/profile.json`（身高/目标/提醒）。
2. 打开微信开发者工具导入项目，编译运行。
   - 模拟器直接用默认配置 `http://127.0.0.1:8765`，无需任何改动。
   - 项目已设置「不校验合法域名」，本地 HTTP 请求不会被拦。
3. 真机预览（手机）：
   - 手机和电脑连同一个 Wi-Fi；
   - 把 `miniprogram/config.ts` 里的 `LOCAL_SERVER_URL` 改成电脑的局域网 IP，如 `http://192.168.1.5:8765`；
   - 用「预览」生成开发版二维码，开发版默认不校验域名，可直接访问本地服务；
   - 若手机连不上，检查 Windows 防火墙是否放行了 Node（弹窗时点「允许」）。

## 数据怎么看

- 记录文件：`data/records.json`（JSON，可直接用文本编辑器打开）
- Excel 友好导出：浏览器打开 `http://127.0.0.1:8765/api/export.csv`，会自动下载 CSV（带 BOM，Excel 直接打开不乱码）；也可用命令行 `curl http://127.0.0.1:8765/api/export.csv -o records.csv`

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康检查，返回记录条数 |
| GET | /api/records | 全部记录，按日期升序 |
| POST | /api/records | 新增/覆盖一条（body: `{date, weight, note?}`），同一天自动覆盖 |
| DELETE | /api/records/:id | 按 _id 删除 |
| GET | /api/profile | 读取档案（无则自动建默认） |
| POST | /api/profile | 合并更新档案 |
| GET | /api/export.csv | 导出全部记录为 CSV |

## 和云开发的关系

`miniprogram/config.ts` 里 `USE_LOCAL_SERVER = true` 表示走本地服务；
改成 `false` 并填好 `CLOUD_ENV_ID`（开通云开发后）即切回云端，两套代码都保留。
