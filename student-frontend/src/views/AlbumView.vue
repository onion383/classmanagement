<template>
  <div class="h-full flex flex-col relative">
    <!-- 顶部标题栏：左侧标题，右侧统计（照片 | 相册 | 总占用），样式对齐首页标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <div class="flex-1 flex items-center justify-between gap-3">
        <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="album" /> 班级相册</h1>
        <div class="flex items-center gap-4 shrink-0">
          <div class="flex items-baseline gap-1.5" title="已索引的照片总数（按文件去重）">
            <span class="text-lg font-bold text-success leading-none tabular-nums">{{ albumStats.photo_count }}</span>
            <span class="text-xs text-text-muted">照片</span>
          </div>
          <div class="w-px h-6 bg-border"></div>
          <div class="flex items-baseline gap-1.5" title="相册数量">
            <span class="text-lg font-bold text-warning leading-none tabular-nums">{{ albumStats.album_count }}</span>
            <span class="text-xs text-text-muted">相册</span>
          </div>
          <div class="w-px h-6 bg-border"></div>
          <div class="flex items-baseline gap-1.5" title="照片与视频的总占用体积">
            <span class="text-lg font-bold text-primary leading-none tabular-nums">{{ sizeParts.value }}</span>
            <span class="text-xs text-text-muted">{{ sizeParts.unit }}</span>
          </div>
        </div>
      </div>
      <p v-if="busyScan" class="text-xs mt-3 px-4 py-2 bg-bg rounded text-text-secondary">正在更新照片索引…（可在「任务管理」中查看进度或停止）</p>
    </div>

    <!-- 工具栏：相册级操作 + 右侧视图切换（时间轴 / 相册），两个视图下都保留 -->
    <!-- flex-wrap：窗口贴到最小宽度（900）时按钮多，宁可换行也不要横向溢出把 ViewSwitch 挤出去 -->
    <div class="flex items-center gap-3 mb-4 flex-shrink-0 flex-wrap">
      <button v-preload="loadNewAlbumDialog" @click="openNewAlbum" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5">
        <IconGlyph name="folder" :size="14" tint="current" /> 新建相册
      </button>
      <button v-preload="loadAlbumManageDialog" @click="openManage" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh transition-theme">
        <IconGlyph name="settings" :size="14" tint="current" /> 管理相册
      </button>
      <button v-preload="loadAlbumTaskDialog" @click="openTask" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5">
        <IconGlyph name="clock" :size="14" tint="current" /> 任务管理
      </button>
      <!-- 多选：时间轴选照片（移动/全选），相册视图选虚拟相册（合并）；再点一次退出 -->
      <button
        @click="toggleSelectMode"
        :disabled="activeTab === 'gallery' ? albums.length === 0 : !activeAlbum"
        class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh disabled:opacity-50 transition-theme"
        title="进入 / 退出多选（时间轴选照片，相册视图选虚拟相册合并）"
      >
        <IconGlyph name="check" :size="14" tint="current" /> 多选
      </button>
      <button v-preload="loadExportAlbumIndex" @click="openExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5">
        <IconGlyph name="download" :size="14" tint="current" /> 导出相册索引
      </button>
      <!-- 刷新：从标题栏移到菜单栏，增量更新当前相册的照片索引 -->
      <button @click="refreshAll" :disabled="busyScan || !activeAlbumId" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh disabled:opacity-50 transition-theme" :title="activeAlbumIsVirtual ? '按已有索引更新拍摄时间与缩略图（不遍历文件夹）' : '增量更新当前相册的照片索引'">
        <IconGlyph name="refresh" :size="14" tint="current" /> {{ busyScan ? '刷新中…' : '刷新' }}
      </button>
      <!-- 视图切换：紧跟「刷新」右侧并右对齐 -->
      <ViewSwitch v-model="activeTab" :options="VIEW_OPTIONS" class="ml-auto" />
    </div>

    <!-- ==================== 时间轴：照片按日期分组的网格 ==================== -->
    <div v-if="activeTab === 'timeline'" class="flex-1 min-h-0 flex flex-col">
      <!-- 相册切换条 -->
      <div v-if="albums.length > 1" class="flex gap-2 mb-4 flex-wrap">
        <button
          v-for="a in albums" :key="a.id"
          :data-row-id="a.id"
          @click="selectAlbum(a.id)"
          class="px-4 py-2 rounded transition-theme text-sm"
          :class="activeAlbumId === a.id ? 'bg-primary text-text-inverse' : 'bg-surface text-text border border-border hover:bg-surface-hover'"
        >
          {{ a.name }}（{{ a.photo_count }}）
        </button>
      </div>

      <!-- 空状态 -->
      <div v-if="!activeAlbum" class="bg-surface rounded-xl border border-border p-12 text-center text-text-muted">
        <p class="text-lg mb-2">还没有相册</p>
        <p class="text-sm">点击「新建相册」选择照片所在文件夹，系统会自动扫描并建立索引。</p>
      </div>

      <!-- 照片按日期分组（网格窗口化虚拟滚动） -->
      <div v-else class="flex-1 min-h-0 flex flex-col">
        <p v-if="groups.length === 0" class="bg-surface rounded-xl border border-border p-12 text-center text-text-muted">
          当前相册暂无照片，点击「刷新」或到设置页「更新文件夹照片」重新扫描。
        </p>

        <!-- 照片区 + 右侧年份刻度尺：行布局，滚动只发生在左侧网格里 -->
        <div v-else class="flex-1 min-h-0 flex gap-1">
          <!-- 虚拟滚动容器：只挂载视口附近的分组，外部用总高度撑起滚动条 -->
          <div ref="containerRef" class="flex-1 overflow-auto min-h-0 album-scroll" @scroll="onScroll">
          <div class="relative" :style="{ height: totalH + 'px' }">
            <div
              v-for="v in visibleGroups"
              :key="v.g.date"
              class="absolute left-0 right-0 mb-8 album-group"
              :style="{ top: v.offset + 'px' }"
            >
              <h2 class="text-lg font-semibold text-text mb-3 flex items-center gap-2">
                <span class="px-2 py-0.5 bg-info/10 text-info rounded text-sm">{{ v.g.date }}</span>
                <span class="text-xs text-text-muted">{{ v.g.photos.length }} 张</span>
                <!-- 日期来源提示：日期组里混有读不到拍摄时间的照片时给出个数（读不到的那些单独归「未知时间」） -->
                <span
                  v-if="groupDateHint(v.g)"
                  class="text-xs text-text-muted border border-border rounded px-1.5 py-0.5"
                  :title="`${groupDateHint(v.g)}：图片里没有可读的拍摄时间，已单独归到时间轴最底部的「未知时间」`"
                >{{ groupDateHint(v.g) }}</span>
              </h2>
              <div class="flex flex-wrap gap-3">
                <div
                  v-for="p in v.g.photos"
                  :key="p.id"
                  @click="onCellClick(p)"
                  @pointerdown="onCellPointerDown(p, $event)"
                  @pointermove="onCellPointerMove"
                  @pointerup="onCellPointerUp"
                  @pointercancel="onCellPointerUp"
                  @pointerleave="onCellPointerUp"
                  class="rounded-lg overflow-hidden bg-bg border cursor-pointer group relative photo-cell select-none"
                  :class="selectMode && isSelected(p.id) ? 'border-info ring-2 ring-info' : 'border-border'"
                  :style="cellStyle"
                >
                  <VideoThumb v-if="isVideo(p)" :src="thumbSrc(p)" />
                  <img v-else :src="thumbSrc(p)" :alt="p.file_name" class="w-full h-full object-cover" loading="lazy" decoding="async" draggable="false" @error="onThumbError" />
                  <!-- 多选态：左上角勾选标记 -->
                  <span
                    v-if="selectMode"
                    class="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] leading-none"
                    :class="isSelected(p.id) ? 'bg-info border-info text-text-inverse' : 'bg-black/25 border-white/85 text-transparent'"
                  >✓</span>
                  <div class="photo-mask" :class="{ 'photo-mask--sel': selectMode && isSelected(p.id) }"></div>
                </div>
              </div>
            </div>
          </div>
          </div>

          <!-- 右侧年份刻度尺：拖动手柄直接定位到对应日期 -->
          <AlbumYearRuler
            :items="rulerItems"
            :total="totalH"
            :scroll-top="scrollTop"
            :client-h="clientH"
            @seek="seekTimeline"
          />
        </div>
      </div>
    </div>

    <!-- ==================== 相册：封面卡片 ==================== -->
    <div v-else class="flex-1 min-h-0 flex flex-col">

      <p v-if="albums.length === 0" class="bg-surface rounded-xl border border-border p-12 text-center text-text-muted">
        还没有相册，点击「新建相册」选择照片所在文件夹，系统会自动扫描并建立索引。
      </p>

      <div v-else class="flex-1 min-h-0 overflow-auto pr-1">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
          <div
            v-for="a in albums" :key="a.id"
            :data-row-id="a.id"
            @click="onAlbumCardClick(a)"
            class="bg-surface rounded-2xl border border-border p-2.5 transition-theme hover:shadow-card hover:border-primary/40 group relative"
            :class="[
              selectMode && a.kind !== 'virtual' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              selectMode && isAlbumSelected(a.id) ? 'border-info ring-2 ring-info' : ''
            ]"
            :title="selectMode
              ? (a.kind === 'virtual' ? '点击选择 / 取消选择（虚拟相册可合并）' : '文件夹相册不能参与合并')
              : `查看「${a.name}」的照片`"
          >
            <!-- 相册多选态：左上角勾选标记；文件夹相册只显示禁用态 -->
            <span
              v-if="selectMode"
              class="absolute top-3.5 left-3.5 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] leading-none"
              :class="isAlbumSelected(a.id) ? 'bg-info border-info text-text-inverse' : 'bg-black/25 border-white/85 text-transparent'"
            >✓</span>
            <!-- 封面：最新一张图片的缩略图，四角圆角 -->
            <div class="aspect-[4/3] rounded-xl overflow-hidden bg-bg relative">
              <span v-if="a.kind === 'virtual'" class="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] bg-black/45 text-white">虚拟</span>
              <img
                v-if="a.cover_photo_id"
                :src="coverSrc(a)"
                alt=""
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                loading="lazy"
                decoding="async"
                @error="onThumbError"
              />
              <div v-else class="w-full h-full flex flex-col items-center justify-center gap-1 text-text-muted text-xs">
                <IconGlyph name="folder" :size="22" />
                <span>暂无图片</span>
              </div>
            </div>
            <div class="px-1 pt-2.5 pb-1">
              <p class="font-medium text-text truncate">{{ a.name }}</p>
              <p class="text-xs text-text-muted mt-1">共 {{ a.photo_count || 0 }} 个媒体</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 多选浮窗：固定在页面底部，与时间轴 / 相册视图重叠（不占列表高度） -->
    <!-- 外层只负责水平居中，内层只做竖直弹入，避免动画过程中水平位移 -->
    <Transition name="select-float">
      <div v-if="selectMode" class="absolute bottom-1 left-1/2 -translate-x-1/2 z-30">
        <div class="select-float-panel flex items-center gap-2 px-4 py-2.5 rounded-full bg-surface border border-border shadow-lg">
          <!-- 相册视图：选中的是虚拟相册，动作为合并 -->
          <template v-if="activeTab === 'gallery'">
            <span class="text-sm text-text whitespace-nowrap">已选 <span class="font-semibold tabular-nums">{{ selectedAlbumCount }}</span> 个相册</span>
            <button @click="clearSelection" class="px-3 py-1 rounded-full bg-surface-hover text-text border border-border text-sm transition-theme whitespace-nowrap">取消选择</button>
            <button
              @click="mergeSelectedAlbums"
              :disabled="selectedAlbumCount < 2 || merging"
              class="px-3 py-1 rounded-full bg-info hover:bg-info-hover text-text-inverse text-sm transition-theme whitespace-nowrap disabled:opacity-50"
              title="把选中的虚拟相册合并成一个新虚拟相册（不移动磁盘文件）"
            >{{ merging ? '合并中…' : `合并相册（${selectedAlbumCount}）` }}</button>
            <button @click="exitSelectMode" class="px-3 py-1 rounded-full bg-surface-hover text-text border border-border text-sm transition-theme whitespace-nowrap">退出多选</button>
          </template>
          <!-- 时间轴视图：选中的是照片，动作为移动到其他相册 -->
          <template v-else>
            <span class="text-sm text-text whitespace-nowrap">已选 <span class="font-semibold tabular-nums">{{ selectedCount }}</span> 张</span>
            <button @click="selectAllPhotos" class="px-3 py-1 rounded-full bg-surface-hover text-text border border-border text-sm transition-theme whitespace-nowrap">全选</button>
            <button @click="clearSelection" class="px-3 py-1 rounded-full bg-surface-hover text-text border border-border text-sm transition-theme whitespace-nowrap">取消选择</button>
            <button
              v-preload="loadMoveAlbumDialog"
              @click="openMove"
              :disabled="!selectedCount"
              class="px-3 py-1 rounded-full bg-info hover:bg-info-hover text-text-inverse text-sm transition-theme whitespace-nowrap disabled:opacity-50"
              title="把选中的照片索引移动到其他相册（不移动磁盘文件）"
            >移动到相册（{{ selectedCount }}）</button>
            <button @click="exitSelectMode" class="px-3 py-1 rounded-full bg-surface-hover text-text border border-border text-sm transition-theme whitespace-nowrap">退出多选</button>
          </template>
        </div>
      </div>
    </Transition>

    <!-- 新建相册弹窗（文件夹 / 其他相册两种来源），懒加载 -->
    <NewAlbumDialog
      v-if="newAlbumMounted"
      :visible="newAlbumVisible"
      :albums="albums"
      @close="newAlbumVisible = false"
      @created="onAlbumCreated"
    />

    <!-- 管理相册弹窗（相册增删排序），懒加载 -->
    <AlbumManageDialog
      v-if="manageMounted"
      :visible="showManage"
      @close="showManage = false"
      @changed="onAlbumsChanged"
    />

    <!-- 任务管理弹窗（后台扫描任务列表 + 更新文件夹照片），懒加载 -->
    <AlbumTaskDialog
      v-if="taskMounted"
      :visible="showTask"
      @close="showTask = false"
      @changed="onAlbumsChanged"
    />

    <!-- 移动到其他相册弹窗（时间轴长按多选后使用），懒加载 -->
    <MoveAlbumDialog
      v-if="moveMounted"
      :visible="moveVisible"
      :albums="albums"
      :current-album-id="activeAlbumId"
      :photo-ids="selectedPhotoIds"
      @close="moveVisible = false"
      @moved="onPhotosMoved"
    />

    <!-- 导出相册索引弹窗（复用 ExportExcel），懒加载 -->
    <ExportAlbumIndex
      v-if="exportMounted"
      :is-visible="exportVisible"
      :albums="albums"
      @update:is-visible="exportVisible = $event"
    />

    <!-- 媒体查看器（图片 / 视频） -->
    <Teleport to="body">
    <Transition name="preview">
    <div v-if="viewer" class="fixed inset-0 bg-black/90 z-[10004] flex flex-col" @click.self="closeViewer">
      <!-- 关闭按钮（右上角） -->
      <button @click="closeViewer" class="z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white text-lg flex items-center justify-center transition-theme" style="position:absolute!important;top:16px!important;right:16px!important;" title="关闭">✕</button>
      <!-- 上一张（左侧边缘居中） -->
      <button @click="prevPhoto" class="z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white text-xl flex items-center justify-center transition-theme" style="position:absolute!important;left:16px!important;top:50%!important;transform:translateY(-50%)!important;" title="上一张">‹</button>
      <!-- 下一张（右侧边缘居中） -->
      <button @click="nextPhoto" class="z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white text-xl flex items-center justify-center transition-theme" style="position:absolute!important;right:16px!important;top:50%!important;transform:translateY(-50%)!important;" title="下一张">›</button>
      <!-- 视频播放区 -->
      <div v-if="isVideo(viewer)" class="flex-1 flex items-center justify-center p-6 overflow-hidden preview-media">
        <video
          ref="videoEl"
          class="max-w-full max-h-full bg-black outline-none"
          :src="photoSrc(viewer)"
          @timeupdate="onTimeupdate"
          @loadedmetadata="onLoadedmetadata"
          @play="playing = true"
          @pause="playing = false"
          @ended="playing = false"
        ></video>
      </div>
      <!-- 图片查看区：滚轮缩放只挂在外层容器上（原来 img 上还挂了一份重复监听，
           多出来的非 passive wheel 监听既浪费又会在 devtools 里刷 Violation 提示） -->
      <div v-else class="flex-1 flex items-center justify-center p-6 overflow-hidden preview-media" @wheel.prevent="onZoomWheel">
        <img
          :src="photoSrc(viewer)"
          class="max-w-full max-h-full select-none transition-transform duration-100"
          :style="viewerStyle"
          draggable="false"
        />
      </div>
      <!-- 底部工具条 -->
      <div class="flex items-center justify-center gap-3 p-4 bg-black/40 flex-wrap">
        <!-- 视频控制 -->
        <template v-if="isVideo(viewer)">
          <button @click="togglePlay" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-theme" :title="playing ? '暂停' : '播放'">{{ playing ? '⏸' : '▶' }}</button>
          <button @click="skip(-10)" class="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs transition-theme" title="后退 10 秒">« -10s</button>
          <div class="flex items-center gap-2 min-w-[260px] max-w-full">
            <span class="text-white text-xs tabular-nums w-12 text-right">{{ fmtTime(currentTime) }}</span>
            <input
              type="range"
              class="flex-1 accent-info"
              min="0"
              :max="duration || 0"
              step="0.1"
              :value="currentTime"
              @input="onSeekInput"
              @pointerdown="dragging = true"
              @pointerup="dragging = false"
            />
            <span class="text-white text-xs tabular-nums w-12">{{ fmtTime(duration) }}</span>
          </div>
          <button @click="skip(10)" class="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs transition-theme" title="前进 10 秒">+10s »</button>
          <AppSelect v-model="playbackRate" @change="changeRate" class="w-20" title="播放倍数" :options="[{ value: 0.5, label: '0.5x' }, { value: 0.75, label: '0.75x' }, { value: 1, label: '1x' }, { value: 1.25, label: '1.25x' }, { value: 1.5, label: '1.5x' }, { value: 2, label: '2x' }]" />
          <span class="text-white/30">|</span>
        </template>
        <!-- 图片控制 -->
        <template v-else>
          <button @click="rotate(-1)" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-theme">⟲</button>
          <button @click="rotate(1)" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-theme">⟳</button>
          <button @click="zoomOut" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-theme">−</button>
          <span class="text-white text-xs w-14 text-center">{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-theme">＋</button>
          <button @click="resetView" class="px-3 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs transition-theme">复位</button>
          <span class="text-white/30">|</span>
        </template>
        <button @click="saveAs(viewer)" class="px-4 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-theme">另存</button>
        <button @click="openFolderViewer" class="px-4 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-theme">打开文件夹</button>
        <button @click="deletePhoto(viewer)" class="px-4 h-10 rounded-full bg-danger hover:bg-danger/80 text-white text-sm transition-theme">删除（回收站）</button>
      </div>
    </div>
    </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onActivated, onDeactivated, onBeforeUnmount, getCurrentInstance, watch, defineAsyncComponent } from 'vue'
