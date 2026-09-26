import { useState } from "react";
export function AccessibilityAudit() {
  const [result, setResult] = useState("Not run");
  return (
    <aside className="audit-panel" data-hit>
      <button
        onClick={async () => {
          setResult("Running…");
          const axe = await import("axe-core");
          const results = await axe.default.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          });
          setResult(
            JSON.stringify(
              {
                violations: results.violations.map((v) => ({
                  id: v.id,
                  impact: v.impact,
                  description: v.description,
                  nodes: v.nodes.map((n) => ({
                    target: n.target,
                    summary: n.failureSummary,
                  })),
                })),
                passes: results.passes.length,
                incomplete: results.incomplete.map((v) => v.id),
              },
              null,
              2,
            ),
          );
        }}
      >
        Run accessibility audit
      </button>
      <pre role="status">{result}</pre>
    </aside>
  );
}
