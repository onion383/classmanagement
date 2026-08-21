<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <h1 class="text-2xl font-bold text-text">ℹ️ 关于</h1>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- 应用信息 -->
      <div class="bg-surface shadow-md rounded-xl border border-border p-6 md:col-span-2">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-3xl">🏫</div>
          <div>
            <div class="text-xl font-bold text-text">校园助手</div>
            <div class="text-sm text-text-muted">班级管理一站式桌面应用</div>
          </div>
        </div>
        <p class="text-text-secondary text-sm leading-relaxed">
          校园助手是一个面向班级日常管理的轻量化桌面应用，整合了班级管理、班费、课程表、座位安排、
          请假考勤、班级相册等常用功能，帮助班主任与班委高效完成日常事务。
        </p>

        <div class="grid grid-cols-2 gap-x-6 gap-y-3 mt-6 text-sm">
          <div class="flex justify-between text-text-secondary">
            <span>当前版本</span>
            <span class="text-text">v1.0.0</span>
          </div>
          <div class="flex justify-between text-text-secondary">
            <span>应用类型</span>
            <span class="text-text">Electron 桌面应用</span>
          </div>
          <div class="flex justify-between text-text-secondary">
            <span>前端框架</span>
            <span class="text-text">Vue 3 + Tailwind CSS</span>
          </div>
          <div class="flex justify-between text-text-secondary">
            <span>后端技术</span>
            <span class="text-text">Node.js + Express + SQLite</span>
          </div>
        </div>
      </div>

      <!-- 功能特性 -->
      <div class="bg-surface shadow-md rounded-xl border border-border p-6">
        <h2 class="font-semibold text-text mb-4">功能特性</h2>
        <ul class="space-y-3 text-sm text-text-secondary">
          <li class="flex items-center gap-2">
            <span class="text-primary">✔</span> 班级成员管理
          </li>
          <li class="flex items-center gap-2">
            <span class="text-primary">✔</span> 班费收支记账与导出
          </li>
          <li class="flex items-center gap-2">
            <span class="text-primary">✔</span> 课程表与座位可视化
          </li>
          <li class="flex items-center gap-2">
            <span class="text-primary">✔</span> 请假审批与考勤
          </li>
          <li class="flex items-center gap-2">
            <span class="text-primary">✔</span> 班级相册与桌面小组件
          </li>
        </ul>
      </div>
    </div>

    <div class="text-center text-xs text-text-muted mt-8">
      校园助手 © 2026 · 让班级管理更简单
    </div>
  </div>
</template>

<script setup>
</script>