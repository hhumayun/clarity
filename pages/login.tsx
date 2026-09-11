import React from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SignIn } from "@clerk/clerk-react";
import styles from "./login.module.css";

export default function LoginPage() {
  return (
    <>
      <Helmet>
        <title>Sign in · Clarity Notes</title>
        <meta
          name="description"
          content="A calm writing space with gentle word help."
        />
      </Helmet>
      <main className={styles.page}>
        <div className={styles.card}>
          <header className={styles.header}>
            <h1 className={styles.wordmark}>Clarity Notes</h1>
            <p className={styles.tagline}>
              A calm place to write, with gentle help finding words.
            </p>
          </header>

          <SignIn
            routing="path"
            path="/login"
            signUpUrl="/register"
            fallbackRedirectUrl="/"
          />

          <p className={styles.switch}>
            New here? <Link to="/register">Create an account</Link>
          </p>

          <p className={styles.disclaimer}>
            Clarity Notes is a writing aid, not a medical tool.
          </p>
        </div>
      </main>
    </>
  );
}
