// ====================== ES MODULE IMPORTS (MUST BE FIRST) ======================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    onSnapshot,
    updateDoc,
    setDoc,
    arrayUnion,
    deleteField,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ====================== FIREBASE CONFIG ======================
const firebaseConfig = {
    apiKey: "AIzaSyAjJpK-3eNIXFM7V7dWLJhWua5T3fF3_2E",
    authDomain: "user-store-srt.firebaseapp.com",
    projectId: "user-store-srt",
    storageBucket: "user-store-srt.firebasestorage.app",
    messagingSenderId: "932714544224",
    appId: "1:932714544224:web:7ecaecb707b59b3b7d1705"
};

// ====================== TELEGRAM CONFIG ======================
const workerUrl = "https://srt-telegram-bot.samratsubedi163.workers.dev";
// ====================== YOUR ESEWA QR NUMBER ======================
const ESEWA_DISPLAY_NUMBER = "9827260865";

// ====================== APP INIT ======================
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

// ====================== GOOGLE SIGN-IN ======================
window.handleGoogleSignIn = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
            await setDoc(userRef, {
                history: [],
                adminMessage: "Welcome! Pay via eSewa and submit your transaction ID to get your key 🔑",
                requestStatus: "Active"
            }, { merge: true });
        }
        showToast("Signed in with Google! ✅", "success");
    } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user') {
            showToast("Google Sign-In failed: " + err.message, "error");
        }
    }
};

// ====================== FORGOT PASSWORD ======================
window.handleForgotPassword = async () => {
    const email = document.getElementById('loginEmail').value.trim()
                || document.getElementById('regEmail').value.trim();
    if (!email) {
        return showToast("Enter your email above first, then tap Forgot Password", "error");
    }
    try {
        await sendPasswordResetEmail(auth, email);
        showToast("✅ Password reset email sent! Check your inbox.", "success");
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            showToast("No account found with that email.", "error");
        } else {
            showToast("Failed: " + err.message, "error");
        }
    }
};

let currentUID       = null;
let currentUserEmail = null;
let realtimeListener = null;
let purchaseData     = null;

// ====================== PAYMENT STATE PERSISTENCE ======================
// Saves the entire checkout state so refresh doesn't lose progress
const PAYMENT_STORAGE_KEY = 'srtx_payment_state';

function savePaymentState(step, extraData = {}) {
    const state = {
        step,
        purchaseData,
        payName:  document.getElementById('payName')?.value || '',
        payWA:    document.getElementById('payWA')?.value || '',
        esewaUserId:   document.getElementById('esewaUserId')?.value || '',
        esewaTransCode: document.getElementById('esewaTransCode')?.value || '',
        savedAt: Date.now(),
        ...extraData
    };
    localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(state));
    // Update URL hash to reflect current payment step
    if (step >= 1 && step <= 3) {
        history.replaceState(null, '', '#payment/' + step);
    }
}

