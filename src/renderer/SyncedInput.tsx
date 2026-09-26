import { useEffect, useId, useRef, useState } from "react";
export function SyncedInput({
  value,
  type = "text",
  min,
  max,
  step,
  placeholder,
  commit,
}: {
  value: string;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
  placeholder?: string;
  commit: (value: string, previous: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState("");
  const baseline = useRef(value),
    dirty = useRef(false),
    latest = useRef(value);
  latest.current = value;
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const id = useId();
  useEffect(() => {
    if (!dirty.current) {
      setDraft(value);
      baseline.current = value;
    } else if (value !== baseline.current)
      setError(
        "Changed in another window. Your edit is preserved. Use latest or review and save again.",
      );
  }, [value]);
  async function save() {
    if (!dirty.current) return;
    if (baseline.current !== latest.current) {
      setError("Changed in another window. Use latest before editing again.");
      return;
    }
    const submitted = draft;
    try {
      await commit(submitted, baseline.current);
      baseline.current = submitted;
      dirty.current = currentDraft.current !== submitted;
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <input
        type={type}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={draft}
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
        onChange={(e) => {
          dirty.current = true;
          setDraft(e.target.value);
        }}
        onBlur={() => void save()}
      />
      {error && (
        <span id={id} role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              dirty.current = false;
              baseline.current = value;
              setDraft(value);
              setError("");
            }}
          >
            Use latest
          </button>
          <button type="button" onClick={() => void save()}>
            Retry save
          </button>
        </span>
      )}
    </>
  );
}
