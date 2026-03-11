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

// Data State
let operators = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let activeUser = JSON.parse(sessionStorage.getItem('hybrid_auth')) || null;
let currentAdminViewOpId = null;
let isInitialSync = true;

const defaultTemplates = {
    single: "Hello {OperatorName},\n\nReminder: Your user *{UserName}*'s {Platform} ID for bundle \"{Bundle}\" is expiring on *{ExpiryDate}*.\n(Started on: {CreatedDate}).\n\nPlease renew it soon to avoid disruption.",
    bulk: "Hello {OperatorName},\n\nYou have clients with expiring / expired subscriptions:"
};
let msgTemplates = JSON.parse(localStorage.getItem(MSG_KEY)) || defaultTemplates;
if (!msgTemplates.single) msgTemplates.single = defaultTemplates.single;
if (!msgTemplates.bulk) msgTemplates.bulk = defaultTemplates.bulk;

// Firebase Listener
onValue(operatorsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        operators = Array.isArray(data) ? data : Object.values(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
    } else if (isInitialSync && operators.length > 0) {
        set(operatorsRef, operators);
    } else {
        operators = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
    }
    isInitialSync = false;
    renderApp();
}, (error) => {
    console.error("Firebase Sync Error.", error);
    showToast("Firebase sync disconnected. Using local data.", "error");
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
    const totalUsers = realPlans.reduce((sum, p) => sum + parseInt(p.users || 0), 0);
    const baseRevenue = realPlans.reduce((sum, p) => sum + (parseInt(p.users || 0) * parseFloat(p.rate || 0)), 0);

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
        sessionStorage.setItem('hybrid_auth', JSON.stringify(activeUser));
        showToast('Logged in as Super Admin');
        renderApp();
    } else {
        const op = operators.find(o => o.username === u && o.password === p);
        if (op) {
            activeUser = { role: 'operator', id: op.id };
            sessionStorage.setItem('hybrid_auth', JSON.stringify(activeUser));
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
    sessionStorage.removeItem('hybrid_auth');
    document.getElementById('login-form').reset();
    renderApp();
});

function renderApp() {
    const headerActions = document.getElementById('header-actions');
    const adminActions = document.getElementById('admin-header-actions');
    const greeting = document.getElementById('user-greeting');

    if (!activeUser) {
        headerActions.style.display = 'none';
        switchView('login');
        return;
    }

    headerActions.style.display = 'flex';

    if (activeUser.role === 'admin') {
        adminActions.style.display = 'flex';
        greeting.textContent = 'Super Admin';
        if (currentAdminViewOpId) {
            renderAdminOperatorDetail();
            switchView('adminDetail');
        } else {
            renderAdminDashboard();
            switchView('adminDash');
        }
    } else if (activeUser.role === 'operator') {
        adminActions.style.display = 'none';
        const op = operators.find(o => o.id === activeUser.id);
        if (op) {
            greeting.textContent = `Hi, ${op.name}`;
            renderOperatorPortal(op);
            switchView('opPortal');
        } else {
            // Operator deleted
            document.getElementById('logout-btn').click();
        }
    }
}

