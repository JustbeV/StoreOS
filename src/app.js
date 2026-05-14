import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, doc,
  setDoc, getDoc, query, where, updateDoc,
  limit, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  closeModal,
  csvEscape,
  escHtml,
  fmtNum,
  formatDateForFile,
  friendlyAuthError,
  initUiGlobals,
  openModal,
  setEl,
  showView,
  toast,
  toggleEl,
} from './utils/helpers.js';
import { initAuth } from './core/auth.js';
import { createHashRouter } from './core/router.js';
import { initProductsFeature } from './features/products.js';
import { initSalesFeature } from './features/sales.js';
import { initUtangFeature } from './features/utang.js';


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

const state = {
  currentUser: null,
  currentStoreId: null,
  currentUserRole: null,
  allProducts: [],
  allSales: [],
  allUtang: [],
  cart: [],
  salesFilter: 'today',
  unsubscribers: [],
};

initUiGlobals();

function resetSessionState() {
  state.currentStoreId = null;
  state.currentUserRole = null;
  state.allProducts = [];
  state.allSales = [];
  state.allUtang = [];
  state.cart = [];
  state.unsubscribers.forEach(unsub => unsub());
  state.unsubscribers = [];
}

function canDo(action) {
  if (!state.currentUserRole) return false;
  if (state.currentUserRole === 'owner') return true;
  const managerCan = ['add_product', 'edit_product', 'record_sale', 'add_utang', 'pay_utang'];
  const cashierCan = ['record_sale', 'pay_utang'];
  if (state.currentUserRole === 'manager') return managerCan.includes(action);
  if (state.currentUserRole === 'cashier') return cashierCan.includes(action);
  return false;
}

function canAccessSection(section) {
  if (section === 'members' || section === 'audit') return state.currentUserRole !== 'cashier';
  return true;
}

window.toggleSidebar = function () {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const main = document.getElementById('mainContent');

  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
    return;
  }

  sidebar.classList.toggle('hidden');
  main.style.marginLeft = sidebar.classList.contains('hidden') ? '0' : 'var(--sidebar-w)';
};

window.closeSidebar = function () {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
  }
};

const router = createHashRouter({
  sections: ['dashboard', 'products', 'sales', 'utang', 'members', 'audit'],
  defaultSection: 'dashboard',
  canAccessSection,
  onSectionChange: () => window.closeSidebar(),
});

window.showSection = function (name) {
  router.showSection(name);
};

window.showDashboardHelp = function () {
  openModal(`
    <div class="modal-title">Dashboard help</div>
    <p>This page gives you a quick overview of your store: sales totals, low stock alerts, total utang, product count, and recent activity. Use the sidebar to switch sections for products, sales, utang, members, and audit logs.</p>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal()">Got it</button>
    </div>
  `);
};

function updateDashboardStats() {
  const todaySales = filterSalesByPeriod(state.allSales, 'today');
  const weekSales = filterSalesByPeriod(state.allSales, 'week');
  const monthSales = filterSalesByPeriod(state.allSales, 'month');

  const todayTotal = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const weekTotal = weekSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const monthTotal = monthSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const totalUtang = state.allUtang.reduce((sum, u) => sum + (u.remaining || 0), 0);
  const utangCount = state.allUtang.filter(u => u.remaining > 0).length;
  const threshold = p => p.lowStockThreshold ?? 5;
  const lowStock = state.allProducts.filter(p => p.stock <= threshold(p)).length;

  setEl('statToday', `₱${fmtNum(todayTotal)}`);
  setEl('statTodayCount', `${todaySales.length} transaction${todaySales.length !== 1 ? 's' : ''}`);
  setEl('statWeek', `₱${fmtNum(weekTotal)}`);
  setEl('statWeekCount', `${weekSales.length} transaction${weekSales.length !== 1 ? 's' : ''}`);
  setEl('statMonth', `₱${fmtNum(monthTotal)}`);
  setEl('statMonthCount', `${monthSales.length} transaction${monthSales.length !== 1 ? 's' : ''}`);
  setEl('statUtang', `₱${fmtNum(totalUtang)}`);
  setEl('statUtangCount', `${utangCount} customer${utangCount !== 1 ? 's' : ''}`);
  setEl('statProducts', state.allProducts.length);
  setEl('statLowStock', lowStock);
}

async function logAudit(action, detail) {
  try {
    await addDoc(collection(db, 'audit'), {
      storeId: state.currentStoreId,
      action,
      detail,
      by: state.currentUser.uid,
      byName: state.currentUser.displayName || state.currentUser.email,
      date: serverTimestamp()
    });
  } catch (e) {
    console.warn('Audit log failed silently:', e);
  }
}

