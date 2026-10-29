<template>
  <div class="flex justify-center items-center h-screen login-bg">
    <!-- 登录表单 -->
    <form v-if="mode === 'login'" @submit.prevent="login" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-4">班集登录</h2>
      <p v-if="loginError" class="text-danger text-[15px] font-medium mb-2">{{ loginError }}</p>
      <input v-model="username" placeholder="账号" autocomplete="off" class="border border-border p-2 w-full mb-2 rounded-xl" />
      <input v-model="password" type="password" placeholder="密码（留空则无密码登录）" autocomplete="new-password" class="border border-border p-2 w-full mb-4 rounded-xl" />
      <div class="flex gap-2">
        <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 flex-1 rounded-xl disabled:opacity-50">
          {{ busy ? '登录中…' : '登录' }}
        </button>
        <button type="button" :disabled="busy" class="bg-surface-hover px-4 py-2 flex-1 rounded-xl disabled:opacity-50" @click="switchMode('register')">
          注册
        </button>
      </div>
      <button type="button" :disabled="busy" class="mt-2 bg-surface-hover px-4 py-2 rounded-xl w-full disabled:opacity-50" @click="openDbPicker">
        从数据库登录
      </button>
      <input ref="dbFileInput" type="file" accept=".db,.json" class="hidden" @change="onPickDbFile" />
      <p class="text-center mt-3">
        <a class="cursor-pointer underline text-xs text-text-muted" @click="switchMode('recover')">忘记密码？</a>
      </p>
    </form>

    <!-- 从备份恢复（新电脑 / 换机：只需备份包 + 密码或助记词） -->
    <form v-else-if="mode === 'restore'" @submit.prevent="restore" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">从备份恢复</h2>
      <p class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="switchMode('login')">返回登录</a>
      </p>
      <input v-if="restoreFile" :value="restoreBundle?.username || ''" readonly placeholder="账号" autocomplete="off" class="border p-2 w-full mb-2 rounded-xl" />
      <input v-model="password" type="password" placeholder="密码（与导出时一致）" autocomplete="new-password" class="border p-2 w-full mb-2 rounded-xl" />
      <input v-model="recoverPhrase" placeholder="或助记词（12字）" autocomplete="off" class="border p-2 w-full mb-4 rounded-xl" />
      <button type="submit" :disabled="busy" v-preload="loadConfirmDialog" class="bg-info text-text-inverse px-4 py-2 rounded-xl w-full disabled:opacity-50">
        {{ busy ? '恢复中…' : '解包并恢复' }}
      </button>
    </form>

    <!-- 注册：单页（安全等级 + 账号 + 密码） -->
    <form v-else-if="mode === 'register'" @submit.prevent="register" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">注册账号</h2>
      <p class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="switchMode('login')">已有账号，去登录</a>
      </p>
      <AppSelect v-model="securityLevel" :options="securityLevelOptions" class="w-full mb-2" />
      <input v-model="username" placeholder="账号" class="border border-border p-2 w-full mb-2 rounded-xl" autocomplete="off" />
      <template v-if="registerNeedsPassword">
        <input v-model="password" type="password" placeholder="密码（至少 6 位）" autocomplete="new-password" class="border border-border p-2 w-full mb-2 rounded-xl" />
        <input v-model="confirm" type="password" placeholder="确认密码" autocomplete="new-password" class="border border-border p-2 w-full mb-4 rounded-xl" />
      </template>
      <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 rounded-xl w-full disabled:opacity-50">
        {{ busy ? '创建中…' : '注册' }}
      </button>
    </form>

    <!-- 注册：恢复密钥 + 抄写前 3 词 -->
    <form v-else-if="mode === 'recovery'" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">保存恢复密钥</h2>
      <p class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="switchMode('register')">返回</a>
      </p>
      <p class="text-xs text-text-muted mb-2">这是超级隐私模式的恢复词，也是忘记密码时的唯一凭证。请点击「下载文本」保存到安全的地方，然后抄写前 3 个词完成注册。</p>
      <div v-if="recoveryPhrase" class="p-3 rounded-xl mb-3 font-mono text-sm leading-6" style="background: rgba(255,255,255,var(--glass-opacity,0.4)); backdrop-filter: blur(10px) saturate(1.1);">{{ recoveryPhrase }}</div>
      <div class="flex gap-2 mb-3">
        <button type="button" @click="downloadTxt" class="bg-info text-text-inverse px-3 py-2 rounded-xl text-sm flex-1">下载文本</button>
        <button type="button" @click="copyRecovery" class="bg-info text-text-inverse px-3 py-2 rounded-xl text-sm flex-1">复制</button>
      </div>
      <input v-model="copyWords" placeholder="抄写前 3 个词（可带序号、可不带空格）" class="border p-2 w-full mb-2 rounded-xl" autocomplete="off" />
      <p v-if="copyError" class="text-xs text-danger mb-2">{{ copyError }}</p>
      <button type="button" v-preload="loadConfirmDialog" class="bg-info text-text-inverse px-4 py-2 rounded-xl w-full" @click="finishRecovery">确认并完成注册</button>
    </form>

    <!-- 忘记密码：统一入口（恢复词恢复 / 本机信息恢复） -->
    <form v-else-if="mode === 'recover'" @submit.prevent="onRecoverSubmit" class="bg-surface p-8 rounded-3xl shadow-card w-80 login-glow">
      <h2 class="text-xl font-bold mb-1">找回密码</h2>
      <p v-if="recoverStep !== 'setpass'" class="text-xs text-text-muted mb-4">
        <a class="cursor-pointer underline" @click="recoverBack">{{ recoverStep === 'menu' ? '返回登录' : '上一步' }}</a>
      </p>
      <p v-else class="mb-4"></p>

      <!-- 步骤 1：选择验证方式 -->
      <template v-if="recoverStep === 'menu'">
        <p class="text-xs text-text-muted mb-3">验明身份后即可设置新密码。</p>
        <button type="button" :disabled="busy" class="bg-surface-hover px-4 py-2 rounded-xl w-full mb-2 disabled:opacity-50" @click="recoverStep = 'phrase'">
          使用恢复词恢复
        </button>
        <button type="button" :disabled="busy" class="bg-surface-hover px-4 py-2 rounded-xl w-full disabled:opacity-50" @click="openLocalRecover">
          使用本机信息恢复
        </button>
      </template>

      <!-- 步骤 2a：恢复词恢复 -->
      <template v-else-if="recoverStep === 'phrase'">
        <p class="text-xs text-text-muted mb-2">不用记账号，系统会按恢复词在本机定位对应的账号。</p>
        <input v-model="recoverPhrase" placeholder="12 个恢复词" autocomplete="off" class="border p-2 w-full mb-2 rounded-xl" />
        <input v-model="password" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" class="border p-2 w-full mb-2 rounded-xl" />
        <input v-model="confirm" type="password" placeholder="确认新密码" autocomplete="new-password" class="border p-2 w-full mb-4 rounded-xl" />
        <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 rounded-xl w-full disabled:opacity-50">
          {{ busy ? '重置中…' : '重置密码' }}
        </button>
      </template>

      <!-- 步骤 2b：本机信息恢复（点选本机已登记账号） -->
      <template v-else-if="recoverStep === 'local'">
        <p class="text-xs text-text-muted mb-2">选择一个本机账号。超级隐私模式的账号没有主密钥包裹，只能用恢复词恢复。</p>
        <p class="text-[11px] text-text-muted mb-2">提醒：同一 Windows 账号下，本机恢复等同于共用钥匙；重要账号请使用超级隐私模式。</p>
        <div v-if="recoverAccounts.length" class="mb-2 max-h-44 overflow-auto rounded-xl border border-border">
          <button
            v-for="a in recoverAccounts"
            :key="a.slug"
            type="button"
            class="w-full text-left px-3 py-2 text-sm border-b border-border"
            :class="recoverSlug === a.slug ? 'bg-surface-hover' : ''"
            @click="recoverSlug = a.slug"
          >
            <span class="font-medium">{{ a.username }}</span>
            <span class="block text-[11px] text-text-muted">{{ a.slug }}.db</span>
          </button>
        </div>
        <p v-else class="text-xs text-text-muted mb-2">
          {{ recoverLoading ? '正在读取本机账号…' : '本机没有可恢复的账号，请改用恢复词或从备份恢复。' }}
        </p>
        <button type="submit" :disabled="busy || !recoverSlug" class="bg-info text-text-inverse px-4 py-2 rounded-xl w-full disabled:opacity-50">
          {{ busy ? '恢复中…' : '恢复' }}
        </button>
      </template>

      <!-- 步骤 3：本机恢复成功后强制设置新密码 -->
      <template v-else-if="recoverStep === 'setpass'">
        <p class="text-xs text-text-muted mb-2">已通过本机数据库验证身份，请设置新密码后进入系统。</p>
        <input :value="recoveredAccount" readonly placeholder="账号" class="border p-2 w-full mb-2 rounded-xl" />
        <input v-model="password" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" class="border p-2 w-full mb-2 rounded-xl" />
        <input v-model="confirm" type="password" placeholder="确认新密码" autocomplete="new-password" class="border p-2 w-full mb-4 rounded-xl" />
        <button type="submit" :disabled="busy" class="bg-info text-text-inverse px-4 py-2 rounded-xl w-full disabled:opacity-50">
          {{ busy ? '保存中…' : '设置新密码' }}
        </button>
      </template>
    </form>

    <!-- 确认弹窗（覆盖恢复 / 注册完成确认） -->
    <ConfirmDialog
      v-if="confirmMounted"
      :visible="confirmVisible"
      :message="confirmMessage"
      :title="confirmTitle"
      :show-cancel="true"
      :confirm-text="confirmText"
      :cancel-text="cancelText"
      @confirm="onConfirmAction"
      @cancel="cancelConfirm"
    />

    <!-- 安全等级风险说明：普通密码只有「确定」，超级隐私「确认 / 取消」（取消回退默认档） -->
    <ConfirmDialog
      v-if="levelTipVisible"
      :visible="levelTipVisible"
      title="安全等级说明"
      :message="levelTipMessage"
      :show-cancel="levelTipType === 'privacy'"
      :confirm-text="levelTipType === 'privacy' ? '确认' : '确定'"
      cancel-text="取消"
      @confirm="levelTipVisible = false"
      @cancel="onLevelTipCancel"
    />
  </div>
