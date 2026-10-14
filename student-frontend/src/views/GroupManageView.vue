<template>
  <div class="h-full flex flex-col">
    <!-- 顶部标题栏（与其他页面统一） -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="group" /> 分组管理</h1>
    </div>

    <!-- 维度 tab 切换（用 Tabs 组件） + 添加组 -->
    <Tabs :tabs="dimTabs" :model-value="activeDimId || ''" @update:model-value="onTab">
      <template #extra>
        <button @click="openAddDim" class="px-4 py-2 text-sm rounded-xl bg-primary text-text-inverse transition-theme hover:bg-primary-hover">+ 添加组</button>
      </template>
    </Tabs>

    <!-- 小组管理标题 + 操作按钮行（预留固定高度，避免 v-if 按钮加载后填充/换行引起下方位移/CLS） -->
    <h2 class="text-xl font-semibold text-text mb-4 flex items-center gap-2 min-h-7"><IconGlyph name="box" :size="20" /> 小组管理</h2>
    <div class="flex flex-nowrap items-center gap-3 mb-4 overflow-x-auto">
      <button v-if="activeDim" @click="openSettings" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5" title="当前维度设置"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
      <button v-preload="loadSmartGroupDialog" @click="onSmartGroup" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">🧠 智能分组</button>
      <button @click="loadAll" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh">
        <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
      </button>
      <button v-preload="loadExportExcel" @click="openExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5">
        <IconGlyph name="download" :size="14" tint="current" /> 导出分组
      </button>
    </div>

    <!-- 玻璃面板：仅含小组内容 -->
    <div class="bg-surface shadow-md rounded-xl border border-border px-6 py-5 flex-1 min-h-0 flex flex-col overflow-hidden">

    <!-- 空状态：占满 flex-1 区域，与有数据网格同高，避免 空态↔数据 切换引起 CLS -->
    <div v-if="dimensions.length === 0" class="flex-1 flex flex-col items-center justify-center text-center text-text-muted">
      <p class="text-lg mb-2">还没有任何分组维度</p>
      <p class="text-sm">点击上方「添加组」创建一个分组维度（如：宿舍管理、学习小组）。</p>
    </div>

    <!-- 分组卡片网格 -->
    <div v-else-if="active" class="flex-1 min-h-0 overflow-auto pr-1">
      <div v-if="active.dimension.is_default" class="grid grid-cols-2 gap-x-8 gap-y-5 w-full">
      <!-- 男生/女生两个分区列 -->
      <div v-for="sec in genderSections" :key="sec.title" class="flex flex-col min-w-0">
        <h4 class="text-sm font-semibold text-text mb-3">{{ sec.title }}</h4>
        <div v-if="!sec.groups.length" class="text-text-muted text-sm py-3">暂无{{ sec.title }}</div>
        <div class="flex flex-col gap-4">
          <!-- 单个宿舍小组小表格卡片 -->
          <div
            v-for="g in sec.groups" :key="g.id"
            class="bg-surface rounded-xl border border-border overflow-hidden w-full flex flex-col"
          >
            <div class="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-border">
              <input v-model="g.name" @focus="captureGroupOld(g)" @change="renameGroup(g)" class="bg-transparent text-text font-semibold text-sm w-full mr-2 outline-none focus:bg-bg px-1 py-0.5 rounded" />
              <div class="flex items-center gap-1 flex-shrink-0">
                <button @click="addMember(g)" title="添加成员" class="text-text-secondary hover:text-primary text-base leading-none px-1 cursor-pointer">＋</button>
                <button @click="confirmDeleteGroup(g)" title="删除小组" class="text-text-secondary hover:text-danger text-base leading-none px-1 cursor-pointer">×</button>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-text-muted text-sm border-b border-border">
                    <th class="w-6"></th>
                    <th class="text-left font-medium px-3 py-1.5 w-16 whitespace-nowrap">序号</th>
                    <th class="text-left font-medium px-3 py-1.5">成员</th>
                    <th class="text-left font-medium px-3 py-1.5">备注</th>
                    <th class="w-7"></th>
                  </tr>
                </thead>
                <tbody @dragover.prevent="onMemberDragOver(g, $event)" @drop.prevent="onMemberDrop(g, $event)">
                  <tr
                    v-for="(m, i) in g.members"
                    :key="m._local ? `_${g.id}_${m._local}` : m.id"
                    draggable="true"
                    :data-index="i"
                    @dragstart="onMemberDragStart(g, m, i, $event)"
                    :class="'cursor-grab ' + (i === 0 ? 'bg-info/5 border-b border-border' : 'border-b border-border/60 last:border-0')"
                  >
                    <td class="px-1 w-6 text-center text-text-secondary cursor-grab select-none">⠿</td>
                    <td class="px-3 py-1.5">
                      <span v-if="i === 0" class="text-info font-medium whitespace-nowrap">{{ active.dimension.leader_title || '舍长' }}</span>
                      <span v-else class="text-text-muted tabular-nums">{{ i + 1 }}</span>
                    </td>
                    <td class="px-3 py-1.5">
                      <input v-model="m.member_name" @input="onMemberInput(m, $event)" @focus="captureMemberOld(m)" @keydown="onMemberKeydown(m, $event)" @change="commitMember(m)" :placeholder="i === 0 ? '' : '成员'" :ref="el => setMemberInput(m, el)" :class="'bg-transparent w-full outline-none focus:bg-bg px-1 py-0.5 rounded ' + (i === 0 ? 'text-text font-medium' : 'text-text')" />
                    </td>
                    <td class="px-3 py-1.5">
                      <input v-model="m.remark" @focus="captureMemberOld(m)" @change="commitMember(m)" placeholder="备注" class="bg-transparent text-text-muted w-full outline-none focus:bg-bg px-1 py-0.5 rounded" />
                    </td>
                    <td class="px-1 text-right">
                      <button @click="removeMember(g, m)" title="移除" class="text-text-secondary hover:text-danger leading-none cursor-pointer">×</button>
                    </td>
                  </tr>
                  <tr v-if="g.members.length === 0">
                    <td colspan="5" class="px-3 py-3 text-center text-text-muted text-xs">暂无成员，点击卡片右上角"＋"添加</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 普通维度：单一横排网格 + 添加小组 -->
    <div v-else class="flex flex-wrap gap-4 content-start">
      <div
        v-for="g in active.groups" :key="g.id"
        class="bg-surface rounded-xl border border-border overflow-hidden w-80 flex flex-col"
      >
        <div class="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-border">
          <input v-model="g.name" @focus="captureGroupOld(g)" @change="renameGroup(g)" class="bg-transparent text-text font-semibold text-sm w-full mr-2 outline-none focus:bg-bg px-1 py-0.5 rounded" />
          <div class="flex items-center gap-1 flex-shrink-0">
            <button @click="addMember(g)" title="添加成员" class="text-text-secondary hover:text-primary text-base leading-none px-1 cursor-pointer">＋</button>
            <button @click="confirmDeleteGroup(g)" title="删除小组" class="text-text-secondary hover:text-danger text-base leading-none px-1 cursor-pointer">×</button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-text-muted text-sm border-b border-border">
                <th class="w-6"></th>
                <th class="text-left font-medium px-3 py-1.5 w-16 whitespace-nowrap">序号</th>
                <th class="text-left font-medium px-3 py-1.5">成员</th>
                <th class="text-left font-medium px-3 py-1.5">备注</th>
                <th class="w-7"></th>
              </tr>
            </thead>
            <tbody @dragover.prevent="onMemberDragOver(g, $event)" @drop.prevent="onMemberDrop(g, $event)">
              <tr
                v-for="(m, i) in g.members"
                :key="m._local ? `_${g.id}_${m._local}` : m.id"
                draggable="true"
                :data-index="i"
                @dragstart="onMemberDragStart(g, m, i, $event)"
                :class="'cursor-grab ' + (i === 0 ? 'bg-info/5 border-b border-border' : 'border-b border-border/60 last:border-0')"
              >
                <td class="px-1 w-6 text-center text-text-secondary cursor-grab select-none">⠿</td>
                <td class="px-3 py-1.5">
                  <span v-if="i === 0" class="text-info font-medium whitespace-nowrap">{{ active.dimension.leader_title || '舍长' }}</span>
                  <span v-else class="text-text-muted tabular-nums">{{ i + 1 }}</span>
                </td>
                <td class="px-3 py-1.5">
                  <input v-model="m.member_name" @input="onMemberInput(m, $event)" @focus="captureMemberOld(m)" @keydown="onMemberKeydown(m, $event)" @change="commitMember(m)" :placeholder="i === 0 ? '' : '成员'" :ref="el => setMemberInput(m, el)" :class="'bg-transparent w-full outline-none focus:bg-bg px-1 py-0.5 rounded ' + (i === 0 ? 'text-text font-medium' : 'text-text')" />
                </td>
                <td class="px-3 py-1.5">
                  <input v-model="m.remark" @focus="captureMemberOld(m)" @change="commitMember(m)" placeholder="备注" class="bg-transparent text-text-muted w-full outline-none focus:bg-bg px-1 py-0.5 rounded" />
                </td>
                <td class="px-1 text-right">
                  <button @click="removeMember(g, m)" title="移除" class="text-text-secondary hover:text-danger leading-none cursor-pointer">×</button>
                </td>
              </tr>
              <tr v-if="g.members.length === 0">
                <td colspan="5" class="px-3 py-3 text-center text-text-muted text-xs">暂无成员，点击卡片右上角"＋"添加</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 添加小组卡片 -->
      <button @click="openAddGroup" class="w-80 min-h-[7rem] rounded-xl border-2 border-dashed border-amber-400/60 bg-amber-300/10 text-amber-600 hover:bg-amber-300/20 hover:text-amber-700 hover:border-amber-500 transition-theme grid place-items-center cursor-pointer">
        ＋ 添加小组
      </button>
    </div>
    </div>
    </div><!-- 玻璃面板结束 -->

    <!-- ============ 添加组（新增分组）弹窗 ============ -->
    <Teleport to="body">
    <Transition name="dialog">
    <div v-if="showAddDim" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="showAddDim = false">
      <div class="bg-surface p-6 rounded-xl w-[26rem] shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-4">添加组</h3>
        <p class="text-xs text-text-muted mb-4">添加新的分组维度（如：宿舍管理、学习小组），组合小组并按需初始化。</p>
        <label class="block text-sm text-text-secondary mb-1">组名</label>
        <input v-model="addDimForm.name" placeholder="如：宿舍管理" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" />
        <label class="block text-sm text-text-secondary mb-1">组名排序</label>
        <AppSelect v-model="addDimForm.name_rule" class="w-full" :options="[{value:'custom',label:'自定义'},{value:'cn',label:'第一组，第二组，第三组…'},{value:'num',label:'第1组，第2组，第3组…'},{value:'prefix_cn',label:'{组名} 第一组，{组名} 第二组，{组名} 第三组'},{value:'prefix_num',label:'{组名} 第1组，{组名} 第2组，{组名} 第3组'}]" />
        <p v-if="addDimForm.name_rule !== 'custom'" class="text-xs text-text-muted mb-4 mt-1">初始化小组时将按此规则自动生成组名</p>
        <div v-else class="mb-4"></div>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label class="block text-sm text-text-secondary mb-1">每组人数</label>
            <input v-model.number="addDimForm.members_per_group" type="number" min="0" max="99" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
          </div>
          <div>
            <label class="block text-sm text-text-secondary mb-1">组数</label>
            <input v-model.number="addDimForm.group_count" type="number" min="0" max="50" placeholder="自动初始化小组数" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
          </div>
        </div>
        <label class="block text-sm text-text-secondary mb-1">组长称呼</label>
        <input v-model="addDimForm.leader_title" placeholder="如：宿舍长 / 学习组长，可自行填写" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" />
        <div class="flex justify-end gap-2">
          <button @click="showAddDim = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
          <button @click="submitAddDim" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">确定</button>
        </div>
      </div>
    </div>
    </Transition>
    </Teleport>

    <!-- ============ 分组设置弹窗（只对当前分组维度生效） ============ -->
    <Teleport to="body">
    <Transition name="dialog">
    <div v-if="showSettings && activeDim" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="showSettings = false">
      <div class="bg-surface p-6 rounded-xl w-[26rem] shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-4">分组设置</h3>
        <p class="text-xs text-text-muted mb-4" v-if="activeDim.is_default">内置宿舍组设置：组名不可修改，按 男/女生宿舍数 自动生成对应数量的宿舍。</p>
        <p class="text-xs text-text-muted mb-4" v-else>设置仅对当前分组生效；「组数」增减会自动补充或删除小组。</p>

        <label class="block text-sm text-text-secondary mb-1">组名</label>
        <input v-model="settingsForm.name" :disabled="activeDim.is_default" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4 disabled:opacity-50 disabled:cursor-not-allowed" />

        <!-- 普通维度：组名排序（快速生成/重命名组名） -->
        <template v-if="!activeDim.is_default">
          <label class="block text-sm text-text-secondary mb-1">组名排序</label>
          <AppSelect v-model="settingsForm.name_rule" class="w-full" :options="[{value:'custom',label:'自定义'},{value:'cn',label:'第一组，第二组，第三组…'},{value:'num',label:'第1组，第2组，第3组…'},{value:'prefix_cn',label:'{组名} 第一组，{组名} 第二组，{组名} 第三组'},{value:'prefix_num',label:'{组名} 第1组，{组名} 第2组，{组名} 第3组'}]" />
          <p v-if="settingsForm.name_rule !== 'custom'" class="text-xs text-text-muted mb-4 mt-1">保存后按此规则自动生成/重命名现有小组组名</p>
          <div v-else class="mb-4"></div>
        </template>

        <!-- 内置宿舍组：每组人数 + 男/女生宿舍数 -->
        <template v-if="activeDim.is_default">
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-sm text-text-secondary mb-1">每组人数</label>
              <input v-model.number="settingsForm.members_per_group" type="number" min="0" max="99" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
            </div>
            <div></div>
          </div>
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-sm text-text-secondary mb-1">男生宿舍数</label>
              <input v-model.number="settingsForm.male_group_count" type="number" min="0" max="50" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
            </div>
            <div>
              <label class="block text-sm text-text-secondary mb-1">女生宿舍数</label>
              <input v-model.number="settingsForm.female_group_count" type="number" min="0" max="50" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
            </div>
          </div>
        </template>

        <!-- 普通维度：每组人数 + 组数 -->
        <div v-else class="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label class="block text-sm text-text-secondary mb-1">每组人数</label>
            <input v-model.number="settingsForm.members_per_group" type="number" min="0" max="99" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
          </div>
          <div>
            <label class="block text-sm text-text-secondary mb-1">组数</label>
            <input v-model.number="settingsForm.group_count" type="number" min="0" max="50" class="border border-border bg-surface text-text px-3 py-2 rounded w-full" />
          </div>
        </div>

        <label class="block text-sm text-text-secondary mb-1">组长称呼</label>
        <input v-model="settingsForm.leader_title" placeholder="如：宿舍长 / 学习组长" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" />
        <div class="flex items-center justify-between gap-2">
          <button
            @click="confirmDeleteDim"
            :disabled="activeDim.is_default"
            class="bg-danger text-white px-4 py-2 rounded transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            :title="activeDim.is_default ? '内置宿舍组不可删除' : ''"
          >删除当前分组</button>
          <div class="flex gap-2">
            <button @click="showSettings = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
            <button @click="submitSettings" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">确定</button>
          </div>
        </div>
      </div>
    </div>
    </Transition>
    </Teleport>

    <!-- ============ 添加小组弹窗 ============ -->
    <Teleport to="body">
    <Transition name="dialog">
    <div v-if="showAddGroup" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="showAddGroup = false">
      <div class="bg-surface p-6 rounded-xl w-96 shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-4">添加小组</h3>
        <p class="text-xs text-text-muted mb-4">在「{{ activeDim?.name }}」维度下新增一个小组。</p>
        <label class="block text-sm text-text-secondary mb-1">小组名字</label>
        <input v-model="addGroupName" placeholder="如：302" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" />
        <div class="flex justify-end gap-2">
          <button @click="showAddGroup = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
          <button @click="submitAddGroup" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">确定</button>
        </div>
      </div>
    </div>
    </Transition>
    </Teleport>

    <!-- ============ 二次确认弹窗 ============ -->
    <Teleport to="body">
    <Transition name="dialog">
    <div v-if="confirmMsg" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10004]" @click.self="confirmMsg = null">
      <div class="bg-surface p-6 rounded-xl w-96 shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-3">确认删除</h3>
        <p class="text-text-secondary mb-4">{{ confirmMsg }}</p>
        <div class="flex justify-end gap-2">
          <button @click="confirmMsg = null" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
          <button @click="doDelete" class="bg-danger text-white px-4 py-2 rounded transition-theme cursor-pointer">删除</button>
        </div>
      </div>
    </div>
    </Transition>
    </Teleport>

    <!-- ============ 组名覆盖确认（复用组件 + 统一动画） ============ -->
    <ConfirmDialog
      v-if="overwriteMounted"
      :visible="overwriteVisible"
      message="检测到部分小组已有自定义组名，是否用当前「组名排序」规则覆盖这些组名？"
      :show-cancel="true"
      @confirm="onOverwriteConfirm"
      @cancel="onOverwriteCancel"
    />

    <!-- ============ 成员姓名自动补全弹层（浮在输入框下方） ============ -->
    <Teleport to="body">
      <div
        v-if="suggestState.visible"
        class="candidate-popup fixed z-[10002] bg-surface border border-info shadow-lg rounded"
        :style="{ left: suggestState.left + 'px', top: suggestState.top + 'px', width: suggestState.width + 'px', maxHeight: '200px', overflow: 'auto' }"
        @mousedown.stop
      >
        <div v-if="suggestedStudents.length > 0">
          <div
            v-for="(s, idx) in suggestedStudents"
            :key="s.id"
            :class="['px-3 py-2 text-sm cursor-pointer hover:bg-info/10 truncate', { 'bg-info/20': idx === suggestState.index }]"
            @mousedown.prevent="fillCandidate(s)"
            @mouseenter="suggestState.index = idx"
          >{{ s.姓名 }}</div>
        </div>
        <div v-else class="px-3 py-2 text-sm text-text-muted">无匹配学生</div>
      </div>
    </Teleport>

    <!-- ============ 智能分组弹窗（仿座位表流水线） ============ -->
    <SmartGroupDialog
      v-if="smartGroupMounted"
      :visible="showSmartGroup"
      :students="allStudents"
      :groups="active?.groups || []"
      :leader-title="activeDim?.leader_title || '组长'"
      @cancel="showSmartGroup = false"
      @confirm="handleSmartGroupResult"
    />

    <!-- ============ 导出弹窗（复用 ExportExcel，选择导出的小组） ============ -->
    <ExportExcel
      v-if="exportMounted"
      :is-visible="exportVisible"
      :rows="[]"
      :fields="[]"
      :default-filename="(activeDim?.name || '分组') + '-分组表'"
      :group-source="groupExportSource"
      @update:is-visible="exportVisible = $event"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick, defineAsyncComponent } from 'vue';
