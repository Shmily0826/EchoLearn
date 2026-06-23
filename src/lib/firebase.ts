import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBv32XgQuKRkrjyLEYC9YIbYwqIT2PXttc',
  authDomain: 'echolearn-9f369.firebaseapp.com',
  projectId: 'echolearn-9f369',
  storageBucket: 'echolearn-9f369.firebasestorage.app',
  messagingSenderId: '820664709629',
  appId: '1:820664709629:web:e6c0a7c3a4aadc303d2994',
  measurementId: 'G-VD1GJG87JV',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
// Only request essential profile info — no extra scopes
googleProvider.setCustomParameters({ prompt: 'select_account' });

export default app;
