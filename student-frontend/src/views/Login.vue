<template>
  <div class="flex justify-center items-center h-screen">
    <form @submit.prevent="login" class="bg-surface p-6 rounded shadow-card w-80">
      <h2 class="text-xl font-bold mb-4">班级管理系统登录</h2>
      <input v-model="username" placeholder="账号" class="border p-2 w-full mb-2" />
      <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" class="border p-2 w-full mb-4" />
      <button type="submit" class="bg-info text-text-inverse px-4 py-2 rounded w-full">登录</button>
    </form>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  data() {
    return { username: '', password: '' };
  },
  methods: {
    async login() {
      try {
        const res = await axios.post('/api/login', { username: this.username, password: this.password });
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('currentUser', JSON.stringify(res.data.user));
        this.$router.push('/');  // 成功后跳转到主页
      } catch (err) {
        alert(err.response?.data?.error || '登录失败');
      }
    }
  }
};
</script>