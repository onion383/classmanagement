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

        <!-- 安全等级：明文 / 免密 / 普通密码 / 超级隐私（明文可升级为加密） -->
        <div class="mt-6 pt-5 border-t border-border">
          <div class="flex items-center gap-4">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">安全等级</label>
            <div class="w-80">
              <AppSelect
                :model-value="securityLevel"
                :options="securityLevelOptions"
                :disabled="securityLevelLoading || busySecurityLevel"
                @change="onSecurityLevelChange"
              />
            </div>
            <span class="text-xs text-text-muted">{{ securityLevelHint }}</span>
          </div>
          <p class="text-xs text-text-muted mt-2 ml-44">明文不加密；无密码仅免登录但仍加密；普通密码用密码登录；超级隐私模式需密码或恢复词才能解锁库密钥。</p>

          <!-- 恢复词：仅超级隐私模式开启时返回一次 -->
          <div v-if="privacyPhrase" class="ml-44 mt-3 border border-warning bg-bg p-3 rounded-lg">
            <p class="text-sm font-medium text-text mb-2">恢复词（仅显示这一次，请抄写并离线保存）</p>
            <p class="text-sm tracking-wide text-text-secondary select-all">{{ privacyPhrase }}</p>
            <div class="flex gap-2 mt-3">
              <button @click="copyPrivacyPhrase" class="bg-surface-hover px-3 py-1.5 rounded text-sm">复制</button>
              <button @click="clearPrivacyPhrase" class="bg-surface-hover px-3 py-1.5 rounded text-sm">我已抄写</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 内嵌弹窗：切换安全等级 -->
    <Teleport to="body">
    <Transition name="dialog">
      <div v-if="securityDialog.open" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeSecurityDialog">
        <div class="dialog-card bg-surface rounded-lg p-6 w-[26rem] border border-border shadow-lg">
          <h3 class="text-lg font-bold text-text mb-3">切换安全等级</h3>
          <p class="text-sm text-text-secondary mb-4">{{ securityDialogMessage }}</p>
          <input v-if="securityNeedsCurrent" v-model="securityDialog.password" type="password" placeholder="当前登录密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
          <input v-if="securityNeedsNew" v-model="securityDialog.newPassword" type="password" placeholder="新登录密码（至少 6 位）" autocomplete="new-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
          <p v-if="securityDialog.error" class="text-sm text-danger mb-3">{{ securityDialog.error }}</p>
          <div class="flex justify-end gap-2">
            <button @click="closeSecurityDialog" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
            <button @click="confirmSecurityLevel" :disabled="busySecurityLevel" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50">{{ busySecurityLevel ? '切换中…' : '确认切换' }}</button>
          </div>
        </div>
      </div>
    </Transition>
    </Teleport>

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
        <div class="flex items-center gap-4 mb-2">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">学期开始时间</label>
          <input
            type="date"
            v-model="semesterStart"
            @input="semesterDateErrorText = ''"
            :class="{ 'border-danger': semesterDateError || semesterDateErrorText }"
            class="border border-border bg-bg text-text px-3 py-2 rounded-lg"
          />
        </div>
        <div class="flex items-center gap-4 mb-2">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">学期结束时间</label>
          <input
            type="date"
            v-model="semesterEnd"
            @input="semesterDateErrorText = ''"
            :class="{ 'border-danger': semesterDateError || semesterDateErrorText }"
            class="border border-border bg-bg text-text px-3 py-2 rounded-lg"
          />
        </div>
        <!-- 校验错误：结束早于开始。存反了会让值日/座位的快照补存整段跳过（范围上界 < 下界），
             而结束日期正是那两处的补存范围上界 —— 必须在写库前拦住。 -->
        <p v-if="semesterDateError || semesterDateErrorText" class="text-sm text-danger mb-2 ml-44">
          {{ semesterDateErrorText || semesterDateError }}
        </p>
        <div class="flex items-center gap-4 mb-2">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">本学期时长</label>
          <span class="text-sm text-text-secondary">{{ semesterWeeks ? `共 ${semesterWeeks} 周` : '—' }}</span>
        </div>
        <div class="flex items-center gap-4 mb-4">
          <div class="w-40 flex-shrink-0"></div>
          <button
            @click="saveSemesterSettings"
            :disabled="!semesterId || !semesterDatesDirty || busySemesterDate || !!semesterDateError"
            class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-40 disabled:cursor-not-allowed"
          >{{ busySemesterDate ? '保存中…' : '保存日期' }}</button>
          <span v-if="!semesterDatesDirty && !busySemesterDate" class="text-xs text-text-muted">日期未改动</span>
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
                  class="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-hover transition-theme">
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
            <AppHelp text="影响侧边栏导航图标显示风格" aria-label="图标样式说明" />
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
            <AppHelp text="标题栏与侧边栏的毛玻璃底色（深蓝 / 白色调）" aria-label="顶栏配色说明" />
          </div>

          <!-- 日夜模式 + 跟随系统（同一组：组内紧凑，上下留白更大，与相邻设置分开；仅支持夜间配色的主题显示） -->
          <div v-if="nightSupported" class="py-6 my-8 space-y-4">
            <div class="flex items-center gap-4">
              <label class="text-sm font-medium text-text w-16 flex-shrink-0">日夜模式</label>
              <ViewSwitch :modelValue="pendingMode" :options="modeSwitchOptions" @update:modelValue="onSelectMode" />
              <AppHelp text="当前主题支持夜间配色" aria-label="日夜模式说明" />
            </div>
            <div class="flex items-center gap-4">
              <label class="text-sm font-medium text-text w-16 flex-shrink-0">跟随系统</label>
              <AppSwitch :model-value="followSystem" aria-label="跟随系统" @change="onFollowSystemChange" />
              <AppHelp text="开启后按操作系统的深色/浅色偏好自动切换" aria-label="跟随系统说明" />
            </div>
          </div>

          <!-- 提示合并 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">提示合并</label>
            <AppSwitch :model-value="mergeNotifications" aria-label="提示合并" @change="onMergeNotificationsChange" />
            <AppHelp text="相同类型的重复提示合并为一条并计数，避免遮挡页面" aria-label="提示合并说明" />
          </div>

          <!-- 动画效果总开关 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">动画效果</label>
            <AppSwitch :model-value="animationsEnabled" aria-label="动画效果" @change="onAnimationsChange" />
            <AppHelp text="关闭后禁用全部过渡与动画（含窗口淡入淡出、弹窗与列表动效）" aria-label="动画效果说明" />
          </div>

          <!-- 背景图片（毛玻璃系主题：glass / glass2） -->
          <div v-if="isGlassTheme" class="border-t border-border pt-6 mt-6">
            <h3 class="text-lg font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="image" :size="18" /> 背景图片 <AppHelp text="支持 JPG / PNG / GIF / WebP，留空使用默认弥散光斑" aria-label="背景图片说明" /></h3>
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
                  <div class="flex items-center gap-1.5 min-w-0">
                    <label class="text-sm font-medium text-text">背景遮罩层（有自定义背景图时）</label>
                    <AppHelp text="数值越高，背景图越不明显；越低，背景图越清晰" aria-label="背景遮罩层说明" />
                  </div>
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
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <label class="text-sm font-medium text-text">组件透明玻璃层</label>
                    <AppHelp text="控制卡片、表格、通知弹窗等玻璃层的透明度" aria-label="组件透明玻璃层说明" />
                  </div>
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
          <div class="w-40 flex-shrink-0 flex items-center gap-1.5">
            <label class="text-sm font-medium text-text">是否启用工具箱</label>
            <AppHelp text="关闭后立即隐藏工具箱并释放其窗口，下次启动也不再显示；开启立即显示" aria-label="是否启用工具箱说明" />
          </div>
          <AppSwitch :model-value="toolboxEnabled" aria-label="是否启用工具箱" @change="onToolboxChange" />
        </div>
        <div class="flex items-center gap-4 mt-6">
          <div class="w-40 flex-shrink-0 flex items-center gap-1.5">
            <label class="text-sm font-medium text-text">新U盘插入自动打开</label>
            <AppHelp text="插入新U盘时自动用文件资源管理器打开（仅Windows，即时生效）" aria-label="新U盘插入自动打开说明" />
          </div>
          <AppSwitch :model-value="usbAutoOpen" aria-label="新U盘插入自动打开" @change="onUsbAutoOpenChange" />
        </div>
      </div>
    </div>

    <!-- ========== 桌面小组件设置 ========== -->
    <div class="mb-6">
      <h2 id="settings-section-widget" class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="monitor" :size="20" /> 桌面小组件设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4">
          <div class="w-40 flex-shrink-0 flex items-center gap-1.5">
            <label class="text-sm font-medium text-text">启用桌面小组件</label>
            <AppHelp text="关闭后启动不创建桌面小组件窗口（更省资源），并可立即关闭当前窗口；开启立即显示" aria-label="启用桌面小组件说明" />
          </div>
          <AppSwitch :model-value="desktopWidgetEnabled" aria-label="启用桌面小组件" @change="onDesktopWidgetChange" />
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">
          组件固定常驻所有窗口之下（桌面图标之上）：不会被其它应用窗口盖住，点击也不会把窗口抬到最前面，
          仍可点击、可拖动；位置会记住，下次启动回到原处。
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
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-text-muted">上次启动耗时</span>
            <AppHelp text="口径：进程启动到窗口首次显示（ready-to-show），不含数据加载等待" aria-label="启动耗时口径说明" :size="13" />
          </div>
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
            <div class="w-40 flex-shrink-0 flex items-center gap-1.5">
              <label class="text-sm font-medium text-text">注释截屏保存位置</label>
              <AppHelp text="注释工具保存截图的目录，留空则使用默认位置" aria-label="注释截屏保存位置说明" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="noteSavePath || screenshotDir">{{ noteSavePath || screenshotDir }}</div>
            </div>
            <button @click="selectFolder('note')" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">修改</button>
            <button @click="openDir(noteSavePath || screenshotDir)" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">打开文件夹</button>
          </div>
        </div>
        <div>
          <div class="flex items-center gap-4 mb-2">
            <div class="w-40 flex-shrink-0 flex items-center gap-1.5">
              <label class="text-sm font-medium text-text">一键截屏保存位置</label>
              <AppHelp text="一键截屏工具保存截图的目录，留空则使用默认位置" aria-label="一键截屏保存位置说明" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="truncate text-sm text-text-secondary border border-border bg-bg px-3 py-2 rounded-lg" :title="screenshotSavePath || screenshotDir">
                {{ screenshotSavePath || screenshotDir }}
              </div>
            </div>
            <button @click="selectFolder('screenshot')" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">修改</button>
            <button @click="openDir(screenshotSavePath || screenshotDir)" class="bg-success hover:bg-success-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">打开文件夹</button>
          </div>
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
            <input v-model="newUsername" placeholder="新用户名" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" @keydown.enter="changeUsername" />
            <input v-model="usernamePassword" type="password" placeholder="当前密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" @keydown.enter="changeUsername" />
            <p v-if="usernameError" class="text-sm text-danger mb-3">{{ usernameError }}</p>
            <div class="flex justify-end gap-2">
              <button @click="closeModal" :disabled="busyUsername" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme disabled:opacity-50">取消</button>
              <button @click="changeUsername" :disabled="busyUsername" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50">{{ busyUsername ? '提交中…' : '确认修改' }}</button>
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
            <input v-model="oldPassword" type="password" placeholder="原密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" @keydown.enter="changePassword" />
            <input v-model="newPassword" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" @keydown.enter="changePassword" />
            <!-- 二次确认：密码改错没有退路（恢复词只存在于「超级隐私」等级），必须挡住手误 -->
            <input v-model="confirmPassword" type="password" placeholder="再次输入新密码" autocomplete="new-password" class="border border-border bg-surface text-text p-2 w-full mb-1 rounded" @keydown.enter="changePassword" />
            <!-- 一致性提示：边输边给反馈，不用等提交才报错 -->
            <p v-if="confirmPassword && newPassword !== confirmPassword" class="text-xs text-warning mb-3">两次输入不一致</p>
            <p v-else-if="confirmPassword && newPassword && confirmPassword === newPassword" class="text-xs text-success mb-3">两次输入一致</p>
            <p v-else class="text-xs text-text-muted mb-3">改完请记牢，普通密码账户没有恢复途径。</p>
            <!-- 服务端错误就地显示：用 alert 会把用户弹出的输入内容一起清掉，得从头再填一遍 -->
            <p v-if="pwdError" class="text-sm text-danger mb-3">{{ pwdError }}</p>
            <div class="flex justify-end gap-2">
              <button @click="closeModal" :disabled="busyPwd" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme disabled:opacity-50">取消</button>
              <button @click="changePassword" :disabled="busyPwd" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50">{{ busyPwd ? '提交中…' : '确认修改' }}</button>
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

