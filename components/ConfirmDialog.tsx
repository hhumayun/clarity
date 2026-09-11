import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  className?: string;
}

/**
 * Every action that cannot be undone asks first, in plain words, with the
 * safe choice on the left and equal weight given to backing out.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep it",
  destructive = false,
  loading = false,
  onConfirm,
  className,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${styles.content} ${className ?? ""}`}>
        <DialogHeader>
          <DialogTitle className={styles.title}>{title}</DialogTitle>
          <DialogDescription className={styles.description}>
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className={styles.footer}>
          <Button
            variant="secondary"
            size="lg"
            className={styles.action}
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            size="lg"
            className={styles.action}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Spinner size="sm" /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};