function loadPaymentState() {
    try {
        const raw = localStorage.getItem(PAYMENT_STORAGE_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        // Expire state after 2 hours (in case user abandoned purchase)
        if (Date.now() - state.savedAt > 2 * 60 * 60 * 1000) {
            clearPaymentState();
            return null;
        }
        return state;
    } catch (e) { return null; }
}

function clearPaymentState() {
    localStorage.removeItem(PAYMENT_STORAGE_KEY);
}

// ====================== URL HASH ROUTER ======================
// Reads the URL hash and routes to the correct screen after auth
function getRouteFromHash() {
    const hash = window.location.hash; // e.g. "#payment/2", "#store"
    if (hash.startsWith('#payment/')) {
        const step = parseInt(hash.split('/')[1]);
        if (step >= 1 && step <= 3) return { page: 'payment', step };
    }
    if (hash === '#login' || hash === '#signup') return { page: 'login', mode: hash.slice(1) };
    return { page: 'store' };
}

function navigateTo(page, step) {
    if (page === 'store') {
        history.replaceState(null, '', '#store');
    } else if (page === 'login') {
        history.replaceState(null, '', '#login');
    } else if (page === 'payment' && step) {
        history.replaceState(null, '', '#payment/' + step);
    }
}

// Handles browser back/forward button
window.addEventListener('popstate', () => {
    const route = getRouteFromHash();
    if (!currentUID) {
        // Not logged in — force to login/store
        showMainUI('authSection');
        return;
    }
    if (route.page === 'payment' && route.step) {
        const state = loadPaymentState();
        if (state && state.purchaseData) {
            restorePaymentStep(state, route.step);
        } else {
            // No saved state, go to store
            navigateTo('store');
            showMainUI('storeUI');
        }
    } else {
        // Going back to store — close any open checkout
        closeModals();
        showMainUI('storeUI');
    }
});

// Restores payment modal to a specific step from saved state
function restorePaymentStep(state, targetStep) {
    if (!state || !state.purchaseData) return;

    // Restore purchaseData
    purchaseData = state.purchaseData;

    // Open checkout modal
    document.getElementById('modalOverlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById('checkoutModal').classList.remove('hidden');

    // Restore form fields
    if (state.payName) document.getElementById('payName').value = state.payName;
    if (state.payWA)   document.getElementById('payWA').value   = state.payWA;

    // Restore order summary
    document.getElementById('orderSummaryBox').innerHTML = `
        <span class="item-name">${purchaseData.name}</span>
        <span class="item-price">Rs ${purchaseData.price}</span>
    `;

    if (targetStep === 1) {
        showStep(1);
    } else if (targetStep === 2) {
        document.getElementById('esewaAmount').textContent   = `Rs ${purchaseData.price}`;
        document.getElementById('esewaMerchant').textContent = ESEWA_DISPLAY_NUMBER;
        showStep(2);
        // Unlock the "I HAVE PAID" button (timer already passed since it was a refresh)
        const btn = document.getElementById('finalPayBtn');
        btn.disabled = false;
        btn.classList.remove('disabled');
        document.getElementById('timerSec').innerText = '0';
        showToast("✅ Restored: Payment QR step", "info");
    } else if (targetStep === 3) {
        if (state.esewaUserId)    document.getElementById('esewaUserId').value    = state.esewaUserId;
        if (state.esewaTransCode) document.getElementById('esewaTransCode').value = state.esewaTransCode;
        showStep(3);
        showToast("✅ Restored: Submit order step — just fill in and submit", "success");
    }
}

// ====================== CF GATE (VERIFICATION LANDING PAGE) ======================
// Shows a CF widget on first visit. User must verify then click NEXT to reach login.
// Also blocks Firebase auto-login (user must always pass gate on fresh page load).
let cfGatePassed   = false;
let cfGateWidgetId = null;

window.onGateVerified = function(token) {
    cfGatePassed = true;
    const s = document.getElementById('cfGateStatus');
    if (s) { s.className = 'cf-status verified'; s.innerHTML = '<i class="fas fa-check-circle"></i> Verified — tap NEXT to continue'; }
    const btn = document.getElementById('cfNextBtn');
    if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; btn.style.boxShadow = '0 4px 20px rgba(0,232,122,0.35)'; }
};
window.onGateExpired = function() {
    cfGatePassed = false;
    const s = document.getElementById('cfGateStatus');
    if (s) { s.className = 'cf-status pending'; s.innerHTML = '<i class="fas fa-shield-alt"></i> Verification expired — please redo'; }
    const btn = document.getElementById('cfNextBtn');
    if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; btn.style.boxShadow = ''; }
};
window.onGateError = function() {
    cfGatePassed = false;
    const s = document.getElementById('cfGateStatus');
    if (s) { s.className = 'cf-status failed'; s.innerHTML = '<i class="fas fa-times-circle"></i> Verification failed — try again'; }
    const btn = document.getElementById('cfNextBtn');
    if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; btn.style.boxShadow = ''; }
};

window.proceedToLogin = function() {
    if (!cfGatePassed) return;
    document.getElementById('cfVerifyPage').classList.add('hidden');
    document.getElementById('authSection').classList.remove('hidden');
    history.replaceState(null, '', '#login');
};

function initGateWidget() {
    if (!window.turnstile) { setTimeout(initGateWidget, 300); return; }
    const el = document.getElementById('cfGateWidget');
    if (!el || cfGateWidgetId !== null) return;
    document.getElementById('cfVerifyLoading').style.display = 'none';
    document.getElementById('cfVerifyReady').style.display   = 'block';
    cfGateWidgetId = window.turnstile.render(el, {
        sitekey: '0x4AAAAAADgSv0fKYVjwT1Q_',
        theme: 'dark',
        callback:           window.onGateVerified,
        'expired-callback': window.onGateExpired,
        'error-callback':   window.onGateError,
    });
}