</template>

<script setup>
import { setToken, setCurrentUser } from '../utils/authStorage.js'
import axios from 'axios';
import { defineAsyncComponent, ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useNotification } from '../composables/useNotification.js';
import { reportError } from '../utils/reportError.js';
import AppSelect from '../components/base/AppSelect.vue';
import '../styles/dialog-transition.css';
import { INVOKE } from '../electronChannels.js';
import { storeMediaToken } from '../utils/apiUrl';

// 弹窗类组件懒加载：打开时才加载对应 chunk
// 悬停预取：ConfirmDialog 的 chunk 提前加载（供 v-preload 使用）
const loadConfirmDialog = () => import('../components/base/ConfirmDialog.vue');
const ConfirmDialog = defineAsyncComponent(loadConfirmDialog);

// 注册可选的四种安全等级（与引导页 / 系统设置共用同一套文案）
const SECURITY_LEVELS = [
  { value: 'plain', label: '明文模式（不加密）' },
  { value: 'nopass', label: '无密码模式（加密，免密码登录）' },
  { value: 'password', label: '普通密码模式（加密 + 登录密码）' },
  { value: 'privacy', label: '超级隐私模式（密码 + 恢复词才能解锁）' },
];

const router = useRouter();

const mode = ref('login');           // login | register | recovery | recover
const securityLevel = ref('password'); // 注册安全等级：plain | nopass | password | privacy
const levelTipVisible = ref(false);    // 安全等级风险说明弹窗
const levelTipType = ref('password');  // password | privacy
const levelTipSuppress = ref(false);   // 回退赋值时抑制再次弹窗
const username = ref('');
const password = ref('');
const confirm = ref('');
const loginError = ref('');            // 登录失败时内联显示在表单上方
// 忘记密码：menu=选择方式 | phrase=恢复词恢复 | local=本机信息恢复 | setpass=强制设新密码
const recoverStep = ref('menu');
const recoverPhrase = ref('');
const recoverAccounts = ref([]);       // 本机已登记且可恢复（非隐私）的账号列表
const recoverLoading = ref(false);
const recoverSlug = ref('');           // 本机恢复选中的库 slug
const recoveredAccount = ref('');      // 本机恢复成功后的账号（只读展示）
const recoveredUser = ref(null);       // 本机恢复签发的登录用户信息
// 注册成功后的恢复密钥展示
const recoveryPhrase = ref('');
const recoveryHash = ref('');
const draftId = ref('');             // 待确认注册草稿 id（抄写通过后真正建库）
const restoredUsername = ref('');
const copyWords = ref('');
const recoveryDownloaded = ref(false); // 必须下载过恢复密钥文本才允许确认注册
const copyError = ref('');
const busy = ref(false);
const restoreBundle = ref(null);
const restoreFile = ref('');
const confirmVisible = ref(false);
const confirmMounted = ref(false);
const confirmMessage = ref('');
const confirmTitle = ref('');
const confirmPayload = ref(null);
const confirmAction = ref('restore');   // restore=覆盖恢复 | recovery=注册完成
const confirmText = ref('确定');
const cancelText = ref('取消');

