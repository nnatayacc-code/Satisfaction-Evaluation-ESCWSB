/**
 * Main Application Logic for Satisfaction Evaluation & Dashboard
 * Eastern Sugar and Cane Public Company Limited
 */

// Global App State
const AppState = {
    currentTab: 'portal',
    currentEmployeeId: '',
    evaluatorType: 'employee', // 'employee' or 'contractor'
    selectedContractor: null,
    pendingEvaluationTab: null,
    evaluations: [],
    charts: {
        radar: null,
        commBar: null,
        distribution: null,
        empCompare: null,
        deptCompare: null
    },
    isAdminUnlocked: sessionStorage.getItem('admin_insights_unlocked') === 'true',
    filter: {
        formType: 'ALL',
        department: 'ALL',
        userType: 'ALL', // 'ALL', 'employee', 'contractor'
        startDate: '',
        endDate: '',
        search: ''
    }
};

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    if (typeof initFirebase === 'function') {
        initFirebase();
    }
    loadEvaluations();
    renderDepartmentOptions();
    renderContractorOptions();
    renderForm1Questions();
    renderForm2Questions();
    setupNavigation();
    setupEventListeners();
    setDefaultDates();

    // Production mode: Do not auto-generate demo data, start clean for real evaluations

    updateDashboardMetrics();
    renderDashboardCharts();
    updateAdminInsightsVisibility();
    updateCounterBadges();

    // Check URL parameters for direct form / tab navigation from QR code
    handleUrlParams();

    // Dynamically detect cloud URL (Firebase / Host / Tunnel)
    checkTunnelUrl();
}

async function checkTunnelUrl() {
    // If running on Firebase Hosting or custom cloud domain, use current origin
    if (window.location && window.location.origin && !window.location.origin.includes('localhost') && !window.location.origin.includes('127.0.0.1')) {
        QR_CONFIG.cloudHost = window.location.origin;
        return;
    }

    try {
        const res = await fetch('/api/tunnel');
        if (res.ok) {
            const data = await res.json();
            if (data.tunnelUrl) {
                QR_CONFIG.cloudHost = data.tunnelUrl;
            }
        }
    } catch (e) {}
}

// Helper to merge evaluations into AppState and update charts
function mergeEvaluationsList(serverList) {
    if (!Array.isArray(serverList)) return;
    const cleaned = serverList.filter(x => !(x.id && x.id.toString().startsWith('DEMO-')));
    const map = new Map();
    cleaned.forEach(item => { if (item.id) map.set(item.id, item); });
    AppState.evaluations.forEach(item => { if (item.id && !map.has(item.id)) map.set(item.id, item); });
    AppState.evaluations = Array.from(map.values()).sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(AppState.evaluations));
    updateDashboardMetrics();
    renderDashboardCharts();
    updateAdminInsightsVisibility();
    updateCounterBadges();
}

// Load evaluations from LocalStorage and Cloud Firestore / Server
function loadEvaluations() {
    try {
        const raw = localStorage.getItem(APP_CONFIG.storageKey);
        let list = raw ? JSON.parse(raw) : [];

        // Purge any demo data so real production evaluations start completely clean
        list = list.filter(x => !(x.id && x.id.toString().startsWith('DEMO-')));
        AppState.evaluations = list;
        localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(AppState.evaluations));
    } catch (e) {
        console.error("Error reading from localStorage:", e);
        AppState.evaluations = [];
    }

    // Sync with Cloud Firestore / Server Storage API
    fetchServerEvaluations();
}

// Fetch consolidated evaluations from Cloud Firestore or Local Server API (data/evaluations.json)
async function fetchServerEvaluations() {
    // 1. Try Cloud Firestore first
    if (typeof isFirebaseReady !== 'undefined' && isFirebaseReady && typeof fetchEvaluationsFromCloud === 'function') {
        try {
            const cloudList = await fetchEvaluationsFromCloud();
            if (Array.isArray(cloudList) && cloudList.length > 0) {
                mergeEvaluationsList(cloudList);
                console.log(`Loaded ${cloudList.length} evaluations from Cloud Firestore`);
                return;
            }
        } catch (e) {
            console.warn("Cloud Firestore fetch error, checking local fallback:", e);
        }
    }

    // 2. Fallback to Local Server API (data/evaluations.json) if running
    try {
        const res = await fetch('/api/evaluations');
        if (res.ok) {
            const serverList = await res.json();
            mergeEvaluationsList(serverList);
        }
    } catch (e) {
        // Offline or static file mode
    }
}

// Save evaluations to LocalStorage
function saveEvaluations() {
    try {
        localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(AppState.evaluations));
        updateCounterBadges();
    } catch (e) {
        console.error("Error saving to localStorage:", e);
        alert("ไม่สามารถบันทึกข้อมูลได้ เนื่องจากพื้นที่จัดเก็บไม่เพียงพอ");
    }
}

// Sync single submitted evaluation to Cloud Firestore and Server API
async function syncEvaluationToServer(evaluation) {
    if (!evaluation) return;

    // 1. Sync to Cloud Firestore if ready
    if (typeof isFirebaseReady !== 'undefined' && isFirebaseReady && typeof saveEvaluationToCloud === 'function') {
        try {
            const cloudSaved = await saveEvaluationToCloud(evaluation);
            if (cloudSaved) {
                console.log("Evaluation successfully synced to Cloud Firestore (24/7 Online)");
            }
        } catch (err) {
            console.warn("Cloud Firestore sync failed, checking local API:", err);
        }
    }

    // 2. Also sync to Local File Server if running
    try {
        const res = await fetch('/api/evaluations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(evaluation)
        });
        if (res.ok) {
            console.log("Evaluation successfully synced to Local File Storage (data/evaluations.json)");
        }
    } catch (err) {
        // Local server not running or static mode
    }
}

// Helper to determine if an evaluation record belongs to a contractor (Sup)
function isContractorEvaluation(item) {
    if (!item) return false;
    if (item.evaluatorType === 'contractor') return true;
    if (item.evaluatorType === 'employee') return false;

    // Check employeeId or sheet
    const empId = (item.employeeId || '').toString().trim();
    if (empId === 'ผู้รับเหมา' || empId.toUpperCase().startsWith('SUP')) return true;

    // Check department / group
    const dept = (item.department || '').toString();
    if (dept.includes('ผู้รับเหมา') || dept.includes('ผรม.') || dept.includes('บริการภายนอก')) return true;

    // Check evaluatorName
    const name = (item.evaluatorName || '').toString();
    if (name.includes('ผู้รับเหมา') || name.includes('ผรม.')) return true;

    // Cross-check with EMPLOYEE_DATABASE if available
    if (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE)) {
        const found = EMPLOYEE_DATABASE.find(e => 
            (e.id && e.id.toString() === empId) || 
            (e.fullName && name.includes(e.fullName))
        );
        if (found && (found.sheet === 'Sup' || found.sheet === 'sup')) return true;
    }
    return false;
}

// Get metadata (badge styling, labels, icons) for evaluator type
function getEvaluatorTypeInfo(item) {
    const isContractor = isContractorEvaluation(item);
    return isContractor ? {
        type: 'contractor',
        label: 'ผู้รับเหมา (Sup)',
        shortLabel: 'ผู้รับเหมา',
        badgeClass: 'bg-amber-100 text-amber-800 border border-amber-200',
        badgeColor: '#d97706',
        icon: '👷'
    } : {
        type: 'employee',
        label: 'พนักงาน (WSB)',
        shortLabel: 'พนักงาน',
        badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
        badgeColor: '#059669',
        icon: '🏢'
    };
}

// Navigation between tabs
function setupNavigation() {
    const navButtons = document.querySelectorAll('[data-target-tab]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-target-tab');
            switchTab(target);
        });
    });
}

function switchTab(tabId, bypassEmpModal = false) {
    // Intercept navigation to evaluations if modal not yet completed
    if ((tabId === 'form1' || tabId === 'form2') && !bypassEmpModal) {
        openEmpIdModal(tabId);
        return;
    }

    AppState.currentTab = tabId;

    // Toggle active view
    const views = ['portal', 'form1', 'form2', 'dashboard'];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) {
            if (v === tabId) {
                el.classList.remove('hidden');
                el.classList.add('fade-in');
            } else {
                el.classList.add('hidden');
                el.classList.remove('fade-in');
            }
        }
    });

    // Ensure evaluation forms render correct evaluator controls (Contractor vs Employee)
    if (tabId === 'form1') {
        applyEvaluatorTypeToForm(1, AppState.evaluatorType || 'employee');
    } else if (tabId === 'form2') {
        applyEvaluatorTypeToForm(2, AppState.evaluatorType || 'employee');
    }

    // Update active nav button styles
    document.querySelectorAll('[data-target-tab]').forEach(btn => {
        const target = btn.getAttribute('data-target-tab');
        if (target === tabId) {
            btn.classList.add('nav-active');
            btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
        } else {
            btn.classList.remove('nav-active');
            btn.classList.add('text-slate-600', 'hover:bg-slate-100');
        }
    });

    // If switched to dashboard, refresh charts
    if (tabId === 'dashboard') {
        setTimeout(() => {
            renderDashboardCharts();
            updateAdminInsightsVisibility();
        }, 50);
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Open Employee ID Modal before entering evaluation
// Open Employee ID Modal before entering evaluation
function openEmpIdModal(targetTab) {
    AppState.pendingEvaluationTab = targetTab || 'form1';
    const modal = document.getElementById('emp-id-modal');
    const badge = document.getElementById('emp-modal-badge');
    const errorEl = document.getElementById('emp-id-error');

    if (errorEl) errorEl.classList.add('hidden');

    // Ensure contractor options are rendered
    renderContractorOptions();

    // Default to 'employee' view
    setEvaluatorType(AppState.evaluatorType || 'employee');

    if (badge) {
        if (targetTab === 'form1') {
            badge.className = 'inline-block px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-2';
            badge.innerHTML = '🛡️ แบบสอบถาม: Food Safety Culture (FM-MR12-MR-01)';
        } else if (targetTab === 'form2') {
            badge.className = 'inline-block px-3 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200 mb-2';
            badge.innerHTML = '📢 แบบประเมิน: การสื่อสารและประชาสัมพันธ์ (FM-MR14-MR-04)';
        } else {
            badge.className = 'inline-block px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 mb-2';
            badge.textContent = 'แบบประเมิน';
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
    }
}

// Switch between Employee (6-digit ID) and Contractor (Dropdown) in Modal
function setEvaluatorType(type) {
    AppState.evaluatorType = type;
    const btnEmp = document.getElementById('tab-btn-emp');
    const btnSup = document.getElementById('tab-btn-sup');
    const cEmp = document.getElementById('container-emp-input');
    const cSup = document.getElementById('container-sup-select');
    const input = document.getElementById('input-emp-id');
    const selSup = document.getElementById('select-sup-name');
    const errorEl = document.getElementById('emp-id-error');

    if (errorEl) errorEl.classList.add('hidden');

    if (type === 'employee') {
        if (btnEmp) {
            btnEmp.className = 'py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-xs bg-white text-emerald-800 border border-emerald-200';
        }
        if (btnSup) {
            btnSup.className = 'py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition text-slate-600 hover:text-slate-900';
        }
        if (cEmp) cEmp.classList.remove('hidden');
        if (cSup) cSup.classList.add('hidden');

        if (input) {
            input.value = AppState.currentEmployeeId && AppState.currentEmployeeId !== 'ผู้รับเหมา' ? AppState.currentEmployeeId : '';
            setTimeout(() => {
                input.focus();
            }, 80);
        }
    } else {
        // Contractor (ผู้รับเหมา)
        if (btnSup) {
            btnSup.className = 'py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-xs bg-white text-emerald-800 border border-emerald-200';
        }
        if (btnEmp) {
            btnEmp.className = 'py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition text-slate-600 hover:text-slate-900';
        }
        if (cEmp) cEmp.classList.add('hidden');
        if (cSup) cSup.classList.remove('hidden');

        if (selSup) {
            if (AppState.selectedContractor) {
                selSup.value = AppState.selectedContractor.fullName;
            }
            setTimeout(() => selSup.focus(), 80);
        }
    }
}

// Render Contractor Dropdown Options from EMPLOYEE_DATABASE
function renderContractorOptions(filterDept = '') {
    const sel = document.getElementById('select-sup-name');
    if (!sel) return;

    sel.innerHTML = '<option value="">-- กรุณาเลือกรายชื่อผู้รับเหมา --</option>';

    if (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE)) {
        let contractors = EMPLOYEE_DATABASE.filter(e => e.sheet === 'Sup' || e.sheet === 'sup');
        if (filterDept) {
            contractors = contractors.filter(c => c.dept === filterDept);
        }
        
        contractors.forEach((c, idx) => {
            const opt = document.createElement('option');
            opt.value = c.fullName;
            opt.textContent = `${c.fullName} (${c.dept || 'ผู้รับเหมา'})`;
            opt.dataset.index = idx;
            sel.appendChild(opt);
        });
    }
}

// Handler when contractor department is selected in modal
function onModalSupDeptChange(deptVal) {
    const errEl = document.getElementById('emp-id-error');
    if (errEl) errEl.classList.add('hidden');
    renderContractorOptions(deptVal);
    const sel = document.getElementById('select-sup-name');
    if (sel) sel.value = '';
    AppState.selectedContractor = null;
}

// Handler when contractor name is selected in dropdown
function onModalSupSelect(fullName) {
    const errEl = document.getElementById('emp-id-error');
    if (errEl) errEl.classList.add('hidden');

    if (!fullName) {
        AppState.selectedContractor = null;
        return;
    }

    const deptSelect = document.getElementById('select-sup-dept');
    const deptVal = deptSelect ? deptSelect.value : '';

    const contractor = EMPLOYEE_DATABASE.find(e => (e.sheet === 'Sup' || e.sheet === 'sup') && e.fullName === fullName);
    if (contractor) {
        AppState.selectedContractor = contractor;
        // If department was not yet chosen, sync it
        if (!deptVal && contractor.dept && deptSelect) {
            deptSelect.value = contractor.dept;
        }
    } else {
        AppState.selectedContractor = { fullName: fullName, dept: deptVal || 'ผรม. ทำความสะอาด', sheet: 'Sup' };
    }
}

// Close Employee ID Modal
function closeEmpIdModal() {
    const modal = document.getElementById('emp-id-modal');
    if (modal) modal.classList.add('hidden');
    AppState.pendingEvaluationTab = null;
    const errorEl = document.getElementById('emp-id-error');
    if (errorEl) errorEl.classList.add('hidden');
}

// -------------------------------------------------------------------------
// Duplicate Evaluation Detection & Modal Handling (ไม่ให้ผู้ประเมินทำซ้ำ)
// -------------------------------------------------------------------------
let duplicateAttemptOtherForm = null;

/**
 * Check if evaluator has already submitted an evaluation for this form
 * @param {string} formType - 'form1' | 'form2' | 'FM-MR12-MR-01' | 'FM-MR14-MR-04'
 * @param {string} identifier - employee ID (e.g. '455636') or contractor full name (e.g. 'อรทัย สันธนะวัธนะ')
 * @param {string} evaluatorType - 'employee' | 'contractor'
 * @returns {Object|null}
 */
function findExistingEvaluation(formType, identifier, evaluatorType = 'employee') {
    if (!Array.isArray(AppState.evaluations) || AppState.evaluations.length === 0) return null;
    if (!identifier) return null;

    const formCode = (formType === 'form1' || formType === 'FM-MR12-MR-01') ? 'FM-MR12-MR-01' : 'FM-MR14-MR-04';
    const cleanId = identifier.toString().trim().toLowerCase();

    return AppState.evaluations.find(item => {
        if (item.formType !== formCode) return false;

        if (evaluatorType === 'contractor') {
            const itemEvalName = (item.evaluatorName || '').toLowerCase();
            const itemFullName = (item.fullName || '').toLowerCase();
            return itemEvalName.includes(cleanId) || (itemFullName && itemFullName.includes(cleanId));
        } else {
            const itemEmpId = (item.employeeId || '').toString().trim().toLowerCase();
            if (itemEmpId === cleanId) return true;
            const digits1 = cleanId.replace(/\D/g, '');
            const digits2 = itemEmpId.replace(/\D/g, '');
            if (digits1 && digits2 && digits1 === digits2) return true;
            return false;
        }
    }) || null;
}

function showDuplicateModal(existingEval, attemptedTab) {
    const modal = document.getElementById('emp-duplicate-modal');
    if (!modal) {
        alert(`ท่านได้ทำแบบประเมินนี้แล้วเมื่อวันที่ ${existingEval.date || existingEval.timestamp} (ระบบไม่อนุญาตให้ทำซ้ำ)`);
        return;
    }

    const titleEl = document.getElementById('dup-modal-form-title');
    const nameEl = document.getElementById('dup-modal-emp-name');
    const dateEl = document.getElementById('dup-modal-date');
    const btnOther = document.getElementById('btn-dup-switch-other-form');

    const isForm1 = (attemptedTab === 'form1' || existingEval.formType === 'FM-MR12-MR-01');
    duplicateAttemptOtherForm = isForm1 ? 'form2' : 'form1';

    if (titleEl) {
        titleEl.textContent = isForm1 ? 'Food Safety Culture' : 'การสื่อสารและประชาสัมพันธ์';
    }
    if (nameEl) {
        nameEl.textContent = existingEval.evaluatorName || existingEval.employeeId || '-';
    }
    if (dateEl) {
        dateEl.textContent = existingEval.date || (existingEval.timestamp ? existingEval.timestamp.split('T')[0] : '-');
    }
    if (btnOther) {
        btnOther.innerHTML = isForm1 ? '<span>📢 ทำแบบประเมินการสื่อสารฯ</span>' : '<span>🥗 ทำแบบประเมิน Food Safety</span>';
    }

    // Hide other open modals
    const modalEmpId = document.getElementById('emp-id-modal');
    if (modalEmpId) modalEmpId.classList.add('hidden');
    const modalNewEmp = document.getElementById('new-emp-modal');
    if (modalNewEmp) modalNewEmp.classList.add('hidden');
    const modalNotFound = document.getElementById('emp-not-found-modal');
    if (modalNotFound) modalNotFound.classList.add('hidden');

    modal.classList.remove('hidden');
}

function closeDuplicateModal() {
    const modal = document.getElementById('emp-duplicate-modal');
    if (modal) modal.classList.add('hidden');
}

function handleDuplicateGoOtherForm() {
    closeDuplicateModal();
    if (duplicateAttemptOtherForm) {
        openEmpIdModal(duplicateAttemptOtherForm);
    }
}

// Open "Employee Not Found" Alert Modal
function openEmpNotFoundModal() {
    const modal = document.getElementById('emp-not-found-modal');
    if (modal) modal.classList.remove('hidden');
}

// Close "Employee Not Found" Alert Modal & Refocus input
function closeEmpNotFoundModal() {
    const modal = document.getElementById('emp-not-found-modal');
    if (modal) modal.classList.add('hidden');
    
    // Focus and select the input to let user enter correct ID immediately
    const input = document.getElementById('input-emp-id');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 60);
    }
}

