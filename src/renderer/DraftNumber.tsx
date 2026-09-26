import { useEffect, useRef, useState } from "react";
/** Keep incomplete numeric input editable; external updates only replace an untouched field. */
export function DraftNumber({
  value,
  onValue,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onValue: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  const [text, setText] = useState(
    Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : "",
  );
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current)
      setText(
        Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : "",
      );
  }, [value]);
  const n = text.trim() === "" ? NaN : Number(text),
    invalid = !Number.isFinite(n) || n < min || n > max;
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onChange={(e) => {
        setText(e.target.value);
        onValue(e.target.value.trim() === "" ? NaN : Number(e.target.value));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const next =
            (Number.isFinite(n) ? n : 0) + (e.key === "ArrowUp" ? step : -step);
          setText(String(Math.round(next * 10000) / 10000));
          onValue(next);
        }
      }}
    />
  );
}