document.addEventListener('DOMContentLoaded', initGateWidget);
initGateWidget();

// ====================== AUTH STATE ======================
// AUTO-LOGIN IS BLOCKED: if Firebase says user is logged in on page load,
// we still require the CF gate to be passed first this session.
onAuthStateChanged(auth, (user) => {
    if (user) {
        // If gate hasn't been passed yet (fresh page load / refresh), block auto-login
        // and keep user on the gate screen until they verify + click NEXT + log in manually.
        // Only proceed to store if gate was passed this session.
        if (!cfGatePassed) {
            // Sign out the auto-session silently so they must log in again after gate
            signOut(auth);
            return;
        }

        currentUID       = user.uid;
        currentUserEmail = user.email;
        document.getElementById('displayEmail').innerText = user.email || "User";
        showMainUI('storeUI');
        // Hide CF verify page and auth section
        document.getElementById('cfVerifyPage').classList.add('hidden');
        document.getElementById('authSection').classList.add('hidden');
        startSync(user.uid);
        startTime();

        // ---- ROUTE RESTORATION ON LOGIN / PAGE LOAD ----
        const route = getRouteFromHash();
        if (route.page === 'payment' && route.step) {
            const state = loadPaymentState();
            if (state && state.purchaseData) {
                setTimeout(() => restorePaymentStep(state, route.step), 400);
            } else {
                navigateTo('store');
            }
        } else {
            const state = loadPaymentState();
            if (state && state.purchaseData && state.step >= 2) {
                setTimeout(() => {
                    const banner = document.createElement('div');
                    banner.id = 'restoreBanner';
                    banner.style.cssText = `
                        position:fixed;bottom:0;left:0;right:0;
                        background:#0d1a2e;border-top:2px solid #ffb020;
                        padding:14px 18px;z-index:9998;
                        display:flex;align-items:center;justify-content:space-between;gap:10px;
                        font-family:'Rajdhani',sans-serif;
                    `;
                    banner.innerHTML = `
                        <div style="color:#ffb020;font-size:13px;font-weight:600;">
                            <i class="fas fa-exclamation-triangle"></i>
                            Unfinished payment: <b>${state.purchaseData.name}</b> — Step ${state.step}/3
                        </div>
                        <div style="display:flex;gap:8px;flex-shrink:0;">
                            <button onclick="document.getElementById('restoreBanner').remove();clearPaymentState();"
                                style="padding:7px 14px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:rgba(255,255,255,0.5);font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">
                                DISCARD
                            </button>
                            <button onclick="document.getElementById('restoreBanner').remove();restorePaymentStep(loadPaymentState(),loadPaymentState().step);"
                                style="padding:7px 14px;border-radius:7px;border:none;background:#ffb020;color:#000;font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.5px;">
                                RESUME PAYMENT
                            </button>
                        </div>
                    `;
                    document.body.appendChild(banner);
                }, 800);
            } else {
                navigateTo('store');
            }
        }
    } else {
        if (realtimeListener) realtimeListener();
        currentUID       = null;
        currentUserEmail = null;
        purchaseData     = null;
        // If gate already passed this session, show login page
        // Otherwise stay on gate page
        if (cfGatePassed) {
            showMainUI('authSection');
            document.getElementById('cfVerifyPage').classList.add('hidden');
        }
        history.replaceState(null, '', cfGatePassed ? '#login' : '#verify');
    }
});

// Make helpers accessible globally for banner
window.loadPaymentState    = loadPaymentState;
window.clearPaymentState   = clearPaymentState;
window.restorePaymentStep  = restorePaymentStep;

// ====================== AUTH ACTIONS (no CF token required — gate already passed) ======================
document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    if (!email || !pass) return showToast("Please enter email and password", "error");
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        showToast("Login Failed: " + err.message, "error");
    }
};

document.getElementById('signupBtn').onclick = async () => {
    const email = document.getElementById('regEmail').value.trim();
    const pass  = document.getElementById('regPass').value;
    if (!email || !pass) return showToast("Please fill all fields", "error");
    if (pass.length < 6) return showToast("Password must be at least 6 characters", "error");

    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        showToast("Account created successfully!", "success");
    } catch (err) {
        showToast("Signup Failed: " + err.message, "error");
    }
};