import axios from 'axios'
import { pushUndo } from '../api/undo'
import { useNotification } from '../composables/useNotification.js'
import { reportError } from '../utils/reportError.js'
import { applyRouteRowFocus } from '../composables/useRowFocus.js'
import { useUndoShortcut } from '../composables/useUndo.js'
import { useAlbumScan } from '../composables/useAlbumScan.js'
import { useSeq } from '../composables/useSeq.js'
import { usePhotoTimeline } from '../composables/usePhotoTimeline.js'
import { useThumbBatch } from '../composables/useThumbBatch.js'
import VideoThumb from '../components/import-export/VideoThumb.vue'
import AppSelect from '../components/base/AppSelect.vue'
import ViewSwitch from '../components/base/ViewSwitch.vue'
import AlbumYearRuler from '../components/album/AlbumYearRuler.vue'
import IconGlyph from '../components/base/IconGlyph.vue'
import { albumThumbUrl, albumFileUrl } from '../utils/albumMedia'
import { pad2 } from '../utils/dateTime.js'
import '../styles/dialog-transition.css'
import { INVOKE } from '../electronChannels.js'

// 新建相册 / 相册管理 / 任务管理 / 相册索引导出四个弹窗按需加载（与分组管理等页面同一套约定）
const loadNewAlbumDialog = () => import('../components/dialogs/NewAlbumDialog.vue')
const NewAlbumDialog = defineAsyncComponent(loadNewAlbumDialog)
const loadAlbumManageDialog = () => import('../components/dialogs/AlbumManageDialog.vue')
const AlbumManageDialog = defineAsyncComponent(loadAlbumManageDialog)
const loadAlbumTaskDialog = () => import('../components/dialogs/AlbumTaskDialog.vue')
const AlbumTaskDialog = defineAsyncComponent(loadAlbumTaskDialog)
const loadMoveAlbumDialog = () => import('../components/dialogs/MoveAlbumDialog.vue')
const MoveAlbumDialog = defineAsyncComponent(loadMoveAlbumDialog)
const loadExportAlbumIndex = () => import('../components/import-export/ExportAlbumIndex.vue')
const ExportAlbumIndex = defineAsyncComponent(loadExportAlbumIndex)

