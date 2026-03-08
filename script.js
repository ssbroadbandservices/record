import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

const firebaseConfig = {
    // We only need the databaseURL to connect to Realtime Database
    // Make sure your Firebase Realtime database rules are set to ".read": true, ".write": true
    databaseURL: "https://hybrid-internet-database-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const operatorsRef = ref(db, 'operators');


// State Management
const STORAGE_KEY = 'hybrid_operators_v1';
const LOGO_KEY = 'hybrid_custom_logo';
// Intialization: Try to get from local storage for faster UI load while Firebase syncs
let operators = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let currentOperatorId = null;

// Firebase Realtime Database Synchronization Listener
let isInitialSync = true;
onValue(operatorsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        operators = Array.isArray(data) ? data : Object.values(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
    } else if (isInitialSync && operators.length > 0) {
        // If Firebase is empty, but we have local data! (Syncing local -> Firebase immediately)
        set(operatorsRef, operators);
    } else {
        operators = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));
    }
    isInitialSync = false;

    renderDashboard();
    if (currentOperatorId) {
        renderOperatorView();
    }
}, (error) => {
    console.error("Firebase Sync Error. Ensure Database rules are active.", error);
    showToast("Firebase sync disconnected. Using local data.", "error");
});


// DOM Elements
const views = {
    dashboard: document.getElementById('dashboard-view'),
    operator: document.getElementById('operator-view')
};

// --- Logo Management ---
const savedLogo = localStorage.getItem(LOGO_KEY);
const logoImg = document.getElementById('company-logo');
const fallbackIcon = document.getElementById('fallback-icon');

if (savedLogo) {
    logoImg.src = savedLogo;
    logoImg.style.display = 'inline-block';
    fallbackIcon.style.display = 'none';
}

document.getElementById('logo-upload').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            const base64Logo = event.target.result;
            localStorage.setItem(LOGO_KEY, base64Logo);
            logoImg.src = base64Logo;
            logoImg.style.display = 'inline-block';
            fallbackIcon.style.display = 'none';
            showToast('Logo updated successfully');
        };
        reader.readAsDataURL(file);
    }
});

// --- Utilities ---
function generateId() {
    return 'id_' + Math.random().toString(36).substr(2, 9);
}

function saveData() {
    // 1. Save locally for fast cache
    localStorage.setItem(STORAGE_KEY, JSON.stringify(operators));

    // 2. Push to Firebase (Triggers onValue which re-renders UI across devices)
    set(operatorsRef, operators).catch((err) => {
        console.error("Failed to save to database:", err);
        showToast("Error syncing to Cloud Database!", "error");
    });

    // 3. Immediately update Local UI
    renderDashboard();
    if (currentOperatorId) {
        renderOperatorView();
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

function formatDate(dateString) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
}

// --- UPI Config Management ---
const UPI_KEY = 'hybrid_upi_config';
document.getElementById('config-upi-btn').addEventListener('click', () => {
    const currentUpi = localStorage.getItem(UPI_KEY) || '';
    document.getElementById('upi-id').value = currentUpi;
    openModal('upi-modal');
});

document.getElementById('upi-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const upiId = document.getElementById('upi-id').value.trim();
    localStorage.setItem(UPI_KEY, upiId);
    showToast('UPI Information Saved Successfully');
    closeModal('upi-modal');
});

// --- Toast Notifications ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 3300);
}

// --- Navigation ---
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    window.scrollTo(0, 0);
}

// --- Modals ---
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

document.querySelectorAll('.close-modal, .cancel-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
    });
});

// --- Calculations ---
function calculateOperatorMetrics(operator) {
    const plans = operator.plans || [];
    const payments = operator.payments || [];

    const totalUsers = plans.reduce((sum, p) => sum + parseInt(p.users || 0), 0);

    const expectedRevenue = plans.reduce((sum, p) => sum + (parseInt(p.users || 0) * parseFloat(p.rate || 0)), 0);

    const totalPaid = payments
        .filter(p => p.status === 'Paid')
        .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    const outstanding = expectedRevenue - totalPaid;

    return { totalUsers, expectedRevenue, totalPaid, outstanding };
}