// Open "New Employee Entry" Modal
function openNewEmployeeModal() {
    const modalNotFound = document.getElementById('emp-not-found-modal');
    if (modalNotFound) modalNotFound.classList.add('hidden');

    const modalEmpId = document.getElementById('emp-id-modal');
    if (modalEmpId) modalEmpId.classList.add('hidden');

    const newEmpModal = document.getElementById('new-emp-modal');
    if (newEmpModal) {
        newEmpModal.classList.remove('hidden');
        
        // Sync evaluator type tab with current selection
        setNewEvaluatorType(AppState.evaluatorType || 'employee');

        // Pre-fill employee ID if user previously typed one
        const inputOld = document.getElementById('input-emp-id');
        const inputNewId = document.getElementById('new-emp-id');
        const inputNewName = document.getElementById('new-emp-name');
        
        if (inputOld && inputNewId && inputOld.value && AppState.evaluatorType !== 'contractor') {
            inputNewId.value = inputOld.value.trim();
        }

        setTimeout(() => {
            if (AppState.evaluatorType === 'contractor') {
                if (inputNewName) inputNewName.focus();
            } else if (inputNewId && !inputNewId.value) {
                inputNewId.focus();
            } else if (inputNewName) {
                inputNewName.focus();
            }
        }, 80);
    }
}

// Close "New Employee Entry" Modal
function closeNewEmployeeModal() {
    const modal = document.getElementById('new-emp-modal');
    if (modal) modal.classList.add('hidden');
    const err = document.getElementById('new-emp-error');
    if (err) err.classList.add('hidden');
}

// Current Evaluator Type in New Entry Modal
let currentNewEvaluatorType = 'employee';

// Switch between Employee and Contractor in New Entry Modal
function setNewEvaluatorType(type) {
    currentNewEvaluatorType = type;
    const btnEmp = document.getElementById('new-emp-tab-emp');
    const btnSup = document.getElementById('new-emp-tab-sup');
    const idContainer = document.getElementById('new-emp-id-container');
    const idInput = document.getElementById('new-emp-id');
    const titleEl = document.getElementById('new-emp-modal-title');
    const subtitleEl = document.getElementById('new-emp-modal-subtitle');
    const deptSelect = document.getElementById('new-emp-dept');
    const errEl = document.getElementById('new-emp-error');

    if (errEl) errEl.classList.add('hidden');

    if (type === 'contractor') {
        if (btnSup) {
            btnSup.className = 'py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-xs bg-white text-emerald-800 border border-emerald-200 cursor-pointer';
        }
        if (btnEmp) {
            btnEmp.className = 'py-2 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition text-slate-600 hover:text-slate-900 cursor-pointer';
        }
        if (idContainer) idContainer.classList.add('hidden');
        if (idInput) {
            idInput.required = false;
            idInput.value = 'ผู้รับเหมา';
        }
        if (titleEl) titleEl.textContent = 'กรอกข้อมูลผู้รับเหมา';
        if (subtitleEl) subtitleEl.textContent = 'สำหรับผู้รับเหมาที่ต้องการกรอกข้อมูลเพื่อทำแบบประเมิน';

        // Populate department dropdown with ONLY the 2 contractor departments
        populateDepartmentSelect(deptSelect, 'contractor');
    } else {
        // Employee
        if (btnEmp) {
            btnEmp.className = 'py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-xs bg-white text-emerald-800 border border-emerald-200 cursor-pointer';
        }
        if (btnSup) {
            btnSup.className = 'py-2 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition text-slate-600 hover:text-slate-900 cursor-pointer';
        }
        if (idContainer) idContainer.classList.remove('hidden');
        if (idInput) {
            idInput.required = true;
            if (idInput.value === 'ผู้รับเหมา') idInput.value = '';
        }
        if (titleEl) titleEl.textContent = 'กรอกข้อมูลพนักงานใหม่';
        if (subtitleEl) subtitleEl.textContent = 'สำหรับพนักงานเข้าใหม่ที่ยังไม่มีข้อมูลในระบบไฟล์';

        // Populate department dropdown with ONLY employee departments
        populateDepartmentSelect(deptSelect, 'employee');
    }
}

// Handle New Employee / Contractor Submission
function handleNewEmployeeSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const idInput = document.getElementById('new-emp-id');
    const nameInput = document.getElementById('new-emp-name');
    const deptSelect = document.getElementById('new-emp-dept');
    const divInput = document.getElementById('new-emp-division');
    const errEl = document.getElementById('new-emp-error');

    const isContractor = currentNewEvaluatorType === 'contractor';
    const idVal = isContractor ? 'ผู้รับเหมา' : (idInput ? idInput.value.trim() : '');
    const nameVal = nameInput ? nameInput.value.trim() : '';
    const deptVal = deptSelect ? deptSelect.value : '';
    const divVal = divInput ? divInput.value.trim() : '';

    if (!isContractor && !idVal) {
        if (errEl) {
            errEl.textContent = '⚠️ กรุณาระบุรหัสพนักงาน';
            errEl.classList.remove('hidden');
        }
        if (idInput) idInput.focus();
        return;
    }

    if (!nameVal) {
        if (errEl) {
            errEl.textContent = isContractor ? '⚠️ กรุณาระบุชื่อ - นามสกุล ผู้รับเหมา' : '⚠️ กรุณาระบุชื่อ - นามสกุล';
            errEl.classList.remove('hidden');
        }
        if (nameInput) nameInput.focus();
        return;
    }

    if (!deptVal) {
        if (errEl) {
            errEl.textContent = '⚠️ กรุณาเลือกแผนก';
            errEl.classList.remove('hidden');
        }
        if (deptSelect) deptSelect.focus();
        return;
    }

    if (errEl) errEl.classList.add('hidden');

    const newEmp = {
        id: idVal,
        fullName: nameVal,
        firstName: nameVal,
        lastName: '',
        dept: deptVal,
        division: divVal || '-',
        group: isContractor ? 'ผู้รับเหมาภายใน' : 'พนักงานเข้าใหม่',
        jobType: isContractor ? 'ผู้รับเหมา' : 'พนักงานใหม่ (กรอกเอง)',
        sheet: isContractor ? 'Sup' : 'new_employee'
    };

    if (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE)) {
        if (!isContractor) {
            const existingIdx = EMPLOYEE_DATABASE.findIndex(emp => emp.id && emp.id.toString() === idVal);
            if (existingIdx >= 0) {
                EMPLOYEE_DATABASE[existingIdx] = newEmp;
            } else {
                EMPLOYEE_DATABASE.push(newEmp);
            }
        }
    }

    AppState.currentEmployeeId = idVal;
    AppState.evaluatorType = isContractor ? 'contractor' : 'employee';

    const targetTab = AppState.pendingEvaluationTab || 'form1';

    // Validation: Check for duplicate evaluation (ไม่ให้ทำซ้ำ)
    const existing = findExistingEvaluation(targetTab, isContractor ? nameVal : idVal, isContractor ? 'contractor' : 'employee');
    if (existing) {
        showDuplicateModal(existing, targetTab);
        return;
    }

    if (targetTab === 'form1') {
        const f1Name = document.getElementById('f1-name');
        if (f1Name) f1Name.value = idVal;
        applyEmployeeToForm(1, newEmp, idVal);
    } else if (targetTab === 'form2') {
        const f2Name = document.getElementById('f2-name');
        if (f2Name) f2Name.value = idVal;
        applyEmployeeToForm(2, newEmp, idVal);
    }

    closeNewEmployeeModal();
    switchTab(targetTab, true);
}

// Confirm Employee ID / Contractor and proceed to evaluation
function confirmEmployeeId(e) {
    if (e && e.preventDefault) e.preventDefault();
    const errorEl = document.getElementById('emp-id-error');
    const targetTab = AppState.pendingEvaluationTab || 'form1';

    if (AppState.evaluatorType === 'employee') {
        const input = document.getElementById('input-emp-id');
        const val = input ? input.value.trim() : '';

        // Validation 1: Must be 6 digits
        if (!val || val.length !== 6 || !/^\d{6}$/.test(val)) {
            if (errorEl) {
                errorEl.textContent = '⚠️ กรุณาระบุรหัสพนักงานให้ครบ 6 หลัก (เช่น 455636)';
                errorEl.classList.remove('hidden');
            }
            if (input) input.focus();
            return;
        }

        // Validation 2: Check if employee ID exists in EMPLOYEE_DATABASE ("รายชื่อพนักกงาน WSBและSupภายใน")
        const emp = (typeof findEmployeeById === 'function') ? findEmployeeById(val) : null;
        if (!emp) {
            // Employee ID not found in file -> show popup alert window
            openEmpNotFoundModal();
            return;
        }

        // Validation 3: Check for duplicate evaluation (ไม่ให้ทำซ้ำ)
        const existing = findExistingEvaluation(targetTab, val, 'employee');
        if (existing) {
            showDuplicateModal(existing, targetTab);
            return;
        }

        if (errorEl) errorEl.classList.add('hidden');
        AppState.currentEmployeeId = val;

        if (targetTab === 'form1') {
            const f1Name = document.getElementById('f1-name');
            if (f1Name) f1Name.value = val;
            applyEmployeeToForm(1, emp, val);
        } else if (targetTab === 'form2') {
            const f2Name = document.getElementById('f2-name');
            if (f2Name) f2Name.value = val;
            applyEmployeeToForm(2, emp, val);
        }
    } else {
        // Contractor
        const deptSelect = document.getElementById('select-sup-dept');
        const deptVal = deptSelect ? deptSelect.value : '';
        const selSup = document.getElementById('select-sup-name');
        const fullName = selSup ? selSup.value : '';

        if (!deptVal) {
            if (errorEl) {
                errorEl.textContent = '⚠️ กรุณาเลือกแผนกผู้รับเหมา';
                errorEl.classList.remove('hidden');
            }
            if (deptSelect) deptSelect.focus();
            return;
        }

        if (!fullName) {
            if (errorEl) {
                errorEl.textContent = '⚠️ กรุณาเลือกรายชื่อผู้รับเหมา';
                errorEl.classList.remove('hidden');
            }
            if (selSup) selSup.focus();
            return;
        }

        // Validation: Check for duplicate evaluation (ไม่ให้ทำซ้ำ)
        const existing = findExistingEvaluation(targetTab, fullName, 'contractor');
        if (existing) {
            showDuplicateModal(existing, targetTab);
            return;
        }

        const contractor = AppState.selectedContractor || (typeof EMPLOYEE_DATABASE !== 'undefined' ? EMPLOYEE_DATABASE.find(e => (e.sheet === 'Sup' || e.sheet === 'sup') && e.fullName === fullName) : null) || {
            fullName: fullName,
            dept: deptVal,
            sheet: 'Sup',
            group: 'ผู้รับเหมาภายใน'
        };

        if (errorEl) errorEl.classList.add('hidden');
        AppState.currentEmployeeId = 'ผู้รับเหมา';
        AppState.evaluatorType = 'contractor';

        if (targetTab === 'form1') {
            const f1Name = document.getElementById('f1-name');
            if (f1Name) f1Name.value = 'ผู้รับเหมา';
            applyEmployeeToForm(1, contractor, 'ผู้รับเหมา');
        } else if (targetTab === 'form2') {
            const f2Name = document.getElementById('f2-name');
            if (f2Name) f2Name.value = 'ผู้รับเหมา';
            applyEmployeeToForm(2, contractor, 'ผู้รับเหมา');
        }
    }

    closeEmpIdModal();
    switchTab(targetTab, true);
}

// Live lookup handler when typing Employee ID in modal
function onModalEmpIdInput(val) {
    const errEl = document.getElementById('emp-id-error');
    if (errEl) errEl.classList.add('hidden');
}

// Live lookup handler when typing Employee ID directly in Form 1 or Form 2
function onFormEmpIdInput(formNum, val) {
    const trimmed = (val || '').trim();
    if (!trimmed) {
        clearFormEmployeeInfo(formNum);
        return;
    }

    const emp = (typeof findEmployeeById === 'function') ? findEmployeeById(trimmed) : null;
    applyEmployeeToForm(formNum, emp, trimmed);
}

