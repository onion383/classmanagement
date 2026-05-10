<template>
  <table class="w-full border-collapse mt-2">
    <thead>
      <tr>
        <th
          v-for="field in fields"
          :key="field.name"
          @contextmenu.prevent="$emit('contextmenu', $event, 'header', field)"
          class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center cursor-context-menu select-none"
        >
          <div class="flex items-center justify-center gap-1">
            <span @click.stop="$emit('search', field.name)" class="cursor-pointer">
              {{ field.name === 'id' ? 'ID' : field.name }}
            </span>
            <span class="flex flex-col text-xs cursor-pointer" @click.stop="$emit('toggleSort', field.name)">
              <span :class="sortField === field.name && sortOrder === 'asc' ? 'text-yellow-300' : 'text-gray-300'">▲</span>
              <span :class="sortField === field.name && sortOrder === 'desc' ? 'text-yellow-300' : 'text-gray-300'">▼</span>
            </span>
          </div>
        </th>
        <th class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center">操作</th>
      </tr>
    </thead>
    <tbody>
      <!-- 新行 -->
      <tr v-if="newRow" ref="newRowRef" @contextmenu.prevent="$emit('contextmenu', $event, 'newRow', newRow)">
        <td v-for="field in fields" :key="field.name" class="border border-gray-300 px-2 py-1 text-center">
          <template v-if="field.name === 'id'">自动</template>
          <template v-else-if="field.name === 'position'">-</template>
          <input
            v-else
            :value="newRow[field.name]"
            @input="$emit('updateNewRow', field.name, $event.target.value)"
            class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-transparent bg-yellow-50 focus:border-green-400 focus:outline-none box-border"
            :placeholder="field.name"
          />
        </td>
        <td class="border border-gray-300 px-2 py-1 text-center whitespace-nowrap">
          <button @click="$emit('saveNewRow')" class="bg-blue-500 text-white border-none py-0.5 px-2 mr-1 cursor-pointer rounded">保存</button>
          <button @click="$emit('cancelNewRow')" class="bg-gray-400 text-white border-none py-0.5 px-2 cursor-pointer rounded">取消</button>
        </td>
      </tr>

      <!-- 数据行 -->
      <tr
        v-for="(row, index) in rows"
        :key="row._rowKey"
        @contextmenu.prevent="$emit('contextmenu', $event, 'row', row)"
      >
        <td v-for="field in fields" :key="field.name" class="border border-gray-300 px-2 py-1 text-center">
          <template v-if="field.name === 'id'">{{ row.id }}</template>
          <template v-else-if="field.name === 'position'">{{ row._displayIndex }}</template>
          <template v-else>
            <input
              v-if="isEditing(row, field.name)"
              v-model="row[field.name]"
              @blur="$emit('saveCell', row, field)"
              @keyup.enter="$emit('saveCell', row, field)"
              @click.stop
              class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-transparent bg-yellow-50 focus:border-green-400 focus:outline-none box-border"
            />
            <span
              v-else
              @dblclick="$emit('startEdit', row, field)"
              class="block w-full min-h-[24px] leading-6 px-1 cursor-default"
            >{{ row[field.name] != null ? row[field.name] : '' }}</span>
          </template>
        </td>
        <td class="border border-gray-300 px-2 py-1 text-center whitespace-nowrap">
          <button @click="$emit('moveRow', row, 'up')" class="bg-gray-400 text-white border-none py-0.5 px-1.5 mr-0.5 cursor-pointer rounded" title="上移">↑</button>
          <button @click="$emit('moveRow', row, 'down')" class="bg-gray-400 text-white border-none py-0.5 px-1.5 mr-0.5 cursor-pointer rounded" title="下移">↓</button>
          <button @click="$emit('deleteRow', row.id)" class="bg-red-500 text-white border-none py-0.5 px-2 cursor-pointer rounded">删除</button>
        </td>
      </tr>

      <!-- 底部添加提示 -->
      <tr v-if="!newRow" class="bg-gray-50 cursor-pointer" @click="$emit('addNewRowAtBottom')">
        <td :colspan="fields.length + 1" class="text-center py-2 text-green-500 font-medium">
          ＋ 点击添加一行
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script>
export default {
  name: 'DynamicTable',
  props: {
    fields: Array,
    rows: Array,
    newRow: Object,
    sortField: String,
    sortOrder: String,
    editingCell: Object,
  },
  emits: [
    'contextmenu', 'search', 'toggleSort',
    'saveNewRow', 'cancelNewRow',
    'startEdit', 'saveCell',
    'moveRow', 'deleteRow', 'addNewRowAtBottom',
    'updateNewRow',
  ],
  methods: {
    isEditing(row, fieldName) {
      if (!this.editingCell) return false;
      return this.editingCell.rowKey === row._rowKey && this.editingCell.field === fieldName;
    },
  },
};
</script>