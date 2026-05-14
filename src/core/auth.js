export function initAuth({
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
}) {
  window.switchTab = function (tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tab === 'login' ? 'tabLogin' : 'tabSignup').classList.add('active');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    if (tab === 'login') {
      loginForm.style.display = 'flex';
      signupForm.style.display = 'none';
    } else {
      loginForm.style.display = 'none';
      signupForm.style.display = 'flex';
    }
  };

  window.login = async function () {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return toast('Please fill in all fields', 'error');

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      toast(friendlyAuthError(e.code), 'error');
    }
  };

  window.signup = async function () {
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;

    if (!name || !email || !password) return toast('Please fill in all fields', 'error');
    if (password.length < 6) return toast('Password must be at least 6 characters', 'error');

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, 'users', cred.user.uid), { name, email, createdAt: serverTimestamp() });
    } catch (e) {
      toast(friendlyAuthError(e.code), 'error');
    }
  };

  window.logout = async function () {
    resetSessionState();
    await signOut(auth);
  };

  onAuthStateChanged(auth, async user => {
    if (user) {
      state.currentUser = user;
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().storeId) {
          await loadApp(userDoc.data().storeId);
        } else {
          showView('onboardingView');
        }
      } catch (e) {
        toast('Could not load your account. Check your Firebase config.', 'error');
        showView('onboardingView');
      }
      return;
    }

    resetSessionState();
    state.currentUser = null;
    showView('landingView');
  });
}
