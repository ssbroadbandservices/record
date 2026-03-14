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
let isDataSyncing = false;  // 👈 NEW FLAG - Double refresh rokega
let renderScheduled = false; // 👈 NEW FLAG - Extra safety

const defaultTemplates = {
    single: "Hello {OperatorName},\n\nReminder: Your user *{UserName}*'s {Platform} ID for bundle \"{Bundle}\" is expiring on *{ExpiryDate}*.\n(Started on: {CreatedDate}).\n\nPlease renew it soon to avoid disruption.",
    bulk: "Hello {OperatorName},\n\nYou have clients with expiring / expired subscriptions:"
};
let msgTemplates = JSON.parse(localStorage.getItem(MSG_KEY)) || defaultTemplates;
if (!msgTemplates.single) msgTemplates.single = defaultTemplates.single;
if (!msgTemplates.bulk) msgTemplates.bulk = defaultTemplates.bulk;

// Firebase Listener - FIXED VERSION
onValue(operatorsRef, (snapshot) => {
    // Agar data already syncing ho raha hai to ignore karo
    if (isDataSyncing) return;

    isDataSyncing = true;
    const data = snapshot.val();

    if (data) {
        // Check karo data actually change hua hai ya nahi
        const newOperators = Array.isArray(data) ? data : Object.values(data);
        if (JSON.stringify(operators) !== JSON.stringify(newOperators)) {
            operators = newOperators;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));

            // Sirf tab render karo jab user active ho
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

function openModal(modalId) { document.getElementById(modalId).classList.add('active'); }
function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }

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
let renderTimeout = null; // 👈 NEW - Debounce timeout

function renderApp() {
    // 👇 CLEAR ANY PENDING RENDER
    if (renderTimeout) clearTimeout(renderTimeout);

    renderTimeout = setTimeout(() => {
        const headerActions = document.getElementById('header-actions');
        const adminActions = document.getElementById('admin-header-actions');
        const greeting = document.getElementById('user-greeting');

        // FAB button control
        const fabButton = document.getElementById('add-operator-fab');

        // Apply logo if available
        const sysLogo = localStorage.getItem('jarvis_hybrid_logo') || 'logo.png';
        const logoImg = document.getElementById('company-logo');
        if (logoImg) logoImg.src = sysLogo;

        if (!activeUser) {
            headerActions.style.display = 'none';
            switchView('login');

            // Hide FAB on login page
            if (fabButton) fabButton.style.display = 'none';
            return;
        }

        headerActions.style.display = 'flex';

        if (activeUser.role === 'admin') {
            adminActions.style.display = 'flex';
            greeting.textContent = 'Super Admin';

            // Show FAB for admin
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

            // Hide FAB for operator
            if (fabButton) fabButton.style.display = 'none';

            const op = operators.find(o => o.id === activeUser.id);
            if (op) {
                greeting.textContent = `Hi, ${op.name}`;
                renderOperatorPortal(op);
                switchView('opPortal');
            } else if (operators.length > 0) {
                // Only logout if we have successfully synced from DB and the operator is actually missing
                showToast('Your account is no longer active.', 'error');
                document.getElementById('logout-btn').click();
            } else {
                greeting.textContent = 'Syncing access...';
            }
        }
    }, 50); // 👈 50ms DEBOUNCE
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

    // Destroy old chart instance if exists
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
    // Subscribers
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

    // Destroy old chart instance if exists
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
    // Subscribers portal read only
    renderSubscribersTable('op-portal-iptv-subscribers-tbody', op, false, 'IPTV');
    renderSubscribersTable('op-portal-ott-subscribers-tbody', op, false, 'OTT');
}

// ------ SHARED RENDERING FUNCTIONS ------
function renderPlansTable(tbodyId, operator, metrics, isAdmin) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    const displayPlans = (operator.plans || []).filter(p => !p.type.includes('18% GST') && !p.type.includes('GST 18%'));

    if (displayPlans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 4}" class="empty-state">No base packages setup.</td></tr>`;
        return;
    }

    displayPlans.forEach(p => {
        let descHtml = p.description ? `<br><span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-top: 4px; display: inline-block;">${p.description}</span>` : '';

        if (!isAdmin) {
            // Operator portal - read only, 4 columns
            tbody.innerHTML += `<tr>
                <td><span class="status-badge" style="background:#f1f5f9; color:#475569;">${p.category || 'Internet'}</span></td>
                <td><strong>${p.type}</strong>${descHtml}</td>
                <td>${p.users}</td>
                <td>${formatCurrency(p.rate)}</td>
            </tr>`;
        } else {
            // Admin view - with actions, 6 columns
            tbody.innerHTML += `<tr>
                <td><span class="status-badge" style="background:#f1f5f9; color:#475569;">${p.category || 'Internet'}</span></td>
                <td><strong>${p.type}</strong>${descHtml}</td>
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
            // Operator portal - read only, 4 columns
            tbody.innerHTML += `<tr>
                <td>${formatDate(p.date)}</td>
                <td>${p.type}</td>
                <td><strong>${formatCurrency(p.amount)}</strong></td>
                <td><span class="status-badge ${statStyle}">${p.status}</span></td>
            </tr>`;
        } else {
            // Admin view - with actions, 5 columns
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
            // Admin view - with all action buttons
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
            // Operator portal - read only, 5 columns (no action buttons)
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

// ------ PDF GENERATION (WITH DOUBLE CLICK PROTECTION) ------
let isGeneratingPDF = false;

function triggerPrint(htmlContent, filename, qrHtml = '', opName = '') {
    // Prevent double PDF generation
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
    tempContainer.innerHTML = `<div style="padding: 3rem; background: #ffffff; color: #1e293b; font-family: 'Inter', sans-serif; box-sizing: border-box; position: relative;">
        <!-- Header Section -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 2rem;">
            <div style="text-align: left;">
                <img src="${logoSrc}" style="max-height: 55px; display: block;" onerror="this.style.display='none'">
                <h1 style="margin: 0.5rem 0 0 0; font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">HYBRID INTERNET</h1>
                <p style="margin: 2px 0; font-size: 11px; color: #64748b;">Premium Broadband & Digital Services</p>
                <p style="margin: 2px 0; font-size: 11px; color: #64748b;">Registered Office / Main Branch</p>
                <p style="margin: 2px 0; font-size: 11px; color: #64748b;">GSTIN: <strong style="color: #0f172a;">${gstNo}</strong></p>
            </div>
            <div style="text-align: right;">
                ${opNameBlock}
                <p style="font-size: 11px; color: #64748b; margin: 2px 0;">Date generated: <strong style="color: #0f172a;">${formatDate(new Date())}</strong></p>
            </div>
        </div>
        
        <!-- Main Content -->
        ${htmlContent}
        
        <!-- Separate Page for QR & Signature if present or always -->
        <div style="page-break-before: always; margin-top: 5rem; padding-top: 2rem;">
            <div style="border-top: 2px dashed #e2e8f0; padding-top: 2rem;">
                <h3 style="margin-bottom: 2rem; color: #0f172a; font-size: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">Authentication & Digital Payment</h3>
                ${qrHtml}
                
                <!-- Footer Signatory -->
                <div style="margin-top: 4rem; text-align: right; position: relative;">
                    <div style="display: inline-block; text-align: center;">
                        <img src="${sealSrc}" style="height: 110px; mix-blend-mode: multiply; filter: contrast(1.2) grayscale(100%); display: block; margin: 0 auto; object-fit: contain; transform: translateY(20px);" onerror="this.style.display='none'" alt="Seal and Signature">
                        <div style="border-top: 1px solid #cbd5e1; padding-top: 10px; width: 180px; margin-top: 10px;">
                            <p style="margin: 0; font-weight: 700; font-size: 14px; color: #0f172a;">Authorized Signatory</p>
                            <p style="margin: 0; font-size: 11px; color: #64748b;">Hybrid Internet Management</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    const opt = { margin: 0, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, pagebreak: { mode: ['css', 'legacy'] }, jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' } };

    if (window.html2pdf) {
        showToast("Generating Document...");
        document.body.appendChild(tempContainer);

        html2pdf().set(opt).from(tempContainer).save().then(() => {
            document.body.removeChild(tempContainer);
            showToast("Download successful.");
            isGeneratingPDF = false;
        }).catch(err => {
            console.error('PDF generation error', err);
            document.body.removeChild(tempContainer);
            showToast("Error generating PDF", "error");
            isGeneratingPDF = false;
        });
    } else {
        const printArea = document.getElementById('print-area');
        printArea.innerHTML = tempContainer.innerHTML;
        setTimeout(() => {
            window.print();
            setTimeout(() => {
                printArea.innerHTML = '';
                isGeneratingPDF = false;
            }, 1000);
        }, 500);
    }
}

function handleDownloadBal() {
    const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
    if (!op) return;
    const m = calculateOperatorMetrics(op);
    // Notice we do NOT pass qrHtml as it's a balance statement without actual dynamic invoice table, but if needed, we could.
    triggerPrint(`
        <div style="text-align:center; padding: 2rem 0;">
            <p style="font-size:12px; color:#4f46e5; font-weight:700; text-transform:uppercase; letter-spacing:2px; margin:0;">Financial Notice</p>
            <h2 style="margin:8px 0 0 0; font-size:28px; color:#0f172a; font-weight:800;">Balance Reminder Statement</h2>
            <div style="padding: 3rem; background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%); border: 1px solid #fecdd3; border-radius: 20px; margin: 3rem auto; max-width: 450px; box-shadow: 0 10px 15px -3px rgba(225, 29, 72, 0.1);">
                <p style="font-size: 14px; color:#e11d48; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Current Outstanding Due</p>
                <h1 style="color:#9f1239; margin:10px 0 0 0; font-size: 4rem; font-weight: 900; letter-spacing: -1px;">${formatCurrency(m.outstanding)}</h1>
            </div>
            <p style="font-size:14px; color:#475569; line-height: 1.6; max-width: 500px; margin: 0 auto;">Please coordinate with the administration to clear the pending balance to ensure unaffected continuation of digital services.</p>
        </div>
    `, `Balance_Statement_${op.name.replace(/\s+/g, '_')}.pdf`, '', op.name);
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
    const reportGstChecked = e ? document.getElementById('report-gst').checked : op.applyGst;

    let qrHtml = '';
    if (upiId && m.outstanding > 0) {
        const upiLink = `upi://pay?pa=${upiId}&pn=Hybrid+Internet&am=${m.outstanding.toFixed(2)}&cu=INR`;
        qrHtml = `<div style="text-align: center; margin-top: 2rem; border-top: 1px dashed #cbd5e1; padding-top: 2rem;">
            <p style="font-weight: 600; font-size: 14px; margin-bottom: 10px;">Scan to Pay instantly via Any UPI App</p>
            <div style="border: 2px solid #e2e8f0; padding: 10px; display: inline-block; border-radius: 12px; background: white;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(upiLink)}" alt="UPI QR" style="display: block;">
            </div>
            <p style="font-size: 12px; color: #64748b; margin-top: 8px;">UPI ID: <strong>${upiId}</strong></p>
        </div>`;
    }

    let gstRow = '';
    let usedGst = 0;
    if (reportGstChecked || op.applyGst) {
        usedGst = m.baseRevenue * 0.18;
        gstRow = `<tr style="background:#f8fafc;">
            <td colspan="3" style="text-align:right; border:1px solid #e2e8f0; padding:12px; color:#64748b;"><strong>+ 18% GST Allocation:</strong></td>
            <td style="text-align:center; border:1px solid #e2e8f0; padding:12px; color:#4f46e5; font-weight:700;">${formatCurrency(usedGst)}</td>
        </tr>`;
    }
    const finalExpected = m.baseRevenue + usedGst;
    const currentOutstanding = finalExpected - m.totalPaid;

    let subTableLines = '';
    const displayPlans = (op.plans || []).filter(p => !p.type.includes('18% GST'));
    displayPlans.forEach(p => {
        subTableLines += `<tr>
            <td style="text-align:left; border:1px solid #e2e8f0; padding:12px;">${p.category}</td>
            <td style="text-align:left; border:1px solid #e2e8f0; padding:12px;"><strong>${p.type}</strong></td>
            <td style="text-align:center; border:1px solid #e2e8f0; padding:12px;">${p.users} Users × ${formatCurrency(p.rate)}</td>
            <td style="text-align:center; border:1px solid #e2e8f0; padding:12px; font-weight:600;">${formatCurrency(p.users * p.rate)}</td>
        </tr>`;
    });

    let trackerMap = {};
    (op.subscribers || []).forEach(s => {
        if (!trackerMap[s.platform]) trackerMap[s.platform] = { count: 0, revenue: 0 };
        trackerMap[s.platform].count++;
        trackerMap[s.platform].revenue += parseFloat(s.rate || 0);
    });
    for (const [plat, data] of Object.entries(trackerMap)) {
        if (data.revenue > 0) {
            subTableLines += `<tr style="background:#f0f9ff;">
                <td style="text-align:left; border:1px solid #e2e8f0; padding:12px;">${plat}</td>
                <td style="text-align:left; border:1px solid #e2e8f0; padding:12px;"><strong>Individual Tracked Users</strong></td>
                <td style="text-align:center; border:1px solid #e2e8f0; padding:12px;">${data.count} Users</td>
                <td style="text-align:center; border:1px solid #e2e8f0; padding:12px; font-weight:600; color:#0284c7;">${formatCurrency(data.revenue)}</td>
            </tr>`;
        }
    }

    if (!subTableLines) subTableLines = `<tr><td colspan="4" style="text-align:center; padding:12px;">No active billing lines</td></tr>`;

    let gstInfo = gstNo ? `<br><span style="font-size:11px; color:#64748b;">GSTIN: ${gstNo}</span>` : '';

    // Remove op name from top of table, it's in the header now
    triggerPrint(`<div>
        <div style="text-align:center; padding-bottom:1.5rem;">
            <p style="font-size:13px; color:#4f46e5; font-weight:800; text-transform:uppercase; letter-spacing:2px; margin:0;">Comprehensive Tax Invoice</p>
            <h2 style="margin:5px 0 0 0; font-size:24px; color:#0f172a;">Monthly Operations Report</h2>
        </div>
        
        <table style="width:100%; margin-bottom:2rem; border-collapse: collapse; font-size:14px; background: #f8fafc; border-radius: 12px; overflow: hidden;">
            <tr>
                <td style="padding:20px; vertical-align:top; width:50%; border-right: 1px solid #e2e8f0;">
                    <p style="margin:0 0 5px 0; color:#4f46e5; font-size:12px; text-transform:uppercase; font-weight: 700;">Account Contact details</p>
                    <h3 style="margin:0 0 5px 0; font-size:18px; color:#0f172a;">${op.name}</h3>
                    <p style="margin:5px 0; color:#334155;"><i class="fa-solid fa-phone" style="color: #94a3b8; font-size: 11px; margin-right: 5px;"></i> ${op.phone || '-'}</p>
                    <p style="margin:5px 0; color:#334155;"><i class="fa-solid fa-location-dot" style="color: #94a3b8; font-size: 11px; margin-right: 5px;"></i> ${op.address || '-'}</p>
                    <p style="margin:5px 0; color:#334155;"><i class="fa-solid fa-plug" style="color: #94a3b8; font-size: 11px; margin-right: 5px;"></i> Port: ${op.portDetails || '-'}</p>
                </td>
                <td style="padding:20px; vertical-align:top; text-align:right;">
                    <p style="margin:0 0 5px 0; color:#4f46e5; font-size:12px; text-transform:uppercase; font-weight: 700;">Performance Snapshot</p>
                    <p style="margin:0 0 5px 0; font-size:14px; color:#334155;">Total Services Linked: <strong style="color: #0f172a;">${m.totalUsers} Active</strong></p>
                    <p style="margin:0 0 5px 0; font-size:14px; color:#334155;">Previous Cleared Payments: <strong style="color: #10b981;">${formatCurrency(m.totalPaid)}</strong></p>
                    ${gstInfo}
                </td>
            </tr>
        </table>

        <h3 style="margin:0 0 15px 0; font-size:15px; color:#0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Breakdown of Allocated Services:</h3>
        <table style="width:100%; border-collapse: collapse; margin-bottom: 2.5rem; font-size:13px; border-radius:8px; overflow:hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <thead>
                <tr style="background:#4f46e5; color:#ffffff;">
                    <th style="padding:15px; text-align:left; font-weight: 600;">Service Category</th>
                    <th style="padding:15px; text-align:left; font-weight: 600;">Packages / Description</th>
                    <th style="padding:15px; text-align:center; font-weight: 600;">Volume × Rate</th>
                    <th style="padding:15px; text-align:center; font-weight: 600;">Line Total</th>
                </tr>
            </thead>
            <tbody>
                ${subTableLines}
                <tr style="background: #f1f5f9;">
                    <td colspan="3" style="text-align:right; border:1px solid #e2e8f0; padding:15px; color:#475569;"><strong>Subtotal (Without Taxes):</strong></td>
                    <td style="text-align:center; border:1px solid #e2e8f0; padding:15px; font-weight:800; color: #0f172a; font-size: 14px;">${formatCurrency(m.baseRevenue)}</td>
                </tr>
                ${gstRow}
            </tbody>
        </table>
        
        <div style="background: ${currentOutstanding > 0 ? 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)' : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'}; border: 1px solid ${currentOutstanding > 0 ? '#fecdd3' : '#bbf7d0'}; border-radius: 16px; padding: 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);">
            <div style="text-align: left;">
                <p style="margin:0 0 5px 0; color: ${currentOutstanding > 0 ? '#be123c' : '#15803d'}; font-size: 15px; font-weight: 700; text-transform: uppercase;">Total Aggregate Due / Outstanding Amount</p>
                <p style="margin:0; font-size: 13px; color: ${currentOutstanding > 0 ? '#e11d48' : '#22c55e'};">All previous payments have been accounted for.</p>
            </div>
            <h2 style="margin:0; color: ${currentOutstanding > 0 ? '#9f1239' : '#166534'}; font-size: 36px; font-weight: 900; letter-spacing: -1px;">
                ${formatCurrency(currentOutstanding)}
            </h2>
        </div>
    </div>`, `Premium_Invoice_${op.name.replace(/\s+/g, '_')}.pdf`, qrHtml, op.name);
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
        alert('To install, tap the Share icon or Browser Menu and select "Add to Home Screen".');
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
        let text = `<div style="padding: 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--surface-hover);">`;
        text += `<div style="display: flex; justify-content: space-between; align-items: flex-start;">`;
        text += `<h5 style="margin: 0; font-size: 1rem; color: var(--text-main); font-weight: 700;">${p.type}</h5>`;
        text += `<div style="font-weight: 800; color: var(--primary-color);">${formatCurrency(p.rate)}<span style="font-size:0.75rem; color:#64748b; font-weight:normal;">/mo</span></div>`;
        text += `</div>`;
        if (p.description) text += `<p style="margin: 6px 0 0; font-size: 0.8rem; color: var(--text-muted);">${p.description}</p>`;
        text += `</div>`;
        return text;
    };

    let pIptv = (op.plans || []).filter(p => p.category === 'IPTV');
    let pOtt = (op.plans || []).filter(p => p.category === 'OTT');

    if (pIptv.length === 0) iptvList.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1rem;">No IPTV packages currently assigned.</p>`;
    else pIptv.forEach(p => iptvList.innerHTML += createPlanCard(p));

    if (pOtt.length === 0) ottList.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1rem;">No OTT packages currently assigned.</p>`;
    else pOtt.forEach(p => ottList.innerHTML += createPlanCard(p));

    openModal('op-menu-modal');
});

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Service Worker Registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW failed', err));
    }

    // Close modal handlers
    document.querySelectorAll('.close-modal, .cancel-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-overlay');
            if (modal) {
                modal.classList.remove('active');
                if (modal.id === 'pwa-install-modal') {
                    localStorage.setItem('pwa_prompt_dismissed', 'true');
                }
            }
        });
    });

    // Login form
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
                showToast(`Welcome back, ${op.name} `);
                renderApp();
            } else {
                showToast('Invalid Username or Password', 'error');
            }
        }
    });

    // Logout button
    document.getElementById('logout-btn').addEventListener('click', () => {
        activeUser = null;
        currentAdminViewOpId = null;
        localStorage.removeItem('hybrid_auth');
        document.getElementById('login-form').reset();
        renderApp();
    });

    // Admin Settings Form
    document.getElementById('admin-settings-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const newPass = document.getElementById('admin-pass-change').value;
        const botToken = document.getElementById('admin-bot-token').value.trim();

        if (newPass) localStorage.setItem(ADMIN_PASS_KEY, newPass);
        localStorage.setItem(BOT_TOKEN_KEY, botToken);

        const logoFile = document.getElementById('admin-logo-upload').files[0];
        const sealFile = document.getElementById('admin-seal-upload').files[0];

        const processImage = (file, storageKey) => {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (event) {
                localStorage.setItem(storageKey, event.target.result);
            };
            reader.readAsDataURL(file);
        };

        processImage(logoFile, 'jarvis_hybrid_logo');
        processImage(sealFile, 'jarvis_hybrid_seal');

        showToast('Super Admin Config Saved');
        closeModal('admin-settings-modal');
    });

    // UPI Form
    document.getElementById('upi-form').addEventListener('submit', (e) => {
        e.preventDefault();
        localStorage.setItem(UPI_KEY, document.getElementById('upi-id').value.trim());
        localStorage.setItem(GST_KEY, document.getElementById('gst-number').value.trim());
        showToast('UPI & GST Saved');
        closeModal('upi-modal');
    });

    // Message Templates Form
    document.getElementById('msg-form').addEventListener('submit', (e) => {
        e.preventDefault();
        msgTemplates.single = document.getElementById('msg-single').value;
        msgTemplates.bulk = document.getElementById('msg-bulk').value;
        localStorage.setItem(MSG_KEY, JSON.stringify(msgTemplates));
        showToast('Templates saved');
        closeModal('msg-modal');
    });

    // Report Form
    document.getElementById('report-form').addEventListener('submit', handleDownloadRpt);

    // Operator Form
    document.getElementById('operator-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('op-id').value;
        const name = document.getElementById('op-name').value.trim();
        const username = document.getElementById('op-username').value.trim();
        const password = document.getElementById('op-password').value.trim();
        const phone = document.getElementById('op-phone').value.trim();
        const portDetails = document.getElementById('op-port').value.trim();
        const chatId = document.getElementById('op-chat-id').value.trim();
        const address = document.getElementById('op-address').value.trim();

        if (operators.some(o => o.username === username && o.id !== id)) {
            showToast('Username already taken!', 'error'); return;
        }

        if (id) {
            const op = operators.find(o => o.id === id);
            Object.assign(op, { name, username, password, phone, portDetails, chatId, address });
            showToast('Operator info updated');
        } else {
            const newOp = { id: generateId(), name, username, password, phone, portDetails, chatId, address, createdAt: new Date().toISOString(), plans: [], payments: [], subscribers: [] };
            operators.push(newOp);
            showToast('Operator firm created');
            currentAdminViewOpId = newOp.id;
        }

        const finalOp = operators.find(o => o.id === (id || currentAdminViewOpId));
        finalOp.plans = (finalOp.plans || []).filter(p => p.category !== 'IPTV' && p.category !== 'OTT');

        document.querySelectorAll('.iptv-row').forEach(row => {
            const iName = row.querySelector('.iptv-name-input').value.trim();
            const iRate = row.querySelector('.iptv-rate-input').value;
            const iDesc = row.querySelector('.iptv-desc-input').value.trim();
            if (iName && iRate) {
                finalOp.plans.push({ id: generateId(), category: 'IPTV', type: iName, rate: parseFloat(iRate), users: 0, description: iDesc });
            }
        });

        document.querySelectorAll('.ott-row').forEach(row => {
            const oName = row.querySelector('.ott-name-input').value.trim();
            const oRate = row.querySelector('.ott-rate-input').value;
            const oDesc = row.querySelector('.ott-desc-input').value.trim();
            if (oName && oRate) {
                finalOp.plans.push({ id: generateId(), category: 'OTT', type: oName, rate: parseFloat(oRate), users: 0, description: oDesc });
            }
        });

        saveData();
        closeModal('operator-modal');
    });

    // Plan Form
    document.getElementById('plan-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const planId = document.getElementById('plan-id').value;
        const category = document.getElementById('plan-category').value;
        const type = document.getElementById('plan-type').value;
        const description = document.getElementById('plan-description').value;
        const users = document.getElementById('plan-users').value;
        const rate = document.getElementById('plan-rate').value;
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (op) {
            op.plans = op.plans || [];
            if (planId) {
                const idx = op.plans.findIndex(p => p.id === planId);
                if (idx >= 0) op.plans[idx] = { id: planId, category, type, description, users: parseInt(users), rate: parseFloat(rate) };
            }
            else op.plans.push({ id: generateId(), category, type, description, users: parseInt(users), rate: parseFloat(rate) });
            saveData();
            closeModal('plan-modal');
            showToast('Service saved');
        }
    });

    // Payment Form
    document.getElementById('payment-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            op.payments = op.payments || [];
            op.payments.push({ id: generateId(), type: document.getElementById('payment-type').value, amount: parseFloat(document.getElementById('payment-amount').value), date: document.getElementById('payment-date').value, status: document.getElementById('payment-status').value });
            saveData();
            closeModal('payment-modal');
            showToast('Recorded');
        }
    });

    // Subscriber Form
    document.getElementById('sub-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const opId = activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id;
        const op = operators.find(o => o.id === opId);
        if (op) {
            op.subscribers = op.subscribers || [];
            const subId = document.getElementById('sub-id').value;
            const name = document.getElementById('sub-name').value;
            const platform = document.getElementById('sub-platform').value;
            const createdDate = document.getElementById('sub-created').value;
            const expiryDate = document.getElementById('sub-expiry').value;

            const bundleOpt = document.getElementById('sub-bundle').selectedOptions[0];
            if (!bundleOpt || !bundleOpt.value) return showToast(`Please add ${platform} packs in Packages menu first!`, 'error');
            const bundle = bundleOpt.dataset.type;
            const rate = parseFloat(bundleOpt.dataset.rate || 0);

            if (subId) {
                const idx = op.subscribers.findIndex(s => s.id === subId);
                if (idx >= 0) op.subscribers[idx] = { id: subId, name, platform, bundle, rate, createdDate, expiryDate };
            } else op.subscribers.push({ id: generateId(), name, platform, bundle, rate, createdDate, expiryDate });
            saveData();
            closeModal('sub-modal');
            showToast('Tracker Saved');
        }
    });

    // Platform change event
    document.getElementById('sub-platform').addEventListener('change', (e) => {
        const opId = activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id;
        const op = operators.find(o => o.id === opId);
        populatePacksDropdown(op, e.target.value);
    });

    // Confirm button
    document.getElementById('confirm-btn').addEventListener('click', () => {
        if (confirmAction) confirmAction();
        closeModal('confirm-modal');
    });

    // Admin Settings button
    document.getElementById('admin-settings-btn')?.addEventListener('click', () => {
        document.getElementById('admin-pass-change').value = '';
        document.getElementById('admin-bot-token').value = localStorage.getItem(BOT_TOKEN_KEY) || '';
        document.getElementById('admin-logo-upload').value = '';
        document.getElementById('admin-seal-upload').value = '';
        openModal('admin-settings-modal');
    });

    // Config UPI button
    document.getElementById('config-upi-btn')?.addEventListener('click', () => {
        document.getElementById('upi-id').value = localStorage.getItem(UPI_KEY) || '';
        document.getElementById('gst-number').value = localStorage.getItem(GST_KEY) || '';
        openModal('upi-modal');
    });

    // Config Messages button
    document.getElementById('config-msg-btn')?.addEventListener('click', () => {
        document.getElementById('msg-single').value = msgTemplates.single;
        document.getElementById('msg-bulk').value = msgTemplates.bulk;
        openModal('msg-modal');
    });

    // Search operator
    document.getElementById('search-operator')?.addEventListener('input', (e) => renderAdminDashboard(e.target.value));

    // Add operator FAB
    document.getElementById('add-operator-fab')?.addEventListener('click', () => {
        document.getElementById('operator-form').reset();
        document.getElementById('op-id').value = '';
        document.getElementById('op-password').value = Math.random().toString(36).slice(-6);
        document.getElementById('op-modal-title').textContent = 'Add New Operator Firm';
        openModal('operator-modal');
    });

    // Admin back button
    document.getElementById('admin-back-to-dash')?.addEventListener('click', () => {
        currentAdminViewOpId = null;
        renderApp();
    });

    // Edit operator button
    document.getElementById('edit-op-info-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            document.getElementById('op-id').value = op.id;
            document.getElementById('op-name').value = op.name;
            document.getElementById('op-username').value = op.username || '';
            document.getElementById('op-password').value = op.password || '';
            document.getElementById('op-phone').value = op.phone || '';
            document.getElementById('op-port').value = op.portDetails || '';
            document.getElementById('op-chat-id').value = op.chatId || '';
            document.getElementById('op-address').value = op.address || '';

            // IPTV packs
            let iptvPacks = (op.plans || []).filter(p => p.category === 'IPTV');
            const iCont = document.getElementById('iptv-rows-container');
            iCont.innerHTML = '';
            if (iptvPacks.length === 0) iptvPacks = [{}];
            iptvPacks.forEach((p, idx) => {
                iCont.insertAdjacentHTML('beforeend', `
            < div class="form-group iptv-row" style = "padding: 10px; background: rgba(16, 185, 129, 0.05); border-radius: 8px; border: 1px dashed #10b981; margin-bottom: 0.5rem; position: relative;" >
                    <label style="color: #10b981; display:flex; justify-content:space-between; align-items:center;">
                        <span><i class="fa-solid fa-tv"></i> IPTV Package</span>
                        ${idx > 0 ? '<button type="button" class="btn-icon text-danger" onclick="this.closest(\'.iptv-row\').remove()" style="padding:0;"><i class="fa-solid fa-xmark"></i></button>' : ''}
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
                        <input type="text" class="iptv-name-input" value="${p.type || ''}" placeholder="Pack Name (e.g. Basic IPTV)">
                        <input type="number" class="iptv-rate-input" value="${p.rate || ''}" min="0" step="0.01" placeholder="Rate (₹/$)">
                    </div>
                    <textarea class="iptv-desc-input" rows="1" style="width: 100%; margin-top: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" placeholder="Description (e.g., 500+ Channels, HD)">${p.description || ''}</textarea>
                </div>`);
            });

            // OTT packs
            let ottPacks = (op.plans || []).filter(p => p.category === 'OTT');
            const oCont = document.getElementById('ott-rows-container');
            oCont.innerHTML = '';
            if (ottPacks.length === 0) ottPacks = [{}];
            ottPacks.forEach((p, idx) => {
                oCont.insertAdjacentHTML('beforeend', `
            < div class="form-group ott-row" style = "padding: 10px; background: rgba(245, 158, 11, 0.05); border-radius: 8px; border: 1px dashed #f59e0b; margin-bottom: 0.5rem; position: relative;" >
                    <label style="color: #f59e0b; display:flex; justify-content:space-between; align-items:center;">
                        <span><i class="fa-solid fa-mobile-screen"></i> OTT Package</span>
                        ${idx > 0 ? '<button type="button" class="btn-icon text-danger" onclick="this.closest(\'.ott-row\').remove()" style="padding:0;"><i class="fa-solid fa-xmark"></i></button>' : ''}
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
                        <input type="text" class="ott-name-input" value="${p.type || ''}" placeholder="Pack Name (e.g. Premium OTT)">
                        <input type="number" class="ott-rate-input" value="${p.rate || ''}" min="0" step="0.01" placeholder="Rate (₹/$)">
                    </div>
                    <textarea class="ott-desc-input" rows="1" style="width: 100%; margin-top: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" placeholder="Description (e.g., Netflix, Prime, Hotstar)">${p.description || ''}</textarea>
                </div>`);
            });

            document.getElementById('op-modal-title').textContent = 'Edit Operator Parameters';
            openModal('operator-modal');
        }
    });

    // Bulk remind button
    document.getElementById('remind-all-expiring-btn')?.addEventListener('click', async () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op || !op.subscribers) return;

        const expiring = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days <= 2 && getExpiryStatus(s.expiryDate).days >= 0);
        const expired = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days < 0);

        if (expiring.length === 0 && expired.length === 0) return showToast('No immediate expirations found.');

        let msg = msgTemplates.bulk.replace(/{OperatorName}/g, op.name) + "\n\n";
        if (expiring.length > 0) {
            msg += `⏳ * Expiring Soon:*\n`;
            expiring.forEach(s => msg += `- ${s.name} | ${s.platform} (${s.bundle}) | Exp: ${formatDate(s.expiryDate)} \n`);
        }
        if (expired.length > 0) {
            msg += `\n❌ * Already Expired:*\n`;
            expired.forEach(s => msg += `- ${s.name} | ${s.platform} (${s.bundle}) | Exp: ${formatDate(s.expiryDate)} \n`);
        }
        msg += `\nPlease check your system and renew to avoid disruption.`;

        const token = localStorage.getItem(BOT_TOKEN_KEY);
        if (token && op.chatId) {
            showToast('Sending via Telegram API...');
            const res = await sendTelegramMessage(op.chatId, msg);
            if (res.success) showToast('Telegram Message dispatched!');
            else showToast('Telegram failed: ' + res.error, 'error');
        } else {
            if (!op.phone) return showToast('Ensure Operator has Phone saved for WhatsApp fallback.', 'error');
            let phone = op.phone.replace(/[^0-9\+]/g, '');
            if (phone.length === 10) phone = '91' + phone;
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    });

    // Report button
    document.getElementById('report-btn')?.addEventListener('click', () => openModal('report-modal'));

    // Balance receipt button
    document.getElementById('balance-receipt-btn')?.addEventListener('click', handleDownloadBal);

    // No dues receipt button
    document.getElementById('receipt-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op) return;
        triggerPrint(`
            <div style="text-align:center; padding: 3rem 0;">
                <p style="font-size:12px; color:#10b981; font-weight:800; text-transform:uppercase; letter-spacing:2px; margin:0;">Certificate Of Clearance</p>
                <h2 style="margin:8px 0 0 0; font-size:28px; color:#0f172a; font-weight: 900;">No Dues Receipt</h2>
                <div style="padding: 3rem; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #bbf7d0; border-radius: 20px; margin: 3rem auto; max-width: 450px; box-shadow: 0 10px 15px -3px rgba(34, 197, 94, 0.1);">
                    <h1 style="color:#15803d; margin:0; font-size: 2.5rem; font-weight: 800; display:flex; align-items:center; justify-content:center; gap:10px;">
                        <span style="font-size: 3rem;">✓</span> CLEARED
                    </h1>
                    <p style="font-size: 15px; color:#166534; font-weight: 700; margin-top: 1rem; text-transform: uppercase;">No outstanding amounts pending.</p>
                </div>
                <p style="font-size:14px; color:#475569; max-width: 500px; margin: 0 auto; line-height: 1.6;">Thank you for your timely payments. All your dues are clear till date.</p>
            </div>
        `, `No_Dues_${op.name.replace(/\s+/g, '_')}.pdf`, '', op.name);
    });

    // Delete operator button
    document.getElementById('delete-op-btn')?.addEventListener('click', () => {
        confirmDelete('Delete Firm Info', 'Delete this firm and completely wipe its data?', () => {
            operators = operators.filter(o => o.id !== currentAdminViewOpId);
            currentAdminViewOpId = null;
            saveData();
            showToast('Firm Data Eradicated');
        });
    });

    // Add GST button
    document.getElementById('add-gst-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op) return;
        if (op.applyGst) return showToast('GST active.', 'warning');
        if (calculateOperatorMetrics(op).baseRevenue > 0) {
            op.applyGst = true;
            op.plans = (op.plans || []).filter(p => !p.type.includes('18% GST'));
            saveData();
            showToast('18% GST applied');
        }
    });

    // Remove GST button
    document.getElementById('remove-gst-btn')?.addEventListener('click', () => {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (!op) return;
        op.applyGst = false;
        op.plans = (op.plans || []).filter(p => !p.type.includes('18% GST'));
        saveData();
        showToast('GST removed');
    });

    // Add Plan button
    document.getElementById('add-plan-btn')?.addEventListener('click', () => {
        document.getElementById('plan-form').reset();
        document.getElementById('plan-id').value = '';
        openModal('plan-modal');
    });

    // Add Payment button
    document.getElementById('add-payment-btn')?.addEventListener('click', () => {
        document.getElementById('payment-form').reset();
        document.getElementById('payment-date').valueAsDate = new Date();
        openModal('payment-modal');
    });

    // Add Subscriber button
    document.getElementById('add-sub-btn')?.addEventListener('click', () => {
        document.getElementById('sub-form').reset();
        document.getElementById('sub-id').value = '';
        document.getElementById('sub-created').valueAsDate = new Date();
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) populatePacksDropdown(op, document.getElementById('sub-platform').value);
        openModal('sub-modal');
    });

    // Initial render
    renderApp();
    // Helper functions
    window.addIptvRow = function () {
        document.getElementById('iptv-rows-container').insertAdjacentHTML('beforeend', `
    <div class="form-group iptv-row" style="padding: 10px; background: rgba(16, 185, 129, 0.05); border-radius: 8px; border: 1px dashed #10b981; margin-bottom: 0.5rem; position: relative;">
        <label style="color: #10b981; display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fa-solid fa-tv"></i> IPTV Package</span>
            <button type="button" class="btn-icon text-danger" onclick="this.closest('.iptv-row').remove()" style="padding:0;"><i class="fa-solid fa-xmark"></i></button>
        </label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
            <input type="text" class="iptv-name-input" placeholder="Pack Name (e.g. Basic IPTV)">
            <input type="number" class="iptv-rate-input" min="0" step="0.01" placeholder="Rate (₹/$)">
        </div>
        <textarea class="iptv-desc-input" rows="1" style="width: 100%; margin-top: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" placeholder="Description (e.g., 500+ Channels, HD)"></textarea>
    </div>`);
    };

    window.addOttRow = function () {
        document.getElementById('ott-rows-container').insertAdjacentHTML('beforeend', `
    <div class="form-group ott-row" style="padding: 10px; background: rgba(245, 158, 11, 0.05); border-radius: 8px; border: 1px dashed #f59e0b; margin-bottom: 0.5rem; position: relative;">
        <label style="color: #f59e0b; display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fa-solid fa-mobile-screen"></i> OTT Package</span>
            <button type="button" class="btn-icon text-danger" onclick="this.closest('.ott-row').remove()" style="padding:0;"><i class="fa-solid fa-xmark"></i></button>
        </label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
            <input type="text" class="ott-name-input" placeholder="Pack Name (e.g. Premium OTT)">
            <input type="number" class="ott-rate-input" min="0" step="0.01" placeholder="Rate (₹/$)">
        </div>
        <textarea class="ott-desc-input" rows="1" style="width: 100%; margin-top: 0.5rem; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" placeholder="Description (e.g., Netflix, Prime, Hotstar)"></textarea>
    </div>`);
    };

    window.editPlan = function (planId) {
        const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
        if (op && op.plans) {
            const p = op.plans.find(x => x.id === planId);
            if (p) {
                document.getElementById('plan-id').value = p.id;
                document.getElementById('plan-category').value = p.category;
                document.getElementById('plan-type').value = p.type;
                document.getElementById('plan-description').value = p.description || '';
                document.getElementById('plan-users').value = p.users;
                document.getElementById('plan-rate').value = p.rate;
                openModal('plan-modal');
            }
        }
    };

    window.deletePlan = function (planId) {
        confirmDelete('Delete Service', 'Remove this from plan list?', () => {
            const op = operators.find(o => o.id === (activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id));
            if (op) {
                op.plans = op.plans.filter(p => p.id !== planId);
                saveData();
                showToast('Removed');
            }
        });
    };

    window.deletePayment = function (paymentId) {
        confirmDelete('Delete Payment', 'Remove this transaction?', () => {
            const op = operators.find(o => o.id === currentAdminViewOpId);
            if (op) {
                op.payments = op.payments.filter(p => p.id !== paymentId);
                saveData();
            }
        });
    };

    window.togglePaymentStatus = function (paymentId) {
        const op = operators.find(o => o.id === currentAdminViewOpId);
        if (op) {
            const p = op.payments.find(x => x.id === paymentId);
            if (p) {
                p.status = p.status === 'Paid' ? 'Unpaid' : 'Paid';
                saveData();
            }
        }
    };

    window.editSubscriber = function (subId) {
        const opId = activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id;
        const op = operators.find(o => o.id === opId);
        if (op && op.subscribers) {
            const s = op.subscribers.find(x => x.id === subId);
            if (s) {
                document.getElementById('sub-id').value = s.id;
                document.getElementById('sub-name').value = s.name;
                document.getElementById('sub-platform').value = s.platform;
                populatePacksDropdown(op, s.platform);
                Array.from(document.getElementById('sub-bundle').options).forEach(opt => {
                    if (opt.dataset.type === s.bundle) opt.selected = true;
                });
                document.getElementById('sub-created').value = s.createdDate;
                document.getElementById('sub-expiry').value = s.expiryDate;
                openModal('sub-modal');
            }
        }
    };

    window.deleteSubscriber = function (subId) {
        confirmDelete('Delete Tracker', 'Stop tracking this parameter?', () => {
            const opId = activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id;
            const op = operators.find(o => o.id === opId);
            if (op) {
                op.subscribers = op.subscribers.filter(s => s.id !== subId);
                saveData();
            }
        });
    };

    window.sendReminder = function (opId, subId, method) {
        const op = operators.find(o => o.id === opId);
        if (!op || !op.subscribers) return;
        const sub = op.subscribers.find(s => s.id === subId);
        if (!sub) return;

        if (!op.phone) { showToast('Operator Phone No. missing', 'error'); return; }

        let msg = msgTemplates.single.replace(/{OperatorName}/g, op.name).replace(/{UserName}/g, sub.name).replace(/{Platform}/g, sub.platform).replace(/{Bundle}/g, sub.bundle).replace(/{CreatedDate}/g, formatDate(sub.createdDate)).replace(/{ExpiryDate}/g, formatDate(sub.expiryDate));

        let phone = op.phone.replace(/[^0-9\+]/g, '');
        if (phone.length === 10) phone = '91' + phone;
        if (method === 'whatsapp') { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank'); }
        else if (method === 'sms') { window.open(`sms:${phone}?body=${encodeURIComponent(msg)}`, '_self'); }
    };

    function populatePacksDropdown(op, platform) {
        const bundleSelect = document.getElementById('sub-bundle');
        if (!bundleSelect) return;
        bundleSelect.innerHTML = '';
        if (!op || !op.plans) return;
        const packs = op.plans.filter(p => p.category === platform);
        packs.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.type} - ${formatCurrency(p.rate)}`;
            opt.dataset.rate = p.rate;
            opt.dataset.type = p.type;
            bundleSelect.appendChild(opt);
        });
        if (packs.length === 0) {
            bundleSelect.innerHTML = `<option value="" disabled selected>No ${platform} bases found! Please add in Packages menu.</option>`;
        }
    }

    let confirmAction = null;
    function confirmDelete(title, message, callback) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        confirmAction = callback;
        openModal('confirm-modal');
    }

    async function sendTelegramMessage(chatId, text) {
        const token = localStorage.getItem(BOT_TOKEN_KEY);
        if (!token) return { success: false, error: 'Bot token not set' };
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
            });
            const data = await res.json();
            return { success: data.ok, error: data.description };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Auto Telegram reminders
    setInterval(async () => {
        const token = localStorage.getItem(BOT_TOKEN_KEY);
        if (!token) return;

        const todayStr = new Date().toDateString();
        let sentCount = 0;

        for (let op of operators) {
            if (!op.chatId || !op.subscribers) continue;

            let sentMessagesLog = op.lastAutoReminders || {};
            let needsSave = false;

            for (let sub of op.subscribers) {
                const exp = getExpiryStatus(sub.expiryDate);

                if (exp.days === 2 || exp.days === 0 || exp.days < 0) {
                    let statusKey = exp.days < 0 ? 'expired' : `exp_${exp.days}d`;
                    let memKey = `${sub.id}_${statusKey}`;

                    if (sentMessagesLog[memKey] === todayStr) continue;

                    let autoMsg = msgTemplates.single.replace(/{OperatorName}/g, op.name).replace(/{UserName}/g, sub.name).replace(/{Platform}/g, sub.platform).replace(/{Bundle}/g, sub.bundle).replace(/{CreatedDate}/g, formatDate(sub.createdDate)).replace(/{ExpiryDate}/g, formatDate(sub.expiryDate));
                    if (exp.days < 0) autoMsg = `🚨 *URGENT ALERT: EXPIRED*\n\n` + autoMsg;
                    else autoMsg = `⏳ *AUTOMATED EXPIRY REMINDER*\n\n` + autoMsg;

                    const res = await sendTelegramMessage(op.chatId, autoMsg);
                    if (res.success) {
                        sentMessagesLog[memKey] = todayStr;
                        needsSave = true;
                        sentCount++;
                    }
                }
            }

            if (needsSave) {
                op.lastAutoReminders = sentMessagesLog;
            }
        }

        if (sentCount > 0) {
            saveData();
            showToast(`Auto-bot dispatched ${sentCount} reminders via Telegram.`);
        }

    }, 60000);
});