<script setup>
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHelp from '../../components/base/AppHelp.vue'
import AppSelect from '../../components/base/AppSelect.vue'
import AppSwitch from '../../components/base/AppSwitch.vue'
import { Sun, Moon } from '@lucide/vue'
import ViewSwitch from '../../components/base/ViewSwitch.vue'
import { useThemeStore } from '../../stores/theme'
import { storeToRefs } from 'pinia'
import { resourceUrl } from '../../utils/apiUrl'
import '../../styles/dialog-transition.css'
import { useSettingsSearch } from './SettingsView.search.js'
import { useSettingsData } from './SettingsView.data.js'
import { useSettingsAppearance } from './SettingsView.appearance.js'
import { RECEIVE } from '../../electronChannels.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../../components/base/ConfirmDialog.vue'))

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const { currentTheme, bgMaskOpacity, glassOpacity, iconStyle, topbarColor, animationsEnabled, pendingMode, nightSupported, followSystem } = storeToRefs(themeStore)

// 模板 ref（搜索输入/弹窗、背景图 file input）
const settingsSearchInput = ref(null)
const settingsSearchPopup = ref(null)
const bgImageInput = ref(null)

// 设置项搜索：输入即匹配，结果以悬浮弹窗显示在搜索框下方，点击滚动到对应设置区
const settingsSearch = ref('')
const settingsSearchOpen = ref(false)
// 悬浮弹窗的视口坐标（Teleport 到 body 后用 fixed 定位，需要手动计算）
const searchPopup = ref({ left: 0, top: 0, width: 0 })
// 搜索弹窗当前高亮项下标（方向键上下切换、回车跳转）
const searchActiveIndex = ref(0)
// py 为标题拼音首字母，让单个字母（如 z → 主题设置）也能命中
const settingsSections = ref([
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
])
// 分区内的具体设置项：命中后滚动到该设置行（py 为标签拼音首字母）
const settingsItems = ref([
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
  { label: '注释截屏保存位置',         section: 'savepath', py: 'zsjpbcwz' },
  { label: '一键截屏保存位置',         section: 'savepath', py: 'yjjpbcwz' },
  { label: '数据库目录',               section: 'datadir',  py: 'sjkml' },
  { label: '相册缩略图缓存',           section: 'datadir',  py: 'xcsltch' },
  { label: '技能文件目录',             section: 'datadir',  py: 'jnwjml' },
  { label: '安全等级',                 section: 'account',  py: 'aqdj' },
])
// 图标样式选项：彩色图标 / Emoji
const iconStyleOptions = [
  { value: 'color', label: '彩色图标' },
  { value: 'emoji', label: 'Emoji' },
]
// 标题栏/侧边栏毛玻璃配色：深蓝（旧款）/ 白色调
const topbarColorOptions = [
  { value: 'blue', label: '深蓝' },
  { value: 'light', label: '白色调' },
]
// 日夜模式切换：日间 / 夜间（图标为标题栏同款太阳 / 月亮）
const modeSwitchOptions = [
  { value: 'day', label: '日间', icon: Sun },
  { value: 'night', label: '夜间', icon: Moon },
]
// Modal
const modalType = ref('')
const newUsername = ref('')
const usernamePassword = ref('')
const oldPassword = ref('')
const newPassword = ref('')
// 修改密码的三件配套：二次确认输入、弹窗内联错误、提交中锁。
// 密码改错没有退路（恢复词只有「超级隐私」等级才有），这三样缺一都会让手误变成锁死。
const confirmPassword = ref('')
const pwdError = ref('')
const busyPwd = ref(false)
// 修改用户名同样缺提交锁：点了没反应时用户会连点，请求发两次
const usernameError = ref('')
const busyUsername = ref(false)
// Export database
const exportPassword = ref('')
const exportEncrypt = ref(true)
const exportDbPwd = ref('')
const busyExport = ref(false)
// 学期设置（多学期列表 + 当前学期；起止日期供座位快照按天结算）
const semesters = ref([])
const semesterId = ref(null)
const semesterNameDraft = ref('')
const showRenameSemester = ref(false)
const newSemesterName = ref('')
const showAddSemester = ref(false)
const showDeleteSemester = ref(false)
const busySemester = ref(false)
// 保存学期日期的独立 busy 标志：与 busySemester（增删学期）分开，
// 否则「保存日期」和「删除学期」会互相把对方的按钮置灰
const busySemesterDate = ref(false)
const semesterStart = ref('')
const semesterEnd = ref('')
// 学期日期的内联错误文案（保存失败时显示在输入框下方，不只靠 toast）
const semesterDateErrorText = ref('')
// Dialog
const dialog = ref({
  visible: false,
  message: '',
  type: 'alert',
  showCancel: false,
})
const dialogMounted = ref(false)
const dialogCallback = ref(null)
// 「删除账号」倒计时定时器
const deleteTimer = ref(null)
// 工具箱设置
const toolboxEnabled = ref(true)
const noteSavePath = ref('')
const screenshotSavePath = ref('')
const screenshotDir = ref('')
const usbAutoOpen = ref(false)
// 桌面小组件启用状态：localStorage 持久化，默认启用（主进程据此按需创建桌面小组件窗口）
const desktopWidgetEnabled = ref((localStorage.getItem('desktopWidgetEnabled') ?? '1') !== '0')
const loaded = ref(false)
const _fromMainHandler = ref(null)
// 数据目录 / 缓存目录
const dataDir = ref('')
const thumbsDir = ref('')
const skillsDir = ref('')
const busyDataDir = ref(false)
const busyThumbsDir = ref(false)
const busySkillsDir = ref(false)
// 安全等级（仅当前账号）：plain / nopass / password / privacy
const securityLevel = ref('')
const securityLevelLoading = ref(true)
const busySecurityLevel = ref(false)
const securityDialog = ref({ open: false, target: '', password: '', newPassword: '', error: '' })
const privacyPhrase = ref('')
// 撤销记录
const undoGroups = ref([])
const busyUndo = ref(false)
// Theme
const selectedThemeId = ref('')
// 是否合并相同内容的重复提示
const mergeNotifications = ref(true)
// Background image
const bgImageUrl = ref('')
const bgImageFileName = ref('')
// 性能面板：逐进程内存列表 + 三个重启目标的存活状态
const perfProcs = ref([])
// 首位进程条形的目标占比（0.85~0.95）：让最高占用不固定满格，每次采样小幅跳动更自然
const perfTopRatio = ref(0.9)
const perfAlive = ref({ front: false, backend: false, widget: false })
// 性能面板：内存总计 / 近一分钟平均 / 自启动最高（均来自主进程采样，单位 KB）
// null 表示尚无数据，展示为占位符，避免出现误导性的 0 MB
const perfTotal = ref(null)
const perfAvg = ref(null)
const perfMax = ref(null)
// 按用途分组：前端（主窗口渲染进程）/ 后端 / 其他
const perfFront = ref(null)
const perfBackend = ref(null)
const perfOther = ref(null)
const perfStartupTotal = ref(0)
const busyGc = ref(false)
const busyRestartBackend = ref(false)
const busyRestartWidget = ref(false)
const busyRestartAll = ref(false)
const _perfTimer = ref(null)
// 主题下拉的候选项（这份列表是独立硬编码的副本，不走 store 的 allThemes）。
// 「Win11 主题」暂时移除：它的背景模糊依赖 DWM 系统亚克力，效果不可控
// （本机实测连原生 Win32 都只渲染出均匀中性灰，壁纸完全透不出），
// 故先从选择入口去掉。实现代码保留，恢复见 stores/theme.js 的 HIDDEN_THEME_IDS。
const presetThemes = ref([
  { id: 'base', name: '彩色色块主题' },
  { id: 'glass', name: '毛玻璃主题' },
  { id: 'glass2', name: '新毛玻璃主题' },
  { id: 'minimal', name: '极简主题' },
])