window.handleLogout = () => {
    clearPaymentState();
    cfGatePassed = false; // Force gate again on next visit
    signOut(auth);
    // Go back to gate page
    document.getElementById('cfVerifyPage').classList.remove('hidden');
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('storeUI').classList.add('hidden');
    history.replaceState(null, '', '#verify');
    // Reset gate widget so it can be solved again
    if (cfGateWidgetId !== null && window.turnstile) {
        try { window.turnstile.reset(cfGateWidgetId); } catch(e) {}
    }
    cfGatePassed = false;
    const btn = document.getElementById('cfNextBtn');
    if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; btn.style.boxShadow = ''; }
    const s = document.getElementById('cfGateStatus');
    if (s) { s.className = 'cf-status pending'; s.innerHTML = '<i class="fas fa-shield-alt"></i> Complete the verification above'; }
};

// ====================== SIDE MENU ======================
const menuBtn     = document.getElementById('menuBtn');
const sideDrawer  = document.getElementById('sideDrawer');
const menuOverlay = document.getElementById('menuOverlay');

const toggleMenu = () => {
    if (document.body.classList.contains('desktop-mode')) return;
    const isOpen = sideDrawer.classList.toggle('active');
    menuBtn.classList.toggle('active');
    menuOverlay.style.display = isOpen ? 'block' : 'none';
};
menuBtn.onclick     = toggleMenu;
menuOverlay.onclick = toggleMenu;

function closeMenu() {
    sideDrawer.classList.remove('active');
    menuBtn.classList.remove('active');
    menuOverlay.style.display = 'none';
}

// ====================== PROFILE ======================
window.saveProfile = async () => {
    const name  = document.getElementById('profileName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    if (!name || !phone) return showToast("Please fill both fields", "error");
    if (!currentUID) return showToast("Not logged in", "error");
    try {
        await updateDoc(doc(db, "users", currentUID), { profileName: name, profilePhone: phone });
        showToast("Profile saved!", "success");
        closeModals();
    } catch (e) {
        showToast("Failed: " + e.message, "error");
    }
};

function loadProfileToModal(data) {
    if (data.profileName)  document.getElementById('profileName').value  = data.profileName;
    if (data.profilePhone) document.getElementById('profilePhone').value = data.profilePhone;
}

// ====================== REAL-TIME SYNC ======================
function startSync(uid) {
    const userRef = doc(db, "users", uid);
    realtimeListener = onSnapshot(userRef, (snap) => {
        if (!snap.exists()) {
            setDoc(userRef, {
                history: [],
                adminMessage: "Welcome! Pay via eSewa and submit your transaction ID to get your key 🔑",
                requestStatus: "Active"
            }, { merge: true });
            return;
        }
        const data = snap.data();

        const statusEl  = document.getElementById('userStatus');
        const statusDot = document.querySelector('.status-dot');
        statusEl.innerText = data.requestStatus || "Active";
        const status = (data.requestStatus || "Active").toLowerCase();
        if      (status.includes("approved") || status === "active") statusDot.style.background = "#00e87a";
        else if (status.includes("pending"))                          statusDot.style.background = "#ffb020";
        else if (status.includes("reject") || status.includes("ban")) statusDot.style.background = "#ff3b5c";
        else                                                           statusDot.style.background = "#00e87a";

        document.getElementById('adminMsg').innerText = data.adminMessage || "No messages.";
        renderHistory(data.history || []);
        loadProfileToModal(data);
        checkForNewKey(data.history || []);
    });
}

let lastKeyCount = 0;
function checkForNewKey(history) {
    const keysDelivered = history.filter(h => h.key && h.status === 'SUCCESS');
    if (keysDelivered.length > lastKeyCount && lastKeyCount !== 0) {
        const newest = keysDelivered[keysDelivered.length - 1];
        showKeyDelivered(newest.key, newest.item || 'Your product');
    }
    lastKeyCount = keysDelivered.length;
}

// ====================== HISTORY ======================
function renderHistory(history) {
    const container = document.getElementById('historyList');
    if (!history || history.length === 0) {
        container.innerHTML = `<p class="empty-msg">No orders yet.</p>`;
        return;
    }
    container.innerHTML = history.slice().reverse().map(item => `
        <div class="history-item">
            <small>${item.date || ''}</small>
            <p>${item.msg || item}</p>
            ${item.status === 'PENDING_APPROVAL'
                ? `<div class="pending-badge">⏳ Waiting for admin approval</div>`
                : ''}
            ${item.key ? `
            <div class="key-display">
                <i class="fas fa-key"></i>
                <span class="key-text">${item.key}</span>
                <button class="key-copy-inline" onclick="copyKey('${item.key}')">
                    <i class="fas fa-copy"></i>
                </button>
            </div>` : ''}
        </div>
    `).join('');
}

window.confirmDeleteHistory = () => document.getElementById('deleteWarning').classList.remove('hidden');
window.hideDeleteWarning    = () => document.getElementById('deleteWarning').classList.add('hidden');

window.processHistoryDelete = async () => {
    if (!currentUID) return;
    try {
        await updateDoc(doc(db, "users", currentUID), { history: deleteField() });
        hideDeleteWarning();
        closeModals();
        showToast("History cleared!", "success");
    } catch (e) {
        showToast("Failed to clear history", "error");
    }
};

// ====================== PASSWORD UPDATE ======================
window.processPassUpdate = async () => {
    const oldP = document.getElementById('oldPass').value.trim();
    const newP = document.getElementById('newPass').value.trim();
    const user = auth.currentUser;
    if (!oldP || !newP)   return showToast("Please fill both fields", "error");
    if (newP.length < 6)  return showToast("Min 6 characters", "error");
    try {
        const credential = EmailAuthProvider.credential(user.email, oldP);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newP);
        showToast("Password updated!", "success");
        closeModals();
        document.getElementById('oldPass').value = '';
        document.getElementById('newPass').value = '';
    } catch (error) {
        showToast(error.code === 'auth/wrong-password' ? "Wrong current password!" : "Failed: " + error.message, "error");
    }
};