// ------ ADMIN DASHBOARD LOGIC ------
function renderAdminDashboard(searchTerm = '') {
    let globalUsers = 0; let globalExpected = 0; let globalPaid = 0;
    operators.forEach(op => {
        const m = calculateOperatorMetrics(op);
        globalUsers += m.totalUsers; globalExpected += m.expectedRevenue; globalPaid += m.totalPaid;
    });
    const globalOutstanding = globalExpected - globalPaid;

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
document.getElementById('search-operator').addEventListener('input', (e) => renderAdminDashboard(e.target.value));

// ------ ADMIN OPERATOR SPECIFIC DETAILS ------
function renderAdminOperatorDetail() {
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (!op) { currentAdminViewOpId = null; renderApp(); return; }

    document.getElementById('view-op-title').textContent = op.name;
    const m = calculateOperatorMetrics(op);

    document.getElementById('admin-op-summary').innerHTML = `
        <div class="stat-card"><div class="stat-icon primary"><i class="fa-solid fa-users-rays"></i></div>
            <div class="stat-content"><p>Total Assigned Users</p><h3>${m.totalUsers}</h3></div></div>
        <div class="stat-card"><div class="stat-icon success"><i class="fa-solid fa-money-bill-wave"></i></div>
            <div class="stat-content"><p>Expected Revenue</p><h3>${formatCurrency(m.expectedRevenue)}</h3></div></div>
        <div class="stat-card"><div class="stat-icon ${m.outstanding > 0 ? 'danger' : 'success'}"><i class="fa-solid fa-file-invoice-dollar"></i></div>
            <div class="stat-content"><p>Outstanding Due</p><h3>${formatCurrency(m.outstanding)}</h3></div></div>
    `;

    renderPlansTable('plans-tbody', op, m, true);
    renderPaymentsTable('payments-tbody', op, true);
    renderSubscribersTable('subscribers-tbody', op, true);
}
document.getElementById('admin-back-to-dash').addEventListener('click', () => { currentAdminViewOpId = null; renderApp(); });

// ------ OPERATOR PORTAL READONLY LOGIC ------
function renderOperatorPortal(op) {
    const m = calculateOperatorMetrics(op);

    document.getElementById('op-profile-name').textContent = op.name;
    document.getElementById('op-profile-phone').textContent = op.phone || 'N/A';
    document.getElementById('op-profile-port').textContent = op.portDetails || 'Standard Port';
    document.getElementById('op-profile-address').textContent = op.address || 'N/A';

    document.getElementById('op-portal-summary').innerHTML = `
        <div class="stat-card"><div class="stat-icon primary"><i class="fa-solid fa-users-rays"></i></div>
            <div class="stat-content"><p>My Active Users</p><h3>${m.totalUsers}</h3></div></div>
        <div class="stat-card"><div class="stat-icon success"><i class="fa-solid fa-money-bill-wave"></i></div>
            <div class="stat-content"><p>Invoice Value</p><h3>${formatCurrency(m.expectedRevenue)}</h3></div></div>
        <div class="stat-card"><div class="stat-icon success"><i class="fa-solid fa-check-double"></i></div>
            <div class="stat-content"><p>Amount Cleared</p><h3>${formatCurrency(m.totalPaid)}</h3></div></div>
        <div class="stat-card"><div class="stat-icon ${m.outstanding > 0 ? 'danger' : 'success'}"><i class="fa-solid fa-file-invoice-dollar"></i></div>
            <div class="stat-content"><p>Total Due Pending</p><h3>${formatCurrency(m.outstanding)}</h3></div></div>
    `;

    renderPlansTable('op-portal-plans-tbody', op, m, false);
    renderPaymentsTable('op-portal-payments-tbody', op, false);
    renderSubscribersTable('op-portal-subscribers-tbody', op, false);
}

// ------ SHARED RENDERING FUNCTIONS ------
function renderPlansTable(tbodyId, operator, metrics, isAdmin) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    const displayPlans = (operator.plans || []).filter(p => !p.type.includes('18% GST') && !p.type.includes('GST 18%'));

    if (displayPlans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 4}" class="empty-state">No services assigned.</td></tr>`;
        return;
    }

    displayPlans.forEach(p => {
        let actCol = isAdmin ? `<td><button class="btn-icon" onclick="editPlan('${p.id}')"><i class="fa-solid fa-pen text-primary"></i></button><button class="btn-icon" onclick="deletePlan('${p.id}')"><i class="fa-solid fa-trash text-danger"></i></button></td>` : '';
        let exCol = isAdmin ? `<td><strong>${formatCurrency(p.users * p.rate)}</strong></td>` : '';
        tbody.innerHTML += `<tr>
            <td><span class="status-badge" style="background:#f1f5f9; color:#475569;">${p.category || 'Internet'}</span></td>
            <td><strong>${p.type}</strong></td><td>${p.users}</td><td>${formatCurrency(p.rate)}</td>
            ${exCol} ${actCol}
        </tr>`;
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
        let statClick = isAdmin ? `style="cursor:pointer;" onclick="togglePaymentStatus('${p.id}')"` : '';
        let actCol = isAdmin ? `<td><button class="btn-icon" onclick="deletePayment('${p.id}')"><i class="fa-solid fa-trash text-danger"></i></button></td>` : '';

        tbody.innerHTML += `<tr>
            <td>${formatDate(p.date)}</td><td>${p.type}</td><td><strong>${formatCurrency(p.amount)}</strong></td>
            <td><span class="status-badge ${statStyle}" ${statClick}>${p.status} ${isAdmin ? '<i class="fa-solid fa-rotate"></i>' : ''}</span></td>
            ${actCol}
        </tr>`;
    });
}

