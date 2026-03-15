import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

const firebaseConfig = {
    databaseURL: "https://hybrid-internet-database-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const operatorsRef = ref(db, 'operators');

const STORAGE_KEY = 'hybrid_operators_v1';
const ADMIN_PASS_KEY = 'hybrid_admin_pass';
const BOT_TOKEN_KEY = 'hybrid_tg_bot_token';
const MSG_KEY = 'hybrid_msg_templates';
const UPI_KEY = 'hybrid_upi_config';
const GST_KEY = 'hybrid_gst_config';

// Data State
let operators = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let activeUser = JSON.parse(localStorage.getItem('hybrid_auth')) || null;
let currentAdminViewOpId = null;
let isInitialSync = true;
let isDataSyncing = false;
let renderScheduled = false;

const defaultTemplates = {
    single: "Hello {OperatorName},\n\nReminder: Your user *{UserName}*'s {Platform} ID for bundle \"{Bundle}\" is expiring on *{ExpiryDate}*.\n(Started on: {CreatedDate}).\n\nPlease renew it soon to avoid disruption.",
    bulk: "Hello {OperatorName},\n\nYou have clients with expiring / expired subscriptions:"
};
let msgTemplates = JSON.parse(localStorage.getItem(MSG_KEY)) || defaultTemplates;
if (!msgTemplates.single) msgTemplates.single = defaultTemplates.single;
if (!msgTemplates.bulk) msgTemplates.bulk = defaultTemplates.bulk;

// Firebase Listener
onValue(operatorsRef, (snapshot) => {
    if (isDataSyncing) return;

    isDataSyncing = true;
    const data = snapshot.val();

    if (data) {
        const newOperators = Array.isArray(data) ? data : Object.values(data);
        if (JSON.stringify(operators) !== JSON.stringify(newOperators)) {
            operators = newOperators;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));

            if (activeUser && !renderScheduled) {
                renderScheduled = true;
                setTimeout(() => {
                    renderApp();
                    renderScheduled = false;
                }, 100);
            }
        }
    } else if (isInitialSync && operators.length > 0) {
        set(operatorsRef, operators);
    } else {
        operators = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
    }

    isInitialSync = false;
    isDataSyncing = false;
}, (error) => {
    console.error("Firebase Sync Error.", error);
    showToast("Firebase sync disconnected. Using local data.", "error");
    isDataSyncing = false;
    renderApp();
});

// UI Views
const views = {
    login: document.getElementById('login-view'),
    adminDash: document.getElementById('admin-dashboard'),
    adminDetail: document.getElementById('admin-operator-detail'),
    opPortal: document.getElementById('operator-portal')
};

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
        window.scrollTo(0, 0);
    }
}

function openModal(modalId) { 
    document.getElementById(modalId).classList.add('active'); 
}
function closeModal(modalId) { 
    document.getElementById(modalId).classList.remove('active'); 
}

// Close modal handlers
document.querySelectorAll('.close-modal, .cancel-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
    });
});

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 3300);
}

function generateId() { return 'id_' + Math.random().toString(36).substr(2, 9); }
function formatCurrency(amount) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount); }
function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
    set(operatorsRef, operators).catch(err => showToast("Error syncing to Cloud DB!", "error"));
    renderApp();
}

function calculateOperatorMetrics(operator) {
    const plans = operator.plans || [];
    const payments = operator.payments || [];
    const realPlans = plans.filter(p => !p.type.includes('18% GST') && !p.type.includes('GST 18%'));
    let totalUsers = realPlans.reduce((sum, p) => sum + parseInt(p.users || 0), 0);
    let baseRevenue = realPlans.reduce((sum, p) => sum + (parseInt(p.users || 0) * parseFloat(p.rate || 0)), 0);

    (operator.subscribers || []).forEach(sub => {
        totalUsers += 1;
        baseRevenue += parseFloat(sub.rate || 0);
    });

    const hasLegacyGst = plans.some(p => p.type.includes('18% GST') || p.type.includes('GST 18%'));
    if (hasLegacyGst) operator.applyGst = true;

    const gstAmount = operator.applyGst ? (baseRevenue * 0.18) : 0;
    const expectedRevenue = baseRevenue + gstAmount;

    const totalPaid = payments.filter(p => p.status === 'Paid').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const outstanding = expectedRevenue - totalPaid;

    return { totalUsers, baseRevenue, gstAmount, expectedRevenue, totalPaid, outstanding };
}

function getExpiryStatus(expiryStr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryStr); exp.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'Expired', color: 'danger', days: diffDays };
    if (diffDays <= 2) return { label: 'Expiring Soon', color: 'warning', days: diffDays };
    return { label: 'Active', color: 'success', days: diffDays };
}

// ------ LOGIN & ROUTING LOGIC ------
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    const sysAdminPass = localStorage.getItem(ADMIN_PASS_KEY) || 'admin';

    if (u === 'admin' && p === sysAdminPass) {
        activeUser = { role: 'admin' };
        localStorage.setItem('hybrid_auth', JSON.stringify(activeUser));
        showToast('Logged in as Super Admin');
        renderApp();
    } else {
        const op = operators.find(o => o.username === u && o.password === p);
        if (op) {
            activeUser = { role: 'operator', id: op.id };
            localStorage.setItem('hybrid_auth', JSON.stringify(activeUser));
            showToast(`Welcome back, ${op.name}`);
            renderApp();
        } else {
            showToast('Invalid Username or Password', 'error');
        }
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    activeUser = null;
    currentAdminViewOpId = null;
    localStorage.removeItem('hybrid_auth');
    document.getElementById('login-form').reset();
    renderApp();
});

let adminChartInstance = null;
let adminFinancialChartInstance = null;
let opChartInstance = null;
let renderTimeout = null;

function renderApp() {
    if (renderTimeout) clearTimeout(renderTimeout);

    renderTimeout = setTimeout(() => {
        const headerActions = document.getElementById('header-actions');
        const adminActions = document.getElementById('admin-header-actions');
        const greeting = document.getElementById('user-greeting');
        const fabButton = document.getElementById('add-operator-fab');

        const sysLogo = localStorage.getItem('jarvis_hybrid_logo') || 'logo.png';
        const logoImg = document.getElementById('company-logo');
        if (logoImg) logoImg.src = sysLogo;

        if (!activeUser) {
            headerActions.style.display = 'none';
            switchView('login');
            if (fabButton) fabButton.style.display = 'none';
            return;
        }

        headerActions.style.display = 'flex';

        if (activeUser.role === 'admin') {
            adminActions.style.display = 'flex';
            greeting.textContent = 'Super Admin';
            if (fabButton) fabButton.style.display = 'flex';

            if (currentAdminViewOpId) {
                renderAdminOperatorDetail();
                switchView('adminDetail');
            } else {
                renderAdminDashboard();
                switchView('adminDash');
            }
        } else if (activeUser.role === 'operator') {
            adminActions.style.display = 'none';
            if (fabButton) fabButton.style.display = 'none';

            const op = operators.find(o => o.id === activeUser.id);
            if (op) {
                greeting.textContent = `Hi, ${op.name}`;
                renderOperatorPortal(op);
                switchView('opPortal');
            } else if (operators.length > 0) {
                showToast('Your account is no longer active.', 'error');
                document.getElementById('logout-btn').click();
            } else {
                greeting.textContent = 'Syncing access...';
            }
        }
    }, 50);
}

