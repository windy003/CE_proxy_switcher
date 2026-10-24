// 页面元素
const mainView = document.getElementById('mainView');
const formView = document.getElementById('formView');
const rulesView = document.getElementById('rulesView');
const proxyStatus = document.getElementById('proxyStatus');
const profilesList = document.getElementById('profilesList');
const formTitle = document.getElementById('formTitle');
const editingIndex = document.getElementById('editingIndex');
const profileName = document.getElementById('profileName');
const proxyType = document.getElementById('proxyType');
const proxyHost = document.getElementById('proxyHost');
const proxyPort = document.getElementById('proxyPort');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelProfileBtn = document.getElementById('cancelProfileBtn');
const openRulesBtn = document.getElementById('openRulesBtn');
const backBtn = document.getElementById('backBtn');
const defaultActionSelect = document.getElementById('defaultAction');
const rulePatternInput = document.getElementById('rulePattern');
const ruleActionSelect = document.getElementById('ruleAction');
const addRuleBtn = document.getElementById('addRuleBtn');
const rulesList = document.getElementById('rulesList');
const clearRulesBtn = document.getElementById('clearRulesBtn');
const siteCard = document.getElementById('siteCard');
const siteHost = document.getElementById('siteHost');
const siteProxyBtn = document.getElementById('siteProxyBtn');
const siteDirectBtn = document.getElementById('siteDirectBtn');
const siteResetBtn = document.getElementById('siteResetBtn');
const siteHint = document.getElementById('siteHint');

// 状态变量
let profiles = [];
let currentProfileIndex = -1;
let selectedIndex = 0;
let proxyEnabled = false;
let rules = [];
let defaultAction = 'proxy';
let currentSite = null;
let pacFallbackWarned = false;

// 统一处理后台返回的代理设置结果
function checkProxyResponse(response, context) {
  if (!response) return true;

  if (response.ok === false) {
    alert(`${context}失败：` + (response.error || '未知错误'));
    return false;
  }

  if (response.pacFallback && !pacFallbackWarned) {
    pacFallbackWarned = true;
    alert('当前 Chrome 无法启用按网站分流，已自动回退为全局代理。\n' + (response.pacError || ''));
  }

  return true;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  await loadCurrentSite();
  renderProfiles();
  renderRules();
  setupKeyboardNavigation();
});

// 加载数据
async function loadData() {
  const data = await chrome.storage.local.get([
    'profiles', 'currentProfileIndex', 'proxyEnabled', 'rules', 'defaultAction'
  ]);
  profiles = data.profiles || [];
  currentProfileIndex = data.currentProfileIndex ?? -1;
  proxyEnabled = data.proxyEnabled || false;
  rules = (data.rules || [])
    .filter(rule => rule && typeof rule.pattern === 'string' && rule.pattern.trim())
    .map(rule => ({
      pattern: rule.pattern.trim(),
      action: rule.action === 'direct' ? 'direct' : 'proxy'
    }));
  defaultAction = data.defaultAction === 'direct' ? 'direct' : 'proxy';

  // 自动选中"对面"的选项，方便快速切换
  // 如果当前是直连，则选中第一个代理配置；如果当前是代理，则选中直连
  if (proxyEnabled) {
    // 当前使用代理，选中直连选项
    selectedIndex = -1;
  } else {
    // 当前是直连，选中第一个代理配置（如果存在）
    selectedIndex = profiles.length > 0 ? 0 : -1;
  }

  updateStatus();
}

// 当前网站实际走代理还是直连（PAC 模式下按规则和默认动作判断）
function getCurrentSiteAction() {
  if (!proxyEnabled) return 'direct';
  if (!currentSite) return 'proxy';
  if (isAlwaysDirectHost(currentSite.host)) return 'direct';

  const usePac = rules.length > 0 || defaultAction === 'direct';
  if (!usePac) return 'proxy';

  const matching = findMatchingRule();
  return matching ? matching.action : defaultAction;
}

