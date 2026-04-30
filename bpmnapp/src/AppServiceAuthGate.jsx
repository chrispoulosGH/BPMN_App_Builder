import { useEffect, useMemo, useState } from 'react'

const LOGIN_PROVIDER = import.meta.env.VITE_AUTH_PROVIDER || 'aad'
const LOGIN_URL = `/.auth/login/${LOGIN_PROVIDER}?post_login_redirect_uri=/`
const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/'

function getDisplayName(principal) {
  const claims = Array.isArray(principal?.user_claims) ? principal.user_claims : []
  const claimMap = Object.fromEntries(
    claims
      .filter((claim) => claim && typeof claim.typ === 'string')
      .map((claim) => [claim.typ, claim.val]),
  )

  return (
    claimMap.name
    || claimMap.preferred_username
    || claimMap.email
    || principal?.user_id
    || 'Signed in user'
  )
}

function CenterMessage({ title, body, ctaLabel, ctaHref }) {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.body}>{body}</p>
        {ctaLabel && ctaHref ? (
          <a href={ctaHref} style={styles.button}>
            {ctaLabel}
          </a>
        ) : null}
      </section>
    </main>
  )
}

export default function AppServiceAuthGate({ children }) {
  const [status, setStatus] = useState('checking')
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    let active = true

    async function loadPrincipal() {
      try {
        const response = await fetch('/.auth/me', {
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        })

        // In local dev or when Easy Auth is off, this endpoint usually does not exist.
        if (!response.ok) {
          if (active) {
            setStatus('disabled')
          }
          return
        }

        const body = await response.json()
        const principal = Array.isArray(body) ? body[0] : null

        if (!active) {
          return
        }

        if (principal?.user_id) {
          setDisplayName(getDisplayName(principal))
          setStatus('authenticated')
        } else {
          setStatus('unauthenticated')
        }
      } catch {
        if (active) {
          setStatus('disabled')
        }
      }
    }

    loadPrincipal()
    return () => {
      active = false
    }
  }, [])

  const banner = useMemo(() => {
    if (status !== 'authenticated') {
      return null
    }

    return (
      <header style={styles.banner}>
        <span style={styles.bannerText}>Signed in as {displayName}</span>
        <a href={LOGOUT_URL} style={styles.link}>
          Sign out
        </a>
      </header>
    )
  }, [displayName, status])

  if (status === 'checking') {
    return <CenterMessage title="Checking authentication" body="Validating your session..." />
  }

  if (status === 'unauthenticated') {
    return (
      <CenterMessage
        title="Sign in required"
        body="Please sign in with your organization account to use this app."
        ctaLabel="Sign in"
        ctaHref={LOGIN_URL}
      />
    )
  }

  return (
    <>
      {banner}
      {children}
    </>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: '2rem',
    background:
      'radial-gradient(circle at 20% 10%, rgba(50, 115, 220, 0.15), transparent 50%), radial-gradient(circle at 80% 90%, rgba(20, 170, 120, 0.15), transparent 50%), #f6f8fb',
  },
  card: {
    width: '100%',
    maxWidth: '32rem',
    borderRadius: '1rem',
    backgroundColor: '#ffffff',
    padding: '2rem',
    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.12)',
    textAlign: 'center',
  },
  title: {
    margin: 0,
    fontSize: '1.35rem',
    color: '#0f172a',
  },
  body: {
    marginTop: '0.75rem',
    marginBottom: 0,
    color: '#334155',
    lineHeight: 1.5,
  },
  button: {
    marginTop: '1.25rem',
    display: 'inline-block',
    borderRadius: '0.625rem',
    backgroundColor: '#0f172a',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 600,
    padding: '0.7rem 1.05rem',
  },
  banner: {
    position: 'sticky',
    top: 0,
    zIndex: 30,
    padding: '0.625rem 1rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
  },
  bannerText: {
    fontSize: '0.9rem',
  },
  link: {
    color: '#dbeafe',
    textDecoration: 'underline',
    fontWeight: 600,
  },
}