// ------ ADMIN DASHBOARD LOGIC ------
function renderAdminDashboard(searchTerm = '') {
    let globalUsers = 0; let globalExpected = 0; let globalPaid = 0;
    let globalBalanceAdded = 0;
    let iptvCount = 0; let ottCount = 0;
    operators.forEach(op => {
        const m = calculateOperatorMetrics(op);
        globalUsers += m.totalUsers; globalExpected += m.expectedRevenue; globalPaid += m.totalPaid;
        (op.payments || []).forEach(p => {
            if (p.type === 'Balance Add' && p.status === 'Paid') {
                globalBalanceAdded += parseFloat(p.amount || 0);
            }
        });
        (op.subscribers || []).forEach(s => {
            if (s.platform === 'IPTV') iptvCount++;
            else if (s.platform === 'OTT') ottCount++;
        });
    });
    const globalOutstanding = globalExpected - globalPaid;
    const regularCollected = Math.max(0, globalPaid - globalBalanceAdded);

    if (adminChartInstance) {
        adminChartInstance.destroy();
        adminChartInstance = null;
    }
    if (adminFinancialChartInstance) {
        adminFinancialChartInstance.destroy();
        adminFinancialChartInstance = null;
    }

    const ctx = document.getElementById('adminGlobalChart');
    if (ctx) {
        adminChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Broadband / Normal', 'IPTV Users', 'OTT Users'],
                datasets: [{
                    data: [Math.max(0, globalUsers - (iptvCount + ottCount)), iptvCount, ottCount],
                    backgroundColor: ['#4f46e5', '#10b981', '#f59e0b'],
                    hoverBackgroundColor: ['#4338ca', '#059669', '#d97706'],
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    hoverOffset: 8,
                    borderRadius: 4,
                    spacing: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 25, font: { family: 'Inter', size: 13, weight: '600' }, color: '#334155', usePointStyle: true, pointStyle: 'circle' } },
                    tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { family: 'Inter', size: 14, weight: '700' }, bodyFont: { family: 'Inter', size: 13 }, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 6 }
                },
                onClick: () => { openChartDetails(operators); }
            }
        });
    }

    const mCtx = document.getElementById('adminFinancialChart');
    if (mCtx) {
        adminFinancialChartInstance = new Chart(mCtx, {
            type: 'doughnut',
            data: {
                labels: ['Regular Collected', 'Balance Added (Log)', 'Pending Dues'],
                datasets: [{
                    data: [regularCollected, globalBalanceAdded, Math.max(0, globalOutstanding)],
                    backgroundColor: ['#10b981', '#3b82f6', '#ef4444'],
                    hoverBackgroundColor: ['#059669', '#2563eb', '#dc2626'],
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    hoverOffset: 8,
                    borderRadius: 4,
                    spacing: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 25, font: { family: 'Inter', size: 13, weight: '600' }, color: '#334155', usePointStyle: true, pointStyle: 'circle' } },
                    tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { family: 'Inter', size: 14, weight: '700' }, bodyFont: { family: 'Inter', size: 13 }, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 6 }
                }
            }
        });
    }

    document.getElementById('global-summary').innerHTML = `
        <div class="stat-card"><div class="stat-icon primary"><i class="fa-solid fa-users"></i></div><div class="stat-content"><p>Total Operators</p><h3>${operators.length}</h3></div></div>
        <div class="stat-card"><div class="stat-icon primary"><i class="fa-solid fa-network-wired"></i></div><div class="stat-content"><p>Total Service Lines</p><h3>${globalUsers}</h3></div></div>
        <div class="stat-card"><div class="stat-icon success"><i class="fa-solid fa-indian-rupee-sign"></i></div><div class="stat-content"><p>Total Revenue (Expected)</p><h3>${formatCurrency(globalExpected)}</h3></div></div>
        <div class="stat-card"><div class="stat-icon ${globalOutstanding > 0 ? 'warning' : 'success'}"><i class="fa-solid fa-scale-balanced"></i></div><div class="stat-content"><p>Outstanding Balances</p><h3>${formatCurrency(globalOutstanding)}</h3></div></div>
    `;

    const opList = document.getElementById('operator-list');
    opList.innerHTML = '';
    const filtered = operators.filter(op => op.name.toLowerCase().includes(searchTerm.toLowerCase()));

    if (filtered.length === 0) {
        opList.innerHTML = `<div style="grid-column: 1 / -1" class="empty-state"><i class="fa-solid fa-box-open"></i><p>No operators found.</p></div>`;
        return;
    }

    filtered.forEach(op => {
        const m = calculateOperatorMetrics(op);
        let expireWarn = '';
        if (op.subscribers && op.subscribers.length > 0) {
            let expCount = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days <= 2 && getExpiryStatus(s.expiryDate).days >= 0).length;
            let alreadyExpCount = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days < 0).length;
            if (expCount > 0 || alreadyExpCount > 0) {
                expireWarn = `<div style="margin-top: 10px; font-size: 0.8rem; display: flex; gap: 0.5rem;">`;
                if (expCount > 0) expireWarn += `<span class="status-badge" style="background:#fef3c7; color:#b45309;">${expCount} Expiring Soon</span>`;
                if (alreadyExpCount > 0) expireWarn += `<span class="status-badge" style="background:#fee2e2; color:#b91c1c;">${alreadyExpCount} Expired</span>`;
                expireWarn += `</div>`;
            }
        }

        const card = document.createElement('div');
        card.className = 'operator-card';
        card.onclick = () => { currentAdminViewOpId = op.id; renderApp(); };
        card.innerHTML = `
            <div class="operator-header">
                <div class="operator-info">
                    <h3>${op.name}</h3>
                    <p>Added: ${formatDate(op.createdAt)}</p>
                    ${op.phone ? `<p style="font-size:0.75rem; color:var(--primary-color); margin-top:2px;">${op.phone}</p>` : ''}
                </div>
                <div class="operator-icon"><i class="fa-solid fa-plug-circle-bolt"></i></div>
            </div>
            ${expireWarn}
            <div class="operator-stats">
                <div class="op-stat-item"><span>Total Users</span><strong>${m.totalUsers}</strong></div>
                <div class="op-stat-item"><span>Status</span><span class="status-badge ${m.outstanding <= 0 ? 'badge-paid' : 'badge-unpaid'}">${m.outstanding <= 0 && m.expectedRevenue > 0 ? 'Clear' : 'Pending'}</span></div>
                <div class="op-stat-item"><span>Paid</span><strong class="text-success">${formatCurrency(m.totalPaid)}</strong></div>
                <div class="op-stat-item"><span>Due</span><strong class="${m.outstanding > 0 ? 'text-warning' : 'text-success'}">${formatCurrency(m.outstanding)}</strong></div>
            </div>
        `;
        opList.appendChild(card);
    });
}

// ------ ADMIN OPERATOR DETAILS ------
function renderAdminOperatorDetail() {
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (!op) { currentAdminViewOpId = null; renderApp(); return; }

    document.getElementById('view-op-title').textContent = op.name;
    const m = calculateOperatorMetrics(op);
    let iptvCount = 0; let ottCount = 0;
    (op.subscribers || []).forEach(s => {
        if (s.platform === 'IPTV') iptvCount++;
        else if (s.platform === 'OTT') ottCount++;
    });

    document.getElementById('admin-op-summary').innerHTML = `
        <div class="stat-card"><div class="stat-icon primary"><i class="fa-solid fa-users-rays"></i></div>
            <div class="stat-content"><p>Total Assigned Users</p><h3>${m.totalUsers}</h3></div></div>
        <div class="stat-card"><div class="stat-icon" style="color:#10b981; background:rgba(16,185,129,0.1);"><i class="fa-solid fa-tv"></i></div>
            <div class="stat-content"><p>IPTV Active</p><h3>${iptvCount}</h3></div></div>
        <div class="stat-card"><div class="stat-icon" style="color:#f59e0b; background:rgba(245,158,11,0.1);"><i class="fa-solid fa-mobile-screen"></i></div>
            <div class="stat-content"><p>OTT Active</p><h3>${ottCount}</h3></div></div>
        <div class="stat-card"><div class="stat-icon ${m.outstanding > 0 ? 'danger' : 'success'}"><i class="fa-solid fa-file-invoice-dollar"></i></div>
            <div class="stat-content"><p>Outstanding Due</p><h3>${formatCurrency(m.outstanding)}</h3></div></div>
    `;

    renderPlansTable('plans-tbody', op, m, true);
    renderPaymentsTable('payments-tbody', op, true);
    renderSubscribersTable('iptv-subscribers-tbody', op, true, 'IPTV');
    renderSubscribersTable('ott-subscribers-tbody', op, true, 'OTT');
}