// 非响应式实例状态（动画帧/定时器句柄与搜索闪动标记）挂在 ctx 上单源共享

const user = computed(() => {
  return JSON.parse(localStorage.getItem('currentUser') || '{}')
})
// 安全等级下拉选项（与引导页同一套文案）
const securityLevelOptions = computed(() => {
  return [
    { value: 'plain', label: '明文模式（不加密）' },
    { value: 'nopass', label: '无密码模式（加密，免密登录）' },
    { value: 'password', label: '普通密码模式（加密 + 登录密码）' },
    { value: 'privacy', label: '超级隐私模式（密码 + 恢复词）' },
  ]
})
const securityLevelHint = computed(() => {
  if (securityLevelLoading.value) return '加载中…'
  if (busySecurityLevel.value) return '切换中…'
  if (securityLevel.value === 'plain') return '当前为明文，可升级为加密'
  return ''
})
// 兼容导出弹窗：除明文外都视为加密库
const dbEncrypted = computed(() => {
  return securityLevel.value !== 'plain'
})
const securityNeedsCurrent = computed(() => {
  return securityLevel.value === 'password' || securityLevel.value === 'privacy'
})
const securityNeedsNew = computed(() => {
  const t = securityDialog.value.target
  return !securityNeedsCurrent.value && (t === 'password' || t === 'privacy')
})
const securityDialogMessage = computed(() => {
  switch (securityDialog.value.target) {
    case 'plain':
      return '关闭加密后，数据库将以明文保存，任何能访问该文件的程序都能直接读取其中数据；此操作不可逆。'
    case 'nopass':
      return '改为无密码模式：数据库仍然加密，但登录不再需要密码，换机或换 Windows 账户后仍无法打开。'
    case 'password':
      return '改为普通密码模式：使用登录密码登录，数据库由本机主密钥自动解锁，不再需要恢复词。'
    case 'privacy':
      return '开启超级隐私模式后，库密钥只由「登录密码 + 12 词恢复词」包裹，忘记两者将永久无法恢复数据。'
    default:
      return ''
  }
})
const themeOptions = computed(() => {
  return presetThemes.value.map(t => ({ value: t.id, label: t.name }))
})
// 玻璃系主题（旧毛玻璃 / 新毛玻璃）共用「背景图片 + 透明度」两组设置
const isGlassTheme = computed(() => {
  return currentTheme.value === 'glass' || currentTheme.value === 'glass2'
})
// 设置项搜索结果：分区标题 + 分区内的具体设置项；关键字为空时全部列出
// 关键字按「标题文本 / 拼音首字母」匹配，单个汉字或单个字母都会即时搜索
// 渲染顺序为「先分区标题、再设置项」，逐条错开延迟直接取渲染下标 idx（见模板），
// 这样整份结果是一条连续的错开序列；行的 key 带关键字，每次搜索整批重新挂载，不会重启个别行。
const settingsSearchResults = computed(() => {
  const q = settingsSearch.value.trim().toLowerCase()
  const hit = (label, py) => !q || label.toLowerCase().includes(q) || py.includes(q)
  const sections = settingsSections.value
    .filter(s => hit(s.label, s.py))
    .map(s => ({ id: 'section:' + s.key, label: s.label, key: s.key, section: '' }))
  const items = settingsItems.value
    .filter(i => hit(i.label, i.py))
    .map(i => ({ id: 'item:' + i.section + ':' + i.label, label: i.label, key: i.section, section: i.section }))
  return [...sections, ...items]
})
// 学期下拉：值为学期 id，标签为学期名
const semesterOptions = computed(() => {
  return semesters.value.map(s => ({ value: s.id, label: s.name || '未命名学期' }))
})
// 当前选中的学期对象（未选中时取列表第一条）
const activeSemester = computed(() => {
  return semesters.value.find(s => s.id === semesterId.value) || semesters.value[0] || null
})
// 删除学期确认文案：点明删的是哪个学期，删的是当前学期时额外提示会自动切到其它学期
const deleteSemesterMessage = computed(() => {
  const cur = activeSemester.value
  if (!cur) return ''
  const name = cur.name || '未命名学期'
  // ConfirmDialog 用 whitespace-pre-line 渲染纯文本：换行用 \n，不能写 <br>
  const tail = cur.is_current && semesters.value.length > 1
    ? '\n它是当前学期，删除后会自动切换到其它学期。'
    : ''
  return `确定删除学期「${name}」吗？删除后不可恢复。${tail}`
})
// 本学期时长（按天数折算周数，只读展示）
const semesterWeeks = computed(() => {
  if (!semesterStart.value || !semesterEnd.value) return 0
  const days = Math.round((new Date(semesterEnd.value) - new Date(semesterStart.value)) / 86400000) + 1
  return days > 0 ? Math.round(days / 7) : 0
})
// 学期起止日期的合法性：结束不能早于开始。
// 存反了不是显示问题 —— 值日/座位的快照补存拿 semesterRange() 当范围上界，
// 上界小于下界时那边会直接判「学期范围外」整段跳过，用户看到的是「历史记录一直是空的」。
// 两端都留空是允许的（表示不限），只有一端有值也不校验。
const semesterDateError = computed(() => {
  const s = semesterStart.value
  const e = semesterEnd.value
  if (!s || !e) return ''
  if (e < s) return '结束日期不能早于开始日期'
  return ''
})
// 有没有改动过日期（决定「保存」按钮是否可点）
const semesterDatesDirty = computed(() => {
  const cur = activeSemester.value
  if (!cur) return false
  return (cur.start_date || '') !== semesterStart.value || (cur.end_date || '') !== semesterEnd.value
})
// 预览图走 resourceUrl：补完整后端地址并追加 ?token=，保证打包版 file:// 下能通过鉴权
const bgImagePreviewUrl = computed(() => {
  return bgImageUrl.value ? resourceUrl(bgImageUrl.value) : ''
})
const hasUndoRecords = computed(() => {
  return undoGroups.value.length > 0
})
const _undoKeyLabels = computed(() => {
  return { students: '学生表', fee_records: '收费记录', leave_records: '请假记录', score_records: '成绩记录', group_manage: '分组管理', album: '班级相册' }
})
// 性能面板：全局存活状态——三个目标全部存活才算「正常」，否则「部分未启动」
const perfAllAlive = computed(() => {
  const a = perfAlive.value
  return !!(a.front && a.backend && a.widget)
})
// 性能面板：逐进程内存行，按占用从高到低排序
// 占用优先取 privWsKB（专用工作集，与任务管理器「进程」页口径一致）；
// 取不到（非 Windows / 计数器不可用）时回退到 privateKB（私有提交量）
const perfRows = computed(() => {
  const rows = perfProcs.value.map(p => ({
    key: p.key,
    name: p.name,
    memKB: typeof p.privWsKB === 'number'
      ? p.privWsKB
      : (typeof p.privateKB === 'number' ? p.privateKB : null),
  }))
  rows.sort((a, b) => (b.memKB || 0) - (a.memKB || 0))
  return rows
})
// 条形相对比例的分母：让占用最高的进程对应 perfTopRatio（85%~95%）而非满格，
// 其余进程按同比例缩放；分母取 top/ratio 保证首位不恒定 100%
const perfMaxKB = computed(() => {
  const top = perfRows.value[0]
  const topKB = Math.max(1, (top && top.memKB) || 0)
  return topKB / (perfTopRatio.value || 0.9)
})