// ====================== PRODUCT SELECTION ======================
window.togglePrices = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.toggle('hidden');
    if (navigator.vibrate) navigator.vibrate(10);
};

window.selectItem = (el, name, price) => {
    document.querySelectorAll('.price-item').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    purchaseData = { name, price, selectedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }) };
    const buyBtn = el.closest('.price-list').querySelector('.buy-btn');
    if (buyBtn) buyBtn.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(15);
};

// ====================== CHECKOUT — STEP 1 ======================
window.startCheckout = () => {
    if (!purchaseData) return showToast("Please select a product first!", "error");
    openModal('checkoutModal');

    document.getElementById('orderSummaryBox').innerHTML = `
        <span class="item-name">${purchaseData.name}</span>
        <span class="item-price">Rs ${purchaseData.price}</span>
    `;

    if (currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data.profileName)  document.getElementById('payName').value = data.profileName;
            if (data.profilePhone) document.getElementById('payWA').value   = data.profilePhone;
            const note = document.getElementById('autofillNote');
            if (data.profileName || data.profilePhone) {
                note.innerHTML = '<i class="fas fa-check-circle"></i> Auto-filled from profile';
            } else {
                note.innerHTML = '<i class="fas fa-info-circle" style="color:var(--text3)"></i> <span style="color:var(--text3)">Set profile to auto-fill next time</span>';
            }
        });
    }

    showStep(1);
    savePaymentState(1); // Save step 1 immediately
};

// ====================== CHECKOUT — STEP 2 ======================
window.showQR = () => {
    const name = document.getElementById('payName').value.trim();
    const wa   = document.getElementById('payWA').value.trim();
    if (!name || !wa) return showToast("Please enter your Name and WhatsApp!", "error");

    document.getElementById('esewaAmount').textContent   = `Rs ${purchaseData.price}`;
    document.getElementById('esewaMerchant').textContent = ESEWA_DISPLAY_NUMBER;

    showStep(2);
    savePaymentState(2); // ← Save state when entering QR step

    let sec = 15;
    const btn = document.getElementById('finalPayBtn');
    btn.disabled = true;
    btn.classList.add('disabled');
    document.getElementById('timerSec').innerText = sec;

    const clock = setInterval(() => {
        sec--;
        document.getElementById('timerSec').innerText = sec;
        if (sec <= 0) {
            clearInterval(clock);
            btn.disabled = false;
            btn.classList.remove('disabled');
        }
    }, 1000);
};