// 更新状态显示：走代理显示蓝色，直连显示灰色
function updateStatus() {
  const currentProfile = proxyEnabled && currentProfileIndex >= 0
    ? profiles[currentProfileIndex]
    : null;

  if (proxyEnabled && getCurrentSiteAction() === 'proxy') {
    proxyStatus.textContent = currentProfile ? `已启用 - ${currentProfile.name}` : '已启用';
    proxyStatus.className = 'status-text enabled';
  } else if (proxyEnabled) {
    proxyStatus.textContent = '直连（当前网站）';
    proxyStatus.className = 'status-text disabled';
  } else {
    proxyStatus.textContent = '直连';
    proxyStatus.className = 'status-text disabled';
  }
}

// 转义 HTML，避免配置名或规则中的特殊字符破坏页面
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

// 读取当前标签页的网站
async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      currentSite = null;
      renderSiteCard();
      return;
    }

    const url = new URL(tab.url);
    currentSite = {
      url: tab.url,
      host: url.hostname,
      pattern: getSitePattern(url.hostname)
    };
  } catch (error) {
    console.error('Failed to read current tab:', error);
    currentSite = null;
  }

  renderSiteCard();
}

// www.example.com -> example.com，让规则同时覆盖 www 和其他子域名
function getSitePattern(host) {
  const lower = host.toLowerCase();
  return lower.startsWith('www.') && lower.length > 4 ? lower.slice(4) : lower;
}

// 与后台 PAC 规则保持一致的单条规则匹配
function ruleMatches(rule, url, host) {
  const raw = rule.pattern.trim();
  if (!raw) return false;

  if (raw.includes('://')) {
    if (raw.includes('*')) {
      return globMatch(url, raw);
    }
    if (raw.endsWith('/')) {
      return url.indexOf(raw) === 0;
    }
    return url.indexOf(raw) === 0 &&
      (url.length === raw.length || '/?#:'.indexOf(url.charAt(raw.length)) !== -1);
  }

  const pattern = raw.toLowerCase();
  const siteHost = host.toLowerCase();

  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return siteHost === base || siteHost.endsWith('.' + base);
  }
  if (pattern.includes('*')) {
    return globMatch(siteHost, pattern);
  }
  return siteHost === pattern || siteHost.endsWith('.' + pattern);
}

function globMatch(value, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$').test(value);
}

function actionLabel(action) {
  return action === 'direct' ? '直连' : '走代理';
}

// 找到当前网站命中的第一条规则
function findMatchingRule() {
  if (!currentSite) return null;
  return rules.find(rule => ruleMatches(rule, currentSite.url, currentSite.host)) || null;
}

// 判断规则是否是针对当前网站本身设置的（非通配符、非 URL 规则）
function isSameHostPattern(pattern, site) {
  const p = pattern.trim().toLowerCase();
  if (!p || p.includes('://') || p.includes('*')) return false;
  return p === site.host.toLowerCase() || p === site.pattern;
}

function isAlwaysDirectHost(host) {
  const h = host.toLowerCase();
  return h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '[::1]' ||
    h.startsWith('127.') ||
    /^[0-9.]+$/.test(h) ||
    h.indexOf('.') === -1;
}

// 渲染当前网站卡片
function renderSiteCard() {
  updateStatus();

  if (!currentSite) {
    siteCard.classList.add('hidden');
    return;
  }

  siteCard.classList.remove('hidden');
  siteHost.textContent = currentSite.host;

  const localOnly = isAlwaysDirectHost(currentSite.host);
  const matching = localOnly ? null : findMatchingRule();
  const effectiveAction = matching ? matching.action : defaultAction;
  const hasOwnRule = rules.some(rule => isSameHostPattern(rule.pattern, currentSite));

  siteProxyBtn.classList.toggle('active', !localOnly && effectiveAction === 'proxy');
  siteDirectBtn.classList.toggle('active', !localOnly && effectiveAction === 'direct');
  siteProxyBtn.disabled = localOnly;
  siteDirectBtn.disabled = localOnly;
  siteResetBtn.classList.toggle('hidden', localOnly || !hasOwnRule);

  if (localOnly) {
    siteHint.textContent = '本地地址始终直连，无需设置规则';
  } else if (matching) {
    siteHint.textContent = `命中规则 ${matching.pattern}：${actionLabel(matching.action)}`;
  } else {
    siteHint.textContent = `未命中规则，跟随默认：${actionLabel(defaultAction)}`;
  }

  if (!localOnly && !proxyEnabled) {
    siteHint.textContent += '（代理未启用，规则将在启用后生效）';
  }
}

