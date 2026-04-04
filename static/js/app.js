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
let CC_BUDGETS = {}; // { "豪": "卡名:預算, ...", "Alice": "卡名:預算" }

const COMPANION_ICONS = {
    '豪': '👦',
    '卿': '👧'
};

function getCompanionIcon(name) {
    return COMPANION_ICONS[name] || '🙋';
}

const JPY_TO_TWD = 0.22;

// ─── Theme ───
function initTheme() {
    const saved = localStorage.getItem('theme');
    const theme = saved || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    // Update toggle UI if present
    const toggle = document.getElementById('theme-toggle-input');
    if (toggle) toggle.checked = next === 'light';
}
function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}
// Apply theme immediately
initTheme();

function toTwd(amountJpy) {
    return Math.round(Number(amountJpy || 0) * JPY_TO_TWD);
}

function formatTwd(amountJpy) {
    return `NT$ ${formatAmount(toTwd(amountJpy))}`;
}

// Helper: parse a payer's cc budget string into { cardName: budgetAmount }
function parseCcBudgets(budgetStr) {
    const result = {};
    if (!budgetStr) return result;
    const normalized = budgetStr.replace(/[，、]/g, ',').replace(/：/g, ':');
    normalized.split(',').forEach(cstr => {
        const parts = cstr.split(':');
        if (parts.length >= 1) {
            const name = parts[0].trim();
            if (name) {
                const amt = parts.length >= 2 ? parseFloat(parts[1]) : 0;
                result[name] = isNaN(amt) ? 0 : amt;
            }
        }
    });
    return result;
}

// Helper: get all unique card names across all payers
function getAllCardNames() {
    const names = new Set();
    Object.entries(CC_BUDGETS).forEach(([p, budgetStr]) => {
        if (!budgetStr || !COMPANIONS.includes(p)) return;
        const normalized = budgetStr.replace(/[，、]/g, ',').replace(/：/g, ':');
        normalized.split(',').forEach(cstr => {
            const name = cstr.split(':')[0].trim();
            if (name) names.add(name);
        });
    });
    return [...names];
}