// Configure Form 1 or Form 2 evaluator UI (Contractor vs Employee)
function applyEvaluatorTypeToForm(formNum, type) {
    const prefix = `f${formNum}`;
    const idContainer = document.getElementById(`${prefix}-id-container`);
    const idInput = document.getElementById(`${prefix}-name`);
    const nameLabel = document.getElementById(`${prefix}-fullname-label`);
    const nameInput = document.getElementById(`${prefix}-fullname`);
    const deptSelect = document.getElementById(`${prefix}-dept`);
    const headerTitle = document.getElementById(`${prefix}-header-title`);
    const statusEl = document.getElementById(`${prefix}-emp-status`);
    const btnEmp = document.getElementById(`${prefix}-btn-type-emp`);
    const btnSup = document.getElementById(`${prefix}-btn-type-sup`);
    const accentColor = formNum === 1 ? 'text-emerald-800' : 'text-sky-800';

    const currentDeptVal = deptSelect ? deptSelect.value : '';

    if (type === 'contractor') {
        // Update Form Switcher Buttons
        if (btnSup) {
            btnSup.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition bg-white ${accentColor} shadow-xs cursor-pointer`;
        }
        if (btnEmp) {
            btnEmp.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 transition cursor-pointer';
        }

        // Contractor: completely hide employee ID field and remove required attribute
        if (idContainer) idContainer.classList.add('hidden');
        if (idInput) {
            idInput.required = false;
            idInput.value = 'ผู้รับเหมา';
        }
        if (nameLabel) nameLabel.textContent = 'ชื่อ - สกุล ผู้รับเหมา';
        if (nameInput) {
            nameInput.readOnly = false;
            nameInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
            nameInput.classList.add('bg-white');
            nameInput.placeholder = 'ระบุชื่อ - สกุล ผู้รับเหมา';
        }
        if (headerTitle) {
            headerTitle.innerHTML = '<span>👤</span> ข้อมูลผู้ทำแบบประเมิน (ผู้รับเหมา)';
        }
        if (statusEl) {
            statusEl.textContent = '✓ ผู้รับเหมา';
            statusEl.className = 'text-xs font-bold text-emerald-600';
        }
        // Restrict department dropdown to ONLY the 2 contractor departments
        populateDepartmentSelect(deptSelect, 'contractor', currentDeptVal);
    } else {
        // Update Form Switcher Buttons
        if (btnEmp) {
            btnEmp.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition bg-white ${accentColor} shadow-xs cursor-pointer`;
        }
        if (btnSup) {
            btnSup.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 transition cursor-pointer';
        }

        // Employee: show employee ID input and mark as required
        if (idContainer) idContainer.classList.remove('hidden');
        if (idInput) {
            idInput.required = true;
            if (idInput.value === 'ผู้รับเหมา') idInput.value = '';
        }
        if (nameLabel) nameLabel.textContent = 'ชื่อ - สกุล (ดึงอัตโนมัติ)';
        if (nameInput) {
            nameInput.readOnly = true;
            nameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
            nameInput.classList.remove('bg-white');
            nameInput.placeholder = 'ชื่อผู้ประเมิน';
        }
        if (headerTitle) {
            headerTitle.innerHTML = '<span>👤</span> ข้อมูลผู้ทำแบบประเมิน (กรอกรหัสพนักงาน ข้อมูลอื่นๆ จะขึ้นโดยอัตโนมัติ)';
        }
        // Restrict department dropdown to ONLY employee departments
        populateDepartmentSelect(deptSelect, 'employee', currentDeptVal);
    }
}

// Switch between Employee and Contractor directly on Form 1 or Form 2
function switchFormEvaluatorType(formNum, type) {
    AppState.evaluatorType = type;
    applyEvaluatorTypeToForm(formNum, type);
    if (type === 'contractor') {
        const nameInput = document.getElementById(`f${formNum}-fullname`);
        if (nameInput) nameInput.focus();
    } else {
        const idInput = document.getElementById(`f${formNum}-name`);
        if (idInput) idInput.focus();
    }
}

// Apply resolved employee info into Form 1 or Form 2
function applyEmployeeToForm(formNum, emp, rawId) {
    const prefix = `f${formNum}`;
    const statusEl = document.getElementById(`${prefix}-emp-status`);
    const matchIcon = document.getElementById(`${prefix}-id-match-icon`);
    const nameInput = document.getElementById(`${prefix}-fullname`);
    const deptSelect = document.getElementById(`${prefix}-dept`);

    const isContractor = AppState.evaluatorType === 'contractor' || (emp && (emp.sheet === 'Sup' || emp.sheet === 'sup' || (emp.dept && emp.dept.startsWith('ผรม.')))) || rawId === 'ผู้รับเหมา';

    // Apply UI state (hide/show Employee ID and populate matching department list)
    applyEvaluatorTypeToForm(formNum, isContractor ? 'contractor' : 'employee');

    if (emp) {
        if (matchIcon) matchIcon.classList.remove('hidden');
        if (statusEl) {
            statusEl.textContent = `✓ พบข้อมูล (${isContractor ? 'ผู้รับเหมา' : 'พนักงาน WSB'})`;
            statusEl.className = 'text-xs font-bold text-emerald-600';
        }
        if (nameInput) {
            nameInput.value = emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.id || '';
        }

        // Auto-select department
        if (deptSelect && emp.dept) {
            deptSelect.value = emp.dept;
            if (deptSelect.value !== emp.dept) {
                // If not found in current options, add it
                const opt = document.createElement('option');
                opt.value = emp.dept;
                opt.textContent = `${emp.dept}${emp.division ? ' (' + emp.division + ')' : ''}`;
                deptSelect.appendChild(opt);
                deptSelect.value = emp.dept;
            }
        }

        // Form 1 specific extra info box
        if (formNum === 1) {
            const extraBox = document.getElementById('f1-emp-extra-box');
            const extraDiv = document.getElementById('f1-extra-division');
            const extraGroup = document.getElementById('f1-extra-group');
            const extraType = document.getElementById('f1-extra-type');
            if (extraBox) extraBox.classList.remove('hidden');
            if (extraDiv) extraDiv.textContent = emp.division || '-';
            if (extraGroup) extraGroup.textContent = emp.group || (isContractor ? 'ผู้รับเหมาภายใน' : '-');
            if (extraType) extraType.textContent = emp.jobType || (isContractor ? 'ผู้รับเหมา' : 'ประจำ');
        }

        // Form 2 specific group and division inputs
        if (formNum === 2) {
            const groupInput = document.getElementById('f2-group');
            const divInput = document.getElementById('f2-division');
            if (groupInput) groupInput.value = emp.group || (isContractor ? 'ผู้รับเหมาภายใน' : 'ผลิตน้ำตาลวังสมบูรณ์');
            if (divInput) divInput.value = emp.division || '-';
        }
    } else {
        if (matchIcon) matchIcon.classList.add('hidden');
        if (statusEl) {
            statusEl.textContent = 'ไม่พบในฐานข้อมูล (สามารถกรอกเองได้)';
            statusEl.className = 'text-xs font-normal text-amber-600';
        }
        if (nameInput) nameInput.value = '';
        if (formNum === 1) {
            const extraBox = document.getElementById('f1-emp-extra-box');
            if (extraBox) extraBox.classList.add('hidden');
        }
    }
}

// Clear employee info when input is emptied
function clearFormEmployeeInfo(formNum) {
    const prefix = `f${formNum}`;
    const statusEl = document.getElementById(`${prefix}-emp-status`);
    const matchIcon = document.getElementById(`${prefix}-id-match-icon`);
    const nameInput = document.getElementById(`${prefix}-fullname`);

    if (matchIcon) matchIcon.classList.add('hidden');
    if (statusEl) {
        statusEl.textContent = 'พร้อมใช้งาน';
        statusEl.className = 'text-xs font-medium text-slate-500';
    }
    if (nameInput) nameInput.value = '';

    if (formNum === 1) {
        const extraBox = document.getElementById('f1-emp-extra-box');
        if (extraBox) extraBox.classList.add('hidden');
    }
}

// Filtered department lists
function getDepartmentList(filterType = 'all') {
    const contractorDepts = ['ผรม. ทำความสะอาด', 'ผรม. ภูมิทัศน์'];
    const wsbDeptMap = new Map();
    const supDeptMap = new Map();

    if (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE)) {
        EMPLOYEE_DATABASE.forEach(emp => {
            if (!emp.dept || !emp.dept.trim()) return;
            const name = emp.dept.trim();
            const isSup = (emp.sheet === 'Sup' || emp.sheet === 'sup' || name.startsWith('ผรม.'));
            if (isSup) {
                if (!supDeptMap.has(name)) supDeptMap.set(name, emp.division || '');
            } else {
                if (!wsbDeptMap.has(name)) wsbDeptMap.set(name, emp.division || '');
            }
        });
    }

    contractorDepts.forEach(d => {
        if (!supDeptMap.has(d)) supDeptMap.set(d, 'ผู้รับเหมา');
    });

    if (filterType === 'contractor') {
        return Array.from(supDeptMap.entries()).sort((a, b) => a[0].localeCompare(b[0], 'th'));
    } else if (filterType === 'employee') {
        return Array.from(wsbDeptMap.entries()).sort((a, b) => a[0].localeCompare(b[0], 'th'));
    } else {
        const merged = new Map([...wsbDeptMap, ...supDeptMap]);
        return Array.from(merged.entries()).sort((a, b) => a[0].localeCompare(b[0], 'th'));
    }
}

// Populate select element with department options
function populateDepartmentSelect(selectEl, filterType = 'employee', selectedVal = '') {
    if (!selectEl) return;
    const isFilter = selectEl.id === 'filter-dept';
    const placeholder = isFilter 
        ? '<option value="ALL">ทุกฝ่าย / แผนก ทั้งหมด</option>' 
        : '<option value="">-- กรุณาเลือกแผนก / ฝ่าย --</option>';
    selectEl.innerHTML = placeholder;

    const depts = getDepartmentList(filterType);
    depts.forEach(([name, div]) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = (div && div !== '-') ? `${name} (${div})` : name;
        selectEl.appendChild(opt);
    });

    if (selectedVal) {
        selectEl.value = selectedVal;
    }
}

// Render Department Options in select dropdowns
function renderDepartmentOptions() {
    populateDepartmentSelect(document.getElementById('filter-dept'), 'all');
    populateDepartmentSelect(document.getElementById('f1-dept'), AppState.evaluatorType || 'employee');
    populateDepartmentSelect(document.getElementById('f2-dept'), AppState.evaluatorType || 'employee');
    populateDepartmentSelect(document.getElementById('new-emp-dept'), currentNewEvaluatorType || 'employee');
}

// Default date inputs to today
function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const f1Date = document.getElementById('f1-date');
    const f2Date = document.getElementById('f2-date');
    if (f1Date) f1Date.value = today;
    if (f2Date) f2Date.value = today;
}

// -------------------------------------------------------------------------
// FORM 1: FOOD SAFETY CULTURE (FM-MR12-MR-01)
// -------------------------------------------------------------------------