// 针对当前网站设置走代理 / 直连
async function setSiteAction(action) {
  if (!currentSite) return;

  // 先移除该网站已有的规则，再插到最前面，确保它优先于宽泛规则
  rules = rules.filter(rule => !isSameHostPattern(rule.pattern, currentSite));
  rules.unshift({ pattern: currentSite.pattern, action });

  await saveRules();

  // 选择"走代理"但代理整体未启用时，自动启用一个配置，否则设置不会生效
  if (action === 'proxy' && !proxyEnabled) {
    await enableProxyForSite();
  }
}

// 自动启用代理（优先使用上次启用的配置，否则使用第一个）
async function enableProxyForSite() {
  if (profiles.length === 0) {
    alert('请先创建一个代理配置');
    return;
  }

  const index = (currentProfileIndex >= 0 && profiles[currentProfileIndex])
    ? currentProfileIndex
    : 0;

  const response = await chrome.runtime.sendMessage({ action: 'setProfile', index });
  if (!checkProxyResponse(response, '启用代理')) {
    return;
  }

  proxyEnabled = true;
  currentProfileIndex = index;
  selectedIndex = -1;
  updateStatus();
  renderProfiles();
  renderSiteCard();
}

// 移除当前网站的专属规则，恢复跟随默认
async function resetSiteRule() {
  if (!currentSite) return;
  rules = rules.filter(rule => !isSameHostPattern(rule.pattern, currentSite));
  await saveRules();
}

// 渲染配置列表
function renderProfiles() {
  profilesList.innerHTML = '';

  // 添加"直连"选项
  const directItem = document.createElement('div');
  directItem.className = 'profile-item direct-item' +
    (selectedIndex === -1 ? ' selected' : '') +
    (!proxyEnabled ? ' active' : '');
  directItem.dataset.index = '-1';
  directItem.innerHTML = `
    <div class="profile-name">直连 (不使用代理)</div>
    <div class="profile-status">${!proxyEnabled ? '✓ 当前' : ''}</div>
  `;
  profilesList.appendChild(directItem);

  // 添加配置列表
  if (profiles.length === 0) {
    const emptyHint = document.createElement('div');
    emptyHint.className = 'empty-hint';
    emptyHint.textContent = '按 N 添加第一个代理配置';
    profilesList.appendChild(emptyHint);
  } else {
    profiles.forEach((profile, index) => {
      const profileItem = document.createElement('div');
      profileItem.className = 'profile-item' +
        (index === selectedIndex ? ' selected' : '') +
        (index === currentProfileIndex && proxyEnabled ? ' active' : '');
      profileItem.dataset.index = index;

      profileItem.innerHTML = `
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(profile.name)}</div>
          <div class="profile-details">${escapeHtml(profile.type.toUpperCase())} ${escapeHtml(profile.host)}:${escapeHtml(profile.port)}</div>
        </div>
        <div class="profile-status">${index === currentProfileIndex && proxyEnabled ? '✓ 当前' : ''}</div>
      `;

      profilesList.appendChild(profileItem);
    });
  }
}

// 渲染网站规则
function renderRules() {
  defaultActionSelect.value = defaultAction;
  rulesList.innerHTML = '';

  if (rules.length === 0) {
    const emptyHint = document.createElement('div');
    emptyHint.className = 'empty-hint';
    emptyHint.textContent = '还没有规则，添加后即可按网站决定走代理还是直连';
    rulesList.appendChild(emptyHint);
    return;
  }

  rules.forEach((rule, index) => {
    const ruleItem = document.createElement('div');
    ruleItem.className = 'rule-item';
    ruleItem.dataset.index = index;
    ruleItem.innerHTML = `
      <span class="rule-pattern" title="${escapeHtml(rule.pattern)}">${escapeHtml(rule.pattern)}</span>
      <button class="rule-badge ${rule.action === 'proxy' ? 'proxy' : 'direct'}" data-role="toggle">
        ${rule.action === 'proxy' ? '走代理' : '直连'}
      </button>
      <button class="rule-delete" data-role="delete" title="删除规则">×</button>
    `;
    rulesList.appendChild(ruleItem);
  });
}