// ------ OPERATOR PORTAL (READ-ONLY) ------
function renderOperatorPortal(op) {
    const m = calculateOperatorMetrics(op);

    document.getElementById('op-profile-name').textContent = op.name;
    document.getElementById('op-profile-phone').textContent = op.phone || 'N/A';
    document.getElementById('op-profile-port').textContent = op.portDetails || 'Standard Port';
    document.getElementById('op-profile-address').textContent = op.address || 'N/A';

    let iptvCount = 0; let ottCount = 0;
    (op.subscribers || []).forEach(s => {
        if (s.platform === 'IPTV') iptvCount++;
        else if (s.platform === 'OTT') ottCount++;
    });

    if (opChartInstance) {
        opChartInstance.destroy();
        opChartInstance = null;
    }

    const ctx = document.getElementById('opPortalChart');
    if (ctx) {
        opChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Broadband / Normal', 'IPTV Users', 'OTT Users'],
                datasets: [{
                    data: [Math.max(0, m.totalUsers - (iptvCount + ottCount)), iptvCount, ottCount],
                    backgroundColor: ['#4f46e5', '#10b981', '#f59e0b'],
                    hoverBackgroundColor: ['#4338ca', '#059669', '#d97706'],
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    hoverOffset: 8,
                    borderRadius: 4,
                    spacing: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                animation: {
                    animateScale: true,
                    animateRotate: true,
                    duration: 1500,
                    easing: 'easeInOutQuart'
                },
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 25, font: { family: 'Inter', size: 13, weight: '600' }, color: '#334155', usePointStyle: true, pointStyle: 'circle' } },
                    tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { family: 'Inter', size: 14, weight: '700' }, bodyFont: { family: 'Inter', size: 13 }, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 6 }
                },
                onClick: () => { openChartDetails([op]); }
            }
        });
    }

    document.getElementById('op-portal-summary').innerHTML = `
        <div class="stat-card"><div class="stat-icon primary"><i class="fa-solid fa-users-rays"></i></div>
            <div class="stat-content"><p>Total Active Users</p><h3>${m.totalUsers}</h3></div></div>
        <div class="stat-card"><div class="stat-icon" style="color:#10b981; background:rgba(16,185,129,0.1);"><i class="fa-solid fa-tv"></i></div>
            <div class="stat-content"><p>IPTV Active</p><h3>${iptvCount}</h3></div></div>
        <div class="stat-card"><div class="stat-icon" style="color:#f59e0b; background:rgba(245,158,11,0.1);"><i class="fa-solid fa-mobile-screen"></i></div>
            <div class="stat-content"><p>OTT Active</p><h3>${ottCount}</h3></div></div>
        <div class="stat-card"><div class="stat-icon ${m.outstanding > 0 ? 'danger' : 'success'}"><i class="fa-solid fa-file-invoice-dollar"></i></div>
            <div class="stat-content"><p>Total Due Pending</p><h3>${formatCurrency(m.outstanding)}</h3></div></div>
    `;

    renderPlansTable('op-portal-plans-tbody', op, m, false);
    renderPaymentsTable('op-portal-payments-tbody', op, false);
    renderSubscribersTable('op-portal-iptv-subscribers-tbody', op, false, 'IPTV');
    renderSubscribersTable('op-portal-ott-subscribers-tbody', op, false, 'OTT');
}

// ------ SHARED RENDERING FUNCTIONS ------
function renderPlansTable(tbodyId, operator, metrics, isAdmin) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    
    const displayPlans = (operator.plans || [])
        .filter(p => !p.type.includes('18% GST') && !p.type.includes('GST 18%'))
        .filter(p => parseInt(p.users || 0) > 0);

    if (displayPlans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 5}" class="empty-state">No active packages with users.</td></tr>`;
        return;
    }

    displayPlans.forEach(p => {
        if (!isAdmin) {
            tbody.innerHTML += `<tr>
                <td><span class="status-badge" style="background:#f1f5f9; color:#475569;">${p.category || 'Internet'}</span></td>
                <td><strong>${p.type}</strong></td>
                <td>${p.users}</td>
                <td>${formatCurrency(p.rate)}</td>
                <td><strong>${formatCurrency(p.users * p.rate)}</strong></td>
            </tr>`;
        } else {
            tbody.innerHTML += `<tr>
                <td><span class="status-badge" style="background:#f1f5f9; color:#475569;">${p.category || 'Internet'}</span></td>
                <td><strong>${p.type}</strong></td>
                <td>${p.users}</td>
                <td>${formatCurrency(p.rate)}</td>
                <td><strong>${formatCurrency(p.users * p.rate)}</strong></td>
                <td>
                    <button class="btn-icon" onclick="editPlan('${p.id}')"><i class="fa-solid fa-pen text-primary"></i></button>
                    <button class="btn-icon" onclick="deletePlan('${p.id}')"><i class="fa-solid fa-trash text-danger"></i></button>
                </td>
            </tr>`;
        }
    });

    if (operator.applyGst && metrics.baseRevenue > 0 && isAdmin) {
        tbody.innerHTML += `
            <tr style="background-color: var(--surface-hover);"><td colspan="4" style="text-align: right; font-weight: 600; color: var(--text-muted);">Base Subtotal:</td><td colspan="2"><strong>${formatCurrency(metrics.baseRevenue)}</strong></td></tr>
            <tr style="background-color: #eff6ff;"><td colspan="4" style="text-align: right; font-weight: 600; color: var(--primary-color);">+ 18% GST Appended:</td><td colspan="2"><strong style="color: var(--primary-color);">${formatCurrency(metrics.gstAmount)}</strong></td></tr>
            <tr><td colspan="4" style="text-align: right; font-weight: 700; color: var(--text-main);">Grand Total Expected:</td><td colspan="2"><strong>${formatCurrency(metrics.expectedRevenue)}</strong></td></tr>`;
    }
}

function renderPaymentsTable(tbodyId, operator, isAdmin) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    const sorted = (operator.payments || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 5 : 4}" class="empty-state">No payment history.</td></tr>`;
        return;
    }

    sorted.forEach(p => {
        let statStyle = p.status === 'Paid' ? 'badge-paid' : 'badge-unpaid';

        if (!isAdmin) {
            tbody.innerHTML += `<tr>
                <td>${formatDate(p.date)}</td>
                <td>${p.type}</td>
                <td><strong>${formatCurrency(p.amount)}</strong></td>
                <td><span class="status-badge ${statStyle}">${p.status}</span></td>
            </tr>`;
        } else {
            tbody.innerHTML += `<tr>
                <td>${formatDate(p.date)}</td>
                <td>${p.type}</td>
                <td><strong>${formatCurrency(p.amount)}</strong></td>
                <td><span class="status-badge ${statStyle}" style="cursor:pointer;" onclick="togglePaymentStatus('${p.id}')">${p.status} <i class="fa-solid fa-rotate"></i></span></td>
                <td><button class="btn-icon" onclick="deletePayment('${p.id}')"><i class="fa-solid fa-trash text-danger"></i></button></td>
            </tr>`;
        }
    });
}

