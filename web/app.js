'use strict';
const $ = (s, root = document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
} [c]));
const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M15 6.5h3M15 17.5h3"/>',
    tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3"/>',
    pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.server}</svg>`;
const states = {
    online: '在线',
    offline: '离线',
    pending: '待连接',
    revoked: '已撤销',
    running: '运行中',
    stopped: '已停止',
    unknown: '待核对',
    queued: '等待中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消'
};
const badge = status => `<span class="badge ${esc(status)}">${status === 'online' ? '<span class="dot"></span>' : ''}${esc(states[status] || status)}</span>`;
const names = {
    vless: 'VLESS Reality',
    hy2: 'Hysteria2',
    snell: 'Snell v4',
    'snell-v5': 'Snell v5',
    'snell-v6': 'Snell v6'
};
const actions = {
    install: '安装协议',
    update: '修改端口',
    delete: '卸载实例',
    restart: '重启服务',
    start: '启动服务',
    stop: '停止服务',
    user_add: '新增用户',
    user_update: '修改用户',
    user_delete: '删除用户',
    share: '导出连接',
    inspect: '检查实例'
};
const bytes = n => n == null ? '—' : n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GiB' : n >= 1048576 ? (n / 1048576).toFixed(0) + ' MiB' : (n / 1024).toFixed(0) + ' KiB';
const date = n => n ? new Date(n * 1000).toLocaleString('zh-CN', {
    hour12: false
}) : '—';
const brand = `<div class="brand"><span class="brand-mark">V</span><div>vaio<span> panel</span><small>YOUR NODES. ONE PLACE.</small></div></div>`;
let csrf = '',
    nodes = [],
    tasks = [],
    selected = null,
    detailTab = 'protocols',
    search = '',
    lastRefresh = '',
    authenticated = false;
let currentScript = '',
    activeTaskId = null,
    refreshBusy = false;

async function api(path, options = {}) {
    const response = await fetch('/api' + path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            ...options.headers
        },
        credentials: 'same-origin'
    });
    const data = await response.json();
    if (!response.ok) {
        if (response.status === 401 && path !== '/login') {
            authenticated = false;
            login();
        }
        throw new Error(data.error || '请求失败');
    }
    return data;
}
const post = (path, data = {}, headers = {}) => api(path, {
    method: 'POST',
    body: JSON.stringify(data),
    headers
});

function toast(text) {
    $('#toast').textContent = text;
    $('#toast').style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('#toast').style.display = 'none', 4500);
}

function modal(title, body, wide = false) {
    const dialog = $('#modal');
    dialog.className = wide ? 'wide' : '';
    dialog.innerHTML = `<div class="modal-head"><h2 id="dialog-title">${esc(title)}</h2><button class="quiet" data-action="close" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
    if (!dialog.open) dialog.showModal();
}

function formError(error) {
    const target = $('#modal .error');
    if (target) target.textContent = error.message;
    else toast(error.message);
}

function login() {
    $('#app').innerHTML = `<main class="login-page"><section class="login-story">${brand}<div><div class="eyebrow">INFRASTRUCTURE, CONNECTED</div><h1>所有节点。<br>一个控制台。</h1><p>从服务器状态到协议与用户管理，<br>让分散的基础设施回到同一个视野。</p><div class="login-graphic"><span>${icon('server')}</span><i></i><span>${icon('grid')}</span><i></i><span>${icon('server')}</span></div></div><footer>VAIO PANEL / 自托管节点管理平台</footer></section><section class="login-form"><form class="login-box" id="login-form"><div class="eyebrow">WELCOME BACK</div><h2>登录控制台</h2><p class="subtext">使用主服务器上设置的管理员密码。</p><label for="password">管理员密码</label><input id="password" type="password" required autocomplete="current-password" placeholder="输入管理员密码"><button class="primary" type="submit">进入控制台 ${icon('arrow')}</button><div class="error" role="alert"></div><p class="login-note">${icon('lock')} 凭据仅用于此自托管面板。首次使用请先在主服务器初始化密码。</p></form></section></main>`;
    $('#login-form').addEventListener('submit', async e => {
        e.preventDefault();
        const button = $('button', e.target);
        button.disabled = true;
        try {
            const data = await post('/login', {
                password: $('#password').value
            });
            csrf = data.csrf;
            authenticated = true;
            await refresh();
        } catch (err) {
            $('.error', e.target).textContent = err.message;
        } finally {
            button.disabled = false;
        }
    });
}