import axios from 'axios';
import Tabs from '../components/base/Tabs.vue';
import AppSelect from '../components/base/AppSelect.vue';
import { useNotification } from '../composables/useNotification';
import { useUndoShortcut } from '../composables/useUndo.js';

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'));
const loadSmartGroupDialog = () => import('../components/dialogs/SmartGroupDialog.vue');
const SmartGroupDialog = defineAsyncComponent(loadSmartGroupDialog);
const loadExportExcel = () => import('../components/import-export/ExportExcel.vue');
const ExportExcel = defineAsyncComponent(loadExportExcel);

const { success, error, info } = useNotification();

const api = (path, options = {}) =>
  fetch(`/api/group-manage${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    ...options,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  });

// 记录分组管理页的单元格撤销：key 统一为 group_manage（便于 Ctrl+Z 连续撤销跨表操作），
// table 为实际数据表名（group_members / groups / group_dimensions），需在 undo.js ALLOWED_TABLES 内。
function recordGroupUndo(table, rowId, field, old, val) {
  try {
    axios.post('/api/undo', {
      key: 'group_manage',
      type: 'cell_update',
      label: `${field}：「${old == null ? '' : old}」→「${val == null ? '' : val}」`,
      payload: { table, rowId, field, oldValue: old, newValue: val }
    }).catch(() => {});
  } catch { /* 撤销记录失败不影响主流程 */ }
}

// 当前维度全量快照（组+成员），用于结构变更撤销对比
function buildGroupSnapshot() {
  return (active.value?.groups || []).map(g => ({
    id: g.id,
    name: g.name,
    gender: g.gender == null ? null : g.gender,
    sort_order: g.sort_order,
    members: (g.members || []).map((m, i) => ({
      id: m.id, member_name: m.member_name, remark: m.remark, sort_order: i + 1
    }))
  }));
}
// 记录一次分组结构变更（增删小组/成员、成员排序、智能分组、小组数量增减等）
function recordGroupStructure(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || JSON.stringify(before) === JSON.stringify(after)) return;
  const dimId = activeDimId.value != null ? Number(activeDimId.value) : active.value?.dimension?.id;
  if (dimId == null) return;
  try {
    axios.post('/api/undo', {
      key: 'group_manage',
      type: 'group_snapshot',
      label: '分组结构变更',
      payload: { dimId, oldValue: before, newValue: after }
    }).catch(() => {});
  } catch { /* 撤销记录失败不影响主流程 */ }
}
useUndoShortcut('group_manage', {
  onAfterUndo: (label) => {
    if (activeDimId.value != null) selectDim(activeDimId.value);
    success(label ? `已撤销：${label}` : '已撤销');
  },
  onAfterRedo: (label) => {
    if (activeDimId.value != null) selectDim(activeDimId.value);
    success(label ? `已重做：${label}` : '已重做');
  }
});

const loading = ref(false);
const dimensions = ref([]);
const activeDimId = ref(null);
const active = ref(null);

const showAddDim = ref(false);
const addDimForm = reactive({ name: '', leader_title: '', members_per_group: 0, group_count: 0, name_rule: 'custom' });
const showSettings = ref(false);
const settingsForm = reactive({ name: '', leader_title: '', members_per_group: 0, group_count: 0, male_group_count: 0, female_group_count: 0, name_rule: 'custom' });
const showAddGroup = ref(false);
const addGroupName = ref('');

// ============ 组名排序：生成规则 ============
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
function cnNum(n) { return CN_NUM[n - 1] || String(n); }
// rule: custom | cn | num | prefix_cn | prefix_num；prefix 为维度名（{组名}）
function buildGroupNames(rule, prefix, count) {
  if (!rule || rule === 'custom' || !count) return null;
  const withPrefix = rule === 'prefix_cn' || rule === 'prefix_num';
  const chinese = rule === 'cn' || rule === 'prefix_cn';
  const names = [];
  for (let i = 1; i <= count; i++) {
    const body = chinese ? `第${cnNum(i)}组` : `第${i}组`;
    names.push(withPrefix ? `${prefix} ${body}` : body);
  }
  return names;
}
async function applyGroupNames(groups, names) {
  if (!names || !groups) return;
  // 并行批量改名（无变化的跳过），比逐个 await 更高效
  await Promise.all(groups.map((g, i) => {
    if (i >= names.length) return;
    if (String(g.name || '') === names[i]) return;
    return api(`/groups/${g.id}`, { method: 'PUT', body: JSON.stringify({ name: names[i] }) });
  }));
}

// ============ 组名覆盖确认 ============
// overwriteMounted 保活：组件首次打开后保持挂载，关闭只降 overwriteVisible，
// 从而让内部 <Transition> 能播放关闭的缩小淡出动画（懒加载不砍动画）
const overwriteMounted = ref(false);
const overwriteVisible = ref(false);
const overwriteInfo = ref(null);

function onOverwriteConfirm() {
  overwriteVisible.value = false;
  const infoObj = overwriteInfo.value;
  overwriteInfo.value = null;
  if (infoObj) doSaveSettings(infoObj.form, infoObj.names);
}
function onOverwriteCancel() {
  overwriteVisible.value = false;
  overwriteInfo.value = null;
}

// ============ 成员姓名自动补全 ============
const allStudents = ref([]);
async function fetchStudents() {
  try {
    const res = await fetch('/api/students', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    allStudents.value = data.data || data || [];
  } catch (e) { /* 学生列表不可用时不阻塞分组功能 */ }
}
const suggestState = reactive({ visible: false, member: null, top: 0, left: 0, width: 0, index: 0, keyword: '' });
let suggestTimer = null;
const MAX_SUGGEST = 50;
const suggestedStudents = computed(() => {
  const kw = (suggestState.keyword || '').toLowerCase().trim();
  const list = allStudents.value;
  if (!kw) return list.slice(0, MAX_SUGGEST);
  const matched = [];
  for (let i = 0; i < list.length && matched.length < MAX_SUGGEST; i++) {
    const s = list[i];
    if (String(s.姓名 || '').toLowerCase().includes(kw)) matched.push(s);
  }
  return matched;
});
function positionSuggest(el) {
  if (!el) return;
  // 用输入框的真实视口坐标定位（Teleport 到 body 后，fixed 相对视口，二者一致）
  const r = el.getBoundingClientRect();
  const w = Math.max(160, r.width);
  const h = 200;
  let x = r.left;
  let y = r.bottom + 2;
  // 防越界：右侧放不下就左移；下方放不下就翻到输入框上方（与座位表填充一致）
  if (x + w > window.innerWidth) x = Math.max(0, window.innerWidth - w - 8);
  if (y + h > window.innerHeight) y = Math.max(0, r.top - h - 2);
  suggestState.left = x;
  suggestState.top = y;
  suggestState.width = w;
}
function onMemberInput(m, e) {
  const el = e.currentTarget;
  const value = e.target.value || '';
  const wasShown = suggestState.visible;
  suggestState.member = m;
  suggestState.index = 0;
  if (!wasShown) {
    // 首次打开：同步应用关键字，且只定位一次（输入框位置在打字过程中不变，无需每次读布局）
    clearTimeout(suggestTimer);
    suggestState.keyword = value;
    suggestState.visible = true;
    nextTick(() => positionSuggest(el));
  } else {
    // 已打开：关键字防抖，避免每次击键全量过滤学生列表
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => { suggestState.keyword = value; }, 120);
  }
}
function onMemberKeydown(m, e) {
  const list = suggestedStudents.value;
  if (e.key === 'Tab' || e.key === 'Enter') {
    if (list.length > 0) { e.preventDefault(); fillCandidate(list[suggestState.index]); }
    return;
  }
  if (e.key === 'ArrowDown') {
    if (list.length > 0) { e.preventDefault(); suggestState.index = (suggestState.index + 1) % list.length; }
    return;
  }
  if (e.key === 'ArrowUp') {
    if (list.length > 0) { e.preventDefault(); suggestState.index = (suggestState.index - 1 + list.length) % list.length; }
    return;
  }
  if (e.key === 'Escape') closeSuggest();
}
function fillCandidate(s) {
  const m = suggestState.member;
  if (!m) return;
  m.member_name = s.姓名 || '';
  closeSuggest();
  commitMember(m);
}
function closeSuggest() {
  clearTimeout(suggestTimer);
  suggestState.visible = false;
  suggestState.member = null;
  suggestState.keyword = '';
}

// Tabs 组件需要 label/value（value 为字符串）
const dimTabs = computed(() => dimensions.value.map(d => ({ value: String(d.id), label: d.name })));
const activeDim = computed(() => (activeDimId.value == null ? null : dimensions.value.find(d => String(d.id) === activeDimId.value) || null));
// 宿舍（内置）维度：按性别拆分为「男生宿舍 / 女生宿舍」两个分区列
const genderSections = computed(() => {
  const d = active.value;
  if (!d || !d.dimension.is_default) return [];
  return [
    { title: '男生宿舍', groups: d.groups.filter(g => g.gender === 0) },
    { title: '女生宿舍', groups: d.groups.filter(g => g.gender === 1) },
  ];
});

async function loadAll() {
  if (loading.value) return;
  loading.value = true;
  try {
    // 已有选中维度：只刷新当前展示的表格，不跳转到第一个 tab
    if (activeDimId.value != null) {
      const data = await api(`/${activeDimId.value}`);
      dimensions.value = data.dimensions || [];
      const dim = data.dimension;
      if (dim) {
        active.value = { dimension: dim, groups: data.groups };
        info(`已刷新「${dim.name}」分组数据`);
      }
      return;
    }
    const data = await api('/bootstrap');
    dimensions.value = data.dimensions || [];
    if (data.active) {
      active.value = data.active;
      activeDimId.value = String(data.active.dimension.id);
    } else {
      active.value = null;
    }
  } catch (e) {
    error(e.message);
  } finally {
    loading.value = false;
  }
}

// 保持选中并刷新维度列表与详情
async function selectDim(id) {
  activeDimId.value = String(id);
  try {
    const data = await api(`/${id}`);
    dimensions.value = data.dimensions || [];
    active.value = { dimension: data.dimension, groups: data.groups };
  } catch (e) {
    error(e.message);
  }
}

function onTab(value) {
  selectDim(value);
}

// ============ 维度 ============
function openAddDim() {
  Object.assign(addDimForm, { name: '', leader_title: '', members_per_group: 0, group_count: 0, name_rule: 'custom' });
  showAddDim.value = true;
}

async function applyAddDimNames(dimId) {
  if (addDimForm.name_rule === 'custom' || !addDimForm.group_count) return;
  const groups = active.value?.groups || [];
  const names = buildGroupNames(addDimForm.name_rule, addDimForm.name, groups.length);
  if (!names) return;
  await applyGroupNames(groups, names);
  await selectDim(dimId);
}

async function submitAddDim() {
  if (!addDimForm.name.trim()) return error('请输入组名');
  addDimForm.members_per_group = Math.min(99, Math.max(0, Number(addDimForm.members_per_group) || 0));
  addDimForm.group_count = Math.min(50, Math.max(0, Number(addDimForm.group_count) || 0));
  try {
    const data = await api('/dimensions', {
      method: 'POST',
      body: JSON.stringify(addDimForm),
    });
    showAddDim.value = false;
    success('添加成功');
    await selectDim(data.id);
    await applyAddDimNames(data.id);
  } catch (e) {
    error(e.message);
  }
}

function openSettings() {
  if (!activeDim.value) return;
  Object.assign(settingsForm, {
    name: activeDim.value.name,
    leader_title: activeDim.value.leader_title,
    members_per_group: activeDim.value.members_per_group,
    group_count: activeDim.value.group_count,
    male_group_count: activeDim.value.male_group_count || 3,
    female_group_count: activeDim.value.female_group_count || 3,
    name_rule: 'custom',
  });
  showSettings.value = true;
}

// 保存维度设置；names 非空时在保存后按规则重命名小组
async function doSaveSettings(form, names) {
  const before = buildGroupSnapshot();
  try {
    // 记录维度纯字段编辑（组名 / 组长称呼），供撤销恢复
    const dim = active.value?.dimension;
    if (dim) {
      if (String(dim.name ?? '') !== String(form.name ?? '')) recordGroupUndo('group_dimensions', dim.id, 'name', dim.name ?? '', form.name ?? '');
      if (String(dim.leader_title ?? '') !== String(form.leader_title ?? '')) recordGroupUndo('group_dimensions', dim.id, 'leader_title', dim.leader_title ?? '', form.leader_title ?? '');
    }
    await api(`/dimensions/${activeDimId.value}`, {
      method: 'PUT',
      body: JSON.stringify(form),
    });
    if (names?.length) await applyGroupNames(active.value?.groups || [], names);
    showSettings.value = false;
    await selectDim(activeDimId.value);
    success('设置已保存');
    recordGroupStructure(before, buildGroupSnapshot());
  } catch (e) {
    error(e.message);
  }
}

async function submitSettings() {
  if (!activeDim.value) return;
  // 内置宿舍组：组名不可改，仅提交每组人数/男女宿舍数/组长称呼
  if (activeDim.value.is_default) {
    settingsForm.members_per_group = Math.min(99, Math.max(0, Number(settingsForm.members_per_group) || 0));
    settingsForm.male_group_count = Math.min(50, Math.max(0, Number(settingsForm.male_group_count) || 0));
    settingsForm.female_group_count = Math.min(50, Math.max(0, Number(settingsForm.female_group_count) || 0));
    const before = buildGroupSnapshot();
    try {
      await api(`/dimensions/${activeDimId.value}`, {
        method: 'PUT',
        body: JSON.stringify({
          leader_title: settingsForm.leader_title,
          members_per_group: settingsForm.members_per_group,
          male_group_count: settingsForm.male_group_count,
          female_group_count: settingsForm.female_group_count,
        }),
      });
      showSettings.value = false;
      await selectDim(activeDimId.value);
      success('设置已保存');
      recordGroupStructure(before, buildGroupSnapshot());
    } catch (e) {
      error(e.message);
    }
    return;
  }
  if (!settingsForm.name.trim()) return error('请输入组名');
  settingsForm.members_per_group = Math.min(99, Math.max(0, Number(settingsForm.members_per_group) || 0));
  settingsForm.group_count = Math.min(50, Math.max(0, Number(settingsForm.group_count) || 0));
  const groups = active.value?.groups || [];
  let names = null;
  if (settingsForm.name_rule !== 'custom' && groups.length > 0) {
    names = buildGroupNames(settingsForm.name_rule, settingsForm.name, groups.length);
    // 检测已有自定义组名（非空且与生成名不一致）→ 弹确认框决定是否覆盖
    const hasCustom = groups.some((g, i) => String(g.name || '').trim() !== '' && g.name !== names[i]);
    if (hasCustom) {
      overwriteInfo.value = { form: JSON.parse(JSON.stringify(settingsForm)), names };
      overwriteMounted.value = true;
      overwriteVisible.value = true;
      return;
    }
  }
  await doSaveSettings(settingsForm, names);
}

// 删除当前维度（入口在设置弹窗；内置宿舍组不可删除）
function confirmDeleteDim() {
  const d = activeDim.value;
  if (!d) return;
  if (d.is_default) return error('内置宿舍组不可删除');
  pendingDelete.value = { type: 'dimension', id: d.id };
  confirmMsg.value = `确定删除维度「${d.name}」吗？其下所有小组与成员将一并删除。`;
}

// ============ 小组 ============
function openAddGroup() {
  addGroupName.value = '';
  showAddGroup.value = true;
}

async function submitAddGroup() {
  if (!addGroupName.value.trim()) return error('请输入小组名字');
  const before = buildGroupSnapshot();
  try {
    await api(`/dimensions/${activeDimId.value}/groups`, {
      method: 'POST',
      body: JSON.stringify({ name: addGroupName.value }),
    });
    showAddGroup.value = false;
    success('添加成功');
    await selectDim(activeDimId.value);
    recordGroupStructure(before, buildGroupSnapshot());
  } catch (e) {
    error(e.message);
  }
}

async function renameGroup(g) {
  if (!g.name.trim()) return error('小组名字不能为空');
  const oldName = g._undoName !== undefined ? g._undoName : g.name;
  if (String(oldName ?? '') !== String(g.name ?? '')) recordGroupUndo('groups', g.id, 'name', oldName ?? '', g.name ?? '');
  g._undoName = undefined;
  try {
    await api(`/groups/${g.id}`, { method: 'PUT', body: JSON.stringify({ name: g.name }) });
  } catch (e) {
    error(e.message);
  }
}

function confirmDeleteGroup(g) {
  pendingDelete.value = { type: 'group', id: g.id };
  confirmMsg.value = `确定删除小组「${g.name}」吗？其成员将一并删除。`;
}

// ============ 成员 ============
// 进入行内编辑：快照当前值，供撤销对比（仅记录一次，避免连续 @input 覆盖）
function captureMemberOld(m) {
  if (m._undoName === undefined) m._undoName = m.member_name;
  if (m._undoRemark === undefined) m._undoRemark = m.remark;
}
function captureGroupOld(g) {
  if (g._undoName === undefined) g._undoName = g.name;
}

function addMember(g) {
  const limit = activeDim.value && activeDim.value.members_per_group;
  if (limit > 0 && g.members.length >= limit) {
    info(`该组人数已达上限 ${limit} 人，无法继续添加`);
    return;
  }
  const m = { _local: Date.now() + Math.random(), _groupId: g.id, member_name: '', remark: '' };
  g.members.push(m);
  lastAdded.value = m;
  nextTick(() => {
    const el = memberInputs.get(m);
    if (el) el.focus();
  });
}

// ============ 成员拖拽排序 / 跨组移动 ============
const memberInputs = new Map();
const lastAdded = ref(null);
// 非响应式：dragover 高频写入，若为响应式会触发整块分组卡片重渲染，故用普通对象
const dragState = { fromMemberId: null, fromGid: null, overGid: null, overIndex: null, pos: 'after' };
// 拖拽落点高亮：命令式增删 class，避免 dropRowClass 进入模板响应式依赖
let _hlRow = null;
let _hlPos = '';
function setDropHighlight(row, pos) {
  if (row === _hlRow && (row ? pos : '') === _hlPos) return;
  if (_hlRow) _hlRow.classList.remove('drop-line', 'drop-before', 'drop-after');
  _hlRow = row || null;
  _hlPos = row ? pos : '';
  if (_hlRow) {
    _hlRow.classList.add('drop-line');
    _hlRow.classList.add(pos === 'before' ? 'drop-before' : 'drop-after');
  }
}

function setMemberInput(m, el) {
  if (el) memberInputs.set(m, el);
  else memberInputs.delete(m);
}

function onMemberDragStart(g, m, index, e) {
  dragState.fromMemberId = m ? m.id : null;
  dragState.fromGid = g.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragState.fromMemberId));
  }
}

// 表体 dragover：定位目标行并计算插入位置（上半 → before，下半 → after；空白处 → 追加到组尾）
function onMemberDragOver(g, e) {
  e.preventDefault();
  if (dragState.fromMemberId == null) return;
  const row = e.target.closest('tr');
  if (row && row.dataset.index !== undefined) {
    const rect = row.getBoundingClientRect();
    dragState.overGid = g.id;
    dragState.overIndex = Number(row.dataset.index);
    dragState.pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    setDropHighlight(row, dragState.pos);
  } else if (g.members.length > 0) {
    // 组内空白处 → 追加到末尾，高亮最后一行下缘
    dragState.overGid = g.id;
    dragState.overIndex = g.members.length - 1;
    dragState.pos = 'after';
    const tb = e.currentTarget;
    const last = tb ? tb.querySelector(`tr[data-index="${g.members.length - 1}"]`) : null;
    setDropHighlight(last, 'after');
  }
}

function onMemberDrop(g, e) {
  e.preventDefault();
  const mid = dragState.fromMemberId;
  const idx = dragState.overIndex;
  const pos = dragState.pos;
  const fromGid = dragState.fromGid;
  clearDrag();
  if (mid == null) return;
  // 跨组拖入且目标组已满 → 阻止，避免超出「每组人数」上限
  const limit = activeDim.value?.members_per_group || 0;
  if (fromGid !== g.id && limit > 0 && g.members.length >= limit) {
    info(`该组人数已达上限 ${limit} 人，无法移入`);
    return;
  }
  // targetIndex = 目标组移动后的最终位置；追加到末尾时用组长总数
  let targetIndex;
  if (idx == null) {
    targetIndex = g.members.length;
  } else {
    targetIndex = pos === 'before' ? idx : idx + 1;
  }
  moveMember(mid, g.id, targetIndex);
}

function clearDrag() {
  dragState.fromMemberId = null;
  dragState.fromGid = null;
  dragState.overGid = null;
  dragState.overIndex = null;
  dragState.pos = 'after';
  setDropHighlight(null, 'after');
}

async function moveMember(memberId, targetGroupId, targetIndex) {
  const before = buildGroupSnapshot();
  try {
    const data = await api('/group-members/move', {
      method: 'POST',
      body: JSON.stringify({ memberId, targetGroupId, targetIndex }),
    });
    dimensions.value = data.dimensions || [];
    if (data.dimension) active.value = { dimension: data.dimension, groups: data.groups };
    recordGroupStructure(before, buildGroupSnapshot());
  } catch (e) {
    error(e.message);
  }
}

// 失焦提交：新成员则创建，已存在成员则更新；空名不落库（删除本地占位行）
async function commitMember(m) {
  if (m.id == null) {
    if (!m.member_name.trim()) {
      return;
    }
    const before = buildGroupSnapshot();
    try {
      const data = await api(`/groups/${m._groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_name: m.member_name, remark: m.remark }),
      });
      m.id = data.id;
      delete m._local;
      await selectDim(activeDimId.value);
      recordGroupStructure(before, buildGroupSnapshot());
    } catch (e) {
      error(e.message);
    }
    return;
  }
  const oldName = m._undoName !== undefined ? m._undoName : m.member_name;
  const oldRemark = m._undoRemark !== undefined ? m._undoRemark : m.remark;
  if (String(oldName ?? '') !== String(m.member_name ?? '')) recordGroupUndo('group_members', m.id, 'member_name', oldName ?? '', m.member_name ?? '');
  if (String(oldRemark ?? '') !== String(m.remark ?? '')) recordGroupUndo('group_members', m.id, 'remark', oldRemark ?? '', m.remark ?? '');
  m._undoName = undefined;
  m._undoRemark = undefined;
  try {
    await api(`/group-members/${m.id}`, {
      method: 'PUT',
      body: JSON.stringify({ member_name: m.member_name, remark: m.remark }),
    });
  } catch (e) {
    error(e.message);
  }
}

