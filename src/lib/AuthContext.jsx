import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  // `checkAppState` is declared below — useEffect runs POST-render,
  // after the const is initialised. Safe at runtime; lint fires on
  // declaration order only.
  useEffect(() => {
    // eslint-disable-next-line no-use-before-define
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);

      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.user_metadata?.full_name || '',
          ...session.user.user_metadata,
        });
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'Failed to check auth',
      });
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  // Listen for auth changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.user_metadata?.full_name || '',
          ...session.user.user_metadata,
        });
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    setUser(null);
    setIsAuthenticated(false);
    // Clear in-flight signup/verify state. Without this, a user who
    // started a signup, never confirmed the OTP, and then signed out
    // would have `cr_pending_verify_email` linger in sessionStorage —
    // so the next reload of AuthPage forced them back into the
    // verify-email modal even though they're trying to log into a
    // different account / reset / register fresh. Same for the EULA
    // gate that the signup flow primes ahead of time.
    try { sessionStorage.removeItem('cr_pending_verify_email'); } catch {}
    try { sessionStorage.removeItem('cr_pending_eula'); } catch {}
    await supabase.auth.signOut();
  };

  const navigateToLogin = () => {
    window.location.hash = '#/auth';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
