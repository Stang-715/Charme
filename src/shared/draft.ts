export interface TextDraft {
  title: string;
  body: string;
}
export function sameDraft(a: TextDraft, b: TextDraft) {
  return a.title === b.title && a.body === b.body;
}
/** An acknowledgement applies to the submitted value, never to later keystrokes. */
export function acknowledgeDraft(
  submitted: TextDraft,
  current: TextDraft,
  revision: number,
) {
  return {
    saved: { ...submitted },
    clean: sameDraft(submitted, current),
    pending: sameDraft(submitted, current) ? null : { ...current, revision },
  };
}