function renderSubscribersTable(tbodyId, operator, isAdmin, platformType) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    const subs = (operator.subscribers || []).filter(s => s.platform === platformType).slice().sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    if (subs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 5}" class="empty-state">No individual users tracked yet.</td></tr>`;
        return;
    }

    subs.forEach(sub => {
        const expStatus = getExpiryStatus(sub.expiryDate);
        const tr = document.createElement('tr');
        if (expStatus.days <= 2 && expStatus.days >= 0) tr.style.backgroundColor = '#fffbeb';
        else if (expStatus.days < 0) tr.style.backgroundColor = '#fef2f2';

        if (isAdmin) {
            tr.innerHTML = `
                <td><strong>${sub.name}</strong></td>
                <td><span style="font-size: 11px; padding: 2px 6px; background: #e2e8f0; border-radius: 4px; border: 1px solid #cbd5e1;">${sub.platform}</span><br><span style="margin-top:4px; display:inline-block;">${sub.bundle}</span></td>
                <td><div style="font-size: 0.8rem; color: var(--text-muted);">Start: ${formatDate(sub.createdDate)}</div><div style="font-weight: 600; color: ${expStatus.days <= 2 ? 'var(--danger-color)' : 'var(--text-main)'};">Exp: ${formatDate(sub.expiryDate)}</div></td>
                <td><span class="status-badge" style="background: var(--${expStatus.color}-color); color: white;">${expStatus.label}</span></td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm btn-outline" style="color:#25D366; border-color:#25D366; background:white;" onclick="sendReminder('${operator.id}','${sub.id}','whatsapp')"><i class="fa-brands fa-whatsapp"></i> WA</button>
                        <button class="btn btn-sm btn-outline" onclick="sendReminder('${operator.id}','${sub.id}','sms')"><i class="fa-solid fa-comment-sms"></i> SMS</button>
                    </div>
                </td>
                <td>
                    <button class="btn-icon" onclick="editSubscriber('${sub.id}')"><i class="fa-solid fa-pen text-primary"></i></button>
                    <button class="btn-icon" onclick="deleteSubscriber('${sub.id}')"><i class="fa-solid fa-trash text-danger"></i></button>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td><strong>${sub.name}</strong></td>
                <td><span style="font-size: 11px; padding: 2px 6px; background: #e2e8f0; border-radius: 4px; border: 1px solid #cbd5e1;">${sub.platform}</span><br><span style="margin-top:4px; display:inline-block;">${sub.bundle}</span></td>
                <td><div style="font-size: 0.8rem; color: var(--text-muted);">Start: ${formatDate(sub.createdDate)}</div><div style="font-weight: 600; color: ${expStatus.days <= 2 ? 'var(--danger-color)' : 'var(--text-main)'};">Exp: ${formatDate(sub.expiryDate)}</div></td>
                <td><span class="status-badge" style="background: var(--${expStatus.color}-color); color: white;">${expStatus.label}</span></td>
                <td><span style="font-size:0.75rem; color:#94a3b8;">Read Only</span></td>
            `;
        }
        tbody.appendChild(tr);
    });
}

function openChartDetails(targetOps) {
    let totalUsers = 0;
    let iptvCount = 0; let ottCount = 0;
    let iptvExpArr = []; let ottExpArr = [];

    targetOps.forEach(op => {
        const m = calculateOperatorMetrics(op);
        totalUsers += m.totalUsers;
        (op.subscribers || []).forEach(s => {
            let exp = getExpiryStatus(s.expiryDate);
            if (s.platform === 'IPTV') {
                iptvCount++;
                if (exp.days <= 7 && exp.days >= 0) iptvExpArr.push(`<tr><td style="padding:0; font-size:12px;"><strong>${s.name}</strong> <span style="color:#64748b; font-size:10px;">(${op.name})</span></td><td style="padding:0; text-align:right; font-size:12px; color:#dc2626;">${exp.days} days</td></tr>`);
            } else if (s.platform === 'OTT') {
                ottCount++;
                if (exp.days <= 7 && exp.days >= 0) ottExpArr.push(`<tr><td style="padding:0; font-size:12px;"><strong>${s.name}</strong> <span style="color:#64748b; font-size:10px;">(${op.name})</span></td><td style="padding:0; text-align:right; font-size:12px; color:#dc2626;">${exp.days} days</td></tr>`);
            }
        });
    });

    document.getElementById('cd-total-users').textContent = totalUsers;
    document.getElementById('cd-iptv-users').textContent = iptvCount;
    document.getElementById('cd-ott-users').textContent = ottCount;

    document.getElementById('cd-iptv-exp').innerHTML = iptvExpArr.length > 0
        ? `<table style="width:100%; border-collapse: collapse;">${iptvExpArr.join('')}</table>`
        : '<span style="color:#64748b; font-size:11px;">None</span>';

    document.getElementById('cd-ott-exp').innerHTML = ottExpArr.length > 0
        ? `<table style="width:100%; border-collapse: collapse;">${ottExpArr.join('')}</table>`
        : '<span style="color:#64748b; font-size:11px;">None</span>';

    openModal('chart-details-modal');
}

// ------ PDF GENERATION ------
let isGeneratingPDF = false;

function triggerPrint(htmlContent, filename, qrHtml = '', opName = '') {
    if (isGeneratingPDF) {
        showToast("Already generating PDF, please wait...", "warning");
        return;
    }

    isGeneratingPDF = true;

    const logoSrc = localStorage.getItem('jarvis_hybrid_logo') || 'logo.png';
    const sealSrc = localStorage.getItem('jarvis_hybrid_seal') || 'seal.png';
    const gstNo = localStorage.getItem(GST_KEY) || 'Not Provided';

    const opNameBlock = opName ? `<p style="font-size: 11px; color: #64748b; margin: 0; text-transform: uppercase;">Portal Billed To</p>
                        <p style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 0 0 5px 0; text-transform: uppercase;">${opName}</p>` : `<p style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0; text-transform: uppercase;">INVOICE / RECEIPT</p>`;

    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = `<div style="padding: 2rem; background: #ffffff; color: #1e293b; font-family: 'Inter', sans-serif; box-sizing: border-box;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.5rem;">
            <div style="text-align: left;">
                <img src="${logoSrc}" style="max-height: 50px; display: block;" onerror="this.style.display='none'">
                <h1 style="margin: 0.5rem 0 0 0; font-size: 20px; font-weight: 800; color: #0f172a;">HYBRID INTERNET</h1>
                <p style="margin: 2px 0; font-size: 11px; color: #64748b;">GSTIN: <strong>${gstNo}</strong></p>
            </div>
            <div style="text-align: right;">
                ${opNameBlock}
                <p style="font-size: 11px; color: #64748b; margin: 2px 0;">Date: <strong>${formatDate(new Date())}</strong></p>
            </div>
        </div>
        
        ${htmlContent}
        
        ${qrHtml}
        
        <div style="margin-top: 2rem; text-align: right; border-top: 2px dashed #e2e8f0; padding-top: 1.5rem;">
            <div style="display: inline-block; text-align: center;">
                <img src="${sealSrc}" style="height: 100px; width: auto; display: block; margin: 0 auto;" onerror="this.style.display='none'" alt="Seal">
                <div style="border-top: 1px solid #cbd5e1; padding-top: 10px; width: 200px;">
                    <p style="margin: 0; font-weight: 700; font-size: 14px;">Authorized Signatory</p>
                </div>
            </div>
        </div>
    </div>`;

    const opt = { 
        margin: [0.5, 0.5, 0.5, 0.5], 
        filename, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2, useCORS: true }, 
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' } 
    };

    if (window.html2pdf) {
        showToast("Generating PDF...");
        document.body.appendChild(tempContainer);

        html2pdf().set(opt).from(tempContainer).save().then(() => {
            document.body.removeChild(tempContainer);
            showToast("Download successful.");
            isGeneratingPDF = false;
        }).catch(err => {
            console.error('PDF error:', err);
            document.body.removeChild(tempContainer);
            showToast("Error generating PDF", "error");
            isGeneratingPDF = false;
        });
    } else {
        alert('PDF library not loaded');
        isGeneratingPDF = false;
    }
}

