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

const PAYMENT_LABELS = {
    'credit_card': '💳 信用卡',
    'ic_card': '🚃 交通IC卡',
    'cash': '💴 現金',
};

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
    const titles = { dashboard: '旅行收據管家', upload: '上傳收據', stats: '統計分析', history: '歷史紀錄' };
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

        // Credit card breakdown
        const ccSection = document.getElementById('cc-section');
        if (data.cc_spent && data.cc_spent.length > 0) {
            // Parse card budgets config back to object
            const cardBudgets = {};
            if (trip && trip.credit_cards) {
                trip.credit_cards.split(',').forEach(cstr => {
                    const parts = cstr.split(':');
                    if (parts.length >= 2) {
                        const amt = parseFloat(parts[1]);
                        if (!isNaN(amt)) cardBudgets[parts[0].trim()] = amt;
                    }
                });
            }

            ccSection.innerHTML = `
                <div class="card" style="margin-bottom:20px">
                    <div class="card-title">💳 信用卡累計花費</div>
                    <div style="display:flex;flex-direction:column;gap:16px;margin-top:8px">
                        ${data.cc_spent.map(c => {
                            const budget = cardBudgets[c.credit_card_name] || 0;
                            let budgetHtml = '';
                            if (budget > 0) {
                                const pct = Math.min((c.total / budget) * 100, 100);
                                const barClass = c.total > budget ? 'danger' : pct > 90 ? 'warning' : '';
                                budgetHtml = `
                                    <div class="budget-bar-container" style="height:6px;margin-top:6px;background:rgba(255,255,255,0.05)">
                                        <div class="budget-bar ${barClass}" style="width:${pct}%"></div>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-secondary);margin-top:4px">
                                        <span>預算: ${formatAmount(budget)} ${trip ? trip.currency : ''}</span>
                                        <span>${pct.toFixed(0)}%</span>
                                    </div>
                                `;
                            }
                            return `
                                <div style="border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px">
                                    <div style="display:flex;justify-content:space-between;align-items:center">
                                        <span style="font-weight:500;color:var(--text-primary)">
                                            ${c.credit_card_name}
                                        </span>
                                        <span style="font-size:1.1rem;font-weight:700;color:${budget > 0 && c.total > budget ? '#ef4444' : 'var(--text-primary)'}">
                                            ${trip ? trip.currency : ''} ${formatAmount(c.total)}
                                        </span>
                                    </div>
                                    ${budgetHtml}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
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
    if (activeTrip && activeTrip.credit_cards) {
        const cards = activeTrip.credit_cards.split(',').map(c => c.split(':')[0].trim()).filter(c => c);
        if (cards.length > 0) {
            ccOptionsHtml = `
                <select class="form-select" style="margin-top:8px;font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCard(${data.id}, this.value)">
                    <option value="">-- 指定信用卡 --</option>
                    ${cards.map(c => `<option value="${c}" ${data.credit_card_name === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            `;
        }
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
        if (activeTrip && activeTrip.credit_cards && r.payment_method === 'credit_card') {
            const cards = activeTrip.credit_cards.split(',').map(c => c.split(':')[0].trim()).filter(c => c);
            if (cards.length > 0) {
                ccOptionsHtml = `
                    <div style="margin-bottom:12px">
                        <select class="form-select" style="font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCardDetail(${r.id}, this.value)">
                            <option value="">-- 指定信用卡 --</option>
                            ${cards.map(c => `<option value="${c}" ${r.credit_card_name === c ? 'selected' : ''}>${c}</option>`).join('')}
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

window.changePaymentMethod = async function(receiptId, currentMethod) {
    const newMethod = prompt("請輸入付款方式代碼 (credit_card, ic_card, cash):", currentMethod);
    if (newMethod && ['credit_card', 'ic_card', 'cash'].includes(newMethod)) {
        try {
            await api(`/api/receipts/${receiptId}`, {
                method: 'PUT',
                body: JSON.stringify({ payment_method: newMethod })
            });
            showToast('付款方式已更新', 'success');
            if (currentPage === 'dashboard') renderPage('dashboard');
            else if (currentPage === 'history') renderPage('history');
            const modal = document.getElementById('receipt-modal');
            if (!modal.classList.contains('hidden')) {
                showReceiptDetail(receiptId);
            }
        } catch(e) {}
    }
};


// ═══════════════════════════════════════════════
//  TRIP MANAGEMENT MODAL
// ═══════════════════════════════════════════════
async function openTripModal() {
    const modal = document.getElementById('trip-modal');
    const body = document.getElementById('trip-modal-body');
    modal.classList.remove('hidden');

    try {
        const trips = await api('/api/trips');

        body.innerHTML = `
            <div style="margin-bottom:20px">
                ${trips.length > 0 ? trips.map(t => `
                    <div class="trip-card ${t.is_active ? 'active' : ''}" onclick="setActiveTrip(${t.id}, ${!t.is_active})">
                        <div class="trip-card-name">${t.is_active ? '✅ ' : ''}${t.name}</div>
                        <div class="trip-card-dates">${t.start_date || ''} ~ ${t.end_date || ''}</div>
                        ${t.budget_cash > 0 ? `<div class="trip-card-budget" style="margin-bottom:8px">現金預算: ${formatAmount(t.budget_cash)} ${t.currency}</div>` : ''}
                        <div style="font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:8px;margin-top:8px" onclick="event.stopPropagation()">
                            <input type="text" id="edit-cards-${t.id}" value="${t.credit_cards || ''}" class="form-input" style="padding:4px 8px;font-size:0.8rem;background:rgba(255,255,255,0.05);color:white" placeholder="卡片:預算 (例 國泰:1萬, 飛狗:5千)">
                            <button class="btn btn-secondary btn-sm" style="padding:4px 8px" onclick="updateTripCards(${t.id})">儲存</button>
                        </div>
                    </div>
                `).join('') : '<div style="color:var(--text-muted);text-align:center;padding:20px">尚無旅程</div>'}
            </div>
            <div class="section-title">新增旅程</div>
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
            <div class="form-group">
                <label class="form-label">設定信用卡與個別預算 (選填，冒號隔開卡名與金額)</label>
                <input id="trip-credit-cards" class="form-input" placeholder="例：國泰CUBE:30000, 台新FlyGo:15000">
            </div>
            <button class="btn btn-primary btn-full" onclick="createNewTrip()">建立旅程</button>
        `;
    } catch (err) {
        body.innerHTML = '<div class="empty-state">載入失敗</div>';
    }
}

async function createNewTrip() {
    const name = document.getElementById('trip-name').value.trim();
    if (!name) { showToast('請輸入旅程名稱', 'error'); return; }

    const creditCards = document.getElementById('trip-credit-cards').value.trim();

    try {
        await api('/api/trips', {
            method: 'POST',
            body: JSON.stringify({
                name,
                start_date: document.getElementById('trip-start').value || null,
                end_date: document.getElementById('trip-end').value || null,
                budget_cash: parseFloat(document.getElementById('trip-budget').value) || 0,
                currency: document.getElementById('trip-currency').value,
                credit_cards: creditCards,
            }),
        });
        showToast('旅程已建立！', 'success');
        openTripModal(); // Refresh
    } catch (err) {
        // Toast shown
    }
}

window.updateTripCards = async function(tripId) {
    const input = document.getElementById(`edit-cards-${tripId}`);
    if(!input) return;
    try {
        await api(`/api/trips/${tripId}`, {
            method: 'PUT',
            body: JSON.stringify({ credit_cards: input.value.trim() })
        });
        showToast('信用卡清單已更新', 'success');
        openTripModal();
        if (currentPage === 'dashboard') renderPage('dashboard');
    } catch(e) {}
}

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
        openTripModal();
        if (currentPage === 'dashboard') renderPage('dashboard');
    } catch (err) {
        // Toast shown
    }
}


// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    navigateTo('dashboard');

    // Trip modal
    document.getElementById('trip-menu-btn').addEventListener('click', openTripModal);
    document.getElementById('trip-modal-close').addEventListener('click', () => {
        document.getElementById('trip-modal').classList.add('hidden');
    });
    document.querySelector('#trip-modal .modal-backdrop').addEventListener('click', () => {
        document.getElementById('trip-modal').classList.add('hidden');
    });

    // Receipt detail modal
    document.getElementById('receipt-modal-close').addEventListener('click', () => {
        document.getElementById('receipt-modal').classList.add('hidden');
    });
    document.querySelector('#receipt-modal .modal-backdrop').addEventListener('click', () => {
        document.getElementById('receipt-modal').classList.add('hidden');
    });
});
