import React from "react";
import { Plus, Minus, X } from "lucide-react";
import { Spinner } from "./Spinner";
import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_CATEGORY_LABELS,
  type BubbleSuggestion,
  type CompletionSuggestion,
  type Suggestion,
  type SuggestionCategory,
} from "../helpers/suggestionCategories";
import styles from "./InlineSuggestions.module.css";

interface InlineSuggestionsProps {
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  loading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAccept: (suggestion: BubbleSuggestion) => void;
  onDismiss: (suggestion: BubbleSuggestion) => void;
  className?: string;
}

const COLLAPSED_COUNT = 4;

const Chip = ({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: BubbleSuggestion;
  onAccept: (s: BubbleSuggestion) => void;
  onDismiss: (s: BubbleSuggestion) => void;
}) => (
  <span
    className={styles.chipWrap}
    data-category={"category" in suggestion ? suggestion.category : "completion"}
  >
    <button
      type="button"
      className={styles.chip}
      onClick={() => onAccept(suggestion)}
      aria-label={`Insert: ${suggestion.text}`}
      title="Adds these words to your note"
    >
      {suggestion.text}
    </button>
    <button
      type="button"
      className={styles.chipDismiss}
      onClick={() => onDismiss(suggestion)}
      aria-label={`Hide the suggestion: ${suggestion.text}`}
    >
      <X className={styles.chipDismissIcon} aria-hidden="true" />
    </button>
  </span>
);

/**
 * Word bubbles that flow with the note text: a wrapping row of sentence
 * starters right after the writing, a "more" expander, and a grouped panel
 * when opened. The row and the panel never show at once — the same phrase
 * appearing twice reads as a glitch.
 */
export const InlineSuggestions: React.FC<InlineSuggestionsProps> = ({
  suggestions,
  completionSuggestions,
  loading,
  expanded,
  onToggleExpanded,
  onAccept,
  onDismiss,
  className,
}) => {
  if (suggestions.length === 0 && completionSuggestions.length === 0) {
    if (!loading) return null;
    return (
      <div className={`${styles.status} ${className ?? ""}`} aria-live="polite">
        <Spinner size="sm" />
        <span>Finding words…</span>
      </div>
    );
  }

  const inlineRow = suggestions.slice(0, COLLAPSED_COUNT);
  const hiddenCount = suggestions.length - inlineRow.length;

  return (
    <div className={`${styles.container} ${className ?? ""}`}>
      {completionSuggestions.length > 0 && (
        <section className={styles.completionSection} aria-label="Finish this sentence">
          <p className={styles.sectionLabel}>FINISH THIS SENTENCE</p>
          <div className={styles.row}>
            {completionSuggestions.map((suggestion) => (
              <Chip
                key={suggestion.text}
                suggestion={suggestion}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </section>
      )}

      {!expanded && (
        <section className={styles.starterSection} aria-label="Start the next sentence">
          <p className={styles.sectionLabel}>START THE NEXT SENTENCE</p>
          <div className={styles.row}>
            {inlineRow.map((suggestion) => (
              <Chip
                key={suggestion.text}
                suggestion={suggestion}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className={styles.expander}
                onClick={onToggleExpanded}
                aria-expanded={false}
                aria-label={`Show ${hiddenCount} more suggestions, grouped by type`}
              >
                <Plus className={styles.expanderIcon} aria-hidden="true" />
                {hiddenCount} more
              </button>
            )}
          </div>
        </section>
      )}

      {expanded && (
        <div className={styles.panel}>
          {SUGGESTION_CATEGORIES.map((category: SuggestionCategory) => {
            const group = suggestions.filter((s) => s.category === category);
            if (group.length === 0) return null;
            return (
              <div key={category} className={styles.group}>
                <h3 className={styles.groupLabel} data-category={category}>
                  {SUGGESTION_CATEGORY_LABELS[category]}
                </h3>
                <div className={styles.row}>
                  {group.map((suggestion) => (
                    <Chip
                      key={suggestion.text}
                      suggestion={suggestion}
                      onAccept={onAccept}
                      onDismiss={onDismiss}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className={styles.expander}
            onClick={onToggleExpanded}
            aria-expanded={true}
            aria-label="Show fewer suggestions"
          >
            <Minus className={styles.expanderIcon} aria-hidden="true" />
            Show less
          </button>
        </div>
      )}
    </div>
  );
};