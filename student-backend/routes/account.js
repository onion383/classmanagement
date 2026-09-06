const express = require('express');
const router = express.Router();
const { db } = require('../db');
const dbManager = require('../dbManager');
const bcrypt = require('bcryptjs');
const { auth } = require('../middleware/auth');
const { pickPhrase, deriveRestoreHash, formatPhrase } = require('../services/recoveryKey');

// 重置恢复密钥：为当前登录账号生成一组新的 12 词恢复密钥并保存哈希。
// 生成的密钥只在本次响应返回一次（前端提示先保存再确认）。
router.get('/recovery-key', auth(), (req, res) => {
  try {
    const phrase = pickPhrase();
    const hash = deriveRestoreHash(phrase);
    db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(hash, req.user.userId);
    res.json({ phrase: formatPhrase(phrase), recoveryKey: phrase });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 备份导出：一次导出当前班主任库（业务数据 + 应用设置 + 账号 全带走）。
// v2 便携包：仅在「输入正确登录密码」时放行导出，防止他人偷导。
// 库钥匙用该登录密码派生钥匙包裹进包，换机后仍可用同一登录密码解包恢复。
router.post('/export', auth(), (req, res) => {
  try {
    const slug = req.user && req.user.dbSlug ? req.user.dbSlug : 'default';
    // 密码走请求体而非 URL query：配合加密通道，避免 GET 明文 URL 泄露密码
    const { password, encrypt = '1', dbPassword } = req.body || {};
    // 校验必须是当前账号的登录密码，未通过直接拒绝，保证只有本人能导出
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(401).json({ error: '账号不存在' });

    const hasPassword = !!user.password;
    const wantEncrypt = encrypt === '1';
    // 有密码账号：必须提供并校验正确的登录密码
    if (hasPassword) {
      if (!password) return res.status(400).json({ error: '请输入登录密码以导出数据库' });
      if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: '密码错误，只有本人能导出数据库' });
      }
    }
    // 无密码账号：无需密码校验。

    // 解析用于包裹库钥匙的「导出密码」：
    //   - 勾选加密：
    //       有密码账号：dbPassword 留空则默认用账号密码；填了则以输入框为准。
    //       无密码账号：必须提供 dbPassword（否则没有口令可供派生包裹钥匙）。
    //   - 不勾选加密：库钥匙明文随包带回，换机免密恢复。
    let wrapPwd = null;
    if (wantEncrypt) {
      if (hasPassword) {
        wrapPwd = dbPassword && dbPassword.length ? dbPassword : password;
      } else {
        if (!dbPassword || !dbPassword.length) {
          return res.status(400).json({ error: '该账号未设置密码，请设置一个导出密码以加密备份' });
        }
        wrapPwd = dbPassword;
      }
    }

    const bundle = dbManager.exportBundle(slug);
    const data = require('fs').readFileSync(bundle.filePath).toString('base64');
    const out = {
      version: 2,
      slug: bundle.slug,
      username: bundle.username,
      data,
    };
    if (wantEncrypt) {
      // 库钥匙用导出密码派生钥匙包裹，换机后可用该密码解包恢复
      out.wrappedByPassword = dbManager.wrapKeyBySecret(bundle.key, wrapPwd);
    } else {
      // 未加密：库钥匙明文随包带回，换机免密恢复
      out.key = bundle.key;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 备份恢复：上传一个备份包，覆盖当前登录班主任的库并重建缓存连接。
// 校验库身份：仅允许与当前登录账号一致的备份包。
router.post('/restore', auth(), (req, res) => {
  try {
    const { data, wrappedByPassword, wrappedByMnemonic, password, mnemonic, key } = req.body || {};
    const curSlug = req.user && req.user.dbSlug ? req.user.dbSlug : 'default';
    const dbKey = dbManager.decryptBundleKey({ key, wrappedByPassword, wrappedByMnemonic, password, mnemonic });
    const result = dbManager.restoreBundle({ slug: curSlug, username: req.user.username, data, dbKey });
    res.json({ message: '恢复成功', slug: result.slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 备份恢复（离线引导，无需登录）：用于「新电脑只装了全新软件、无任何数据」时，
// 上传 v2 备份包 + 输入密码或助记词之一，解出库钥匙还原账号与数据。
// 若本机 registry 中已存在「同一 slug」的账号（即同一用户），覆盖前需二次确认，
// 以免误恢复盖掉本机已有数据。前端确认后带 confirm:true 才会真正落盘。
router.post('/restore-offline', (req, res) => {
  try {
    const { data, slug, wrappedByPassword, wrappedByMnemonic, password, mnemonic, key } = req.body || {};
    const dbKey = dbManager.decryptBundleKey({ key, wrappedByPassword, wrappedByMnemonic, password, mnemonic });
    // 用备份包自带的账号名登记（index 中该账号才可登录）
    const username = req.body && req.body.username;

    // 已存在同一 slug 的库，且尚未确认覆盖 -> 先拒绝并让前端弹确认
    const existing = dbManager.registryFindBySlug(slug);
    if (existing && !req.body.confirm) {
      return res.status(409).json({
        needConfirm: true,
        message: `本机已存在账号「${existing.username}」，恢复将覆盖其现有数据，是否确认？`,
      });
    }

    const result = dbManager.restoreBundle({ slug, username, data, dbKey });
    res.json({ message: '恢复成功', slug: result.slug, username: result.username || username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 修改用户名
router.put('/username', auth(), (req, res) => {
  try {
    const { newUsername, password } = req.body;
    if (!newUsername || !password) {
      return res.status(400).json({ error: '请输入新用户名和当前密码' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: '密码错误' });
    }

    // 检查新用户名是否已被占用
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(newUsername);
    if (existing && existing.id !== req.user.userId) {
      return res.status(400).json({ error: '该用户名已被占用' });
    }

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, req.user.userId);
    res.json({ message: '用户名修改成功', username: newUsername });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改密码
router.put('/password', auth(), (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请输入原密码和新密码' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(400).json({ error: '原密码错误' });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.userId);
    res.json({ message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;