import React from "react";
import styles from "./ReflectionStrip.module.css";

interface ReflectionStripProps {
  question: string;
  onPress: () => void;
  className?: string;
}

/**
 * A calm strip holding one gentle question. Tapping it adds the question to
 * the note so the writer can answer it in their own words.
 */
export const ReflectionStrip: React.FC<ReflectionStripProps> = ({
  question,
  onPress,
  className,
}) => {
  return (
    <div className={`${styles.container} ${className ?? ""}`}>
      <button
        type="button"
        className={styles.strip}
        onClick={onPress}
        aria-label={`Reflection question: ${question}. Adds this question to your note so you can answer it.`}
      >
        <span className={styles.mark} aria-hidden="true">
          ✦
        </span>
        <span className={styles.question}>{question}</span>
        <span className={styles.hint}>tap to answer</span>
      </button>
    </div>
  );
};