function renderSubscribersTable(tbodyId, operator, isAdmin) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    const subs = (operator.subscribers || []).slice().sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    if (subs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 5}" class="empty-state">No individual users tracked yet.</td></tr>`;
        return;
    }

    subs.forEach(sub => {
        const expStatus = getExpiryStatus(sub.expiryDate);
        const tr = document.createElement('tr');
        if (expStatus.days <= 2 && expStatus.days >= 0) tr.style.backgroundColor = '#fffbeb';
        else if (expStatus.days < 0) tr.style.backgroundColor = '#fef2f2';

        let adminMsgCol = isAdmin ? `<td>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-sm btn-outline" style="color:#25D366; border-color:#25D366; background:white;" onclick="sendReminder('${operator.id}','${sub.id}','whatsapp')"><i class="fa-brands fa-whatsapp"></i> WA</button>
                <button class="btn btn-sm btn-outline" onclick="sendReminder('${operator.id}','${sub.id}','sms')"><i class="fa-solid fa-comment-sms"></i> SMS</button>
            </div>
        </td>` : '';

        let actCol = isAdmin ? `<td>
            <button class="btn-icon" onclick="editSubscriber('${sub.id}')"><i class="fa-solid fa-pen text-primary"></i></button>
            <button class="btn-icon" onclick="deleteSubscriber('${sub.id}')"><i class="fa-solid fa-trash text-danger"></i></button>
        </td>` : '';

        tr.innerHTML = `
            <td><strong>${sub.name}</strong></td>
            <td><span style="font-size: 11px; padding: 2px 6px; background: #e2e8f0; border-radius: 4px; border: 1px solid #cbd5e1;">${sub.platform}</span><br><span style="margin-top:4px; display:inline-block;">${sub.bundle}</span></td>
            <td><div style="font-size: 0.8rem; color: var(--text-muted);">Start: ${formatDate(sub.createdDate)}</div><div style="font-weight: 600; color: ${expStatus.days <= 2 ? 'var(--danger-color)' : 'var(--text-main)'};">Exp: ${formatDate(sub.expiryDate)}</div></td>
            <td><span class="status-badge" style="background: var(--${expStatus.color}-color); color: white;">${expStatus.label}</span></td>
            ${adminMsgCol}
            ${actCol}
        `;
        tbody.appendChild(tr);
    });
}

// ------ MODALS & CRUD OPERATIONS (Admins Only) ------
let confirmAction = null;
function confirmDelete(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    confirmAction = callback; openModal('confirm-modal');
}
document.getElementById('confirm-btn').addEventListener('click', () => { if (confirmAction) confirmAction(); closeModal('confirm-modal'); });

document.getElementById('add-operator-fab').addEventListener('click', () => {
    document.getElementById('operator-form').reset(); document.getElementById('op-id').value = '';
    document.getElementById('op-password').value = Math.random().toString(36).slice(-6); // Auto random password
    document.getElementById('op-modal-title').textContent = 'Add New Operator Firm'; openModal('operator-modal');
});

document.getElementById('edit-op-info-btn').addEventListener('click', () => {
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (op) {
        document.getElementById('op-id').value = op.id; document.getElementById('op-name').value = op.name;
        document.getElementById('op-username').value = op.username || ''; document.getElementById('op-password').value = op.password || '';
        document.getElementById('op-phone').value = op.phone || ''; document.getElementById('op-port').value = op.portDetails || '';
        document.getElementById('op-chat-id').value = op.chatId || '';
        document.getElementById('op-address').value = op.address || '';
        document.getElementById('op-modal-title').textContent = 'Edit Operator Parameters'; openModal('operator-modal');
    }
});

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

    // Check duplicate username
    if (operators.some(o => o.username === username && o.id !== id)) {
        showToast('Username already taken!', 'error'); return;
    }

    if (id) {
        const op = operators.find(o => o.id === id);
        Object.assign(op, { name, username, password, phone, portDetails, chatId, address });
        showToast('Operator info updated');
    } else {
        const newOp = { id: generateId(), name, username, password, phone, portDetails, chatId, address, createdAt: new Date().toISOString(), plans: [], payments: [], subscribers: [] };
        operators.push(newOp); showToast('Operator firm created'); currentAdminViewOpId = newOp.id;
    }
    saveData(); closeModal('operator-modal');
});