// --- Dashboard Features ---
function renderDashboard(searchTerm = '') {
    // 1. Render Global Summary
    let globalUsers = 0;
    let globalExpected = 0;
    let globalPaid = 0;

    operators.forEach(op => {
        const metrics = calculateOperatorMetrics(op);
        globalUsers += metrics.totalUsers;
        globalExpected += metrics.expectedRevenue;
        globalPaid += metrics.totalPaid;
    });

    const globalOutstanding = globalExpected - globalPaid;

    document.getElementById('global-summary').innerHTML = `
        <div class="stat-card">
            <div class="stat-icon primary"><i class="fa-solid fa-users"></i></div>
            <div class="stat-content">
                <p>Total Operators</p>
                <h3>${operators.length}</h3>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon primary"><i class="fa-solid fa-network-wired"></i></div>
            <div class="stat-content">
                <p>Total Service Lines</p>
                <h3>${globalUsers}</h3>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon success"><i class="fa-solid fa-indian-rupee-sign"></i></div>
            <div class="stat-content">
                <p>Total Revenue (Expected)</p>
                <h3>${formatCurrency(globalExpected)}</h3>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon ${globalOutstanding > 0 ? 'warning' : 'success'}"><i class="fa-solid fa-scale-balanced"></i></div>
            <div class="stat-content">
                <p>Outstanding Balances</p>
                <h3>${formatCurrency(globalOutstanding)}</h3>
            </div>
        </div>
    `;

    // 2. Render Operator List
    const opList = document.getElementById('operator-list');
    opList.innerHTML = '';

    const filteredOperators = operators.filter(op =>
        op.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filteredOperators.length === 0) {
        opList.innerHTML = `
            <div style="grid-column: 1 / -1" class="empty-state">
                <i class="fa-solid fa-box-open"></i>
                <p>No operators found. Add your first operator to get started.</p>
            </div>
        `;
        return;
    }

    filteredOperators.forEach(op => {
        const m = calculateOperatorMetrics(op);

        const card = document.createElement('div');
        card.className = 'operator-card';
        card.onclick = () => viewOperator(op.id);

        card.innerHTML = `
            <div class="operator-header">
                <div class="operator-info">
                    <h3>${op.name}</h3>
                    <p>Added: ${formatDate(op.createdAt)}</p>
                </div>
                <div class="operator-icon"><i class="fa-solid fa-plug-circle-bolt"></i></div>
            </div>
            <div class="operator-stats">
                <div class="op-stat-item">
                    <span>Total Service Users</span>
                    <strong>${m.totalUsers}</strong>
                </div>
                <div class="op-stat-item">
                    <span>Payment Status</span>
                    <span class="status-badge ${m.outstanding <= 0 ? 'badge-paid' : 'badge-unpaid'}">
                        ${m.outstanding <= 0 && m.expectedRevenue > 0 ? 'Clear' : 'Pending'}
                    </span>
                </div>
                <div class="op-stat-item">
                    <span>Paid to Date</span>
                    <strong class="text-success">${formatCurrency(m.totalPaid)}</strong>
                </div>
                <div class="op-stat-item">
                    <span>Outstanding</span>
                    <strong class="${m.outstanding > 0 ? 'text-warning' : 'text-success'}">${formatCurrency(m.outstanding)}</strong>
                </div>
            </div>
        `;
        opList.appendChild(card);
    });
}

// --- Operator Details Features ---
function viewOperator(id) {
    currentOperatorId = id;
    renderOperatorView();
    switchView('operator');
}

function renderOperatorView() {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (!operator) {
        switchView('dashboard');
        return;
    }

    document.getElementById('view-op-title').textContent = operator.name;
    const m = calculateOperatorMetrics(operator);

    // Summary
    document.getElementById('op-summary').innerHTML = `
        <div class="stat-card">
            <div class="stat-icon primary"><i class="fa-solid fa-users-rays"></i></div>
            <div class="stat-content">
                <p>Total Service Lines</p>
                <h3>${m.totalUsers}</h3>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon success"><i class="fa-solid fa-money-bill-wave"></i></div>
            <div class="stat-content">
                <p>Expected Revenue</p>
                <h3>${formatCurrency(m.expectedRevenue)}</h3>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon success"><i class="fa-solid fa-hand-holding-dollar"></i></div>
            <div class="stat-content">
                <p>Amount Paid</p>
                <h3>${formatCurrency(m.totalPaid)}</h3>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon ${m.outstanding > 0 ? 'danger' : 'success'}"><i class="fa-solid fa-file-invoice-dollar"></i></div>
            <div class="stat-content">
                <p>Outstanding Balance</p>
                <h3>${formatCurrency(m.outstanding)}</h3>
            </div>
        </div>
    `;

    // Plans Table
    const plansTbody = document.getElementById('plans-tbody');
    plansTbody.innerHTML = '';
    if (!operator.plans || operator.plans.length === 0) {
        plansTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No services configured yet.</td></tr>`;
    } else {
        operator.plans.forEach(plan => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <span class="status-badge" style="background:#f1f5f9; color:#475569; border: 1px solid #cbd5e1;">${plan.category || 'Internet'}</span>
                </td>
                <td><strong>${plan.type}</strong></td>
                <td>${plan.users}</td>
                <td>${formatCurrency(plan.rate)}/user</td>
                <td><strong>${formatCurrency(plan.users * plan.rate)}</strong></td>
                <td>
                    <button class="btn-icon" onclick="editPlan('${plan.id}')" title="Edit Plan"><i class="fa-solid fa-pen" style="color: var(--primary-color);"></i></button>
                    <button class="btn-icon" onclick="deletePlan('${plan.id}')" title="Delete Plan"><i class="fa-solid fa-trash text-danger"></i></button>
                </td>
            `;
            plansTbody.appendChild(tr);
        });
    }

    // Payments Table
    const paymentsTbody = document.getElementById('payments-tbody');
    paymentsTbody.innerHTML = '';

    // Sort payments by date descending
    const sortedPayments = (operator.payments || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedPayments.length === 0) {
        paymentsTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No payment records found.</td></tr>`;
    } else {
        sortedPayments.forEach(payment => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(payment.date)}</td>
                <td>${payment.type}</td>
                <td><strong>${formatCurrency(payment.amount)}</strong></td>
                <td>
                    <span class="status-badge ${payment.status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}" 
                          style="cursor:pointer;" 
                          onclick="togglePaymentStatus('${payment.id}')"
                          title="Click to toggle status">
                        ${payment.status} <i class="fa-solid fa-rotate"></i>
                    </span>
                </td>
                <td>
                    <button class="btn-icon" onclick="deletePayment('${payment.id}')" title="Delete Payment"><i class="fa-solid fa-trash text-danger"></i></button>
                </td>
            `;
            paymentsTbody.appendChild(tr);
        });
    }
}

