<template>
  <div class="w-60 bg-gray-800 text-white min-h-screen p-4">
    <h2 class="text-lg font-bold mb-6">📋 校园助手</h2>
    <nav class="space-y-2">
      <router-link to="/" class="block px-3 py-2 rounded hover:bg-gray-700 transition-colors" active-class="bg-gray-700">
        📚 班级管理
      </router-link>
      <router-link to="/fee" class="block px-3 py-2 rounded hover:bg-gray-700 transition-colors" active-class="bg-gray-700">
        💰 班费管理
      </router-link>
    </nav>
  </div>
</template>