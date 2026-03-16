// ===== DATABASE LAYER (IndexedDB) =====
const DB = (() => {
  const DB_NAME = 'PrernaFestival';
  const DB_VERSION = 1;
  let db = null;

  const STORES = {
    attendees: 'attendees',
    users: 'users',
    config: 'config',
    busRoutes: 'busRoutes',
    auditLog: 'auditLog',
    offlineQueue: 'offlineQueue'
  };

  async function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORES.attendees)) {
          const s = d.createObjectStore(STORES.attendees, { keyPath: 'id', autoIncrement: true });
          s.createIndex('mobile', 'mobile');
          s.createIndex('name', 'name');
          s.createIndex('team', 'team');
          s.createIndex('reference', 'reference');
          s.createIndex('attendance', 'attendance');
        }
        if (!d.objectStoreNames.contains(STORES.users)) {
          const u = d.createObjectStore(STORES.users, { keyPath: 'username' });
        }
        if (!d.objectStoreNames.contains(STORES.config)) {
          d.createObjectStore(STORES.config, { keyPath: 'key' });
        }
        if (!d.objectStoreNames.contains(STORES.busRoutes)) {
          d.createObjectStore(STORES.busRoutes, { keyPath: 'id', autoIncrement: true });
        }
        if (!d.objectStoreNames.contains(STORES.auditLog)) {
          const al = d.createObjectStore(STORES.auditLog, { keyPath: 'id', autoIncrement: true });
          al.createIndex('timestamp', 'timestamp');
        }
        if (!d.objectStoreNames.contains(STORES.offlineQueue)) {
          d.createObjectStore(STORES.offlineQueue, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function tx(storeName, mode = 'readonly') {
    const d = await open();
    return d.transaction(storeName, mode).objectStore(storeName);
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // Generic CRUD
  async function getAll(storeName, filter) {
    const store = await tx(storeName);
    const all = await promisify(store.getAll());
    if (filter) return all.filter(filter);
    return all;
  }

  async function getById(storeName, id) {
    const store = await tx(storeName);
    return promisify(store.get(id));
  }

  async function put(storeName, record) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.put(record));
  }

  async function add(storeName, record) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.add(record));
  }

  async function deleteRecord(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.delete(id));
  }

  async function clearStore(storeName) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.clear());
  }

  async function bulkAdd(storeName, records) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const transaction = d.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      let count = 0;
      records.forEach(r => {
        const req = store.add(r);
        req.onsuccess = () => { count++; if (count === records.length) {} };
      });
      transaction.oncomplete = () => resolve(count);
      transaction.onerror = (e) => reject(e.target.error);
    });
  }

  // Config helpers
  async function getConfig(key) {
    const store = await tx(STORES.config);
    const r = await promisify(store.get(key));
    return r ? r.value : null;
  }

  async function setConfig(key, value) {
    const store = await tx(STORES.config, 'readwrite');
    return promisify(store.put({ key, value }));
  }

  // Audit log
  async function log(action, details, user) {
    return add(STORES.auditLog, {
      action, details, user,
      timestamp: new Date().toISOString()
    });
  }

  return {
    STORES, open, getAll, getById, put, add, deleteRecord, clearStore, bulkAdd,
    getConfig, setConfig, log, promisify
  };
})();
