/**
 * 最小化的小程序 API 类型声明。
 *
 * 本项目刻意不依赖 npm，所以没有装官方的 `miniprogram-api-typings`。
 * 这里只声明项目实际用到的 API —— 用到新 API 时在此补充声明，
 * 不要用 `(wx as any)` 绕过。
 *
 * 若将来机器上装了 node/npm，可执行：
 *   npm i -D miniprogram-api-typings
 * 然后删掉本文件，并在 tsconfig.json 的 compilerOptions 中加
 *   "types": ["miniprogram-api-typings"]
 */

declare namespace WechatMiniprogram {
  interface CallbackResult {
    errMsg: string
  }

  interface AsyncCallbacks<T = CallbackResult> {
    success?: (res: T) => void
    fail?: (err: { errMsg: string; errCode?: number }) => void
    complete?: () => void
  }

  /* ---------- 云数据库 ---------- */

  /** 查询/更新指令，对应 db.command */
  interface DBCommand {
    gte(v: unknown): DBQueryCondition
    lte(v: unknown): DBQueryCondition
    gt(v: unknown): DBQueryCondition
    lt(v: unknown): DBQueryCondition
    eq(v: unknown): DBQueryCondition
    neq(v: unknown): DBQueryCondition
    in(v: unknown[]): DBQueryCondition
    and(...v: unknown[]): DBQueryCondition
    or(...v: unknown[]): DBQueryCondition
    inc(v: number): DBQueryCondition
    set(v: unknown): DBQueryCondition
  }

  /** 指令产生的条件对象，直接放进 where() 的值位置 */
  interface DBQueryCondition {
    readonly __brand: 'DBQueryCondition'
  }

  interface DBQueryResult<T> {
    data: T[]
  }

  interface DBGetOneResult<T> {
    data: T
  }

  interface DBCountResult {
    total: number
  }

  interface DBAddResult {
    _id: string
  }

  interface DBWriteResult {
    stats: { updated: number; removed?: number }
  }

  interface DBDocument<T> {
    get(): Promise<DBGetOneResult<T>>
    set(opts: { data: Partial<T> }): Promise<DBWriteResult>
    update(opts: { data: Partial<T> }): Promise<DBWriteResult>
    remove(): Promise<DBWriteResult>
  }

  interface DBQuery<T> {
    where(cond: Record<string, unknown>): DBQuery<T>
    orderBy(field: string, order: 'asc' | 'desc'): DBQuery<T>
    limit(n: number): DBQuery<T>
    skip(n: number): DBQuery<T>
    field(mask: Record<string, boolean>): DBQuery<T>
    get(): Promise<DBQueryResult<T>>
    count(): Promise<DBCountResult>
    update(opts: { data: Partial<T> }): Promise<DBWriteResult>
    remove(): Promise<DBWriteResult>
  }

  interface DBCollection<T> extends DBQuery<T> {
    doc(id: string): DBDocument<T>
    add(opts: { data: Partial<T> }): Promise<DBAddResult>
  }

  interface DBDatabase {
    collection<T = Record<string, unknown>>(name: string): DBCollection<T>
    readonly command: DBCommand
    serverDate(opts?: { offset: number }): Date
  }

  interface Cloud {
    init(opts: { env: string; traceUser?: boolean }): void
    database(opts?: { env?: string }): DBDatabase
    callFunction<T = unknown>(opts: {
      name: string
      data?: Record<string, unknown>
    }): Promise<{ result: T }>
  }

  /* ---------- Canvas 2D ---------- */

  interface CanvasGradient {
    addColorStop(offset: number, color: string): void
  }

  interface CanvasContext {
    canvas: Canvas
    fillStyle: string | CanvasGradient
    strokeStyle: string | CanvasGradient
    lineWidth: number
    lineJoin: 'bevel' | 'round' | 'miter'
    lineCap: 'butt' | 'round' | 'square'
    font: string
    textAlign: 'left' | 'center' | 'right'
    textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic'
    globalAlpha: number
    scale(x: number, y: number): void
    clearRect(x: number, y: number, w: number, h: number): void
    fillRect(x: number, y: number, w: number, h: number): void
    beginPath(): void
    closePath(): void
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    arc(x: number, y: number, r: number, start: number, end: number): void
    stroke(): void
    fill(): void
    setLineDash(pattern: number[]): void
    fillText(text: string, x: number, y: number): void
    measureText(text: string): { width: number }
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient
  }

  interface Canvas {
    width: number
    height: number
    getContext(type: '2d'): CanvasContext
  }