const { listenProducts } = initProductsFeature({
  state,
  db,
  storage,
  collection,
  addDoc,
  onSnapshot,
  doc,
  getDoc,
  query,
  where,
  updateDoc,
  ref,
  uploadBytes,
  getDownloadURL,
  serverTimestamp,
  fmtNum,
  escHtml,
  toast,
  openModal,
  closeModal,
  setEl,
  canDo,
  logAudit,
  updateDashboardStats,
});

const { listenSales, filterSalesByPeriod } = initSalesFeature({
  state,
  db,
  collection,
  addDoc,
  onSnapshot,
  doc,
  getDoc,
  query,
  where,
  updateDoc,
  serverTimestamp,
  fmtNum,
  escHtml,
  csvEscape,
  formatDateForFile,
  toast,
  openModal,
  closeModal,
  canDo,
  logAudit,
  updateDashboardStats,
});

const { listenUtang } = initUtangFeature({
  state,
  db,
  collection,
  addDoc,
  onSnapshot,
  doc,
  query,
  where,
  updateDoc,
  serverTimestamp,
  fmtNum,
  escHtml,
  toast,
  openModal,
  closeModal,
  canDo,
  logAudit,
  updateDashboardStats,
});

initAuth({
  auth,
  db,
  state,
  showView,
  loadApp,
  resetSessionState,
  toast,
  friendlyAuthError,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
});

window.openCreateStoreModal = function () {
  openModal(`
    <div class="modal-title">Create a store</div>
    <div class="form-group">
      <label class="form-label">Store name</label>
      <input type="text" id="newStoreName" placeholder="e.g. Juan's General Store" autocomplete="off">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createStore()">Create store</button>
    </div>
  `);
};

window.createStore = async function () {
  const name = document.getElementById('newStoreName').value.trim();
  if (!name) return toast('Enter a store name', 'error');

  try {
    const storeId = `store_${Date.now()}`;
    const ownerEntry = buildMemberEntry(state.currentUser, 'owner');

    await setDoc(doc(db, 'stores', storeId), {
      name,
      ownerId: state.currentUser.uid,
      members: [ownerEntry],
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'users', state.currentUser.uid), { storeId }, { merge: true });

    closeModal();
    await loadApp(storeId);
    toast('Store created!', 'success');
  } catch (e) {
    toast(`Error creating store: ${e.message}`, 'error');
  }
};

window.joinStore = async function () {
  const storeId = document.getElementById('joinStoreId').value.trim();
  if (!storeId) return toast('Enter a Store ID', 'error');

  try {
    const storeRef = doc(db, 'stores', storeId);
    const storeSnap = await getDoc(storeRef);
    if (!storeSnap.exists()) return toast('Store not found. Check the ID.', 'error');

    const storeData = storeSnap.data();
    const alreadyIn = (storeData.members || []).some(m => m.uid === state.currentUser.uid);
    if (alreadyIn) {
      await setDoc(doc(db, 'users', state.currentUser.uid), { storeId }, { merge: true });
      await loadApp(storeId);
      return;
    }

    const entry = buildMemberEntry(state.currentUser, 'cashier');
    await updateDoc(storeRef, { members: arrayUnion(entry) });
    await setDoc(doc(db, 'users', state.currentUser.uid), { storeId }, { merge: true });
    toast('Joined store!', 'success');
    await loadApp(storeId);
  } catch (e) {
    toast(`Error joining store: ${e.message}`, 'error');
  }
};

function buildMemberEntry(user, role) {
  return {
    uid: user.uid,
    name: user.displayName || user.email,
    email: user.email,
    role
  };
}

async function loadApp(storeId) {
  state.currentStoreId = storeId;

  try {
    const storeSnap = await getDoc(doc(db, 'stores', storeId));
    if (!storeSnap.exists()) {
      toast('Store data not found', 'error');
      showView('onboardingView');
      return;
    }

    const storeData = storeSnap.data();
    const members = storeData.members || [];
    const me = members.find(m => m.uid === state.currentUser.uid);
    state.currentUserRole = me ? me.role : 'cashier';

    const displayName = state.currentUser.displayName || state.currentUser.email || 'User';
    setEl('storeName', storeData.name);
    setEl('userDisplayName', displayName);
    setEl('userAvatar', displayName[0].toUpperCase());
    setEl('rolePill', state.currentUserRole);
    setEl('storeIdDisplay', storeId);
    setEl('sidebarStoreId', `ID: ${storeId}`);

    toggleEl('membersNav', canAccessSection('members'));
    toggleEl('auditNav', canAccessSection('audit'));
    toggleEl('addProductBtn', canDo('add_product'));

    showView('appView');
    if (!window.__routerStarted) {
      router.start();
      window.__routerStarted = true;
    } else {
      router.syncFromLocation();
    }

    state.unsubscribers.forEach(unsub => unsub());
    state.unsubscribers = [];
    listenProducts();
    listenSales();
    listenUtang();
    listenAudit();
    listenMembers();
  } catch (e) {
    toast('Could not load store data', 'error');
    console.error(e);
  }
}