// ====================== CHECKOUT — STEP 3 ======================
window.showVerifyStep = () => {
    document.getElementById('esewaTransCode').value = '';
    document.getElementById('esewaUserId').value    = '';

    const waVal = document.getElementById('payWA').value.trim();
    if (waVal) document.getElementById('esewaUserId').value = waVal;

    showStep(3);
    savePaymentState(3);

    // Auto-save tx fields as user types (so refresh preserves them)
    const txInput = document.getElementById('esewaTransCode');
    const idInput = document.getElementById('esewaUserId');
    const autoSaveFields = () => savePaymentState(3);
    txInput.addEventListener('input', autoSaveFields);
    idInput.addEventListener('input', autoSaveFields);
};

function showStep(n) {
    ['checkoutStep1','checkoutStep2','checkoutStep3'].forEach((id, i) => {
        document.getElementById(id).classList.toggle('hidden', i + 1 !== n);
    });
}

// ====================== SUBMIT ORDER WITH TURNSTILE CHECK ======================
window.submitOrder = async () => {
    if (!currentUID)   return showToast("Please login again.", "error");
    if (!purchaseData) return showToast("No item selected!", "error");

    const esewaId = document.getElementById('esewaUserId').value.trim();
    const txCode  = document.getElementById('esewaTransCode').value.trim().toUpperCase();

    if (!txCode)  return showToast("Enter your eSewa transaction ID!", "error");
    if (!esewaId) return showToast("Enter your eSewa ID (phone/email)!", "error");

    const submitBtn = document.getElementById('verifyPayBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>SUBMITTING...</span>';

    // Check for duplicate transaction code
    try {
        const userSnap = await getDoc(doc(db, "users", currentUID));
        if (userSnap.exists()) {
            const existing = (userSnap.data().history || []);
            const duplicate = existing.some(h => h.txCode && h.txCode.toUpperCase() === txCode);
            if (duplicate) {
                showToast("This transaction ID was already submitted!", "error");
                resetSubmitBtn(submitBtn);
                return;
            }
        }
    } catch (e) { /* continue */ }

    const name   = document.getElementById('payName').value.trim();
    const waNum  = document.getElementById('payWA').value.trim();
    const date   = getDate();

    // 1. Save pending order to Firebase
    try {
        await updateDoc(doc(db, "users", currentUID), {
            requestStatus: "Key Pending",
            history: arrayUnion({
                date,
                uid:    currentUID,
                email:  currentUserEmail,
                msg:    `⏳ PENDING: ${purchaseData.name} — Rs ${purchaseData.price} — TX: ${txCode}`,
                item:   purchaseData.name,
                price:  purchaseData.price,
                txCode, esewaId,
                name,   waNum,
                status: 'PENDING_APPROVAL',
                cfVerified: true
            })
        });
    } catch (e) {
        showToast("Failed to save order: " + e.message, "error");
        resetSubmitBtn(submitBtn);
        return;
    }

    // 2. Send Telegram notification
    const tgMessage =
`🔔 *NEW PAYMENT RECEIVED*
✅ *CF Turnstile: VERIFIED* (bot-protected)

🛍 *Product:* ${purchaseData.name}
💰 *Amount:* Rs ${purchaseData.price}
📋 *TX Code:* \`${txCode}\`
📱 *eSewa ID:* ${esewaId}

👤 *Customer:*
  Name: ${name}
  WhatsApp: ${waNum}
  Email: ${currentUserEmail}
  UID: \`${currentUID}\`

📅 ${date}

➡️ Go to Admin Panel to verify & deliver key.`;

    try {
        const workerUrl = "https://srtx-telegram-bot.srtxcheats.workers.dev";
        await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: tgMessage })
        });
    } catch (e) {
        console.warn("Telegram notify failed:", e.message);
    }

    clearPaymentState(); // ← Clear saved state after successful submission


    // 3. Show success screen
    closeModals();
    navigateTo('store');
    showOrderSubmitted(txCode);
    resetAfterPurchase();
};

