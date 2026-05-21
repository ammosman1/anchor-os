// src/context/AuthContext.js
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { getProfile, saveProfile } from '../lib/db';

const AuthContext = createContext(null);

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// Running as an installed PWA (standalone mode).
// On iOS, signInWithRedirect sends the user to Safari and the auth result
// never makes it back to the standalone app context. Use popup instead.
function isStandalonePWA() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Handle redirect result on mobile after returning from Google
    getRedirectResult(auth).catch(() => {});

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const prof = await getProfile(firebaseUser.uid);
        setProfile(prof);
        if (firebaseUser.email) {
          saveProfile(firebaseUser.uid, { email: firebaseUser.email }).catch(() => {});
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    try {
      if (isMobile() && !isStandalonePWA()) {
        // Mobile browser: redirect avoids popup blocking
        await signInWithRedirect(auth, googleProvider);
      } else {
        // Desktop or standalone PWA: use popup.
        // Redirect cannot be used in standalone PWA — on iOS the redirect
        // returns to Safari rather than the installed app, breaking auth.
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
      }
    } catch (err) {
      console.error('Sign in error:', err);
      throw err;
    }
  };

  const logout = () => signOut(auth);

  const updateProfile = async (data) => {
    if (!user) return;
    await saveProfile(user.uid, data);
    setProfile(prev => ({ ...prev, ...data }));
  };

  const isOnboarded = profile?.onboardingComplete === true;

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isOnboarded,
      signInWithGoogle,
      logout,
      updateProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
