// ===== 设置页：搜索框聚焦/悬浮结果、方向键高亮、跨页定位与目标闪动 =====
// 纯代码搬运自 SettingsView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
export function useSettingsSearch() {
  return {
    // 搜索框聚焦：展开悬浮弹窗，并同步坐标与滚动/缩放监听
    onSettingsSearchFocus() {
      this.searchActiveIndex = 0
      this.settingsSearchOpen = true
      this._updateSearchPopupPos()
      window.addEventListener('scroll', this._updateSearchPopupPos, true)
      window.addEventListener('resize', this._updateSearchPopupPos)
    },
    // 失焦收起悬浮弹窗（选项用 mousedown.prevent 保证点击先于失焦生效）
    onSettingsSearchBlur() {
      this.settingsSearchOpen = false
      this._removeSearchPopupListeners()
    },
    _removeSearchPopupListeners() {
      window.removeEventListener('scroll', this._updateSearchPopupPos, true)
      window.removeEventListener('resize', this._updateSearchPopupPos)
    },
    // 按输入框当前位置计算弹窗的 fixed 坐标：右对齐、紧贴搜索框下方
    _updateSearchPopupPos() {
      const el = this.$refs.settingsSearchInput
      if (!el) return
      const r = el.getBoundingClientRect()
      this.searchPopup = { left: r.left, top: r.bottom + 4, width: r.width }
    },
    // 方向键上下切换高亮项（到首/尾即停，并让高亮行滚入可视区）
    moveSearchActive(step) {
      const len = this.settingsSearchResults.length
      if (!len) return
      this.searchActiveIndex = Math.min(Math.max(this.searchActiveIndex + step, 0), len - 1)
      this.$nextTick(() => {
        const rows = this.$refs.settingsSearchPopup?.children
        rows?.[this.searchActiveIndex]?.scrollIntoView({ block: 'nearest' })
      })
    },
    // 回车：跳转到当前高亮项（默认第一条）
    confirmSearchActive() {
      const item = this.settingsSearchResults[this.searchActiveIndex]
      if (item) this.goToSettingsSection(item)
    },
    // 点击 / 回车选中：清空关键字、收起悬浮弹窗，并按类型滚动到目标
    goToSettingsSection(item) {
      this.settingsSearch = ''
      this.settingsSearchOpen = false
      this._removeSearchPopupListeners()
      this.$refs.settingsSearchInput?.blur()
      const anchor = item.section
        ? this._findSettingItemEl(item.section, item.label)
        : document.getElementById('settings-section-' + item.key)
      if (!anchor) return
      // 分区标题对齐顶部，具体设置行居中，避免滚到后看不到目标行
      anchor.scrollIntoView({ behavior: 'smooth', block: item.section ? 'center' : 'start' })
      // 平滑滚动到位后再让目标毛玻璃块闪动（滚动途中就开始闪的话，头几次会被滚没）
      this._flashAfterScrollSettled(anchor, item.section || item.key)
    },
    // 等目标位置稳定（滚动停止）后再触发闪动：逐帧比对目标顶部坐标，
    // 连续若干帧不变即认为滚动结束。scrollIntoView 的 smooth 没有结束回调，故用此方式判定。
    _flashAfterScrollSettled(anchor, sectionKey) {
      cancelAnimationFrame(this._flashRaf)
      let prevTop = null
      let stableFrames = 0
      const tick = () => {
        if (!anchor.isConnected) { this._flashRaf = 0; return }
        const top = Math.round(anchor.getBoundingClientRect().top)
        if (prevTop !== null && Math.abs(top - prevTop) <= 1) stableFrames++
        else stableFrames = 0
        prevTop = top
        // 约 6 帧（~100ms）不再位移，视为滚动已停
        if (stableFrames >= 6) {
          this._flashRaf = 0
          this._flashSettingsBlock(anchor, sectionKey)
          return
        }
        this._flashRaf = requestAnimationFrame(tick)
      }
      this._flashRaf = requestAnimationFrame(tick)
    },
    // 跳转后闪烁目标毛玻璃块：具体设置项闪它所在的玻璃卡；
    // 分区标题本身不在玻璃卡内，改为闪该分区里的玻璃卡
    _flashSettingsBlock(anchor, sectionKey) {
      const cards = []
      const card = anchor && anchor.closest ? anchor.closest('.bg-surface') : null
      if (card) {
        cards.push(card)
      } else {
        const wrapper = document.getElementById('settings-section-' + sectionKey)?.closest('.mb-6')
        if (wrapper) {
          // 只取最外层玻璃卡，避免嵌套的玻璃块一起闪、显得过重
          const all = [...wrapper.querySelectorAll('.bg-surface')]
          cards.push(...all.filter(c => !all.some(o => o !== c && o.contains(c))))
        }
      }
      for (const el of cards) {
        el.classList.remove('settings-flash')
        // 强制重排，保证同一目标连续跳转时动画能重新触发
        void el.offsetWidth
        el.classList.add('settings-flash')
      }
      clearTimeout(this._flashTimer)
      this._flashTimer = setTimeout(() => {
        for (const el of cards) el.classList.remove('settings-flash')
      }, 2600)
    },
    // 跨页定位：其他页面（标题栏全局搜索等）跳转 /settings?focus=section 或 section|label 时，
    // 滚动到目标分区/设置行并闪动其毛玻璃块。
    // 定位成功后清掉 query，避免回退/刷新时重复定位；`_focusSig` 去重防止 watch 与 activated 重复执行。
    _applyRouteFocus() {
      const focus = this.$route.query.focus
      if (!focus) { this._focusSig = ''; return }
      if (focus === this._focusSig) return
      const [section, label] = String(focus).split('|')
      const anchor = label
        ? this._findSettingItemEl(section, label)
        : document.getElementById('settings-section-' + section)
      // DOM 尚未就绪（watch 早于 activated）时先返回，由 activated 再试一次
      if (!anchor) return
      this._focusSig = focus
      this.$router.replace({ path: '/settings' })
      // 分区标题对齐顶部，具体设置行居中，避免滚到后看不到目标行
      anchor.scrollIntoView({ behavior: 'smooth', block: label ? 'center' : 'start' })
      this._flashAfterScrollSettled(anchor, section)
    },
    // 在分区内按标签文本定位具体设置行（同一分区内标签文本唯一）
    _findSettingItemEl(section, label) {
      const sectionEl = document.getElementById('settings-section-' + section)
      const wrapper = sectionEl?.closest('.mb-6') || sectionEl?.parentElement
      if (!wrapper) return null
      for (const node of wrapper.querySelectorAll('label, h3, span')) {
        if (node.textContent.trim() === label) return node
      }
      return null
    },
  }
}
