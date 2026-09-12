import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "../components/Button";
import { Switch } from "../components/Switch";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../helpers/useAuth";
import { useInstallPrompt } from "../helpers/useInstallPrompt";
import {
  useClaritySettings,
  rememberThemeChoice,
} from "../helpers/useClaritySettings";
import { useThemeMode } from "../helpers/themeMode";
import styles from "./settings.module.css";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { authState, logout } = useAuth();
  const { xlText, setXlText } = useClaritySettings();
  const { mode, switchToLightMode, switchToDarkMode, switchToAutoMode } =
    useThemeMode();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const install = useInstallPrompt();

  const email = authState.type === "authenticated" ? authState.user.email : "";

  const appearanceOptions = [
    { label: "Light", value: "light" as const, apply: switchToLightMode },
    { label: "Dark", value: "dark" as const, apply: switchToDarkMode },
    { label: "Match device", value: "auto" as const, apply: switchToAutoMode },
  ];

  return (
    <>
      <Helmet>
        <title>Settings · Clarity Notes</title>
      </Helmet>
      <main className={styles.page}>
        <header className={styles.header}>
          <Button
            asChild
            variant="ghost"
            size="icon-lg"
            aria-label="Back to your notes"
            className={styles.back}
          >
            <Link to="/">
              <ChevronLeft className={styles.backIcon} aria-hidden="true" />
            </Link>
          </Button>
          <h1 className={styles.title}>Settings</h1>
        </header>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Reading comfort</h2>

          <div className={styles.settingRow}>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>Extra large text</span>
              <span className={styles.settingHint}>
                Makes all text in the app bigger.
              </span>
            </div>
            <Switch
              checked={xlText}
              onCheckedChange={setXlText}
              aria-label="Extra large text"
            />
          </div>

          <div className={styles.settingText}>
            <span className={styles.settingLabel}>Appearance</span>
            <span className={styles.settingHint}>
              Choose light, dark, or follow your device.
            </span>
          </div>
          <div className={styles.choiceRow} role="group" aria-label="Appearance">
            {appearanceOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.choice}
                data-active={mode === option.value}
                aria-pressed={mode === option.value}
                onClick={() => {
                  option.apply();
                  rememberThemeChoice(option.value === "auto");
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {install.kind !== "hidden" && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>On this device</h2>
            {install.kind === "prompt" ? (
              <>
                <p className={styles.settingHint}>
                  Add Clarity Notes to your home screen. It opens on its own, like any other app.
                </p>
                <Button size="lg" className={styles.fullButton} onClick={() => void install.install()}>
                  <Download className={styles.installIcon} aria-hidden="true" />
                  Install app
                </Button>
              </>
            ) : (
              <p className={styles.settingHint}>
                In Safari, tap Share, then Add to Home Screen. Clarity Notes will sit with your other apps.
              </p>
            )}
          </section>
        )}

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Privacy</h2>
          <Link to="/privacy" className={styles.linkRow}>
            <span className={styles.settingText}>
              <span className={styles.settingLabel}>
                Privacy &amp; personalization
              </span>
              <span className={styles.settingHint}>
                Control word suggestions, export or delete your data.
              </span>
            </span>
            <ChevronRight className={styles.linkIcon} aria-hidden="true" />
          </Link>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Account</h2>
          {email && (
            <p className={styles.settingHint}>Signed in as {email}</p>
          )}
          <Button
            variant="secondary"
            size="lg"
            className={styles.fullButton}
            onClick={() => setConfirmLogout(true)}
          >
            Log out
          </Button>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>About</h2>
          <p className={styles.settingHint}>
            Clarity Notes is a calm writing space with gentle word help. It is a
            writing aid, not a medical tool.
          </p>
        </section>

        <ConfirmDialog
          open={confirmLogout}
          onOpenChange={setConfirmLogout}
          title="Log out?"
          description="Your notes stay safely saved to your account."
          confirmLabel="Log out"
          cancelLabel="Stay signed in"
          loading={loggingOut}
          onConfirm={async () => {
            setLoggingOut(true);
            try {
              await logout();
              navigate("/login", { replace: true });
            } finally {
              setLoggingOut(false);
              setConfirmLogout(false);
            }
          }}
        />
      </main>
    </>
  );
}