// ===== ctx 袋：三个逻辑模块经它互调 =====
const ctx = {
  // 状态 ref（.value 访问）
  settingsSearch, settingsSearchOpen, searchPopup, searchActiveIndex, settingsSections, settingsItems,
  modalType, newUsername, usernamePassword, oldPassword, newPassword, confirmPassword, pwdError, busyPwd,
  usernameError, busyUsername, exportPassword, exportEncrypt, exportDbPwd, busyExport,
  semesters, semesterId, semesterNameDraft, showRenameSemester, newSemesterName, showAddSemester,
  showDeleteSemester, busySemester, busySemesterDate, semesterStart, semesterEnd, semesterDateErrorText,
  dialog, dialogMounted, dialogCallback, deleteTimer, toolboxEnabled, noteSavePath, screenshotSavePath,
  screenshotDir, usbAutoOpen, desktopWidgetEnabled, loaded, _fromMainHandler, dataDir, thumbsDir, skillsDir,
  busyDataDir, busyThumbsDir, busySkillsDir, securityLevel, securityLevelLoading, busySecurityLevel,
  securityDialog, privacyPhrase, undoGroups, busyUndo, selectedThemeId, mergeNotifications,
  bgImageUrl, bgImageFileName, perfProcs, perfTopRatio, perfAlive, perfTotal, perfAvg, perfMax,
  perfFront, perfBackend, perfOther, perfStartupTotal, busyGc, busyRestartBackend, busyRestartWidget,
  busyRestartAll, _perfTimer, presetThemes,
  // storeToRefs（也是 ref）
  currentTheme, bgMaskOpacity, glassOpacity, iconStyle, topbarColor, animationsEnabled, pendingMode,
  nightSupported, followSystem,
  // computed（ref）
  user, securityLevelOptions, securityLevelHint, dbEncrypted, securityNeedsCurrent, securityNeedsNew,
  securityDialogMessage, themeOptions, isGlassTheme, settingsSearchResults, semesterOptions, activeSemester,
  deleteSemesterMessage, semesterWeeks, semesterDateError, semesterDatesDirty, bgImagePreviewUrl,
  hasUndoRecords, _undoKeyLabels, perfAllAlive, perfRows, perfMaxKB,
  // store / router（普通对象）
  themeStore, route, router,
  // 模板 ref
  settingsSearchInput, settingsSearchPopup, bgImageInput,
  // 非响应式临时字段
  _flashTimer: null, _flashRaf: null, _focusSig: null,
}

