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
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    try {
      if (isMobile()) {
        // Use redirect on mobile — avoids popup blocking on iOS
        await signInWithRedirect(auth, googleProvider);
      } else {
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