document.getElementById('delete-op-btn').addEventListener('click', () => {
    confirmDelete('Delete Firm Info', 'Delete this firm and completely wipe its data?', () => {
        operators = operators.filter(o => o.id !== currentAdminViewOpId);
        currentAdminViewOpId = null; saveData(); showToast('Firm Data Eradicated');
    });
});

// Admin Configuration Checkers
document.getElementById('admin-settings-btn').addEventListener('click', () => {
    document.getElementById('admin-pass-change').value = '';
    document.getElementById('admin-bot-token').value = localStorage.getItem(BOT_TOKEN_KEY) || '';
    openModal('admin-settings-modal');
});

document.getElementById('admin-settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const newPass = document.getElementById('admin-pass-change').value;
    const botToken = document.getElementById('admin-bot-token').value.trim();

    if (newPass) localStorage.setItem(ADMIN_PASS_KEY, newPass);
    localStorage.setItem(BOT_TOKEN_KEY, botToken);

    showToast('Super Admin Config Saved');
    closeModal('admin-settings-modal');
});

document.getElementById('config-upi-btn').addEventListener('click', () => { document.getElementById('upi-id').value = localStorage.getItem(UPI_KEY) || ''; openModal('upi-modal'); });
document.getElementById('upi-form').addEventListener('submit', (e) => { e.preventDefault(); localStorage.setItem(UPI_KEY, document.getElementById('upi-id').value.trim()); showToast('UPI Saved'); closeModal('upi-modal'); });

document.getElementById('config-msg-btn').addEventListener('click', () => { document.getElementById('msg-single').value = msgTemplates.single; document.getElementById('msg-bulk').value = msgTemplates.bulk; openModal('msg-modal'); });
document.getElementById('msg-form').addEventListener('submit', (e) => {
    e.preventDefault(); msgTemplates.single = document.getElementById('msg-single').value; msgTemplates.bulk = document.getElementById('msg-bulk').value;
    localStorage.setItem(MSG_KEY, JSON.stringify(msgTemplates)); showToast('Templates saved'); closeModal('msg-modal');
});

document.getElementById('add-gst-btn').addEventListener('click', () => {
    const op = operators.find(o => o.id === currentAdminViewOpId); if (!op) return;
    if (op.applyGst) return showToast('GST active.', 'warning');
    if (calculateOperatorMetrics(op).baseRevenue > 0) { op.applyGst = true; op.plans = (op.plans || []).filter(p => !p.type.includes('18% GST')); saveData(); showToast('18% GST applied'); }
});
document.getElementById('remove-gst-btn').addEventListener('click', () => {
    const op = operators.find(o => o.id === currentAdminViewOpId); if (!op) return;
    op.applyGst = false; op.plans = (op.plans || []).filter(p => !p.type.includes('18% GST')); saveData(); showToast('GST removed');
});

// Plans
document.getElementById('add-plan-btn').addEventListener('click', () => { document.getElementById('plan-form').reset(); document.getElementById('plan-id').value = ''; openModal('plan-modal'); });
document.getElementById('plan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const [planId, category, type, users, rate] = ['plan-id', 'plan-category', 'plan-type', 'plan-users', 'plan-rate'].map(id => document.getElementById(id).value);
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (op) {
        op.plans = op.plans || [];
        if (planId) { const idx = op.plans.findIndex(p => p.id === planId); if (idx >= 0) op.plans[idx] = { id: planId, category, type, users: parseInt(users), rate: parseFloat(rate) }; }
        else op.plans.push({ id: generateId(), category, type, users: parseInt(users), rate: parseFloat(rate) });
        saveData(); closeModal('plan-modal'); showToast('Service saved');
    }
});
window.editPlan = function (planId) {
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (op && op.plans) {
        const p = op.plans.find(x => x.id === planId);
        if (p) { document.getElementById('plan-id').value = p.id; document.getElementById('plan-category').value = p.category; document.getElementById('plan-type').value = p.type; document.getElementById('plan-users').value = p.users; document.getElementById('plan-rate').value = p.rate; openModal('plan-modal'); }
    }
};
window.deletePlan = function (planId) { confirmDelete('Delete Service', 'Remove this from plan list?', () => { const op = operators.find(o => o.id === currentAdminViewOpId); if (op) { op.plans = op.plans.filter(p => p.id !== planId); saveData(); showToast('Removed'); } }); };

