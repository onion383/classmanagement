<template>
  <div class="h-full">
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center justify-between gap-4">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="settings" /> 系统设置</h1>

      <!-- 设置项搜索：输入即匹配，结果以悬浮弹窗形式出现在搜索框下方 -->
      <div class="relative flex-shrink-0">
        <input
          ref="settingsSearchInput"
          v-model="settingsSearch"
          type="text"
          @focus="onSettingsSearchFocus"
          @blur="onSettingsSearchBlur"
          @keydown.down.prevent="moveSearchActive(1)"
          @keydown.up.prevent="moveSearchActive(-1)"
          @keydown.enter.prevent="confirmSearchActive"
          class="block h-9 w-64 pl-[60px] pr-9 border border-border rounded-lg bg-bg text-sm text-text focus:outline-none focus:border-primary"
        />
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none">搜索</span>
        <span class="absolute left-12 top-1/2 -translate-y-1/2 w-px h-4 bg-border pointer-events-none"></span>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-text-muted pointer-events-none"><IconGlyph name="search" :size="16" tint="current" /></span>
      </div>

      <!-- 结果悬浮弹窗：与对话框窗口（删除确认 / 数据迁移等）同一套毛玻璃材质，即 .bg-surface 玻璃卡片。
           Teleport 到 body 且行内强制 position: fixed：毛玻璃主题下 .bg-surface 会把 position 设为
           relative 并附加 contain: paint，留在原位置会被裁切、退化为普通流内元素，无法悬浮。 -->
      <Teleport to="body">
        <div
          v-if="settingsSearchOpen"
          ref="settingsSearchPopup"
          class="settings-search-popup fixed z-[10002] bg-surface rounded-lg shadow-card"
          :style="{ position: 'fixed', left: searchPopup.left + 'px', top: searchPopup.top + 'px', width: searchPopup.width + 'px', height: '320px', overflow: 'auto' }"
        >
          <template v-if="settingsSearchResults.length">
            <div
              v-for="(item, idx) in settingsSearchResults"
              :key="settingsSearch + '#' + item.id"
              @mousedown.prevent="goToSettingsSection(item)"
              @mouseenter="searchActiveIndex = idx"
              class="settings-search-row px-3 py-2 text-sm text-text cursor-pointer truncate"
              :class="idx === searchActiveIndex ? 'bg-info/20' : 'hover:bg-info/10'"
              :style="{ animationDelay: Math.min(idx, 10) * 30 + 'ms' }"
            >{{ item.label }}</div>
          </template>
          <!-- 无匹配时同样保留弹窗（只是内容为空提示），沿用同一套浮入动画 -->
          <div v-else class="settings-search-row px-3 py-2 text-sm text-text-muted">无匹配的设置项</div>
        </div>
      </Teleport>
    </div>

    <!-- ========== 账号管理 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-account" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="user" :size="20" /> 账号管理</h2>

      <div class="bg-surface rounded-lg border border-border p-6">
        <h3 class="text-lg font-semibold text-text mb-4">账号信息</h3>
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div class="space-y-2 text-text-secondary">
            <p><span class="text-text-muted">当前用户：</span>{{ user.username }}</p>
            <p><span class="text-text-muted">权限：</span>{{ user.role === 'teacher' ? '班主任' : '科任老师' }}</p>
          </div>
          <div class="flex gap-3">
            <button @click="openModal('username')" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">修改用户名</button>
            <button @click="openModal('password')" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme">修改密码</button>
            <button @click="openModal('export')" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded transition-theme" :disabled="busyExport">导出数据库</button>
            <button @click="confirmLogout" class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded transition-theme">退出登录</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 学期设置 ========== -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 id="settings-section-semester" class="text-xl font-semibold text-text flex items-center gap-2"><IconGlyph name="calendar" :size="20" /> 学期设置</h2>
        <button
          @click="openAddSemester"
          :disabled="busySemester"
          class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-40 disabled:cursor-not-allowed"
        >增加学期</button>
      </div>

      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4 mb-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">选择学期</label>
          <div class="w-64">
            <AppSelect :model-value="semesterId" :options="semesterOptions" placeholder="选择学期" @change="onSelectSemester" />
          </div>
          <button
            @click="openRenameSemester"
            :disabled="!semesterId"
            class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme disabled:opacity-40 disabled:cursor-not-allowed"
          >修改学期名</button>
          <button
            @click="requestDeleteSemester"
            :disabled="!semesterId || busySemester"
            class="bg-danger text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-40 disabled:cursor-not-allowed"
          >删除学期</button>
        </div>
        <div class="flex items-center gap-4 mb-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">学期开始时间</label>
          <input type="date" v-model="semesterStart" @change="saveSemesterSettings" class="border border-border bg-bg text-text px-3 py-2 rounded-lg" />
        </div>
        <div class="flex items-center gap-4 mb-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">学期结束时间</label>
          <input type="date" v-model="semesterEnd" @change="saveSemesterSettings" class="border border-border bg-bg text-text px-3 py-2 rounded-lg" />
        </div>
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">本学期时长</label>
          <span class="text-sm text-text-secondary">{{ semesterWeeks ? `共 ${semesterWeeks} 周` : '—' }}</span>
        </div>
        <p class="text-xs text-text-muted mt-4">座位快照按天补存与座位指数结算均以当前学期范围为准</p>
      </div>
    </div>

    <!-- 增加学期（小弹窗：输入学期名；起止日期由后端按当前月份推算，之后可在上面调整） -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="showAddSemester" class="fixed inset-0 bg-black/40 flex items-center justify-center z-[10003]" @click.self="showAddSemester = false">
          <div class="bg-surface p-6 rounded-xl w-[26rem] shadow-card dialog-card border border-border">
            <h3 class="text-lg font-bold text-text mb-4">增加学期</h3>
            <input
              v-model="newSemesterName"
              placeholder="请输入学期名，如：2026秋季学期"
              class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4"
              @keydown.enter="confirmAddSemester"
            />
            <div class="flex justify-end gap-2">
              <button @click="showAddSemester = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
              <button @click="confirmAddSemester" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">确定</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 修改学期名（小弹窗：输入新名字，确定后即时保存） -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="showRenameSemester" class="fixed inset-0 bg-black/40 flex items-center justify-center z-[10003]" @click.self="showRenameSemester = false">
          <div class="bg-surface p-6 rounded-xl w-[26rem] shadow-card dialog-card border border-border">
            <h3 class="text-lg font-bold text-text mb-4">修改学期名</h3>
            <input
              v-model="semesterNameDraft"
              placeholder="如：2026秋季学期"
              class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4"
              @keydown.enter="saveSemesterName"
            />
            <div class="flex justify-end gap-2">
              <button @click="showRenameSemester = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
              <button @click="saveSemesterName" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">确定</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 删除学期确认 -->
    <ConfirmDialog
      :visible="showDeleteSemester"
      title="删除学期"
      :message="deleteSemesterMessage"
      confirm-text="删除"
      cancel-text="取消"
      :show-cancel="true"
      @confirm="confirmDeleteSemester"
      @cancel="showDeleteSemester = false"
    />

    <!-- ========== 撤销记录 ========== -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 id="settings-section-undo" class="text-xl font-semibold text-text flex items-center gap-2"><IconGlyph name="undo" :size="20" /> 撤销记录</h2>
        <button
          v-if="hasUndoRecords"
          @click="clearUndo"
          class="text-sm text-danger hover:underline disabled:opacity-40"
          :disabled="busyUndo"
        >清空所有撤销记录</button>
      </div>

      <div class="bg-surface rounded-lg border border-border p-6">

        <div v-if="!hasUndoRecords" class="text-sm text-text-muted text-center py-8">
          暂无编辑记录。在表格中修改数据后，这里会记录该次操作，之后可一键撤销、跨重启保留。
        </div>

        <div v-else class="space-y-6 max-h-[22rem] overflow-y-auto pr-1">
          <div v-for="group in undoGroups" :key="group.key" class="border border-border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2.5 bg-surface-hover border-b border-border">
              <span class="font-medium text-text">{{ groupLabel(group.key) }}</span>
              <span class="text-xs text-text-muted">{{ undoableCount(group) }} 步可撤销</span>
            </div>
            <ul class="divide-y divide-border max-h-72 overflow-auto">
              <li v-for="rec in group.records" :key="rec.id"
                  class="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-hover">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs text-text-muted flex-shrink-0">{{ fmtTs(rec.ts) }}</span>
                  <span class="text-sm text-text truncate">{{ rec.label }}</span>
                  <span v-if="rec.dir === 0" class="text-[11px] text-info flex-shrink-0">已撤销</span>
                </div>
                <div class="flex-shrink-0">
                  <button
                    v-if="rec.dir === 1"
                    @click="undoOne(rec.id)"
                    class="bg-warning hover:bg-warning-hover text-text-inverse text-xs px-3 py-1 rounded transition-theme disabled:opacity-40"
                    :disabled="busyUndo"
                  >撤销</button>
                  <button
                    v-else
                    @click="redoOne(rec.id)"
                    class="bg-info hover:bg-info-hover text-text-inverse text-xs px-3 py-1 rounded transition-theme disabled:opacity-40"
                    :disabled="busyUndo"
                  >重做</button>
                </div>
              </li>
            </ul>
          </div>
        </div>

      </div>
    </div>

    <!-- ========== 主题设置 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-theme" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="palette" :size="20" /> 主题设置</h2>

      <div class="bg-surface rounded-lg border border-border p-6">
          <!-- 主题设置区：主题选择 + 图标样式 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">主题</label>
            <AppSelect
              v-model="selectedThemeId"
              @change="onThemeSelect"
              :options="themeOptions"
              class="w-56"
            />
          </div>

          <!-- 图标样式切换 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">图标样式</label>
            <AppSelect
              v-model="iconStyle"
              @change="onIconStyleChange"
              :options="iconStyleOptions"
              class="w-56"
            />
            <span class="text-xs text-text-muted">影响侧边栏导航图标显示风格</span>
          </div>

          <!-- 标题栏/侧边栏毛玻璃配色切换 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">顶栏配色</label>
            <AppSelect
              v-model="topbarColor"
              @change="onTopbarColorChange"
              :options="topbarColorOptions"
              class="w-56"
            />
            <span class="text-xs text-text-muted">标题栏与侧边栏的毛玻璃底色（深蓝 / 白色调）</span>
          </div>

          <!-- 日夜模式 + 跟随系统（同一组：组内紧凑，上下留白更大，与相邻设置分开；仅支持夜间配色的主题显示） -->
          <div v-if="nightSupported" class="py-6 my-8 space-y-4">
            <div class="flex items-center gap-4">
              <label class="text-sm font-medium text-text w-16 flex-shrink-0">日夜模式</label>
              <ViewSwitch :modelValue="pendingMode" :options="modeSwitchOptions" @update:modelValue="onSelectMode" />
              <span class="text-xs text-text-muted">当前主题支持夜间配色</span>
            </div>
            <div class="flex items-center gap-4">
              <label class="text-sm font-medium text-text w-16 flex-shrink-0">跟随系统</label>
              <label class="inline-flex items-center cursor-pointer">
                <input type="checkbox" :checked="followSystem" @change="onFollowSystemChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
                <span class="ml-2 text-sm text-text-secondary">{{ followSystem ? '随系统深色/浅色自动切换' : '手动指定' }}</span>
              </label>
              <span class="text-xs text-text-muted">开启后按操作系统的深色/浅色偏好自动切换</span>
            </div>
          </div>

          <!-- 提示合并 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">提示合并</label>
            <label class="inline-flex items-center cursor-pointer">
              <input type="checkbox" :checked="mergeNotifications" @change="onMergeNotificationsChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
              <span class="ml-2 text-sm text-text-secondary">{{ mergeNotifications ? '合并相同内容的提示' : '相同内容每次单独展示' }}</span>
            </label>
            <span class="text-xs text-text-muted">相同类型的重复提示合并为一条并计数，避免遮挡页面</span>
          </div>

          <!-- 动画效果总开关 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">动画效果</label>
            <label class="inline-flex items-center cursor-pointer">
              <input type="checkbox" :checked="animationsEnabled" @change="onAnimationsChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
              <span class="ml-2 text-sm text-text-secondary">{{ animationsEnabled ? '已启用' : '已关闭' }}</span>
            </label>
            <span class="text-xs text-text-muted">关闭后禁用全部过渡与动画（含窗口淡入淡出、弹窗与列表动效）</span>
          </div>

          <!-- 背景图片（毛玻璃系主题：glass / glass2） -->
          <div v-if="isGlassTheme" class="border-t border-border pt-6 mt-6">
            <h3 class="text-lg font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="image" :size="18" /> 背景图片</h3>
            <div class="flex items-center gap-3 mb-2">
              <input
                ref="bgImageInput"
                type="file"
                accept="image/*"
                @change="onBgImageFileChange"
                class="hidden"
              />
              <button @click="$refs.bgImageInput.click()" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap flex items-center gap-1.5"><IconGlyph name="folder" :size="14" tint="current" /> 选择本地图片</button>
              <span v-if="bgImageFileName" class="text-sm text-text-secondary">已选: {{ bgImageFileName }}</span>
              <button v-if="bgImageUrl" @click="clearBgImage" class="text-sm text-danger hover:underline">清除</button>
            </div>
            <p class="text-xs text-text-muted">支持 JPG / PNG / GIF / WebP，留空使用默认弥散光斑</p>
            <div v-if="bgImageUrl" class="mt-3">
              <img :src="bgImagePreviewUrl" class="max-h-40 rounded border border-border object-cover shadow-sm" />
            </div>
          </div>

          <!-- 透明度设置（毛玻璃系主题：glass / glass2） -->
          <div v-if="isGlassTheme" class="border-t border-border pt-6 mt-6">
            <h3 class="text-lg font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="sliders" :size="18" /> 透明度设置</h3>
            <div class="space-y-5">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm font-medium text-text">背景遮罩层（有自定义背景图时）</label>
                  <span class="text-xs text-text-muted">{{ Math.round(bgMaskOpacity * 100) }}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="bgMaskOpacity"
                  @input="onBgMaskOpacityChange"
                  class="w-full"
                />
                <p class="text-xs text-text-muted mt-1">数值越高，背景图越不明显；越低，背景图越清晰</p>
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm font-medium text-text">组件透明玻璃层</label>
                  <span class="text-xs text-text-muted">{{ Math.round(glassOpacity * 100) }}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="glassOpacity"
                  @input="onGlassOpacityChange"
                  class="w-full"
                />
                <p class="text-xs text-text-muted mt-1">控制卡片、表格、通知弹窗等玻璃层的透明度</p>
              </div>
            </div>
          </div>
        </div>
      </div>

    <!-- ========== 工具箱设置 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-toolbox" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="toolbox" :size="20" /> 工具箱设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">是否启用工具箱</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="toolboxEnabled" @change="onToolboxChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ toolboxEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">关闭后立即隐藏工具箱并释放其窗口，下次启动也不再显示；开启立即显示</p>
        <div class="flex items-center gap-4 mt-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">新U盘插入自动打开</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="usbAutoOpen" @change="onUsbAutoOpenChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ usbAutoOpen ? '已开启' : '已关闭' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">插入新U盘时自动用文件资源管理器打开（仅Windows，即时生效）</p>
      </div>
    </div>

    <!-- ========== 桌面小组件设置 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-widget" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="monitor" :size="20" /> 桌面小组件设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">启用桌面小组件</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="desktopWidgetEnabled" @change="onDesktopWidgetChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ desktopWidgetEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">关闭后启动不创建桌面小组件窗口（更省资源），并可立即关闭当前窗口；开启立即显示</p>
        <div class="flex items-center gap-4 mt-5 pt-5 border-t border-border">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">桌面组件关闭最底层<span class="text-text-muted font-normal">（提升稳定性）</span></label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="noDesktopLayer" @change="onNoDesktopLayerChange" :disabled="!desktopWidgetEnabled" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" />
            <span class="ml-2 text-sm text-text-secondary">{{ noDesktopLayer ? '已关闭（稳定模式）' : '已开启' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">
          勾选后组件不再常驻所有窗口之下：不挂到桌面层，稳定性更高，但会盖在其他窗口上面、点击可能被抬到最前面。切换后组件会自动重启一次。
          <span v-if="desktopLayerAutoDisabled" class="block text-danger mt-1">上次启动时组件连续崩溃，已自动切换到稳定模式；确认无误后可在上面取消勾选重新开启。</span>
        </p>
      </div>
    </div>

    <!-- ========== 性能 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-perf" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="sliders" :size="20" /> 性能</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <!-- 四列等宽：前端 / 后端 / 小组件 / 全局（名称 / 状态 / 按钮 纵向排列） -->
        <div class="grid grid-cols-4 gap-4">
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">前端</span>
            <span class="text-sm font-medium" :class="perfAlive.front ? 'text-text' : 'text-text-muted'">{{ perfAlive.front ? '正常' : '未运行' }}</span>
            <button @click="restartFrontend" class="bg-info hover:bg-info-hover text-text-inverse border border-border px-3 py-1.5 rounded text-sm transition-theme">重启前端</button>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">后端</span>
            <span class="text-sm font-medium" :class="perfAlive.backend ? 'text-text' : 'text-text-muted'">{{ perfAlive.backend ? '正常' : '未运行' }}</span>
            <button @click="restartBackend" :disabled="busyRestartBackend" class="bg-info hover:bg-info-hover text-text-inverse border border-border px-3 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyRestartBackend ? '重启中…' : '重启后端' }}</button>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">小组件</span>
            <span class="text-sm font-medium" :class="perfAlive.widget ? 'text-text' : 'text-text-muted'">{{ perfAlive.widget ? '正常' : '未运行' }}</span>
            <button @click="restartWidget" :disabled="busyRestartWidget" class="bg-info hover:bg-info-hover text-text-inverse border border-border px-3 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyRestartWidget ? '重启中…' : '重启小组件' }}</button>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">全局</span>
            <span class="text-sm font-medium" :class="perfAllAlive ? 'text-text' : 'text-text-muted'">{{ perfAllAlive ? '正常' : '部分未启动' }}</span>
            <button @click="restartAll" :disabled="busyRestartAll" class="bg-info hover:bg-info-hover text-text-inverse border border-border px-3 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyRestartAll ? '重启中…' : '全部重启' }}</button>
          </div>
        </div>

        <!-- 内存占用：顶部为总计/平均/最高汇总，下方逐进程一条，条形宽度带过渡 -->
        <div class="border-t border-border pt-6 mt-6">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-text">内存占用</span>
            <button @click="recycleAll" :disabled="busyGc" class="w-24 text-center bg-primary hover:bg-primary-hover text-text-inverse px-4 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyGc ? '回收中…' : '回收' }}</button>
          </div>
          <div class="flex items-center justify-between gap-x-2 mb-4 text-sm text-text text-center" style="font-variant-numeric: tabular-nums;">
            <span>总计 {{ fmtMem(perfTotal) }}</span>
            <span class="text-text-muted">|</span>
            <span>平均 {{ fmtMem(perfAvg) }}</span>
            <span class="text-text-muted">|</span>
            <span>最高 {{ fmtMem(perfMax) }}</span>
            <span class="text-text-muted">|</span>
            <span>前端 {{ fmtMem(perfFront) }}</span>
            <span class="text-text-muted">|</span>
            <span>后端 {{ fmtMem(perfBackend) }}</span>
            <span class="text-text-muted">|</span>
            <span>其他 {{ fmtMem(perfOther) }}</span>
          </div>
          <div class="space-y-3">
            <div v-for="row in perfRows" :key="row.key" class="flex items-center gap-3">
              <span class="w-32 flex-shrink-0 truncate text-sm text-text-secondary" :title="row.name">{{ row.name }}</span>
              <div class="flex-1 h-2.5 rounded-full bg-bg border border-border overflow-hidden">
                <div class="h-full rounded-full bg-primary" :style="{ width: barPct(row.memKB) + '%', transition: 'width 480ms cubic-bezier(0.4, 0, 0.2, 1), background-color 250ms' }"></div>
              </div>
              <span class="w-20 flex-shrink-0 text-right text-sm text-text" style="font-variant-numeric: tabular-nums;">{{ fmtMem(row.memKB) }}</span>
            </div>
          </div>
        </div>

        <!-- 上次启动耗时 -->
        <div class="border-t border-border pt-6 mt-6 flex items-center gap-4">
          <span class="text-sm text-text-muted" title="口径：进程启动到窗口首次显示（ready-to-show），不含数据加载等待">上次启动耗时</span>
          <span class="text-sm font-medium text-text" style="font-variant-numeric: tabular-nums;">{{ (perfStartupTotal / 1000).toFixed(3) }} s</span>
        </div>
      </div>
    </div>

    <!-- ========== 保存路径设置 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-savepath" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="folder" :size="20" /> 保存路径设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6 space-y-6">
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">注释截屏保存位置</label>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="noteSavePath || screenshotDir">{{ noteSavePath || screenshotDir }}</div>
            </div>
            <button @click="selectFolder('note')" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">修改</button>
            <button @click="openDir(noteSavePath || screenshotDir)" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">打开文件夹</button>
          </div>
          <p class="text-xs text-text-muted ml-40">注释工具保存截图的目录，留空则使用默认位置</p>
        </div>
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">一键截屏保存位置</label>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="screenshotSavePath || screenshotDir">
                {{ screenshotSavePath || screenshotDir }}
              </div>
            </div>
            <button @click="selectFolder('screenshot')" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">修改</button>
            <button @click="openDir(screenshotSavePath || screenshotDir)" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">打开文件夹</button>
          </div>
          <p class="text-xs text-text-muted ml-40">一键截屏工具保存截图的目录，留空则使用默认位置</p>
        </div>
      </div>
    </div>

    <!-- ========== 数据目录设置 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-datadir" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="box" :size="20" /> 数据目录设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6 space-y-6">
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">数据库目录</label>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="dataDir">
                {{ dataDir || '加载中…' }}
              </div>
            </div>
            <button @click="changeDataDir" :disabled="busyDataDir" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">
              {{ busyDataDir ? '搬迁中…' : '修改' }}
            </button>
            <button @click="openDir(dataDir)" :disabled="busyDataDir" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">打开文件夹</button>
          </div>
          <p class="text-xs text-text-muted ml-40">存放数据库（index.db、各老师库）与上传图片等用户数据的目录。修改会整体搬迁现有数据并重启应用服务。</p>
        </div>
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">相册缩略图缓存</label>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="thumbsDir">
                {{ thumbsDir || '加载中…' }}
              </div>
            </div>
            <button @click="changeThumbsDir" :disabled="busyThumbsDir" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">
              {{ busyThumbsDir ? '切换中…' : '修改' }}
            </button>
            <button @click="openDir(thumbsDir)" :disabled="busyThumbsDir" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">打开文件夹</button>
          </div>
          <p class="text-xs text-text-muted ml-40">相册缩略图是可再生的缓存，可放到独立目录（如临时盘/SSD）；切换后已有缩略图会自动重建。</p>
        </div>
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">技能文件目录</label>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="skillsDir">
                {{ skillsDir || '加载中…' }}
              </div>
            </div>
            <button @click="changeSkillsDir" :disabled="busySkillsDir" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">
              {{ busySkillsDir ? '搬迁中…' : '修改' }}
            </button>
            <button @click="openDir(skillsDir)" :disabled="busySkillsDir" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">打开文件夹</button>
          </div>
          <p class="text-xs text-text-muted ml-40">AI 技能 md 文件的存放目录（按老师分文件夹）。修改会把现有技能文件搬迁到新目录并重启应用服务；AI 记忆文件不在此目录，不受影响。</p>
        </div>
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">数据库加密</label>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="dbEncrypted ? '已加密（推荐）' : '未加密（明文存储）'">
                {{ dbEncryptionLoading ? '加载中…' : (dbEncrypted ? '已加密（推荐）' : '未加密（明文存储）') }}
              </div>
            </div>
            <button @click="toggleDbEncryption" :disabled="busyDbEncryption || dbEncryptionLoading" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 whitespace-nowrap">
              {{ busyDbEncryption ? '转换中…' : (dbEncrypted ? '关闭加密' : '启用加密') }}
            </button>
          </div>
          <p class="text-xs text-text-muted ml-40">控制本账号数据库文件的落盘加密。关闭后数据库以明文保存，任何能访问该文件的程序都可直接读取其中数据；仅影响本账号，不影响其它账号。</p>
        </div>
      </div>
    </div>

    <!-- ========== 危险操作 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-danger" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="trash" :size="20" /> 危险操作</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div class="space-y-2 text-text-secondary">
            <p class="font-medium text-text">删除账号</p>
            <p class="text-sm text-text-muted">删除当前账号及其全部数据，操作不可恢复。</p>
          </div>
          <button @click="openDeleteAccount" class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded transition-theme">删除账号</button>
        </div>
      </div>
    </div>

    <!-- 内嵌弹窗：修改用户名 -->
    <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modalType === 'username'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
        <div class="dialog-card bg-surface rounded-lg p-6 w-96 border border-border shadow-lg">
          <h3 class="text-lg font-bold text-text mb-4">修改用户名</h3>
          <input v-model="newUsername" placeholder="新用户名" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
          <input v-model="usernamePassword" type="password" placeholder="当前密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-4 rounded" />
          <div class="flex justify-end gap-2">
            <button @click="closeModal" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
            <button @click="changeUsername" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">确认修改</button>
          </div>
        </div>
      </div>
    </Transition>
    </Teleport>

    <!-- 内嵌弹窗：修改密码 -->
    <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modalType === 'password'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
        <div class="dialog-card bg-surface rounded-lg p-6 w-96 border border-border shadow-lg">
          <h3 class="text-lg font-bold text-text mb-4">修改密码</h3>
          <input v-model="oldPassword" type="password" placeholder="原密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
          <input v-model="newPassword" type="password" placeholder="新密码" autocomplete="new-password" class="border border-border bg-surface text-text p-2 w-full mb-4 rounded" />
          <div class="flex justify-end gap-2">
            <button @click="closeModal" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
            <button @click="changePassword" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme">确认修改</button>
          </div>
        </div>
      </div>
    </Transition>
    </Teleport>

    <!-- 内嵌弹窗：导出数据库 -->
    <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modalType === 'export'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
        <div class="dialog-card bg-surface rounded-lg p-6 w-96 border border-border shadow-lg">
          <h3 class="text-lg font-bold text-text mb-4">导出数据库</h3>
          <p class="text-xs text-text-muted mb-3">导出当前库（业务数据 + 应用设置 + 账号），换机后用对应的密码恢复。</p>
          <input v-model="exportPassword" type="password" placeholder="登录密码（未设密码可留空）" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
          <template v-if="dbEncrypted">
            <label class="flex items-center gap-2 text-sm text-text mb-2 cursor-pointer select-none">
              <input type="checkbox" v-model="exportEncrypt" class="w-4 h-4 accent-warning" />
              数据库密码加密导出
            </label>
            <input v-model="exportDbPwd" type="password" :disabled="!exportEncrypt" placeholder="数据库密码（有密码账号留空则默认用账号密码）" autocomplete="new-password" class="border border-border bg-surface text-text p-2 w-full mb-4 rounded disabled:opacity-50" />
          </template>
          <p v-else class="text-xs text-text-muted mb-4">当前数据库未加密，导出的备份包为明文，无需设置导出密码。</p>
          <div class="flex justify-end gap-2">
            <button @click="closeModal" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
            <button @click="exportDb" :disabled="busyExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50">
              {{ busyExport ? '导出中…' : '导出备份' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
    </Teleport>

    <ConfirmDialog
      v-if="dialogMounted"
      :visible="dialog.visible"
      :title="dialog.title"
      :message="dialog.message"
      :type="dialog.type"
      :showCancel="dialog.showCancel"
      :confirmText="dialog.confirmText"
      :confirmDisabled="dialog.confirmDisabled"
      @confirm="onDialogConfirm"
      @cancel="onDialogCancel"
    />
  </div>
</template>

<script>
import axios from 'axios'
import { listUndo, undoById, redoById, clearUndo } from '../../api/undo'
import { defineAsyncComponent } from 'vue'
import AppSelect from '../../components/base/AppSelect.vue'
import { Sun, Moon } from '@lucide/vue'
import ViewSwitch from '../../components/base/ViewSwitch.vue'
import { useThemeStore } from '../../stores/theme'
import { storeToRefs } from 'pinia'
import { resourceUrl } from '../../utils/apiUrl'
import { pad2 } from '../../utils/dateTime.js'
import '../../styles/dialog-transition.css'
import { useNotification } from '../../composables/useNotification'
import { useSettingsSearch } from './SettingsView.search.js'
import { useSettingsData } from './SettingsView.data.js'
import { useSettingsAppearance } from './SettingsView.appearance.js'
import { RECEIVE } from '../../electronChannels.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../../components/base/ConfirmDialog.vue'))

export default {
  components: { AppSelect, ConfirmDialog, ViewSwitch },
  // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
  watch: {
    'dialog.visible'(n) { if (n) this.dialogMounted = true },
    // 关键字变化时高亮回到第一条（回车默认跳第一个）
    settingsSearch() { this.searchActiveIndex = 0 },
    // 跨页定位：其他页面（如标题栏全局搜索）跳转到 /settings?focus=... 时定位到目标设置
    '$route.query.focus'() { this._applyRouteFocus() }
  },
  data() {
    const themeStore = useThemeStore()
    const { currentTheme, bgMaskOpacity, glassOpacity, iconStyle, topbarColor, animationsEnabled, pendingMode, nightSupported, followSystem } = storeToRefs(themeStore)

    return {
      themeStore,
      currentTheme,
      bgMaskOpacity,
      glassOpacity,
      iconStyle,
      topbarColor,
      animationsEnabled,
      pendingMode,
      nightSupported,
      followSystem,
      // 设置项搜索：输入即匹配，结果以悬浮弹窗显示在搜索框下方，点击滚动到对应设置区
      settingsSearch: '',
      settingsSearchOpen: false,
      // 悬浮弹窗的视口坐标（Teleport 到 body 后用 fixed 定位，需要手动计算）
      searchPopup: { left: 0, top: 0, width: 0 },
      // 搜索弹窗当前高亮项下标（方向键上下切换、回车跳转）
      searchActiveIndex: 0,
      // py 为标题拼音首字母，让单个字母（如 z → 主题设置）也能命中
      settingsSections: [
        { key: 'account',  label: '账号管理',       py: 'zhgl' },
        { key: 'semester', label: '学期设置',       py: 'xqsz' },
        { key: 'undo',     label: '撤销记录',       py: 'cxjl' },
        { key: 'theme',    label: '主题设置',       py: 'ztsz' },
        { key: 'toolbox',  label: '工具箱设置',     py: 'gjxsz' },
        { key: 'widget',   label: '桌面小组件设置', py: 'zmxjjsz' },
        { key: 'perf',     label: '性能',           py: 'xn' },
        { key: 'savepath', label: '保存路径设置',   py: 'bcljsz' },
        { key: 'datadir',  label: '数据目录设置',   py: 'sjmlsz' },
        { key: 'danger',   label: '危险操作',       py: 'wxcz' },
      ],
      // 分区内的具体设置项：命中后滚动到该设置行（py 为标签拼音首字母）
      settingsItems: [
        { label: '选择学期',                 section: 'semester', py: 'xzq' },
        { label: '学期开始时间',             section: 'semester', py: 'xqkssj' },
        { label: '学期结束时间',             section: 'semester', py: 'xqjssj' },
        { label: '本学期时长',               section: 'semester', py: 'bxqsc' },
        { label: '主题',                     section: 'theme',    py: 'zt' },
        { label: '图标样式',                 section: 'theme',    py: 'tbys' },
        { label: '顶栏配色',                 section: 'theme',    py: 'dlps' },
        { label: '日夜模式',                 section: 'theme',    py: 'ryms' },
        { label: '跟随系统',                 section: 'theme',    py: 'gsxt' },
        { label: '提示合并',                 section: 'theme',    py: 'tshb' },
        { label: '动画效果',                 section: 'theme',    py: 'dhxg' },
        { label: '背景遮罩层（有自定义背景图时）', section: 'theme', py: 'bjzzc' },
        { label: '组件透明玻璃层',           section: 'theme',    py: 'zjtmlbl' },
        { label: '是否启用工具箱',           section: 'toolbox',  py: 'sfqygjx' },
        { label: '本次启用工具箱',           section: 'toolbox',  py: 'bcqygjx' },
        { label: '新U盘插入自动打开',        section: 'toolbox',  py: 'xupcrzddk' },
        { label: '启用桌面小组件',           section: 'widget',   py: 'qyzmxjjs' },
        { label: '桌面组件关闭最底层',       section: 'widget',   py: 'zmzjgbzdc' },
        { label: '注释截屏保存位置',         section: 'savepath', py: 'zsjpbcwz' },
        { label: '一键截屏保存位置',         section: 'savepath', py: 'yjjpbcwz' },
        { label: '数据库目录',               section: 'datadir',  py: 'sjkml' },
        { label: '相册缩略图缓存',           section: 'datadir',  py: 'xcsltch' },
        { label: '技能文件目录',             section: 'datadir',  py: 'jnwjml' },
        { label: '数据库加密',               section: 'datadir',  py: 'sjkjm' },
      ],
      // 图标样式选项：彩色图标 / Emoji
      iconStyleOptions: [
        { value: 'color', label: '彩色图标' },
        { value: 'emoji', label: 'Emoji' },
      ],
      // 标题栏/侧边栏毛玻璃配色：深蓝（旧款）/ 白色调
      topbarColorOptions: [
        { value: 'blue', label: '深蓝' },
        { value: 'light', label: '白色调' },
      ],
      // 日夜模式切换：日间 / 夜间（图标为标题栏同款太阳 / 月亮）
      modeSwitchOptions: [
        { value: 'day', label: '日间', icon: Sun },
        { value: 'night', label: '夜间', icon: Moon },
      ],
      // Modal
      modalType: '',
      newUsername: '',
      usernamePassword: '',
      oldPassword: '',
      newPassword: '',
      // Export database
      exportPassword: '',
      exportEncrypt: true,
      exportDbPwd: '',
      busyExport: false,
      // 学期设置（多学期列表 + 当前学期；起止日期供座位快照按天结算）
      semesters: [],
      semesterId: null,
      semesterNameDraft: '',
      showRenameSemester: false,
      newSemesterName: '',
      showAddSemester: false,
      showDeleteSemester: false,
      busySemester: false,
      semesterStart: '',
      semesterEnd: '',
      // Dialog
      dialog: {
        visible: false,
        message: '',
        type: 'alert',
        showCancel: false,
      },
      dialogMounted: false,
      dialogCallback: null,
      // 「删除账号」倒计时定时器
      deleteTimer: null,
      // 工具箱设置
      toolboxEnabled: true,
      noteSavePath: '',
      screenshotSavePath: '',
      screenshotDir: '',
      usbAutoOpen: false,
      // 桌面小组件启用状态：localStorage 持久化，默认启用（主进程据此按需创建桌面小组件窗口）
      desktopWidgetEnabled: (localStorage.getItem('desktopWidgetEnabled') ?? '1') !== '0',
      // 「桌面组件关闭最底层」：真实状态存在主进程（连续崩溃时会被自动关闭），这里只是界面镜像，
      // mounted 时用 IPC 同步初值
      noDesktopLayer: false,
      // 是否由「连续启动崩溃」自动降级而来（用于在设置页给出原因说明）
      desktopLayerAutoDisabled: false,
      loaded: false,
      _fromMainHandler: null,
      // 数据目录 / 缓存目录
      dataDir: '',
      thumbsDir: '',
      skillsDir: '',
      busyDataDir: false,
      busyThumbsDir: false,
      busySkillsDir: false,
      // 数据库加密（仅当前账号）
      dbEncrypted: true,
      dbEncryptionLoading: true,
      busyDbEncryption: false,
      // 撤销记录
      undoGroups: [],
      busyUndo: false,
      // Theme
      selectedThemeId: '',
      // 是否合并相同内容的重复提示
      mergeNotifications: true,
      // Background image
      bgImageUrl: '',
      bgImageFileName: '',
      // 性能面板：逐进程内存列表 + 三个重启目标的存活状态
      perfProcs: [],
      // 首位进程条形的目标占比（0.85~0.95）：让最高占用不固定满格，每次采样小幅跳动更自然
      perfTopRatio: 0.9,
      perfAlive: { front: false, backend: false, widget: false },
      // 性能面板：内存总计 / 近一分钟平均 / 自启动最高（均来自主进程采样，单位 KB）
      // null 表示尚无数据，展示为占位符，避免出现误导性的 0 MB
      perfTotal: null,
      perfAvg: null,
      perfMax: null,
      // 按用途分组：前端（主窗口渲染进程）/ 后端 / 其他
      perfFront: null,
      perfBackend: null,
      perfOther: null,
      perfStartupTotal: 0,
      busyGc: false,
      busyRestartBackend: false,
      busyRestartWidget: false,
      busyRestartAll: false,
      _perfTimer: null,
      presetThemes: [
        { id: 'base', name: '彩色色块主题' },
        { id: 'glass', name: '毛玻璃主题' },
        { id: 'glass2', name: '新毛玻璃主题' },
        { id: 'win11', name: 'Win11 主题' },
        { id: 'minimal', name: '极简主题' },
      ],
    }
  },
  computed: {
    user() {
      return JSON.parse(localStorage.getItem('currentUser') || '{}')
    },
    themeOptions() {
      return this.presetThemes.map(t => ({ value: t.id, label: t.name }))
    },
    // 玻璃系主题（旧毛玻璃 / 新毛玻璃）共用「背景图片 + 透明度」两组设置
    isGlassTheme() {
      return this.currentTheme === 'glass' || this.currentTheme === 'glass2'
    },
    // 设置项搜索结果：分区标题 + 分区内的具体设置项；关键字为空时全部列出
    // 关键字按「标题文本 / 拼音首字母」匹配，单个汉字或单个字母都会即时搜索
    // 渲染顺序为「先分区标题、再设置项」，逐条错开延迟直接取渲染下标 idx（见模板），
    // 这样整份结果是一条连续的错开序列；行的 key 带关键字，每次搜索整批重新挂载，不会重启个别行。
    settingsSearchResults() {
      const q = this.settingsSearch.trim().toLowerCase()
      const hit = (label, py) => !q || label.toLowerCase().includes(q) || py.includes(q)
      const sections = this.settingsSections
        .filter(s => hit(s.label, s.py))
        .map(s => ({ id: 'section:' + s.key, label: s.label, key: s.key, section: '' }))
      const items = this.settingsItems
        .filter(i => hit(i.label, i.py))
        .map(i => ({ id: 'item:' + i.section + ':' + i.label, label: i.label, key: i.section, section: i.section }))
      return [...sections, ...items]
    },
    // 学期下拉：值为学期 id，标签为学期名
    semesterOptions() {
      return this.semesters.map(s => ({ value: s.id, label: s.name || '未命名学期' }))
    },
    // 当前选中的学期对象（未选中时取列表第一条）
    activeSemester() {
      return this.semesters.find(s => s.id === this.semesterId) || this.semesters[0] || null
    },
    // 删除学期确认文案：点明删的是哪个学期，删的是当前学期时额外提示会自动切到其它学期
    deleteSemesterMessage() {
      const cur = this.activeSemester
      if (!cur) return ''
      const name = cur.name || '未命名学期'
      const tail = cur.is_current && this.semesters.length > 1
        ? '<br>它是当前学期，删除后会自动切换到其它学期。'
        : ''
      return `确定删除学期「<b>${name}</b>」吗？删除后不可恢复。${tail}`
    },
    // 本学期时长（按天数折算周数，只读展示）
    semesterWeeks() {
      if (!this.semesterStart || !this.semesterEnd) return 0
      const days = Math.round((new Date(this.semesterEnd) - new Date(this.semesterStart)) / 86400000) + 1
      return days > 0 ? Math.round(days / 7) : 0
    },
    // 预览图走 resourceUrl：补完整后端地址并追加 ?token=，保证打包版 file:// 下能通过鉴权
    bgImagePreviewUrl() {
      return this.bgImageUrl ? resourceUrl(this.bgImageUrl) : ''
    },
    hasUndoRecords() {
      return this.undoGroups.length > 0
    },
    _undoKeyLabels() {
      return { students: '学生表', fee_records: '收费记录', leave_records: '请假记录', score_records: '成绩记录', group_manage: '分组管理', album: '班级相册' }
    },
    // 性能面板：全局存活状态——三个目标全部存活才算「正常」，否则「部分未启动」
    perfAllAlive() {
      const a = this.perfAlive
      return !!(a.front && a.backend && a.widget)
    },
    // 性能面板：逐进程内存行，按占用从高到低排序
    // 占用优先取 privWsKB（专用工作集，与任务管理器「进程」页口径一致）；
    // 取不到（非 Windows / 计数器不可用）时回退到 privateKB（私有提交量）
    perfRows() {
      const rows = this.perfProcs.map(p => ({
        key: p.key,
        name: p.name,
        memKB: typeof p.privWsKB === 'number'
          ? p.privWsKB
          : (typeof p.privateKB === 'number' ? p.privateKB : null),
      }))
      rows.sort((a, b) => (b.memKB || 0) - (a.memKB || 0))
      return rows
    },
    // 条形相对比例的分母：让占用最高的进程对应 perfTopRatio（85%~95%）而非满格，
    // 其余进程按同比例缩放；分母取 top/ratio 保证首位不恒定 100%
    perfMaxKB() {
      const top = this.perfRows[0]
      const topKB = Math.max(1, (top && top.memKB) || 0)
      return topKB / (this.perfTopRatio || 0.9)
    },
  },
  mounted() {
    this.selectedThemeId = this.currentTheme
    this.bgImageUrl = this.themeStore.backgroundImage
    this.mergeNotifications = (localStorage.getItem('mergeNotifications') ?? '1') === '1'
    this.loadUndo()
    this.loadSemesterSettings()
    this.loadWidgetSettings()
    this.loadDesktopLayerState()
    this.loadUsbAutoOpen()
    this.loadDataDirs()
    this.loadDbEncryption()
    // 性能面板：先取一次启动耗时，轮询由 _startPerfPolling 负责
    this.loadStartup()
    this._startPerfPolling()
    this._fromMainHandler = window.electron?.on(RECEIVE.FROM_MAIN, (data) => {
      // 浮窗右键「关闭工具箱」会把持久化开关置 false，这里刷新一下开关状态
      if (data && data.type === 'toolbox-close-request') this.loadWidgetSettings()
      // 组件连续崩溃被自动降级时刷新开关与提示（用户不必手动去查状态）
      if (data && data.type === 'desktop-layer-auto-disabled') this.loadDesktopLayerState()
    })
  },
  // 设置页被 KeepAlive 缓存：切走页面走 deactivated 而非 beforeUnmount，
  // 必须在这里停掉轮询，否则离开设置页后仍会每 1.8s 采样一次（常驻开销）。
  activated() {
    this._startPerfPolling()
    // 首次进入（或被缓存的页被重新激活）时若 URL 带 focus，定位到目标设置
    this._applyRouteFocus()
  },
  deactivated() {
    this._stopPerfPolling()
    // 离开设置页时收起搜索弹窗并解除滚动监听，避免弹窗残留在 body 上
    this._removeSearchPopupListeners()
    this.settingsSearchOpen = false
    clearTimeout(this._flashTimer)
    cancelAnimationFrame(this._flashRaf)
  },
  beforeUnmount() {
    this.clearDeleteTimer()
    this._stopPerfPolling()
    this._removeSearchPopupListeners()
    clearTimeout(this._flashTimer)
    cancelAnimationFrame(this._flashRaf)
    if (this._fromMainHandler) {
      window.electron?.off(RECEIVE.FROM_MAIN, this._fromMainHandler)
    }
  },
  methods: {
    ...useSettingsSearch(),
    ...useSettingsData(),
    ...useSettingsAppearance(),
  },
}
</script>

<style scoped>
/* 设置项搜索跳转锚点：滚动到标题时留出上边距，避免紧贴内容区顶端 */
[id^="settings-section-"] {
  scroll-margin-top: 1.5rem;
}

/* 搜索弹窗：整体自下而上浮入 */
.settings-search-popup {
  animation: settingsSearchPopupIn 0.18s ease-out both;
}
@keyframes settingsSearchPopupIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 弹窗内每条记录：自下而上浮入，按顺序逐条错开（延迟由行内 animation-delay 控制） */
.settings-search-row {
  animation: settingsSearchRowIn 0.2s ease-out both;
}
@keyframes settingsSearchRowIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 搜索跳转后：目标毛玻璃块做一次柔和的蓝色荧光呼吸（2 次）。
   关键帧只改颜色的透明度、不改阴影的模糊/扩散尺寸，再配 ease-in-out，
   让荧光均匀地渐显渐隐（呼吸感），避免"撑开/突然亮起"的突变观感。
   动画期的 box-shadow 会盖过主题里 .bg-surface 的常规 box-shadow（CSS 动画优先级高于普通声明），
   故 keyframe 里带上原内高光，避免闪动时卡片失光。 */
.settings-flash {
  animation: settingsGlowFlash 0.8s ease-in-out 3;
}
@keyframes settingsGlowFlash {
  0%, 100% {
    box-shadow:
      0 0 0 3px rgba(37, 99, 235, 0),
      0 0 26px 8px rgba(37, 99, 235, 0),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
  50% {
    box-shadow:
      0 0 0 3px rgba(37, 99, 235, 0.55),
      0 0 26px 8px rgba(37, 99, 235, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
}
</style>
