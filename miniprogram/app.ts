import { LOCAL_SERVER_URL } from './config'
import { httpGet } from './models/http'

/**
 * 数据存在本机 local-server 上，不需要初始化微信云开发。
 *
 * 启动时先探一次健康检查：服务没起来是最常见的故障，若不在这里拦一下，
 * 表现就是四个页面各自弹「加载失败」，看不出到底是哪儿的问题。
 */
App({
  onLaunch() {
    void warnIfServerDown()

    // 小程序有新版本时静默更新，下次冷启动生效
    const updater = wx.getUpdateManager()
    updater.onUpdateReady(() => updater.applyUpdate())
  },
})

async function warnIfServerDown(): Promise<void> {
  try {
    await httpGet<{ ok: boolean }>('/api/health')
  } catch (err) {
    console.error('[WeightRecord] 本地数据服务不可用', err)
    void wx.showModal({
      title: '连不上本地数据服务',
      content: `请先在电脑上运行 local-server/start-server.bat。\n当前地址：${LOCAL_SERVER_URL}（真机预览需改成电脑的局域网 IP）`,
      showCancel: false,
    })
  }
}