// --- Event Listeners and Form Handling ---

// Search
document.getElementById('search-operator').addEventListener('input', (e) => {
    renderDashboard(e.target.value);
});

// Back Button
document.getElementById('back-to-dash').addEventListener('click', () => {
    currentOperatorId = null;
    switchView('dashboard');
});

// Add Operator
document.getElementById('add-operator-fab').addEventListener('click', () => {
    document.getElementById('operator-form').reset();
    openModal('operator-modal');
});

document.getElementById('operator-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('op-name').value.trim();
    if (name) {
        const newOp = {
            id: generateId(),
            name: name,
            createdAt: new Date().toISOString(),
            plans: [],
            payments: []
        };
        operators.push(newOp);
        saveData();
        closeModal('operator-modal');
        showToast('Operator created successfully');
        viewOperator(newOp.id); // Automatically navigate to newly created operator
    }
});

// Confirm Modal Logic
let confirmAction = null;
function confirmDelete(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    confirmAction = callback;
    openModal('confirm-modal');
}

document.getElementById('confirm-btn').addEventListener('click', () => {
    if (confirmAction) confirmAction();
    closeModal('confirm-modal');
});

// Delete Operator
document.getElementById('delete-op-btn').addEventListener('click', () => {
    confirmDelete('Delete Operator', 'Are you sure you want to delete this operator and all associated data? This action cannot be undone.', () => {
        operators = operators.filter(o => o.id !== currentOperatorId);
        showToast('Operator deleted successfully');
        currentOperatorId = null;
        saveData();
        switchView('dashboard');
    });
});

// Auto focus change category in Add Service Form to hint the user
document.getElementById('plan-category').addEventListener('change', (e) => {
    const typeInput = document.getElementById('plan-type');
    const cat = e.target.value;
    if (cat === 'Internet') {
        typeInput.placeholder = "e.g., 50 Mbps";
    } else if (cat === 'IPTV') {
        typeInput.placeholder = "e.g., Standard IPTV Pack";
    } else if (cat === 'OTT') {
        typeInput.placeholder = "e.g., Netflix Premium";
    } else {
        typeInput.placeholder = "e.g., Maintenance Fee";
    }
});

// Add 18% GST Plan
document.getElementById('add-gst-btn').addEventListener('click', () => {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (!operator || !operator.plans || operator.plans.length === 0) {
        showToast('Please add services first to calculate GST', 'warning');
        return;
    }

    // Calculate sum of base plans (exclude any existing "18% GST" plan from calculation)
    const baseRevenue = operator.plans
        .filter(p => p.type !== '18% GST' && p.type !== 'GST 18%')
        .reduce((sum, p) => sum + (parseInt(p.users || 0) * parseFloat(p.rate || 0)), 0);

    const gstAmount = baseRevenue * 0.18;

    if (gstAmount > 0) {
        // Check if GST plan already exists
        const gstPlanIndex = operator.plans.findIndex(p => p.type === '18% GST' || p.type === 'GST 18%');
        if (gstPlanIndex >= 0) {
            operator.plans[gstPlanIndex].rate = gstAmount;
            showToast('18% GST updated successfully');
        } else {
            operator.plans.push({
                id: generateId(),
                category: 'Other',
                type: '18% GST',
                users: 1,
                rate: gstAmount
            });
            showToast('18% GST added successfully');
        }
        saveData();
    } else {
        showToast('Base revenue is 0. Cannot add GST.', 'error');
    }
});

