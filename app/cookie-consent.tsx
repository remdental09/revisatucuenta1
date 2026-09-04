"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

const CONSENT_VERSION = "2026-09-04-v1";
const STORAGE_KEY = `rtc_cookie_preferences:${CONSENT_VERSION}`;

type CookiePreferences = {
  version: string;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
};

const emptyPreferences = (): CookiePreferences => ({
  version: CONSENT_VERSION,
  necessary: true,
  analytics: false,
  marketing: false,
  updatedAt: new Date().toISOString(),
});

function parsePreferences(raw: string | null) {
  try {
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CookiePreferences>;
    if (
      value.version !== CONSENT_VERSION ||
      value.necessary !== true ||
      typeof value.analytics !== "boolean" ||
      typeof value.marketing !== "boolean"
    ) return null;
    return value as CookiePreferences;
  } catch {
    return null;
  }
}

function subscribeToStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function subscribeToHydration() {
  return () => {};
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

function getStoredPreferences() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function savePreferences(preferences: CookiePreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Private browsing or disabled storage must not block access to the site.
  }
}

function CookieCategory({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status: string;
  children?: ReactNode;
}) {
  return (
    <section className="cookie-category">
      <div className="cookie-category-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>{status}</span>
      </div>
      {children}
    </section>
  );
}

export function CookieConsent() {
  const storedPreferences = useSyncExternalStore(subscribeToStorage, getStoredPreferences, () => null);
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);
  const [localPreferences, setLocalPreferences] = useState<CookiePreferences | undefined>(undefined);
  const preferences = localPreferences ?? parsePreferences(storedPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  function openSettings() {
    setSettingsOpen(true);
  }

  function commit() {
    const next = emptyPreferences();
    savePreferences(next);
    setLocalPreferences(next);
    setSettingsOpen(false);
  }

  return (
    <>
      {hydrated && !preferences && !settingsOpen && (
        <aside className="cookie-banner" role="dialog" aria-label="Preferencias de cookies">
          <div className="cookie-banner-copy">
            <p className="cookie-kicker">Privacidad primero</p>
            <h2>Cookies y privacidad</h2>
            <p>
              Usamos cookies necesarias para el acceso seguro y la protección del sitio.
              Actualmente no activamos cookies de analítica, publicidad ni seguimiento.
            </p>
            <a href="/cookies">Ver política de cookies</a>
          </div>
          <div className="cookie-banner-actions">
            <button className="portal-button portal-button-primary" type="button" onClick={commit}>
              Rechazar opcionales
            </button>
            <button className="portal-button portal-button-secondary" type="button" onClick={openSettings}>
              Configurar cookies
            </button>
          </div>
        </aside>
      )}

      {hydrated && settingsOpen && (
        <div className="cookie-overlay" role="presentation">
          <section className="cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-dialog-title">
            <div className="cookie-dialog-header">
              <div>
                <p className="cookie-kicker">Control de privacidad</p>
                <h2 id="cookie-dialog-title">Elige qué permitir</h2>
              </div>
              <button className="cookie-close" type="button" aria-label="Cerrar preferencias" onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <p className="cookie-dialog-intro">
              Las cookies necesarias permiten iniciar sesión y proteger la plataforma. No se pueden desactivar desde este panel.
              Las categorías opcionales están apagadas y hoy no se cargan.
            </p>

            <CookieCategory
              title="Necesarias"
              description="Acceso, sesión y seguridad contra abuso. No se usan para publicidad ni para analizar tu cuenta clínica."
              status="Siempre activas"
            >
              <p className="cookie-details"><code>rtc_session</code> · sesión verificada, hasta 7 días · <code>__cf_bm</code> · protección anti-bots, hasta 30 minutos de inactividad.</p>
            </CookieCategory>

            <CookieCategory
              title="Analítica y mejora"
              description="Permitiría medir el uso general del sitio para mejorar su funcionamiento."
              status="No disponible"
            >
              <label className="cookie-disabled-option">
                <input type="checkbox" checked={false} disabled readOnly />
                <span>No hay cookies de esta categoría activas actualmente.</span>
              </label>
            </CookieCategory>

            <CookieCategory
              title="Publicidad y personalización"
              description="Permitiría recordar preferencias comerciales o medir campañas."
              status="No disponible"
            >
              <label className="cookie-disabled-option">
                <input type="checkbox" checked={false} disabled readOnly />
                <span>No hay cookies de esta categoría activas actualmente.</span>
              </label>
            </CookieCategory>

            <p className="cookie-legal-note">
              Esta decisión sólo se refiere a cookies. No reemplaza la autorización separada para tratar RUN, identidad o documentos de salud.
            </p>
            <div className="cookie-dialog-actions">
              <button className="portal-button portal-button-primary" type="button" onClick={commit}>
                Guardar selección
              </button>
              <a className="portal-button portal-button-secondary" href="/cookies">Leer política completa</a>
            </div>
          </section>
        </div>
      )}

      {hydrated && preferences && (
        <button className="cookie-settings-launcher" type="button" onClick={openSettings}>
          Cookies
        </button>
      )}
    </>
  );
}