// 视图切换（菜单栏右对齐的 ViewSwitch）：时间轴 = 原照片按日期分组页；相册 = 封面卡片
const VIEW_OPTIONS = [
  { value: 'timeline', label: '时间轴' },
  { value: 'gallery', label: '相册' }
]
const activeTab = ref('timeline')

const albums = ref([])
// 标题栏统计：照片总数 / 相册数 / 总占用（由后端按文件路径去重后返回）
const albumStats = ref({ photo_count: 0, album_count: 0, total_size: 0 })
const activeAlbumId = ref(null)
const groups = ref([])
const busyScan = ref(false)

// 弹窗
const newAlbumVisible = ref(false)
const newAlbumMounted = ref(false)
const showManage = ref(false)
const manageMounted = ref(false)
const showTask = ref(false)
const taskMounted = ref(false)
const moveVisible = ref(false)
const moveMounted = ref(false)
const exportVisible = ref(false)
const exportMounted = ref(false)

// 查看器
const viewer = ref(null)
const rotation = ref(0)
const zoom = ref(1)

// 视频播放状态
const videoEl = ref(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const playbackRate = ref(1)
const dragging = ref(false)

const { waitScan, stopAll } = useAlbumScan()

const token = () => localStorage.getItem('token') || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/i
function isVideo(p) {
  return p && VIDEO_RE.test(p.file_name || '')
}

// 用 id 动态拉取源文件（图片/视频），避免直接暴露绝对路径，也保持鉴权。
// 用稳定 URL（不带时间戳），让浏览器能正常缓存，避免每次渲染整批重载。
// 生产模式 file:// 协议下需补完整后端地址（apiUrl），否则 /api 会被解析到磁盘根目录。
// <img> 无法携带 Authorization 头，故由 utils/albumMedia 统一追加 ?token= 查询参数通过鉴权。
function photoSrc(p) {
  return albumFileUrl(p.id)
}

// 缩略图 URL 由 utils/albumMedia 统一拼（顺带带上缩略图缓存版本 v=，
// 尺寸/质量升级时靠它让浏览器旧缓存失效；否则 max-age 会把旧图留一天）
// 优先用批量预取拿到的 objectURL（少几百次 HTTP 往返），
// 没批量到的回落到单张 /thumb 接口（服务端现场生成，功能不变）。
function thumbSrc(p) {
  return batchThumbUrl(p.id) || albumThumbUrl(p.id)
}

// 相册卡片封面：后端已按「mtime 最新的一张图片」给出 cover_photo_id，直接用它的缩略图
function coverSrc(a) {
  return albumThumbUrl(a.cover_photo_id)
}

// 缩略图生成失败/源文件缺失等导致的 404：换为中性占位图，避免网格出现破图图标
const THUMB_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#f3f4f6"/><g fill="none" stroke="#d1d5db" stroke-width="4"><circle cx="80" cy="70" r="18"/><path d="M30 132 Q52 96 82 118 T160 100" fill="none"/></g></svg>`
)
function onThumbError(e) {
  if (e.target && e.target.src !== THUMB_PLACEHOLDER) e.target.src = THUMB_PLACEHOLDER
}

