import { useEffect, useRef, useState } from "react";
type Choice = { label: string; value: string; primary?: boolean };
type Question = {
  title: string;
  body: string;
  choices: Choice[];
  resolve: (value: string) => void;
};
let publish: ((q: Question) => void) | undefined;
let pending: Promise<string> | undefined;
export function ask(
  title: string,
  body: string,
  choices: Choice[],
): Promise<string> {
  if (pending) return pending;
  pending = new Promise<string>((resolve) => {
    if (!publish) {
      resolve("cancel");
      return;
    }
    publish({ title, body, choices, resolve });
  }).finally(() => {
    pending = undefined;
  });
  return pending;
}
export function DialogHost() {
  const [question, setQuestion] = useState<Question>();
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    publish = setQuestion;
    return () => {
      publish = undefined;
    };
  }, []);
  useEffect(() => {
    if (question) {
      previous.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    }
  }, [question]);
  function finish(value: string) {
    dialog.current?.close();
    question?.resolve(value);
    setQuestion(undefined);
    if (previous.current?.isConnected) previous.current.focus();
  }
  return (
    <dialog
      className="studio-dialog"
      ref={dialog}
      aria-labelledby="dialog-title"
      aria-describedby="dialog-body"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        finish("cancel");
      }}
    >
      <h2 id="dialog-title">{question?.title}</h2>
      <p id="dialog-body">{question?.body}</p>
      <div className="dialog-actions">
        {question?.choices.map((choice) => (
          <button
            key={choice.value}
            autoFocus={choice.value === "cancel"}
            className={choice.primary ? "primary" : ""}
            onClick={() => finish(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