function handleDownloadBal() {
    const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
    if (!op) return;
    const m = calculateOperatorMetrics(op);
    triggerPrint(`
        <div style="text-align:center; padding: 2rem 0;">
            <h2 style="font-size:24px; color:#0f172a;">Balance Statement</h2>
            <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 16px; padding: 2rem; margin: 2rem auto; max-width: 400px;">
                <h1 style="color:#9f1239; font-size: 3rem;">${formatCurrency(m.outstanding)}</h1>
                <p>Outstanding Amount</p>
            </div>
        </div>
    `, `Balance_${op.name.replace(/\s+/g, '_')}.pdf`, '', op.name);
}

function handleDownloadRpt(e) {
    if (e) {
        e.preventDefault();
        closeModal('report-modal');
    }
    
    const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
    if (!op) return;
    
    const m = calculateOperatorMetrics(op);
    const upiId = localStorage.getItem(UPI_KEY);
    const gstNo = localStorage.getItem(GST_KEY);
    const applyGst = e ? document.getElementById('report-gst').checked : op.applyGst;

    let qrHtml = '';
    if (upiId && upiId.trim() !== '' && m.outstanding > 0) {
        const upiLink = `upi://pay?pa=${encodeURIComponent(upiId.trim())}&pn=Hybrid%20Internet&am=${m.outstanding.toFixed(2)}&cu=INR`;
        qrHtml = `<div style="text-align: center; margin: 2rem 0; padding: 1rem; background: #f8fafc; border-radius: 12px;">
            <p style="font-weight: 600; margin-bottom: 1rem;">📱 Scan to Pay</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiLink)}" style="width: 180px; height: 180px; border: 2px solid #e2e8f0; border-radius: 12px;">
            <p style="margin-top: 0.5rem; font-size: 12px;">UPI: ${upiId}<br>Amount: ${formatCurrency(m.outstanding)}</p>
        </div>`;
    }

    let gstAmount = 0;
    let gstRow = '';
    if (applyGst) {
        gstAmount = m.baseRevenue * 0.18;
        gstRow = `<tr><td colspan="3" style="text-align:right; padding:8px;"><strong>+ GST (18%):</strong></td><td style="text-align:center;"><strong>${formatCurrency(gstAmount)}</strong></td></tr>`;
    }

    let tableRows = '';
    (op.plans || []).filter(p => !p.type.includes('GST') && p.users > 0).forEach(p => {
        tableRows += `<tr>
            <td style="padding:8px; border:1px solid #ddd;">${p.category}</td>
            <td style="padding:8px; border:1px solid #ddd;">${p.type}</td>
            <td style="padding:8px; border:1px solid #ddd; text-align:center;">${p.users} × ${formatCurrency(p.rate)}</td>
            <td style="padding:8px; border:1px solid #ddd; text-align:center;">${formatCurrency(p.users * p.rate)}</td>
        </tr>`;
    });

    (op.subscribers || []).forEach(s => {
        tableRows += `<tr style="background:#f0f9ff;">
            <td style="padding:8px; border:1px solid #ddd;">${s.platform}</td>
            <td style="padding:8px; border:1px solid #ddd;">${s.name} (${s.bundle})</td>
            <td style="padding:8px; border:1px solid #ddd; text-align:center;">1 × ${formatCurrency(s.rate)}</td>
            <td style="padding:8px; border:1px solid #ddd; text-align:center;">${formatCurrency(s.rate)}</td>
        </tr>`;
    });

    const totalWithGst = m.baseRevenue + gstAmount;
    const outstanding = totalWithGst - m.totalPaid;

    triggerPrint(`
        <h2 style="text-align:center; margin-bottom:1.5rem;">Tax Invoice</h2>
        <div style="margin-bottom:1rem; padding:1rem; background:#f8fafc; border-radius:8px;">
            <h3 style="margin:0;">${op.name}</h3>
            <p style="margin:5px 0;">${op.phone || ''} | ${op.address || ''}</p>
        </div>
        
        <table style="width:100%; border-collapse:collapse; margin:1.5rem 0;">
            <thead>
                <tr style="background:#4f46e5; color:white;">
                    <th style="padding:10px;">Category</th>
                    <th style="padding:10px;">Description</th>
                    <th style="padding:10px;">Details</th>
                    <th style="padding:10px;">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="4" style="text-align:center;">No items</td></tr>'}
                <tr style="background:#f1f5f9;"><td colspan="3" style="text-align:right; padding:8px;">Subtotal:</td><td style="text-align:center;">${formatCurrency(m.baseRevenue)}</td></tr>
                ${gstRow}
                <tr style="background:#e2e8f0;"><td colspan="3" style="text-align:right; padding:10px;"><strong>Total:</strong></td><td style="text-align:center;"><strong>${formatCurrency(totalWithGst)}</strong></td></tr>
            </tbody>
        </table>
        
        <div style="background: ${outstanding > 0 ? '#fff1f2' : '#f0fdf4'}; border: 1px solid ${outstanding > 0 ? '#fecdd3' : '#bbf7d0'}; border-radius: 12px; padding: 1.5rem; display: flex; justify-content: space-between;">
            <div><strong>Outstanding:</strong></div>
            <div style="font-size:24px; font-weight:800; color:${outstanding > 0 ? '#be123c' : '#15803d'};">${formatCurrency(outstanding)}</div>
        </div>
    `, `Invoice_${op.name.replace(/\s+/g, '_')}.pdf`, qrHtml, op.name);
}

// PWA Install Logic
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

setTimeout(() => {
    if (!localStorage.getItem('pwa_prompt_dismissed') && window.innerWidth < 768) {
        openModal('pwa-install-modal');
    }
}, 3000);

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
    closeModal('pwa-install-modal');
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome !== 'accepted') localStorage.setItem('pwa_prompt_dismissed', 'true');
        deferredPrompt = null;
    } else {
        alert('To install, tap Browser Menu and select "Add to Home Screen".');
        localStorage.setItem('pwa_prompt_dismissed', 'true');
    }
});