function shell(content, section) {
    $('#app').innerHTML = `<div class="shell"><aside class="sidebar">${brand}<div class="nav-label">WORKSPACE</div><nav class="nav" aria-label="主导航"><a href="#overview" class="${section==='overview'?'active':''}">${icon('grid')}总览</a><a href="#nodes" class="${section==='nodes'?'active':''}">${icon('server')}服务器节点</a><a href="#tasks" class="${section==='tasks'?'active':''}">${icon('tasks')}任务记录</a><a href="#audit" class="${section==='audit'?'active':''}">${icon('shield')}操作审计</a></nav><div class="sidebar-bottom"><div class="release"><b>VAIO / v0.1.0</b><br>轻量、自托管、集中管理</div><span class="dot"></span> 节点主动连接 · TLS</div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs">工作空间 <span>/</span> <strong>${({overview:'运行总览',nodes:'服务器节点',tasks:'任务记录',audit:'操作审计'})[section]}</strong></div><div class="top-actions"><span class="live"><span class="dot"></span>更新于 ${esc(lastRefresh)}</span><span class="avatar" aria-label="管理员">AD</span><button class="quiet small" data-action="logout">退出</button></div></header><main class="main">${content}<div class="footer-note"><span>Vaio Panel · 让每个节点尽在掌握</span><span>状态每 10 秒刷新 · 离线数据为最后快照</span></div></main></div></div>`;
}

function stat(title, value, foot, ico, positive = false) {
    return `<div class="stat"><div class="stat-top">${title}${icon(ico)}</div><div class="stat-value">${value}</div><div class="stat-foot ${positive?'positive':''}">${foot}</div></div>`;
}

function summary() {
    const online = nodes.filter(n => n.status === 'online').length;
    const count = nodes.reduce((s, n) => s + (n.snapshot.instances || []).length, 0);
    return `<div class="stats">${stat('服务器节点',nodes.length,'集中管理你的基础设施','server')}${stat('当前在线',online,online ? '心跳连接正常' : '等待节点建立连接','pulse',!!online)}${stat('协议实例',count,'按协议和监听端口独立识别','globe')}${stat('进行中的任务',tasks.filter(t=>['running','queued'].includes(t.status)).length,'执行过程与结果可追溯','tasks')}</div>`;
}

function emptyNodes() {
    return `<div class="panel"><div class="empty"><div class="empty-icon">${icon('server')}</div><h3>连接你的第一台服务器</h3><p>为服务器生成专属安装脚本。在节点执行后，它会自动出现在这里；确认接管后即可管理协议。</p><button class="primary" data-action="add-node">${icon('plus')}添加服务器</button></div><div class="onboarding"><div class="step"><span class="step-number">1</span><div><b>添加节点</b><p>设置名称与分组</p></div></div><div class="step"><span class="step-number">2</span><div><b>运行安装脚本</b><p>节点主动连接主面板</p></div></div><div class="step"><span class="step-number">3</span><div><b>开始集中管理</b><p>识别现有配置并确认接管</p></div></div></div></div>`;
}

function card(node) {
    const s = node.snapshot,
        m = s.metrics || {},
        instances = s.instances || [];
    const memory = m.memory_total ? Math.min(100, m.memory_used / m.memory_total * 100) : null;
    const disk = m.disk_total ? Math.min(100, m.disk_used / m.disk_total * 100) : null;
    return `<article class="node-card"><div class="node-top"><div class="node-symbol">${icon('server')}</div>${badge(node.status)}</div><h3><a href="#nodes/${node.id}">${esc(node.name)}</a></h3><div class="node-group">${esc(node.group_name)} · ${esc(s.hostname || '等待首次连接')}</div><div class="node-metrics"><div><div class="metric-caption"><span>内存</span><span>${memory==null?'—':memory.toFixed(0)+'%'}</span></div><progress value="${memory||0}" max="100" aria-label="内存使用率"></progress></div><div><div class="metric-caption"><span>磁盘</span><span>${disk==null?'—':disk.toFixed(0)+'%'}</span></div><progress value="${disk||0}" max="100" aria-label="磁盘使用率"></progress></div></div><div class="node-footer"><div class="protocol-chips">${[...new Set(instances.map(i=>i.protocol))].slice(0,3).map(p=>`<span>${esc(p.toUpperCase())}</span>`).join('')||'<span>暂无协议</span>'}</div><span>${instances.length} 个实例 ${icon('arrow')}</span></div></article>`;
}

