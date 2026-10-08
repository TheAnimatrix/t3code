import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vite-plus/test";

import { texMathFromMarkdown, texMathSyntax } from "./markdown-math";

type Node = { type: string; value?: string; children?: Node[] };

/** Math nodes in document order, as `type:value`. */
function mathIn(source: string): string[] {
  const found: string[] = [];
  const visit = (node: Node) => {
    if (node.type === "inlineMath" || node.type === "math")
      found.push(`${node.type}:${node.value}`);
    node.children?.forEach(visit);
  };
  visit(
    fromMarkdown(source, {
      extensions: [texMathSyntax],
      mdastExtensions: [texMathFromMarkdown],
    }) as Node,
  );
  return found;
}

describe("TeX math syntax", () => {
  it("reads \\(…\\) inline, including TeX backslashes and underscores", () => {
    expect(mathIn("so \\(\\sigma\\propto r_1T^{-5}\\) holds")).toEqual([
      "inlineMath:\\sigma\\propto r_1T^{-5}",
    ]);
    // `\\` is a TeX line break, so the `)` after it does not close the formula.
    expect(mathIn("\\(a\\\\ b\\) c")).toEqual(["inlineMath:a\\\\ b"]);
    expect(mathIn("\\(a\\\\) c")).toEqual([]);
    expect(mathIn("| \\(G\\) | \\(x\\) |\n|---|---|\n| \\(a_1\\) | b |")).toEqual([
      "inlineMath:G",
      "inlineMath:x",
      "inlineMath:a_1",
    ]);
  });

  it("reads \\[ and \\] lines as display math, keeping lines that look like Markdown", () => {
    expect(mathIn("\\[\na=b\n\\quad\\Rightarrow\\quad c\n\\]")).toEqual([
      "math:a=b\n\\quad\\Rightarrow\\quad c",
    ]);
    expect(mathIn("text\n\n\\[\n- a\n# b\n\n> c\n\\]\n\nafter")).toEqual(["math:- a\n# b\n\n> c"]);
    expect(mathIn("> \\[\n> x\n> \\]")).toEqual(["math:x"]);
    expect(mathIn("- item\n\n  \\[\n  x^2\n  \\]")).toEqual(["math:x^2"]);
  });

  it("reads $$ lines as display math, keeping lines that look like Markdown or TeX", () => {
    expect(mathIn("$$\nx\n$$")).toEqual(["math:x"]);
    expect(mathIn("text\n\n$$\n- a\n\\[\n\n> c\n$$\n\nafter")).toEqual(["math:- a\n\\[\n\n> c"]);
    expect(mathIn("> $$\n> x\n> $$")).toEqual(["math:x"]);
    expect(mathIn("- item\n\n  $$\n  x^2\n  $$")).toEqual(["math:x^2"]);
  });

  it.each([
    ["an unclosed inline opener", "costs \\(x and more"],
    ["an empty formula", "\\(\\) text"],
    ["an escaped backslash", "\\\\(x\\\\)"],
    ["a code span", "`\\(x\\)` and \\(a `\\)` b"],
    ["a fenced block", "```\n\\[\nx\n\\]\n```"],
    ["an indented block", "    \\[\n    x\n    \\]"],
    ["a one-line display formula", "\\[ x \\]"],
    ["a one-line $$ formula", "$$ x $$"],
    ["inline $$ in text", "so $$x$$ holds"],
    ["currency", "Costs $5 and $10"],
    ["a single $", "$\nx\n$"],
    ["a citation", "see \\[1\\] and \\[2\\]"],
    ["an unclosed display block", "\\[\nx = 1\n"],
    ["an unclosed $$ block", "$$\nx = 1\n"],
    ["a $$ block closed by \\]", "$$\na\n\\]"],
    ["a \\[ block closed by $$", "\\[\na\n$$"],
    ["a display block cut by a lazy line", "> \\[\n> x\nlazy\n> \\]"],
    ["a link target", "[a](https://x.test/\\(b\\))"],
  ])("leaves %s alone", (_, source) => {
    expect(mathIn(source)).toEqual([]);
  });

  it("closes an inline formula at its own closer when openers repeat", () => {
    expect(mathIn("\\(a \\(b\\) c")).toEqual(["inlineMath:b"]);
  });

  it("scans a message of unmatched openers in linear time", () => {
    const source = "\\( x ".repeat(20_000);
    const start = performance.now();
    expect(mathIn(source)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("ends an unfinished display block at the next opener", () => {
    expect(mathIn("\\[\na\n\\[\nb\n\\]")).toEqual(["math:b"]);
  });

  it("scans a message of unmatched display openers in linear time", () => {
    const source = "\\[\nx\n".repeat(3200);
    const start = performance.now();
    expect(mathIn(source)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("does not rescan display openers inside an unclosed $$ block", () => {
    const source = `$$\n${"\\[\nx\n".repeat(3200)}`;
    const start = performance.now();
    expect(mathIn(source)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