function renderForm1Questions() {
    const container = document.getElementById('f1-questions-container');
    if (!container) return;

    let html = '';
    FORM_FOOD_SAFETY.sections.forEach((sec, sIdx) => {
        html += `
            <div class="mb-8 border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                <div class="bg-gradient-to-r from-emerald-800 to-emerald-700 px-5 py-3 text-white flex items-center justify-between">
                    <h3 class="font-bold text-base md:text-lg flex items-center gap-2">
                        <span class="bg-emerald-600/60 text-emerald-100 text-xs px-2.5 py-1 rounded-full uppercase tracking-wider">ตอนที่ ${sIdx + 1}</span>
                        ${sec.name}
                    </h3>
                    <span class="text-xs text-emerald-100 hidden sm:inline">เกณฑ์: 1 (น้อยที่สุด) ถึง 5 (มากที่สุด)</span>
                </div>
                <div class="divide-y divide-slate-100">
        `;

        sec.questions.forEach(q => {
            html += `
                <div class="p-4 md:p-5 hover:bg-slate-50/70 transition-colors question-row" id="f1-row-${q.id}">
                    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div class="lg:w-7/12 pr-2">
                            <div class="flex items-start gap-3">
                                <span class="flex-shrink-0 w-7 h-7 bg-emerald-100 text-emerald-800 font-bold text-sm rounded-lg flex items-center justify-center mt-0.5">${q.id}</span>
                                <p class="text-slate-800 text-sm md:text-base leading-relaxed font-medium">${q.text}</p>
                            </div>
                        </div>
                        <div class="lg:w-5/12 flex items-center justify-between sm:justify-end gap-1.5 md:gap-2 flex-wrap">
            `;

            FORM_FOOD_SAFETY.scale.forEach(scale => {
                html += `
                    <label class="rating-choice flex flex-col items-center cursor-pointer p-1.5 rounded-lg border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition">
                        <input type="radio" name="f1_q_${q.id}" value="${scale.value}" class="peer sr-only" onchange="onForm1ScoreChange(${q.id}, ${scale.value})">
                        <div class="w-10 h-10 md:w-11 md:h-11 rounded-lg flex items-center justify-center font-bold text-slate-600 peer-checked:bg-emerald-700 peer-checked:text-white peer-checked:shadow-md transition">
                            ${scale.value}
                        </div>
                        <span class="text-[10px] text-slate-500 font-medium mt-1 text-center peer-checked:text-emerald-800 peer-checked:font-bold">${scale.short}</span>
                    </label>
                `;
            });

            html += `
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// When a rating is selected in Form 1
function onForm1ScoreChange(qid, val) {
    const row = document.getElementById(`f1-row-${qid}`);
    if (row) {
        row.classList.remove('bg-rose-50', 'border', 'border-rose-300');
    }
    updateForm1LiveScore();
}

// Calculate live total score for Form 1
function updateForm1LiveScore() {
    let total = 0;
    let answered = 0;
    const totalQuestions = 20;

    for (let i = 1; i <= totalQuestions; i++) {
        const checked = document.querySelector(`input[name="f1_q_${i}"]:checked`);
        if (checked) {
            total += parseInt(checked.value, 10);
            answered++;
        }
    }

    const scoreBadge = document.getElementById('f1-live-score');
    const countBadge = document.getElementById('f1-live-answered');
    const interpretationBox = document.getElementById('f1-live-interpretation');

    if (scoreBadge) scoreBadge.textContent = total;
    if (countBadge) countBadge.textContent = `${answered} / ${totalQuestions}`;

    if (interpretationBox) {
        if (answered > 0) {
            const level = getFoodSafetyLevel(total);
            interpretationBox.innerHTML = `
                <div class="p-3 rounded-lg border ${level.colorClass} flex items-start gap-3">
                    <span class="text-xl">🏆</span>
                    <div>
                        <div class="font-bold text-sm md:text-base">${level.level} (${total} คะแนน)</div>
                        <div class="text-xs md:text-sm mt-0.5 leading-relaxed">${level.description}</div>
                    </div>
                </div>
            `;
        } else {
            interpretationBox.innerHTML = '';
        }
    }
}

// Determine maturity level for Form 1
function getFoodSafetyLevel(score) {
    for (const lvl of FORM_FOOD_SAFETY.scoringLevels) {
        if (score >= lvl.min && score <= lvl.max) {
            return lvl;
        }
    }
    return FORM_FOOD_SAFETY.scoringLevels[FORM_FOOD_SAFETY.scoringLevels.length - 1];
}

// Handle Form 1 Submission
function handleForm1Submit(e) {
    e.preventDefault();

    const dateVal = document.getElementById('f1-date').value;
    const deptVal = document.getElementById('f1-dept').value;
    const empName = document.getElementById('f1-name').value.trim();
    const commentVal = document.getElementById('f1-comments').value.trim();

    if (!deptVal) {
        alert("กรุณาเลือก แผนก/ฝ่าย ของท่าน");
        document.getElementById('f1-dept').focus();
        return;
    }

    const isContractorSubmit = AppState.evaluatorType === 'contractor' || empName === 'ผู้รับเหมา';
    const empFullName = document.getElementById('f1-fullname') ? document.getElementById('f1-fullname').value.trim() : '';

    if (!isContractorSubmit) {
        if (!empName) {
            alert("กรุณาระบุรหัสพนักงาน");
            document.getElementById('f1-name').focus();
            return;
        }

        const empObj = (typeof findEmployeeById === 'function') ? findEmployeeById(empName) : null;
        if (!empObj) {
            openEmpNotFoundModal();
            return;
        }
    }

    // Duplicate Check: Prevent duplicate submission for Form 1 (ไม่ให้ทำซ้ำ)
    const idToCheck = isContractorSubmit ? (empFullName || 'ผู้รับเหมา') : empName;
    const existingEval1 = findExistingEvaluation('form1', idToCheck, isContractorSubmit ? 'contractor' : 'employee');
    if (existingEval1) {
        showDuplicateModal(existingEval1, 'form1');
        return;
    }

    // Check all questions answered
    const answers = {};
    let totalScore = 0;
    let missingQuestions = [];

    for (let i = 1; i <= 20; i++) {
        const checked = document.querySelector(`input[name="f1_q_${i}"]:checked`);
        if (!checked) {
            missingQuestions.push(i);
            const row = document.getElementById(`f1-row-${i}`);
            if (row) row.classList.add('bg-rose-50', 'border', 'border-rose-300');
        } else {
            const val = parseInt(checked.value, 10);
            answers[i] = val;
            totalScore += val;
        }
    }

    if (missingQuestions.length > 0) {
        alert(`กรุณาตอบคำถามให้ครบทุกข้อ (ยังขาดข้อที่: ${missingQuestions.join(', ')})`);
        const firstMissing = document.getElementById(`f1-row-${missingQuestions[0]}`);
        if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const level = getFoodSafetyLevel(totalScore);

    // Dimension subtotals
    const dimensionScores = {
        leadership: (answers[1] + answers[2] + answers[3]) / 3,
        participation: (answers[4] + answers[5] + answers[6]) / 3,
        communication: (answers[7] + answers[8] + answers[9]) / 3,
        responsibility: (answers[10] + answers[11] + answers[12]) / 3,
        competence: (answers[13] + answers[14] + answers[15] + answers[16]) / 4,
        environment: (answers[17] + answers[18] + answers[19] + answers[20]) / 4
    };

    const empExtraDiv = document.getElementById('f1-extra-division') ? document.getElementById('f1-extra-division').textContent : '';

    // Determine evaluator type
    let isContractor = false;
    if (AppState.evaluatorType === 'contractor') {
        isContractor = true;
    } else if (empName === 'ผู้รับเหมา' || empName.toUpperCase().startsWith('SUP')) {
        isContractor = true;
    } else if (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE)) {
        const matched = EMPLOYEE_DATABASE.find(e => (e.sheet === 'Sup' || e.sheet === 'sup') && (e.fullName === empFullName || e.id === empName));
        if (matched) isContractor = true;
    }
    const evalType = isContractor ? 'contractor' : 'employee';
    const evalTypeLabel = isContractor ? 'ผู้รับเหมา (Sup)' : 'พนักงาน (WSB)';

    const newEvaluation = {
        id: 'FS-' + Date.now(),
        timestamp: new Date().toISOString(),
        formType: 'FM-MR12-MR-01',
        formTitle: FORM_FOOD_SAFETY.title,
        evaluatorType: evalType,
        evaluatorTypeLabel: evalTypeLabel,
        date: dateVal,
        department: deptVal,
        division: empExtraDiv !== '-' ? empExtraDiv : '',
        employeeId: empName,
        evaluatorName: empFullName ? `${empFullName} (${empName})` : empName,
        answers: answers,
        dimensionScores: dimensionScores,
        totalScore: totalScore,
        maxScore: 100,
        percentage: totalScore, // since max is 100
        level: level.level,
        badgeColor: level.badgeColor,
        comments: commentVal
    };

    AppState.evaluations.unshift(newEvaluation);
    saveEvaluations();
    syncEvaluationToServer(newEvaluation);

    // Show success modal
    showSuccessModal({
        title: "บันทึกแบบประเมินวัฒนธรรมความปลอดภัยอาหาร สำเร็จ!",
        code: FORM_FOOD_SAFETY.code,
        scoreText: `${totalScore} / 100 คะแนน (${totalScore}%)`,
        levelText: level.level,
        description: level.description,
        dept: deptVal,
        date: dateVal,
        formTarget: 'form1'
    });

    // Reset Form 1
    document.getElementById('form1-element').reset();
    AppState.currentEmployeeId = '';
    setDefaultDates();
    updateForm1LiveScore();
}

// -------------------------------------------------------------------------
// FORM 2: COMMUNICATION & PR (FM-MR14-MR-04)
// -------------------------------------------------------------------------

function renderForm2Questions() {
    const container = document.getElementById('f2-questions-container');
    if (!container) return;

    let html = `
        <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white mb-8">
            <div class="bg-gradient-to-r from-sky-800 to-sky-700 px-5 py-3 text-white flex items-center justify-between">
                <h3 class="font-bold text-base md:text-lg flex items-center gap-2">
                    <span class="bg-sky-600/60 text-sky-100 text-xs px-2.5 py-1 rounded-full uppercase tracking-wider">รายการประเมิน</span>
                    รายการประเมินการสื่อสารและประชาสัมพันธ์ (12 ข้อ)
                </h3>
                <span class="text-xs text-sky-100 hidden sm:inline">เกณฑ์: 4 (ดีมาก), 3 (ดี), 2 (พอใช้), 1 (ปรับปรุง)</span>
            </div>
            <div class="divide-y divide-slate-100">
    `;

    FORM_COMMUNICATION.questions.forEach(q => {
        html += `
            <div class="p-4 md:p-5 hover:bg-slate-50/70 transition-colors question-row" id="f2-row-${q.id}">
                <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div class="lg:w-6/12 pr-2">
                        <div class="flex items-start gap-3">
                            <span class="flex-shrink-0 w-7 h-7 bg-sky-100 text-sky-800 font-bold text-sm rounded-lg flex items-center justify-center mt-0.5">${q.id}</span>
                            <p class="text-slate-800 text-sm md:text-base leading-relaxed font-medium">${q.text}</p>
                        </div>
                    </div>
                    <div class="lg:w-6/12 flex flex-col sm:flex-row items-start sm:items-center justify-end gap-3">
                        <div class="flex items-center gap-2 flex-wrap">
        `;

        FORM_COMMUNICATION.scale.forEach(scale => {
            html += `
                <label class="rating-choice flex flex-col items-center cursor-pointer p-1.5 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-sky-50/50 transition">
                    <input type="radio" name="f2_q_${q.id}" value="${scale.value}" class="peer sr-only" onchange="onForm2ScoreChange(${q.id}, ${scale.value})">
                    <div class="w-10 h-10 md:w-11 md:h-11 rounded-lg flex items-center justify-center font-bold text-slate-600 peer-checked:bg-sky-700 peer-checked:text-white peer-checked:shadow-md transition">
                        ${scale.value}
                    </div>
                    <span class="text-[10px] text-slate-500 font-medium mt-1 text-center peer-checked:text-sky-800 peer-checked:font-bold">${scale.short}</span>
                </label>
            `;
        });

        html += `
                        </div>
                        <div class="w-full sm:w-44 flex-shrink-0 mt-2 sm:mt-0">
                            <input type="text" name="f2_comment_${q.id}" placeholder="ข้อเสนอแนะข้อ ${q.id} (ถ้ามี)" class="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-sky-500 focus:border-sky-500 bg-slate-50 focus:bg-white transition">
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    container.innerHTML = html;
}

// When a rating is selected in Form 2
function onForm2ScoreChange(qid, val) {
    const row = document.getElementById(`f2-row-${qid}`);
    if (row) {
        row.classList.remove('bg-rose-50', 'border', 'border-rose-300');
    }
    updateForm2LiveScore();
}

// Calculate live total score for Form 2
function updateForm2LiveScore() {
    let total = 0;
    let answered = 0;
    const totalQuestions = 12;
    const maxScore = 48;

    for (let i = 1; i <= totalQuestions; i++) {
        const checked = document.querySelector(`input[name="f2_q_${i}"]:checked`);
        if (checked) {
            total += parseInt(checked.value, 10);
            answered++;
        }
    }

    const percent = ((total / maxScore) * 100).toFixed(1);

    const scoreBadge = document.getElementById('f2-live-score');
    const countBadge = document.getElementById('f2-live-answered');
    const percentBadge = document.getElementById('f2-live-percent');
    const interpretationBox = document.getElementById('f2-live-interpretation');

    if (scoreBadge) scoreBadge.textContent = `${total} / ${maxScore}`;
    if (countBadge) countBadge.textContent = `${answered} / ${totalQuestions}`;
    if (percentBadge) percentBadge.textContent = `${percent}%`;

    if (interpretationBox) {
        if (answered > 0) {
            const level = getCommunicationLevel(parseFloat(percent));
            interpretationBox.innerHTML = `
                <div class="p-3 rounded-lg border ${level.colorClass} flex items-start gap-3">
                    <span class="text-xl">📢</span>
                    <div>
                        <div class="font-bold text-sm md:text-base">${level.level} (คิดเป็น ${percent}%)</div>
                        <div class="text-xs md:text-sm mt-0.5 leading-relaxed">${level.description}</div>
                    </div>
                </div>
            `;
        } else {
            interpretationBox.innerHTML = '';
        }
    }
}

// Determine maturity level for Form 2
function getCommunicationLevel(percent) {
    for (const lvl of FORM_COMMUNICATION.scoringLevels) {
        if (percent >= lvl.minPercent && percent <= lvl.maxPercent) {
            return lvl;
        }
    }
    return FORM_COMMUNICATION.scoringLevels[FORM_COMMUNICATION.scoringLevels.length - 1];
}

// Handle Form 2 Submission
function handleForm2Submit(e) {
    e.preventDefault();

    const dateVal = document.getElementById('f2-date').value;
    const deptVal = document.getElementById('f2-dept').value;
    const divisionVal = document.getElementById('f2-division').value.trim();
    const groupVal = document.getElementById('f2-group').value.trim();
    const empName = document.getElementById('f2-name').value.trim();
    const commentVal = document.getElementById('f2-comments').value.trim();

    if (!deptVal) {
        alert("กรุณาเลือก แผนก ของท่าน");
        document.getElementById('f2-dept').focus();
        return;
    }

    const isContractorSubmit = AppState.evaluatorType === 'contractor' || empName === 'ผู้รับเหมา';
    const empFullName = document.getElementById('f2-fullname') ? document.getElementById('f2-fullname').value.trim() : '';

    if (!isContractorSubmit) {
        if (!empName) {
            alert("กรุณาระบุรหัสพนักงาน");
            document.getElementById('f2-name').focus();
            return;
        }

        const empObj = (typeof findEmployeeById === 'function') ? findEmployeeById(empName) : null;
        if (!empObj) {
            openEmpNotFoundModal();
            return;
        }
    }

    // Duplicate Check: Prevent duplicate submission for Form 2 (ไม่ให้ทำซ้ำ)
    const idToCheck = isContractorSubmit ? (empFullName || 'ผู้รับเหมา') : empName;
    const existingEval2 = findExistingEvaluation('form2', idToCheck, isContractorSubmit ? 'contractor' : 'employee');
    if (existingEval2) {
        showDuplicateModal(existingEval2, 'form2');
        return;
    }

    // Check all questions answered
    const answers = {};
    const itemComments = {};
    let totalScore = 0;
    let missingQuestions = [];

    for (let i = 1; i <= 12; i++) {
        const checked = document.querySelector(`input[name="f2_q_${i}"]:checked`);
        if (!checked) {
            missingQuestions.push(i);
            const row = document.getElementById(`f2-row-${i}`);
            if (row) row.classList.add('bg-rose-50', 'border', 'border-rose-300');
        } else {
            const val = parseInt(checked.value, 10);
            answers[i] = val;
            totalScore += val;

            const cInput = document.querySelector(`input[name="f2_comment_${i}"]`);
            if (cInput && cInput.value.trim()) {
                itemComments[i] = cInput.value.trim();
            }
        }
    }

    if (missingQuestions.length > 0) {
        alert(`กรุณาตอบคำถามให้ครบทุกข้อ (ยังขาดข้อที่: ${missingQuestions.join(', ')})`);
        const firstMissing = document.getElementById(`f2-row-${missingQuestions[0]}`);
        if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const percent = parseFloat(((totalScore / 48) * 100).toFixed(2));
    const level = getCommunicationLevel(percent);

    // Determine evaluator type
    let isContractor = false;
    if (AppState.evaluatorType === 'contractor') {
        isContractor = true;
    } else if (empName === 'ผู้รับเหมา' || empName.toUpperCase().startsWith('SUP')) {
        isContractor = true;
    } else if (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE)) {
        const matched = EMPLOYEE_DATABASE.find(e => (e.sheet === 'Sup' || e.sheet === 'sup') && (e.fullName === empFullName || e.id === empName));
        if (matched) isContractor = true;
    }
    const evalType = isContractor ? 'contractor' : 'employee';
    const evalTypeLabel = isContractor ? 'ผู้รับเหมา (Sup)' : 'พนักงาน (WSB)';

    const newEvaluation = {
        id: 'COM-' + Date.now(),
        timestamp: new Date().toISOString(),
        formType: 'FM-MR14-MR-04',
        formTitle: FORM_COMMUNICATION.title,
        evaluatorType: evalType,
        evaluatorTypeLabel: evalTypeLabel,
        date: dateVal,
        group: groupVal || 'ผลิตน้ำตาลวังสมบูรณ์',
        division: divisionVal || '',
        department: deptVal,
        employeeId: empName,
        evaluatorName: empFullName ? `${empFullName} (${empName})` : empName,
        answers: answers,
        itemComments: itemComments,
        totalScore: totalScore,
        maxScore: 48,
        percentage: percent,
        level: level.level,
        badgeColor: level.badgeColor,
        comments: commentVal
    };

    AppState.evaluations.unshift(newEvaluation);
    saveEvaluations();
    syncEvaluationToServer(newEvaluation);

    // Show success modal
    showSuccessModal({
        title: "บันทึกแบบประเมินการสื่อสารและประชาสัมพันธ์ สำเร็จ!",
        code: FORM_COMMUNICATION.code,
        scoreText: `${totalScore} / 48 คะแนน (${percent}%)`,
        levelText: level.level,
        description: level.description,
        dept: deptVal,
        date: dateVal,
        formTarget: 'form2'
    });

    // Reset Form 2
    document.getElementById('form2-element').reset();
    AppState.currentEmployeeId = '';
    setDefaultDates();
    updateForm2LiveScore();
}

// -------------------------------------------------------------------------
// SUCCESS MODAL
// -------------------------------------------------------------------------

function showSuccessModal(data) {
    const modal = document.getElementById('success-modal');
    if (!modal) return;

    document.getElementById('modal-title').textContent = data.title;
    document.getElementById('modal-code').textContent = data.code;
    document.getElementById('modal-score').textContent = data.scoreText;
    document.getElementById('modal-level').textContent = data.levelText;
    document.getElementById('modal-desc').textContent = data.description;
    document.getElementById('modal-dept').textContent = data.dept;
    document.getElementById('modal-date').textContent = data.date;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSuccessModal() {
    const modal = document.getElementById('success-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// -------------------------------------------------------------------------
// DASHBOARD & ANALYTICS
// -------------------------------------------------------------------------

// Filter helper
function getFilteredEvaluations() {
    return AppState.evaluations.filter(item => {
        // Form type filter
        if (AppState.filter.formType !== 'ALL' && item.formType !== AppState.filter.formType) {
            return false;
        }
        // User type filter (Employee vs Contractor)
        if (AppState.filter.userType && AppState.filter.userType !== 'ALL') {
            const isContractor = isContractorEvaluation(item);
            if (AppState.filter.userType === 'contractor' && !isContractor) return false;
            if (AppState.filter.userType === 'employee' && isContractor) return false;
        }
        // Department filter
        if (AppState.filter.department !== 'ALL' && item.department !== AppState.filter.department) {
            return false;
        }
        // Date range filter
        if (AppState.filter.startDate && item.date < AppState.filter.startDate) {
            return false;
        }
        if (AppState.filter.endDate && item.date > AppState.filter.endDate) {
            return false;
        }
        // Search text
        if (AppState.filter.search) {
            const q = AppState.filter.search.toLowerCase();
            const matchName = (item.evaluatorName || '').toLowerCase().includes(q);
            const matchDept = (item.department || '').toLowerCase().includes(q);
            const matchComment = (item.comments || '').toLowerCase().includes(q);
            if (!matchName && !matchDept && !matchComment) return false;
        }
        return true;
    });
}

function updateDashboardMetrics() {
    const filtered = getFilteredEvaluations();

    const fsItems = filtered.filter(x => x.formType === 'FM-MR12-MR-01');
    const comItems = filtered.filter(x => x.formType === 'FM-MR14-MR-04');

    const empItems = filtered.filter(x => !isContractorEvaluation(x));
    const supItems = filtered.filter(x => isContractorEvaluation(x));

    // Total Count & Breakdown
    const totalCountEl = document.getElementById('metric-total-count');
    if (totalCountEl) totalCountEl.textContent = filtered.length;

    const empCountEl = document.getElementById('metric-emp-count');
    if (empCountEl) empCountEl.textContent = empItems.length;

    const supCountEl = document.getElementById('metric-sup-count');
    if (supCountEl) supCountEl.textContent = supItems.length;

    // FS Average Score & Breakdown
    const fsAvgScoreEl = document.getElementById('metric-fs-avg');
    const fsAvgLevelEl = document.getElementById('metric-fs-level');
    const fsBreakdownEl = document.getElementById('metric-fs-breakdown');
    if (fsItems.length > 0) {
        const sum = fsItems.reduce((acc, c) => acc + c.totalScore, 0);
        const avg = (sum / fsItems.length).toFixed(1);
        if (fsAvgScoreEl) fsAvgScoreEl.textContent = `${avg} / 100`;
        const lvl = getFoodSafetyLevel(parseFloat(avg));
        if (fsAvgLevelEl) {
            fsAvgLevelEl.textContent = lvl.level;
            fsAvgLevelEl.className = `text-xs font-semibold px-2 py-0.5 rounded-full inline-block mt-1 ${lvl.colorClass}`;
        }

        const fsEmp = fsItems.filter(x => !isContractorEvaluation(x));
        const fsSup = fsItems.filter(x => isContractorEvaluation(x));
        const fsEmpAvg = fsEmp.length ? (fsEmp.reduce((a, c) => a + c.totalScore, 0) / fsEmp.length).toFixed(1) : '-';
        const fsSupAvg = fsSup.length ? (fsSup.reduce((a, c) => a + c.totalScore, 0) / fsSup.length).toFixed(1) : '-';
        if (fsBreakdownEl) {
            fsBreakdownEl.innerHTML = `🏢 พนักงาน: <b class="text-emerald-700 font-bold">${fsEmpAvg}</b> | 👷 ผรม.: <b class="text-amber-700 font-bold">${fsSupAvg}</b>`;
        }
    } else {
        if (fsAvgScoreEl) fsAvgScoreEl.textContent = "-";
        if (fsAvgLevelEl) {
            fsAvgLevelEl.textContent = "ยังไม่มีข้อมูล";
            fsAvgLevelEl.className = "text-xs text-slate-400 mt-1";
        }
        if (fsBreakdownEl) fsBreakdownEl.innerHTML = "";
    }

    // Com Average Score & Breakdown
    const comAvgScoreEl = document.getElementById('metric-com-avg');
    const comAvgLevelEl = document.getElementById('metric-com-level');
    const comBreakdownEl = document.getElementById('metric-com-breakdown');
    if (comItems.length > 0) {
        const sumScore = comItems.reduce((acc, c) => acc + c.totalScore, 0);
        const avgScore = (sumScore / comItems.length).toFixed(1);
        const avgPercent = ((avgScore / 48) * 100).toFixed(1);
        if (comAvgScoreEl) comAvgScoreEl.textContent = `${avgScore} / 48 (${avgPercent}%)`;
        const lvl = getCommunicationLevel(parseFloat(avgPercent));
        if (comAvgLevelEl) {
            comAvgLevelEl.textContent = lvl.level;
            comAvgLevelEl.className = `text-xs font-semibold px-2 py-0.5 rounded-full inline-block mt-1 ${lvl.colorClass}`;
        }

        const comEmp = comItems.filter(x => !isContractorEvaluation(x));
        const comSup = comItems.filter(x => isContractorEvaluation(x));
        const comEmpAvg = comEmp.length ? ((comEmp.reduce((a, c) => a + c.totalScore, 0) / (comEmp.length * 48)) * 100).toFixed(1) + '%' : '-';
        const comSupAvg = comSup.length ? ((comSup.reduce((a, c) => a + c.totalScore, 0) / (comSup.length * 48)) * 100).toFixed(1) + '%' : '-';
        if (comBreakdownEl) {
            comBreakdownEl.innerHTML = `🏢 พนักงาน: <b class="text-emerald-700 font-bold">${comEmpAvg}</b> | 👷 ผรม.: <b class="text-amber-700 font-bold">${comSupAvg}</b>`;
        }
    } else {
        if (comAvgScoreEl) comAvgScoreEl.textContent = "-";
        if (comAvgLevelEl) {
            comAvgLevelEl.textContent = "ยังไม่มีข้อมูล";
            comAvgLevelEl.className = "text-xs text-slate-400 mt-1";
        }
        if (comBreakdownEl) comBreakdownEl.innerHTML = "";
    }

    // Department participation
    const deptCountEl = document.getElementById('metric-dept-count');
    if (deptCountEl) {
        const uniqueDepts = new Set(filtered.map(x => x.department));
        deptCountEl.textContent = `${uniqueDepts.size} แผนก`;
    }
}

// Render Dashboard Charts with Chart.js
function renderDashboardCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js is not loaded yet.");
        return;
    }

    const filtered = getFilteredEvaluations();
    const fsItems = filtered.filter(x => x.formType === 'FM-MR12-MR-01');
    const comItems = filtered.filter(x => x.formType === 'FM-MR14-MR-04');

    renderRadarChart(fsItems);
    renderCommunicationBarChart(comItems);
    renderDistributionChart(filtered);
    renderEmpCompareChart(filtered);
    if (AppState.isAdminUnlocked) {
        renderDeptComparisonChart(filtered);
    }
}

// Helper to calculate FSC 6 dimensions average
function calculateFSDimensions(items) {
    if (!items || items.length === 0) return [0, 0, 0, 0, 0, 0];
    let leadershipSum = 0;
    let participationSum = 0;
    let communicationSum = 0;
    let responsibilitySum = 0;
    let competenceSum = 0;
    let environmentSum = 0;

    items.forEach(item => {
        const ans = item.answers || {};
        leadershipSum += (((ans[1] || 0) + (ans[2] || 0) + (ans[3] || 0)) / 3);
        participationSum += (((ans[4] || 0) + (ans[5] || 0) + (ans[6] || 0)) / 3);
        communicationSum += (((ans[7] || 0) + (ans[8] || 0) + (ans[9] || 0)) / 3);
        responsibilitySum += (((ans[10] || 0) + (ans[11] || 0) + (ans[12] || 0)) / 3);
        competenceSum += (((ans[13] || 0) + (ans[14] || 0) + (ans[15] || 0) + (ans[16] || 0)) / 4);
        environmentSum += (((ans[17] || 0) + (ans[18] || 0) + (ans[19] || 0) + (ans[20] || 0)) / 4);
    });

    const n = items.length;
    return [
        parseFloat((leadershipSum / n).toFixed(2)),
        parseFloat((participationSum / n).toFixed(2)),
        parseFloat((communicationSum / n).toFixed(2)),
        parseFloat((responsibilitySum / n).toFixed(2)),
        parseFloat((competenceSum / n).toFixed(2)),
        parseFloat((environmentSum / n).toFixed(2))
    ];
}

// 1. Radar Chart: 6 Dimensions of Food Safety Culture (WSB vs Sup comparison)
function renderRadarChart(fsItems) {
    const canvas = document.getElementById('chart-radar-fsc');
    if (!canvas) return;

    if (AppState.charts.radar) {
        AppState.charts.radar.destroy();
    }

    const dimensionLabels = [
        'ความเป็นผู้นำ\n(ข้อ 1-3)',
        'การมีส่วนร่วม\n(ข้อ 4-6)',
        'การสื่อสาร\n(ข้อ 7-9)',
        'ผู้รับผิดชอบ\n(ข้อ 10-12)',
        'ความรู้และการอบรม\n(ข้อ 13-16)',
        'สภาพทั่วไป\n(ข้อ 17-20)'
    ];

    const datasets = [];

    if (AppState.filter.userType === 'ALL') {
        const fsEmp = fsItems.filter(x => !isContractorEvaluation(x));
        const fsSup = fsItems.filter(x => isContractorEvaluation(x));

        if (fsEmp.length > 0) {
            datasets.push({
                label: `🏢 พนักงาน WSB (${fsEmp.length} คน)`,
                data: calculateFSDimensions(fsEmp),
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                borderColor: '#059669',
                pointBackgroundColor: '#047857',
                pointBorderColor: '#fff',
                pointRadius: 4,
                borderWidth: 2
            });
        }

        if (fsSup.length > 0) {
            datasets.push({
                label: `👷 ผู้รับเหมา Sup (${fsSup.length} คน)`,
                data: calculateFSDimensions(fsSup),
                backgroundColor: 'rgba(245, 158, 11, 0.2)',
                borderColor: '#d97706',
                pointBackgroundColor: '#b45309',
                pointBorderColor: '#fff',
                pointRadius: 4,
                borderWidth: 2
            });
        }

        if (datasets.length === 0) {
            datasets.push({
                label: 'คะแนนเฉลี่ย (เต็ม 5.0)',
                data: [0, 0, 0, 0, 0, 0],
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                borderColor: '#059669',
                borderWidth: 2
            });
        }
    } else {
        const isSup = AppState.filter.userType === 'contractor';
        const label = isSup 
            ? `👷 ผู้รับเหมา Sup (${fsItems.length} คน)` 
            : `🏢 พนักงาน WSB (${fsItems.length} คน)`;
        const borderColor = isSup ? '#d97706' : '#059669';
        const bgColor = isSup ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.25)';

        datasets.push({
            label: label,
            data: calculateFSDimensions(fsItems),
            backgroundColor: bgColor,
            borderColor: borderColor,
            pointBackgroundColor: borderColor,
            pointBorderColor: '#fff',
            pointRadius: 4,
            borderWidth: 2
        });
    }

    const ctx = canvas.getContext('2d');
    AppState.charts.radar = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: dimensionLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    min: 0,
                    max: 5,
                    ticks: {
                        stepSize: 1,
                        backdropColor: 'transparent',
                        font: { family: 'Sarabun, sans-serif' }
                    },
                    pointLabels: {
                        font: { size: 11, family: 'Sarabun, sans-serif', weight: 'bold' },
                        color: '#334155'
                    },
                    grid: { color: '#e2e8f0' },
                    angleLines: { color: '#e2e8f0' }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { font: { family: 'Sarabun, sans-serif' } }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label.split('(')[0]}: ${ctx.raw} / 5.0`
                    }
                }
            }
        }
    });
}

// 2. Bar Chart: Question averages for Communication & PR (WSB vs Sup)
function renderCommunicationBarChart(comItems) {
    const canvas = document.getElementById('chart-bar-communication');
    if (!canvas) return;

    if (AppState.charts.commBar) {
        AppState.charts.commBar.destroy();
    }

    const labels = Array.from({ length: 12 }, (_, i) => `ข้อ ${i + 1}`);

    const calcScores = (items) => {
        if (!items || items.length === 0) return Array(12).fill(0);
        const n = items.length;
        const res = [];
        for (let q = 1; q <= 12; q++) {
            const sum = items.reduce((acc, c) => acc + ((c.answers && c.answers[q]) || 0), 0);
            res.push(parseFloat((sum / n).toFixed(2)));
        }
        return res;
    };

    const datasets = [];

    if (AppState.filter.userType === 'ALL') {
        const comEmp = comItems.filter(x => !isContractorEvaluation(x));
        const comSup = comItems.filter(x => isContractorEvaluation(x));

        datasets.push({
            label: `🏢 พนักงาน WSB (${comEmp.length} คน)`,
            data: calcScores(comEmp),
            backgroundColor: '#0284c7',
            borderRadius: 4
        });

        datasets.push({
            label: `👷 ผู้รับเหมา Sup (${comSup.length} คน)`,
            data: calcScores(comSup),
            backgroundColor: '#f59e0b',
            borderRadius: 4
        });
    } else {
        const isSup = AppState.filter.userType === 'contractor';
        datasets.push({
            label: isSup ? `👷 ผู้รับเหมา Sup (${comItems.length} คน)` : `🏢 พนักงาน WSB (${comItems.length} คน)`,
            data: calcScores(comItems),
            backgroundColor: isSup ? '#f59e0b' : '#0284c7',
            borderRadius: 4
        });
    }

    const ctx = canvas.getContext('2d');
    AppState.charts.commBar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 4,
                    ticks: {
                        stepSize: 1,
                        font: { family: 'Sarabun, sans-serif' }
                    },
                    grid: { color: '#f1f5f9' }
                },
                x: {
                    ticks: { font: { family: 'Sarabun, sans-serif' } },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { font: { family: 'Sarabun, sans-serif', size: 11 }, boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        title: (ctx) => {
                            const idx = ctx[0].dataIndex;
                            return `ข้อที่ ${idx + 1}: ${FORM_COMMUNICATION.questions[idx].text.substring(0, 45)}...`;
                        },
                        label: (ctx) => `${ctx.dataset.label.split('(')[0]}: ${ctx.raw} / 4.0 (${((ctx.raw / 4) * 100).toFixed(0)}%)`
                    }
                }
            }
        }
    });
}

// 3. Doughnut Chart: Distribution of Result Levels
function renderDistributionChart(filtered) {
    const canvas = document.getElementById('chart-donut-distribution');
    if (!canvas) return;

    if (AppState.charts.distribution) {
        AppState.charts.distribution.destroy();
    }

    let counts = {
        'ยอดเยี่ยม / ดีมาก (≥80%)': 0,
        'ดี / เข้าใจดี (65-79%)': 0,
        'พอใช้ / กำลังพัฒนา (45-64%)': 0,
        'ต้องปรับปรุง / เสี่ยง (<45%)': 0
    };

    filtered.forEach(item => {
        const pct = item.percentage;
        if (pct >= 80) counts['ยอดเยี่ยม / ดีมาก (≥80%)']++;
        else if (pct >= 65) counts['ดี / เข้าใจดี (65-79%)']++;
        else if (pct >= 45) counts['พอใช้ / กำลังพัฒนา (45-64%)']++;
        else counts['ต้องปรับปรุง / เสี่ยง (<45%)']++;
    });

    const ctx = canvas.getContext('2d');
    AppState.charts.distribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(counts),
            datasets: [
                {
                    data: Object.values(counts),
                    backgroundColor: ['#059669', '#0284c7', '#f59e0b', '#ef4444'],
                    hoverOffset: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { family: 'Sarabun, sans-serif', size: 11 }, boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${ctx.raw} ชุด (${filtered.length ? ((ctx.raw / filtered.length) * 100).toFixed(0) : 0}%)`
                    }
                }
            },
            cutout: '62%'
        }
    });
}

