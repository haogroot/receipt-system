/* ═══════════════════════════════════════════════
   旅行收據管家 - SPA Application
   ═══════════════════════════════════════════════ */

// ─── Globals ───
let currentPage = 'dashboard';
let chartInstances = {};

const CATEGORY_EMOJI = {
    '餐飲': '🍜', '交通': '🚃', '購物': '🛍️',
    '住宿': '🏨', '娛樂': '🎮', '其他': '📦',
};

const CATEGORY_COLORS = {
    '餐飲': '#ef4444', '交通': '#06b6d4', '購物': '#a855f7',
    '住宿': '#f59e0b', '娛樂': '#ec4899', '其他': '#6b7280',
};

let PAYMENT_LABELS = {};
let PAYMENT_METHODS = [];
let COMPANIONS = [];
let CC_BUDGETS = {}; // { "管理員": "卡名:預算, ...", "Alice": "卡名:預算" }

// Helper: parse a payer's cc budget string into { cardName: budgetAmount }
function parseCcBudgets(budgetStr) {
    const result = {};
    if (!budgetStr) return result;
    budgetStr.split(',').forEach(cstr => {
        const parts = cstr.split(':');
        if (parts.length >= 2) {
            const amt = parseFloat(parts[1]);
            if (!isNaN(amt)) result[parts[0].trim()] = amt;
        }
    });
    return result;
}

// Helper: get all unique card names across all payers
function getAllCardNames() {
    const names = new Set();
    Object.values(CC_BUDGETS).forEach(budgetStr => {
        if (!budgetStr) return;
        budgetStr.split(',').forEach(cstr => {
            const name = cstr.split(':')[0].trim();
            if (name) names.add(name);
        });
    });
    return [...names];
}

