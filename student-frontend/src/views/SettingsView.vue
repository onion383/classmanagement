<template>
  <div class="h-full">
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="settings" /> 系统设置</h1>
    </div>

    <!-- ========== 账号管理 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="user" :size="20" /> 账号管理</h2>

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

    <!-- ========== 撤销记录 ========== -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text flex items-center gap-2"><IconGlyph name="undo" :size="20" /> 撤销记录</h2>
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
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="palette" :size="20" /> 主题设置</h2>

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

          <!-- 提示合并 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">提示合并</label>
            <label class="inline-flex items-center cursor-pointer">
              <input type="checkbox" :checked="mergeNotifications" @change="onMergeNotificationsChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
              <span class="ml-2 text-sm text-text-secondary">{{ mergeNotifications ? '合并相同内容的提示' : '相同内容每次单独展示' }}</span>
            </label>
            <span class="text-xs text-text-muted">相同类型的重复提示合并为一条并计数，避免遮挡页面</span>
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
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="toolbox" :size="20" /> 工具箱设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">是否启用工具箱</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="toolboxEnabled" @change="onToolboxChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ toolboxEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">下次启动时是否显示工具箱（本次运行不受此开关影响）</p>
        <div class="flex items-center gap-4 mt-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">本次启用工具箱</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="sessionEnabled" @change="onSessionChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ sessionEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">仅本次运行立即显示/隐藏工具箱；重启后按上方「是否启用」决定</p>
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

    <!-- ========== 性能 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="sliders" :size="20" /> 性能</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <!-- 三列等宽：前端 / 后端 / 小组件（名称 / 状态 / 按钮 纵向排列） -->
        <div class="grid grid-cols-3 gap-4">
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">前端</span>
            <span class="text-sm font-medium" :class="perfAlive.front ? 'text-text' : 'text-text-muted'">{{ perfAlive.front ? '正常' : '未运行' }}</span>
            <button @click="restartFrontend" class="bg-bg hover:bg-surface-hover text-text border border-border px-3 py-1.5 rounded text-sm transition-theme">重启前端</button>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">后端</span>
            <span class="text-sm font-medium" :class="perfAlive.backend ? 'text-text' : 'text-text-muted'">{{ perfAlive.backend ? '正常' : '未运行' }}</span>
            <button @click="restartBackend" :disabled="busyRestartBackend" class="bg-bg hover:bg-surface-hover text-text border border-border px-3 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyRestartBackend ? '重启中…' : '重启后端' }}</button>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4">
            <span class="text-sm text-text-muted">小组件</span>
            <span class="text-sm font-medium" :class="perfAlive.widget ? 'text-text' : 'text-text-muted'">{{ perfAlive.widget ? '正常' : '未运行' }}</span>
            <button @click="restartWidget" :disabled="busyRestartWidget" class="bg-bg hover:bg-surface-hover text-text border border-border px-3 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyRestartWidget ? '重启中…' : '重启小组件' }}</button>
          </div>
        </div>

        <!-- 内存占用：逐进程一条，条形宽度带过渡；「回收」按钮宽度固定，切换文案时不跳动 -->
        <div class="border-t border-border pt-6 mt-6">
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm font-medium text-text">内存占用</span>
            <button @click="recycleAll" :disabled="busyGc" class="w-24 text-center bg-primary hover:bg-primary-hover text-text-inverse px-4 py-1.5 rounded text-sm transition-theme disabled:opacity-50">{{ busyGc ? '回收中…' : '回收' }}</button>
          </div>
          <div class="space-y-3">
            <div v-for="row in perfRows" :key="row.key" class="flex items-center gap-3">
              <span class="w-32 flex-shrink-0 truncate text-sm" :class="row.isTotal ? 'text-text font-medium' : 'text-text-secondary'" :title="row.name">{{ row.name }}</span>
              <div class="flex-1 h-2.5 rounded-full bg-bg border border-border overflow-hidden">
                <div class="h-full rounded-full bg-primary" :style="{ width: barPct(row.memKB) + '%', transition: 'width 480ms cubic-bezier(0.4, 0, 0.2, 1), background-color 250ms' }"></div>
              </div>
              <span class="w-20 flex-shrink-0 text-right text-sm text-text" :class="row.isTotal ? 'font-medium' : ''" style="font-variant-numeric: tabular-nums;">{{ fmtMem(row.memKB) }}</span>
            </div>
          </div>
        </div>

        <!-- 上次启动耗时 -->
        <div class="border-t border-border pt-6 mt-6 flex items-center gap-4">
          <span class="text-sm text-text-muted">上次启动耗时</span>
          <span class="text-sm font-medium text-text" style="font-variant-numeric: tabular-nums;">{{ perfStartupTotal }} ms</span>
        </div>
      </div>
    </div>

    <!-- ========== 保存路径设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="folder" :size="20" /> 保存路径设置</h2>
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
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="box" :size="20" /> 数据目录设置</h2>
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
      <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="trash" :size="20" /> 危险操作</h2>
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
    <Transition name="dialog" v-if="modalType === 'username'">
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
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
    <Transition name="dialog" v-if="modalType === 'password'">
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
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
    <Transition name="dialog" v-if="modalType === 'export'">
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
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
import { defineAsyncComponent } from 'vue'
import AppSelect from '../components/base/AppSelect.vue'
import { useThemeStore } from '../stores/theme'
import { storeToRefs } from 'pinia'
import { resourceUrl } from '../utils/apiUrl'
import '../styles/dialog-transition.css'
import { useNotification } from '../composables/useNotification'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))