// 4. Comparison Bar Chart: Employee vs Contractor
function renderEmpCompareChart(filtered) {
    const canvas = document.getElementById('chart-bar-emp-compare');
    if (!canvas) return;

    if (AppState.charts.empCompare) {
        AppState.charts.empCompare.destroy();
    }

    const fsItems = filtered.filter(x => x.formType === 'FM-MR12-MR-01');
    const comItems = filtered.filter(x => x.formType === 'FM-MR14-MR-04');

    // Food safety averages (%)
    const fsEmp = fsItems.filter(x => !isContractorEvaluation(x));
    const fsSup = fsItems.filter(x => isContractorEvaluation(x));
    const fsEmpScore = fsEmp.length ? (fsEmp.reduce((a, c) => a + c.percentage, 0) / fsEmp.length).toFixed(1) : 0;
    const fsSupScore = fsSup.length ? (fsSup.reduce((a, c) => a + c.percentage, 0) / fsSup.length).toFixed(1) : 0;

    // Communication averages (%)
    const comEmp = comItems.filter(x => !isContractorEvaluation(x));
    const comSup = comItems.filter(x => isContractorEvaluation(x));
    const comEmpScore = comEmp.length ? (comEmp.reduce((a, c) => a + c.percentage, 0) / comEmp.length).toFixed(1) : 0;
    const comSupScore = comSup.length ? (comSup.reduce((a, c) => a + c.percentage, 0) / comSup.length).toFixed(1) : 0;

    // Overall averages (%)
    const allEmp = filtered.filter(x => !isContractorEvaluation(x));
    const allSup = filtered.filter(x => isContractorEvaluation(x));
    const allEmpScore = allEmp.length ? (allEmp.reduce((a, c) => a + c.percentage, 0) / allEmp.length).toFixed(1) : 0;
    const allSupScore = allSup.length ? (allSup.reduce((a, c) => a + c.percentage, 0) / allSup.length).toFixed(1) : 0;

    const ctx = canvas.getContext('2d');
    AppState.charts.empCompare = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [
                'ความปลอดภัยอาหาร (FSC)',
                'การสื่อสาร & ประชาสัมพันธ์',
                'ภาพรวมเฉลี่ยทุกแบบประเมิน'
            ],
            datasets: [
                {
                    label: `🏢 พนักงาน WSB (${allEmp.length} คน)`,
                    data: [parseFloat(fsEmpScore), parseFloat(comEmpScore), parseFloat(allEmpScore)],
                    backgroundColor: '#059669',
                    borderRadius: 6
                },
                {
                    label: `👷 ผู้รับเหมา Sup (${allSup.length} คน)`,
                    data: [parseFloat(fsSupScore), parseFloat(comSupScore), parseFloat(allSupScore)],
                    backgroundColor: '#d97706',
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        callback: (v) => v + '%',
                        font: { family: 'Sarabun, sans-serif' }
                    },
                    grid: { color: '#f1f5f9' }
                },
                x: {
                    ticks: { font: { family: 'Sarabun, sans-serif', weight: 'bold' } },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { family: 'Sarabun, sans-serif', size: 12 }, boxWidth: 14 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label.split('(')[0]}: ${ctx.raw}%`
                    }
                }
            }
        }
    });
}

// -------------------------------------------------------------------------
// ADMIN AUTHENTICATION & ACCESS CONTROL FOR DEEP INSIGHTS
// -------------------------------------------------------------------------

function getAdminPassword() {
    return localStorage.getItem('admin_dashboard_pin') || 'admin1234';
}

function setAdminPassword(newPin) {
    localStorage.setItem('admin_dashboard_pin', newPin);
}

function openAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    const err = document.getElementById('modal-admin-lock-error');
    const input = document.getElementById('modal-admin-passcode-input');
    if (err) err.classList.add('hidden');
    if (input) {
        input.value = '';
        input.type = 'password';
    }
    const icon = document.getElementById('modal-admin-pass-toggle-icon');
    if (icon) icon.textContent = '👁️';

    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            if (input) input.focus();
        }, 100);
    }
}

function closeAdminLoginModal() {
    const modal = document.getElementById('admin-login-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function handleAdminLoginModalSubmit(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('modal-admin-passcode-input');
    const err = document.getElementById('modal-admin-lock-error');
    if (!input) return;

    const entered = (input.value || '').trim();
    const correct = getAdminPassword();

    if (entered === correct) {
        AppState.isAdminUnlocked = true;
        sessionStorage.setItem('admin_insights_unlocked', 'true');
        if (err) err.classList.add('hidden');
        closeAdminLoginModal();
        updateAdminInsightsVisibility();
        
        setTimeout(() => {
            const section = document.getElementById('admin-unlocked-container');
            if (section) {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 150);
    } else {
        if (err) {
            err.classList.remove('hidden');
            input.classList.add('border-rose-400', 'ring-2', 'ring-rose-200');
            setTimeout(() => {
                input.classList.remove('border-rose-400', 'ring-2', 'ring-rose-200');
            }, 2000);
        }
        input.focus();
        input.select();
    }
}

function handleAdminUnlock(event) {
    handleAdminLoginModalSubmit(event);
}

function lockAdminInsights() {
    AppState.isAdminUnlocked = false;
    sessionStorage.removeItem('admin_insights_unlocked');
    updateAdminInsightsVisibility();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAdminPassVisibility(inputId, iconId) {
    const input = document.getElementById(inputId || 'modal-admin-passcode-input');
    const icon = document.getElementById(iconId || 'modal-admin-pass-toggle-icon');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.textContent = '🙈';
    } else {
        input.type = 'password';
        if (icon) icon.textContent = '👁️';
    }
}

function scrollToAdminLock() {
    openAdminLoginModal();
}

function openChangePasswordModal() {
    const modal = document.getElementById('change-pass-modal');
    const err = document.getElementById('change-pass-error');
    const succ = document.getElementById('change-pass-success');
    const form = document.getElementById('change-pass-form');
    if (err) err.classList.add('hidden');
    if (succ) succ.classList.add('hidden');
    if (form) form.reset();
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            const oldInp = document.getElementById('input-old-pass');
            if (oldInp) oldInp.focus();
        }, 100);
    }
}

function closeChangePasswordModal() {
    const modal = document.getElementById('change-pass-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function handleChangePassword(event) {
    if (event) event.preventDefault();
    const oldPass = (document.getElementById('input-old-pass')?.value || '').trim();
    const newPass = (document.getElementById('input-new-pass')?.value || '').trim();
    const confirmPass = (document.getElementById('input-confirm-pass')?.value || '').trim();
    const err = document.getElementById('change-pass-error');
    const succ = document.getElementById('change-pass-success');

    if (err) err.classList.add('hidden');
    if (succ) succ.classList.add('hidden');

    if (oldPass !== getAdminPassword()) {
        if (err) {
            err.textContent = '⚠️ รหัสผ่านปัจจุบันไม่ถูกต้อง';
            err.classList.remove('hidden');
        }
        return;
    }

    if (newPass.length < 4) {
        if (err) {
            err.textContent = '⚠️ รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร';
            err.classList.remove('hidden');
        }
        return;
    }

    if (newPass !== confirmPass) {
        if (err) {
            err.textContent = '⚠️ การยืนยันรหัสผ่านใหม่ไม่ตรงกัน';
            err.classList.remove('hidden');
        }
        return;
    }

    setAdminPassword(newPass);
    if (succ) {
        succ.textContent = '✅ บันทึกรหัสผ่านใหม่เรียบร้อยแล้ว!';
        succ.classList.remove('hidden');
    }
    setTimeout(() => {
        closeChangePasswordModal();
    }, 1200);
}

function updateAdminInsightsVisibility() {
    const lockCard = document.getElementById('admin-lock-card');
    const unlockedContainer = document.getElementById('admin-unlocked-container');
    const statusIndicator = document.getElementById('admin-status-indicator');
    const adminToolbarActions = document.getElementById('admin-toolbar-actions');
    const viewerLoginBtn = document.getElementById('viewer-admin-login-btn');

    if (AppState.isAdminUnlocked) {
        if (lockCard) lockCard.classList.add('hidden');
        if (unlockedContainer) unlockedContainer.classList.remove('hidden');
        if (adminToolbarActions) adminToolbarActions.classList.remove('hidden');
        if (viewerLoginBtn) viewerLoginBtn.classList.add('hidden');
        if (statusIndicator) {
            statusIndicator.innerHTML = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-md text-xs font-bold border border-emerald-300">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    🔓 แอดมิน: ปลดล็อกแล้ว
                </span>
            `;
        }
        const filtered = getFilteredEvaluations();
        renderDeptComparisonChart(filtered);
        renderSubmissionsTable();
        renderSuggestionsList();
        setTimeout(() => {
            if (AppState.charts.deptCompare) {
                AppState.charts.deptCompare.resize();
            }
        }, 60);
    } else {
        if (lockCard) lockCard.classList.remove('hidden');
        if (unlockedContainer) unlockedContainer.classList.add('hidden');
        if (adminToolbarActions) adminToolbarActions.classList.add('hidden');
        if (viewerLoginBtn) viewerLoginBtn.classList.remove('hidden');
        if (statusIndicator) {
            statusIndicator.innerHTML = '';
        }
        if (AppState.charts.deptCompare) {
            AppState.charts.deptCompare.destroy();
            AppState.charts.deptCompare = null;
        }
        const tbody = document.getElementById('submissions-tbody');
        if (tbody) tbody.innerHTML = '';
        const sugCont = document.getElementById('suggestions-container');
        if (sugCont) sugCont.innerHTML = '';
    }
}