function nodeCards() {
    const filtered = nodes.filter(n => (n.name + ' ' + n.group_name + ' ' + (n.snapshot.hostname || '')).toLowerCase().includes(search.toLowerCase()));
    return filtered.length ? `<div class="node-grid">${filtered.map(card).join('')}</div>` : '<div class="panel empty"><p>没有匹配的服务器。</p></div>';
}

function taskTable(list) {
    return list.length ? `<div class="table-wrap"><table><thead><tr><th>操作 / 实例</th><th>服务器</th><th>状态</th><th>创建时间</th><th>结果</th></tr></thead><tbody>${list.map(t=>`<tr><td><strong>${esc(actions[t.action]||t.action)}</strong><br><span class="muted mono">${esc(t.request.protocol)} : ${t.request.port}</span></td><td>${esc(t.node_name)}</td><td>${badge(t.status)}</td><td class="muted mono">${date(t.created)}</td><td><button class="small" data-action="task" data-id="${t.id}">查看记录</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>暂无任务。节点上的操作会在这里留下记录。</p></div>';
}

function overview(section) {
    shell(`<div class="heading"><div><div class="eyebrow">${section==='overview'?'YOUR INFRASTRUCTURE AT A GLANCE':'CONNECTED SERVERS'}</div><h1>${section==='overview'?'运行总览':'服务器节点'}</h1><p class="subtext">${section==='overview'?'服务器、协议与任务，尽在一个工作空间。':'连接、分组并管理你的所有服务器。'}</p></div><button class="primary" data-action="add-node">${icon('plus')}添加服务器</button></div>${summary()}<div class="section-label"><h2>我的服务器 <span class="count">${nodes.length}</span></h2><div class="tools"><div class="search">${icon('search')}<input id="search" type="search" aria-label="搜索服务器" placeholder="搜索名称或分组" value="${esc(search)}"></div></div></div><div id="node-results">${nodes.length?nodeCards():emptyNodes()}</div>${section==='overview'?`<div class="section-label"><h2>最近任务</h2><a href="#tasks">查看全部 →</a></div><div class="panel">${taskTable(tasks.slice(0,5))}</div>`:''}`, section);
    $('#search').addEventListener('input', e => {
        search = e.target.value;
        $('#node-results').innerHTML = nodeCards();
    });
}

function protocolTable(node) {
    const instances = node.snapshot.instances || [];
    return instances.length ? `<div class="table-wrap"><table><thead><tr><th>协议 / 内核</th><th>监听端口</th><th>服务状态</th><th>用户</th><th>管理</th></tr></thead><tbody>${instances.map((p,index)=>`<tr><td><strong>${esc(names[p.protocol]||p.protocol)}</strong><br><span class="muted">${esc(p.core==='xray'&&!p.protocol.startsWith('snell')?'Xray':p.core==='singbox'?'Sing-box':'独立进程')}</span></td><td class="mono">${p.port}</td><td>${badge(p.status)}</td><td>${(p.users||[]).length} 位</td><td><button class="small" data-action="instance" data-index="${index}">${p.managed?'管理实例':'查看实例'}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-icon">${icon('globe')}</div><h3>尚未发现协议实例</h3><p>确认接管后，可以安装 VLESS Reality、Hysteria2 或 Snell。</p><button class="primary" data-action="install" ${!node.adopted||node.status!=='online'?'disabled':''}>${icon('plus')}安装协议</button></div>`;
}