const dbFileInput = ref(null);

const registerNeedsPassword = computed(() => {
  return securityLevel.value === 'password' || securityLevel.value === 'privacy';
});
const securityLevelOptions = computed(() => SECURITY_LEVELS);
// 安全等级说明弹窗文案（超级隐私模式的「取消」会回退到普通密码）
const levelTipMessage = computed(() => {
  return levelTipType.value === 'privacy'
    ? '请您妥善保管好您的密钥，如果丢失，任何人将无法打开您的数据（包括开发者），若担心密码丢失，请使用其他模式'
    : '普通密码模式只能保证其他 Windows 用户无法访问，并且能保证自己复制数据库到其他电脑无法打开。同一个 Windows 用户仍然可以通过数据恢复打开，如果需要严格的保护隐私，请使用超级隐私模式';
});

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
watch(confirmVisible, (n) => { if (n) confirmMounted.value = true });
watch(securityLevel, (v) => {
  // 取消隐私模式后回退到普通密码是程序化赋值，不再弹一次普通密码说明
  if (levelTipSuppress.value) return;
  tipSecurityLevel(v);
});

function switchMode(m) {
  mode.value = m; copyError.value = ''; loginError.value = ''; busy.value = false;
  if (m === 'restore') { password.value = ''; recoverPhrase.value = ''; restoreBundle.value = null; restoreFile.value = ''; }
  // 注册默认是普通密码模式：进来先把该等级的边界说清楚
  if (m === 'register') tipSecurityLevel(securityLevel.value);
  if (m === 'recover') {
    recoverStep.value = 'menu';
    recoverPhrase.value = ''; recoverAccounts.value = []; recoverSlug.value = '';
    recoveredAccount.value = '';
    recoveredUser.value = null; password.value = ''; confirm.value = '';
  }
}
// 选择安全等级时的风险说明弹窗：普通密码只有「确定」，超级隐私「确认 / 取消」
function tipSecurityLevel(v) {
  if (v !== 'password' && v !== 'privacy') return;
  levelTipType.value = v;
  levelTipVisible.value = true;
}
// 超级隐私模式的「取消」：回退到默认的普通密码模式，且不再连锁弹出普通密码说明
function onLevelTipCancel() {
  levelTipVisible.value = false;
  levelTipSuppress.value = true;
  securityLevel.value = 'password';
  nextTick(() => { levelTipSuppress.value = false; });
}
function openDbPicker() {
  dbFileInput.value && dbFileInput.value.click();
}
function onPickDbFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 清空以允许再次选择同一文件
  if (!file) return;
  // 选择的若是导出的 .json 备份包：复用「从备份恢复」逻辑，预填后引导填密码/助记词恢复
  if (/\.json$/i.test(file.name)) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.version !== 2) throw new Error('不是有效的 v2 备份包');
        restoreBundle.value = parsed;
        restoreFile.value = file.name;
        mode.value = 'restore';
        useNotification().info('已识别备份包，账号 ' + (parsed.username || '…') + '：请输入密码或助记词后点「解包并恢复」');
      } catch (err) {
        useNotification().error('备份文件无法解析：' + err.message);
      }
    };
    reader.readAsText(file);
    return;
  }
  // 本机已有 .db 库文件：直接绑定
  busy.value = true;
  axios.post('/api/db-login', { file: file.name }).then(res => {
    username.value = res.data.username;
    useNotification().success('已选择数据库，账号 ' + res.data.username + '，请输入密码登录');
  }).catch(err => {
    reportError(err, { action: '打开数据库' });
  }).finally(() => { busy.value = false; });
}
function login() {
  loginError.value = '';
  busy.value = true;
  axios.post('/api/login', { username: username.value, password: password.value }).then(res => {
    setToken(res.data.token);
    storeMediaToken(res.data.mediaToken);
    setCurrentUser(res.data.user);
    router.push('/');
  }).catch(err => {
    // 账号/密码错误：内联显示在表单上方，不再弹提示条
    loginError.value = err.response?.data?.error || '登录失败';
  }).finally(() => { busy.value = false; });
}
function register() {
  if (!username.value) return useNotification().warning('请填写账号');
  if (registerNeedsPassword.value) {
    if (!password.value || password.value.length < 6) return useNotification().warning('密码长度至少 6 位');
    if (password.value !== confirm.value) return useNotification().warning('两次输入的密码不一致');
  }
  busy.value = true;
  const payload = { username: username.value, role: 'teacher', level: securityLevel.value };
  if (registerNeedsPassword.value) payload.password = password.value;
  axios.post('/api/register', payload).then(res => {
    restoredUsername.value = res.data.user.username;
    if (res.data.draftId) {
      // 仅超级隐私模式：先展示恢复词，抄写通过后再确认建库
      draftId.value = res.data.draftId;
      recoveryPhrase.value = res.data.recovery.phrase;
      recoveryHash.value = res.data.recovery.hash;
      mode.value = 'recovery';
    } else {
      // 其余等级：建库即签发登录态，直接进入系统
      setToken(res.data.token);
      storeMediaToken(res.data.mediaToken);
      setCurrentUser(res.data.user);
      router.push('/');
    }
  }).catch(err => {
    reportError(err, { action: '注册' });
  }).finally(() => { busy.value = false; });
}
async function copyRecovery() {
  try {
    await navigator.clipboard.writeText(recoveryPhrase.value);
    useNotification().success('已复制恢复密钥');
  } catch (_) {
    useNotification().error('复制失败');
  }
}
async function downloadTxt() {
  const content = `班集 - 恢复密钥\n账号：${restoredUsername.value}\n\n请妥善保存以下 12 个恢复词，忘记密码时可用来找回：\n\n${recoveryPhrase.value}\n`;
  const fileName = `恢复密钥-${restoredUsername.value || 'account'}.txt`;
  try {
    // 走 Electron 原生保存对话框，写盘成功才返回成功；用户取消则保持锁定
    const res = await window.electron.invoke(INVOKE.SAVE_FILE, { defaultName: fileName, data: content });
    if (res && res.canceled) return;
    if (res && res.error) {
      reportError(new Error(res.error), { action: '保存恢复密钥' });
      return;
    }
    recoveryDownloaded.value = true;   // 文件已真正保存，解锁「确认并完成注册」
    useNotification().success('恢复密钥文本已保存到本地');
  } catch (e) {
    reportError(e, { action: '保存恢复密钥' });
  }
}
function finishRecovery() {
  copyError.value = '';
  // 必须先把恢复密钥保存到本地，否则不让继续
  if (!recoveryDownloaded.value) {
    copyError.value = '请先将恢复密钥保存到本地再继续注册';
    return;
  }
  const expected = recoveryPhrase.value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(w => w.replace(/^\d+\./, ''));
  const raw = copyWords.value || '';

  // 兼容三种输入：带空格分词 / 无空格但带序号（如 1.水2.络3.木）/ 纯顶住汉字（水络木）
  const bySpace = raw.split(/\s+/).filter(Boolean).map(w => w.replace(/^\d+\./, ''));
  const byId = [...raw.matchAll(/\d+\.\s*([^\d]+)/g)].map(m => m[1].replace(/\s+/g, ''));
  const chars = raw.replace(/[^\u4e00-\u9fa5]/g, '').split('');

  const spacedOk = bySpace.length === expected.length && expected.every((w, i) => bySpace[i] === w);
  const bracketedOk = byId.length === expected.length && expected.every((w, i) => byId[i] === w);
  const jammedOk = !spacedOk && chars.length >= 3 && chars.join('') === expected.join('');

  if (!spacedOk && !bracketedOk && !jammedOk) {
    copyError.value = '前 3 个词抄写不正确，请按顺序抄写，如「' + expected.join(' ') + '」';
    return;
  }
  copyError.value = '';
  // 抄写通过后：先弹出「恢复密钥仅此一份」的警示确认，用户确认后才真正创建账号
  confirmAction.value = 'recovery';
  confirmTitle.value = '重要提醒';
  confirmText.value = '我已确认保存，继续注册';
  cancelText.value = '返回保存恢复密钥';
  // ConfirmDialog 按纯文本插值渲染（非 v-html），这里不能带 HTML 标签
  confirmMessage.value = '恢复密钥是忘记密码后唯一的恢复凭证，在这里只会出现一次，请仔细检查恢复密钥是否已经保存到安全的地方，如果密码和恢复密钥同时丢失，将会无法访问该账号';
  confirmVisible.value = true;
}
async function confirmRecovery() {
  confirmVisible.value = false;
  busy.value = true;
  axios.post('/api/register/confirm', {
    draftId: draftId.value,
    password: password.value,
    phrase: recoveryPhrase.value,
  })
    .then(res => {
      // 注册成功即自动登录并进入首页
      setToken(res.data.token);
      storeMediaToken(res.data.mediaToken);
      setCurrentUser(res.data.user);
      router.push('/');
    })
    .catch(err => {
      copyError.value = err.response?.data?.error || '注册失败';
    })
    .finally(() => { busy.value = false; });
}
async function restore() {
  const b = restoreBundle.value;
  // 无密码账号的备份包已带明文 key，无需密码/助记词；有密码包才需其一
  if (!b.key && !password.value && !recoverPhrase.value) return useNotification().warning('请至少输入密码或助记词之一');
  const payload = {
    data: b.data,
    slug: b.slug,
    username: b.username,
    wrappedByPassword: b.wrappedByPassword,
    wrappedByMnemonic: b.wrappedByMnemonic,
    key: b.key,
    password: password.value || undefined,
    mnemonic: recoverPhrase.value || undefined,
    memory: b.memory, // AI 长期记忆（随备份包一起还原）
  };
  busy.value = true;
  try {
    const res = await axios.post('/api/account/restore-offline', payload);
    // 覆盖恢复成功：后端已签发登录态，直接存 token 并跳首页
    if (res.data.token) {
      setToken(res.data.token);
      storeMediaToken(res.data.mediaToken);
      setCurrentUser(res.data.user);
      router.push('/');
      return;
    }
    useNotification().success('恢复成功！账号 ' + (res.data.username || b.username) + ' 已还原，请用其密码登录。');
    afterRestore(b, res.data.username);
  } catch (err) {
    const data = err.response?.data || {};
    // 本机已存在同一账号，需用户确认后才真正覆盖
    if (data.needConfirm) {
      confirmAction.value = 'restore';
      confirmTitle.value = '';
      confirmText.value = '确定';
      cancelText.value = '取消';
      confirmMessage.value = data.message || '本机已存在同名账号，是否确认覆盖？';
      confirmPayload.value = payload;
      confirmVisible.value = true;
      useNotification().info('该账号在本机已存在，请确认后覆盖恢复');
    } else {
      useNotification().error(data.error || '恢复失败');
    }
  } finally { busy.value = false; }
}
async function confirmRestore() {
  confirmVisible.value = false;
  const b = restoreBundle.value;
  const payload = confirmPayload.value;
  confirmPayload.value = null;
  if (!payload) return;
  busy.value = true;
  try {
    payload.confirm = true;
    const res = await axios.post('/api/account/restore-offline', payload);
    // 覆盖恢复成功：后端已签发登录态，直接存 token 并跳首页
    if (res.data.token) {
      setToken(res.data.token);
      storeMediaToken(res.data.mediaToken);
      setCurrentUser(res.data.user);
      router.push('/');
      return;
    }
    useNotification().success('已覆盖恢复！账号 ' + (res.data.username || (b ? b.username : '')) + ' 已还原，请用其密码登录。');
    afterRestore(b, res.data.username);
  } catch (err) {
    reportError(err, { action: '覆盖恢复' });
  } finally { busy.value = false; }
}
function onConfirmAction() {
  if (confirmAction.value === 'restore') confirmRestore();
  else if (confirmAction.value === 'recovery') confirmRecovery();
}
function cancelConfirm() {
  if (confirmAction.value === 'restore') useNotification().info('已取消恢复');
  confirmVisible.value = false;
  confirmPayload.value = null;
}
function afterRestore(b, restoredUsername) {
  const name = restoredUsername || (b && b.username) || '';
  username.value = name;
  password.value = '';
  recoverPhrase.value = '';
  restoreBundle.value = null;
  restoreFile.value = '';
  switchMode('login');
}
// 忘记密码：返回上一步（setpass 阶段已签发恢复 token，不提供返回，避免留下未改密的登录态）
function recoverBack() {
  if (recoverStep.value === 'menu') return switchMode('login');
  recoverStep.value = 'menu';
  recoverPhrase.value = '';
  recoverAccounts.value = [];
  recoverSlug.value = '';
  password.value = '';
  confirm.value = '';
}
// 本机恢复：列出本机已登记账号（隐私库除外），由用户按账号名点选
function openLocalRecover() {
  recoverStep.value = 'local';
  recoverSlug.value = '';
  recoverAccounts.value = [];
  recoverLoading.value = true;
  axios.get('/api/accounts').then(res => {
    const list = (res.data && res.data.accounts) || [];
    recoverAccounts.value = list.filter(a => !a.protect);
  }).catch(err => {
    reportError(err, { action: '读取本机账号' });
  }).finally(() => { recoverLoading.value = false; });
}
function onRecoverSubmit() {
  if (recoverStep.value === 'phrase') return resetByPhrase();
  if (recoverStep.value === 'local') return recoverByLocalAccount();
  if (recoverStep.value === 'setpass') return saveRecoveredPassword();
}
// 恢复词恢复：只凭恢复词定位账号 + 新密码重置（隐私库与非隐私库都由后端按恢复词校验）
function resetByPhrase() {
  if (!recoverPhrase.value) return useNotification().warning('请填写恢复词');
  if (!password.value || password.value.length < 6) return useNotification().warning('新密码至少 6 位');
  if (password.value !== confirm.value) return useNotification().warning('两次输入的新密码不一致');
  busy.value = true;
  axios.post('/api/recover-password', {
    phrase: recoverPhrase.value,
    newPassword: password.value,
  }).then(res => {
    // 后端按恢复词定位到账号后回传用户名，顺带填好登录框
    const name = res.data && res.data.username;
    if (name) username.value = name;
    useNotification().success(name ? '账号 ' + name + ' 的密码已重置，请用新密码登录' : '密码已重置，请使用新密码登录');
    recoverPhrase.value = '';
    password.value = '';
    confirm.value = '';
    switchMode('login');
  }).catch(err => {
    reportError(err, { action: '重置' });
  }).finally(() => { busy.value = false; });
}
// 本机信息恢复：选中的本机库即凭证，签发带 recover 标记的临时登录态，随后强制设新密码
function recoverByLocalAccount() {
  if (!recoverSlug.value) return useNotification().warning('请先选择要恢复的账号');
  busy.value = true;
  axios.post('/api/db-recover', { file: recoverSlug.value + '.db' }).then(res => {
    setToken(res.data.token);
    storeMediaToken(res.data.mediaToken);
    recoveredUser.value = res.data.user;
    recoveredAccount.value = res.data.user.username;
    username.value = res.data.user.username;
    password.value = '';
    confirm.value = '';
    recoverStep.value = 'setpass';
    useNotification().info('已验证本机数据库，请设置新密码');
  }).catch(err => {
    reportError(err, { action: '恢复' });
  }).finally(() => { busy.value = false; });
}
function saveRecoveredPassword() {
  if (!password.value || password.value.length < 6) return useNotification().warning('新密码至少 6 位');
  if (password.value !== confirm.value) return useNotification().warning('两次输入的新密码不一致');
  busy.value = true;
  axios.put('/api/account/password', { newPassword: password.value }).then(res => {
    // 后端换发了不含 recover 标记的常规 token，落盘后进入系统
    if (res.data && res.data.token) {
      setToken(res.data.token);
      storeMediaToken(res.data.mediaToken);
    }
    setCurrentUser(recoveredUser.value || {});
    useNotification().success('新密码已设置');
    router.push('/');
  }).catch(err => {
    reportError(err, { action: '设置新密码' });
  }).finally(() => { busy.value = false; });
}
</script>