// ===== FIREBASE CONFIGURATION =====
const firebaseConfig = {
  apiKey: "AIzaSyDSXe63wDzrdMLBJUjjr3pDRg0h9JmEYU0",
  authDomain: "event-tracker-1d6ad.firebaseapp.com",
  projectId: "event-tracker-1d6ad",
  storageBucket: "event-tracker-1d6ad.firebasestorage.app",
  messagingSenderId: "965224086431",
  appId: "1:965224086431:web:50d0a4400479288551dbaa"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const firestore = firebase.firestore();

// Enable offline persistence for Firestore
firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// Keep auth session persistent across tabs/reloads
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
