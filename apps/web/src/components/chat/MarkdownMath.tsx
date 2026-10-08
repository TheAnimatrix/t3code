import { lazy, Suspense } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { texMathAttributes } from "../../markdown-math";
import { RenderErrorBoundary } from "../RenderErrorBoundary";

const KatexMath = lazy(() => import("./KatexMath"));

/** Whether the opt-in math rendering setting is on. */
export function useMathRendering(): boolean {
  return useClientSettings((settings) => settings.mathRenderingEnabled);
}

/**
 * Whether a code element came from the math syntax rather than from a fence or
 * the author's raw HTML. Raw HTML can carry the same `language-math-*` class, so
 * the source at the element's position has to begin with the `\(` or `\[`
 * opener too. That alone is not enough: offsets inside a raw HTML block in a
 * blockquote leave out its `> ` prefixes, so an authored element can land on one.
 */
export function isTexMath(
  node: { position?: { start: { offset?: number | undefined } } | undefined } | undefined,
  className: string | undefined,
  source: string,
  display: boolean,
): boolean {
  const offset = node?.position?.start.offset;
  return (
    className?.split(/\s+/).includes(display ? "language-math-display" : "language-math-inline") ===
      true &&
    typeof offset === "number" &&
    source.startsWith(display ? "\\[" : "\\(", offset)
  );
}

/**
 * Shows the TeX source until KaTeX has loaded, and again if it cannot typeset
 * it or the chunk fails to load. A failed load stays failed until the page is
 * reloaded, as for any other lazy chunk.
 */
export function MarkdownMath({ tex, display }: { tex: string; display: boolean }) {
  const attributes = texMathAttributes(tex, display);
  const source = display ? (
    <pre {...attributes}>
      <code>{tex}</code>
    </pre>
  ) : (
    <code {...attributes}>{tex}</code>
  );
  return (
    <RenderErrorBoundary resetKeys={[tex, display]} fallback={source}>
      <Suspense fallback={source}>
        <KatexMath tex={tex} display={display} fallback={source} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