function detail(node) {
    selected = node;
    const s = node.snapshot,
        m = s.metrics || {};
    shell(`<div class="heading"><div><div class="eyebrow"><a href="#nodes">SERVERS / 服务器节点</a></div><h1>${esc(node.name)} ${badge(node.status)}</h1><div class="detail-info"><span>${esc(node.group_name)}</span><span>${esc(s.hostname||'等待连接')}</span><span>${esc(s.arch||'—')}</span><span>Agent ${esc(s.agent_version||'—')}</span></div></div><div class="action-row"><button data-action="node-settings">节点设置</button><button class="primary" data-action="install" ${!node.adopted||node.status!=='online'?'disabled':''}>${icon('plus')}安装协议</button></div></div>${s.error?`<div class="notice warn">${esc(s.error)}</div>`:''}${!node.adopted?`<div class="notice"><div><strong>${node.status==='pending'?'等待节点连接':'配置已识别，尚未接管'}</strong><br>${node.status==='pending'?'在服务器运行安装脚本，节点将自动上线。':'请检查下面的协议与端口。接管后面板可以修改节点配置。'}</div><button data-action="${node.status==='pending'?'renew':'adopt'}" ${node.status==='offline'?'disabled':''}>${node.status==='pending'?'重新生成脚本':'确认接管'}</button></div>`:''}${node.status==='offline'?'<div class="notice warn">节点已离线，以下为最后一次上报的数据。恢复连接后可继续管理。</div>':''}<div class="stats">${stat('系统负载',m.load??'—',`${m.cpu_count||'—'} 个逻辑核心`,'pulse')}${stat('内存使用',m.memory_total?(m.memory_used/m.memory_total*100).toFixed(0)+'%':'—',bytes(m.memory_used)+' / '+bytes(m.memory_total),'server')}${stat('磁盘使用',m.disk_total?(m.disk_used/m.disk_total*100).toFixed(0)+'%':'—',bytes(m.disk_used)+' / '+bytes(m.disk_total),'grid')}${stat('协议实例',(s.instances||[]).length,'配置以节点实际状态为准','globe')}</div><div class="tabs"><button data-action="tab" data-tab="protocols" class="${detailTab==='protocols'?'active':''}">协议管理</button><button data-action="tab" data-tab="tasks" class="${detailTab==='tasks'?'active':''}">执行记录</button></div><div class="split"><section><div class="panel"><div class="panel-head"><h2>${detailTab==='protocols'?'已安装协议':'节点任务'} <span class="count">${detailTab==='protocols'?(s.instances||[]).length:tasks.filter(t=>t.node_id===node.id).length}</span></h2><button class="quiet small" data-action="refresh">${icon('refresh')}刷新</button></div>${detailTab==='protocols'?protocolTable(node):taskTable(tasks.filter(t=>t.node_id===node.id))}</div></section><aside><div class="panel info-block"><h3>节点信息</h3><div class="kv"><span>系统</span><span>${esc(s.os||'—')}</span></div><div class="kv"><span>运行时间</span><span>${m.uptime?Math.floor(m.uptime/86400)+' 天':'—'}</span></div><div class="kv"><span>网卡累计接收</span><span>${bytes(m.network_rx)}</span></div><div class="kv"><span>网卡累计发送</span><span>${bytes(m.network_tx)}</span></div><div class="kv"><span>最后心跳</span><span>${date(node.last_seen)}</span></div><div class="kv"><span>流量同步</span><span>${esc(s.traffic_status||'unavailable')}</span></div></div><div class="panel info-block"><h3>${icon('shield')} 操作说明</h3><p>共享核心的配置修改会重启对应核心，可能短暂影响同服务的其他协议。</p><p>不支持写入的协议仅展示状态。配置备份保留在节点本地。</p></div></aside></div>`, 'nodes');
}
async function render() {
    const route = location.hash.slice(1) || 'overview';
    if (route.startsWith('nodes/')) {
        const node = nodes.find(n => n.id === route.split('/')[1]);
        if (node) detail(node);
        else shell('<div class="empty"><h3>节点不存在</h3><a href="#nodes">返回节点列表</a></div>', 'nodes');
    } else if (route === 'tasks') {
        shell(`<div class="heading"><div><div class="eyebrow">OPERATIONS</div><h1>任务记录</h1><p class="subtext">安装、修改与卸载的执行结果，集中追溯。</p></div><button data-action="refresh">${icon('refresh')}刷新</button></div><div class="notice">执行结果未确认的任务不会自动重试。请检查节点实际状态后再发起新操作。</div><div class="panel">${taskTable(tasks)}</div>`, 'tasks');
    } else if (route === 'audit') {
        const data = await api('/audit');
        shell(`<div class="heading"><div><div class="eyebrow">AUDIT TRAIL</div><h1>操作审计</h1><p class="subtext">最近 200 条管理事件，不包含密码和私钥。</p></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>节点</th><th>说明</th></tr></thead><tbody>${data.events.map(e=>`<tr><td class="mono">${date(e.at)}</td><td>${esc(e.event)}</td><td>${esc(nodes.find(n=>n.id===e.node_id)?.name||'—')}</td><td>${esc(e.detail)}</td></tr>`).join('')}</tbody></table></div></div>`, 'audit');
    } else overview(route === 'nodes' ? 'nodes' : 'overview');
}
async function refresh() {
    if (refreshBusy || !authenticated) return;
    refreshBusy = true;
    try {
        const [n, t] = await Promise.all([api('/nodes'), api('/tasks')]);
        nodes = n.nodes;
        tasks = t.tasks;
        lastRefresh = new Date().toLocaleTimeString('zh-CN', {
            hour12: false
        });
        if (document.activeElement?.id !== 'search') await render();
        if (activeTaskId && $('#modal').open) showTask(activeTaskId);
    } catch (err) {
        toast(err.message);
    } finally {
        refreshBusy = false;
    }
}

