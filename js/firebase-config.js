/**
 * Firebase Configuration & Firestore Database Service
 * Eastern Sugar and Cane Public Company Limited
 * 
 * Instructions:
 * 1. Replace the placeholder values in FIREBASE_CONFIG with your Firebase Project credentials.
 * 2. To get your config: Firebase Console -> Project Settings -> General -> Your apps -> Web App (</>)
 */

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCajqMhmGz55-0M_TwA55MrWvJUB6JYUY8",
    authDomain: "esc-satisfaction.firebaseapp.com",
    projectId: "esc-satisfaction",
    storageBucket: "esc-satisfaction.firebasestorage.app",
    messagingSenderId: "962316431976",
    appId: "1:962316431976:web:3afdc5510c2f3fe06e41dd",
    measurementId: "G-VJX1E0V6B6"
};

let firebaseDb = null;
let isFirebaseReady = false;

function isFirebaseConfigured() {
    return FIREBASE_CONFIG && 
           FIREBASE_CONFIG.apiKey && 
           !FIREBASE_CONFIG.apiKey.includes("YOUR_API_KEY_HERE") &&
           FIREBASE_CONFIG.projectId &&
           !FIREBASE_CONFIG.projectId.includes("YOUR_PROJECT_ID");
}

function initFirebase() {
    if (typeof firebase === 'undefined') {
        console.warn("Firebase SDK not loaded. Operating in offline/local mode.");
        return false;
    }

    if (!isFirebaseConfigured()) {
        console.info("Firebase config is using placeholders. Operating in local mode (localStorage / API).");
        return false;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        firebaseDb = firebase.firestore();
        
        // Enable offline persistence if available
        try {
            firebaseDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
        } catch (e) {}

        isFirebaseReady = true;
        console.log("✅ Cloud Firestore initialized successfully for project:", FIREBASE_CONFIG.projectId);
        return true;
    } catch (err) {
        console.error("Failed to initialize Firebase:", err);
        return false;
    }
}

/**
 * Save evaluation record to Cloud Firestore
 * @param {Object} evaluation 
 * @returns {Promise<boolean>}
 */
async function saveEvaluationToCloud(evaluation) {
    if (!isFirebaseReady || !firebaseDb) {
        return false;
    }

    try {
        const docId = evaluation.id || ('EVAL-' + Date.now());
        await firebaseDb.collection('evaluations').doc(docId).set(evaluation);
        console.log("Evaluation record synced to Cloud Firestore:", docId);
        return true;
    } catch (err) {
        console.error("Firestore save error:", err);
        return false;
    }
}

/**
 * Fetch all evaluation records from Cloud Firestore
 * @returns {Promise<Array|null>}
 */
async function fetchEvaluationsFromCloud() {
    if (!isFirebaseReady || !firebaseDb) {
        return null;
    }

    try {
        const snapshot = await firebaseDb.collection('evaluations')
            .orderBy('timestamp', 'desc')
            .get();

        const results = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = data.id || doc.id;
            results.push(data);
        });
        return results;
    } catch (err) {
        console.warn("Firestore fetch warning (falling back to local cache):", err);
        return null;
    }
}

/**
 * Delete a single evaluation record from Cloud Firestore
 * @param {string} docId
 * @returns {Promise<boolean>}
 */
async function deleteEvaluationFromCloud(docId) {
    if (!isFirebaseReady || !firebaseDb || !docId) {
        return false;
    }

    try {
        await firebaseDb.collection('evaluations').doc(docId).delete();
        console.log("Evaluation deleted from Cloud Firestore:", docId);
        return true;
    } catch (err) {
        console.error("Firestore delete error:", err);
        return false;
    }
}

/**
 * Clear all evaluation records from Cloud Firestore
 * @returns {Promise<boolean>}
 */
async function clearAllEvaluationsFromCloud() {
    if (!isFirebaseReady || !firebaseDb) {
        return false;
    }

    try {
        const snapshot = await firebaseDb.collection('evaluations').get();
        if (snapshot.empty) return true;

        // Process in batches (Firestore batch limit is 500)
        const batch = firebaseDb.batch();
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Cleared ${snapshot.size} evaluations from Cloud Firestore`);
        return true;
    } catch (err) {
        console.error("Firestore clear all error:", err);
        return false;
    }
}
