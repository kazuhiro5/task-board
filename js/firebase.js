// Firebase の初期化・ログイン・データベースの窓口。
// 設定値（apiKey 含む）は公開してよい値。データはセキュリティルール（firestore.rules）で守る。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAwWhVaeyOUZyGp37V-wr_iHW0-JRjrdc8',
  authDomain: 'task-board-kz.firebaseapp.com',
  projectId: 'task-board-kz',
  storageBucket: 'task-board-kz.firebasestorage.app',
  messagingSenderId: '98237971758',
  appId: '1:98237971758:web:98bc6e3129bf38aeb18ebf',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// 端末内（IndexedDB）にも保存し、オフラインでも読み書きできるようにする
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export function watchUser(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // ポップアップが止められた時だけリダイレクト方式に切り替える
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      await signInWithRedirect(auth, provider);
    } else {
      throw e;
    }
  }
}

export function signOut() {
  return fbSignOut(auth);
}