function enrollment(data) {
    currentScript = data.script;
    modal('节点安装脚本', `<p>在目标服务器以 root 执行此脚本，完成后节点自动上线。一次性注册凭据有效期为 <strong>30 分钟</strong>。</p><div class="notice warn">此文件含注册凭据，请勿公开分享，安装后删除。</div><label for="install-script">专属安装脚本</label><textarea id="install-script" readonly rows="9">${esc(data.script)}</textarea><p class="helper">下载后执行：<code>sudo sh vaio-agent-install.sh</code></p><div class="modal-foot"><button data-action="copy-script">复制脚本</button><button class="primary" data-action="download-script">下载安装脚本</button></div>`, true);
}

function addNode() {
    modal('添加服务器', `<form id="node-form"><p>添加节点信息，然后在服务器运行专属安装脚本。</p><label for="node-name">服务器名称</label><input id="node-name" name="name" required maxlength="80" placeholder="例如：香港 · 主节点" autocomplete="off"><label for="node-group">分组</label><input id="node-group" name="group_name" maxlength="40" value="默认分组"><div class="error" role="alert"></div><div class="modal-foot"><button type="button" data-action="close">取消</button><button class="primary" type="submit">生成安装脚本 ${icon('arrow')}</button></div></form>`);
    $('#node-form').addEventListener('submit', async e => {
        e.preventDefault();
        const b = $('[type=submit]', e.target);
        b.disabled = true;
        try {
            const data = await post('/nodes', Object.fromEntries(new FormData(e.target)));
            enrollment(data);
            await refresh();
        } catch (err) {
            formError(err);
        } finally {
            b.disabled = false;
        }
    });
}