// Operator Menu Button
document.getElementById('op-menu-btn')?.addEventListener('click', () => {
    if (!activeUser || activeUser.role !== 'operator') return;
    const op = operators.find(o => o.id === activeUser.id);
    if (!op) return;

    const iptvList = document.getElementById('op-menu-iptv-list');
    const ottList = document.getElementById('op-menu-ott-list');
    iptvList.innerHTML = '';
    ottList.innerHTML = '';

    const createPlanCard = (p) => {
        return `<div style="padding: 1rem; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 0.5rem;">
            <div style="display: flex; justify-content: space-between;">
                <strong>${p.type}</strong>
                <span style="color:#4f46e5; font-weight:700;">${formatCurrency(p.rate)}</span>
            </div>
            ${p.description ? `<p style="font-size:0.8rem; color:#64748b; margin-top:0.5rem;">${p.description}</p>` : ''}
        </div>`;
    };

    let pIptv = (op.plans || []).filter(p => p.category === 'IPTV');
    let pOtt = (op.plans || []).filter(p => p.category === 'OTT');

    if (pIptv.length === 0) iptvList.innerHTML = '<p style="color:#64748b;">No IPTV packages</p>';
    else pIptv.forEach(p => iptvList.innerHTML += createPlanCard(p));

    if (pOtt.length === 0) ottList.innerHTML = '<p style="color:#64748b;">No OTT packages</p>';
    else pOtt.forEach(p => ottList.innerHTML += createPlanCard(p));

    openModal('op-menu-modal');
});

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW failed', err));
    }

    // Login form
    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const u = document.getElementById('login-username').value.trim();
        const p = document.getElementById('login-password').value;
        const sysAdminPass = localStorage.getItem(ADMIN_PASS_KEY) || 'admin';

        if (u === 'admin' && p === sysAdminPass) {
            activeUser = { role: 'admin' };
            localStorage.setItem('hybrid_auth', JSON.stringify(activeUser));
            showToast('Logged in as Admin');
            renderApp();
        } else {
            const op = operators.find(o => o.username === u && o.password === p);
            if (op) {
                activeUser = { role: 'operator', id: op.id };
                localStorage.setItem('hybrid_auth', JSON.stringify(activeUser));
                showToast(`Welcome ${op.name}`);
                renderApp();
            } else {
                showToast('Invalid credentials', 'error');
            }
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        activeUser = null;
        currentAdminViewOpId = null;
        localStorage.removeItem('hybrid_auth');
        renderApp();
    });

    // Admin Settings
    document.getElementById('admin-settings-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const newPass = document.getElementById('admin-pass-change').value;
        const botToken = document.getElementById('admin-bot-token').value.trim();
        if (newPass) localStorage.setItem(ADMIN_PASS_KEY, newPass);
        if (botToken) localStorage.setItem(BOT_TOKEN_KEY, botToken);

        const logoFile = document.getElementById('admin-logo-upload').files[0];
        const sealFile = document.getElementById('admin-seal-upload').files[0];

        if (logoFile) {
            const reader = new FileReader();
            reader.onload = (e) => localStorage.setItem('jarvis_hybrid_logo', e.target.result);
            reader.readAsDataURL(logoFile);
        }
        if (sealFile) {
            const reader = new FileReader();
            reader.onload = (e) => localStorage.setItem('jarvis_hybrid_seal', e.target.result);
            reader.readAsDataURL(sealFile);
        }

        showToast('Settings saved');
        closeModal('admin-settings-modal');
    });

    // UPI Form
    document.getElementById('upi-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        localStorage.setItem(UPI_KEY, document.getElementById('upi-id').value.trim());
        localStorage.setItem(GST_KEY, document.getElementById('gst-number').value.trim());
        showToast('UPI & GST saved');
        closeModal('upi-modal');
    });

    // Message Templates
    document.getElementById('msg-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        msgTemplates.single = document.getElementById('msg-single').value;
        msgTemplates.bulk = document.getElementById('msg-bulk').value;
        localStorage.setItem(MSG_KEY, JSON.stringify(msgTemplates));
        showToast('Templates saved');
        closeModal('msg-modal');
    });

    // Report Form
    document.getElementById('report-form')?.addEventListener('submit', handleDownloadRpt);

    // Add Operator
    document.getElementById('add-operator-fab')?.addEventListener('click', () => {
        document.getElementById('operator-form').reset();
        document.getElementById('op-id').value = '';
        document.getElementById('op-password').value = Math.random().toString(36).slice(-6);
        document.getElementById('op-modal-title').textContent = 'Add Operator';
        openModal('operator-modal');
    });

    // Operator Form Submit
    document.getElementById('operator-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('op-id').value;
        const data = {
            name: document.getElementById('op-name').value.trim(),
            username: document.getElementById('op-username').value.trim(),
            password: document.getElementById('op-password').value.trim(),
            phone: document.getElementById('op-phone').value.trim(),
            portDetails: document.getElementById('op-port').value.trim(),
            chatId: document.getElementById('op-chat-id').value.trim(),
            address: document.getElementById('op-address').value.trim()
        };

        if (operators.some(o => o.username === data.username && o.id !== id)) {
            showToast('Username taken!', 'error');
            return;
        }

        if (id) {
            const op = operators.find(o => o.id === id);
            Object.assign(op, data);
            showToast('Operator updated');
        } else {
            const newOp = { 
                id: generateId(), 
                ...data, 
                createdAt: new Date().toISOString(), 
                plans: [], 
                payments: [], 
                subscribers: [] 
            };
            operators.push(newOp);
            showToast('Operator created');
            currentAdminViewOpId = newOp.id;
        }

        const op = operators.find(o => o.id === (id || currentAdminViewOpId));
        
        // Add IPTV packages
        document.querySelectorAll('.iptv-row').forEach(row => {
            const name = row.querySelector('.iptv-name-input')?.value.trim();
            const rate = row.querySelector('.iptv-rate-input')?.value;
            const desc = row.querySelector('.iptv-desc-input')?.value.trim();
            if (name && rate) {
                op.plans.push({ 
                    id: generateId(), 
                    category: 'IPTV', 
                    type: name, 
                    rate: parseFloat(rate), 
                    users: 0, 
                    description: desc 
                });
            }
        });

        // Add OTT packages
        document.querySelectorAll('.ott-row').forEach(row => {
            const name = row.querySelector('.ott-name-input')?.value.trim();
            const rate = row.querySelector('.ott-rate-input')?.value;
            const desc = row.querySelector('.ott-desc-input')?.value.trim();
            if (name && rate) {
                op.plans.push({ 
                    id: generateId(), 
                    category: 'OTT', 
                    type: name, 
                    rate: parseFloat(rate), 
                    users: 0, 
                    description: desc 
                });
            }
        });

        saveData();
        closeModal('operator-modal');
    });

    // Plan Form
    document.getElementById('plan-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (!op) return;

        const planId = document.getElementById('plan-id').value;
        const planData = {
            category: document.getElementById('plan-category').value,
            type: document.getElementById('plan-type').value,
            description: document.getElementById('plan-description').value,
            users: parseInt(document.getElementById('plan-users').value),
            rate: parseFloat(document.getElementById('plan-rate').value)
        };

        if (planId) {
            const index = op.plans.findIndex(p => p.id === planId);
            if (index >= 0) op.plans[index] = { id: planId, ...planData };
        } else {
            op.plans.push({ id: generateId(), ...planData });
        }

        saveData();
        closeModal('plan-modal');
        showToast('Plan saved');
    });

    // Payment Form
    document.getElementById('payment-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op) return;

        op.payments.push({
            id: generateId(),
            type: document.getElementById('payment-type').value,
            amount: parseFloat(document.getElementById('payment-amount').value),
            date: document.getElementById('payment-date').value,
            status: document.getElementById('payment-status').value
        });

        saveData();
        closeModal('payment-modal');
        showToast('Payment added');
    });

    // Subscriber Form
    document.getElementById('sub-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (!op) return;

        const subId = document.getElementById('sub-id').value;
        const bundleOpt = document.getElementById('sub-bundle').selectedOptions[0];
        
        if (!bundleOpt || !bundleOpt.value) {
            showToast('Select a package first', 'error');
            return;
        }

        const subData = {
            name: document.getElementById('sub-name').value,
            platform: document.getElementById('sub-platform').value,
            bundle: bundleOpt.dataset.type,
            rate: parseFloat(bundleOpt.dataset.rate),
            createdDate: document.getElementById('sub-created').value,
            expiryDate: document.getElementById('sub-expiry').value
        };

        if (subId) {
            const index = op.subscribers.findIndex(s => s.id === subId);
            if (index >= 0) op.subscribers[index] = { id: subId, ...subData };
        } else {
            op.subscribers.push({ id: generateId(), ...subData });
        }

        saveData();
        closeModal('sub-modal');
        showToast('User saved');
    });

    // Platform change - populate bundles
    document.getElementById('sub-platform')?.addEventListener('change', (e) => {
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (!op) return;

        const bundleSelect = document.getElementById('sub-bundle');
        bundleSelect.innerHTML = '';
        
        const packs = (op.plans || []).filter(p => p.category === e.target.value);
        packs.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.type} - ${formatCurrency(p.rate)}`;
            opt.dataset.rate = p.rate;
            opt.dataset.type = p.type;
            bundleSelect.appendChild(opt);
        });
    });

    // Search
    document.getElementById('search-operator')?.addEventListener('input', (e) => {
        if (activeUser?.role === 'admin' && !currentAdminViewOpId) {
            renderAdminDashboard(e.target.value);
        }
    });

    // Back button
    document.getElementById('admin-back-to-dash')?.addEventListener('click', () => {
        currentAdminViewOpId = null;
        renderApp();
    });

    // Edit operator
    document.getElementById('edit-op-info-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op) return;

        document.getElementById('op-id').value = op.id;
        document.getElementById('op-name').value = op.name;
        document.getElementById('op-username').value = op.username || '';
        document.getElementById('op-password').value = op.password || '';
        document.getElementById('op-phone').value = op.phone || '';
        document.getElementById('op-port').value = op.portDetails || '';
        document.getElementById('op-chat-id').value = op.chatId || '';
        document.getElementById('op-address').value = op.address || '';

        // IPTV rows
        const iptvPacks = (op.plans || []).filter(p => p.category === 'IPTV');
        const iptvContainer = document.getElementById('iptv-rows-container');
        iptvContainer.innerHTML = '';
        if (iptvPacks.length === 0) iptvPacks.push({});
        iptvPacks.forEach((p, idx) => {
            iptvContainer.insertAdjacentHTML('beforeend', `
                <div class="form-group iptv-row" style="padding:10px; background:#f0fdf4; border:1px dashed #10b981; margin-bottom:0.5rem;">
                    <label style="color:#10b981; display:flex; justify-content:space-between;">
                        <span>📺 IPTV Package</span>
                        ${idx > 0 ? '<button type="button" class="btn-icon" onclick="this.closest(\'.iptv-row\').remove()">❌</button>' : ''}
                    </label>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                        <input type="text" class="iptv-name-input" value="${p.type || ''}" placeholder="Package name">
                        <input type="number" class="iptv-rate-input" value="${p.rate || ''}" placeholder="Rate">
                    </div>
                    <textarea class="iptv-desc-input" rows="1" style="width:100%; margin-top:0.5rem;" placeholder="Description">${p.description || ''}</textarea>
                </div>
            `);
        });

        // OTT rows
        const ottPacks = (op.plans || []).filter(p => p.category === 'OTT');
        const ottContainer = document.getElementById('ott-rows-container');
        ottContainer.innerHTML = '';
        if (ottPacks.length === 0) ottPacks.push({});
        ottPacks.forEach((p, idx) => {
            ottContainer.insertAdjacentHTML('beforeend', `
                <div class="form-group ott-row" style="padding:10px; background:#fffbeb; border:1px dashed #f59e0b; margin-bottom:0.5rem;">
                    <label style="color:#f59e0b; display:flex; justify-content:space-between;">
                        <span>📱 OTT Package</span>
                        ${idx > 0 ? '<button type="button" class="btn-icon" onclick="this.closest(\'.ott-row\').remove()">❌</button>' : ''}
                    </label>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                        <input type="text" class="ott-name-input" value="${p.type || ''}" placeholder="Package name">
                        <input type="number" class="ott-rate-input" value="${p.rate || ''}" placeholder="Rate">
                    </div>
                    <textarea class="ott-desc-input" rows="1" style="width:100%; margin-top:0.5rem;" placeholder="Description">${p.description || ''}</textarea>
                </div>
            `);
        });

        document.getElementById('op-modal-title').textContent = 'Edit Operator';
        openModal('operator-modal');
    });

    // Bulk remind
    document.getElementById('remind-all-expiring-btn')?.addEventListener('click', async () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op || !op.subscribers) return;

        const expiring = op.subscribers.filter(s => {
            const days = getExpiryStatus(s.expiryDate).days;
            return days <= 2 && days >= 0;
        });

        const expired = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days < 0);

        if (expiring.length === 0 && expired.length === 0) {
            showToast('No expiring users');
            return;
        }

        let msg = msgTemplates.bulk.replace(/{OperatorName}/g, op.name) + "\n\n";
        if (expiring.length) msg += "⏳ Expiring Soon:\n" + expiring.map(s => `- ${s.name} (${s.platform}) Exp: ${formatDate(s.expiryDate)}`).join('\n') + "\n";
        if (expired.length) msg += "\n❌ Expired:\n" + expired.map(s => `- ${s.name} (${s.platform})`).join('\n');

        const token = localStorage.getItem(BOT_TOKEN_KEY);
        if (token && op.chatId) {
            showToast('Sending Telegram...');
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: op.chatId, text: msg })
            });
            if (res.ok) showToast('Message sent');
            else showToast('Telegram failed', 'error');
        } else if (op.phone) {
            window.open(`https://wa.me/${op.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    });

    // Report button
    document.getElementById('report-btn')?.addEventListener('click', () => openModal('report-modal'));
    document.getElementById('balance-receipt-btn')?.addEventListener('click', handleDownloadBal);

    // No dues receipt
    document.getElementById('receipt-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op) return;
        triggerPrint(`
            <div style="text-align:center; padding:3rem;">
                <h2 style="color:#10b981;">✓ NO DUES CERTIFICATE</h2>
                <p>All payments cleared for ${op.name}</p>
            </div>
        `, `No_Dues_${op.name.replace(/\s+/g, '_')}.pdf`);
    });

    // Delete operator
    document.getElementById('delete-op-btn')?.addEventListener('click', () => {
        if (confirm('Delete this operator permanently?')) {
            operators = operators.filter(o => o.id !== currentAdminViewOpId);
            currentAdminViewOpId = null;
            saveData();
            showToast('Operator deleted');
        }
    });

    // GST buttons
    document.getElementById('add-gst-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            op.applyGst = true;
            saveData();
            showToast('GST applied');
        }
    });

    document.getElementById('remove-gst-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            op.applyGst = false;
            saveData();
            showToast('GST removed');
        }
    });

    // Add buttons
    document.getElementById('add-plan-btn')?.addEventListener('click', () => {
        document.getElementById('plan-form').reset();
        document.getElementById('plan-id').value = '';
        openModal('plan-modal');
    });

    document.getElementById('add-payment-btn')?.addEventListener('click', () => {
        document.getElementById('payment-form').reset();
        document.getElementById('payment-date').valueAsDate = new Date();
        openModal('payment-modal');
    });

    document.getElementById('add-sub-btn')?.addEventListener('click', () => {
        document.getElementById('sub-form').reset();
        document.getElementById('sub-id').value = '';
        document.getElementById('sub-created').valueAsDate = new Date();
        
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            const event = new Event('change');
            document.getElementById('sub-platform').dispatchEvent(event);
        }
        openModal('sub-modal');
    });

    // Config buttons
    document.getElementById('admin-settings-btn')?.addEventListener('click', () => {
        document.getElementById('admin-pass-change').value = '';
        document.getElementById('admin-bot-token').value = localStorage.getItem(BOT_TOKEN_KEY) || '';
        openModal('admin-settings-modal');
    });

    document.getElementById('config-upi-btn')?.addEventListener('click', () => {
        document.getElementById('upi-id').value = localStorage.getItem(UPI_KEY) || '';
        document.getElementById('gst-number').value = localStorage.getItem(GST_KEY) || '';
        openModal('upi-modal');
    });

    document.getElementById('config-msg-btn')?.addEventListener('click', () => {
        document.getElementById('msg-single').value = msgTemplates.single;
        document.getElementById('msg-bulk').value = msgTemplates.bulk;
        openModal('msg-modal');
    });

    // Helper functions
    window.addIptvRow = function() {
        document.getElementById('iptv-rows-container').insertAdjacentHTML('beforeend', `
            <div class="form-group iptv-row" style="padding:10px; background:#f0fdf4; border:1px dashed #10b981; margin-bottom:0.5rem;">
                <label style="color:#10b981; display:flex; justify-content:space-between;">
                    <span>📺 IPTV Package</span>
                    <button type="button" class="btn-icon" onclick="this.closest('.iptv-row').remove()">❌</button>
                </label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                    <input type="text" class="iptv-name-input" placeholder="Package name">
                    <input type="number" class="iptv-rate-input" placeholder="Rate">
                </div>
                <textarea class="iptv-desc-input" rows="1" style="width:100%; margin-top:0.5rem;" placeholder="Description"></textarea>
            </div>
        `);
    };

    window.addOttRow = function() {
        document.getElementById('ott-rows-container').insertAdjacentHTML('beforeend', `
            <div class="form-group ott-row" style="padding:10px; background:#fffbeb; border:1px dashed #f59e0b; margin-bottom:0.5rem;">
                <label style="color:#f59e0b; display:flex; justify-content:space-between;">
                    <span>📱 OTT Package</span>
                    <button type="button" class="btn-icon" onclick="this.closest('.ott-row').remove()">❌</button>
                </label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                    <input type="text" class="ott-name-input" placeholder="Package name">
                    <input type="number" class="ott-rate-input" placeholder="Rate">
                </div>
                <textarea class="ott-desc-input" rows="1" style="width:100%; margin-top:0.5rem;" placeholder="Description"></textarea>
            </div>
        `);
    };

    window.editPlan = function(planId) {
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (!op) return;
        const plan = op.plans.find(p => p.id === planId);
        if (plan) {
            document.getElementById('plan-id').value = plan.id;
            document.getElementById('plan-category').value = plan.category;
            document.getElementById('plan-type').value = plan.type;
            document.getElementById('plan-description').value = plan.description || '';
            document.getElementById('plan-users').value = plan.users;
            document.getElementById('plan-rate').value = plan.rate;
            openModal('plan-modal');
        }
    };

    window.deletePlan = function(planId) {
        if (confirm('Delete this plan?')) {
            const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
            if (op) {
                op.plans = op.plans.filter(p => p.id !== planId);
                saveData();
                showToast('Plan deleted');
            }
        }
    };

    window.deletePayment = function(paymentId) {
        if (confirm('Delete this payment?')) {
            const op = operators.find(o => o.id === currentAdminViewOpId);
            if (op) {
                op.payments = op.payments.filter(p => p.id !== paymentId);
                saveData();
                showToast('Payment deleted');
            }
        }
    };

    window.togglePaymentStatus = function(paymentId) {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            const payment = op.payments.find(p => p.id === paymentId);
            if (payment) {
                payment.status = payment.status === 'Paid' ? 'Unpaid' : 'Paid';
                saveData();
            }
        }
    };

    window.editSubscriber = function(subId) {
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (!op) return;
        const sub = op.subscribers.find(s => s.id === subId);
        if (sub) {
            document.getElementById('sub-id').value = sub.id;
            document.getElementById('sub-name').value = sub.name;
            document.getElementById('sub-platform').value = sub.platform;
            
            // Trigger change to populate bundles
            const event = new Event('change');
            document.getElementById('sub-platform').dispatchEvent(event);
            
            // Select correct bundle
            setTimeout(() => {
                Array.from(document.getElementById('sub-bundle').options).forEach(opt => {
                    if (opt.dataset.type === sub.bundle) opt.selected = true;
                });
            }, 100);
            
            document.getElementById('sub-created').value = sub.createdDate;
            document.getElementById('sub-expiry').value = sub.expiryDate;
            openModal('sub-modal');
        }
    };

    window.deleteSubscriber = function(subId) {
        if (confirm('Delete this user?')) {
            const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
            if (op) {
                op.subscribers = op.subscribers.filter(s => s.id !== subId);
                saveData();
                showToast('User deleted');
            }
        }
    };

    window.sendReminder = function(opId, subId, method) {
        const op = operators.find(o => o.id === opId);
        if (!op) return;
        const sub = op.subscribers?.find(s => s.id === subId);
        if (!sub || !op.phone) return;

        const msg = msgTemplates.single
            .replace(/{OperatorName}/g, op.name)
            .replace(/{UserName}/g, sub.name)
            .replace(/{Platform}/g, sub.platform)
            .replace(/{Bundle}/g, sub.bundle)
            .replace(/{CreatedDate}/g, formatDate(sub.createdDate))
            .replace(/{ExpiryDate}/g, formatDate(sub.expiryDate));

        const phone = op.phone.replace(/[^0-9]/g, '');
        if (method === 'whatsapp') {
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        } else {
            window.open(`sms:${phone}?body=${encodeURIComponent(msg)}`, '_self');
        }
    };

    // Initial render
    renderApp();

    // Auto Telegram reminders (every 5 minutes)
    setInterval(async () => {
        const token = localStorage.getItem(BOT_TOKEN_KEY);
        if (!token) return;

        const today = new Date().toDateString();
        let sent = 0;

        for (const op of operators) {
            if (!op.chatId || !op.subscribers) continue;

            const sentLog = op.lastAutoReminders || {};
            let changed = false;

            for (const sub of op.subscribers) {
                const exp = getExpiryStatus(sub.expiryDate);
                if (exp.days === 2 || exp.days === 0 || exp.days < 0) {
                    const key = `${sub.id}_${exp.days}`;
                    if (sentLog[key] === today) continue;

                    const msg = (exp.days < 0 ? '🚨 EXPIRED\n\n' : '⏳ REMINDER\n\n') +
                        msgTemplates.single
                            .replace(/{OperatorName}/g, op.name)
                            .replace(/{UserName}/g, sub.name)
                            .replace(/{Platform}/g, sub.platform)
                            .replace(/{Bundle}/g, sub.bundle)
                            .replace(/{CreatedDate}/g, formatDate(sub.createdDate))
                            .replace(/{ExpiryDate}/g, formatDate(sub.expiryDate));

                    try {
                        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: op.chatId, text: msg })
                        });
                        if (res.ok) {
                            sentLog[key] = today;
                            changed = true;
                            sent++;
                        }
                    } catch (err) {
                        console.error('Telegram error:', err);
                    }
                }
            }

            if (changed) {
                op.lastAutoReminders = sentLog;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
            }
        }

        if (sent > 0) {
            showToast(`Sent ${sent} Telegram reminders`);
        }
    }, 300000); // 5 minutes
});
