/**
 * 全局配置 —— 唯一的配置出口，新增可配置项加在这里，不要散落到页面。
 *
 * 数据存在你自己的电脑上：小程序通过 HTTP 直连 local-server
 * （见 local-server/README.md），不使用微信云开发。
 */

/**
 * 本地服务地址。
 * 模拟器用 127.0.0.1 即可；真机预览改成电脑的局域网 IP（ipconfig 查看），
 * 手机需与电脑同一 Wi-Fi。
 */
export const LOCAL_SERVER_URL = 'http://127.0.0.1:8765'

/** 单次请求超时（ms）。本地服务在同一台机器上，超过这个时间基本就是没启动。 */
export const REQUEST_TIMEOUT = 5000

/** 历史列表分页步长 */
export const PAGE_SIZE = 20

/**
 * 体重合法区间（kg）。区间之外几乎必然是误输入（少打小数点、多打一位）。
 * local-server/server.js 里有一份同值的校验 —— 它是 plain CommonJS，
 * 没法 import 本文件，改这里记得同步过去。
 */
export const WEIGHT_RANGE = { min: 20, max: 300 } as const

/** 身高合法区间（cm） */
export const HEIGHT_RANGE = { min: 100, max: 250 } as const

/** BMI 分级阈值（中国成人标准，与 WHO 标准不同） */
export const BMI_THRESHOLDS = {
  underweight: 18.5,
  normal: 24,
  overweight: 28,
} as const
