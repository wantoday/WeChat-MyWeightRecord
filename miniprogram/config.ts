/**
 * 全局配置。
 *
 * 两种数据存储方式，由 USE_LOCAL_SERVER 切换：
 *  - true  ：数据直传本地电脑（见 local-server/README.md），无需开通云开发；
 *  - false ：使用微信云开发，此时 CLOUD_ENV_ID 必须替换成你自己的环境 ID，
 *            否则所有数据库调用都会失败（errCode -601034）。
 * 环境 ID 获取方式：微信开发者工具 → 顶部「云开发」→ 环境设置 → 环境 ID。
 */

/** 本地模式开关：true = 数据直传本地电脑；false = 微信云开发 */
export const USE_LOCAL_SERVER = true

/**
 * 本地服务地址。
 * 模拟器用 127.0.0.1 即可；真机预览改成电脑的局域网 IP（ipconfig 查看），
 * 手机需与电脑同一 Wi-Fi。
 */
export const LOCAL_SERVER_URL = 'http://127.0.0.1:8765'

/** 云开发环境 ID。USE_LOCAL_SERVER=false 时必填。 */
export const CLOUD_ENV_ID = 'cloud1-d2gtj3uab09610477'

/** 云数据库集合名 */
export const COLLECTION = {
  /** 体重记录，每个用户每天最多一条（date 字段唯一） */
  records: 'weight_records',
  /** 用户档案：身高、目标体重、提醒设置，每个用户一条 */
  profile: 'user_profile',
} as const

/** 订阅消息模板 ID（每日提醒用）。在小程序后台「订阅消息」里申请后填入。 */
export const REMINDER_TMPL_ID = ''

/** 小程序端单次 collection.get() 最多返回 20 条，分页步长与之对齐 */
export const PAGE_SIZE = 20

/** BMI 分级阈值（中国成人标准，与 WHO 标准不同） */
export const BMI_THRESHOLDS = {
  underweight: 18.5,
  normal: 24,
  overweight: 28,
} as const
