import React, { createContext, useState, useContext, useEffect, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

const AuthContext = createContext()

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('Failed to load profile:', error)
    return null
  }
  return data
}

function buildAppUser(authUser, profile) {
  if (!authUser) return null
  return {
    id: authUser.id,
    email: authUser.email,
    full_name:
      profile?.full_name ||
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.email?.split('@')[0] ||
      'User',
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [session, setSession] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoadingAuth, setIsLoadingAuth] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)

  const applySession = useCallback(async (nextSession) => {
    setSession(nextSession)
    if (!nextSession?.user) {
      setUser(null)
      setProfile(null)
      setIsAuthenticated(false)
      setIsLoadingAuth(false)
      setAuthChecked(true)
      return
    }

    // Mark authenticated immediately so Login can navigate on the first attempt.
    // Do not flip isLoadingAuth back to true after the initial check — that used to
    // unmount public routes in App and make the first login click appear to do nothing.
    setIsAuthenticated(true)
    setUser(buildAppUser(nextSession.user, null))
    setIsLoadingAuth(false)
    setAuthChecked(true)

    const nextProfile = await fetchProfile(nextSession.user.id)
    setProfile(nextProfile)
    setUser(buildAppUser(nextSession.user, nextProfile))
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoadingAuth(false)
      setAuthChecked(true)
      setIsAuthenticated(false)
      return
    }

    let mounted = true

    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => {
        if (mounted) applySession(initialSession)
      })
      .catch((err) => {
        console.error('getSession failed:', err)
        if (mounted) {
          setIsLoadingAuth(false)
          setAuthChecked(true)
          setIsAuthenticated(false)
        }
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Supabase can deadlock if other auth/DB calls run inside this callback.
      // Defer so sign-in + profile fetch don't hang on the first attempt.
      setTimeout(() => {
        if (mounted) applySession(nextSession)
      }, 0)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [applySession])

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return null
    const nextProfile = await fetchProfile(session.user.id)
    setProfile(nextProfile)
    setUser(buildAppUser(session.user, nextProfile))
    return nextProfile
  }, [session])

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    setUser(null)
    setProfile(null)
    setSession(null)
    setIsAuthenticated(false)
  }, [])

  const logout = useCallback(
    async (redirectTo = '/login') => {
      await signOut()
      if (redirectTo) {
        window.location.href = redirectTo
      }
    },
    [signOut]
  )

  const navigateToLogin = useCallback(() => {
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings: false,
        authError: null,
        authChecked,
        isSupabaseConfigured,
        logout,
        signOut,
        navigateToLogin,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