// 5. Bar Chart: Department Comparison
function renderDeptComparisonChart(filtered) {
    if (!AppState.isAdminUnlocked) {
        if (AppState.charts.deptCompare) {
            AppState.charts.deptCompare.destroy();
            AppState.charts.deptCompare = null;
        }
        return;
    }

    const canvas = document.getElementById('chart-bar-dept-compare');
    if (!canvas) return;

    if (AppState.charts.deptCompare) {
        AppState.charts.deptCompare.destroy();
    }

    // Group average % by department
    const deptMap = {};
    filtered.forEach(item => {
        const d = item.department;
        if (!deptMap[d]) deptMap[d] = { sumPct: 0, count: 0 };
        deptMap[d].sumPct += item.percentage;
        deptMap[d].count++;
    });

    const labels = Object.keys(deptMap);
    const data = labels.map(l => (deptMap[l].sumPct / deptMap[l].count).toFixed(1));

    const ctx = canvas.getContext('2d');
    AppState.charts.deptCompare = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.map(l => l.split('(')[0].trim()), // short name
            datasets: [{
                label: 'คะแนนเฉลี่ยรวม (%)',
                data: data,
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    min: 0,
                    max: 100,
                    ticks: {
                        callback: (v) => v + '%',
                        font: { family: 'Sarabun, sans-serif' }
                    },
                    grid: { color: '#f1f5f9' }
                },
                y: {
                    ticks: { font: { family: 'Sarabun, sans-serif', size: 10 } },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `คะแนนเฉลี่ย: ${ctx.raw}%`
                    }
                }
            }
        }
    });
}

// Render Submissions Table
function renderSubmissionsTable() {
    const tbody = document.getElementById('submissions-tbody');
    if (!tbody) return;

    if (!AppState.isAdminUnlocked) {
        tbody.innerHTML = '';
        return;
    }

    const filtered = getFilteredEvaluations();
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-10 text-slate-400">
                    <div class="flex flex-col items-center justify-center">
                        <span class="text-3xl mb-2">📭</span>
                        <p class="text-sm font-medium">ไม่พบข้อมูลการประเมินตามเงื่อนไขที่ระบุ</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    filtered.forEach((item, idx) => {
        const isFS = item.formType === 'FM-MR12-MR-01';
        const typeBadge = isFS 
            ? '<span class="bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5 rounded">วัฒนธรรมความปลอดภัยอาหาร</span>'
            : '<span class="bg-sky-100 text-sky-800 text-[11px] font-semibold px-2 py-0.5 rounded">การสื่อสาร & ประชาสัมพันธ์</span>';

        const typeInfo = getEvaluatorTypeInfo(item);
        const scoreText = `${item.totalScore} / ${item.maxScore} (${item.percentage}%)`;

        html += `
            <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-sm">
                <td class="py-3 px-3 font-mono text-xs text-slate-500 whitespace-nowrap">${item.date}</td>
                <td class="py-3 px-3 whitespace-nowrap">${typeBadge}</td>
                <td class="py-3 px-3 whitespace-nowrap">
                    <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeInfo.badgeClass}">
                        ${typeInfo.icon} ${typeInfo.shortLabel}
                    </span>
                </td>
                <td class="py-3 px-3 font-medium text-slate-800">${item.department}</td>
                <td class="py-3 px-3 text-slate-600">${item.evaluatorName}</td>
                <td class="py-3 px-3 font-bold text-slate-800 whitespace-nowrap">${scoreText}</td>
                <td class="py-3 px-3 whitespace-nowrap">
                    <span class="text-xs px-2 py-0.5 rounded-full font-medium" style="background-color: ${item.badgeColor}15; color: ${item.badgeColor}; border: 1px solid ${item.badgeColor}40">
                        ${item.level}
                    </span>
                </td>
                <td class="py-3 px-3 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="viewEvaluationDetail('${item.id}')" class="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition" title="ดูรายละเอียด">
                            🔍
                        </button>
                        <button onclick="deleteEvaluation('${item.id}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="ลบข้อมูล">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// Render Suggestions List
function renderSuggestionsList() {
    const container = document.getElementById('suggestions-container');
    if (!container) return;

    if (!AppState.isAdminUnlocked) {
        container.innerHTML = '';
        return;
    }

    const filtered = getFilteredEvaluations();
    const withComments = filtered.filter(x => (x.comments && x.comments.trim().length > 0) || (x.itemComments && Object.keys(x.itemComments).length > 0));

    if (withComments.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center text-slate-400">
                <span class="text-2xl block mb-1">💬</span>
                <p class="text-xs">ยังไม่มีข้อเสนอแนะเพิ่มเติมจากผู้ประเมิน</p>
            </div>
        `;
        return;
    }

    let html = '<div class="space-y-3 p-4">';
    withComments.forEach(item => {
        const isFS = item.formType === 'FM-MR12-MR-01';
        const typeInfo = getEvaluatorTypeInfo(item);
        html += `
            <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-xs md:text-sm">
                <div class="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeInfo.badgeClass}">
                            ${typeInfo.icon} ${typeInfo.shortLabel}
                        </span>
                        <span class="font-bold text-slate-800">${item.department}</span>
                        <span class="text-slate-400 text-[11px]">• ${item.evaluatorName}</span>
                    </div>
                    <span class="text-[11px] text-slate-500 font-mono">${item.date}</span>
                </div>
        `;

        if (item.comments) {
            html += `<p class="text-slate-700 leading-relaxed font-normal bg-white p-2.5 rounded-lg border border-slate-100 shadow-2xs">${item.comments}</p>`;
        }

        if (item.itemComments && Object.keys(item.itemComments).length > 0) {
            html += `<div class="mt-2 space-y-1">`;
            for (const [qid, comm] of Object.entries(item.itemComments)) {
                html += `
                    <div class="text-[11px] text-sky-800 bg-sky-50/80 p-1.5 rounded">
                        <span class="font-bold">ข้อ ${qid}:</span> ${comm}
                    </div>
                `;
            }
            html += `</div>`;
        }

        html += `</div>`;
    });
    html += '</div>';

    container.innerHTML = html;
}

// View Evaluation Detail Modal
function viewEvaluationDetail(id) {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาปลดล็อกรหัสผ่านแอดมินก่อนเข้าดูรายละเอียด");
        scrollToAdminLock();
        return;
    }

    const item = AppState.evaluations.find(x => x.id === id);
    if (!item) return;

    const modal = document.getElementById('detail-modal');
    const content = document.getElementById('detail-modal-content');
    if (!modal || !content) return;

    const isFS = item.formType === 'FM-MR12-MR-01';
    const typeInfo = getEvaluatorTypeInfo(item);

    let questionsHtml = '';
    if (isFS) {
        FORM_FOOD_SAFETY.sections.forEach(sec => {
            questionsHtml += `
                <div class="mt-4 mb-2 font-bold text-sm text-emerald-800 border-b border-emerald-100 pb-1">
                    ${sec.name}
                </div>
            `;
            sec.questions.forEach(q => {
                const ans = item.answers[q.id];
                questionsHtml += `
                    <div class="flex items-center justify-between py-2 border-b border-slate-100 text-xs md:text-sm">
                        <span class="text-slate-700 pr-2">${q.id}. ${q.text}</span>
                        <span class="flex-shrink-0 font-bold px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800">${ans} / 5</span>
                    </div>
                `;
            });
        });
    } else {
        FORM_COMMUNICATION.questions.forEach(q => {
            const ans = item.answers[q.id];
            const itemComm = (item.itemComments && item.itemComments[q.id]) ? `<div class="text-xs text-sky-700 mt-0.5">ข้อเสนอแนะ: ${item.itemComments[q.id]}</div>` : '';
            questionsHtml += `
                <div class="py-2 border-b border-slate-100 text-xs md:text-sm">
                    <div class="flex items-center justify-between">
                        <span class="text-slate-700 pr-2">${q.id}. ${q.text}</span>
                        <span class="flex-shrink-0 font-bold px-2.5 py-1 rounded-md bg-sky-100 text-sky-800">${ans} / 4</span>
                    </div>
                    ${itemComm}
                </div>
            `;
        });
    }

    content.innerHTML = `
        <div class="p-6">
            <div class="flex items-start justify-between border-b border-slate-200 pb-4 mb-4">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-mono font-bold text-slate-500 uppercase">${item.formType}</span>
                        <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeInfo.badgeClass}">
                            ${typeInfo.icon} ${typeInfo.label}
                        </span>
                    </div>
                    <h3 class="text-lg font-bold text-slate-800 mt-1">${item.formTitle}</h3>
                    <p class="text-xs text-slate-500 mt-0.5">วันที่ประเมิน: ${item.date} | แผนก: ${item.department} | ผู้ประเมิน: ${item.evaluatorName}</p>
                </div>
                <button onclick="closeDetailModal()" class="text-slate-400 hover:text-slate-600 text-2xl font-bold">&times;</button>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl mb-4 border border-slate-200">
                <div>
                    <span class="text-[11px] text-slate-500 block">คะแนนที่ได้</span>
                    <span class="text-base font-bold text-slate-800">${item.totalScore} / ${item.maxScore}</span>
                </div>
                <div>
                    <span class="text-[11px] text-slate-500 block">คิดเป็นร้อยละ</span>
                    <span class="text-base font-bold text-emerald-600">${item.percentage}%</span>
                </div>
                <div>
                    <span class="text-[11px] text-slate-500 block">ระดับผลการประเมิน</span>
                    <span class="text-xs font-bold px-2 py-0.5 rounded-full inline-block mt-0.5" style="background-color: ${item.badgeColor}20; color: ${item.badgeColor}">${item.level}</span>
                </div>
            </div>

            <div class="max-h-96 overflow-y-auto pr-2 mb-4">
                <h4 class="font-bold text-sm text-slate-700 mb-2">คะแนนการประเมินรายข้อ:</h4>
                ${questionsHtml}
            </div>

            ${item.comments ? `
                <div class="p-3 bg-amber-50 rounded-lg border border-amber-200 mb-4">
                    <span class="text-xs font-bold text-amber-800 block mb-1">ข้อเสนอแนะเพิ่มเติม:</span>
                    <p class="text-xs text-amber-900 leading-relaxed">${item.comments}</p>
                </div>
            ` : ''}

            <div class="flex justify-end pt-3 border-t border-slate-100">
                <button onclick="closeDetailModal()" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-sm rounded-lg transition">ปิดหน้าต่าง</button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeDetailModal() {
    const modal = document.getElementById('detail-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Delete single evaluation
async function deleteEvaluation(id) {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาปลดล็อกรหัสผ่านแอดมินก่อนลบข้อมูล");
        scrollToAdminLock();
        return;
    }
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลชุดนี้?")) return;

    // 1. Remove from local AppState and LocalStorage
    AppState.evaluations = AppState.evaluations.filter(x => x.id !== id);
    saveEvaluations();
    updateDashboardMetrics();
    renderDashboardCharts();
    if (AppState.isAdminUnlocked) {
        renderSubmissionsTable();
        renderSuggestionsList();
    }
    updateCounterBadges();

    // 2. Delete from Cloud Firestore (Permanent)
    if (typeof deleteEvaluationFromCloud === 'function') {
        try {
            await deleteEvaluationFromCloud(id);
        } catch (e) {
            console.warn("Cloud deletion error:", e);
        }
    }

    // 3. Delete from Local Server API fallback
    try {
        await fetch(`/api/evaluations/${id}`, { method: 'DELETE' });
    } catch (e) {}
}

// Reset / Clear All Data
async function clearAllEvaluations() {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาปลดล็อกรหัสผ่านแอดมินก่อนล้างข้อมูล");
        scrollToAdminLock();
        return;
    }
    if (!confirm("⚠️ คำเตือน: คุณต้องการลบข้อมูลการประเมินทั้งหมดอย่างถาวรใช่หรือไม่? ข้อมูลในระบบและบนคลาวด์จะถูกลบทั้งหมด")) return;

    // 1. Clear local AppState and LocalStorage
    AppState.evaluations = [];
    saveEvaluations();
    updateDashboardMetrics();
    renderDashboardCharts();
    if (AppState.isAdminUnlocked) {
        renderSubmissionsTable();
        renderSuggestionsList();
    }
    updateCounterBadges();

    // 2. Clear from Cloud Firestore (Permanent)
    if (typeof clearAllEvaluationsFromCloud === 'function') {
        try {
            await clearAllEvaluationsFromCloud();
        } catch (e) {
            console.warn("Cloud clear all error:", e);
        }
    }

    // 3. Clear from Local Server API fallback
    try {
        await fetch('/api/evaluations', { method: 'DELETE' });
    } catch (e) {}

    alert("ล้างข้อมูลการประเมินทั้งหมดเรียบร้อยแล้ว");
}

// Update Header Counter Badges
function updateCounterBadges() {
    const totalCount = AppState.evaluations.length;
    const badge = document.getElementById('nav-total-count');
    if (badge) {
        badge.textContent = totalCount;
        badge.classList.toggle('hidden', totalCount === 0);
    }
}

// -------------------------------------------------------------------------
// EXPORT & IMPORT & PRINT
// -------------------------------------------------------------------------

// Export to Excel (.xlsx) using SheetJS
function exportToExcel() {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาเข้าสู่ระบบแอดมินก่อนส่งออกไฟล์ Excel");
        scrollToAdminLock();
        return;
    }

    if (typeof XLSX === 'undefined') {
        alert("กำลังโหลดโมดูล Excel กรุณาลองใหม่อีกครั้ง");
        return;
    }

    const filtered = getFilteredEvaluations();
    if (filtered.length === 0) {
        alert("ไม่มีข้อมูลที่จะส่งออก");
        return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Food Safety Culture Sheet
    const fsData = filtered.filter(x => x.formType === 'FM-MR12-MR-01').map((item, idx) => {
        const row = {
            'ลำดับ': idx + 1,
            'วันที่ประเมิน': item.date,
            'ประเภทผู้ประเมิน': getEvaluatorTypeInfo(item).label,
            'แผนก': item.department,
            'ผู้ประเมิน': item.evaluatorName,
            'คะแนนรวม (เต็ม 100)': item.totalScore,
            'ระดับการยอมรับ': item.level,
            'ข้อเสนอแนะ': item.comments || ''
        };
        for (let i = 1; i <= 20; i++) {
            row[`ข้อ ${i}`] = (item.answers && item.answers[i]) || '';
        }
        return row;
    });

    if (fsData.length > 0) {
        const wsFS = XLSX.utils.json_to_sheet(fsData);
        XLSX.utils.book_append_sheet(wb, wsFS, "Food Safety Culture");
    }

    // 2. Communication Sheet
    const comData = filtered.filter(x => x.formType === 'FM-MR14-MR-04').map((item, idx) => {
        const row = {
            'ลำดับ': idx + 1,
            'วันที่ประเมิน': item.date,
            'ประเภทผู้ประเมิน': getEvaluatorTypeInfo(item).label,
            'สายงาน': item.group || '',
            'ฝ่าย': item.division || '',
            'แผนก': item.department,
            'ผู้ประเมิน': item.evaluatorName,
            'คะแนนที่ได้ (เต็ม 48)': item.totalScore,
            'ร้อยละ (%)': item.percentage,
            'ระดับผลการประเมิน': item.level,
            'ข้อเสนอแนะเพิ่มเติม': item.comments || ''
        };
        for (let i = 1; i <= 12; i++) {
            row[`ข้อ ${i}`] = (item.answers && item.answers[i]) || '';
            if (item.itemComments && item.itemComments[i]) {
                row[`ข้อเสนอแนะข้อ ${i}`] = item.itemComments[i];
            }
        }
        return row;
    });

    if (comData.length > 0) {
        const wsCom = XLSX.utils.json_to_sheet(comData);
        XLSX.utils.book_append_sheet(wb, wsCom, "การสื่อสารและประชาสัมพันธ์");
    }

    const filename = `ESC_Evaluation_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
}

