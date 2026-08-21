<template>
  <div class="flex justify-center items-center h-screen login-bg">
    <!-- 登录表单 -->
    <form v-if="mode === 'login'" @submit.prevent="login" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-4">班级管理系统登录</h2>
      <select v-model="role" class="border p-2 w-full mb-2 rounded-xl bg-surface text-text-muted">
        <option value="" disabled>请选择角色</option>
        <option v-for="r in roleOptions" :key="r.value" :value="r.value">
          {{ r.label }}
        </option>
      </select>
      <input v-model="username" placeholder="账号" class="border p-2 w-full mb-2 rounded-xl" autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" class="border p-2 w-full mb-4 rounded-xl" />
      <div class="flex gap-2">
        <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 flex-1 disabled:opacity-50">
          {{ busy ? '登录中…' : '登录' }}
        </button>
        <button type="button" :disabled="busy" class="bg-surface-hover px-4 py-2 flex-1 disabled:opacity-50" @click="switchMode('register')">
          注册
        </button>
      </div>
      <button type="button" :disabled="busy" class="mt-2 bg-surface-hover px-4 py-2 rounded-xl w-full disabled:opacity-50" @click="loadAccounts">
        从数据库注册
      </button>
      <div v-if="showAccounts" class="mt-2 border rounded-lg max-h-44 overflow-auto bg-surface">
        <button
          v-for="acc in accounts" :key="acc.slug"
          type="button"
          class="block w-full text-left px-3 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
          :disabled="busy"
          @click="pickAccount(acc)"
        >
          {{ acc.username }}
        </button>
        <p v-if="accounts.length === 0" class="px-3 py-2 text-xs text-text-muted">暂无可用账号</p>
      </div>
      <p class="text-center mt-3 flex gap-3 justify-center">
        <a class="cursor-pointer underline text-xs text-text-muted" @click="switchMode('recover')">忘记密码？</a>
        <a class="cursor-pointer underline text-xs text-text-muted" @click="switchMode('restore')">从备份恢复</a>
      </p>
    </form>

    <!-- 从备份恢复（新电脑 / 换机：只需备份包 + 密码或助记词） -->
    <form v-else-if="mode === 'restore'" @submit.prevent="restore" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">从备份恢复</h2>
      <p class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="switchMode('login')">返回登录</a>
      </p>
      <input type="file" accept=".json,application/json" @change="onPickBackup" class="block w-full text-sm mb-2" />
      <p v-if="restoreFile" class="text-xs text-text-muted mb-2">已选：{{ restoreFile }}（账号 {{ restoreBundle?.username || '…' }}）</p>
      <input v-model="password" type="password" placeholder="密码（与导出时一致）" autocomplete="off" class="border p-2 w-full mb-2 rounded" />
      <input v-model="recoverPhrase" placeholder="或助记词（12字）" autocomplete="off" class="border p-2 w-full mb-4 rounded" />
      <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 rounded w-full disabled:opacity-50">
        {{ busy ? '恢复中…' : '解包并恢复' }}
      </button>
    </form>

    <!-- 注册：单页（角色下拉 + 账号 + 密码 + 确认密码） -->
    <form v-else-if="mode === 'register'" @submit.prevent="register" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">注册账号</h2>
      <p class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="switchMode('login')">已有账号，去登录</a>
      </p>
      <select v-model="role" class="border p-2 w-full mb-2 rounded-xl bg-surface text-text-muted">
        <option value="" disabled>请选择角色</option>
        <option v-for="r in roleOptions" :key="r.value" :value="r.value">
          {{ r.label }}
        </option>
      </select>
      <input v-model="username" placeholder="账号" class="border p-2 w-full mb-2 rounded-xl" autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码（至少 6 位）" autocomplete="new-password" class="border p-2 w-full mb-2 rounded-xl" />
      <input v-model="confirm" type="password" placeholder="确认密码" autocomplete="new-password" class="border p-2 w-full mb-4 rounded-xl" />
      <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 rounded w-full disabled:opacity-50">
        {{ busy ? '创建中…' : '注册并生成恢复密钥' }}
      </button>
    </form>

    <!-- 注册：恢复密钥 + 抄写前 3 词 -->
    <form v-else-if="mode === 'recovery'" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">保存恢复密钥</h2>
      <p class="text-xs text-text-muted mb-2">请先下载保存下面的文本文件，然后抄写前 3 个词完成注册。</p>
      <div v-if="recoveryPhrase" class="border p-3 rounded mb-3 bg-surface-muted font-mono text-sm leading-6">{{ recoveryPhrase }}</div>
      <div class="flex gap-2 mb-3">
        <button type="button" @click="downloadTxt" class="bg-info text-text-inverse px-3 py-2 rounded text-sm flex-1">下载 TXT</button>
      </div>
      <input v-model="copyWords" placeholder="抄写前 3 个词（不带序号）" class="border p-2 w-full mb-2 rounded" autocomplete="off" />
      <p v-if="copyError" class="text-xs text-danger mb-2">{{ copyError }}</p>
      <button type="button" @click="finishRecovery" class="bg-info text-text-inverse px-4 py-2 rounded w-full">确认并完成注册</button>
    </form>

    <!-- 忘记密码 -->
    <form v-else-if="mode === 'recover'" @submit.prevent="recoverPassword" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">找回密码</h2>
      <p class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="switchMode('login')">返回登录</a>
      </p>
      <input v-model="username" placeholder="账号" class="border p-2 w-full mb-2 rounded" />
      <input v-model="recoverPhrase" placeholder="12 个恢复词" class="border p-2 w-full mb-2 rounded" autocomplete="off" />
      <input v-model="password" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" class="border p-2 w-full mb-4 rounded" />
      <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 rounded w-full disabled:opacity-50">
        {{ busy ? '重置中…' : '重置密码' }}
      </button>
    </form>
  </div>
