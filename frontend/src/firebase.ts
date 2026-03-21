import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyCBxr6KAGWUrcbSSaEzFfzvaQn1j-j-B08",
  authDomain: "drowseguard-ai.firebaseapp.com",
  projectId: "drowseguard-ai",
  storageBucket: "drowseguard-ai.firebasestorage.app",
  messagingSenderId: "75660774730",
  appId: "1:75660774730:web:ba8aaf98e9895fe37545b3",
  measurementId: "G-8WG3HMR17C"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