// Remove GST Plan
document.getElementById('remove-gst-btn').addEventListener('click', () => {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (!operator || !operator.plans || operator.plans.length === 0) {
        showToast('No services to remove GST from', 'warning');
        return;
    }

    const initialLength = operator.plans.length;
    operator.plans = operator.plans.filter(p => p.type !== '18% GST' && p.type !== 'GST 18%');

    if (operator.plans.length < initialLength) {
        saveData();
        showToast('18% GST removed successfully');
    } else {
        showToast('No GST found to remove', 'warning');
    }
});

// Add Plan
document.getElementById('add-plan-btn').addEventListener('click', () => {
    document.getElementById('plan-form').reset();
    document.getElementById('plan-id').value = '';
    document.getElementById('plan-modal-title').textContent = 'Add Service Plan';
    openModal('plan-modal');
});

document.getElementById('plan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const planId = document.getElementById('plan-id').value;
    const category = document.getElementById('plan-category').value;
    const type = document.getElementById('plan-type').value.trim();
    const users = document.getElementById('plan-users').value;
    const rate = document.getElementById('plan-rate').value;

    const operator = operators.find(o => o.id === currentOperatorId);
    if (operator && type) {
        operator.plans = operator.plans || [];

        if (planId) {
            // Edit explicit plan
            const existingPlanIndex = operator.plans.findIndex(p => p.id === planId);
            if (existingPlanIndex >= 0) {
                operator.plans[existingPlanIndex].category = category;
                operator.plans[existingPlanIndex].type = type;
                operator.plans[existingPlanIndex].users = parseInt(users);
                operator.plans[existingPlanIndex].rate = parseFloat(rate);
                showToast('Service updated successfully');
            }
        } else {
            // Check if plan type + category combo already exists, if so update it, else add new
            const existingPlanIndex = operator.plans.findIndex(p =>
                p.type.toLowerCase() === type.toLowerCase() &&
                (p.category || 'Internet') === category
            );

            if (existingPlanIndex >= 0) {
                operator.plans[existingPlanIndex].users = parseInt(users);
                operator.plans[existingPlanIndex].rate = parseFloat(rate);
                showToast('Service updated successfully');
            } else {
                operator.plans.push({
                    id: generateId(),
                    category: category,
                    type: type,
                    users: parseInt(users),
                    rate: parseFloat(rate)
                });
                showToast('Service added successfully');
            }
        }

        saveData();
        closeModal('plan-modal');
    }
});

// BIND THESE TO WINDOW SINCE SCRIPT IS A MODULE
window.editPlan = function (planId) {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (operator && operator.plans) {
        const plan = operator.plans.find(p => p.id === planId);
        if (plan) {
            document.getElementById('plan-form').reset();
            document.getElementById('plan-id').value = plan.id;
            document.getElementById('plan-category').value = plan.category || 'Internet';
            document.getElementById('plan-type').value = plan.type;
            document.getElementById('plan-users').value = plan.users;
            document.getElementById('plan-rate').value = plan.rate;
            document.getElementById('plan-modal-title').textContent = 'Edit Service Plan';
            openModal('plan-modal');
        }
    }
};

window.deletePlan = function (planId) {
    confirmDelete('Delete Service', 'Are you sure you want to remove this service allocation?', () => {
        const operator = operators.find(o => o.id === currentOperatorId);
        if (operator) {
            operator.plans = operator.plans.filter(p => p.id !== planId);
            saveData();
            showToast('Service deleted');
        }
    });
};

// Add Payment
document.getElementById('add-payment-btn').addEventListener('click', () => {
    document.getElementById('payment-form').reset();
    document.getElementById('payment-date').valueAsDate = new Date(); // Default today
    openModal('payment-modal');
});

document.getElementById('payment-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('payment-type').value;
    const amount = document.getElementById('payment-amount').value;
    const date = document.getElementById('payment-date').value;
    const status = document.getElementById('payment-status').value;

    const operator = operators.find(o => o.id === currentOperatorId);
    if (operator) {
        operator.payments = operator.payments || [];
        operator.payments.push({
            id: generateId(),
            type,
            amount: parseFloat(amount),
            date,
            status
        });
        saveData();
        closeModal('payment-modal');
        showToast('Payment recorded successfully');
    }
});

window.deletePayment = function (paymentId) {
    confirmDelete('Delete Payment', 'Are you sure you want to delete this payment record?', () => {
        const operator = operators.find(o => o.id === currentOperatorId);
        if (operator) {
            operator.payments = operator.payments.filter(p => p.id !== paymentId);
            saveData();
            showToast('Payment record deleted');
        }
    });
};

window.togglePaymentStatus = function (paymentId) {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (operator) {
        const payment = operator.payments.find(p => p.id === paymentId);
        if (payment) {
            payment.status = payment.status === 'Paid' ? 'Unpaid' : 'Paid';
            saveData();
            showToast(`Status updated to ${payment.status}`);
        }
    }
};

