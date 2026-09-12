import { PLAN_NAME_MAX, PLAN_NICKNAME_MAX } from '../../config'
import { createPlan, fetchMembers, isPlanEnabled, joinPlan, leavePlan, loadPlan } from '../../models/plan'
import { loadWeightUnit } from '../../models/storage'
import type { PlanMember, WeightUnit } from '../../models/types'
import { memberStat } from '../../utils/plan'
import { unitLabel } from '../../utils/unit'

/**
 * 好友减肥计划页：创建 / 加入 / 看邀请码 / 看成员 / 改昵称 / 退出。
 *
 * 只共享「哪天多重」：上传的点集在 utils/plan.toPlanPoints 里就剥掉了备注等其它字段，
 * 所以这里提醒用户的隐私边界是真实的，不是一句安慰。
 *
 * 没有配云环境 ID 时整个功能不可用（isPlanEnabled 为 false），页面只给一句说明。
 */

interface MemberRow {
  id: string
  nickname: string
  /** 已按展示单位换算 */
  latest: number
  delta: number
  isMe: boolean
}

Page({
  data: {
    loading: true,
    /** 没配云环境 ID 时显示说明文案而非表单 */
    planEnabled: false,
    hasPlan: false,
    planName: '',
    planCode: '',
    nickname: '',
    nameInput: '',
    codeInput: '',
    nicknameInput: '',
    members: [] as MemberRow[],
    submitting: false,
    unit: 'jin' as WeightUnit,
    unitLabel: '斤',
  },

  /** 提交中。写在 Page() 字面量里 this.submitting 才有类型（项目约定） */
  locked: false,

  onShow() {
    void this.load()
  },

  async load(): Promise<void> {
    const local = isPlanEnabled() ? loadPlan() : null
    const unit = loadWeightUnit()
    this.setData({
      planEnabled: isPlanEnabled(),
      hasPlan: !!local,
      planName: local ? local.name : '',
      planCode: local ? local.code : '',
      nickname: local ? local.nickname : '',
      nicknameInput: local ? local.nickname : '',
      unit,
      unitLabel: unitLabel(unit),
    })
    await this.refreshMembers(false)
  },

  /** 拉成员列表。showLoading=true 时是用户主动点的刷新，要转圈。 */
  async refreshMembers(showLoading: boolean): Promise<void> {
    if (!this.data.hasPlan) {
      this.setData({ loading: false, members: [] })
      return
    }
    if (showLoading) wx.showLoading({ title: '加载中', mask: true })
    try {
      const res = await fetchMembers()
      const unit = this.data.unit
      const members: MemberRow[] = (res ? res.members : []).map((m: PlanMember) => {
        const stat = memberStat(m.points, unit)
        return {
          id: m.id,
          nickname: m.nickname,
          latest: stat ? stat.latest : 0,
          delta: stat ? stat.delta : 0,
          isMe: m.isMe,
        }
      })
      if (res) this.setData({ planName: res.plan.name, planCode: res.plan.code })
      this.setData({ members, loading: false })
    } catch (err) {
      this.setData({ loading: false })
      console.error('[plan] 成员列表加载失败', err)
      wx.showToast({ title: err instanceof Error ? err.message : '加载失败', icon: 'none', duration: 2500 })
    } finally {
      if (showLoading) wx.hideLoading()
    }
  },

  onNameInput(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    this.setData({ nameInput: e.detail.value.slice(0, PLAN_NAME_MAX) })
  },

  onCodeInput(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    // 邀请码大小写不敏感，直接转成大写，省得用户切输入法
    this.setData({ codeInput: e.detail.value.trim().toUpperCase().slice(0, 6) })
  },

  onNicknameInput(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    this.setData({ nicknameInput: e.detail.value.slice(0, PLAN_NICKNAME_MAX) })
  },

  /** 创建 / 加入 / 改昵称都归到这里：云函数那边是同一段「写我的成员 doc」逻辑 */
  async submit(kind: 'create' | 'join'): Promise<void> {
    if (this.locked) return
    const nickname = this.data.nicknameInput.trim()

    if (kind === 'join' && this.data.codeInput.trim().length !== 6) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' })
      return
    }

    this.locked = true
    this.setData({ submitting: true })
    wx.showLoading({ title: '处理中', mask: true })
    try {
      if (kind === 'create') {
        await createPlan(this.data.nameInput, nickname)
      } else {
        await joinPlan(this.data.codeInput, nickname)
      }
      // 先关 loading 再 toast：两者共用一个浮层，反序会把刚弹出的 toast 一起关掉
      wx.hideLoading()
      wx.showToast({ title: kind === 'create' ? '计划已创建' : '加入成功', icon: 'success' })
      await this.load()
    } catch (err) {
      wx.hideLoading()
      console.error('[plan] submit failed', err)
      wx.showToast({
        title: err instanceof Error ? err.message : '操作失败',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      this.locked = false
      this.setData({ submitting: false })
    }
  },

  onCreate(): void {
    void this.submit('create')
  },

  onJoin(): void {
    void this.submit('join')
  },

  /** 改昵称：复用「加入」—— 云端是整条覆盖，所以等于改昵称 + 覆盖自己的点 */
  async onRename(): Promise<void> {
    const res = await wx.showModal({
      title: '我的昵称',
      editable: true,
      placeholderText: `最多 ${PLAN_NICKNAME_MAX} 个字`,
      content: this.data.nickname,
    })
    if (!res.confirm) return
    const nickname = res.content.trim().slice(0, PLAN_NICKNAME_MAX)
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    await this.joinWith(nickname)
  },

  async joinWith(nickname: string): Promise<void> {
    this.locked = true
    wx.showLoading({ title: '保存中', mask: true })
    try {
      await joinPlan(this.data.planCode, nickname)
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.load()
    } catch (err) {
      wx.hideLoading()
      console.error('[plan] rename failed', err)
      wx.showToast({
        title: err instanceof Error ? err.message : '保存失败',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      this.locked = false
    }
  },

  onCopyCode(): void {
    wx.setClipboardData({
      data: this.data.planCode,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }),
    })
  },

  onRefresh(): void {
    void this.refreshMembers(true)
  },

  /** 退出：先让用户确认 —— 退出后云端那条成员数据会一起删掉，好友那边就看不到你了 */
  async onLeave(): Promise<void> {
    const res = await wx.showModal({
      title: '退出计划',
      content: '退出后你的体重不再共享给计划里的好友，云端数据会一并删除。本机记录不受影响。',
      confirmColor: '#ff3b30',
    })
    if (!res.confirm) return

    wx.showLoading({ title: '处理中', mask: true })
    try {
      await leavePlan()
      wx.hideLoading()
      wx.showToast({ title: '已退出', icon: 'success' })
      await this.load()
    } catch (err) {
      wx.hideLoading()
      console.error('[plan] leave failed', err)
      wx.showToast({
        title: err instanceof Error ? err.message : '退出失败',
        icon: 'none',
        duration: 2500,
      })
    }
  },
})