// 迟绑定：三个逻辑模块的方法回填进 ctx（互相调用在运行时经 ctx 解析）
Object.assign(ctx, useSettingsSearch(ctx), useSettingsData(ctx), useSettingsAppearance(ctx))

// ===== 模板顶层绑定：由逻辑模块提供、模板用到的方法 =====
const {
  changeDataDir, changePassword, changeSkillsDir, changeThumbsDir, changeUsername,
  clearBgImage, clearPrivacyPhrase, clearUndo, closeModal, closeSecurityDialog,
  confirmAddSemester, confirmDeleteSemester, confirmLogout, confirmSearchActive, confirmSecurityLevel,
  copyPrivacyPhrase, exportDb, fmtMem, fmtTs, goToSettingsSection, groupLabel, moveSearchActive,
  onAnimationsChange, onBgImageFileChange, onBgMaskOpacityChange, onDesktopWidgetChange,
  onDialogCancel, onDialogConfirm, onFollowSystemChange, onGlassOpacityChange, onIconStyleChange,
  onMergeNotificationsChange, onSecurityLevelChange, onSelectMode, onSelectSemester,
  onSettingsSearchBlur, onSettingsSearchFocus, onThemeSelect, onToolboxChange, onTopbarColorChange,
  onUsbAutoOpenChange, openAddSemester, openDeleteAccount, openDir, openModal, openRenameSemester,
  recycleAll, redoOne, requestDeleteSemester, restartAll, restartBackend, restartFrontend,
  restartWidget, saveSemesterName, saveSemesterSettings, selectFolder, undoableCount, undoOne,
} = ctx

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
watch(() => dialog.value.visible, (n) => { if (n) dialogMounted.value = true })
// 关键字变化时高亮回到第一条（回车默认跳第一个）
watch(settingsSearch, () => { searchActiveIndex.value = 0 })
// 跨页定位：其他页面（如标题栏全局搜索）跳转到 /settings?focus=... 时定位到目标设置
watch(() => route.query.focus, () => { ctx._applyRouteFocus() })