// Print / PDF format
function printDashboardReport() {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาเข้าสู่ระบบแอดมินก่อนพิมพ์รายงาน");
        scrollToAdminLock();
        return;
    }
    window.print();
}

// Export JSON Backup
function exportJSONBackup() {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาเข้าสู่ระบบแอดมินก่อนสำรองข้อมูล");
        scrollToAdminLock();
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(AppState.evaluations, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ESC_Evaluation_Backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

// Import JSON Backup
function importJSONBackup(event) {
    if (!AppState.isAdminUnlocked) {
        alert("🔒 ส่วนนี้สงวนสิทธิ์เฉพาะผู้ดูแลระบบ: กรุณาเข้าสู่ระบบแอดมินก่อนนำเข้าข้อมูล");
        scrollToAdminLock();
        return;
    }
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                AppState.evaluations = imported;
                saveEvaluations();
                updateDashboardMetrics();
                renderDashboardCharts();
                updateAdminInsightsVisibility();
                alert(`นำเข้าข้อมูลเรียบร้อยแล้ว จำนวน ${imported.length} รายการ`);
            } else {
                alert("รูปแบบไฟล์ไม่ถูกต้อง");
            }
        } catch (err) {
            alert("เกิดข้อผิดพลาดในการอ่านไฟล์ JSON");
        }
    };
    reader.readAsText(file);
}

// -------------------------------------------------------------------------
// SAMPLE DEMO DATA GENERATOR
// -------------------------------------------------------------------------

function generateSampleData(notify = true) {
    const demoEntries = [];
    const now = new Date();

    const sampleSuggestionsFS = [
        "ควรเพิ่มการอบรมเชิงปฏิบัติการเรื่อง Food Safety ให้กับพนักงานกะดึกเพิ่มขึ้น",
        "อุปกรณ์ล้างมือก่อนเข้าไลน์ผลิตควรมีสบู่เหลวและกระดาษเช็ดมือเติมสม่ำเสมอยิ่งขึ้น",
        "ป้ายประชาสัมพันธ์นโยบายความปลอดภัยอาหารมีความชัดเจนดีมาก",
        "อยากให้จัดกิจกรรมประกวด 5ส และ Food Safety Culture ประจำปีเพื่อกระตุ้นจิตสำนึก",
        "ระบบการรายงานปัญหาผ่านหัวหน้างานมีความสะดวกรวดเร็วดีครับ",
        "พื้นที่จัดเก็บสารเคมีควรมีป้ายสัญลักษณ์เตือนภัยเป็น 2 ภาษา",
        ""
    ];

    const sampleSuggestionsCom = [
        "ช่องทางการสื่อสารทางเสียงตามสายมีความชัดเจนดี",
        "ควรเพิ่มการส่งข่าวสารและ KPI ทางกลุ่ม Line หรือจอ Digital Signage หน้าโรงอาหาร",
        "การจัดกิจกรรมด้านสิ่งแวดล้อมกับชุมชนรอบโรงงานทำให้ความสัมพันธ์ดีขึ้นมาก",
        "อยากให้มีการสรุปผลการประชุมทบทวนระบบบริหารงานคุณภาพติดบอร์ดประชาสัมพันธ์",
        ""
    ];

    const wsbs = (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE))
        ? EMPLOYEE_DATABASE.filter(e => e.sheet === 'wsb')
        : [];
    const sups = (typeof EMPLOYEE_DATABASE !== 'undefined' && Array.isArray(EMPLOYEE_DATABASE))
        ? EMPLOYEE_DATABASE.filter(e => e.sheet === 'Sup' || e.sheet === 'sup')
        : [];

    // Generate 16 Food Safety evaluations (11 WSB employees + 5 Sup contractors)
    for (let i = 0; i < 16; i++) {
        const isSup = i >= 11;
        const d = new Date(now.getTime() - (i * 1.5 * 24 * 60 * 60 * 1000));
        
        let deptName = 'ผลิต';
        let divisionName = '-';
        let evaluatorName = `พนักงานตัวอย่าง ${i + 1}`;
        let employeeId = '455636';

        if (isSup && sups.length > 0) {
            const supObj = sups[(i - 11) % sups.length];
            evaluatorName = `${supObj.fullName} (ผู้รับเหมา)`;
            deptName = supObj.dept || 'ผรม. ทำความสะอาด';
            divisionName = supObj.division || 'บริการภายนอก';
            employeeId = supObj.id || 'ผู้รับเหมา';
        } else if (wsbs.length > 0) {
            const wsbObj = wsbs[i % wsbs.length];
            evaluatorName = `${wsbObj.fullName} (${wsbObj.id})`;
            deptName = wsbObj.dept || 'ผลิต';
            divisionName = wsbObj.division || '-';
            employeeId = wsbObj.id;
        }

        const answers = {};
        let total = 0;

        for (let q = 1; q <= 20; q++) {
            const r = Math.random();
            const val = r > 0.45 ? 5 : (r > 0.15 ? 4 : 3);
            answers[q] = val;
            total += val;
        }

        const lvl = getFoodSafetyLevel(total);
        const dimensionScores = {
            leadership: (answers[1] + answers[2] + answers[3]) / 3,
            participation: (answers[4] + answers[5] + answers[6]) / 3,
            communication: (answers[7] + answers[8] + answers[9]) / 3,
            responsibility: (answers[10] + answers[11] + answers[12]) / 3,
            competence: (answers[13] + answers[14] + answers[15] + answers[16]) / 4,
            environment: (answers[17] + answers[18] + answers[19] + answers[20]) / 4
        };

        demoEntries.push({
            id: 'DEMO-FS-' + (i + 1),
            timestamp: d.toISOString(),
            formType: 'FM-MR12-MR-01',
            formTitle: FORM_FOOD_SAFETY.title,
            evaluatorType: isSup ? 'contractor' : 'employee',
            evaluatorTypeLabel: isSup ? 'ผู้รับเหมา (Sup)' : 'พนักงาน (WSB)',
            date: d.toISOString().split('T')[0],
            department: deptName,
            division: divisionName,
            employeeId: employeeId,
            evaluatorName: evaluatorName,
            answers: answers,
            dimensionScores: dimensionScores,
            totalScore: total,
            maxScore: 100,
            percentage: total,
            level: lvl.level,
            badgeColor: lvl.badgeColor,
            comments: sampleSuggestionsFS[i % sampleSuggestionsFS.length]
        });
    }

    // Generate 14 Communication evaluations (9 WSB employees + 5 Sup contractors)
    for (let i = 0; i < 14; i++) {
        const isSup = i >= 9;
        const d = new Date(now.getTime() - (i * 2 * 24 * 60 * 60 * 1000));

        let deptName = 'บุคคลและธุรการ';
        let divisionName = '-';
        let evaluatorName = `พนักงานตัวอย่าง ${i + 17}`;
        let employeeId = '589280';

        if (isSup && sups.length > 0) {
            const supObj = sups[(i - 9 + 5) % sups.length];
            evaluatorName = `${supObj.fullName} (ผู้รับเหมา)`;
            deptName = supObj.dept || 'ผรม. ซ่อมบำรุง';
            divisionName = supObj.division || 'บริการภายนอก';
            employeeId = supObj.id || 'ผู้รับเหมา';
        } else if (wsbs.length > 0) {
            const wsbObj = wsbs[(i + 15) % wsbs.length];
            evaluatorName = `${wsbObj.fullName} (${wsbObj.id})`;
            deptName = wsbObj.dept || 'บุคคลและธุรการ';
            divisionName = wsbObj.division || '-';
            employeeId = wsbObj.id;
        }

        const answers = {};
        let total = 0;

        for (let q = 1; q <= 12; q++) {
            const r = Math.random();
            const val = r > 0.5 ? 4 : (r > 0.15 ? 3 : 2);
            answers[q] = val;
            total += val;
        }

        const pct = parseFloat(((total / 48) * 100).toFixed(2));
        const lvl = getCommunicationLevel(pct);

        demoEntries.push({
            id: 'DEMO-COM-' + (i + 1),
            timestamp: d.toISOString(),
            formType: 'FM-MR14-MR-04',
            formTitle: FORM_COMMUNICATION.title,
            evaluatorType: isSup ? 'contractor' : 'employee',
            evaluatorTypeLabel: isSup ? 'ผู้รับเหมา (Sup)' : 'พนักงาน (WSB)',
            date: d.toISOString().split('T')[0],
            group: 'ผลิตน้ำตาลวังสมบูรณ์',
            division: divisionName,
            department: deptName,
            employeeId: employeeId,
            evaluatorName: evaluatorName,
            answers: answers,
            itemComments: {},
            totalScore: total,
            maxScore: 48,
            percentage: pct,
            level: lvl.level,
            badgeColor: lvl.badgeColor,
            comments: sampleSuggestionsCom[i % sampleSuggestionsCom.length]
        });
    }

    AppState.evaluations = demoEntries;
    saveEvaluations();
    updateDashboardMetrics();
    renderDashboardCharts();
    updateAdminInsightsVisibility();

    if (notify) {
        alert("โหลดข้อมูลตัวอย่างจำลองสำเร็จ (30 รายการ: พนักงาน 20 คน, ผู้รับเหมา 10 คน) เพื่อแสดงผลแดชบอร์ด!");
    }
}

// -------------------------------------------------------------------------
// EVENT LISTENERS & SETUP
// -------------------------------------------------------------------------

