import { CLOUD_ENV_ID } from './config'

/**
 * 数据存在手机本地（wx 本地存储），本地功能不需要网络，也没有健康检查。
 *
 * 云同步是可选能力：配了 CLOUD_ENV_ID 才初始化 wx.cloud，
 * 没配就是纯本地模式 —— 不联网、不报错、「我的」页也不显示同步入口。
 */
App({
  onLaunch() {
    // 小程序有新版本时静默更新，下次冷启动生效
    const updater = wx.getUpdateManager()
    updater.onUpdateReady(() => updater.applyUpdate())

    if (CLOUD_ENV_ID) {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
    }
  },
})