// Helper: get card names for a specific payer
function getPayerCardNames(payer) {
    if (!COMPANIONS.includes(payer)) return [];
    const budgetStr = CC_BUDGETS[payer];
    if (!budgetStr) return [];
    const names = new Set();
    const normalized = budgetStr.replace(/[，、]/g, ',').replace(/：/g, ':');
    normalized.split(',').forEach(cstr => {
        const name = cstr.split(':')[0].trim();
        if (name) names.add(name);
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
    const titles = { dashboard: '旅行收據管家', upload: '記錄消費', stats: '統計分析', history: '歷史紀錄', settings: '設定' };
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
                <div class="stat-value">¥ ${formatAmount(data.today_total)}</div>
                <div class="stat-sub">${formatTwd(data.today_total)} · ${data.today_count} 筆</div>
            </div>
            <div class="stat-card success">
                <div class="stat-label">旅程累計</div>
                <div class="stat-value">¥ ${formatAmount(data.trip_total)}</div>
                <div class="stat-sub">${formatTwd(data.trip_total)} · ${data.trip_count} 筆</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-label">現金已用</div>
                <div class="stat-value">¥ ${formatAmount(data.cash_spent)}</div>
                <div class="stat-sub">${formatTwd(data.cash_spent)}</div>
            </div>
            <div class="stat-card info clickable" onclick="showTripSelector()" style="cursor:pointer">
                <div class="stat-label">目前旅程</div>
                <div class="stat-value" style="font-size:1rem">${trip ? trip.name : '未設定'}</div>
                <div class="stat-sub">${trip ? (trip.start_date || '') : '點擊切換旅程'}</div>
                <div class="trip-switch-hint">切換 🔄</div>
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
                        <span>已使用 ¥${formatAmount(data.cash_spent)} (${formatTwd(data.cash_spent)})</span>
                        <span>預算 ¥${formatAmount(trip.budget_cash)} (${formatTwd(trip.budget_cash)})</span>
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
        // Only include payers who are in COMPANIONS
        let payersWithCC = Object.keys(ccByPayer).filter(p => COMPANIONS.includes(p));
        // Also include payers who have budget config but no spending yet AND are in COMPANIONS
        Object.keys(CC_BUDGETS).forEach(p => {
            if (COMPANIONS.includes(p) && !payersWithCC.includes(p) && CC_BUDGETS[p]) {
                payersWithCC.push(p);
            }
        });

        if (payersWithCC.length > 0) {
            const firstPayer = payersWithCC[0];
            ccSection.innerHTML = `
                <div class="card" style="margin-bottom:20px">
                    <div class="card-title">💳 信用卡消費 — 台幣 (依付款者)</div>
                    <div class="cc-payer-tabs" style="display:flex;gap:6px;margin:10px 0;flex-wrap:wrap">
                        ${payersWithCC.map((p, i) => `
                            <button class="btn btn-sm cc-payer-tab ${i === 0 ? 'btn-primary' : 'btn-secondary'}" data-payer="${p}" onclick="switchCcPayerTab(this, '${p.replace(/'/g, "\\'")}')" style="font-size:0.8rem;padding:4px 12px;border-radius:20px">
                                ${getCompanionIcon(p)} ${p}
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
                            <div class="receipt-list-amount">
                                <div class="amount-main">¥ ${formatAmount(r.total_amount)}</div>
                                <div class="amount-sub">${formatTwd(r.total_amount)}</div>
                            </div>
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
//  UPLOAD PAGE (with tab toggle: upload vs manual)
// ═══════════════════════════════════════════════
let uploadActiveTab = 'upload'; // 'upload' | 'manual'

function renderUpload(container) {
    container.innerHTML = `
        <div class="page-enter">
            <div class="upload-tab-bar">
                <button class="upload-tab ${uploadActiveTab === 'upload' ? 'active' : ''}" data-tab="upload" onclick="switchUploadTab('upload')">
                    <span class="upload-tab-icon">📸</span> 拍照上傳
                </button>
                <button class="upload-tab ${uploadActiveTab === 'manual' ? 'active' : ''}" data-tab="manual" onclick="switchUploadTab('manual')">
                    <span class="upload-tab-icon">✏️</span> 手動輸入
                </button>
            </div>
            <div id="upload-tab-content"></div>
            <div id="upload-preview-area"></div>
        </div>
    `;

    renderUploadTabContent();
}

window.switchUploadTab = function(tab) {
    uploadActiveTab = tab;
    document.querySelectorAll('.upload-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    // Clear preview when switching tabs
    const preview = document.getElementById('upload-preview-area');
    if (preview) preview.innerHTML = '';
    renderUploadTabContent();
};

function renderUploadTabContent() {
    const content = document.getElementById('upload-tab-content');
    if (!content) return;

    if (uploadActiveTab === 'upload') {
        content.innerHTML = `
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
        `;

        const cameraInput = document.getElementById('camera-input');
        const fileInput = document.getElementById('file-input');
        const dropZone = document.getElementById('upload-drop-zone');

        cameraInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
        fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));

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
    } else {
        renderManualEntryForm(content);
    }
}

function renderManualEntryForm(container) {
    const today = new Date().toISOString().slice(0, 10);
    const categories = Object.keys(CATEGORY_EMOJI);
    const activePayer = COMPANIONS.length > 0 ? COMPANIONS[0] : '豪';
    const payerCards = getPayerCardNames(activePayer);

    container.innerHTML = `
        <div class="manual-entry-form">
            <div class="manual-form-header">
                <span class="manual-form-icon">📝</span>
                <div>
                    <div class="manual-form-title">手動記錄消費</div>
                    <div class="manual-form-subtitle">不需要收據照片，直接輸入交易資訊</div>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">🏪 店家名稱 <span class="required">*</span></label>
                <input id="manual-store" class="form-input" placeholder="例：全家便利商店" autocomplete="off">
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">📅 日期 <span class="required">*</span></label>
                    <input id="manual-date" class="form-input" type="date" value="${today}">
                </div>
                <div class="form-group">
                    <label class="form-label">💰 金額 <span class="required">*</span></label>
                    <input id="manual-amount" class="form-input" type="number" placeholder="0" min="0" step="1" inputmode="numeric">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">💱 幣別</label>
                    <select id="manual-currency" class="form-select">
                        <option value="JPY" selected>JPY 日圓</option>
                        <option value="TWD">TWD 台幣</option>
                        <option value="USD">USD 美元</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">🏷️ 類別</label>
                    <select id="manual-category" class="form-select">
                        ${categories.map(c => `<option value="${c}">${CATEGORY_EMOJI[c]} ${c}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">👤 付款者</label>
                <div class="payment-method-chips" id="manual-payer-chips">
                    ${COMPANIONS.map((c, i) => `
                        <button type="button" class="chip ${i === 0 ? 'active' : ''}" data-value="${c}" onclick="selectManualPayer(this)">
                            ${getCompanionIcon(c)} ${c}
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">💳 付款方式</label>
                <div class="payment-method-chips" id="manual-pm-chips">
                    ${PAYMENT_METHODS.map((pm, i) => `
                        <button type="button" class="chip ${i === 0 ? 'active' : ''}" data-value="${pm.id}" onclick="selectManualPayment(this)">
                            ${pm.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <div id="manual-cc-section" class="form-group" style="display:none">
                <label class="form-label">💳 使用信用卡</label>
                <select id="manual-cc-name" class="form-select">
                    <option value="">-- 選擇信用卡 --</option>
                    ${payerCards.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
            </div>

            <div class="form-group">
                <label class="form-label">📝 備註</label>
                <textarea id="manual-note" class="note-input" placeholder="選填，例：買伴手禮"></textarea>
            </div>

            <button class="btn btn-primary btn-full manual-submit-btn" onclick="submitManualEntry()">
                ✅ 儲存消費紀錄
            </button>
        </div>
    `;

    // Show/hide credit card section based on initial payment method
    checkCcSection();
}

window.selectManualPayment = function(btn) {
    btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    checkCcSection();
};

window.selectManualPayer = function(btn) {
    btn.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    
    const activePayer = btn.dataset.value;
    const payerCards = getPayerCardNames(activePayer);
    const ccSelect = document.getElementById('manual-cc-name');
    if (ccSelect) {
        ccSelect.innerHTML = '<option value="">-- 選擇信用卡 --</option>' + 
                             payerCards.map(c => `<option value="${c}">${c}</option>`).join('');
    }
};

function checkCcSection() {
    const activeChip = document.querySelector('#manual-pm-chips .chip.active');
    const ccSection = document.getElementById('manual-cc-section');
    if (activeChip && activeChip.dataset.value === 'credit_card') {
        ccSection.style.display = 'block';
    } else if (ccSection) {
        ccSection.style.display = 'none';
    }
}

window.submitManualEntry = async function() {
    const storeName = document.getElementById('manual-store').value.trim();
    const date = document.getElementById('manual-date').value;
    const amount = parseFloat(document.getElementById('manual-amount').value);
    const currency = document.getElementById('manual-currency').value;
    const category = document.getElementById('manual-category').value;
    const note = document.getElementById('manual-note').value.trim();

    const activePm = document.querySelector('#manual-pm-chips .chip.active');
    const paymentMethod = activePm ? activePm.dataset.value : 'cash';

    const activePayer = document.querySelector('#manual-payer-chips .chip.active');
    const paidBy = activePayer ? activePayer.dataset.value : COMPANIONS[0] || '豪';

    let creditCardName = '';
    if (paymentMethod === 'credit_card') {
        creditCardName = document.getElementById('manual-cc-name').value;
    }

    // Validation
    if (!storeName) { showToast('請輸入店家名稱', 'error'); return; }
    if (!date) { showToast('請選擇日期', 'error'); return; }
    if (!amount || amount <= 0) { showToast('請輸入有效金額', 'error'); return; }

    try {
        showLoading('儲存中...');
        const result = await api('/api/receipts/confirm', {
            method: 'POST',
            body: JSON.stringify({
                store_name: storeName,
                date: date,
                total_amount: amount,
                currency: currency,
                payment_method: paymentMethod,
                category: category,
                note: note,
                credit_card_name: creditCardName,
                paid_by: paidBy,
                items: [],
                image_path: '',
            }),
        });
        hideLoading();
        showToast('消費紀錄已儲存！', 'success');

        // Show success state in preview area
        const previewArea = document.getElementById('upload-preview-area');
        previewArea.innerHTML = `
            <div class="manual-success-card">
                <div class="manual-success-icon">✅</div>
                <div class="manual-success-title">紀錄完成！</div>
                <div class="manual-success-detail">
                    <span>${CATEGORY_EMOJI[category] || '📦'} ${storeName}</span>
                    <span class="manual-success-amount">${currency} ${formatAmount(amount)} <small style="font-size: 0.7em; opacity: 0.8; font-weight: 500;">(${formatTwd(amount)})</small></span>
                </div>
                <div class="manual-success-meta">
                    ${date} · ${PAYMENT_LABELS[paymentMethod] || paymentMethod} · ${getCompanionIcon(paidBy)} ${paidBy}
                    ${creditCardName ? ` · ${creditCardName}` : ''}
                </div>
                <div style="display:flex;gap:10px;margin-top:16px">
                    <button class="btn btn-primary" style="flex:1" onclick="switchUploadTab('manual')">繼續記錄</button>
                    <button class="btn btn-secondary" style="flex:1" onclick="navigateTo('dashboard')">回首頁</button>
                </div>
            </div>
        `;

        // Reset form
        document.getElementById('manual-store').value = '';
        document.getElementById('manual-amount').value = '';
        document.getElementById('manual-note').value = '';
    } catch (err) {
        hideLoading();
    }
};

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
    const payer = data.paid_by || (COMPANIONS.length > 0 ? COMPANIONS[0] : '豪');
    const payerCards = getPayerCardNames(payer);
    if (payerCards.length > 0) {
        ccOptionsHtml = `
            <select id="preview-cc-name-${data.id}" class="form-select" style="margin-top:8px;font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCard(${data.id}, this.value)">
                <option value="">-- 指定信用卡 --</option>
                ${payerCards.map(c => `<option value="${c}" ${data.credit_card_name === c ? 'selected' : ''}>${c}</option>`).join('')}
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
                    <span class="receipt-total-amount">${data.currency || '¥'} ${formatAmount(data.total_amount)} <small style="font-size: 0.7em; opacity: 0.8; font-weight: 500; margin-left: 4px;">(${formatTwd(data.total_amount)})</small></span>
                </div>
                <div class="receipt-meta" style="flex-wrap:wrap">
                    <span class="receipt-tag payment" style="cursor:pointer" onclick="changePaymentMethod(${data.id}, '${data.payment_method}')" title="點擊更改付款方式">${PAYMENT_LABELS[data.payment_method] || data.payment_method}</span>
                    <span class="receipt-tag category">${CATEGORY_EMOJI[data.category] || ''} ${data.category || '其他'}</span>
                    <span class="receipt-tag">${data.currency || 'JPY'}</span>
                    ${data.credit_card_name ? `<span class="receipt-tag" style="background:var(--bg-card);border:1px solid currentColor">${data.credit_card_name}</span>` : ''}
                </div>
                <div style="padding:0 20px 12px">
                   <select class="form-select" style="margin-top:8px;font-size:0.85rem;padding:4px 8px" onchange="updateReceiptPaidByAndCards(${data.id}, this.value, '${data.payment_method}')">
                       <option value="">-- 由誰付款 --</option>
                       ${COMPANIONS.map(c => `<option value="${c}" ${payer === c ? 'selected' : ''}>${getCompanionIcon(c)} ${c}</option>`).join('')}
                   </select>
                   <div id="preview-cc-container-${data.id}">
                       ${data.payment_method === 'credit_card' ? ccOptionsHtml : ''}
                   </div>
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
            <div class="card chart-container" id="chart-category">
                <div class="card-title">🏷️ 類別佔比</div>
                <div class="chart-wrapper"><canvas id="category-chart"></canvas></div>
                <div id="category-list" style="margin-top:16px;display:flex;flex-direction:column;gap:10px"></div>
            </div>
            <div class="card" id="chart-payment">
                <div class="card-title">💳 支付方式</div>
                <div id="payment-list" style="display:flex;flex-direction:column;gap:10px;margin-top:8px"></div>
            </div>
            <div id="payers-section"></div>
            <div class="card chart-container" id="chart-daily">
                <div class="card-title">📈 每日分析</div>
                <div class="chart-wrapper"><canvas id="daily-chart"></canvas></div>
            </div>
            <div id="top10-section"></div>
        </div>
    `;

    try {
        const data = await api('/api/stats');
        const grandTotal = (data.categories || []).reduce((s, c) => s + c.total, 0);

        // Category doughnut chart + amount list
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

            // Category amount list rows
            const catList = document.getElementById('category-list');
            catList.innerHTML = data.categories.map(c => {
                const pct = grandTotal > 0 ? ((c.total / grandTotal) * 100).toFixed(1) : 0;
                const color = CATEGORY_COLORS[c.category] || '#6b7280';
                return `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-glass)">
                        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block"></span>
                        <span style="flex:1;font-size:0.9rem;color:var(--text-primary)">${CATEGORY_EMOJI[c.category] || '📦'} ${c.category}</span>
                        <span style="font-size:0.8rem;color:var(--text-muted)">${pct}%</span>
                        <span style="font-weight:700;color:var(--text-primary);font-size:0.95rem">¥ ${formatAmount(c.total)}</span>
                    </div>
                `;
            }).join('');
        }

        // Payment method — list style (no chart)
        const pmList = document.getElementById('payment-list');
        if (data.payment_methods && data.payment_methods.length > 0) {
            const pmColors = { credit_card: '#6366f1', ic_card: '#06b6d4', cash: '#10b981' };
            const pmTotal = data.payment_methods.reduce((s, p) => s + p.total, 0);
            pmList.innerHTML = data.payment_methods.map(p => {
                const pct = pmTotal > 0 ? ((p.total / pmTotal) * 100).toFixed(1) : 0;
                const color = pmColors[p.payment_method] || '#6b7280';
                const label = PAYMENT_LABELS[p.payment_method] || p.payment_method;
                return `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-glass)">
                        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block"></span>
                        <span style="flex:1;font-size:0.9rem;color:var(--text-primary)">${label}</span>
                        <span style="font-size:0.8rem;color:var(--text-muted)">${pct}%</span>
                        <span style="font-weight:700;color:var(--text-primary);font-size:0.95rem">¥ ${formatAmount(p.total)}</span>
                    </div>
                `;
            }).join('');
        } else {
            pmList.innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">尚無資料</div>';
        }

        // Payers
        const payersSection = document.getElementById('payers-section');
        if (data.payers && data.payers.length > 0) {
            const filteredPayers = data.payers.filter(p => COMPANIONS.includes(p.paid_by || '豪'));
            if (filteredPayers.length > 0) {
                payersSection.innerHTML = `
                    <div class="section-title"><span class="emoji">👥</span> 同行者付款統計</div>
                    <div class="card" style="margin-bottom:20px">
                        <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
                            ${filteredPayers.map(p => `
                                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-glass);padding-bottom:8px">
                                    <span style="font-weight:500;color:var(--text-primary)">${getCompanionIcon(p.paid_by || '豪')} ${p.paid_by || '豪'}</span>
                                    <span style="font-weight:700;color:var(--text-primary)">
                                        ¥ ${formatAmount(p.total)}
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                payersSection.innerHTML = '';
            }
        }

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
    const isLight = getCurrentTheme() === 'light';
    const tickColor = isLight ? '#718096' : '#64748b';
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    const titleColor = isLight ? '#4a5568' : '#94a3b8';
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
        },
        scales: {
            x: {
                ticks: { color: tickColor, font: { size: 10 } },
                grid: { color: gridColor },
            },
            y: {
                ticks: { color: tickColor, font: { size: 10 } },
                grid: { color: gridColor },
                title: yLabel ? { display: true, text: yLabel, color: titleColor } : undefined,
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
            html += `
                <div class="date-group-header">
                    <span>${relativeDate(date)}</span>
                    <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                        <span class="header-amount-main">¥ ${formatAmount(dayTotal)}</span>
                        <span class="header-amount-sub">${formatTwd(dayTotal)}</span>
                    </div>
                </div>
            `;
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
                        <div class="receipt-list-amount">
                            <div class="amount-main">¥ ${formatAmount(r.total_amount)}</div>
                            <div class="amount-sub">${formatTwd(r.total_amount)}</div>
                        </div>
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
            const payer = r.paid_by || (COMPANIONS.length > 0 ? COMPANIONS[0] : '豪');
            const payerCards = getPayerCardNames(payer);
            if (payerCards.length > 0) {
                ccOptionsHtml = `
                    <div style="margin-bottom:12px">
                        <select class="form-select" style="font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCardDetail(${r.id}, this.value)">
                            <option value="">-- 指定信用卡 --</option>
                            ${payerCards.map(c => `<option value="${c}" ${r.credit_card_name === c ? 'selected' : ''}>${c}</option>`).join('')}
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
                    <span class="receipt-total-amount">${r.currency || '¥'} ${formatAmount(r.total_amount)} <small style="font-size: 0.7em; opacity: 0.8; font-weight: 500; margin-left: 4px;">(${formatTwd(r.total_amount)})</small></span>
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
                        ${COMPANIONS.map(c => `<option value="${c}" ${(r.paid_by || '豪') === c ? 'selected' : ''}>${getCompanionIcon(c)} ${c}</option>`).join('')}
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

window.updateReceiptPaidByAndCards = async function(receiptId, paidBy, paymentMethod) {
    await window.updateReceiptPaidBy(receiptId, paidBy);
    const container = document.getElementById(`preview-cc-container-${receiptId}`);
    if (container && paymentMethod === 'credit_card') {
        const payerCards = getPayerCardNames(paidBy);
        if (payerCards.length > 0) {
            container.innerHTML = `
                <select id="preview-cc-name-${receiptId}" class="form-select" style="margin-top:8px;font-size:0.85rem;padding:4px 8px" onchange="updateReceiptCard(${receiptId}, this.value)">
                    <option value="">-- 指定信用卡 --</option>
                    ${payerCards.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
            `;
        } else {
            container.innerHTML = '';
        }
    }
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
let editingTripId = null;

async function renderSettings(container) {
    container.innerHTML = '<div class="page-enter" id="settings-content">載入中...</div>';
    const content = document.getElementById('settings-content');

    try {
        const trips = await api('/api/trips');
        window._trips = trips;

        if (editingTripId) {
            const trip = trips.find(t => t.id === editingTripId);
            if (!trip) {
                editingTripId = null;
                return renderSettings(container);
            }
            renderTripEdit(content, trip);
            return;
        }

        const isLight = getCurrentTheme() === 'light';
        content.innerHTML = `
            <div class="section-title">🎨 外觀設定</div>
            <div class="theme-toggle-row">
                <div class="theme-toggle-label">
                    <span class="theme-icon">${isLight ? '☀️' : '🌙'}</span>
                    <div>
                        <div>${isLight ? '淺色模式' : '深色模式'}</div>
                        <div class="theme-toggle-sub">切換應用程式的顯示主題</div>
                    </div>
                </div>
                <label class="theme-switch">
                    <input type="checkbox" id="theme-toggle-input" ${isLight ? 'checked' : ''} onchange="handleThemeToggle()">
                    <span class="slider"></span>
                </label>
            </div>

            <div class="section-title" style="margin-top:24px">✈️ 旅程管理</div>
            <div style="margin-bottom:20px">
                ${trips.length > 0 ? trips.map(t => `
                    <div class="trip-card ${t.is_active ? 'active' : ''}" style="display:flex;align-items:center;">
                        <div onclick="setActiveTrip(${t.id}, ${!t.is_active})" style="flex:1;cursor:pointer">
                            <div class="trip-card-name">${t.is_active ? '✅ ' : ''}${t.name}</div>
                            <div class="trip-card-dates">${t.start_date || ''} ~ ${t.end_date || ''}</div>
                            ${t.budget_cash > 0 ? `<div class="trip-card-budget" style="margin-bottom:8px">現金預算: ${formatAmount(t.budget_cash)} ${t.currency}</div>` : ''}
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();editingTripId=${t.id};renderPage('settings')">✏️ 編輯</button>
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
        `;
    } catch (err) {
        content.innerHTML = '<div class="empty-state">載入失敗</div>';
    }
}

function renderTripEdit(content, trip) {
    const tripPm = trip.payment_methods ? JSON.parse(trip.payment_methods) : PAYMENT_METHODS;
    const tripComp = trip.companions ? JSON.parse(trip.companions) : COMPANIONS;
    const tripCc = trip.cc_budgets ? JSON.parse(trip.cc_budgets) : CC_BUDGETS;

    content.innerHTML = `
        <button class="btn btn-secondary btn-sm" style="margin-bottom:16px" onclick="editingTripId=null;renderPage('settings')">← 返回旅程列表</button>
        <div class="section-title">📝 編輯旅程：${trip.name}</div>
        
        <div class="card" style="margin-bottom:30px">
            <div class="form-group">
                <label class="form-label">旅程名稱</label>
                <input id="edit-trip-name" class="form-input" value="${trip.name}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">開始日期</label>
                    <input id="edit-trip-start" class="form-input" type="date" value="${trip.start_date || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">結束日期</label>
                    <input id="edit-trip-end" class="form-input" type="date" value="${trip.end_date || ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">現金預算</label>
                    <input id="edit-trip-budget" class="form-input" type="number" value="${trip.budget_cash || 0}">
                </div>
                <div class="form-group">
                    <label class="form-label">幣別</label>
                    <select id="edit-trip-currency" class="form-select">
                        <option value="JPY" ${trip.currency==='JPY'?'selected':''}>JPY 日圓</option>
                        <option value="USD" ${trip.currency==='USD'?'selected':''}>USD 美元</option>
                        <option value="EUR" ${trip.currency==='EUR'?'selected':''}>EUR 歐元</option>
                        <option value="KRW" ${trip.currency==='KRW'?'selected':''}>KRW 韓圓</option>
                        <option value="TWD" ${trip.currency==='TWD'?'selected':''}>TWD 台幣</option>
                        <option value="GBP" ${trip.currency==='GBP'?'selected':''}>GBP 英鎊</option>
                        <option value="THB" ${trip.currency==='THB'?'selected':''}>THB 泰銖</option>
                    </select>
                </div>
            </div>
            <button class="btn btn-primary btn-full" onclick="saveTripBasic(${trip.id})">儲存基本資料</button>
        </div>

        <div class="section-title">💳 付款方式管理 (僅此旅程)</div>
        <div class="card" style="margin-bottom:30px">
            <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
                ${tripPm.map(pm => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-glass); padding:8px 12px; border-radius:var(--radius-sm);">
                        <div>
                            <div style="font-weight:500;">${pm.label}</div>
                            <div style="font-size:0.75rem; color:var(--text-secondary)">ID: ${pm.id}</div>
                        </div>
                        <button class="btn btn-danger btn-sm" onclick="deleteTripPaymentMethod(${trip.id}, '${pm.id}')">刪除</button>
                    </div>
                `).join('')}
            </div>
            <div style="font-size:0.9rem; margin:24px 0 12px; color:var(--text-primary); font-weight:600">新增付款方式</div>
            <div class="form-row">
                <div class="form-group" style="flex:1">
                    <label class="form-label">代碼 (英文)</label>
                    <input id="edit-pm-id" class="form-input" placeholder="例: line_pay">
                </div>
                <div class="form-group" style="flex:2">
                    <label class="form-label">顯示名稱 (含Emoji)</label>
                    <input id="edit-pm-label" class="form-input" placeholder="例: 🟢 LINE Pay">
                </div>
            </div>
            <button class="btn btn-secondary btn-full" onclick="addTripPaymentMethod(${trip.id})">新增</button>
        </div>

        <div class="section-title">👥 同行者管理 (僅此旅程)</div>
        <div class="card" style="margin-bottom:30px">
            <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
                ${tripComp.map(c => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-glass); padding:8px 12px; border-radius:var(--radius-sm);">
                        <div style="font-weight:500;">${getCompanionIcon(c)} ${c}</div>
                        <button class="btn btn-danger btn-sm" onclick="deleteTripCompanion(${trip.id}, '${c}')">刪除</button>
                    </div>
                `).join('')}
            </div>
            <div style="font-size:0.9rem; margin:24px 0 12px; color:var(--text-primary); font-weight:600">新增同行者</div>
            <div class="form-row">
                <div class="form-group" style="flex:1">
                    <input id="edit-companion-name" class="form-input" placeholder="例: Alice">
                </div>
                <button class="btn btn-secondary" style="white-space:nowrap" onclick="addTripCompanion(${trip.id})">新增</button>
            </div>
        </div>

        <div class="section-title">💳 信用卡預算管理 (僅此旅程)</div>
        <div class="card" style="margin-bottom:30px">
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:16px">每位付款者可設定各自的信用卡和預算（台幣），格式：卡名:預算，用逗號分隔。</div>
            <div style="display:flex; flex-direction:column; gap:16px;">
                ${tripComp.map(c => `
                    <div style="background:var(--bg-glass);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border-glass)">
                        <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px">${getCompanionIcon(c)} ${c}</div>
                        <div style="display:flex;align-items:center;gap:8px">
                            <input type="text" id="edit-cc-budget-${c}" value="${tripCc[c] || ''}" class="form-input" style="flex:1;padding:6px 10px;font-size:0.85rem" placeholder="例: 國泰CUBE:50000">
                            <button class="btn btn-secondary btn-sm" style="padding:4px 10px;white-space:nowrap" onclick="saveTripCcBudget(${trip.id}, '${c.replace(/'/g, "\'")}')">儲存</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
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
        await updateGlobalsFromActiveTrip();
    } catch (err) {}
}

window.saveTripBasic = async function(tripId) {
    try {
        await api(`/api/trips/${tripId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: document.getElementById('edit-trip-name').value.trim(),
                start_date: document.getElementById('edit-trip-start').value || null,
                end_date: document.getElementById('edit-trip-end').value || null,
                budget_cash: parseFloat(document.getElementById('edit-trip-budget').value) || 0,
                currency: document.getElementById('edit-trip-currency').value
            })
        });
        showToast('旅程基本資料已更新', 'success');
        renderPage('settings');
        await updateGlobalsFromActiveTrip();
    } catch(e) {}
};

window.addTripPaymentMethod = async function(tripId) {
    const trip = window._trips.find(t => t.id === tripId);
    const pmList = trip.payment_methods ? JSON.parse(trip.payment_methods) : PAYMENT_METHODS;
    
    const id = document.getElementById('edit-pm-id').value.trim();
    const label = document.getElementById('edit-pm-label').value.trim();
    if (!id || !label) { showToast('請填寫代碼與顯示名稱', 'error'); return; }
    if (pmList.find(pm => pm.id === id)) { showToast('該代碼已存在', 'error'); return; }

    const newList = [...pmList, { id, label }];
    await updateTripField(tripId, 'payment_methods', newList);
};

window.deleteTripPaymentMethod = async function(tripId, pmId) {
    const trip = window._trips.find(t => t.id === tripId);
    const pmList = trip.payment_methods ? JSON.parse(trip.payment_methods) : PAYMENT_METHODS;
    if (pmList.length <= 1) { showToast('至少需保留一個付款方式', 'error'); return; }
    if (!confirm('確定要刪除這個付款方式嗎？')) return;

    const newList = pmList.filter(pm => pm.id !== pmId);
    await updateTripField(tripId, 'payment_methods', newList);
};

window.addTripCompanion = async function(tripId) {
    const trip = window._trips.find(t => t.id === tripId);
    const compList = trip.companions ? JSON.parse(trip.companions) : COMPANIONS;
    
    const name = document.getElementById('edit-companion-name').value.trim();
    if (!name) { showToast('請填寫同行者名稱', 'error'); return; }
    if (compList.includes(name)) { showToast('該名字已存在', 'error'); return; }

    const newList = [...compList, name];
    await updateTripField(tripId, 'companions', newList);
};

window.deleteTripCompanion = async function(tripId, name) {
    const trip = window._trips.find(t => t.id === tripId);
    const compList = trip.companions ? JSON.parse(trip.companions) : COMPANIONS;
    if (compList.length <= 1) { showToast('至少需保留一名同行者', 'error'); return; }
    if (!confirm('確定要刪除這位同行者嗎？')) return;

    const newList = compList.filter(c => c !== name);
    await updateTripField(tripId, 'companions', newList);
};

window.saveTripCcBudget = async function(tripId, payerName) {
    const trip = window._trips.find(t => t.id === tripId);
    let ccObj = trip.cc_budgets ? JSON.parse(trip.cc_budgets) : { ...CC_BUDGETS };
    
    const input = document.getElementById(`edit-cc-budget-${payerName}`);
    if (!input) return;
    
    ccObj[payerName] = input.value.trim();
    
    // Cleanup: only keep budgets for people in the current trip companions list
    const companions = trip.companions ? JSON.parse(trip.companions) : COMPANIONS;
    const cleanedCcObj = {};
    companions.forEach(c => {
        if (ccObj[c]) cleanedCcObj[c] = ccObj[c];
    });
    
    await updateTripField(tripId, 'cc_budgets', cleanedCcObj);
};

async function updateTripField(tripId, fieldName, value) {
    try {
        await api(`/api/trips/${tripId}`, {
            method: 'PUT',
            body: JSON.stringify({ [fieldName]: value })
        });
        showToast('旅程設定已更新', 'success');
        renderPage('settings');
        await updateGlobalsFromActiveTrip();
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
        await updateGlobalsFromActiveTrip();
        if (currentPage === 'settings') renderPage('settings');
        if (currentPage === 'dashboard') renderPage('dashboard');
    } catch (err) {
        // Toast shown
    }
}

async function showTripSelector() {
    try {
        showLoading('載入旅程列表...');
        const trips = await api('/api/trips');
        hideLoading();
        
        const modal = document.getElementById('payment-modal');
        const body = document.getElementById('payment-modal-body');
        const title = modal.querySelector('h2');
        title.textContent = '切換目前旅程';
        
        body.innerHTML = `
            <div class="trip-selector-list">
                ${trips.map(t => `
                    <div class="trip-selector-item ${t.is_active ? 'active' : ''}" onclick="selectTrip(${t.id})">
                        <div class="trip-selector-info">
                            <div class="trip-selector-name">${t.is_active ? '✅ ' : ''}${t.name}</div>
                            <div class="trip-selector-dates">${t.start_date || ''} ~ ${t.end_date || ''}</div>
                        </div>
                        <div class="trip-selector-check">${t.is_active ? '目前' : '切換'}</div>
                    </div>
                `).join('')}
            </div>
        `;
        
        window.selectTrip = async (id) => {
            modal.classList.add('hidden');
            await setActiveTrip(id, true);
        };
        
        modal.classList.remove('hidden');
    } catch (err) {
        hideLoading();
    }
}

async function updateGlobalsFromActiveTrip() {
    try {
        const trips = await api('/api/trips');
        const activeTrip = trips.find(t => t.is_active);
        
        if (activeTrip) {
            if (activeTrip.payment_methods) {
                PAYMENT_METHODS = JSON.parse(activeTrip.payment_methods);
            }
            if (activeTrip.companions) {
                COMPANIONS = JSON.parse(activeTrip.companions);
            }
            if (activeTrip.cc_budgets) {
                CC_BUDGETS = JSON.parse(activeTrip.cc_budgets);
            }
        }
        PAYMENT_LABELS = {};
        PAYMENT_METHODS.forEach(pm => { PAYMENT_LABELS[pm.id] = pm.label; });
    } catch (e) {
        console.error("Failed to update globals", e);
    }
}

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

    let html = '<div style="display:flex;flex-direction:column;gap:14px">';

    cardNames.forEach(cardName => {
        const spentEntry = payerCards.find(c => c.credit_card_name === cardName);
        const spentJpy = spentEntry ? spentEntry.total : 0;
        const spentTwd = toTwd(spentJpy);
        const budget = budgets[cardName] || 0; // already in TWD

        let budgetHtml = '';
        if (budget > 0) {
            const pct = Math.min((spentTwd / budget) * 100, 100);
            const barClass = spentTwd > budget ? 'danger' : pct > 90 ? 'warning' : '';
            budgetHtml = `
                <div class="budget-bar-container" style="height:6px;margin-top:6px">
                    <div class="budget-bar ${barClass}" style="width:${pct}%"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-secondary);margin-top:4px">
                    <span>預算: NT$ ${formatAmount(budget)}</span>
                    <span>${pct.toFixed(0)}%</span>
                </div>
            `;
        }

        html += `
            <div style="border-bottom:1px solid var(--border-glass);padding-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:500;color:var(--text-primary)">${cardName}</span>
                    <span style="font-size:1.1rem;font-weight:700;color:${budget > 0 && spentTwd > budget ? '#ef4444' : 'var(--text-primary)'}">
                        NT$ ${formatAmount(spentTwd)}
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
// Theme toggle handler
window.handleThemeToggle = function() {
    toggleTheme();
    // Re-render settings to update icon/label
    if (currentPage === 'settings') {
        renderPage('settings');
    }
};

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
        COMPANIONS = ['豪', '卿'];
    }

    try {
        const ccData = await api('/api/settings/cc_budgets');
        CC_BUDGETS = ccData.value || {};
    } catch(e) {
        CC_BUDGETS = {};
    }

    initNavigation();
    await updateGlobalsFromActiveTrip();
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