// Payments
document.getElementById('add-payment-btn').addEventListener('click', () => { document.getElementById('payment-form').reset(); document.getElementById('payment-date').valueAsDate = new Date(); openModal('payment-modal'); });
document.getElementById('payment-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (op) {
        op.payments = op.payments || [];
        op.payments.push({ id: generateId(), type: document.getElementById('payment-type').value, amount: parseFloat(document.getElementById('payment-amount').value), date: document.getElementById('payment-date').value, status: document.getElementById('payment-status').value });
        saveData(); closeModal('payment-modal'); showToast('Recorded');
    }
});
window.deletePayment = function (paymentId) { confirmDelete('Delete Payment', 'Remove this transaction?', () => { const op = operators.find(o => o.id === currentAdminViewOpId); if (op) { op.payments = op.payments.filter(p => p.id !== paymentId); saveData(); } }); };
window.togglePaymentStatus = function (paymentId) { const op = operators.find(o => o.id === currentAdminViewOpId); if (op) { const p = op.payments.find(x => x.id === paymentId); if (p) { p.status = p.status === 'Paid' ? 'Unpaid' : 'Paid'; saveData(); } } };

// Subscribers Tracker
document.getElementById('add-sub-btn').addEventListener('click', () => { document.getElementById('sub-form').reset(); document.getElementById('sub-id').value = ''; document.getElementById('sub-created').valueAsDate = new Date(); openModal('sub-modal'); });
document.getElementById('sub-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (op) {
        op.subscribers = op.subscribers || [];
        const [subId, name, platform, bundle, createdDate, expiryDate] = ['sub-id', 'sub-name', 'sub-platform', 'sub-bundle', 'sub-created', 'sub-expiry'].map(id => document.getElementById(id).value);
        if (subId) { const idx = op.subscribers.findIndex(s => s.id === subId); if (idx >= 0) op.subscribers[idx] = { id: subId, name, platform, bundle, createdDate, expiryDate }; }
        else op.subscribers.push({ id: generateId(), name, platform, bundle, createdDate, expiryDate });
        saveData(); closeModal('sub-modal'); showToast('Tracker Saved');
    }
});
window.editSubscriber = function (subId) {
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (op && op.subscribers) {
        const s = op.subscribers.find(x => x.id === subId);
        if (s) { document.getElementById('sub-id').value = s.id; document.getElementById('sub-name').value = s.name; document.getElementById('sub-platform').value = s.platform; document.getElementById('sub-bundle').value = s.bundle; document.getElementById('sub-created').value = s.createdDate; document.getElementById('sub-expiry').value = s.expiryDate; openModal('sub-modal'); }
    }
}
window.deleteSubscriber = function (subId) { confirmDelete('Delete Tracker', 'Stop tracking this parameter?', () => { const op = operators.find(o => o.id === currentAdminViewOpId); if (op) { op.subscribers = op.subscribers.filter(s => s.id !== subId); saveData(); } }); }

