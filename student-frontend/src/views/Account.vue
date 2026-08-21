<template>
  <div class="max-w-md mx-auto mt-10 bg-surface p-6 rounded shadow-card">
    <h2 class="text-xl font-bold mb-4">账号管理</h2>
    <div class="mb-4">
      <p>当前用户：{{ user.username }}</p>
      <p>角色：{{ user.role === 'teacher' ? '班主任' : '科任老师' }}</p>
    </div>

    <div class="border-t pt-4 mb-4">
      <h3 class="font-semibold mb-2">修改用户名</h3>
      <input v-model="newUsername" placeholder="新用户名" class="border p-2 w-full mb-2" />
      <input v-model="usernamePassword" type="password" placeholder="当前密码" autocomplete="current-password" class="border p-2 w-full mb-2" />
      <button @click="changeUsername" class="bg-primary text-text-inverse px-4 py-2 rounded">确认修改</button>
    </div>

    <div class="border-t pt-4 mb-4">
      <h3 class="font-semibold mb-2">修改密码</h3>
      <input v-model="oldPassword" type="password" placeholder="原密码" autocomplete="current-password" class="border p-2 w-full mb-2" />
      <input v-model="newPassword" type="password" placeholder="新密码" autocomplete="new-password" class="border p-2 w-full mb-2" />
      <button @click="changePassword" class="bg-info text-text-inverse px-4 py-2 rounded">确认修改</button>
    </div>

    <div class="border-t pt-4 mb-4">
      <h3 class="font-semibold mb-2">重置恢复密钥</h3>
      <p class="text-xs text-text-muted mb-2">重置后旧恢复密钥立即失效，请妥善保存新密钥。</p>
      <button @click="resetRecoveryKey" class="bg-warning text-text-inverse px-4 py-2 rounded">重新生成</button>
    </div>

    <div class="border-t pt-4 mb-4">
      <h3 class="font-semibold mb-2">导出数据库</h3>
      <p class="text-xs text-text-muted mb-2">输入你的登录密码即可导出当前库（业务数据 + 应用设置 + 账号），换机后可用同一密码恢复。</p>
      <input v-model="exportPassword" type="password" placeholder="登录密码" autocomplete="current-password" class="border p-2 w-full mb-2" />
      <button @click="exportDb" class="bg-primary text-text-inverse px-4 py-2 rounded" :disabled="busyExport">
        {{ busyExport ? '导出中…' : '导出备份' }}
      </button>
    </div>

    <div class="mt-6">
      <button @click="confirmLogout" class="bg-danger text-text-inverse px-4 py-2 rounded">退出登录</button>
    </div>

    <ConfirmDialog
      :visible="dialog.visible"
      :message="dialog.message"
      :type="dialog.type"
      :showCancel="dialog.showCancel"
      @confirm="onDialogConfirm"
      @cancel="dialog.visible = false"
    />
  </div>
</template>

<script>
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog.vue';

export default {
  components: { ConfirmDialog },
  data() {
    return {
      newUsername: '',
      usernamePassword: '',
      oldPassword: '',
      newPassword: '',
      exportPassword: '',
      busyExport: false,
      dialog: {
        visible: false,
        message: '',
        type: 'alert',
        showCancel: false
      },
      dialogCallback: null
    }
  },
  computed: {
    user() {
      return JSON.parse(localStorage.getItem('currentUser') || '{}')
    }
  },
  methods: {
    showAlert(msg) {
      this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false };
    },
    showConfirm(msg, onConfirm) {
      this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true };
      this.dialogCallback = onConfirm;
    },
    onDialogConfirm() {
      this.dialog.visible = false;
      if (this.dialogCallback) {
        this.dialogCallback();
        this.dialogCallback = null;
      }
    },
    async changeUsername() {
      try {
        const res = await axios.put('/api/account/username', {
          newUsername: this.newUsername,
          password: this.usernamePassword
        });
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        currentUser.username = this.newUsername;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        this.newUsername = '';
        this.usernamePassword = '';
        this.showAlert(res.data.message);
      } catch (err) {
        this.showAlert(err.response?.data?.error || '修改失败');
      }
    },
    async changePassword() {
      try {
        const res = await axios.put('/api/account/password', {
          oldPassword: this.oldPassword,
          newPassword: this.newPassword
        });
        this.oldPassword = '';
        this.newPassword = '';
        this.showAlert(res.data.message);
      } catch (err) {
        this.showAlert(err.response?.data?.error || '修改失败');
      }
    },
    confirmLogout() {
      this.showConfirm('确定要退出登录吗？', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        this.$router.push('/login');
      });
    },
    async resetRecoveryKey() {
      try {
        const res = await axios.get('/api/account/recovery-key');
        this.showConfirm('新的恢复密钥（仅此一次显示，请保存）：\n\n' + res.data.phrase + '\n\n请立即保存，忘记密码时可用来重置。', () => {});
      } catch (err) {
        this.showAlert(err.response?.data?.error || '生成失败');
      }
    },
    async exportDb() {
      const pwd = this.exportPassword;
      if (!pwd) {
        this.showAlert('请输入登录密码以导出数据库。');
        return;
      }
      this.busyExport = true;
      try {
        const res = await axios.get('/api/account/export', { params: { password: pwd } });
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.user.username + '-backup.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showAlert('导出成功。请保管好备份文件与你在本页填写的密码/助记词（线上明文不保存）。');
      } catch (err) {
        this.showAlert(err.response?.data?.error || '导出失败');
      } finally { this.busyExport = false; }
    }
  }
}
</script>