onMounted(() => {
  selectedThemeId.value = currentTheme.value
  bgImageUrl.value = themeStore.backgroundImage
  mergeNotifications.value = (localStorage.getItem('mergeNotifications') ?? '1') === '1'
  ctx.loadUndo()
  ctx.loadSemesterSettings()
  ctx.loadWidgetSettings()
  ctx.loadUsbAutoOpen()
  ctx.loadDataDirs()
  ctx.loadSecurityLevel()
  // 性能面板：先取一次启动耗时，轮询由 _startPerfPolling 负责
  ctx.loadStartup()
  ctx._startPerfPolling()
  _fromMainHandler.value = window.electron?.on(RECEIVE.FROM_MAIN, (data) => {
    // 浮窗右键「关闭工具箱」会把持久化开关置 false，这里刷新一下开关状态
    if (data && data.type === 'toolbox-close-request') ctx.loadWidgetSettings()
  })
})
// 设置页被 KeepAlive 缓存：切走页面走 deactivated 而非 beforeUnmount，
// 必须在这里停掉轮询，否则离开设置页后仍会每 1.8s 采样一次（常驻开销）。
onActivated(() => {
  ctx._startPerfPolling()
  // KeepAlive 恢复时若恢复词仍在展示，重新开启屏幕捕获保护
  ctx.syncPrivacyPhraseGuard(!!privacyPhrase.value)
  // 首次进入（或被缓存的页被重新激活）时若 URL 带 focus，定位到目标设置
  ctx._applyRouteFocus()
})
onDeactivated(() => {
  ctx._stopPerfPolling()
  // 离开设置页时关闭屏幕捕获保护（恢复词区块已不可见）
  ctx.syncPrivacyPhraseGuard(false)
  // 离开设置页时收起搜索弹窗并解除滚动监听，避免弹窗残留在 body 上
  ctx._removeSearchPopupListeners()
  settingsSearchOpen.value = false
  clearTimeout(ctx._flashTimer)
  cancelAnimationFrame(ctx._flashRaf)
})
onBeforeUnmount(() => {
  ctx.syncPrivacyPhraseGuard(false)
  ctx.clearDeleteTimer()
  ctx._stopPerfPolling()
  ctx._removeSearchPopupListeners()
  clearTimeout(ctx._flashTimer)
  cancelAnimationFrame(ctx._flashRaf)
  if (_fromMainHandler.value) {
    window.electron?.off(RECEIVE.FROM_MAIN, _fromMainHandler.value)
  }
})
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