// Automated Messages System
window.sendReminder = function (opId, subId, method) {
    const op = operators.find(o => o.id === opId);
    if (!op || !op.subscribers) return;
    const sub = op.subscribers.find(s => s.id === subId);
    if (!sub) return;

    if (!op.phone) { showToast('Operator Phone No. missing', 'error'); return; }

    let msg = msgTemplates.single.replace(/{OperatorName}/g, op.name).replace(/{UserName}/g, sub.name).replace(/{Platform}/g, sub.platform).replace(/{Bundle}/g, sub.bundle).replace(/{CreatedDate}/g, formatDate(sub.createdDate)).replace(/{ExpiryDate}/g, formatDate(sub.expiryDate));

    let phone = op.phone.replace(/[^0-9\+]/g, ''); if (phone.length === 10) phone = '91' + phone;
    if (method === 'whatsapp') { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank'); }
    else if (method === 'sms') { window.open(`sms:${phone}?body=${encodeURIComponent(msg)}`, '_self'); }
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

// Full background Automator for Telegram (Runs every minute when Dashboard is open)
setInterval(async () => {
    const token = localStorage.getItem(BOT_TOKEN_KEY);
    if (!token) return; // Silent return if bot is not configured

    const todayStr = new Date().toDateString();
    let sentCount = 0;

    for (let op of operators) {
        if (!op.chatId || !op.subscribers) continue;

        let sentMessagesLog = op.lastAutoReminders || {};
        let needsSave = false;

        for (let sub of op.subscribers) {
            const exp = getExpiryStatus(sub.expiryDate);

            // Only fire if 2 days approx AND not fired today for this specific user/status
            if (exp.days === 2 || exp.days === 0 || exp.days < 0) {
                let statusKey = exp.days < 0 ? 'expired' : `exp_${exp.days}d`;
                let memKey = `${sub.id}_${statusKey}`;

                // If already pinged today about this status, skip.
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

}, 60000); // Check every 60 seconds

document.getElementById('remind-all-expiring-btn').addEventListener('click', async () => {
    const op = operators.find(o => o.id === currentAdminViewOpId);
    if (!op || !op.subscribers) return;

    const expiring = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days <= 2 && getExpiryStatus(s.expiryDate).days >= 0);
    const expired = op.subscribers.filter(s => getExpiryStatus(s.expiryDate).days < 0);

    if (expiring.length === 0 && expired.length === 0) return showToast('No immediate expirations found.');

    let msg = msgTemplates.bulk.replace(/{OperatorName}/g, op.name) + "\n\n";
    if (expiring.length > 0) { msg += `⏳ *Expiring Soon:*\n`; expiring.forEach(s => msg += `- ${s.name} | ${s.platform} (${s.bundle}) | Exp: ${formatDate(s.expiryDate)}\n`); }
    if (expired.length > 0) { msg += `\n❌ *Already Expired:*\n`; expired.forEach(s => msg += `- ${s.name} | ${s.platform} (${s.bundle}) | Exp: ${formatDate(s.expiryDate)}\n`); }
    msg += `\nPlease check your system and renew to avoid disruption.`;

    const token = localStorage.getItem(BOT_TOKEN_KEY);
    if (token && op.chatId) {
        showToast('Sending via Telegram API...');
        const res = await sendTelegramMessage(op.chatId, msg);
        if (res.success) showToast('Telegram Message dispatched!');
        else showToast('Telegram failed: ' + res.error, 'error');
    } else {
        if (!op.phone) return showToast('Ensure Operator has Phone saved for WhatsApp fallback.', 'error');
        let phone = op.phone.replace(/[^0-9\+]/g, ''); if (phone.length === 10) phone = '91' + phone;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    }
});

// ------ PDF & PRINTING ENGINE ------
function triggerPrint(htmlContent, filename) {
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = `<div style="padding: 2rem; background:white; color:black; font-family:'Inter', sans-serif;">
        <div style="text-align:center; border-bottom:2px solid black; padding-bottom:1rem; margin-bottom:2rem;">
            <!-- Render Company Logo directly on invoice if possible -->
            <img src="logo.png" style="max-height:80px; display:block; margin: 0 auto;" onerror="this.style.display='none'">
            <h1 style="margin: 0.5rem 0 0 0; font-size: 24px;">Hybrid Internet Management</h1>
        </div>
        ${htmlContent}
    </div>`;

    const opt = { margin: 0.5, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' } };
    if (window.html2pdf) {
        showToast("Generating Document...");
        html2pdf().set(opt).from(tempContainer).save().then(() => showToast("Download specific."));
    } else {
        const printArea = document.getElementById('print-area'); printArea.innerHTML = tempContainer.innerHTML;
        setTimeout(() => { window.print(); setTimeout(() => printArea.innerHTML = '', 1000); }, 500);
    }
}

function processAdminOrOpId() { return activeUser.role === 'admin' ? currentAdminViewOpId : activeUser.id; }

const handleDownloadBal = () => {
    const op = operators.find(o => o.id === processAdminOrOpId()); if (!op) return; const m = calculateOperatorMetrics(op);
    triggerPrint(`<div style="text-align:center;"><h2>Balance Statement</h2><h3>${op.name}</h3><div style="padding: 2rem; background:#fee2e2; border:1px solid #ef4444; border-radius:10px; margin:2rem auto; max-width:400px; display:inline-block;"><h1 style="color:#b91c1c; margin:0;">${formatCurrency(m.outstanding)}</h1><p>Outstanding Amount Due</p></div></div>`, `Balance_${op.name}.pdf`);
};
const handleDownloadRpt = (e) => {
    if (e) { e.preventDefault(); closeModal('report-modal'); }
    const op = operators.find(o => o.id === processAdminOrOpId()); if (!op) return; const m = calculateOperatorMetrics(op);

    const upiId = localStorage.getItem(UPI_KEY);
    let qrHtml = '';
    if (upiId && m.outstanding > 0) {
        const upiLink = `upi://pay?pa=${upiId}&pn=Hybrid+Internet&am=${m.outstanding.toFixed(2)}&cu=INR`;
        qrHtml = `<div style="text-align: center; margin-top: 30px; border-top: 1px dashed #ccc; padding-top: 20px;">
            <h4>Scan to Pay (UPI)</h4>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiLink)}" alt="UPI QR">
            <p style="font-size: 10px; color: #666;">UPI ID: ${upiId}</p>
        </div>`;
    }

    triggerPrint(`<div>
        <h2 style="text-align:center;">Monthly Operations Invoice</h2>
        <table style="width:100%; margin-top:1rem; border-collapse: collapse;">
            <tr><td style="padding:8px 0;"><strong>Billed To:</strong> ${op.name}</td><td style="text-align:right;"><strong>Total Service Users:</strong> ${m.totalUsers}</td></tr>
            <tr><td style="padding:8px 0;"><strong>Phone:</strong> ${op.phone || '-'}</td><td style="text-align:right;"><strong>Total Amount Paid:</strong> ${formatCurrency(m.totalPaid)}</td></tr>
            <tr><td style="padding:8px 0; border-bottom:1px solid #000; padding-bottom:15px;" colspan="2"><strong>Port Details / Address:</strong> ${op.portDetails || '-'} | ${op.address || '-'}</td></tr>
        </table>
        <h3 style="margin-top:20px;">Financial Overheads:</h3>
        <table style="width:100%; border-collapse: collapse;">
            <tr style="background:#f1f5f9;"><th style="border:1px solid #cbd5e1; padding:8px;">Base Charge</th><th style="border:1px solid #cbd5e1; padding:8px;">GST (18%)</th><th style="border:1px solid #cbd5e1; padding:8px;">Gross Total</th></tr>
            <tr><td style="text-align:center; border:1px solid #cbd5e1; padding:8px;">${formatCurrency(m.baseRevenue)}</td><td style="text-align:center; border:1px solid #cbd5e1; padding:8px;">${formatCurrency(m.gstAmount)}</td><td style="text-align:center; border:1px solid #cbd5e1; padding:8px;"><strong>${formatCurrency(m.expectedRevenue)}</strong></td></tr>
        </table>
        
        <h3 style="margin-top:20px; color:#b91c1c; text-align:center;">CLOSING OUTSTANDING BALANCE: ${formatCurrency(m.outstanding)}</h3>
        ${qrHtml}
    </div>`, `Invoice_${op.name}.pdf`);
};

// Bind Admin Downloads
document.getElementById('balance-receipt-btn').addEventListener('click', handleDownloadBal);
document.getElementById('report-btn').addEventListener('click', () => openModal('report-modal'));
document.getElementById('report-form').addEventListener('submit', handleDownloadRpt);
document.getElementById('receipt-btn').addEventListener('click', () => {
    const op = operators.find(o => o.id === currentAdminViewOpId); if (!op) return;
    triggerPrint(`<div style="text-align:center;"><h2>No Dues Certificate</h2><div style="padding: 2rem; background:#ecfdf5; border:1px solid #10b981; border-radius:10px; margin:2rem auto; max-width:400px; display:inline-block;"><h1 style="color:#059669; margin:0;"><i class="fa-solid fa-check-circle"></i> CLEAR</h1><p>No outstanding amounts pending as of today.</p></div></div>`, `Clear_${op.name}.pdf`);
});

// Bind Operator Downloads
document.getElementById('op-portal-receipt-btn').addEventListener('click', handleDownloadBal);
document.getElementById('op-portal-report-btn').addEventListener('click', () => handleDownloadRpt());

// Misc
document.getElementById('export-btn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(operators));
    const a = document.createElement('a'); a.setAttribute("href", dataStr); a.setAttribute("download", `super-portal-data-${new Date().toISOString().slice(0, 10)}.json`); a.click(); showToast('Backup Data exported');
});
