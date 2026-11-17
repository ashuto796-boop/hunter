import { ReactNode, useState } from "react";

// A details block, closed by default: one slim line (title + short hint), the cards inside only
// when opened. What the owner opened stays open on this phone.
export function Fold({ id, title, hint, children, open: initial = false }: { id: string; title: string; hint?: ReactNode; children: ReactNode; open?: boolean }) {
  const key = `aurum.fold.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? "0" : "1");
    } catch {
      /* private mode: just not remembered */
    }
  };
  return (
    <div className={`fold ${open ? "open" : ""}`}>
      <button className="fold-head" onClick={toggle} aria-expanded={open}>
        <span className="fold-title">{title}</span>
        {hint && <span className="fold-hint">{hint}</span>}
        <span className="fold-chev" aria-hidden>
          ›
        </span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}

// A small label above a group of folds
export const FoldGroup = ({ label }: { label: string }) => <div className="fold-group">{label}</div>;
