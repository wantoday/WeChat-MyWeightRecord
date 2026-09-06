/**
 * 数据存在手机本地（wx 本地存储），不需要本地服务，也不需要云开发，
 * 启动时不需要做任何网络健康检查。
 */
App({
  onLaunch() {
    // 小程序有新版本时静默更新，下次冷启动生效
    const updater = wx.getUpdateManager()
    updater.onUpdateReady(() => updater.applyUpdate())
  },
})
