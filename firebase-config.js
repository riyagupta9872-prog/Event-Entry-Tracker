// ===== FIREBASE CONFIGURATION =====
const firebaseConfig = {
  apiKey: "AIzaSyDSXe63wDzrdMLBJUjjr3pDRg0h9JmEYU0",
  authDomain: "event-tracker-1d6ad.firebaseapp.com",
  projectId: "event-tracker-1d6ad",
  storageBucket: "event-tracker-1d6ad.appspot.com",
  messagingSenderId: "965224086431",
  appId: "1:965224086431:web:50d0a4400479288551dbaa"
};

const firebaseApp = firebase.initializeApp(firebaseConfig);
const auth = firebaseApp.auth();
const firestore = firebaseApp.firestore();

// Enable offline persistence for Firestore (non-blocking)
try {
  firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {});
} catch (e) { /* already enabled */ }

// Keep auth session persistent
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// ── Recovery from corrupted IndexedDB persistence cache ───────────────────
// Firebase JS SDK 10.x occasionally throws "INTERNAL ASSERTION FAILED:
// Unexpected state" when the local IndexedDB cache is in a bad state (often
// after a service worker update). The only reliable recovery is to terminate
// Firestore, wipe its IndexedDB, and reload the page. Guard with a sentinel so
// we never enter a reload loop.
async function _recoverFromFirestoreCorruption() {
  if (sessionStorage.getItem('prerna_fs_recovering') === '1') return;
  sessionStorage.setItem('prerna_fs_recovering', '1');
  try {
    try { await firestore.terminate(); } catch {}
    try { await firestore.clearPersistence(); } catch {}
    // Best-effort: also delete IndexedDB databases used by Firestore directly
    if (window.indexedDB && indexedDB.databases) {
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db && db.name && /firestore/i.test(db.name)) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      } catch {}
    }
  } finally {
    location.reload();
  }
}

function _isFirestoreAssertionError(msg) {
  return typeof msg === 'string' && /FIRESTORE.*INTERNAL ASSERTION FAILED/i.test(msg);
}

window.addEventListener('error', (e) => {
  if (_isFirestoreAssertionError(e?.message) || _isFirestoreAssertionError(e?.error?.message)) {
    _recoverFromFirestoreCorruption();
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || (typeof e?.reason === 'string' ? e.reason : '');
  if (_isFirestoreAssertionError(msg)) _recoverFromFirestoreCorruption();
});

// Clear the recovery sentinel once Firestore returns a healthy authenticated
// response. Must wait for auth — running this probe before sign-in violates
// security rules and produces a misleading 400.
auth.onAuthStateChanged((user) => {
  if (!user) return;
  firestore.collection('users').doc(user.uid).get()
    .then(() => sessionStorage.removeItem('prerna_fs_recovering'))
    .catch(() => {});
});
