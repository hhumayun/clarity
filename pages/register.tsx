import React from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SignUp } from "@clerk/clerk-react";
import styles from "./register.module.css";

export default function RegisterPage() {
  return (
    <>
      <Helmet>
        <title>Create your account · Clarity Notes</title>
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
              Your notes stay yours. Nothing is shared with anyone else.
            </p>
          </header>

          <SignUp
            routing="path"
            path="/register"
            signInUrl="/login"
            fallbackRedirectUrl="/"
          />

          <p className={styles.switch}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>

          <p className={styles.disclaimer}>
            Clarity Notes is a writing aid, not a medical tool.
          </p>
        </div>
      </main>
    </>
  );
}
