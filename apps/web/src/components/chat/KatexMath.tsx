import katex from "katex";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";

import { texMathCopyText } from "../../markdown-math";

/**
 * The only module that imports KaTeX and its stylesheet, so both load together
 * the first time a formula is shown. Mermaid already ships the same KaTeX build,
 * and the bundler shares it between the two lazy chunks. Input is model output,
 * so `trust` stays off; a formula KaTeX rejects shows its source instead.
 */
export default function KatexMath({
  tex,
  display,
  fallback,
}: {
  tex: string;
  display: boolean;
  fallback: ReactNode;
}) {
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      maxSize: 20,
      maxExpand: 1000,
    });
  } catch {
    return fallback;
  }
  const copy = texMathCopyText(tex, display);
  return display ? (
    <div
      className="my-2 max-w-full overflow-x-auto overflow-y-hidden"
      data-markdown-copy={copy}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span data-markdown-copy={copy} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
