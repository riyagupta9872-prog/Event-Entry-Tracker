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