// ─── API Helpers ───
async function api(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

async function apiUpload(url, formData) {
    try {
        const res = await fetch(url, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

// ─── Toast Notifications ───
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── Loading ───
function showLoading(text = '辨識中...') {
    document.querySelector('.loading-text').textContent = text;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// ─── Formatting ───
function formatAmount(amount, currency = '') {
    const num = Number(amount) || 0;
    const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return currency ? `${currency} ${formatted}` : formatted;
}

function formatDate(dateStr) {
    if (!dateStr) return '未知日期';
    return dateStr;
}

function relativeDate(dateStr) {
    if (!dateStr) return '';
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today) return '今天';
    if (dateStr === yesterday) return '昨天';
    return dateStr;
}

// ─── Navigation ───
function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Update header text
    const titles = { dashboard: '旅行收據管家', upload: '上傳收據', stats: '統計分析', history: '歷史紀錄', settings: '設定' };
    document.getElementById('header-text').textContent = titles[page] || '旅行收據管家';

    // Render page
    renderPage(page);
}

function renderPage(page) {
    const content = document.getElementById('app-content');

    // Destroy chart instances
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};

    const renderers = {
        dashboard: renderDashboard,
        upload: renderUpload,
        stats: renderStats,
        history: renderHistory,
        settings: renderSettings,
    };

    const renderer = renderers[page];
    if (renderer) {
        renderer(content);
    }
}


// ═══════════════════════════════════════════════
//  DASHBOARD PAGE
// ═══════════════════════════════════════════════
async function renderDashboard(container) {
    container.innerHTML = '<div class="page-enter"><div class="stat-grid" id="stat-cards"></div><div id="budget-section"></div><div id="cc-section"></div><div id="recent-section"></div></div>';

    try {
        const data = await api('/api/dashboard');
        const trip = data.active_trip;

        // Stat cards
        const statCards = document.getElementById('stat-cards');
        statCards.innerHTML = `
            <div class="stat-card primary">
                <div class="stat-label">今日花費</div>
                <div class="stat-value">${formatAmount(data.today_total)}</div>
                <div class="stat-sub">${data.today_count} 筆消費</div>
            </div>
            <div class="stat-card success">
                <div class="stat-label">旅程累計</div>
                <div class="stat-value">${formatAmount(data.trip_total)}</div>
                <div class="stat-sub">${data.trip_count} 筆消費</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-label">現金已用</div>
                <div class="stat-value">${formatAmount(data.cash_spent)}</div>
                <div class="stat-sub">${trip ? trip.currency : ''}</div>
            </div>
            <div class="stat-card info">
                <div class="stat-label">目前旅程</div>
                <div class="stat-value" style="font-size:1rem">${trip ? trip.name : '未設定'}</div>
                <div class="stat-sub">${trip ? (trip.start_date || '') : '點擊右上角設定'}</div>
            </div>
        `;

        // Budget progress
        const budgetSection = document.getElementById('budget-section');
        if (trip && trip.budget_cash > 0) {
            const pct = Math.min((data.cash_spent / trip.budget_cash) * 100, 100);
            const barClass = pct > 90 ? 'danger' : pct > 70 ? 'warning' : '';
            budgetSection.innerHTML = `
                <div class="card budget-card">
                    <div class="card-header">
                        <span class="card-title">💰 現金預算進度</span>
                        <span style="font-size:0.85rem;font-weight:700;color:var(--text-primary)">${pct.toFixed(0)}%</span>
                    </div>
                    <div class="budget-bar-container">
                        <div class="budget-bar ${barClass}" style="width:${pct}%"></div>
                    </div>
                    <div class="budget-info">
                        <span>已使用 ${formatAmount(data.cash_spent)}</span>
                        <span>預算 ${formatAmount(trip.budget_cash)} ${trip.currency}</span>
                    </div>
                </div>
            `;
        } else {
            budgetSection.innerHTML = '';
        }

        // Credit card breakdown by payer (tab-based)
        const ccSection = document.getElementById('cc-section');
        // Update global CC_BUDGETS from API response
        if (data.cc_budgets) CC_BUDGETS = data.cc_budgets;

        const ccByPayer = data.cc_spent_by_payer || {};
        const payersWithCC = Object.keys(ccByPayer);
        // Also include payers who have budget config but no spending yet
        Object.keys(CC_BUDGETS).forEach(p => {
            if (!payersWithCC.includes(p) && CC_BUDGETS[p]) payersWithCC.push(p);
        });

        if (payersWithCC.length > 0) {
            const firstPayer = payersWithCC[0];
            ccSection.innerHTML = `
                <div class="card" style="margin-bottom:20px">
                    <div class="card-title">💳 信用卡消費 (依付款者)</div>
                    <div class="cc-payer-tabs" style="display:flex;gap:6px;margin:10px 0;flex-wrap:wrap">
                        ${payersWithCC.map((p, i) => `
                            <button class="btn btn-sm cc-payer-tab ${i === 0 ? 'btn-primary' : 'btn-secondary'}" data-payer="${p}" onclick="switchCcPayerTab(this, '${p.replace(/'/g, "\\'")}')" style="font-size:0.8rem;padding:4px 12px;border-radius:20px">
                                🙋 ${p}
                            </button>
                        `).join('')}
                    </div>
                    <div id="cc-payer-content" style="margin-top:8px"></div>
                </div>
            `;
            // Render first payer by default
            window._ccByPayer = ccByPayer;
            window._ccTrip = trip;
            renderCcPayerContent(firstPayer, ccByPayer, trip);
        } else {
            ccSection.innerHTML = '';
        }

        // Recent receipts
        const recentSection = document.getElementById('recent-section');
        if (data.recent_receipts && data.recent_receipts.length > 0) {
            recentSection.innerHTML = `
                <div class="section-title"><span class="emoji">📋</span> 最近消費</div>
                <div class="receipt-list">
                    ${data.recent_receipts.map(r => `
                        <div class="receipt-list-item" onclick="showReceiptDetail(${r.id})">
                            <div class="receipt-list-icon cat-${r.category || '其他'}">
                                ${CATEGORY_EMOJI[r.category] || '📦'}
                            </div>
                            <div class="receipt-list-info">
                                <div class="receipt-list-store">${r.store_name || '未知店家'}</div>
                                <div class="receipt-list-date">${relativeDate(r.date)} · ${PAYMENT_LABELS[r.payment_method] || r.payment_method}${r.credit_card_name ? ` (${r.credit_card_name})` : ''}</div>
                            </div>
                            <div class="receipt-list-amount">${formatAmount(r.total_amount)}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            recentSection.innerHTML = `
                <div class="empty-state">
                    <span class="empty-state-icon">📷</span>
                    <div class="empty-state-title">尚無收據紀錄</div>
                    <div class="empty-state-text">拍攝或上傳你的第一張收據，開始記錄旅行花費！</div>
                    <button class="btn btn-primary" style="margin-top:20px" onclick="navigateTo('upload')">上傳收據</button>
                </div>
            `;
        }
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">載入失敗</div><div class="empty-state-text">${err.message}</div></div>`;
    }
}


// ═══════════════════════════════════════════════
//  UPLOAD PAGE
// ═══════════════════════════════════════════════
function renderUpload(container) {
    container.innerHTML = `
        <div class="page-enter">
            <div class="upload-area" id="upload-drop-zone">
                <span class="upload-icon">📸</span>
                <div class="upload-title">拍照或上傳收據</div>
                <div class="upload-subtitle">支援 JPG、PNG、WebP 格式</div>
                <div class="upload-actions">
                    <label class="btn btn-primary">
                        📷 拍照
                        <input type="file" accept="image/*" capture="environment" class="upload-input" id="camera-input">
                    </label>
                    <label class="btn btn-secondary">
                        📁 選擇檔案
                        <input type="file" accept="image/*" class="upload-input" id="file-input" multiple>
                    </label>
                </div>
            </div>
            <div id="upload-preview-area"></div>
        </div>
    `;

    // Event listeners
    const cameraInput = document.getElementById('camera-input');
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('upload-drop-zone');

    cameraInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
    fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFileUpload(e.dataTransfer.files);
    });
}

async function handleFileUpload(files) {
    if (!files || files.length === 0) return;

    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            showToast('請上傳圖片檔案', 'error');
            continue;
        }

        showLoading('AI 辨識收據中...');

        const formData = new FormData();
        formData.append('image', file);

        try {
            const result = await apiUpload('/api/receipts/upload', formData);
            const trips = await api('/api/trips');
            const activeTrip = trips.find(t => t.is_active) || null;
            
            hideLoading();
            showToast('收據辨識成功！', 'success');
            showReceiptPreview(result, file, activeTrip);
        } catch (err) {
            hideLoading();
        }
    }
}

