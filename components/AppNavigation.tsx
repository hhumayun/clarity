import React from "react";
import { LayoutDashboard, NotebookPen } from "lucide-react";
import { Link } from "react-router-dom";
import styles from "./AppNavigation.module.css";

interface AppNavigationProps {
  active: "notes" | "life-center";
  className?: string;
}

export const AppNavigation: React.FC<AppNavigationProps> = ({ active, className }) => (
  <nav className={`${styles.shell} ${className ?? ""}`} aria-label="Main sections">
    <div className={styles.navigation}>
      <Link to="/" className={styles.link} data-active={active === "notes"} aria-current={active === "notes" ? "page" : undefined}>
        <NotebookPen aria-hidden="true" />
        <span>Notes</span>
      </Link>
      <Link to="/life-center" className={styles.link} data-active={active === "life-center"} aria-current={active === "life-center" ? "page" : undefined}>
        <LayoutDashboard aria-hidden="true" />
        <span>Life Center</span>
      </Link>
    </div>
  </nav>
);