// --- PRINT & PDF LOGIC ---

// Reusable function to trigger native printing behavior securely
function triggerPrint(htmlContent) {
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = htmlContent;

    // Mobile/Safari hack for print
    setTimeout(() => {
        window.scrollTo(0, 0);
        window.print();
        // Clear the print area with a much longer delay so the mobile print spooler can capture it fully.
        setTimeout(() => printArea.innerHTML = '', 3500);
    }, 800); // increased delay to 800ms for mobile rendering
}

document.getElementById('balance-receipt-btn').addEventListener('click', () => {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (!operator) return;

    const m = calculateOperatorMetrics(operator);
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const currentLogo = localStorage.getItem(LOGO_KEY);

    // Sort payments by date descending to find the last payment
    const sortedPayments = (operator.payments || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastPayment = sortedPayments.length > 0 ? sortedPayments[0] : null;

    const htmlContent = `
        <div style="font-family: 'Inter', sans-serif; color: #0f172a; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 3rem; border-radius: 12px; position: relative; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
            
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 2rem;">
                <div>
                    ${currentLogo ?
            `<img src="${currentLogo}" style="height: 60px; margin-bottom: 1rem; object-fit: contain;" />` :
            `<h1 style="color: #3b82f6; font-size: 24px; margin: 0 0 10px 0;">Hybrid Internet</h1>`
        }
                    <h2 style="margin: 0; font-size: 28px; color: #0f172a; font-weight: 700; letter-spacing: -0.5px;">BALANCE DUES RECEIPT</h2>
                </div>
                <div style="text-align: right; color: #64748b;">
                    <p style="margin: 0;">Date: <strong style="color: #0f172a;">${dateStr}</strong></p>
                    <p style="margin: 5px 0 0 0;">Receipt No: <strong style="color: #0f172a;">#BAL-${Math.floor(1000 + Math.random() * 9000)}</strong></p>
                </div>
            </div>
            
            <div style="margin-bottom: 2.5rem; background-color: #fef3c7; padding: 1.5rem; border-radius: 8px; border: 1px solid #fde68a;">
                <h3 style="margin: 0 0 10px 0; color: #b45309; text-transform: uppercase; font-size: 13px; font-weight: 600; letter-spacing: 1px;">Operator Details</h3>
                <p style="margin: 0; font-size: 20px; font-weight: 600; color: #92400e;">${operator.name}</p>
                ${lastPayment ? `<p style="margin: 10px 0 0 0; font-size: 14px; color: #b45309;">Last Payment Received: <strong style="color: #10b981;">${formatCurrency(lastPayment.amount)}</strong> on ${formatDate(lastPayment.date)}</p>` : ''}
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 2rem;">
                <thead>
                    <tr style="text-align: left;">
                        <th style="padding: 12px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 13px;">Description</th>
                        <th style="padding: 12px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 13px; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; font-weight: 500; font-size: 15px;">Total Payable Amount</td>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 500; font-size: 15px;">${formatCurrency(m.expectedRevenue)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; font-weight: 500; font-size: 15px;">Total Received Till Date</td>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 500; font-size: 15px; color: #10b981;">- ${formatCurrency(m.totalPaid)}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td style="padding: 20px 0 0 0; font-weight: 700; font-size: 18px; color: #0f172a;">Total Amount Remaining to Pay</td>
                        <td style="padding: 20px 0 0 0; font-weight: 700; font-size: 20px; text-align: right; color: ${m.outstanding > 0 ? '#ef4444' : '#10b981'};">${formatCurrency(Math.max(m.outstanding, 0))}</td>
                    </tr>
                </tfoot>
            </table>
            
            ${(m.outstanding > 0 && localStorage.getItem(UPI_KEY)) ? `
            <!-- Payment QR Section -->
            <div style="margin-top: 2rem; padding: 1.5rem; border: 2px dashed #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; background: #eff6ff;">
                <div>
                    <h4 style="margin: 0 0 5px 0; color: #1e3a8a; font-size: 16px;">Scan to Pay Outstanding Balance</h4>
                    <p style="margin: 0; color: #3b82f6; font-size: 13px; font-weight: 500;">Pay securely via any UPI app (GPay, PhonePe, Paytm)</p>
                    <p style="margin: 10px 0 0 0; font-size: 24px; font-weight: 700; color: #0f172a;">${formatCurrency(m.outstanding)}</p>
                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #64748b;">UPI ID: ${localStorage.getItem(UPI_KEY)}</p>
                </div>
                <div style="background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=upi://pay?pa=${encodeURIComponent(localStorage.getItem(UPI_KEY))}&pn=Hybrid%20Internet&am=${Math.max(m.outstanding, 0)}&cu=INR" alt="UPI QR Code" style="width: 120px; height: 120px; object-fit: contain;" />
                </div>
            </div>
            ` : ''}
            
            <div style="text-align: center; margin-top: 4rem; padding-top: 2rem; border-top: 1px dashed #cbd5e1; color: #64748b;">
                <p style="margin: 0; font-weight: 500;">Please verify this receipt for future reference.</p>
                <p style="margin: 5px 0 0 0; font-size: 13px;">This is a computer-generated receipt.</p>
            </div>
        </div>
    `;

    triggerPrint(htmlContent);
});

// 1. Generation Logic for "No Dues" Receipt (Available always but custom message based on balance)
document.getElementById('receipt-btn').addEventListener('click', () => {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (!operator) return;

    const m = calculateOperatorMetrics(operator);
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const currentLogo = localStorage.getItem(LOGO_KEY);

    let docStatusText = "NO DUES RECEIPT";
    let iconClass = "fa-circle-check";
    let iconColor = "#10b981"; // Success Green
    let statusMsg = "All outstanding dues are successfully cleared.";

    // If outstanding balance is active switch context
    if (m.outstanding > 0) {
        docStatusText = "PAYMENT RECEIPT / INVOICE";
        iconClass = "fa-circle-exclamation";
        iconColor = "#f59e0b"; // Warning Orange
        statusMsg = `Note: Final outstanding balance of ${formatCurrency(m.outstanding)} is pending.`;
    }

    const htmlContent = `
        <div style="font-family: 'Inter', sans-serif; color: #0f172a; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 3rem; border-radius: 12px; position: relative; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
            
            <div style="position: absolute; top: 50%; left: 50%; width: 400px; height: 400px; transform: translate(-50%, -50%); opacity: 0.03; pointer-events: none; z-index: -1;">
                <i class="fa-solid fa-file-invoice" style="font-size: 400px; color: #3b82f6;"></i>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 2rem;">
                <div>
                    ${currentLogo ?
            `<img src="${currentLogo}" style="height: 60px; margin-bottom: 1rem; object-fit: contain;" />` :
            `<h1 style="color: #3b82f6; font-size: 24px; margin: 0 0 10px 0;">Hybrid Internet</h1>`
        }
                    <h2 style="margin: 0; font-size: 28px; color: #0f172a; font-weight: 700; letter-spacing: -0.5px;">${docStatusText}</h2>
                </div>
                <div style="text-align: right; color: #64748b;">
                    <p style="margin: 0;">Date: <strong style="color: #0f172a;">${dateStr}</strong></p>
                    <p style="margin: 5px 0 0 0;">Receipt No: <strong style="color: #0f172a;">#${Math.floor(100000 + Math.random() * 900000)}</strong></p>
                </div>
            </div>
            
            <div style="margin-bottom: 2.5rem; background-color: #f8fafc; padding: 1.5rem; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #64748b; text-transform: uppercase; font-size: 13px; font-weight: 600; letter-spacing: 1px;">Operator Details</h3>
                <p style="margin: 0; font-size: 20px; font-weight: 600; color: #0f172a;">${operator.name}</p>
                <div style="margin-top: 15px; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid ${iconClass}" style="color: ${iconColor}; font-size: 18px;"></i>
                    <p style="margin: 0; color: ${iconColor}; font-weight: 500;">${statusMsg}</p>
                </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 2rem;">
                <thead>
                    <tr style="text-align: left;">
                        <th style="padding: 12px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 13px;">Description</th>
                        <th style="padding: 12px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 13px; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; font-weight: 500; font-size: 15px;">Total Expected Revenue</td>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 500; font-size: 15px;">${formatCurrency(m.expectedRevenue)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; font-weight: 500; font-size: 15px;">Total Amount Paid</td>
                        <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 500; font-size: 15px; color: #10b981;">${formatCurrency(m.totalPaid)}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td style="padding: 20px 0 0 0; font-weight: 700; font-size: 18px; color: #0f172a;">Final Outstanding Balance</td>
                        <td style="padding: 20px 0 0 0; font-weight: 700; font-size: 20px; text-align: right; color: ${m.outstanding <= 0 ? '#10b981' : '#ef4444'};">${formatCurrency(Math.max(m.outstanding, 0))}</td>
                    </tr>
                </tfoot>
            </table>
            
            ${(m.outstanding > 0 && localStorage.getItem(UPI_KEY)) ? `
            <!-- Payment QR Section -->
            <div style="margin-top: 2rem; padding: 1.5rem; border: 2px dashed #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; background: #eff6ff;">
                <div>
                    <h4 style="margin: 0 0 5px 0; color: #1e3a8a; font-size: 16px;">Scan to Pay Outstanding Balance</h4>
                    <p style="margin: 0; color: #3b82f6; font-size: 13px; font-weight: 500;">Pay securely via any UPI app (GPay, PhonePe, Paytm)</p>
                    <p style="margin: 10px 0 0 0; font-size: 24px; font-weight: 700; color: #0f172a;">${formatCurrency(m.outstanding)}</p>
                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #64748b;">UPI ID: ${localStorage.getItem(UPI_KEY)}</p>
                </div>
                <div style="background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=upi://pay?pa=${encodeURIComponent(localStorage.getItem(UPI_KEY))}&pn=Hybrid%20Internet&am=${Math.max(m.outstanding, 0)}&cu=INR" alt="UPI QR Code" style="width: 120px; height: 120px; object-fit: contain;" />
                </div>
            </div>
            ` : ''}
            
            <div style="text-align: center; margin-top: 4rem; padding-top: 2rem; border-top: 1px dashed #cbd5e1; color: #64748b;">
                <p style="margin: 0; font-weight: 500;">Thank you for your continuous business partnership.</p>
                <p style="margin: 5px 0 0 0; font-size: 13px;">This is a computer-generated receipt. No physical signature is required.</p>
            </div>
        </div>
    `;

    triggerPrint(htmlContent);
});

// 2. Generation Logic for Comprehensive Report PDF
document.getElementById('report-btn').addEventListener('click', () => {
    openModal('report-modal');
});

document.getElementById('report-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const applyGst = document.getElementById('report-gst').checked;
    closeModal('report-modal');
    generateReportPdf(applyGst);
});