function showReceiptPreview(data, file, activeTrip) {
    const previewArea = document.getElementById('upload-preview-area');
    const imgUrl = file ? URL.createObjectURL(file) : (data.image_path ? `/uploads/${data.image_path}` : '');

    let ccOptionsHtml = '';
    const allCards = getAllCardNames();
    if (allCards.length > 0) {
        ccOptionsHtml = `
            <select class="form-select" style="margin-top:8px;font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCard(${data.id}, this.value)">
                <option value="">-- 指定信用卡 --</option>
                ${allCards.map(c => `<option value="${c}" ${data.credit_card_name === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
        `;
    }

    previewArea.innerHTML = `
        <div class="receipt-preview">
            <div class="receipt-preview-card">
                ${imgUrl ? `<img src="${imgUrl}" class="image-preview" alt="receipt">` : ''}
                <div class="receipt-preview-header">
                    <div>
                        <div class="receipt-store">${data.store_name || '未知店家'}</div>
                        <div class="receipt-date">${formatDate(data.date)}</div>
                    </div>
                </div>
                <div class="receipt-items-list">
                    ${(data.items || []).map(item => `
                        <div class="receipt-item-row">
                            <span class="receipt-item-name">${item.name}</span>
                            <span class="receipt-item-qty">×${item.quantity}</span>
                            <span class="receipt-item-amount">${formatAmount(item.amount)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="receipt-total-row">
                    <span>合計</span>
                    <span class="receipt-total-amount">${data.currency || ''} ${formatAmount(data.total_amount)}</span>
                </div>
                <div class="receipt-meta" style="flex-wrap:wrap">
                    <span class="receipt-tag payment" style="cursor:pointer" onclick="changePaymentMethod(${data.id}, '${data.payment_method}')" title="點擊更改付款方式">${PAYMENT_LABELS[data.payment_method] || data.payment_method}</span>
                    <span class="receipt-tag category">${CATEGORY_EMOJI[data.category] || ''} ${data.category || '其他'}</span>
                    <span class="receipt-tag">${data.currency || 'JPY'}</span>
                    ${data.credit_card_name ? `<span class="receipt-tag" style="background:var(--bg-card);border:1px solid currentColor">${data.credit_card_name}</span>` : ''}
                </div>
                <div style="padding:0 20px 12px">
                   ${data.payment_method === 'credit_card' ? ccOptionsHtml : ''}
                   <select class="form-select" style="margin-top:8px;font-size:0.85rem;padding:4px 8px" onchange="updateReceiptPaidBy(${data.id}, this.value)">
                       <option value="">-- 由誰付款 --</option>
                       ${COMPANIONS.map(c => `<option value="${c}" ${(data.paid_by || '管理員') === c ? 'selected' : ''}>🙋 ${c}</option>`).join('')}
                   </select>
                </div>
                <div style="padding: 0 20px 12px">
                    <button class="btn btn-primary btn-full" onclick="navigateTo('upload')">繼續上傳</button>
                </div>
            </div>
        </div>
    `;
}


// ═══════════════════════════════════════════════
//  STATS PAGE
// ═══════════════════════════════════════════════
async function renderStats(container) {
    container.innerHTML = `
        <div class="page-enter">
            <div class="card chart-container" id="chart-daily">
                <div class="card-title">📈 每日花費趨勢</div>
                <div class="chart-wrapper"><canvas id="daily-chart"></canvas></div>
            </div>
            <div class="card chart-container" id="chart-category">
                <div class="card-title">🏷️ 類別佔比</div>
                <div class="chart-wrapper"><canvas id="category-chart"></canvas></div>
            </div>
            <div class="card chart-container" id="chart-payment">
                <div class="card-title">💳 支付方式分布</div>
                <div class="chart-wrapper"><canvas id="payment-chart"></canvas></div>
            </div>
            <div id="payers-section"></div>
            <div id="top10-section"></div>
        </div>
    `;

    try {
        const data = await api('/api/stats');

        // Daily trend line chart
        if (data.daily_trend && data.daily_trend.length > 0) {
            const ctx1 = document.getElementById('daily-chart').getContext('2d');
            chartInstances.daily = new Chart(ctx1, {
                type: 'line',
                data: {
                    labels: data.daily_trend.map(d => d.date.slice(5)),
                    datasets: [{
                        label: '花費',
                        data: data.daily_trend.map(d => d.total),
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 4,
                        pointBackgroundColor: '#6366f1',
                    }]
                },
                options: chartOptions(''),
            });
        }

        // Category doughnut chart
        if (data.categories && data.categories.length > 0) {
            const ctx2 = document.getElementById('category-chart').getContext('2d');
            chartInstances.category = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: data.categories.map(c => `${CATEGORY_EMOJI[c.category] || ''} ${c.category}`),
                    datasets: [{
                        data: data.categories.map(c => c.total),
                        backgroundColor: data.categories.map(c => CATEGORY_COLORS[c.category] || '#6b7280'),
                        borderColor: '#111827',
                        borderWidth: 2,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { color: '#94a3b8', font: { family: "'Inter','Noto Sans TC',sans-serif", size: 11 }, padding: 12 }
                        }
                    },
                    cutout: '65%',
                },
            });
        }

        // Payment method bar chart
        if (data.payment_methods && data.payment_methods.length > 0) {
            const pmColors = { credit_card: '#6366f1', ic_card: '#06b6d4', cash: '#10b981' };
            const ctx3 = document.getElementById('payment-chart').getContext('2d');
            chartInstances.payment = new Chart(ctx3, {
                type: 'bar',
                data: {
                    labels: data.payment_methods.map(p => PAYMENT_LABELS[p.payment_method] || p.payment_method),
                    datasets: [{
                        label: '金額',
                        data: data.payment_methods.map(p => p.total),
                        backgroundColor: data.payment_methods.map(p => pmColors[p.payment_method] || '#6b7280'),
                        borderRadius: 6,
                        barThickness: 32,
                    }]
                },
                options: chartOptions(''),
            });
        }

        // Payers
        const payersSection = document.getElementById('payers-section');
        if (data.payers && data.payers.length > 0) {
            payersSection.innerHTML = `
                <div class="section-title"><span class="emoji">👥</span> 同行者付款統計</div>
                <div class="card" style="margin-bottom:20px">
                    <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
                        ${data.payers.map(p => `
                            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px">
                                <span style="font-weight:500;color:var(--text-primary)">${p.paid_by || '管理員'}</span>
                                <span style="font-weight:700;color:var(--text-primary)">
                                    ${formatAmount(p.total)}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // TOP 10
        const top10Section = document.getElementById('top10-section');
        if (data.top10 && data.top10.length > 0) {
            const rankClass = (i) => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
            top10Section.innerHTML = `
                <div class="section-title"><span class="emoji">🏆</span> TOP 10 消費</div>
                <div class="card">
                    <div class="top10-list">
                        ${data.top10.map((t, i) => `
                            <div class="top10-item">
                                <div class="top10-rank ${rankClass(i)}">${i + 1}</div>
                                <div class="top10-info">
                                    <div class="top10-store">${t.store_name || '未知'}</div>
                                    <div class="top10-date">${t.date || ''} · ${t.category || ''}</div>
                                </div>
                                <div class="top10-amount">${formatAmount(t.total_amount)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Handle empty states
        if ((!data.daily_trend || data.daily_trend.length === 0) &&
            (!data.categories || data.categories.length === 0)) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-state-icon">📊</span>
                    <div class="empty-state-title">尚無統計資料</div>
                    <div class="empty-state-text">上傳一些收據後，這裡會顯示花費分析圖表</div>
                    <button class="btn btn-primary" style="margin-top:20px" onclick="navigateTo('upload')">上傳收據</button>
                </div>
            `;
        }

    } catch (err) {
        container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">載入失敗</div></div>`;
    }
}

function chartOptions(yLabel) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
        },
        scales: {
            x: {
                ticks: { color: '#64748b', font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.04)' },
            },
            y: {
                ticks: { color: '#64748b', font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.04)' },
                title: yLabel ? { display: true, text: yLabel, color: '#94a3b8' } : undefined,
            },
        },
    };
}


// ═══════════════════════════════════════════════
//  HISTORY PAGE
// ═══════════════════════════════════════════════
async function renderHistory(container) {
    container.innerHTML = '<div class="page-enter" id="history-content"></div>';
    const content = document.getElementById('history-content');

    try {
        const receipts = await api('/api/receipts');

        if (!receipts || receipts.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <span class="empty-state-icon">🧾</span>
                    <div class="empty-state-title">尚無收據紀錄</div>
                    <div class="empty-state-text">上傳收據後會顯示在這裡</div>
                    <button class="btn btn-primary" style="margin-top:20px" onclick="navigateTo('upload')">上傳收據</button>
                </div>
            `;
            return;
        }

        // Group by date
        const groups = {};
        receipts.forEach(r => {
            const d = r.date || '未知日期';
            if (!groups[d]) groups[d] = [];
            groups[d].push(r);
        });

        let html = '';
        for (const [date, items] of Object.entries(groups)) {
            const dayTotal = items.reduce((sum, r) => sum + (r.total_amount || 0), 0);
            html += `<div class="date-group-header">${relativeDate(date)}　${formatAmount(dayTotal)} ${items[0]?.currency || ''}</div>`;
            html += '<div class="receipt-list">';
            items.forEach(r => {
                html += `
                    <div class="receipt-list-item" onclick="showReceiptDetail(${r.id})">
                        <div class="receipt-list-icon cat-${r.category || '其他'}">
                            ${CATEGORY_EMOJI[r.category] || '📦'}
                        </div>
                        <div class="receipt-list-info">
                            <div class="receipt-list-store">${r.store_name || '未知店家'}</div>
                            <div class="receipt-list-date">${PAYMENT_LABELS[r.payment_method] || r.payment_method}${r.credit_card_name ? ` (${r.credit_card_name})` : ''}</div>
                        </div>
                        <div class="receipt-list-amount">${formatAmount(r.total_amount)}</div>
                    </div>
                `;
            });
            html += '</div>';
        }

        content.innerHTML = html;

    } catch (err) {
        content.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">載入失敗</div></div>`;
    }
}


// ═══════════════════════════════════════════════
//  RECEIPT DETAIL MODAL
// ═══════════════════════════════════════════════
async function showReceiptDetail(receiptId) {
    const modal = document.getElementById('receipt-modal');
    const body = document.getElementById('receipt-modal-body');
    modal.classList.remove('hidden');

    try {
        const [r, trips] = await Promise.all([
            api(`/api/receipts/${receiptId}`),
            api('/api/trips')
        ]);
        const activeTrip = trips.find(t => t.is_active) || null;

        let ccOptionsHtml = '';
        if (r.payment_method === 'credit_card') {
            const allCards = getAllCardNames();
            if (allCards.length > 0) {
                ccOptionsHtml = `
                    <div style="margin-bottom:12px">
                        <select class="form-select" style="font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCardDetail(${r.id}, this.value)">
                            <option value="">-- 指定信用卡 --</option>
                            ${allCards.map(c => `<option value="${c}" ${r.credit_card_name === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                `;
            }
        }

        body.innerHTML = `
            ${r.image_path ? `<img src="/uploads/${r.image_path}" class="image-preview" alt="receipt">` : ''}
            <div class="receipt-preview-card" style="border:none;background:transparent">
                <div class="receipt-preview-header" style="padding:0 0 12px">
                    <div>
                        <div class="receipt-store">${r.store_name || '未知店家'}</div>
                        <div class="receipt-date">${formatDate(r.date)}</div>
                    </div>
                </div>
                <div class="receipt-items-list" style="padding:0">
                    ${(r.items || []).map(item => `
                        <div class="receipt-item-row">
                            <span class="receipt-item-name">${item.name}</span>
                            <span class="receipt-item-qty">×${item.quantity}</span>
                            <span class="receipt-item-amount">${formatAmount(item.amount)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="receipt-total-row" style="margin:12px 0;border-radius:var(--radius-sm)">
                    <span>合計</span>
                    <span class="receipt-total-amount">${r.currency || ''} ${formatAmount(r.total_amount)}</span>
                </div>
                <div class="receipt-meta" style="padding:0;margin-bottom:8px;flex-wrap:wrap">
                    <span class="receipt-tag payment" style="cursor:pointer" onclick="changePaymentMethod(${r.id}, '${r.payment_method}')" title="點擊更改付款方式">${PAYMENT_LABELS[r.payment_method] || r.payment_method}</span>
                    <span class="receipt-tag category">${CATEGORY_EMOJI[r.category] || ''} ${r.category || '其他'}</span>
                    <span class="receipt-tag">${r.currency || ''}</span>
                    ${r.credit_card_name ? `<span class="receipt-tag" style="background:var(--bg-card);border:1px solid currentColor">${r.credit_card_name}</span>` : ''}
                </div>
                ${ccOptionsHtml}
                <div style="margin-bottom:12px">
                    <select class="form-select" style="font-size:0.85rem;padding:4px 8px" onchange="updateReceiptPaidByDetail(${r.id}, this.value)">
                        <option value="">-- 由誰付款 --</option>
                        ${COMPANIONS.map(c => `<option value="${c}" ${(r.paid_by || '管理員') === c ? 'selected' : ''}>🙋 ${c}</option>`).join('')}
                    </select>
                </div>
                ${r.note ? `<div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px">📝 ${r.note}</div>` : ''}
                <div style="display:flex;gap:8px">
                    <button class="btn btn-danger btn-sm" onclick="deleteReceiptConfirm(${r.id})">🗑️ 刪除</button>
                </div>
            </div>
        `;
    } catch (err) {
        body.innerHTML = '<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">載入失敗</div></div>';
    }
}

async function deleteReceiptConfirm(receiptId) {
    if (!confirm('確定要刪除這張收據嗎？')) return;

    try {
        await api(`/api/receipts/${receiptId}`, { method: 'DELETE' });
        showToast('收據已刪除', 'success');
        document.getElementById('receipt-modal').classList.add('hidden');
        renderPage(currentPage);
    } catch (err) {
        // Toast already shown by api()
    }
}

window.updateReceiptCard = async function(receiptId, cardName) {
    try {
        await api(`/api/receipts/${receiptId}`, {
            method: 'PUT',
            body: JSON.stringify({ credit_card_name: cardName })
        });
        showToast('已更新信用卡', 'success');
    } catch(e) {}
};

window.updateReceiptCardDetail = async function(receiptId, cardName) {
    try {
        await api(`/api/receipts/${receiptId}`, {
            method: 'PUT',
            body: JSON.stringify({ credit_card_name: cardName })
        });
        showToast('已更新信用卡', 'success');
        showReceiptDetail(receiptId);
    } catch(e) {}
};

window.updateReceiptPaidBy = async function(receiptId, paidBy) {
    try {
        await api(`/api/receipts/${receiptId}`, {
            method: 'PUT',
            body: JSON.stringify({ paid_by: paidBy })
        });
        showToast('已更新付款人', 'success');
    } catch(e) {}
};

window.updateReceiptPaidByDetail = async function(receiptId, paidBy) {
    try {
        await api(`/api/receipts/${receiptId}`, {
            method: 'PUT',
            body: JSON.stringify({ paid_by: paidBy })
        });
        showToast('已更新付款人', 'success');
        showReceiptDetail(receiptId);
    } catch(e) {}
};

window.changePaymentMethod = function(receiptId, currentMethod) {
    const modal = document.getElementById('payment-modal');
    const body = document.getElementById('payment-modal-body');
    modal.classList.remove('hidden');

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
            ${PAYMENT_METHODS.map(pm => `
                <button class="btn ${pm.id === currentMethod ? 'btn-primary' : 'btn-secondary'}"
                        onclick="updatePaymentMethod(${receiptId}, '${pm.id}')">
                    ${pm.label}
                </button>
            `).join('')}
        </div>
    `;
};

window.updatePaymentMethod = async function(receiptId, pmId) {
    document.getElementById('payment-modal').classList.add('hidden');
    try {
        await api(`/api/receipts/${receiptId}`, {
            method: 'PUT',
            body: JSON.stringify({ payment_method: pmId })
        });
        showToast('付款方式已更新', 'success');
        if (currentPage === 'dashboard') renderPage('dashboard');
        else if (currentPage === 'history') renderPage('history');
        const rModal = document.getElementById('receipt-modal');
        if (!rModal.classList.contains('hidden')) {
            showReceiptDetail(receiptId);
        }
    } catch(e) {}
};


// ═══════════════════════════════════════════════
//  SETTINGS PAGE
// ═══════════════════════════════════════════════
async function renderSettings(container) {
    container.innerHTML = '<div class="page-enter" id="settings-content">載入中...</div>';
    const content = document.getElementById('settings-content');

    try {
        const trips = await api('/api/trips');

        content.innerHTML = `
            <div class="section-title">✈️ 旅程管理</div>
            <div style="margin-bottom:20px">
                ${trips.length > 0 ? trips.map(t => `
                    <div class="trip-card ${t.is_active ? 'active' : ''}" onclick="setActiveTrip(${t.id}, ${!t.is_active})">
                        <div class="trip-card-name">${t.is_active ? '✅ ' : ''}${t.name}</div>
                        <div class="trip-card-dates">${t.start_date || ''} ~ ${t.end_date || ''}</div>
                        ${t.budget_cash > 0 ? `<div class="trip-card-budget" style="margin-bottom:8px">現金預算: ${formatAmount(t.budget_cash)} ${t.currency}</div>` : ''}
                    </div>
                `).join('') : '<div style="color:var(--text-muted);text-align:center;padding:20px">尚無旅程</div>'}
            </div>
            
            <div class="card" style="margin-bottom:30px">
                <div class="card-title">新增旅程</div>
                <div class="form-group">
                    <label class="form-label">旅程名稱</label>
                    <input id="trip-name" class="form-input" placeholder="例：2026 東京之旅">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">開始日期</label>
                        <input id="trip-start" class="form-input" type="date">
                    </div>
                    <div class="form-group">
                        <label class="form-label">結束日期</label>
                        <input id="trip-end" class="form-input" type="date">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">現金預算</label>
                        <input id="trip-budget" class="form-input" type="number" placeholder="50000">
                    </div>
                    <div class="form-group">
                        <label class="form-label">幣別</label>
                        <select id="trip-currency" class="form-select">
                            <option value="JPY">JPY 日圓</option>
                            <option value="USD">USD 美元</option>
                            <option value="EUR">EUR 歐元</option>
                            <option value="KRW">KRW 韓圓</option>
                            <option value="TWD">TWD 台幣</option>
                            <option value="GBP">GBP 英鎊</option>
                            <option value="THB">THB 泰銖</option>
                        </select>
                    </div>
                </div>
                <button class="btn btn-primary btn-full" onclick="createNewTrip()">建立旅程</button>
            </div>

            <div class="section-title">💳 付款方式管理</div>
            <div class="card" style="margin-bottom:30px">
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
                    ${PAYMENT_METHODS.map(pm => `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:var(--radius-sm);">
                            <div>
                                <div style="font-weight:500;">${pm.label}</div>
                                <div style="font-size:0.75rem; color:var(--text-secondary)">ID: ${pm.id}</div>
                            </div>
                            <button class="btn btn-danger btn-sm" onclick="deletePaymentMethod('${pm.id}')">刪除</button>
                        </div>
                    `).join('')}
                </div>
                <div style="font-size:0.9rem; margin:24px 0 12px; color:var(--text-primary); font-weight:600">新增付款方式</div>
                <div class="form-row">
                    <div class="form-group" style="flex:1">
                        <label class="form-label">代碼 (英文)</label>
                        <input id="pm-id" class="form-input" placeholder="例: line_pay">
                    </div>
                    <div class="form-group" style="flex:2">
                        <label class="form-label">顯示名稱 (含Emoji)</label>
                        <input id="pm-label" class="form-input" placeholder="例: 🟢 LINE Pay">
                    </div>
                </div>
                <button class="btn btn-secondary btn-full" onclick="addPaymentMethod()">新增</button>
            </div>

            <div class="section-title">👥 同行者管理</div>
            <div class="card" style="margin-bottom:30px">
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
                    ${COMPANIONS.map(c => `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:var(--radius-sm);">
                            <div style="font-weight:500;">🙋 ${c}</div>
                            <button class="btn btn-danger btn-sm" onclick="deleteCompanion('${c}')">刪除</button>
                        </div>
                    `).join('')}
                </div>
                <div style="font-size:0.9rem; margin:24px 0 12px; color:var(--text-primary); font-weight:600">新增同行者</div>
                <div class="form-row">
                    <div class="form-group" style="flex:1">
                        <input id="companion-name" class="form-input" placeholder="例: Alice">
                    </div>
                    <button class="btn btn-secondary" style="white-space:nowrap" onclick="addCompanion()">新增</button>
                </div>
            </div>

            <div class="section-title">💳 信用卡預算管理 (依付款者)</div>
            <div class="card" style="margin-bottom:30px">
                <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:16px">每位付款者可設定各自的信用卡和預算，格式：卡名:預算，用逗號分隔。新增卡片時預設預算為 50,000。</div>
                <div style="display:flex; flex-direction:column; gap:16px;">
                    ${COMPANIONS.map(c => `
                        <div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.06)">
                            <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px">🙋 ${c}</div>
                            <div style="display:flex;align-items:center;gap:8px">
                                <input type="text" id="cc-budget-${c}" value="${CC_BUDGETS[c] || ''}" class="form-input" style="flex:1;padding:6px 10px;font-size:0.85rem;background:rgba(255,255,255,0.05);color:white" placeholder="例: 國泰CUBE:50000, 台新FlyGo:50000">
                                <button class="btn btn-secondary btn-sm" style="padding:4px 10px;white-space:nowrap" onclick="saveCcBudget('${c.replace(/'/g, "\\'")}')">儲存</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = '<div class="empty-state">載入失敗</div>';
    }
}

async function createNewTrip() {
    const name = document.getElementById('trip-name').value.trim();
    if (!name) { showToast('請輸入旅程名稱', 'error'); return; }

    try {
        await api('/api/trips', {
            method: 'POST',
            body: JSON.stringify({
                name,
                start_date: document.getElementById('trip-start').value || null,
                end_date: document.getElementById('trip-end').value || null,
                budget_cash: parseFloat(document.getElementById('trip-budget').value) || 0,
                currency: document.getElementById('trip-currency').value,
            }),
        });
        showToast('旅程已建立！', 'success');
        if (currentPage === 'settings') renderPage('settings');
    } catch (err) {
        // Toast shown
    }
}

// Per-payer CC budget management
window.saveCcBudget = async function(payerName) {
    const input = document.getElementById(`cc-budget-${payerName}`);
    if (!input) return;
    CC_BUDGETS[payerName] = input.value.trim();
    try {
        await api('/api/settings/cc_budgets', {
            method: 'PUT',
            body: JSON.stringify({ value: CC_BUDGETS })
        });
        showToast(`${payerName} 的信用卡預算已更新`, 'success');
        if (currentPage === 'dashboard') renderPage('dashboard');
    } catch(e) {}
};

// Render CC content for a specific payer tab
function renderCcPayerContent(payerName, ccByPayer, trip) {
    const container = document.getElementById('cc-payer-content');
    if (!container) return;

    const payerCards = ccByPayer[payerName] || [];
    const budgets = parseCcBudgets(CC_BUDGETS[payerName]);

    // Merge: show cards with spending + cards with budget but no spending yet
    const cardNames = new Set(payerCards.map(c => c.credit_card_name));
    Object.keys(budgets).forEach(name => cardNames.add(name));

    if (cardNames.size === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:12px">此付款者尚無信用卡消費或預算設定</div>';
        return;
    }

    const currency = trip ? trip.currency : 'JPY';
    let html = '<div style="display:flex;flex-direction:column;gap:14px">';

    cardNames.forEach(cardName => {
        const spentEntry = payerCards.find(c => c.credit_card_name === cardName);
        const spent = spentEntry ? spentEntry.total : 0;
        const budget = budgets[cardName] || 0;

        let budgetHtml = '';
        if (budget > 0) {
            const pct = Math.min((spent / budget) * 100, 100);
            const barClass = spent > budget ? 'danger' : pct > 90 ? 'warning' : '';
            budgetHtml = `
                <div class="budget-bar-container" style="height:6px;margin-top:6px;background:rgba(255,255,255,0.05)">
                    <div class="budget-bar ${barClass}" style="width:${pct}%"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-secondary);margin-top:4px">
                    <span>預算: ${formatAmount(budget)} ${currency}</span>
                    <span>${pct.toFixed(0)}%</span>
                </div>
            `;
        }

        html += `
            <div style="border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:500;color:var(--text-primary)">${cardName}</span>
                    <span style="font-size:1.1rem;font-weight:700;color:${budget > 0 && spent > budget ? '#ef4444' : 'var(--text-primary)'}">
                        ${currency} ${formatAmount(spent)}
                    </span>
                </div>
                ${budgetHtml}
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

// Tab switching for cc payer
window.switchCcPayerTab = function(btn, payerName) {
    document.querySelectorAll('.cc-payer-tab').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
    });
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');

    // Re-render content — we stash the data on the window for reuse
    renderCcPayerContent(payerName, window._ccByPayer || {}, window._ccTrip || null);
};

async function setActiveTrip(tripId, activate) {
    try {
        // Deactivate all
        const trips = await api('/api/trips');
        for (const t of trips) {
            if (t.is_active) {
                await api(`/api/trips/${t.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ is_active: 0 }),
                });
            }
        }
        // Activate selected
        if (activate) {
            await api(`/api/trips/${tripId}`, {
                method: 'PUT',
                body: JSON.stringify({ is_active: 1 }),
            });
        }
        showToast('旅程已切換', 'success');
        if (currentPage === 'settings') renderPage('settings');
        if (currentPage === 'dashboard') renderPage('dashboard');
    } catch (err) {
        // Toast shown
    }
}

window.addPaymentMethod = async function() {
    const id = document.getElementById('pm-id').value.trim();
    const label = document.getElementById('pm-label').value.trim();
    if (!id || !label) { showToast('請填寫代碼與顯示名稱', 'error'); return; }
    if (PAYMENT_METHODS.find(pm => pm.id === id)) { showToast('該代碼已存在', 'error'); return; }

    const newList = [...PAYMENT_METHODS, { id, label }];
    await savePaymentMethods(newList);
};

window.deletePaymentMethod = async function(id) {
    if (PAYMENT_METHODS.length <= 1) { showToast('至少需保留一個付款方式', 'error'); return; }
    if (!confirm('確定要刪除這個付款方式嗎？')) return;

    const newList = PAYMENT_METHODS.filter(pm => pm.id !== id);
    await savePaymentMethods(newList);
};

async function savePaymentMethods(newList) {
    try {
        await api('/api/settings/payment_methods', {
            method: 'PUT',
            body: JSON.stringify({ value: newList })
        });
        PAYMENT_METHODS = newList;
        PAYMENT_LABELS = {};
        PAYMENT_METHODS.forEach(pm => { PAYMENT_LABELS[pm.id] = pm.label; });
        showToast('付款方式已更新', 'success');
        if (currentPage === 'settings') renderPage('settings');
    } catch(e) {}
}

window.addCompanion = async function() {
    const name = document.getElementById('companion-name').value.trim();
    if (!name) { showToast('請填寫同行者名稱', 'error'); return; }
    if (COMPANIONS.includes(name)) { showToast('該名字已存在', 'error'); return; }

    const newList = [...COMPANIONS, name];
    await saveCompanions(newList);
};

window.deleteCompanion = async function(name) {
    if (COMPANIONS.length <= 1) { showToast('至少需保留一名同行者', 'error'); return; }
    if (!confirm('確定要刪除這位同行者嗎？')) return;

    const newList = COMPANIONS.filter(c => c !== name);
    await saveCompanions(newList);
};

async function saveCompanions(newList) {
    try {
        await api('/api/settings/companions', {
            method: 'PUT',
            body: JSON.stringify({ value: newList })
        });
        COMPANIONS = newList;
        showToast('同行者名單已更新', 'success');
        if (currentPage === 'settings') renderPage('settings');
    } catch(e) {}
}


// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const pmData = await api('/api/settings/payment_methods');
        PAYMENT_METHODS = pmData.value;
    } catch(e) {
        PAYMENT_METHODS = [
            {id: 'credit_card', label: '💳 信用卡'},
            {id: 'ic_card', label: '🚃 交通IC卡'},
            {id: 'cash', label: '💴 現金'}
        ];
    }
    PAYMENT_LABELS = {};
    PAYMENT_METHODS.forEach(pm => { PAYMENT_LABELS[pm.id] = pm.label; });

    try {
        const cData = await api('/api/settings/companions');
        COMPANIONS = cData.value;
    } catch(e) {
        COMPANIONS = ['管理員'];
    }

    try {
        const ccData = await api('/api/settings/cc_budgets');
        CC_BUDGETS = ccData.value || {};
    } catch(e) {
        CC_BUDGETS = {};
    }

    initNavigation();
    navigateTo('dashboard');

    // Payment modal
    document.getElementById('payment-modal-close').addEventListener('click', () => {
        document.getElementById('payment-modal').classList.add('hidden');
    });
    document.querySelector('#payment-modal .modal-backdrop').addEventListener('click', () => {
        document.getElementById('payment-modal').classList.add('hidden');
    });

    // Receipt detail modal
    document.getElementById('receipt-modal-close').addEventListener('click', () => {
        document.getElementById('receipt-modal').classList.add('hidden');
    });
    document.querySelector('#receipt-modal .modal-backdrop').addEventListener('click', () => {
        document.getElementById('receipt-modal').classList.add('hidden');
    });
});
