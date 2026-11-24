import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Dialog({ title, children, close, busy = false }: {
  title: string; children: ReactNode; close: () => void; busy?: boolean;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(() => {
    const dialog = element.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      className="platform-dialog"
      ref={element}
      aria-labelledby={heading}
      onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}
    >
      <div className="dialog-head">
        <h2 id={heading}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