  interface NodeRef {
    node: Canvas
    width: number
    height: number
  }

  interface SelectorQuery {
    select(selector: string): SelectorQuery
    fields(opts: { node?: boolean; size?: boolean }): SelectorQuery
    exec(cb: (res: (NodeRef | null)[]) => void): void
  }

  /* ---------- 事件 ---------- */

  interface EventTarget {
    id: string
    /** wxml 上 data-* 属性，值一律是 string */
    dataset: Record<string, string>
  }

  interface BaseEvent<D = Record<string, unknown>> {
    type: string
    timeStamp: number
    target: EventTarget
    /** 绑定事件的那个节点；取 data-* 时优先用它而非 target */
    currentTarget: EventTarget
    detail: D
  }

  type InputEvent = BaseEvent<{ value: string; cursor?: number }>
  type PickerEvent = BaseEvent<{ value: string }>
  type SwitchEvent = BaseEvent<{ value: boolean }>
  type TapEvent = BaseEvent

  /* ---------- 页面 / 组件宿主 ---------- */

  /**
   * 框架注入到页面 this 上的成员（不含用户自己写的 data / 方法）。
   * 刻意不在这里声明 data —— data 的精确类型由 Page() 的泛型参数提供，
   * 在此重复声明会与之交叉、把具体类型冲淡成 Record<string, unknown>。
   */
  interface PageBase {
    setData(data: Record<string, unknown>, cb?: () => void): void
    readonly options: Record<string, string>
    selectComponent(selector: string): unknown
  }

  /** 页面生命周期，全部可选 */
  interface PageLifecycle {
    onLoad?(query: Record<string, string>): void | Promise<void>
    onShow?(): void | Promise<void>
    onReady?(): void | Promise<void>
    onHide?(): void
    onUnload?(): void
    onPullDownRefresh?(): void | Promise<void>
    onReachBottom?(): void | Promise<void>
    onShareAppMessage?(): { title?: string; path?: string }
  }

  type PageInstance = PageBase & { readonly data: Record<string, unknown> }

  interface WindowInfo {
    pixelRatio: number
    windowWidth: number
    windowHeight: number
    safeArea: { top: number; bottom: number; left: number; right: number }
  }
}

/* ---------- wx 全局对象 ---------- */

declare const wx: {
  cloud: WechatMiniprogram.Cloud

  getStorageSync<T = unknown>(key: string): T | ''
  setStorageSync(key: string, value: unknown): void
  removeStorageSync(key: string): void

  showToast(opts: {
    title: string
    icon?: 'success' | 'error' | 'loading' | 'none'
    duration?: number
    mask?: boolean
  }): void
  hideToast(): void
  showLoading(opts: { title: string; mask?: boolean }): void
  hideLoading(): void
  showModal(opts: {
    title?: string
    content?: string
    showCancel?: boolean
    confirmText?: string
    cancelText?: string
    confirmColor?: string
    /** true 时弹窗内显示输入框，用户输入从 res.content 取 */
    editable?: boolean
    placeholderText?: string
  }): Promise<{ confirm: boolean; cancel: boolean; content?: string }>

  navigateTo(opts: { url: string }): void
  redirectTo(opts: { url: string }): void
  switchTab(opts: { url: string }): void
  navigateBack(opts?: { delta?: number }): void

  stopPullDownRefresh(): void
  createSelectorQuery(): WechatMiniprogram.SelectorQuery
  getWindowInfo(): WechatMiniprogram.WindowInfo
  nextTick(cb: () => void): void

  requestSubscribeMessage(opts: {
    tmplIds: string[]
  }): Promise<Record<string, 'accept' | 'reject' | 'ban' | 'filter'>>

  getUpdateManager(): {
    onUpdateReady(cb: () => void): void
    applyUpdate(): void
  }
}

/* ---------- 框架构造器 ---------- */

/**
 * 单泛型：T 直接吸收整个 options 字面量（data、自定义方法、自定义实例属性），
 * 所以 this.data.xxx、this.someMethod()、this.ctx 都有精确类型。
 */
declare function Page<T extends Record<string, unknown>>(
  options: T &
    WechatMiniprogram.PageLifecycle &
    ThisType<T & WechatMiniprogram.PageBase>
): void

declare function Component(options: Record<string, unknown>): void

declare function App(options: {
  onLaunch?(): void
  onShow?(): void
  onHide?(): void
  [key: string]: unknown
}): void

declare function getApp<T = Record<string, unknown>>(): T
declare function getCurrentPages(): WechatMiniprogram.PageInstance[]
