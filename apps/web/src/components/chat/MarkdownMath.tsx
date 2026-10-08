import { lazy, Suspense } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { texMathCopyText } from "../../markdown-math";

const KatexMath = lazy(() => import("./KatexMath"));

/** Whether the opt-in math rendering setting is on. */
export function useMathRendering(): boolean {
  return useClientSettings((settings) => settings.mathRenderingEnabled);
}

/**
 * Whether a code element came from the math syntax rather than from a fence or
 * the author's raw HTML, which can carry the same `language-math-*` class. The
 * source at the element's position is what tells them apart: the math syntax
 * always begins with its `\(` or `\[` opener, which neither of those can.
 */
export function isTexMath(
  node: { position?: { start: { offset?: number | undefined } } | undefined } | undefined,
  source: string,
  display: boolean,
): boolean {
  const offset = node?.position?.start.offset;
  return typeof offset === "number" && source.startsWith(display ? "\\[" : "\\(", offset);
}

/** Shows the TeX source until KaTeX has loaded, and again if it cannot typeset it. */
export function MarkdownMath({ tex, display }: { tex: string; display: boolean }) {
  const copy = texMathCopyText(tex, display);
  const source = display ? (
    <pre data-markdown-copy={copy}>
      <code>{tex}</code>
    </pre>
  ) : (
    <code data-markdown-copy={copy}>{tex}</code>
  );
  return (
    <Suspense fallback={source}>
      <KatexMath tex={tex} display={display} fallback={source} />
    </Suspense>
  );
}