function listenMembers() {
  const unsub = onSnapshot(doc(db, 'stores', state.currentStoreId), snap => {
    if (!snap.exists()) return;
    renderMembers(snap.data().members || []);
  });
  state.unsubscribers.push(unsub);
}

function renderMembers(members) {
  const list = document.getElementById('membersList');
  if (!list) return;

  if (members.length === 0) {
    list.innerHTML = '<div class="empty-state">No members yet.</div>';
    return;
  }

  list.innerHTML = members.map(m => {
    const isOwner = m.role === 'owner';
    const isMe = m.uid === state.currentUser.uid;
    const canChange = state.currentUserRole === 'owner' && !isOwner && !isMe;
    const initials = (m.name || m.email || '?')[0].toUpperCase();

    return `
      <div class="member-card">
        <div class="member-info">
          <div class="member-avatar">${initials}</div>
          <div class="member-text">
            <div class="member-name">${escHtml(m.name || m.email)} ${isMe ? '<span style="font-size:11px;color:var(--text-muted)">(you)</span>' : ''}</div>
            <div class="member-email">${escHtml(m.email)}</div>
          </div>
        </div>
        ${canChange
          ? `<select class="role-select" onchange="changeMemberRole('${m.uid}', this.value)">
               <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Manager</option>
               <option value="cashier" ${m.role === 'cashier' ? 'selected' : ''}>Cashier</option>
             </select>`
          : `<span class="role-pill" style="background:${isOwner ? 'var(--warning-light)' : 'var(--primary-light)'};color:${isOwner ? '#92400e' : 'var(--primary-dark)'}">${m.role}</span>`
        }
      </div>
    `;
  }).join('');
}

window.changeMemberRole = async function (uid, newRole) {
  if (state.currentUserRole !== 'owner') return toast('Only the owner can change roles', 'error');

  try {
    const storeRef = doc(db, 'stores', state.currentStoreId);
    const storeSnap = await getDoc(storeRef);
    const members = (storeSnap.data().members || []).map(m => (
      m.uid === uid ? { ...m, role: newRole } : m
    ));
    await updateDoc(storeRef, { members });
    await logAudit('role_change', `Changed member role to ${newRole}`);
    toast('Role updated', 'success');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
};

window.copyStoreId = function () {
  if (!state.currentStoreId) return;
  navigator.clipboard.writeText(state.currentStoreId)
    .then(() => toast('Store ID copied!', 'success'))
    .catch(() => toast('Could not copy', 'error'));
};

function listenAudit() {
  const q = query(
    collection(db, 'audit'),
    where('storeId', '==', state.currentStoreId),
    limit(100)
  );
  const unsub = onSnapshot(q, snapshot => {
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    renderAudit(items);
    renderRecentActivity(items.slice(0, 5));
  });
  state.unsubscribers.push(unsub);
}

const auditIcons = {
  sale: '💰',
  add_product: '📦',
  edit_product: '✏️',
  add_utang: '📋',
  payment: '✅',
  role_change: '👥',
};

function renderAudit(items) {
  if (state.currentUserRole === 'cashier') return;
  const list = document.getElementById('auditList');
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state">No activity yet.</div>';
    return;
  }

  list.innerHTML = items.map(a => {
    const date = a.date?.seconds ? new Date(a.date.seconds * 1000) : new Date();
    const icon = auditIcons[a.action] || '📝';
    return `
      <div class="item-card" style="padding:12px 16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span style="font-size:18px;flex-shrink:0;line-height:1.4">${icon}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(a.detail)}</div>
            <div class="activity-meta">${escHtml(a.byName)} · ${date.toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecentActivity(items) {
  const list = document.getElementById('recentActivity');
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state">No activity yet. Start recording sales!</div>';
    return;
  }

  list.innerHTML = items.map(a => {
    const date = a.date?.seconds ? new Date(a.date.seconds * 1000) : new Date();
    const icon = auditIcons[a.action] || '📝';
    return `
      <div class="activity-item">
        <span class="activity-icon">${icon}</span>
        <div>
          <div class="activity-text">${escHtml(a.detail)}</div>
          <div class="activity-meta">${escHtml(a.byName)} · ${date.toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })}</div>
        </div>
      </div>
    `;
  }).join('');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./src/sw.js').catch(e => console.warn('SW failed:', e));
}