// 键盘导航
function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // 如果在表单视图中
    if (!formView.classList.contains('hidden')) {
      handleFormKeyboard(e);
      return;
    }

    // 如果在规则视图中
    if (!rulesView.classList.contains('hidden')) {
      handleRulesKeyboard(e);
      return;
    }

    // 焦点在按钮上时，让按钮自己处理 Enter / 空格
    if (e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) {
      return;
    }

    // 主视图键盘操作
    switch(e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        break;
      case 'Enter':
        e.preventDefault();
        applySelectedProfile();
        break;
      case 'e':
      case 'E':
        e.preventDefault();
        editSelectedProfile();
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        deleteSelectedProfile();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        showAddForm();
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        showRulesView();
        break;
      case 'Escape':
        window.close();
        break;
    }
  });
}

// 移动选择
function moveSelection(delta) {
  const maxIndex = profiles.length - 1;
  selectedIndex += delta;

  // -1 是直连选项
  if (selectedIndex < -1) {
    selectedIndex = maxIndex;
  } else if (selectedIndex > maxIndex) {
    selectedIndex = -1;
  }

  renderProfiles();
}

// 应用选中的配置
async function applySelectedProfile() {
  let response = null;

  if (selectedIndex === -1) {
    // 选择了直连
    response = await chrome.runtime.sendMessage({ action: 'clearProxy' });
    await chrome.storage.local.set({
      proxyEnabled: false,
      currentProfileIndex: -1
    });
  } else {
    // 选择了某个代理配置
    response = await chrome.runtime.sendMessage({
      action: 'setProfile',
      index: selectedIndex
    });
  }

  if (!checkProxyResponse(response, '应用代理配置')) {
    return;
  }

  await loadData();
  renderProfiles();

  // 延迟关闭，让用户看到变化
  setTimeout(() => window.close(), 200);
}

// 编辑选中的配置
function editSelectedProfile() {
  if (selectedIndex < 0) return; // 不能编辑直连
  if (selectedIndex >= profiles.length) return;

  const profile = profiles[selectedIndex];
  formTitle.textContent = '编辑代理配置';
  editingIndex.value = selectedIndex;
  profileName.value = profile.name;
  proxyType.value = profile.type;
  proxyHost.value = profile.host;
  proxyPort.value = profile.port;

  showFormView();
}

// 删除选中的配置
async function deleteSelectedProfile() {
  if (selectedIndex < 0) return; // 不能删除直连
  if (selectedIndex >= profiles.length) return;

  const profile = profiles[selectedIndex];
  if (!confirm(`确定要删除配置"${profile.name}"吗？`)) return;

  profiles.splice(selectedIndex, 1);

  // 更新当前配置索引
  let newCurrentIndex = currentProfileIndex;
  if (currentProfileIndex === selectedIndex) {
    newCurrentIndex = -1;
    await chrome.runtime.sendMessage({ action: 'clearProxy' });
  } else if (currentProfileIndex > selectedIndex) {
    newCurrentIndex = currentProfileIndex - 1;
  }

  await chrome.storage.local.set({
    profiles: profiles,
    currentProfileIndex: newCurrentIndex
  });

  // 调整选择索引
  if (selectedIndex >= profiles.length) {
    selectedIndex = profiles.length - 1;
  }

  await loadData();
  renderProfiles();
}

// 显示添加表单
function showAddForm() {
  formTitle.textContent = '新建代理配置';
  editingIndex.value = '';
  profileName.value = '';
  proxyType.value = 'http';
  proxyHost.value = '';
  proxyPort.value = '';

  showFormView();
}

// 显示表单视图
function showFormView() {
  mainView.classList.add('hidden');
  formView.classList.remove('hidden');
  profileName.focus();
}

// 隐藏表单视图
function hideFormView() {
  formView.classList.add('hidden');
  mainView.classList.remove('hidden');
}

// 表单键盘操作
function handleFormKeyboard(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideFormView();
  } else if (e.key === 'Enter' && !e.shiftKey) {
    // 如果不在 textarea 中，Enter 保存
    if (e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      saveProfile();
    }
  }
}