function showInstance(index) {
    activeTaskId = null;
    const p = selected.snapshot.instances[index];
    if (!p) return;
    const writable = p.managed && selected.adopted && selected.status === 'online';
    modal(`${names[p.protocol]||p.protocol} · ${p.port}`, `<p>服务：<code>${esc(p.service)}</code> ${badge(p.status)}</p>${!p.managed?'<div class="notice warn">此实例首版只读。支持的写入范围：Xray VLESS Reality、无端口跳跃的 Hysteria2、Snell。</div>':''}<div class="action-row"><button data-action="edit-port" data-index="${index}" ${writable?'':'disabled'}>修改端口</button><button data-action="${p.status==='running'?'stop':'start'}" data-index="${index}" ${writable?'':'disabled'}>${p.status==='running'?'停止服务':'启动服务'}</button><button data-action="restart" data-index="${index}" ${writable?'':'disabled'}>重启服务</button><button class="danger" data-action="delete" data-index="${index}" ${writable?'':'disabled'}>卸载此实例</button></div><label>实例用户</label><div class="table-wrap"><table><thead><tr><th>用户</th><th>已用 / 配额</th><th>状态</th><th>操作</th></tr></thead><tbody>${(p.users||[]).map((u,i)=>`<tr><td><strong>${esc(u.name)}</strong><br><span class="muted">${esc(u.expire_date||'永不过期')}</span></td><td>${bytes(u.used)} / ${u.quota?bytes(u.quota):'不限'}</td><td>${badge(u.enabled?'running':'stopped')}</td><td><button class="small" data-action="edit-user" data-index="${index}" data-user="${i}" ${writable?'':'disabled'}>编辑</button><button class="small" data-action="share" data-index="${index}" data-user="${i}" ${p.managed&&selected.status==='online'?'':'disabled'}>连接</button></td></tr>`).join('')}</tbody></table></div><p class="helper">用户流量来自节点数据库，依赖原脚本统计任务；无统计接口时不代表真实用量为零。</p><div class="modal-foot"><button data-action="add-user" data-index="${index}" ${writable&&!p.protocol.startsWith('snell')?'':'disabled'}>新增用户</button><button data-action="close">关闭</button></div>`, true);
}
async function submitTask(action, p, params = {}) {
    const data = await post('/nodes/' + selected.id + '/tasks', {
        action,
        protocol: p.protocol,
        core: p.core,
        port: p.port,
        params,
        revision: selected.snapshot.revision
    }, {
        'Idempotency-Key': crypto.randomUUID()
    });
    activeTaskId = data.id;
    await refresh();
    showTask(data.id);
}

function showTask(id) {
    activeTaskId = id;
    const t = tasks.find(t => t.id === id);
    if (!t) {
        modal('任务已提交', '<p>等待节点领取任务…</p>');
        return;
    }
    const r = t.result || {};
    modal(actions[t.action] + ' · 执行记录', `<p>${badge(t.status)} <span class="mono">${esc(t.request.protocol)}:${t.request.port}</span> · ${esc(t.node_name)}</p><div class="kv"><span>创建时间</span><span>${date(t.created)}</span></div><div class="kv"><span>开始时间</span><span>${date(t.started)}</span></div><div class="kv"><span>完成时间</span><span>${date(t.finished)}</span></div><p>${esc(t.message||'等待节点执行，请保持 Agent 在线。')}</p>${r.steps?`<pre>${r.steps.map((x,i)=>(i+1)+'. '+esc(x)).join('\n')}</pre>`:''}${r.backup?`<p>节点备份：<code>${esc(r.backup)}</code></p>`:''}${r.connection?`<label for="connection">连接信息（10 分钟后过期）</label><textarea id="connection" readonly>${esc(r.connection)}</textarea><button data-action="copy-connection">复制连接信息</button>`:''}${t.action==='share'&&!r.connection&&t.status==='succeeded'?'<p>连接信息已过期，请重新导出。</p>':''}<div class="modal-foot">${t.status==='queued'?`<button data-action="cancel-task" data-id="${id}">取消等待</button>`:''}<button data-action="close">关闭</button></div>`, true);
}

function install() {
    modal('安装协议实例', `<form id="install-form"><p>新实例使用独立端口，保留已有协议配置。请自行在云安全组和防火墙放行对应端口。</p><label for="protocol">协议</label><select id="protocol" name="protocol">${Object.entries(names).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><div class="form-grid"><div><label for="port">监听端口</label><input id="port" name="port" type="number" min="1" max="65535" value="24443" required></div><div><label for="sni">SNI 域名</label><input id="sni" name="sni" value="www.microsoft.com" required></div></div><p class="helper">VLESS 使用 Xray；Hysteria2 使用自签证书，导出链接包含 insecure=1。Snell 不使用 SNI。</p><div class="notice warn">安装可能需要数分钟。共享核心会重启，相关协议可能短暂中断。</div><div class="error" role="alert"></div><div class="modal-foot"><button type="button" data-action="close">取消</button><button type="submit" class="primary">安装实例</button></div></form>`);
    $('#protocol').addEventListener('change', e => {
        $('#sni').disabled = e.target.value.startsWith('snell');
    });
    $('#install-form').addEventListener('submit', async e => {
        e.preventDefault();
        const b = $('[type=submit]', e.target);
        b.disabled = true;
        const p = $('#protocol').value;
        try {
            await submitTask('install', {
                protocol: p,
                core: p === 'hy2' ? 'singbox' : 'xray',
                port: Number($('#port').value)
            }, p.startsWith('snell') ? {
                name: 'u' + $('#port').value
            } : {
                sni: $('#sni').value
            });
        } catch (err) {
            formError(err);
            b.disabled = false;
        }
    });
}

