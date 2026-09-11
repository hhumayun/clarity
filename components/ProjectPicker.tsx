import React, { useState } from "react";
import { Plus } from "lucide-react";
import type { ProjectRecord } from "../helpers/TaskRecord";
import { Button } from "./Button";
import { Input } from "./Input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./Dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./Select";
import styles from "./ProjectPicker.module.css";

interface ProjectPickerProps {
  projects: ProjectRecord[];
  value: string;
  disabled?: boolean;
  className?: string;
  onChange: (projectId: string) => void;
  onCreate: (name: string) => Promise<ProjectRecord>;
}

const NEW_PROJECT = "__new_project__";

export const ProjectPicker: React.FC<ProjectPickerProps> = ({
  projects, value, disabled, className, onChange, onCreate,
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    const clean = name.trim();
    if (!clean) return;
    setSaving(true);
    setError("");
    try {
      const project = await onCreate(clean);
      onChange(project.id);
      setName("");
      setOpen(false);
    } catch {
      setError("That project could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => next === NEW_PROJECT ? setOpen(true) : onChange(next)}
      >
        <SelectTrigger className={className} aria-label="Project">
          <SelectValue placeholder="Choose a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
          ))}
          <SelectItem value={NEW_PROJECT}>
            <span className={styles.newOption}><Plus aria-hidden="true" />Add a new project</span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a project</DialogTitle>
            <DialogDescription>Give this area of your life a short, familiar name.</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void create(); }
            }}
            placeholder="For example, Family"
            aria-label="New project name"
            maxLength={120}
            autoFocus
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void create()} disabled={saving || !name.trim()}>
              {saving ? "Adding…" : "Add project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