// 保存配置
async function saveProfile() {
  const name = profileName.value.trim();
  const type = proxyType.value;
  const host = proxyHost.value.trim();
  const port = parseInt(proxyPort.value);

  if (!name || !host || !port) {
    alert('请填写完整的配置信息');
    return;
  }

  const profile = { name, type, host, port };
  const index = editingIndex.value;

  if (index === '') {
    profiles.push(profile);
    selectedIndex = profiles.length - 1;
  } else {
    profiles[parseInt(index)] = profile;
  }

  await chrome.storage.local.set({ profiles: profiles });

  hideFormView();
  await loadData();
  renderProfiles();
}

// 显示网站规则视图
function showRulesView() {
  renderRules();
  mainView.classList.add('hidden');
  rulesView.classList.remove('hidden');
  rulePatternInput.value = '';
  ruleActionSelect.value = 'proxy';
  rulePatternInput.focus();
}

// 隐藏网站规则视图
function hideRulesView() {
  rulesView.classList.add('hidden');
  mainView.classList.remove('hidden');
}

// 规则视图键盘操作
function handleRulesKeyboard(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideRulesView();
  } else if (e.key === 'Enter' && e.target === rulePatternInput) {
    e.preventDefault();
    addRule();
  }
}

// 添加规则
async function addRule() {
  const pattern = rulePatternInput.value.trim();
  if (!pattern) {
    rulePatternInput.focus();
    return;
  }

  const action = ruleActionSelect.value;
  const existingIndex = rules.findIndex(
    rule => rule.pattern.toLowerCase() === pattern.toLowerCase()
  );

  if (existingIndex >= 0) {
    // 相同规则更新动作，避免重复
    rules[existingIndex].action = action;
  } else {
    rules.push({ pattern, action });
  }

  rulePatternInput.value = '';
  rulePatternInput.focus();
  await saveRules();
}

// 保存规则并让后台重新应用代理
async function saveRules() {
  await chrome.storage.local.set({ rules, defaultAction });

  if (proxyEnabled) {
    const response = await chrome.runtime.sendMessage({ action: 'refreshProxy' });
    checkProxyResponse(response, '应用网站规则');
  }

  renderRules();
  renderSiteCard();
}

// 规则列表点击：切换动作或删除
rulesList.addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const item = button.closest('.rule-item');
  if (!item) return;

  const index = parseInt(item.dataset.index, 10);

  if (button.dataset.role === 'delete') {
    rules.splice(index, 1);
  } else if (button.dataset.role === 'toggle') {
    rules[index].action = rules[index].action === 'proxy' ? 'direct' : 'proxy';
  } else {
    return;
  }

  await saveRules();
});

// 配置列表点击：单击选中，双击应用
profilesList.addEventListener('click', (e) => {
  const item = e.target.closest('.profile-item');
  if (!item) return;
  selectedIndex = parseInt(item.dataset.index, 10);
  renderProfiles();
});

profilesList.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.profile-item');
  if (!item) return;
  selectedIndex = parseInt(item.dataset.index, 10);
  applySelectedProfile();
});

// 默认动作切换
defaultActionSelect.addEventListener('change', async () => {
  defaultAction = defaultActionSelect.value;
  await saveRules();
});

// 按钮事件
saveProfileBtn.addEventListener('click', saveProfile);
cancelProfileBtn.addEventListener('click', hideFormView);
openRulesBtn.addEventListener('click', showRulesView);
backBtn.addEventListener('click', hideRulesView);
addRuleBtn.addEventListener('click', addRule);
clearRulesBtn.addEventListener('click', async () => {
  if (rules.length === 0 && defaultAction === 'proxy') return;
  if (!confirm('确定要清空所有网站规则，并恢复为"未匹配的网站走代理"吗？')) return;

  rules = [];
  defaultAction = 'proxy';
  await saveRules();
});
siteProxyBtn.addEventListener('click', () => setSiteAction('proxy'));
siteDirectBtn.addEventListener('click', () => setSiteAction('direct'));
siteResetBtn.addEventListener('click', resetSiteRule);