function editUser(index, userIndex) {
    const p = selected.snapshot.instances[index],
        u = userIndex == null ? null : p.users[userIndex];
    modal(u ? '编辑用户' : '新增用户', `<form id="user-form"><label for="username">用户名</label><input id="username" value="${esc(u?.name||'')}" pattern="[A-Za-z0-9_-]{1,32}" maxlength="32" required ${u?'readonly':''}><label for="expiry">到期日期</label><input id="expiry" type="date" value="${esc(u?.expire_date||'')}"><p class="helper">留空表示永不过期。按节点本地日期判断，每分钟检查。</p>${u?`<label class="field-check"><input id="enabled" type="checkbox" ${u.enabled?'checked':''}>启用此用户</label>`:''}<p class="helper">凭据自动生成。配额设置首版仅展示，沿用原脚本。</p><div class="error" role="alert"></div><div class="modal-foot">${u&&u.name!=='default'&&!p.protocol.startsWith('snell')?`<button type="button" class="danger" data-action="delete-user" data-index="${index}" data-user="${userIndex}">删除用户</button>`:''}<button type="submit" class="primary">${u?'保存修改':'创建用户'}</button></div></form>`);
    $('#user-form').addEventListener('submit', async e => {
        e.preventDefault();
        const b = $('[type=submit]', e.target);
        b.disabled = true;
        try {
            const params = {
                name: $('#username').value,
                expire_date: $('#expiry').value
            };
            if (u) params.enabled = $('#enabled').checked;
            await submitTask(u ? 'user_update' : 'user_add', p, params);
        } catch (err) {
            formError(err);
            b.disabled = false;
        }
    });
}