function generateReportPdf(applyGst) {
    const operator = operators.find(o => o.id === currentOperatorId);
    if (!operator) return;

    let m = calculateOperatorMetrics(operator);

    // Adjust metrics for report if GST is applied
    let displayExpected = m.expectedRevenue;
    let gstAmount = 0;

    if (applyGst) {
        gstAmount = m.expectedRevenue * 0.18;
        displayExpected = m.expectedRevenue + gstAmount;
    }

    const displayOutstanding = displayExpected - m.totalPaid;

    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const currentLogo = localStorage.getItem(LOGO_KEY);

    // Build Plans List - Remove GST from per plan output
    let plansHtml = '';
    if (operator.plans && operator.plans.length > 0) {
        plansHtml = operator.plans.map(p => `
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px;">
                    <span style="font-size: 11px; padding: 2px 6px; background: #e2e8f0; border-radius: 4px; margin-right: 6px;">${p.category || 'Internet'}</span>
                    <strong>${p.type}</strong>
                </td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px;">${p.users}</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px;">${formatCurrency(p.rate)}</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 600; font-size: 14px;">${formatCurrency(p.users * p.rate)}</td>
            </tr>
        `).join('');
    } else {
        plansHtml = `<tr><td colspan="4" style="padding: 10px 0; color: #94a3b8; font-size: 14px;">No services active.</td></tr>`;
    }

    // Add explicit GST row to Plans table if GST is checked
    if (applyGst && m.expectedRevenue > 0) {
        plansHtml += `
            <tr>
                <td colspan="3" style="padding: 10px 0; border-top: 2px solid #e2e8f0; font-size: 14px; text-align: right; font-weight: 600; color: #64748b;">Subtotal:</td>
                <td style="padding: 10px 0; border-top: 2px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 14px;">${formatCurrency(m.expectedRevenue)}</td>
            </tr>
            <tr>
                <td colspan="3" style="padding: 10px 0; font-size: 14px; text-align: right; font-weight: 600; color: #3b82f6;">+ 18% GST:</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; font-size: 14px; color: #3b82f6;">${formatCurrency(gstAmount)}</td>
            </tr>
            <tr>
                <td colspan="3" style="padding: 10px 0; font-size: 15px; text-align: right; font-weight: 700; color: #0f172a;">Grand Total:</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 700; font-size: 15px; color: #0f172a;">${formatCurrency(displayExpected)}</td>
            </tr>
        `;
    }

    // Build Payments List (Descending)
    let paymentsHtml = '';
    const sortedPayments = (operator.payments || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sortedPayments.length > 0) {
        paymentsHtml = sortedPayments.map(p => `
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px;">${formatDate(p.date)}</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px;">${p.type}</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: ${p.status === 'Paid' ? '#10b981' : '#ef4444'}; font-weight: 600;">${p.status}</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 600; font-size: 14px;">${formatCurrency(p.amount)}</td>
            </tr>
        `).join('');
    } else {
        paymentsHtml = `<tr><td colspan="4" style="padding: 10px 0; color: #94a3b8; font-size: 14px;">No payment records found.</td></tr>`;
    }

    const htmlContent = `
        <div style="font-family: 'Inter', sans-serif; color: #0f172a; max-width: 800px; margin: 0 auto; padding: 2rem; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
            
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #3b82f6; padding-bottom: 1rem; margin-bottom: 2rem;">
                <div>
                    ${currentLogo ?
            `<img src="${currentLogo}" style="height: 50px; object-fit: contain;" />` :
            `<h1 style="color: #3b82f6; font-size: 20px; margin: 0;">Hybrid Internet</h1>`
        }
                    <div style="margin-top: 10px; font-size: 11px; color: #64748b; line-height: 1.4;">
                        <strong>GSTIN:</strong> 15AADCH9392N1ZX<br>
                        <strong>Address:</strong> Indore, MP<br>
                        <strong>Contact:</strong> 8959334650, 9516688921<br>
                        <strong>Web:</strong> www.hybridinternet.co
                    </div>
                </div>
                <div style="text-align: right;">
                    <h2 style="margin: 0; font-size: 24px; color: #3b82f6;">TAX INVOICE / REPORT</h2>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Invoice No: <strong>#INV-${Math.floor(1000 + Math.random() * 9000)}-${new Date().getFullYear()}</strong></p>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Generated: ${dateStr}</p>
                </div>
            </div>
            
            <div style="display: flex; gap: 2rem; margin-bottom: 2rem;">
                <!-- Profile Block -->
                <div style="flex: 1; background-color: #f8fafc; padding: 1.5rem; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 1px;">Operator Account</p>
                    <h3 style="margin: 5px 0 0 0; font-size: 20px;">${operator.name}</h3>
                    <p style="margin: 5px 0 0 0; font-size: 13px; color: #64748b;">Total User Bases: <strong>${m.totalUsers}</strong> active connections.</p>
                </div>
                <!-- Summary Stats -->
                <div style="flex: 1.5; display: flex; gap: 1rem;">
                    <div style="flex: 1; text-align: center; background: #fff; border: 1px solid #e2e8f0; padding: 1rem; border-radius: 8px;">
                        <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Expected</p>
                        <h4 style="margin: 5px 0 0 0; font-size: 17px; color: #0f172a;">${formatCurrency(displayExpected)}</h4>
                    </div>
                    <div style="flex: 1; text-align: center; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 1rem; border-radius: 8px;">
                        <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #059669; font-weight: 600;">Total Paid</p>
                        <h4 style="margin: 5px 0 0 0; font-size: 17px; color: #059669;">${formatCurrency(m.totalPaid)}</h4>
                    </div>
                    <div style="flex: 1; text-align: center; background: ${displayOutstanding > 0 ? '#fef2f2' : '#f8fafc'}; border: 1px solid ${displayOutstanding > 0 ? '#fecaca' : '#e2e8f0'}; padding: 1rem; border-radius: 8px;">
                        <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: ${displayOutstanding > 0 ? '#dc2626' : '#64748b'}; font-weight: 600;">Outstanding</p>
                        <h4 style="margin: 5px 0 0 0; font-size: 17px; color: ${displayOutstanding > 0 ? '#dc2626' : '#0f172a'};">${formatCurrency(Math.max(displayOutstanding, 0))}</h4>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 2.5rem;">
                <h4 style="border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; color: #0f172a; font-size: 16px;">Active Service Breakdown</h4>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="text-align: left;">
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase;">Service/Pack</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase;">Users</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase;">Rate</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase; text-align: right;">Gross Net</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${plansHtml}
                    </tbody>
                </table>
            </div>

            <div>
                <h4 style="border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; color: #0f172a; font-size: 16px;">Detailed Payment Ledger</h4>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="text-align: left;">
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase;">Date</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase;">Payment Type</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase;">Status</th>
                            <th style="padding: 10px 0; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px; text-transform: uppercase; text-align: right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${paymentsHtml}
                    </tbody>
                </table>
            </div>
            
            ${(displayOutstanding > 0 && localStorage.getItem(UPI_KEY)) ? `
            <!-- Payment QR Section -->
            <div style="margin-top: 2rem; padding: 1.5rem; border: 2px dashed #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; background: #eff6ff;">
                <div>
                    <h4 style="margin: 0 0 5px 0; color: #1e3a8a; font-size: 16px;">Scan to Pay Outstanding Balance</h4>
                    <p style="margin: 0; color: #3b82f6; font-size: 13px; font-weight: 500;">Pay securely via any UPI app (GPay, PhonePe, Paytm)</p>
                    <p style="margin: 10px 0 0 0; font-size: 24px; font-weight: 700; color: #0f172a;">${formatCurrency(displayOutstanding)}</p>
                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #64748b;">UPI ID: ${localStorage.getItem(UPI_KEY)}</p>
                </div>
                <div style="background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=upi://pay?pa=${encodeURIComponent(localStorage.getItem(UPI_KEY))}&pn=Hybrid%20Internet&am=${Math.max(displayOutstanding, 0)}&cu=INR" alt="UPI QR Code" style="width: 120px; height: 120px; object-fit: contain;" />
                </div>
            </div>
            ` : ''}

        </div>
    `;

    triggerPrint(htmlContent);
}

// Export Logic
document.getElementById('export-btn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(operators));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `hybrid-operators-backup-${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
    showToast('Data exported successfully');
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    renderDashboard();
});