</template>

<script>
import axios from 'axios';
import { useNotification } from '../composables/useNotification.js';

export default {
  data() {
    return {
      mode: 'login',           // login | register | recovery | recover
      role: '',
      roleOptions: [
        { value: 'teacher', label: '班主任', hint: '可完整使用班级管理功能' },
        { value: 'subject', label: '科任老师', hint: '正在开发中' },
        { value: 'student', label: '学生', hint: '正在开发中' },
      ],
      username: '',
      password: '',
      confirm: '',
      recoverPhrase: '',        // 忘记密码接口用的恢复词
      // 注册成功后的恢复密钥展示
      recoveryPhrase: '',
      recoveryHash: '',
      restoredUsername: '',
      copyWords: '',
      copyError: '',
      busy: false,
      accounts: [],
      showAccounts: false,
      restoreBundle: null,
      restoreFile: '',
    };
  },
  methods: {
    switchMode(m) {
      this.mode = m; this.copyError = ''; this.busy = false; this.showAccounts = false;
      if (m === 'login') this.role = '';
      if (m === 'restore') { this.password = ''; this.recoverPhrase = ''; this.restoreBundle = null; this.restoreFile = ''; }
    },
    loadAccounts() {
      if (this.showAccounts) { this.showAccounts = false; return; }
      axios.get('/api/accounts').then(res => {
        this.accounts = res.data.accounts || [];
        this.showAccounts = true;
        if (this.accounts.length === 0) useNotification().info('暂无可加载的账号');
      }).catch(err => {
        useNotification().error(err.response?.data?.error || '加载账号失败');
      });
    },
    pickAccount(acc) {
      if (this.accounts.length > 1) useNotification().info('已加载账号，请输入密码登录');
      this.username = acc.username;
      this.role = 'teacher';
      this.showAccounts = false;
    },
    login() {
      if (!this.role) return useNotification().warning('请选择角色');
      if (this.role !== 'teacher') return useNotification().warning('该角色正在开发中，请使用「班主任」登录');
      this.busy = true;
      axios.post('/api/login', { username: this.username, password: this.password }).then(res => {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('currentUser', JSON.stringify(res.data.user));
        this.$router.push('/');
      }).catch(err => {
        useNotification().error(err.response?.data?.error || '登录失败');
      }).finally(() => { this.busy = false; });
    },
    register() {
      if (!this.role) return useNotification().warning('请选择角色');
      if (this.role !== 'teacher') return useNotification().warning('该角色正在开发中，请使用「班主任」注册');
      if (!this.username || !this.password) return useNotification().warning('请填写账号和密码');
      if (this.password.length < 6) return useNotification().warning('密码长度至少 6 位');
      if (this.password !== this.confirm) return useNotification().warning('两次输入的密码不一致');
      this.busy = true;
      axios.post('/api/register', { username: this.username, password: this.password, role: this.role }).then(res => {
        this.recoveryPhrase = res.data.recovery.phrase;
        this.recoveryHash = res.data.recovery.hash;
        this.restoredUsername = res.data.user.username;
        this.mode = 'recovery';
      }).catch(err => {
        useNotification().error(err.response?.data?.error || '注册失败');
      }).finally(() => { this.busy = false; });
    },
    downloadTxt() {
      const content = `班级管理系统 - 恢复密钥\n账号：${this.restoredUsername}\n\n请妥善保存以下 12 个恢复词，忘记密码时可用来找回：\n\n${this.recoveryPhrase}\n`;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `恢复密钥-${this.restoredUsername || 'account'}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    finishRecovery() {
      const expected = this.recoveryPhrase
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map(w => w.replace(/^\d+\./, ''));
      const typed = this.copyWords.replace(/^\d+\.\s*/g, '').split(/\s+/).filter(Boolean);
      if (typed.length < 3 || typed[0] !== expected[0] || typed[1] !== expected[1] || typed[2] !== expected[2]) {
        this.copyError = '前 3 个词抄写不正确，请对照恢复密钥重新抄写';
        return;
      }
      this.copyError = '';
      useNotification().success('注册成功！请牢记恢复密钥，可登录账号 ' + this.restoredUsername + ' 使用系统。');
      this.switchMode('login');
    },
    onPickBackup(e) {
      const file = e.target.files && e.target.files[0];
      this.restoreBundle = null;
      this.restoreFile = file ? file.name : '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (parsed.version !== 2) throw new Error('不是有效的 v2 备份包');
          this.restoreBundle = parsed;
        } catch (err) {
          this.restoreBundle = null;
          useNotification().error('备份文件无法解析：' + err.message);
        }
      };
      reader.readAsText(file);
    },
    restore() {
      const b = this.restoreBundle;
      if (!b) return useNotification().warning('请先选择备份文件');
      if (!this.password && !this.recoverPhrase) return useNotification().warning('请至少输入密码或助记词之一');
      this.busy = true;
      axios.post('/api/account/restore-offline', {
        data: b.data,
        slug: b.slug,
        username: b.username,
        wrappedByPassword: b.wrappedByPassword,
        wrappedByMnemonic: b.wrappedByMnemonic,
        password: this.password || undefined,
        mnemonic: this.recoverPhrase || undefined,
      }).then(res => {
        useNotification().success('恢复成功！账号 ' + (res.data.username || b.username) + ' 已还原，请用其密码登录。');
        this.username = b.username || res.data.username || '';
        this.password = '';
        this.recoverPhrase = '';
        this.restoreBundle = null;
        this.restoreFile = '';
        this.switchMode('login');
      }).catch(err => {
        useNotification().error(err.response?.data?.error || '恢复失败');
      }).finally(() => { this.busy = false; });
    },
    recoverPassword() {
      this.busy = true;
      axios.post('/api/recover-password', {
        username: this.username,
        phrase: this.recoverPhrase,
        newPassword: this.password,
      }).then(() => {
        useNotification().success('密码已重置，请使用新密码登录');
        this.username = '';
        this.recoverPhrase = '';
        this.password = '';
        this.switchMode('login');
      }).catch(err => {
        useNotification().error(err.response?.data?.error || '重置失败');
      }).finally(() => { this.busy = false; });
    },
  },
};
</script>