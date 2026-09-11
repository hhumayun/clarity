import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { PenLine, MessageCircle, Lock } from "lucide-react";
import { Button } from "../components/Button";
import { useClaritySettings } from "../helpers/useClaritySettings";
import styles from "./onboarding.module.css";

const STEPS = [
  {
    Icon: PenLine,
    title: "Write freely",
    body: "Your notes save by themselves as you type. Nothing to remember, nothing to lose.",
  },
  {
    Icon: MessageCircle,
    title: "Gentle word help",
    body: "When a word is hard to find, look just below what you are writing. Tap a bubble to add it — or simply ignore them.",
  },
  {
    Icon: Lock,
    title: "Private by default",
    body: "Your notes belong to you. The app learns the phrases you like to offer better help — you can turn this off or clear it any time in Settings.",
  },
] as const;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { completeOnboarding } = useClaritySettings();
  const [step, setStep] = useState(0);

  const finish = () => {
    completeOnboarding();
    navigate("/", { replace: true });
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const { Icon } = current;

  return (
    <>
      <Helmet>
        <title>Welcome · Clarity Notes</title>
      </Helmet>
      <main className={styles.page}>
        <section className={styles.stage} aria-live="polite">
          <div className={styles.iconRing}>
            <Icon className={styles.icon} aria-hidden="true" />
          </div>
          <h1 className={styles.title}>{current.title}</h1>
          <p className={styles.body}>{current.body}</p>
        </section>

        <div className={styles.dots} aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={styles.dot}
              data-active={i === step}
            />
          ))}
        </div>

        <div className={styles.actions}>
          <Button
            size="lg"
            className={styles.primaryAction}
            onClick={() => (isLast ? finish() : setStep(step + 1))}
          >
            {isLast ? "Start writing" : "Next"}
          </Button>
          {!isLast && (
            <Button
              variant="ghost"
              size="lg"
              className={styles.skipAction}
              onClick={finish}
            >
              Skip
            </Button>
          )}
        </div>
      </main>
    </>
  );
}