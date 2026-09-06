/**
 * 全局配置 —— 唯一的配置出口，新增可配置项加在这里，不要散落到页面。
 *
 * 数据存在手机本地（微信小程序本地存储），不依赖电脑、不依赖网络，
 * 也不需要启动 local-server。local-server 目录保留，仍可手动导出 CSV。
 */

/** 历史列表分页步长 */
export const PAGE_SIZE = 20

/**
 * 体重合法区间（kg）。区间之外几乎必然是误输入（少打小数点、多打一位）。
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