function setupEventListeners() {
    // Form submits
    const form1 = document.getElementById('form1-element');
    if (form1) form1.addEventListener('submit', handleForm1Submit);

    const form2 = document.getElementById('form2-element');
    if (form2) form2.addEventListener('submit', handleForm2Submit);

    // Dashboard filters
    const filterFormType = document.getElementById('filter-form-type');
    if (filterFormType) {
        filterFormType.addEventListener('change', (e) => {
            AppState.filter.formType = e.target.value;
            refreshDashboard();
        });
    }

    const filterUserType = document.getElementById('filter-user-type');
    if (filterUserType) {
        filterUserType.addEventListener('change', (e) => {
            AppState.filter.userType = e.target.value;
            refreshDashboard();
        });
    }

    const filterDept = document.getElementById('filter-dept');
    if (filterDept) {
        filterDept.addEventListener('change', (e) => {
            AppState.filter.department = e.target.value;
            refreshDashboard();
        });
    }

    const filterStart = document.getElementById('filter-start-date');
    if (filterStart) {
        filterStart.addEventListener('change', (e) => {
            AppState.filter.startDate = e.target.value;
            refreshDashboard();
        });
    }

    const filterEnd = document.getElementById('filter-end-date');
    if (filterEnd) {
        filterEnd.addEventListener('change', (e) => {
            AppState.filter.endDate = e.target.value;
            refreshDashboard();
        });
    }

    const filterSearch = document.getElementById('filter-search');
    if (filterSearch) {
        filterSearch.addEventListener('input', (e) => {
            AppState.filter.search = e.target.value.trim();
            if (AppState.isAdminUnlocked) {
                renderSubmissionsTable();
                renderSuggestionsList();
            }
        });
    }

    // Modal close buttons
    const btnCloseModal = document.getElementById('btn-close-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeSuccessModal);

    const btnModalGoDashboard = document.getElementById('btn-modal-go-dashboard');
    if (btnModalGoDashboard) {
        btnModalGoDashboard.addEventListener('click', () => {
            closeSuccessModal();
            switchTab('dashboard');
        });
    }

    const btnModalGoNext = document.getElementById('btn-modal-go-next');
    if (btnModalGoNext) {
        btnModalGoNext.addEventListener('click', () => {
            closeSuccessModal();
            const current = AppState.currentTab;
            if (current === 'form1') switchTab('form2');
            else switchTab('form1');
        });
    }

    // Top action buttons
    const btnDemo = document.getElementById('btn-load-demo');
    if (btnDemo) btnDemo.addEventListener('click', () => generateSampleData(true));

    const btnClear = document.getElementById('btn-clear-data');
    if (btnClear) btnClear.addEventListener('click', clearAllEvaluations);

    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) btnExportExcel.addEventListener('click', exportToExcel);

    const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) btnPrint.addEventListener('click', printDashboardReport);

    const btnBackup = document.getElementById('btn-backup-json');
    if (btnBackup) btnBackup.addEventListener('click', exportJSONBackup);

    const fileImport = document.getElementById('input-import-json');
    if (fileImport) fileImport.addEventListener('change', importJSONBackup);

    // Escape key listener to close active modals
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeEmpIdModal();
            closeSuccessModal();
            closeDetailModal();
            closeChangePasswordModal();
            closeAdminLoginModal();
            closeQRModal();
            closeEmpNotFoundModal();
            closeNewEmployeeModal();
        }
    });

    // Real-time error clearance for employee ID input
    const inputEmpId = document.getElementById('input-emp-id');
    if (inputEmpId) {
        inputEmpId.addEventListener('input', () => {
            const err = document.getElementById('emp-id-error');
            if (err) err.classList.add('hidden');
        });
    }
}

function refreshDashboard() {
    updateDashboardMetrics();
    renderDashboardCharts();
    updateAdminInsightsVisibility();
}

// -------------------------------------------------------------------------
// QR CODE & EVALUATION ACCESS LINKS MANAGEMENT
// -------------------------------------------------------------------------

const QR_CONFIG = {
    currentTarget: 'portal',
    hostMode: 'cloud', // 'cloud' | 'lan' | 'current'
    cloudHost: 'https://nnatayacc-code.github.io/Satisfaction-Evaluation-ESCWSB/',
    lanHost: '192.168.121.65:8088',
    targets: {
        portal: {
            title: 'หน้าหลักรวมระบบแบบประเมินพนักงาน',
            desc: 'ให้พนักงานเลือกทำได้ทั้งแบบประเมิน Food Safety และ การสื่อสารประชาสัมพันธ์',
            icon: '🌐',
            path: '',
            localImage: 'assets/qrcode_portal.png',
            badge: 'รวม 2 แบบประเมิน'
        },
        form1: {
            title: 'แบบสอบถามการประเมินตนเอง วัฒนธรรมความปลอดภัยอาหาร',
            desc: 'Food Safety Culture (FM-MR12-MR-01) 20 ข้อคำถาม • เต็ม 100 คะแนน',
            icon: '🥗',
            path: '?form=form1',
            localImage: 'assets/qrcode_food_safety.png',
            badge: 'FM-MR12-MR-01'
        },
        form2: {
            title: 'แบบประเมินการสื่อสารและประชาสัมพันธ์องค์กร',
            desc: 'Communication & PR (FM-MR14-MR-04) 12 ข้อคำถาม • เต็ม 48 คะแนน',
            icon: '📢',
            path: '?form=form2',
            localImage: 'assets/qrcode_communication.png',
            badge: 'FM-MR14-MR-04'
        }
    }
};

function getEvaluationUrl(targetKey) {
    const target = QR_CONFIG.targets[targetKey] || QR_CONFIG.targets.portal;

    // If currently accessed via GitHub Pages or any live domain, prioritize current live URL
    if (window.location && window.location.origin && window.location.origin.startsWith('http') && !window.location.origin.includes('localhost') && !window.location.origin.includes('127.0.0.1')) {
        let liveBase = window.location.origin + window.location.pathname;
        if (!liveBase.endsWith('/') && !liveBase.endsWith('.html')) liveBase += '/';
        return target.path ? `${liveBase}${target.path}` : liveBase;
    }

    if (QR_CONFIG.hostMode === 'cloud' && QR_CONFIG.cloudHost) {
        let cloudBase = QR_CONFIG.cloudHost;
        if (!cloudBase.endsWith('/')) cloudBase += '/';
        return target.path ? `${cloudBase}${target.path}` : cloudBase;
    }

    const protocol = (window.location && window.location.protocol && window.location.protocol.startsWith('http')) 
        ? window.location.protocol 
        : 'http:';

    let host = QR_CONFIG.lanHost;
    if (QR_CONFIG.hostMode === 'current') {
        if (window.location && window.location.host && !window.location.host.includes('null')) {
            host = window.location.host;
        }
    }

    let pathname = (window.location && window.location.pathname) ? window.location.pathname : '/';
    if (!pathname.endsWith('/') && !pathname.endsWith('.html')) {
        pathname += '/';
    }

    const lanBase = `${protocol}//${host}${pathname}`;
    return target.path ? `${lanBase}${target.path}` : lanBase;
}

function openQRModal(target = 'portal') {
    const modal = document.getElementById('qr-modal');
    if (!modal) return;

    // Detect if current browser is running on another host
    const curHostDisp = document.getElementById('current-host-display');
    if (curHostDisp && window.location.host) {
        curHostDisp.textContent = window.location.host;
    }

    selectQRTarget(target);
    modal.classList.remove('hidden');
}

function closeQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) modal.classList.add('hidden');
}

function selectQRTarget(targetKey) {
    if (!QR_CONFIG.targets[targetKey]) targetKey = 'portal';
    QR_CONFIG.currentTarget = targetKey;

    // Update active tab styles
    const tabs = ['portal', 'form1', 'form2'];
    tabs.forEach(key => {
        const btn = document.getElementById(`qr-tab-${key}`);
        if (!btn) return;
        if (key === targetKey) {
            btn.className = 'py-2 px-2 rounded-lg transition text-center cursor-pointer bg-white text-emerald-800 shadow-xs font-bold';
        } else {
            btn.className = 'py-2 px-2 rounded-lg transition text-center cursor-pointer text-slate-600 hover:text-slate-900 font-medium';
        }
    });

    // Update target banner
    const target = QR_CONFIG.targets[targetKey];
    const bannerTitle = document.getElementById('qr-target-title');
    const bannerDesc = document.getElementById('qr-target-desc');
    const bannerIcon = document.getElementById('qr-target-icon');
    if (bannerTitle) bannerTitle.textContent = target.title;
    if (bannerDesc) bannerDesc.textContent = target.desc;
    if (bannerIcon) bannerIcon.textContent = target.icon;

    updateQRDisplay();
}

function onQRHostModeChange(mode) {
    QR_CONFIG.hostMode = mode;
    updateQRDisplay();
}

function updateQRDisplay() {
    const target = QR_CONFIG.targets[QR_CONFIG.currentTarget] || QR_CONFIG.targets.portal;
    const url = getEvaluationUrl(QR_CONFIG.currentTarget);

    // Update input URL
    const urlInput = document.getElementById('qr-url-input');
    if (urlInput) {
        urlInput.value = url;
    }

    // Update QR image
    const qrImg = document.getElementById('qr-code-img');
    if (qrImg) {
        if (QR_CONFIG.hostMode === 'cloud') {
            qrImg.src = target.localImage;
        } else {
            // Generate dynamically via QR API
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=15&data=${encodeURIComponent(url)}`;
            qrImg.onerror = () => {
                qrImg.src = target.localImage;
            };
        }
    }
}

function copyEvaluationLink() {
    const urlInput = document.getElementById('qr-url-input');
    if (!urlInput) return;

    const url = urlInput.value;
    const btn = document.getElementById('btn-copy-qr-url');
    const icon = document.getElementById('copy-btn-icon');
    const text = document.getElementById('copy-btn-text');

    const onSuccess = () => {
        if (icon) icon.textContent = '✅';
        if (text) text.textContent = 'คัดลอกสำเร็จ!';
        if (btn) {
            btn.classList.remove('bg-emerald-700', 'hover:bg-emerald-800');
            btn.classList.add('bg-emerald-600');
        }
        setTimeout(() => {
            if (icon) icon.textContent = '📋';
            if (text) text.textContent = 'คัดลอกลิงก์';
            if (btn) {
                btn.classList.remove('bg-emerald-600');
                btn.classList.add('bg-emerald-700', 'hover:bg-emerald-800');
            }
        }, 2200);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
            urlInput.select();
            document.execCommand('copy');
            onSuccess();
        });
    } else {
        urlInput.select();
        document.execCommand('copy');
        onSuccess();
    }
}

function downloadQRCodeImage() {
    const target = QR_CONFIG.targets[QR_CONFIG.currentTarget] || QR_CONFIG.targets.portal;
    const qrImg = document.getElementById('qr-code-img');
    const imgSrc = qrImg ? qrImg.src : target.localImage;

    const a = document.createElement('a');
    a.href = imgSrc;
    a.download = `qrcode_${QR_CONFIG.currentTarget}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function printQRCodePoster() {
    const target = QR_CONFIG.targets[QR_CONFIG.currentTarget] || QR_CONFIG.targets.portal;
    const url = getEvaluationUrl(QR_CONFIG.currentTarget);
    const qrImg = document.getElementById('qr-code-img');
    const qrSrc = qrImg ? qrImg.src : target.localImage;

    const printWin = window.open('', '_blank', 'width=850,height=1000');
    if (!printWin) {
        alert("กรุณาอนุญาต Pop-up เพื่อพิมพ์เอกสารโปสเตอร์ QR Code");
        return;
    }

    printWin.document.write(`
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <title>พิมพ์โปสเตอร์ QR Code - ${target.title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4 portrait;
            margin: 15mm;
        }
        * {
            box-sizing: border-box;
            font-family: 'Sarabun', sans-serif;
        }
        body {
            margin: 0;
            padding: 24px;
            color: #1e293b;
            background: #fff;
            text-align: center;
        }
        .poster-card {
            border: 3px solid #059669;
            border-radius: 24px;
            padding: 36px 28px;
            max-width: 680px;
            margin: 0 auto;
            background: #ffffff;
            box-shadow: 0 4px 20px rgba(0,0,0,0.06);
        }
        .company-header {
            border-bottom: 2px dashed #cbd5e1;
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        .company-name {
            font-size: 20px;
            font-weight: 800;
            color: #065f46;
            margin-bottom: 4px;
        }
        .company-sub {
            font-size: 13px;
            color: #64748b;
        }
        .badge-pill {
            display: inline-block;
            background: #ecfdf5;
            color: #047857;
            border: 1px solid #a7f3d0;
            font-weight: 700;
            font-size: 13px;
            padding: 5px 14px;
            border-radius: 9999px;
            margin-bottom: 14px;
        }
        .eval-title {
            font-size: 24px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 10px 0;
            line-height: 1.35;
        }
        .eval-desc {
            font-size: 14px;
            color: #475569;
            max-width: 520px;
            margin: 0 auto 24px auto;
            line-height: 1.5;
        }
        .qr-wrapper {
            background: #f8fafc;
            border: 2px solid #e2e8f0;
            border-radius: 20px;
            padding: 20px;
            display: inline-block;
            margin-bottom: 20px;
        }
        .qr-wrapper img {
            width: 250px;
            height: 250px;
            display: block;
            margin: 0 auto;
        }
        .scan-cta {
            font-size: 18px;
            font-weight: 800;
            color: #059669;
            margin-bottom: 6px;
        }
        .scan-sub {
            font-size: 13px;
            color: #64748b;
            margin-bottom: 18px;
        }
        .url-box {
            background: #f1f5f9;
            border-radius: 10px;
            padding: 8px 14px;
            font-family: monospace;
            font-size: 12px;
            color: #334155;
            display: inline-block;
            margin-bottom: 24px;
            word-break: break-all;
        }
        .instructions {
            text-align: left;
            background: #f8fafc;
            border-left: 4px solid #059669;
            border-radius: 8px;
            padding: 12px 18px;
            font-size: 12px;
            color: #334155;
            line-height: 1.6;
        }
        .instructions strong {
            color: #0f172a;
        }
        @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
            .poster-card { box-shadow: none; border-width: 2.5px; }
        }
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom: 16px;">
        <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:10px 24px;font-size:14px;font-weight:bold;border-radius:8px;cursor:pointer;">
            🖨️ กดสั่งพิมพ์หน้านี้ (Print Poster)
        </button>
        <button onclick="window.close()" style="background:#e2e8f0;color:#334155;border:none;padding:10px 18px;font-size:14px;font-weight:bold;border-radius:8px;cursor:pointer;margin-left:8px;">
            ปิดหน้าต่าง
        </button>
    </div>

    <div class="poster-card">
        <div class="company-header">
            <div class="company-name">🏢 บริษัท น้ำตาลและอ้อยตะวันออก จำกัด (มหาชน)</div>
            <div class="company-sub">Eastern Sugar and Cane Public Company Limited</div>
        </div>

        <div class="badge-pill">📌 ${target.badge}</div>
        <h1 class="eval-title">${target.title}</h1>
        <p class="eval-desc">${target.desc}</p>

        <div class="qr-wrapper">
            <img src="${qrSrc}" alt="QR Code">
        </div>

        <div class="scan-cta">📱 สแกน QR Code ด้วยมือถือเพื่อทำแบบประเมิน</div>
        <div class="scan-sub">เปิดกล้องมือถือ หรือเปิดแอป LINE แล้วสแกนภาพด้านบน</div>

        <div>
            <div class="url-box">🔗 ${url}</div>
        </div>

        <div class="instructions">
            <strong>📋 ขั้นตอนการเข้าทำแบบประเมิน:</strong><br>
            1. สแกน QR Code ด้านบน หรือพิมพ์ลิงก์เปิดในเว็บเบราว์เซอร์<br>
            2. พนักงานกรอก <strong>รหัสพนักงาน</strong> / ผู้รับเหมาเลือกชื่อสังกัดบริษัท<br>
            3. ตอบแบบประเมินและกด <strong>"ส่งแบบประเมิน"</strong> ได้ทันที
        </div>
    </div>

    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 600);
        };
    </script>
</body>
</html>
    `);
    printWin.document.close();
}

// Check URL query parameters for direct form access
function handleUrlParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const formParam = params.get('form');
        if (formParam === 'form1' || formParam === 'foodsafety') {
            setTimeout(() => {
                openEmpIdModal('form1');
            }, 300);
        } else if (formParam === 'form2' || formParam === 'communication') {
            setTimeout(() => {
                openEmpIdModal('form2');
            }, 300);
        } else if (params.get('tab') === 'dashboard') {
            switchTab('dashboard');
        } else if (params.get('admin') === 'login') {
            openAdminLoginModal();
        }
    } catch (e) {
        console.error("Error reading URL parameters:", e);
    }
}