function confirmTask(action, p, params = {}) {
    const affected = selected.snapshot.instances.filter(i => i.service === p.service);
    modal(actions[action], `<p>目标：<strong>${esc(names[p.protocol]||p.protocol)} · ${p.port}</strong></p><div class="notice warn">${action==='delete'?'将删除此端口实例及其用户。':'操作会修改节点运行状态。'}${affected.length>1?` 该服务共承载 ${affected.length} 个实例，服务启停影响全部实例；应用配置会短暂重启共享服务。`:''}</div><p>节点会保存配置备份；请核对目标后执行。</p><div class="error" role="alert"></div><div class="modal-foot"><button data-action="close">取消</button><button id="confirm-task" class="${action.includes('delete')?'danger':'primary'}">确认${actions[action]}</button></div>`);
    $('#confirm-task').addEventListener('click', async e => {
        e.target.disabled = true;
        try {
            await submitTask(action, p, params);
        } catch (err) {
            formError(err);
            e.target.disabled = false;
        }
    });
}
document.addEventListener('click', async e => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const action = b.dataset.action,
        index = Number(b.dataset.index),
        p = selected?.snapshot.instances?.[index];
    try {
        if (action === 'close') {
            $('#modal').close();
            activeTaskId = null;
        } else if (action === 'logout') {
            await post('/logout');
            authenticated = false;
            csrf = '';
            $('#modal').close();
            login();
        } else if (action === 'refresh') await refresh();
        else if (action === 'add-node') addNode();
        else if (action === 'task') showTask(b.dataset.id);
        else if (action === 'cancel-task') {
            await post('/tasks/' + b.dataset.id + '/cancel');
            await refresh();
        } else if (action === 'tab') {
            detailTab = b.dataset.tab;
            detail(selected);
        } else if (action === 'instance') showInstance(index);
        else if (action === 'install') install();
        else if (action === 'renew') {
            enrollment(await post('/nodes/' + selected.id + '/enrollment'));
            await refresh();
        } else if (action === 'adopt') {
            modal('确认接管节点', `<p>面板已识别 ${selected.snapshot.instances.length} 个协议实例。确认后可进行安装、修改和卸载。现有代理配置不会因接管而改变。</p><p>接管期间请避免同时在 SSH 菜单中修改配置。</p><div class="error"></div><div class="modal-foot"><button data-action="close">取消</button><button id="confirm-adopt" class="primary">确认接管</button></div>`);
            $('#confirm-adopt').onclick = async () => {
                try {
                    await post('/nodes/' + selected.id + '/adopt', {
                        revision: selected.snapshot.revision
                    });
                    $('#modal').close();
                    toast('节点已接管');
                    await refresh();
                } catch (err) {
                    formError(err);
                }
            };
        } else if (action === 'node-settings') {
            modal('节点设置', `<p>${esc(selected.name)}</p><p>重新注册会立即撤销旧身份，并要求再次确认接管。撤销身份只停止面板管理，不会停止已运行的代理服务。</p><div class="action-row"><button data-action="renew">重新生成安装脚本</button><button class="danger" data-action="revoke">撤销节点身份</button></div>`);
        } else if (action === 'revoke') {
            modal('撤销节点身份', `<p>撤销后该节点无法继续连接面板，等待中的任务会取消。已在节点执行的任务无法远程中止。</p><div class="modal-foot"><button data-action="close">取消</button><button class="danger" id="confirm-revoke">确认撤销</button></div>`);
            $('#confirm-revoke').onclick = async () => {
                try {
                    await post('/nodes/' + selected.id + '/revoke');
                    $('#modal').close();
                    await refresh();
                } catch (err) {
                    toast(err.message);
                }
            };
        } else if (action === 'copy-script') {
            await navigator.clipboard.writeText(currentScript);
            toast('安装脚本已复制');
        } else if (action === 'download-script') {
            const url = URL.createObjectURL(new Blob([currentScript], {
                type: 'text/x-shellscript'
            }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'vaio-agent-install.sh';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else if (action === 'copy-connection') {
            await navigator.clipboard.writeText($('#connection').value);
            toast('连接信息已复制');
        } else if (action === 'add-user') editUser(index, null);
        else if (action === 'edit-user') editUser(index, Number(b.dataset.user));
        else if (action === 'delete-user') confirmTask('user_delete', p, {
            name: p.users[Number(b.dataset.user)].name
        });
        else if (['delete', 'restart', 'start', 'stop'].includes(action)) confirmTask(action, p);
        else if (action === 'edit-port') {
            modal('修改监听端口', `<form id="port-form"><p>此修改会重启 ${esc(p.service)}，影响同服务上的其他实例。</p><label for="new-port">新端口</label><input id="new-port" type="number" min="1" max="65535" required value="${p.port}"><div class="error"></div><div class="modal-foot"><button type="submit" class="primary">保存并应用</button></div></form>`);
            $('#port-form').onsubmit = async e => {
                e.preventDefault();
                const b = $('[type=submit]', e.target);
                b.disabled = true;
                try {
                    await submitTask('update', p, {
                        port: Number($('#new-port').value)
                    });
                } catch (err) {
                    formError(err);
                    b.disabled = false;
                }
            };
        } else if (action === 'share') {
            const user = p.users[Number(b.dataset.user)];
            modal('导出连接信息', `<form id="share-form"><p>为用户 ${esc(user.name)} 生成连接信息。结果仅保留 10 分钟。</p><label for="share-host">节点公网 IP 或域名</label><input id="share-host" required placeholder="例如：node.example.com"><div class="error"></div><div class="modal-foot"><button class="primary" type="submit">生成连接</button></div></form>`);
            $('#share-form').onsubmit = async e => {
                e.preventDefault();
                const b = $('[type=submit]', e.target);
                b.disabled = true;
                try {
                    await submitTask('share', p, {
                        name: user.name,
                        host: $('#share-host').value
                    });
                } catch (err) {
                    formError(err);
                    b.disabled = false;
                }
            };
        }
    } catch (err) {
        toast(err.message);
    }
});
$('#modal').addEventListener('close', () => {
    activeTaskId = null;
    currentScript = '';
});
window.addEventListener('hashchange', () => {
    if (authenticated) render().catch(e => toast(e.message));
});
async function boot() {
    try {
        const session = await api('/session');
        csrf = session.csrf;
        authenticated = true;
        await refresh();
    } catch {
        login();
    }
}
setInterval(() => {
    if (authenticated) refresh();
}, 10000);
boot();