function showOrderSubmitted(txCode) {
    const popup   = document.getElementById('autoPopup');
    const msgArea = document.getElementById('popupMsg');
    if (!popup || !msgArea) return;

    msgArea.innerHTML = `
        <div class="popup-status status-pending">⏳ ORDER SUBMITTED!</div>
        <p style="font-size:13px;margin:10px 0;color:var(--text2)">Your payment is being verified by admin.</p>
        <div style="background:#0d1220;border:1px solid #ffb02033;border-radius:8px;padding:10px;margin:10px 0;">
            <p style="font-size:11px;color:var(--text3);margin:0 0 4px 0;">TRANSACTION ID</p>
            <p style="font-size:14px;color:#ffb020;font-weight:700;margin:0;">${txCode}</p>
        </div>
        <div style="background:#0d1220;border:1px solid rgba(0,232,122,0.2);border-radius:8px;padding:8px 10px;margin:6px 0;display:flex;align-items:center;gap:8px;justify-content:center;">
            <i class="fab fa-cloudflare" style="color:#ff6400;font-size:14px;"></i>
            <span style="font-size:11px;color:var(--green);font-weight:600;">Cloudflare verified ✓</span>
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:8px;">
            ✅ You'll receive your key in Order History once approved.<br>
            Usually within a few minutes during service hours (8AM–10PM).
        </p>
    `;
    popup.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

function resetAfterPurchase() {
    purchaseData = null;
    document.querySelectorAll('.price-item').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.buy-btn').forEach(b => b.classList.add('hidden'));
    document.getElementById('payName').value = '';
    document.getElementById('payWA').value   = '';
}

function resetSubmitBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> <span>SUBMIT ORDER</span>';
}

// ====================== DATE HELPER ======================
function getDate() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu', hour12: true,
        hour: '2-digit', minute: '2-digit',
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// ====================== UI HELPERS ======================
window.toggleAuth = (mode) => {
    document.getElementById('loginBox').classList.toggle('hidden', mode === 'signup');
    document.getElementById('signupBox').classList.toggle('hidden', mode === 'login');
    history.replaceState(null, '', '#' + mode);
};

function showMainUI(id) {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('storeUI').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

window.openModal = (id) => {
    document.getElementById('modalOverlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('hidden');
    closeMenu();
    if (id === 'profileModal' && currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            if (snap.exists()) loadProfileToModal(snap.data());
        });
    }
};

window.closeModals = () => {
    document.getElementById('modalOverlay').classList.add('hidden');
    // Only navigate to store if we were in a payment route
    if (window.location.hash.startsWith('#payment/')) {
        navigateTo('store');
    }
};

// ====================== LIVE CLOCK ======================
function startTime() {
    const tick = () => {
        const timeEl = document.getElementById('currentTime');
        if (timeEl) timeEl.innerText = new Date().toLocaleTimeString('en-IN');
    };
    tick();
    setInterval(tick, 1000);
}

// ====================== KEY DELIVERED POPUP ======================
function showKeyDelivered(key, productName) {
    const popup   = document.getElementById('autoPopup');
    const msgArea = document.getElementById('popupMsg');
    if (!popup || !msgArea) return;

    const safeKey = key.replace(/'/g, "\\'");
    msgArea.innerHTML = `
        <div class="popup-status status-approved">🔑 KEY DELIVERED!</div>
        <p style="font-size:12px;margin-bottom:12px;color:var(--text2)">${productName}</p>
        <div class="key-display-popup">
            <i class="fas fa-key"></i>
            <span>${key}</span>
        </div>
        <button onclick="copyKey('${safeKey}')" class="copy-key-btn">
            <i class="fas fa-copy"></i> COPY KEY
        </button>
        <p style="font-size:11px;color:var(--text3);margin-top:12px;">
            ✅ Also saved in Order History
        </p>
    `;
    popup.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

window.copyKey = (key) => {
    navigator.clipboard.writeText(key)
        .then(() => showToast("Key copied! 🔑", "success"))
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = key;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Key copied!", "success");
        });
    if (navigator.vibrate) navigator.vibrate(30);
};

// ====================== TOAST ======================
function showToast(message, type = "info") {
    const existing = document.getElementById('srt-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'srt-toast';
    const color = type === 'success' ? '#00e87a' : type === 'error' ? '#ff3b5c' : '#00c8ff';
    toast.style.cssText = `
        position:fixed;bottom:32px;left:50%;
        transform:translateX(-50%) translateY(20px);
        background:#0d1220;color:${color};
        border:1px solid ${color}33;border-radius:10px;
        padding:13px 22px;font-family:'Rajdhani',sans-serif;
        font-size:14px;font-weight:600;letter-spacing:0.3px;
        z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,0.5);
        max-width:320px;text-align:center;opacity:0;
        transition:all 0.3s cubic-bezier(0.4,0,0.2,1);pointer-events:none;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
