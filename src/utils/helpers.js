export function showView(viewId) {
  ['authView', 'onboardingView', 'appView', 'landingView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(viewId);
  if (target) target.style.display = viewId === 'appView' ? 'block' : 'flex';
}

export function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modal').style.display = 'flex';
}

export function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

export function initUiGlobals() {
  window.closeModal = closeModal;
  window.showView = showView;
  window.handleModalOverlayClick = function (e) {
    if (e.target === document.getElementById('modal')) closeModal();
  };
}

export function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  const container = document.getElementById('toastContainer');
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'none';
    t.style.opacity = '0';
    t.style.transform = 'translateX(100%)';
    t.style.transition = 'all 0.2s ease';
    setTimeout(() => t.remove(), 200);
  }, 3500);
}

export function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

export function formatDateForFile(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

export function escHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

export function toggleEl(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

export function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found': 'No account found with that email',
    'auth/wrong-password': 'Incorrect password',
    'auth/invalid-credential': 'Invalid email or password',
    'auth/email-already-in-use': 'An account with this email already exists',
    'auth/invalid-email': 'Invalid email address',
    'auth/weak-password': 'Password is too weak (min 6 characters)',
    'auth/too-many-requests': 'Too many attempts. Please try again later',
    'auth/network-request-failed': 'Network error. Check your connection',
  };
  return map[code] || 'Something went wrong. Please try again.';
}