function removeMember(g, m) {
  if (m.id == null) {
    g.members = g.members.filter(x => x !== m);
    return;
  }
  doRemoveMember(g, m.id);
}

async function doRemoveMember(g, id) {
  const before = buildGroupSnapshot();
  try {
    await api(`/group-members/${id}`, { method: 'DELETE' });
    await selectDim(activeDimId.value);
    recordGroupStructure(before, buildGroupSnapshot());
  } catch (e) {
    error(e.message);
  }
}

// ============ 删除确认 ============
const confirmMsg = ref(null);
const pendingDelete = ref(null);

async function doDelete() {
  const p = pendingDelete.value;
  if (!p) return;
  const isGroup = p.type === 'group';
  // 仅小组删除做撤销（维度删除不含在内）；快照需基于删除前的维度结构
  const before = isGroup ? buildGroupSnapshot() : null;
  try {
    if (p.type === 'dimension') await api(`/dimensions/${p.id}`, { method: 'DELETE' });
    else await api(`/groups/${p.id}`, { method: 'DELETE' });
    confirmMsg.value = null;
    pendingDelete.value = null;
    showSettings.value = false;
    success('删除成功');
    await loadAll();
    // 小组删除后再拉一次当前维度，确保快照取自最新结构
    if (isGroup) { await selectDim(activeDimId.value); recordGroupStructure(before, buildGroupSnapshot()); }
  } catch (e) {
    error(e.message);
  }
}

