// ===== DATABASE LAYER (Firestore) =====
const DB = (() => {
  let currentEventId = null;

  const STORES = {
    attendees: 'participants',
    users: 'users',
    config: 'config',
    busRoutes: 'busRoutes',
    buses: 'buses',
    auditLog: 'auditLog',
    offlineQueue: 'offlineQueue'
  };

  function setCurrentEvent(id) {
    currentEventId = id;
    if (id) localStorage.setItem('prerna_active_event', id);
    else localStorage.removeItem('prerna_active_event');
  }

  function getCurrentEvent() {
    if (!currentEventId) currentEventId = localStorage.getItem('prerna_active_event');
    return currentEventId;
  }

  function getCollection(storeName) {
    if (storeName === 'users') return firestore.collection('users');
    const eid = getCurrentEvent();
    if (!eid) throw new Error('No event selected');
    return firestore.collection('events').doc(eid).collection(storeName);
  }

  async function open() { /* Firestore is ready after firebase.initializeApp */ }

  async function getAll(storeName, filter) {
    const snap = await getCollection(storeName).get();
    let results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (filter) results = results.filter(filter);
    return results;
  }

  async function getById(storeName, id) {
    const doc = await getCollection(storeName).doc(String(id)).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  async function put(storeName, record) {
    const id = String(record.id);
    const data = { ...record };
    delete data.id;
    await getCollection(storeName).doc(id).set(data, { merge: true });
    return id;
  }

  async function add(storeName, record) {
    const data = { ...record };
    delete data.id;
    const ref = await getCollection(storeName).add(data);
    return ref.id;
  }

  async function deleteRecord(storeName, id) {
    await getCollection(storeName).doc(String(id)).delete();
  }

  async function clearStore(storeName) {
    const snap = await getCollection(storeName).get();
    const docs = snap.docs;
    // Firestore batch limit is 500
    for (let i = 0; i < docs.length; i += 500) {
      const batch = firestore.batch();
      docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  async function bulkAdd(storeName, records) {
    const col = getCollection(storeName);
    let count = 0;
    for (let i = 0; i < records.length; i += 500) {
      const batch = firestore.batch();
      const chunk = records.slice(i, i + 500);
      chunk.forEach(r => {
        const data = { ...r };
        delete data.id;
        batch.set(col.doc(), data);
      });
      await batch.commit();
      count += chunk.length;
    }
    return count;
  }

  // Config helpers
  async function getConfig(key) {
    try {
      const doc = await getCollection('config').doc(key).get();
      return doc.exists ? doc.data().value : null;
    } catch { return null; }
  }

  async function setConfig(key, value) {
    await getCollection('config').doc(key).set({ value });
  }

  // Audit log
  async function log(action, details, user) {
    return add('auditLog', {
      action, details, user,
      timestamp: new Date().toISOString()
    });
  }

  // ===== EVENT MANAGEMENT =====
  async function getEvents() {
    const snap = await firestore.collection('events').orderBy('createdAt', 'desc').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async function createEvent(eventData) {
    const ref = await firestore.collection('events').add({
      ...eventData,
      createdAt: new Date().toISOString()
    });
    return ref.id;
  }

  async function getEvent(eventId) {
    const doc = await firestore.collection('events').doc(eventId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  async function updateEvent(eventId, data) {
    await firestore.collection('events').doc(eventId).update(data);
  }

  async function deleteEvent(eventId) {
    // Delete subcollections first
    for (const sub of ['participants', 'config', 'busRoutes', 'buses', 'auditLog']) {
      const snap = await firestore.collection('events').doc(eventId).collection(sub).get();
      for (let i = 0; i < snap.docs.length; i += 500) {
        const batch = firestore.batch();
        snap.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    await firestore.collection('events').doc(eventId).delete();
  }

  // ===== USER PROFILE (Firestore) =====
  async function getUserProfile(uid) {
    const doc = await firestore.collection('users').doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  async function setUserProfile(uid, data) {
    await firestore.collection('users').doc(uid).set(data, { merge: true });
  }

  return {
    STORES, open, getAll, getById, put, add, deleteRecord, clearStore, bulkAdd,
    getConfig, setConfig, log,
    setCurrentEvent, getCurrentEvent,
    getEvents, createEvent, getEvent, updateEvent, deleteEvent,
    getUserProfile, setUserProfile
  };
})();
