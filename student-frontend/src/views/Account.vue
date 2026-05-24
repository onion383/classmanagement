<template>
  <div class="max-w-md mx-auto mt-10 bg-white p-6 rounded shadow">
    <h2 class="text-xl font-bold mb-4">账号管理</h2>
    <div class="mb-4">
      <p>当前用户：{{ user.username }}</p>
      <p>角色：{{ user.role === 'teacher' ? '班主任' : '科任老师' }}</p>
    </div>

    <div class="border-t pt-4 mb-4">
      <h3 class="font-semibold mb-2">修改用户名</h3>
      <input v-model="newUsername" placeholder="新用户名" class="border p-2 w-full mb-2" />
      <input v-model="usernamePassword" type="password" placeholder="当前密码" autocomplete="current-password" class="border p-2 w-full mb-2" />
      <button @click="changeUsername" class="bg-green-500 text-white px-4 py-2 rounded">确认修改</button>
    </div>

    <div class="border-t pt-4 mb-4">
      <h3 class="font-semibold mb-2">修改密码</h3>
      <input v-model="oldPassword" type="password" placeholder="原密码" autocomplete="current-password" class="border p-2 w-full mb-2" />
      <input v-model="newPassword" type="password" placeholder="新密码" autocomplete="new-password" class="border p-2 w-full mb-2" />
      <button @click="changePassword" class="bg-blue-500 text-white px-4 py-2 rounded">确认修改</button>
    </div>

    <div class="mt-6">
      <button @click="confirmLogout" class="bg-red-500 text-white px-4 py-2 rounded">退出登录</button>
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
    }
  }
}
</script>