export default {
  components: { AppSelect, ConfirmDialog },
  // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
  watch: {
    'dialog.visible'(n) { if (n) this.dialogMounted = true }
  },
  data() {
    const themeStore = useThemeStore()
    const { currentTheme, bgMaskOpacity, glassOpacity, iconStyle, topbarColor } = storeToRefs(themeStore)

    return {
      themeStore,
      currentTheme,
      bgMaskOpacity,
      glassOpacity,
      iconStyle,
      topbarColor,
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
      sessionEnabled: true,
      sessionLoaded: false,
      noteSavePath: '',
      screenshotSavePath: '',
      screenshotDir: '',
      usbAutoOpen: false,
      loaded: false,
      _fromMainHandler: null,
      // 数据目录 / 缓存目录
      dataDir: '',
      thumbsDir: '',
      busyDataDir: false,
      busyThumbsDir: false,
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
      perfAlive: { front: false, backend: false, widget: false },
      perfStartupTotal: 0,
      busyGc: false,
      busyRestartBackend: false,
      busyRestartWidget: false,
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
    // 性能面板：逐进程内存行，按占用从高到低排序，「总计」固定插在最上方
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
      const total = rows.reduce((sum, r) => sum + (r.memKB || 0), 0)
      rows.sort((a, b) => (b.memKB || 0) - (a.memKB || 0))
      return [{ key: '__total__', name: '总计', memKB: total, isTotal: true }, ...rows]
    },
    // 条形相对比例的分母：以总计为 100%，各进程的条即「占总量比例」
    perfMaxKB() {
      const totalRow = this.perfRows.find(r => r.isTotal)
      return Math.max(1, (totalRow && totalRow.memKB) || 0)
    },
  },
  mounted() {
    this.selectedThemeId = this.currentTheme
    this.bgImageUrl = this.themeStore.backgroundImage
    this.mergeNotifications = (localStorage.getItem('mergeNotifications') ?? '1') === '1'
    this.loadUndo()
    this.loadWidgetSettings()
    this.loadSession()
    this.loadUsbAutoOpen()
    this.loadDataDirs()
    this.loadDbEncryption()
    // 性能面板：先取一次启动耗时，轮询由 _startPerfPolling 负责
    this.loadStartup()
    this._startPerfPolling()
    this._fromMainHandler = window.electron?.on('from-main', (data) => {
      if (data && data.type === 'session-widget-changed') this.loadSession()
    })
  },
  // 设置页被 KeepAlive 缓存：切走页面走 deactivated 而非 beforeUnmount，
  // 必须在这里停掉轮询，否则离开设置页后仍会每 1.8s 采样一次（常驻开销）。
  activated() {
    this._startPerfPolling()
  },
  deactivated() {
    this._stopPerfPolling()
  },
  beforeUnmount() {
    this.clearDeleteTimer()
    this._stopPerfPolling()
    if (this._fromMainHandler) {
      window.electron?.off('from-main', this._fromMainHandler)
    }
  },
  methods: {
    // ==================== 撤销记录 ====================
    async loadUndo() {
      try {
        const { data } = await axios.get('/api/undo')
        this.undoGroups = data.groups || []
      } catch { }
    },
    async undoOne(id) {
      if (this.busyUndo) return
      this.busyUndo = true
      try {
        const { data } = await axios.post(`/api/undo/${id}/undo`)
        if (data.ok) this.showAlert(data.label ? `已撤销：${data.label}` : '已成功撤销')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '撤销失败，可能目标数据已被删除')
      } finally {
        this.busyUndo = false
        await this.loadUndo()
      }
    },
    async redoOne(id) {
      if (this.busyUndo) return
      this.busyUndo = true
      try {
        const { data } = await axios.post(`/api/undo/${id}/redo`)
        if (data.ok) this.showAlert(data.label ? `已重做：${data.label}` : '已成功重做')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '重做失败')
      } finally {
        this.busyUndo = false
        await this.loadUndo()
      }
    },
    clearUndo() {
      if (this.busyUndo) return
      this.showConfirm('确定清空所有撤销记录吗？此操作不可恢复。', async () => {
        this.busyUndo = true
        try {
          await axios.delete(`/api/undo?key=all`)
        } finally {
          this.busyUndo = false
          await this.loadUndo()
        }
      })
    },
    groupLabel(key) {
      return this._undoKeyLabels[key] || key
    },
    undoableCount(group) {
      return (group.records || []).filter(r => r.dir === 1).length
    },
    fmtTs(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const p = n => String(n).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    },
    // Account
    openModal(type) {
      this.modalType = type
      this.newUsername = ''
      this.usernamePassword = ''
      this.oldPassword = ''
      this.newPassword = ''
      this.exportPassword = ''
      this.exportEncrypt = this.dbEncrypted
      this.exportDbPwd = ''
    },
    closeModal() {
      this.modalType = ''
    },
    showAlert(msg) {
      this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false }
    },
    showConfirm(msg, onConfirm) {
      this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true }
      this.dialogCallback = onConfirm
    },
    onDialogConfirm() {
      this.clearDeleteTimer()
      this.dialog.visible = false
      if (this.dialogCallback) {
        this.dialogCallback()
        this.dialogCallback = null
      }
    },
    // 取消/关闭弹窗：一并停掉倒计时定时器
    onDialogCancel() {
      this.clearDeleteTimer()
      this.dialog.visible = false
    },
    clearDeleteTimer() {
      if (this.deleteTimer) {
        clearInterval(this.deleteTimer)
        this.deleteTimer = null
      }
    },
    async changeUsername() {
      try {
        const res = await axios.put('/api/account/username', {
          newUsername: this.newUsername,
          password: this.usernamePassword,
        })
        const currentUser = JSON.parse(localStorage.getItem('currentUser'))
        currentUser.username = this.newUsername
        localStorage.setItem('currentUser', JSON.stringify(currentUser))
        this.closeModal()
        this.showAlert(res.data.message)
      } catch (err) {
        this.showAlert(err.response?.data?.error || '修改失败')
      }
    },
    async changePassword() {
      try {
        const res = await axios.put('/api/account/password', {
          oldPassword: this.oldPassword,
          newPassword: this.newPassword,
        })
        this.closeModal()
        this.showAlert(res.data.message)
      } catch (err) {
        this.showAlert(err.response?.data?.error || '修改失败')
      }
    },
    confirmLogout() {
      this.showConfirm('确定要退出登录吗？', () => {
        localStorage.removeItem('token')
        localStorage.removeItem('currentUser')
        this.$router.push('/login')
      })
    },
    // 打开「删除账号」警告弹窗：确定按钮先置灰，10 秒倒计时结束后才可点击
    openDeleteAccount() {
      this.clearDeleteTimer()
      this.dialog = {
        visible: true,
        title: '警告',
        message: '删除账号后无法恢复，请谨慎决定',
        type: 'confirm',
        showCancel: true,
        confirmText: '确定(10)',
        confirmDisabled: true,
      }
      this.dialogCallback = () => this.performDeleteAccount()
      let remain = 10
      this.deleteTimer = setInterval(() => {
        remain -= 1
        if (remain <= 0) {
          this.clearDeleteTimer()
          this.dialog.confirmText = '确定'
          this.dialog.confirmDisabled = false
        } else {
          this.dialog.confirmText = `确定(${remain})`
        }
      }, 1000)
    },
    // 真正删除当前账号：删除后清除本地登录态并回到登录页
    async performDeleteAccount() {
      try {
        await axios.delete('/api/account')
        localStorage.removeItem('token')
        localStorage.removeItem('currentUser')
        this.$router.push('/login')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '删除失败')
      }
    },
    async exportDb() {
      const needsPassword = !!this.user.hasPassword
      const loginPwd = this.exportPassword
      // 有密码账号：必须先校验登录密码
      if (needsPassword && !loginPwd) {
        this.showAlert('请输入登录密码以导出数据库')
        return
      }
      // 勾选加密（仅加密库有意义）：无密码账号必须提供一个导出密码（否则没有口令可供包裹库钥匙）
      if (this.dbEncrypted && this.exportEncrypt && !needsPassword && !this.exportDbPwd) {
        this.showAlert('该账号未设置密码，请设置一个导出密码以加密备份')
        return
      }
      this.busyExport = true
      try {
        const body = { encrypt: this.exportEncrypt ? '1' : '0' }
        if (needsPassword) body.password = loginPwd
        if (this.dbEncrypted && this.exportEncrypt && this.exportDbPwd) body.dbPassword = this.exportDbPwd
        const res = await axios.post('/api/account/export', body)
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = this.user.username + '-backup.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        this.closeModal()
        this.showAlert('导出成功。请保管好备份文件与本次使用的数据库密码（线上明文不保存）')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '导出失败')
      } finally { this.busyExport = false }
    },
    // Theme
    onThemeSelect() {
      this.themeStore.setTheme(this.selectedThemeId)
    },
    // 提示合并（立即生效，无需保存）
    onMergeNotificationsChange(e) {
      this.mergeNotifications = e.target.checked
      localStorage.setItem('mergeNotifications', this.mergeNotifications ? '1' : '0')
    },
    // 图标样式：线性图标 / Emoji
    onIconStyleChange() {
      this.themeStore.setIconStyle(this.iconStyle)
    },
    // 顶栏/侧边栏毛玻璃配色：深蓝 / 白色调（立即生效）
    onTopbarColorChange() {
      this.themeStore.setTopbarColor(this.topbarColor)
    },
    // Background image
    async onBgImageFileChange(e) {
      const file = e.target.files[0]
      if (!file) return
      this.bgImageFileName = file.name
      
      // 检查是否在 Electron 环境中，且文件大于 2MB，使用后端存储
      if (window.electron && window.electron.invoke && file.size > 2 * 1024 * 1024) {
        try {
          // 读取文件为 base64 后传给主进程保存
          const reader = new FileReader()
          reader.onload = async (ev) => {
            const base64Data = ev.target.result.split(',')[1] // 去掉 data:image/...;base64, 前缀
            const result = await window.electron.invoke('save-background-image', {
              name: file.name,
              base64: base64Data
            })
            if (result.success && result.url) {
              this.bgImageUrl = result.url
              this.themeStore.setBackgroundImage(result.url)
            } else {
              this.showAlert(result.error || '保存图片失败')
            }
          }
          reader.readAsDataURL(file)
        } catch (err) {
          console.error('保存图片失败:', err)
          this.showAlert('保存图片失败: ' + err.message)
        }
      } else {
        // 小图片或非 Electron 环境，使用 base64
        if (file.size > 2 * 1024 * 1024) {
          this.showAlert('图片过大，请选择 2MB 以下的图片')
          return
        }
        const reader = new FileReader()
        reader.onload = (ev) => {
          this.bgImageUrl = ev.target.result
          this.themeStore.setBackgroundImage(ev.target.result)
        }
        reader.readAsDataURL(file)
      }
    },
    clearBgImage() {
      this.bgImageUrl = ''
      this.bgImageFileName = ''
      this.themeStore.setBackgroundImage('')
      if (this.$refs.bgImageInput) this.$refs.bgImageInput.value = ''
    },
    onBgMaskOpacityChange(e) {
      this.themeStore.setBgMaskOpacity(parseFloat(e.target.value))
    },
    onGlassOpacityChange(e) {
      this.themeStore.setGlassOpacity(parseFloat(e.target.value))
    },
    // ==================== 工具箱设置 ====================
    async loadWidgetSettings() {
      try {
        const res = await axios.get('/api/widget-settings')
        if (res.data.success) {
          this.toolboxEnabled = res.data.data.toolboxEnabled
          this.noteSavePath = res.data.data.noteSavePath || ''
          this.screenshotSavePath = res.data.data.screenshotSavePath || ''
        }
      } catch (err) {
        console.error('加载工具箱设置失败:', err)
      } finally {
        this.loaded = true
      }
    },
    async saveWidgetSettings() {
      try {
        await axios.put('/api/widget-settings', {
          toolboxEnabled: this.toolboxEnabled,
          noteSavePath: this.noteSavePath,
          screenshotSavePath: this.screenshotSavePath
        })
        window.electron?.send('to-widget', { type: 'settings-changed' })
      } catch (err) {
        console.error('保存工具箱设置失败:', err)
      }
    },
    onToolboxChange(e) {
      this.toolboxEnabled = e.target.checked
      if (!this.loaded) return
      this.saveWidgetSettings()
    },
    async loadSession() {
      try {
        this.sessionEnabled = await window.electron?.invoke('get-session-widget-visible')
      } catch (_) {}
      if (this.sessionEnabled === null || this.sessionEnabled === undefined) {
        this.sessionEnabled = this.toolboxEnabled
        window.electron?.send('widget-set-session-visible', this.sessionEnabled)
      }
      this.sessionLoaded = true
    },
    onSessionChange(e) {
      this.sessionEnabled = e.target.checked
      if (!this.sessionLoaded) return
      window.electron?.send('widget-set-session-visible', this.sessionEnabled)
    },
    async loadUsbAutoOpen() {
      try {
        const res = await window.electron?.invoke('get-usb-auto-open')
        this.usbAutoOpen = !!res?.enabled
      } catch (_) {}
    },
    async onUsbAutoOpenChange(e) {
      this.usbAutoOpen = e.target.checked
      try {
        await window.electron?.invoke('set-usb-auto-open', this.usbAutoOpen)
      } catch (_) {
        console.error('保存U盘自动打开设置失败')
      }
    },
    async loadDataDirs() {
      try {
        const res = await window.electron?.invoke('get-data-directories')
        if (res) {
          this.dataDir = res.dataDir
          this.thumbsDir = res.thumbsDir
          this.screenshotDir = res.screenshotDir || ''
        }
      } catch (_) {}
    },
    async changeDataDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.showConfirm(`确定把数据库目录搬迁到「${picked}」吗？搬迁期间所有窗口会暂时关闭并显示迁移进度，请勿强行停止程序，完成后会自动重开主界面。`, async () => {
        this.busyDataDir = true
        try {
          const res = await window.electron.invoke('set-data-dir', picked)
          if (res?.ok) {
            this.dataDir = res.dataDir
            this.showAlert(res.changed ? '数据库目录搬迁成功，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          this.showAlert(err?.message || '数据库目录搬迁失败')
        } finally {
          this.busyDataDir = false
        }
      })
    },
    async changeThumbsDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.showConfirm(`确定把相册缩略图缓存目录改为「${picked}」吗？将自动重启应用服务，缩略图会按需重建。`, async () => {
        this.busyThumbsDir = true
        try {
          const res = await window.electron.invoke('set-thumbs-dir', picked)
          if (res?.ok) {
            this.thumbsDir = res.thumbsDir
            this.showAlert(res.changed ? '缓存目录已切换，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          this.showAlert(err?.message || '缓存目录切换失败')
        } finally {
          this.busyThumbsDir = false
        }
      })
    },
    // 读取本账号数据库的加密状态
    async loadDbEncryption() {
      try {
        const { data } = await axios.get('/api/account/db-encryption')
        this.dbEncrypted = !!data.encrypted
      } catch (_) { /* 读取失败保持默认（加密） */ } finally {
        this.dbEncryptionLoading = false
      }
    },
    // 切换本账号数据库加密方式：复用数据目录迁移那套流程（关闭其它窗口 → 独立进度窗口转换 → 重开主界面）
    toggleDbEncryption() {
      const turningOff = this.dbEncrypted
      const msg = turningOff
        ? '确定关闭数据库加密吗？关闭后本账号数据库将以明文保存，任何能访问该文件的程序都能直接读取其中数据（仅影响本账号，不影响其它账号）。转换期间所有窗口会暂时关闭并显示进度，请勿强行停止程序，完成后会自动重开主界面。'
        : '确定启用数据库加密吗？启用后本账号数据库将以随机密钥加密保存。转换期间所有窗口会暂时关闭并显示进度，请勿强行停止程序，完成后会自动重开主界面。'
      this.showConfirm(msg, async () => {
        this.busyDbEncryption = true
        try {
          // 主窗口即将被关闭并重开，转换结果由主进程提示条反馈
          await window.electron.invoke('set-db-encryption', { encrypt: !turningOff })
        } catch (err) {
          this.showAlert(err?.message || '操作失败')
        } finally {
          this.busyDbEncryption = false
        }
      })
    },
    async pickDir() {
      try {
        const result = await window.electron?.invoke('select-folder')
        if (result && result.filePaths && result.filePaths.length > 0) {
          return result.filePaths[0]
        }
      } catch (_) {}
      return ''
    },
    async openDir(path) {
      if (!path) return
      try {
        await window.electron?.invoke('open-folder', path)
      } catch (err) {
        console.error('打开文件夹失败:', err)
      }
    },
    async selectFolder(type) {
      try {
        const result = await window.electron?.invoke('select-folder')
        if (result && result.filePaths && result.filePaths.length > 0) {
          const path = result.filePaths[0]
          if (type === 'note') {
            this.noteSavePath = path
          } else {
            this.screenshotSavePath = path
          }
          this.saveWidgetSettings()
        }
      } catch (err) {
        console.error('选择文件夹失败:', err)
      }
    },
    // ==================== 性能面板 ====================
    // 轮询开关：进入页面（含从 KeepAlive 恢复）开始，离开即停，避免常驻采样
    _startPerfPolling() {
      if (this._perfTimer) return
      this.loadPerf()
      this._perfTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return
        this.loadPerf()
      }, 1800)
    },
    _stopPerfPolling() {
      if (!this._perfTimer) return
      clearInterval(this._perfTimer)
      this._perfTimer = null
    },
    // 提示条：复用项目统一的 useNotification
    notifySuccess(msg) {
      useNotification().success(msg)
    },
    notifyError(msg) {
      useNotification().error(msg)
    },
    // 取一次逐进程内存快照，并更新三个重启目标的存活状态
    async loadPerf() {
      try {
        const snap = await window.electron?.invoke('perf-snapshot')
        if (snap) {
          this.perfProcs = Array.isArray(snap.procs) ? snap.procs : []
          this.perfAlive = {
            front: !!(snap.alive && snap.alive.front),
            backend: !!(snap.alive && snap.alive.backend),
            widget: !!(snap.alive && snap.alive.widget),
          }
        }
      } catch (_) { /* 后端未就绪等场景静默忽略 */ }
    },
    // 取上次启动耗时
    async loadStartup() {
      try {
        const t = await window.electron?.invoke('perf-startup')
        this.perfStartupTotal = Math.round(t?.total || 0)
      } catch (_) {}
    },
    // KB → MB 文本；无数据时占位，保持列宽稳定
    fmtMem(kb) {
      if (kb === null || kb === undefined) return '--'
      return `${Math.round(kb / 1024)} MB`
    },
    // 条形宽度百分比：以总计为分母，最小值 3% 让很小的值也可见，封顶 100%
    barPct(kb) {
      if (!kb) return 0
      return Math.min(100, Math.max(3, Math.round((kb / this.perfMaxKB) * 100)))
    },
    // 手动回收：主进程 + 各渲染进程 + 后端
    async recycleAll() {
      if (this.busyGc) return
      this.busyGc = true
      try {
        await window.electron?.invoke('perf-gc')
        await this.loadPerf()
        this.notifySuccess('已执行内存回收')
      } catch (_) {
        this.notifyError('内存回收失败')
      } finally {
        this.busyGc = false
      }
    },
    // 重启前端：页面会自行重载，无需提示
    restartFrontend() {
      window.electron?.invoke('perf-restart-frontend')
    },
    // 重启后端：复用已有的 restart-backend 通道
    async restartBackend() {
      if (this.busyRestartBackend) return
      this.busyRestartBackend = true
      try {
        await window.electron?.invoke('restart-backend')
        await this.loadPerf()
        this.notifySuccess('后端已重启')
      } catch (_) {
        this.notifyError('后端重启失败')
      } finally {
        this.busyRestartBackend = false
      }
    },
    // 重启小组件：销毁并重建原本存在的窗口
    async restartWidget() {
      if (this.busyRestartWidget) return
      this.busyRestartWidget = true
      try {
        await window.electron?.invoke('perf-restart-widget')
        await this.loadPerf()
        this.notifySuccess('小组件已重启')
      } catch (_) {
        this.notifyError('小组件重启失败')
      } finally {
        this.busyRestartWidget = false
      }
    },
  },
}
</script>
