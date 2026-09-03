import { CLOUD_ENV_ID } from './config'

App({
  onLaunch() {
    if (!CLOUD_ENV_ID) {
      // 没配环境 ID 的话，后续所有 database() 调用都会静默失败，
      // 这里直接弹窗打断，避免在页面上表现成「一直加载中」。
      console.error('[WeightRecord] CLOUD_ENV_ID 为空，请在 miniprogram/config.ts 中填写')
      void wx.showModal({
        title: '未配置云开发环境',
        content: '请在 miniprogram/config.ts 中填入 CLOUD_ENV_ID（开发者工具 → 云开发 → 环境设置）',
        showCancel: false,
      })
      return
    }

    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })

    // 小程序有新版本时静默更新，下次冷启动生效
    const updater = wx.getUpdateManager()
    updater.onUpdateReady(() => updater.applyUpdate())
  },
})