function fmtTime(t) {
  if (!isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${pad2(s)}`
}

const activeAlbum = computed(() => albums.value.find(a => a.id === activeAlbumId.value))
// 虚拟相册没有绑定文件夹，索引来自别的相册，刷新/重扫对它没有意义
const activeAlbumIsVirtual = computed(() => activeAlbum.value?.kind === 'virtual')
const viewerStyle = computed(() => {
  const base = (viewer.value && viewer.value._rot) || 0
  return { transform: `rotate(${base}deg) scale(${zoom.value})` }
})

/* ===== 网格窗口化虚拟滚动 =====
 * 逻辑已抽到 composables/usePhotoTimeline.js（与「选择照片」弹窗共用）：
 * 以“日期分组”为窗口单元，外部用总高度撑起滚动条，内部只挂载视口附近（含缓冲）的分组。 */
const {
  containerRef, scrollTop, clientH, cellStyle, totalH, visibleGroups, layout,
  measure, onScroll, onResize, reset: resetTimeline,
} = usePhotoTimeline(groups)

/* ===== 右侧年份刻度尺 =====
 * 刻度尺的定位基准就是 layout 里的分组偏移（每个分组带 date + offset），
 * 拖动手柄时按目标偏移写回容器 scrollTop，容器滚动再驱动刻度尺同步。 */
const rulerItems = computed(() => layout.value.items.map(v => ({ date: v.g.date, offset: v.offset })))

function seekTimeline(offset) {
  const el = containerRef.value
  if (!el) return
  el.scrollTop = Math.max(0, Math.min(offset, el.scrollHeight - el.clientHeight))
}

// 分组标题旁的来源标记：整组都有 EXIF 时不显示（「未知时间」组由后端统一命名，
// 那里必然全是回退项，再标一次是冗余）；只有正常日期组里混进了无 EXIF 的照片才提示。
function groupDateHint(g) {
  if (g.date === '未知时间') return ''
  const ps = g.photos || []
  if (!ps.length) return ''
  const exifCount = ps.filter(p => p.date_src === 'exif').length
  if (exifCount === ps.length) return ''
  const rest = ps.length - exifCount
  return `${rest} 张未知时间`
}

/* ===== 缩略图批量预取 =====
 * 可视区的照片 id 变化时，一次批量取回缩略图（转 objectURL 给 <img> 用），
 * 免得几十上百个 <img> 各自发一次请求（受浏览器同源并发连接数限制）。
 * 批量没取到的（服务端还没缓存缩略图）自动回落到单张 /thumb 接口，功能不变。
 * 实测：批量 0.19 ms/张 vs 逐个并发 2.43 ms/张。 */
const visiblePhotoIds = computed(() => {
  const out = []
  for (const v of visibleGroups.value) {
    for (const p of (v.g.photos || [])) out.push(p.id)
  }
  return out
})
const {
  thumbUrlFor: batchThumbUrl,
  refresh: refreshThumbBatch,
  clear: clearThumbBatch,
} = useThumbBatch(() => visiblePhotoIds.value)

async function loadAlbums(first = true) {
  // 相册列表失败原先直接抛到调用方（多为未处理的 Promise 拒绝），界面既不提示也不刷新；
  // 这里捕获后提示，并保留现有列表/选中相册，避免一次网络抖动把界面清空。
  try {
    const res = await axios.get('/api/album', { headers: authHeaders() })
    albums.value = res.data.data || []
    albumStats.value = res.data.stats || { photo_count: 0, album_count: albums.value.length, total_size: 0 }
    // 保持选中；相册被删则切到第一个
    if (!albums.value.find(a => a.id === activeAlbumId.value)) {
      activeAlbumId.value = albums.value.length ? albums.value[0].id : null
    }
    if (activeAlbumId.value) await loadPhotos(first)
  } catch (e) {
    reportError(e, { action: '加载相册列表' })
    console.error(e)
  }
}

// 标题栏体积显示：不足 1MB 用 KB，其余按 MB / GB（保留一位小数）
function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

// 拆成「数字 + 单位」两部分，单位与照片 / 相册的标签同字号
const sizeParts = computed(() => {
  const [value, unit = 'KB'] = formatSize(albumStats.value.total_size).split(' ')
  return { value, unit }
})

// 照片列表请求序号：切换相册/刷新时先发的请求可能后到，旧相册的照片不能写进新相册（B06-07）
const photosSeq = useSeq()

async function loadPhotos(first = true) {
  const my = photosSeq.take()
  if (!activeAlbumId.value) { groups.value = []; return }
  try {
    const res = await axios.get(`/api/album/${activeAlbumId.value}/photos`, { headers: authHeaders() })
    // 期间已切到别的相册（或又刷新了一次）：这批照片已过期，丢弃
    if (!photosSeq.isLatest(my)) return
    groups.value = res.data.data || []
    if (first) {
      // 切换相册/刷新后回到顶部并重新计量
      await nextTick()
      resetTimeline()
    }
    // 照片列表换新了 → 立即触发一次批量预取（不等滚动）
    refreshThumbBatch()
  } catch (e) {
    // 照片接口的失败在这里统一处理，避免被调用方误报成「相册列表加载失败」
    if (!photosSeq.isLatest(my)) return
    reportError(e, { action: '加载照片' })
    console.error(e)
  }
}

function selectAlbum(id) {
  // 切相册时清空多选：不同相册的照片 id 不能混在一起移动
  if (activeAlbumId.value !== id) exitSelectMode()
  if (activeAlbumId.value !== id) {
    // 换了相册 → 旧的 objectURL 全作废（照片 id 不同，留着会显示错图）
    clearThumbBatch()
  }
  activeAlbumId.value = id
  // loadPhotos 内部已捕获并提示，这里不需要再包一层 catch
  loadPhotos()
}

// 相册 tab 点卡片：切到时间轴，只看这个相册的照片（按日期分组排列）
function openAlbum(a) {
  activeTab.value = 'timeline'
  if (activeAlbumId.value === a.id) {
    // 已经是当前相册：只需回到顶部
    nextTick(() => resetTimeline())
  } else {
    selectAlbum(a.id)
  }
}

// 切换 Tab 后时间轴容器重新挂载，需要重新计量并恢复滚动位置
// （两个视图的多选对象不同，切换时统一退出多选）
watch(activeTab, async (v) => {
  exitSelectMode()
  if (v !== 'timeline') return
  await nextTick()
  measure()
  const el = containerRef.value
  if (el) el.scrollTop = scrollTop.value
})

// 跨页定位：/album?focus=<相册id>
const inst = getCurrentInstance()
function applyFocus() {
  applyRouteRowFocus(inst.proxy, {
    parse: (key) => {
      const id = Number(key)
      if (!albums.value.some((a) => a.id === id)) return null
      // 定位到某个相册时直接落在时间轴上，避免停在卡片列表看不出效果
      activeTab.value = 'timeline'
      if (activeAlbumId.value !== id) selectAlbum(id)
      return key
    },
  })
}

function openNewAlbum() {
  newAlbumMounted.value = true
  newAlbumVisible.value = true
}

// 新建成功：刷新列表并选中新相册（文件夹相册由 scanWatch 边扫边出图）
async function onAlbumCreated(id) {
  exitSelectMode()
  await loadAlbums(false)
  if (id) {
    activeAlbumId.value = id
    await loadPhotos(true)
  }
  // 踢一脚观察器立即探测：新相册的首次全量扫描马上进入快刷，不用等空闲周期
  scheduleScanWatch(0)
}

function openManage() {
  manageMounted.value = true
  showManage.value = true
}

// 任务管理：后台扫描任务（含软件自动发起的）都在这里看进度/停止，「更新文件夹照片」也在这个弹窗里
function openTask() {
  taskMounted.value = true
  showTask.value = true
}

function openExport() {
  exportMounted.value = true
  exportVisible.value = true
}

// 管理弹窗里增删/排序/扫描完成：重新拉列表与照片（不清滚动位置）
async function onAlbumsChanged() {
  await loadAlbums(false)
  await nextTick()
  measure()
}

// Ctrl+Z 撤销 / Ctrl+Shift+Z、Ctrl+Y 重做相册排序、相册增删与删除照片
// —— 撤销/重做后统一重载相册列表与当前相册照片，并拉取后台异步结果
useUndoShortcut('album', {
  onAfterUndo: async (label) => {
    await loadAlbums(false)
    useNotification().success(label ? `已撤销：${label}` : '已撤销')
  },
  onAfterRedo: async (label) => {
    await loadAlbums(false)
    // 重做（如重新加入文件夹）已在后端触发增量扫描，scanWatch 会让照片渐进显示
    pollScan()
    useNotification().success(label ? `已重做：${label}` : '已重做')
  }
})

async function refreshAll() {
  if (!activeAlbumId.value) return
  busyScan.value = true
  const isVirtual = activeAlbumIsVirtual.value
  try {
    // 虚拟相册没有文件夹，不能走增量扫描；后端按相册类型自行分流
    // （kind='virtual' → 只按已有索引更新拍摄时间与缩略图，不遍历磁盘、不增删行）。
    // 这里仍传 mode，后端优先看 kind。
    await axios.post(`/api/album/${activeAlbumId.value}/rescan`, { mode: 'incremental' }, { headers: authHeaders() })
    useNotification().info(isVirtual ? '已开始更新虚拟相册的照片信息…' : '已开始增量更新照片索引…')
    // 踢一脚观察器立即探测，扫描马上进入快刷
    scheduleScanWatch(0)
    await pollScan()
    await loadAlbums()
    useNotification().success(isVirtual ? '虚拟相册已更新' : '照片索引已更新')
  } catch (err) {
    reportError(err, { action: '刷新' })
  } finally { busyScan.value = false }
}

// 渐进刷新统一由下面的 scanWatch 常驻观察器负责（任何入口发起的扫描都能兜住），
// 这里只负责「等到当前相册扫描结束」，供刷新按钮做完成提示。
function pollScan() {
  return waitScan(activeAlbumId.value)
}

/* ===== 扫描渐进刷新常驻观察器（扫描一点、显示一点）=====
 * 后台扫描是异步任务；以前只有「顶部刷新」等个别入口挂了轮询，新建相册、
 * 任务管理弹窗发起的扫描在页面上毫无动静，只能切走再切回才看到新照片。
 * 改成常驻观察器统一兜住所有入口：
 *   - 有扫描在跑 → 按 800ms（与 useAlbumScan 同节奏）重拉相册与当前照片；
 *   - 空闲 → 3s 低频探一次 /api/album/tasks，发现新扫描立即进入快节奏。
 * 页面被 KeepAlive 缓存时停表（onDeactivated），切回（onActivated）再开。 */
const SCAN_BUSY_MS = 800
const SCAN_IDLE_MS = 3000
let scanWatchTimer = 0
// 上一轮「当前相册是否有扫描在跑」：用于扫完瞬间补拉最后一次，
// 否则任务从 /tasks 消失的那轮不刷新，尾巴上的照片就丢了。
let scanWatchActiveRunning = false
// 停表标志：stopScanWatch 里的 clearTimeout 对**已经触发、正在 await** 的那次 tick 无效。
// 没有这个标志时，tick 从 await 回来后照样执行到末尾的 scheduleScanWatch —— 定时器复活，
// 组件 deactivated 甚至卸载后仍每 3s 轮询 /tasks 并写已卸载组件的状态。
let scanWatchStopped = false

async function scanWatchTick() {
  if (scanWatchStopped) return
  let running = []
  try {
    const res = await axios.get('/api/album/tasks', { headers: authHeaders() })
    running = (res.data.data || []).filter(t => t.scanning && !t.cancelled)
  } catch (_) {
    running = []
  }
  // await 期间可能已被停表（切走页面/卸载）：此时不能再写状态、更不能重新排定
  if (scanWatchStopped) return
  const activeRunning = running.some(t => t.albumId === activeAlbumId.value)
  // 本册在扫 → 本轮刷新；本册刚从「在扫」转「扫完」→ 补拉收尾
  if (activeRunning || (scanWatchActiveRunning && !activeRunning)) {
    await loadAlbums(false).catch(() => {})
    if (scanWatchStopped) return // 这第二个 await 之后同样要重新判断
  }
  scanWatchActiveRunning = activeRunning
  scheduleScanWatch(running.length ? SCAN_BUSY_MS : SCAN_IDLE_MS)
}

function scheduleScanWatch(ms) {
  if (scanWatchStopped) return
  clearTimeout(scanWatchTimer)
  scanWatchTimer = setTimeout(scanWatchTick, ms)
}

function startScanWatch() {
  if (scanWatchTimer) return
  scanWatchStopped = false
  // 立即探一次：进页面/切回来就能接上正在跑的扫描
  scheduleScanWatch(0)
}

function stopScanWatch() {
  scanWatchStopped = true
  clearTimeout(scanWatchTimer)
  scanWatchTimer = 0
  scanWatchActiveRunning = false
}

function openFolderViewer() {
  if (!viewer.value) return
  // 从 viewer 的 file_path 提取目录
  const fp = viewer.value.file_path || ''
  const idx = Math.max(fp.lastIndexOf('\\'), fp.lastIndexOf('/'))
  if (idx === -1) { useNotification().error('无法获取文件路径'); return }
  const dir = fp.substring(0, idx)
  if (!window.electron || typeof window.electron.invoke !== 'function') {
    useNotification().warning('请使用桌面客户端打开文件夹')
    return
  }
  window.electron.invoke(INVOKE.OPEN_FOLDER, dir).catch(() => useNotification().error('打开文件夹失败'))
}

// 当前相册的扁平照片列表（按日期分组展开），用于上下张切换
const allPhotos = computed(() => {
  const arr = []
  for (const g of groups.value) arr.push(...(g.photos || []))
  return arr
})

/* ===== 时间轴多选（长按或工具栏「多选」按钮进入）与「移动到相册」 =====
 * 长按照片 400ms 进入多选（与 GridView 的长按阈值一致）：按住的那张自动勾选，
 * 也可以点工具栏「多选」直接进入、再点照片切换勾选；多选态下单击照片不再打开查看器。
 * 多选只持有照片索引 id；移动时后端只改 album_photos 索引，绝不移动/修改磁盘文件。 */
const LONG_PRESS_MS = 400
const LONG_PRESS_TOLERANCE = 10
const selectMode = ref(false)
const selectedIds = ref(new Set())
let pressTimer = 0
let pressOrigin = null
// 长按触发后紧跟的那次 click 只用于收尾，不再当作「查看照片」
let suppressClick = false

const selectedCount = computed(() => selectedIds.value.size)
const selectedPhotoIds = computed(() => [...selectedIds.value])

/* ===== 相册视图多选（仅虚拟相册可参与合并） =====
 * 文件夹相册代表磁盘目录，合并会破坏它与目录的对应关系，因此不可勾选/合并。 */
const selectedAlbumIds = ref(new Set())
const selectedAlbumCount = computed(() => selectedAlbumIds.value.size)
const merging = ref(false)

function isAlbumSelected(id) { return selectedAlbumIds.value.has(id) }
function toggleAlbumSelect(id) {
  const next = new Set(selectedAlbumIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedAlbumIds.value = next
}
// 相册卡片点击：多选态下切换勾选（文件夹相册提示不可合并），否则正常打开时间轴
function onAlbumCardClick(a) {
  if (!selectMode.value) { openAlbum(a); return }
  if (a.kind !== 'virtual') { useNotification().info('文件夹相册不能参与合并，请选择虚拟相册'); return }
  toggleAlbumSelect(a.id)
}

// 合并选中的虚拟相册：后端合成一个新虚拟相册并删除源相册（只动索引，不碰磁盘文件）
async function mergeSelectedAlbums() {
  const ids = [...selectedAlbumIds.value]
  if (ids.length < 2) { useNotification().info('请至少选择两个虚拟相册'); return }
  merging.value = true
  try {
    const res = await axios.post('/api/album/merge', { album_ids: ids }, { headers: authHeaders() })
    exitSelectMode()
    await loadAlbums()
    useNotification().success(res.data?.message || '相册已合并')
  } catch (err) {
    reportError(err, { action: '合并相册' })
  } finally {
    merging.value = false
  }
}

function isSelected(id) { return selectedIds.value.has(id) }

function enterSelectMode(id) {
  selectMode.value = true
  if (id != null) {
    const next = new Set(selectedIds.value)
    next.add(id)
    selectedIds.value = next
  }
}

// 退出多选并清空勾选（切相册、切视图、移动/合并完成时调用）
function exitSelectMode() {
  if (!selectMode.value && selectedIds.value.size === 0 && selectedAlbumIds.value.size === 0) return
  selectMode.value = false
  selectedIds.value = new Set()
  selectedAlbumIds.value = new Set()
}

// 工具栏「多选」按钮：未进入时进入，已在多选时再点一下退出
function toggleSelectMode() {
  if (selectMode.value) exitSelectMode()
  else enterSelectMode()
}

function clearSelection() {
  selectedIds.value = new Set()
  selectedAlbumIds.value = new Set()
}

function selectAllPhotos() {
  const next = new Set()
  for (const p of allPhotos.value) next.add(p.id)
  selectedIds.value = next
  if (next.size) selectMode.value = true
}

function toggleSelect(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function clearPressTimer() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0 }
}

// 按下开始计时：未移动且持续 LONG_PRESS_MS → 进入多选（鼠标/触屏统一走 pointer 事件）
function onCellPointerDown(p, e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  suppressClick = false
  pressOrigin = { x: e.clientX, y: e.clientY }
  clearPressTimer()
  pressTimer = setTimeout(() => {
    pressTimer = 0
    if (selectMode.value) return
    suppressClick = true
    enterSelectMode(p.id)
  }, LONG_PRESS_MS)
}

// 按住后移动超过阈值视为滚动/拖拽，取消长按
function onCellPointerMove(e) {
  if (!pressTimer || !pressOrigin) return
  if (Math.abs(e.clientX - pressOrigin.x) > LONG_PRESS_TOLERANCE || Math.abs(e.clientY - pressOrigin.y) > LONG_PRESS_TOLERANCE) clearPressTimer()
}

function onCellPointerUp() {
  clearPressTimer()
  pressOrigin = null
}

function onCellClick(p) {
  if (suppressClick) { suppressClick = false; return }
  if (selectMode.value) { toggleSelect(p.id); return }
  viewPhoto(p)
}

function openMove() {
  if (!selectedCount.value) {
    useNotification().warning('请先选择要移动的照片')
    return
  }
  moveMounted.value = true
  moveVisible.value = true
}

// 移动完成：清空多选 → 重拉相册列表（数量变化）与当前相册照片（来源是虚拟相册时会变少）
async function onPhotosMoved() {
  moveVisible.value = false
  exitSelectMode()
  await loadAlbums(false)
  await nextTick()
  measure()
}

// ---- 查看器操作 ----
function viewPhoto(p) {
  rotation.value = 0
  zoom.value = 1
  // 视频状态复位
  currentTime.value = 0
  duration.value = 0
  playing.value = false
  playbackRate.value = 1
  dragging.value = false
  viewer.value = { ...p, _rot: 0 }
}
// 在扁平列表中平移当前项，首尾循环
function stepPhoto(dir) {
  const list = allPhotos.value
  if (!list.length || !viewer.value) return
  const idx = list.findIndex(p => p.id === viewer.value.id)
  if (idx === -1) return
  viewPhoto(list[(idx + dir + list.length) % list.length])
}
function prevPhoto() { stepPhoto(-1) }
function nextPhoto() { stepPhoto(1) }
function rotate(dir) {
  if (!viewer.value) return
  viewer.value._rot = ((viewer.value._rot + dir * 90) % 360 + 360) % 360
}
function zoomIn() { zoom.value = Math.min(5, zoom.value + 0.25) }
function zoomOut() { zoom.value = Math.max(0.2, zoom.value - 0.25) }
function resetView() {
  if (viewer.value) { viewer.value._rot = 0 }
  zoom.value = 1
}
function onZoomWheel(e) {
  zoom.value = Math.min(5, Math.max(0.2, zoom.value + (e.deltaY < 0 ? 0.1 : -0.1)))
}
function closeViewer() { viewer.value = null }

// ---- 视频控制 ----
function onLoadedmetadata() {
  const v = videoEl.value
  if (!v) return
  duration.value = v.duration || 0
  currentTime.value = v.currentTime || 0
}
function onTimeupdate() {
  const v = videoEl.value
  if (!v || dragging.value) return
  currentTime.value = v.currentTime || 0
}
function togglePlay() {
  const v = videoEl.value
  if (!v) return
  if (v.paused) {
    v.play()
  } else {
    v.pause()
  }
}
function skip(sec) {
  const v = videoEl.value
  if (!v) return
  const max = v.duration || 0
  v.currentTime = Math.max(0, Math.min(max, (v.currentTime || 0) + sec))
  currentTime.value = v.currentTime || 0
}
function onSeekInput(e) {
  const v = videoEl.value
  if (!v) return
  const t = Number(e.target.value) || 0
  v.currentTime = t
  currentTime.value = t
}
function changeRate() {
  const v = videoEl.value
  if (v) v.playbackRate = playbackRate.value
}

async function saveAs(p) {
  try {
    // 触发浏览器下载（另存为）
    const resp = await axios.get(`/api/album/photo/${p.id}/save-as`, { headers: authHeaders(), responseType: 'blob' })
    const url = URL.createObjectURL(resp.data)
    const a = document.createElement('a')
    a.href = url
    a.download = p.file_name
    a.click()
    URL.revokeObjectURL(url)
    useNotification().success('已开始另存')
  } catch (err) {
    reportError(err, { action: '另存' })
  }
}

async function deletePhoto(p) {
  if (!confirm(`确定把「${p.file_name}」移入回收站吗？（可撤销还原）`)) return
  try {
    await axios.delete(`/api/album/photo/${p.id}`, { headers: authHeaders() })
    // 记录「删除照片」撤销：undo 从回收站搬回文件+还原索引，redo 再次移入回收站
    pushUndo({
      key: 'album',
      type: 'photo_trash',
      label: `删除照片：${p.file_name}`,
      payload: {
        photo: { id: p.id, album_id: activeAlbum.value?.id, file_path: p.file_path, file_name: p.file_name, file_size: p.file_size, mtime: p.mtime, photo_date: p.photo_date, exif_date: p.exif_date, date_src: p.date_src }
      }
    }).catch((e) => {
      // 照片已经删掉了，只是撤销记录没登记上：提示仍说「已移入回收站」（没承诺可撤销），
      // 但控制台要留下原因，否则用户回头发现撤不回去时无从排查。
      console.warn('[undo] 删除照片的撤销记录登记失败（本次删除将不可撤销）', e)
    })
    viewer.value = null
    useNotification().success('已移入回收站')
    loadPhotos()
  } catch (err) {
    reportError(err, { action: '删除' })
  }
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  await loadAlbums()
  await nextTick()
  measure()
  applyFocus()
  // 扫描渐进刷新观察器：任何入口发起的扫描都边扫边刷
  startScanWatch()
})

onActivated(() => {
  applyFocus()
  // KeepAlive 首次挂载也会触发 activated；startScanWatch 幂等，重复调用无害
  startScanWatch()
})
watch(() => inst.proxy.$route.query.focus, applyFocus)

// 被 KeepAlive 缓存时定时器要停（见 scanWatch 注释），否则切走后仍在发请求
onDeactivated(stopScanWatch)

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  // 清理所有轮询定时器，避免页面切走后仍在发请求
  stopAll()
  stopScanWatch()
  // 长按手势的定时器也要清：卸载后再触发会去操作已经不存在的组件状态
  clearPressTimer()
})
</script>

<style scoped>
/* ===== 网格窗口化虚拟滚动 =====
 * 外层以“日期分组”为窗口单元做 JS 虚拟滚动（只挂载视口附近分组），
 * 可视区内的格子数量本来就有限，故格子本身不再加 content-visibility：
 * 它会把格子拆成独立光栅层，和毛玻璃主题的 backdrop-filter 叠加时
 * 容易出现「图片清晰但显示发虚」（层按 1x 光栅化再按 DPR 放大）。 */

/* 悬停压暗遮罩：故意不用 inset-0 / bg-black/* 这组工具类——
   全局 utilities.css 里有一条「弹窗遮罩模糊」规则用 [class*="inset-0"][class*="bg-black/"]
   做匹配，会把这种内容层遮罩也当成弹窗遮罩，加上 backdrop-filter: blur(18px)，
   导致遮罩下面的照片整张被虚化（这才是「缩略图怎么调都糊」的真凶）。 */
.photo-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: transparent;
  transition: background-color 0.2s ease;
  pointer-events: none;
}
.group:hover .photo-mask {
  background-color: rgba(0, 0, 0, 0.18);
}

/* 多选态：选中格子的高亮遮罩（与「选择照片」弹窗同一套观感）。
   选择器叠到与 hover 规则同等特异度并写在后面，保证选中色不被 hover 压掉。 */
.group .photo-mask.photo-mask--sel {
  background-color: color-mix(in srgb, var(--color-info, #38bdf8) 18%, transparent);
}

/* 隐藏相册主列表滚动条（滚动能力保留） */
.album-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.album-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
}

/* ===== 多选浮窗：只在竖直方向弹入（过冲回弹，与表格新增行同一曲线、方向相反） =====
   水平居中由外层 -translate-x-1/2 负责，动画只动内层 transform，避免水平位移 */
.select-float-enter-active {
  transition: opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.select-float-enter-active .select-float-panel {
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
/* 退出：沿进入方向对称返回，向下加速淡出（时长略短于进入） */
.select-float-leave-active {
  transition: opacity 0.12s cubic-bezier(0.5, 0, 0.85, 0.3);
}
.select-float-leave-active .select-float-panel {
  transition: transform 0.12s cubic-bezier(0.5, 0, 0.85, 0.3);
}
.select-float-enter-from,
.select-float-leave-to {
  opacity: 0;
}
.select-float-enter-from .select-float-panel,
.select-float-leave-to .select-float-panel {
  transform: translateY(18px);
}

/* ===== 媒体预览动画：淡入 + 缩放（从较明显放大到原始） ===== */
.preview-enter-active {
  transition: opacity 0.35s ease;
}
.preview-enter-active .preview-media {
  animation: previewMediaIn 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.preview-leave-active {
  transition: opacity 0.22s ease;
}
.preview-enter-from,
.preview-leave-to {
  opacity: 0;
}
.preview-leave-active .preview-media {
  animation: previewMediaOut 0.22s ease forwards;
}
@keyframes previewMediaIn {
  0% {
    opacity: 0;
    transform: scale(0.82);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes previewMediaOut {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.9);
  }
}
</style>