// ============ 智能分组入口 ============
// smartGroupMounted 保活：保持挂载以便关闭动画播放
const smartGroupMounted = ref(false);
const showSmartGroup = ref(false);
function onSmartGroup() {
  if (!activeDim.value) return error('请先选择分组维度');
  if (!active.value?.groups?.length) return error('当前维度还没有小组，请先添加小组');
  smartGroupMounted.value = true;
  showSmartGroup.value = true;
}

// 确认写入：清空该维度所有小组成员，按第 i 组写入 result.groups[i]，组长排最前
async function handleSmartGroupResult(result) {
  const groups = result && result.groups;
  if (!Array.isArray(groups)) return;
  const before = buildGroupSnapshot();
  try {
    const data = await api(`/dimensions/${activeDimId.value}/apply-grouping`, {
      method: 'POST',
      body: JSON.stringify({ groups }),
    });
    showSmartGroup.value = false;
    dimensions.value = data.dimensions || [];
    if (data.dimension) active.value = { dimension: data.dimension, groups: data.groups };
    success('智能分组已应用');
    recordGroupStructure(before, buildGroupSnapshot());
  } catch (e) {
    error(e.message);
  }
}

// ============ 导出（复用 ExportExcel 弹窗，选择导出的小组） ============
// exportMounted 保活：保持挂载以便关闭动画播放
const exportMounted = ref(false);
const exportVisible = ref(false);
// 传给导出弹窗的分组数据结构
const groupExportSource = computed(() => {
  if (!active.value) return null;
  return {
    title: `${active.value.dimension.name}-分组表`,
    leaderTitle: active.value.dimension.leader_title || '组长',
    groups: (active.value.groups || []).map(g => ({
      name: g.name,
      members: (g.members || []).map(m => ({ member_name: m.member_name, remark: m.remark }))
    }))
  };
});
async function openExport() {
  if (!active.value || active.value.groups.length === 0) return useNotification().info('暂无小组可导出');
  exportMounted.value = true;
  exportVisible.value = true;
}

onMounted(() => { loadAll(); fetchStudents(); });
</script>

<style scoped>
/* 成员拖拽：虚拟位置反馈线（上/下缘高亮） */
tbody tr[class*="drop-line"] td,
tbody tr.drop-before td,
tbody tr.drop-after td {
  position: relative;
}
tbody tr.drop-before td::before,
tbody tr.drop-after td::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-primary, #3b82f6);
  z-index: 1;
}
tbody tr.drop-before td::before { top: -1px; }
tbody tr.drop-after td::before { bottom: -1px; }

/* 拖动中的行轻微半透明，作为手的反馈 */
tbody tr[class*="drop-line"] { transition: background-color .12s ease; }
</style>