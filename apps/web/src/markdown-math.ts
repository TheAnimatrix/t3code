import type { Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type {
  Code,
  Construct,
  Extension as MicromarkExtension,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";
import type { Processor } from "unified";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    texMathText: "texMathText";
    texMathTextSequence: "texMathTextSequence";
    texMathTextData: "texMathTextData";
    texMathFlow: "texMathFlow";
    texMathFlowFence: "texMathFlowFence";
    texMathFlowValue: "texMathFlowValue";
  }
}

// The two TeX delimiters models write: `\(…\)` inline, and `\[` / `\]` each on
// their own line for display. CommonMark reads `\(` and `\[` as escapes, so the
// backslash is gone before any later pass could see it; these constructs run
// first. Everything else in the chat parser (code spans, fences, links, `$`) is
// left alone, and `\[x\]` on one line stays prose, which keeps `\[1\]` citations.
const BACKSLASH = 92;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const GRAVE_ACCENT = 96;

// micromark encodes tabs, virtual spaces, and line endings as negative codes.
const isLineEnding = (code: Code) => code !== null && code < -2;
const isSpace = (code: Code) => code === -2 || code === -1 || code === 32;

/**
 * `\(…\)` in running text. A formula never contains a backtick, which would open
 * a code span, or a second `\(`, so a stray opener gives up at the next one and
 * a message full of them is still scanned once.
 */
const texMathText: Construct = {
  name: "texMathText",
  tokenize(effects, ok, nok) {
    let empty = true;
    const closing: Construct = {
      partial: true,
      tokenize(effects, ok, nok) {
        return function start(code) {
          effects.enter("texMathTextSequence");
          effects.consume(code);
          return function end(code) {
            if (code !== RIGHT_PAREN || empty) return nok(code);
            effects.consume(code);
            effects.exit("texMathTextSequence");
            return ok;
          };
        };
      },
    };

    return function start(code) {
      effects.enter("texMathText");
      effects.enter("texMathTextSequence");
      effects.consume(code);
      return function open(code) {
        if (code !== LEFT_PAREN) return nok(code);
        effects.consume(code);
        effects.exit("texMathTextSequence");
        return between;
      };
    };

    function between(code: Code): State | undefined {
      if (code === null || code === GRAVE_ACCENT) return nok(code);
      if (isLineEnding(code)) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return between;
      }
      if (code === BACKSLASH) {
        return effects.attempt(closing, done, escape)(code);
      }
      effects.enter("texMathTextData");
      return data(code);
    }

    function data(code: Code): State | undefined {
      if (code === null || code === GRAVE_ACCENT || code === BACKSLASH || isLineEnding(code)) {
        effects.exit("texMathTextData");
        return between(code);
      }
      empty = false;
      effects.consume(code);
      return data;
    }

    // A backslash pair is one unit, so `\\)` is a line break then `)`, not a closer.
    function escape(code: Code): State | undefined {
      effects.enter("texMathTextData");
      empty = false;
      effects.consume(code);
      return function afterBackslash(code) {
        if (code === LEFT_PAREN) return nok(code);
        if (code === null || code === GRAVE_ACCENT || isLineEnding(code)) {
          effects.exit("texMathTextData");
          return between(code);
        }
        effects.consume(code);
        return data;
      };
    }

    function done(code: Code): State | undefined {
      effects.exit("texMathText");
      return ok(code);
    }
  },
};

/**
 * A line holding only `\[`, up to a line holding only `\]`. Like a code fence,
 * it must close; an unfinished formula (a reply still streaming) stays prose.
 */
const tokenizeTexMathFlow: Tokenizer = function (effects, ok, nok) {
  const nonLazyLine: Construct = {
    partial: true,
    tokenize(this: TokenizeContext, effects, ok, nok) {
      return (code) => {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return (next) => (this.parser.lazy[this.now().line] ? nok(next) : ok(next));
      };
    },
  };
  // A line holding only `\]` closes the formula. A line holding only `\[` can
  // never be inside one, so giving up there, as the inline construct does at a
  // second `\(`, keeps a run of unclosed openers linear.
  const fenceLine = (bracket: number): Construct => ({
    partial: true,
    tokenize(effects, ok, nok) {
      return function start(code) {
        effects.enter("texMathFlowFence");
        return indent(code);
      };

      function indent(code: Code): State | undefined {
        if (isSpace(code)) {
          effects.consume(code);
          return indent;
        }
        if (code !== BACKSLASH) return nok(code);
        effects.consume(code);
        return function second(code) {
          if (code !== bracket) return nok(code);
          effects.consume(code);
          return fenceEnd;
        };
      }

      function fenceEnd(code: Code): State | undefined {
        if (isSpace(code)) {
          effects.consume(code);
          return fenceEnd;
        }
        if (code !== null && !isLineEnding(code)) return nok(code);
        effects.exit("texMathFlowFence");
        return ok(code);
      }
    },
  });
  const closingFence = fenceLine(RIGHT_BRACKET);
  const openingFence = fenceLine(LEFT_BRACKET);

  return function start(code) {
    effects.enter("texMathFlow");
    effects.enter("texMathFlowFence");
    effects.consume(code);
    return function open(code) {
      if (code !== LEFT_BRACKET) return nok(code);
      effects.consume(code);
      return openEnd;
    };
  };

  function openEnd(code: Code): State | undefined {
    if (isSpace(code)) {
      effects.consume(code);
      return openEnd;
    }
    if (!isLineEnding(code)) return nok(code);
    effects.exit("texMathFlowFence");
    return effects.attempt(nonLazyLine, lineStart, nok)(code);
  }

  function lineStart(code: Code): State | undefined {
    return effects.attempt(closingFence, close, notOpening)(code);
  }

  function notOpening(code: Code): State | undefined {
    return effects.attempt(openingFence, nok, content)(code);
  }

  function content(code: Code): State | undefined {
    if (code === null) return nok(code);
    if (isLineEnding(code)) return effects.attempt(nonLazyLine, lineStart, nok)(code);
    effects.enter("texMathFlowValue");
    return value(code);
  }

  function value(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      effects.exit("texMathFlowValue");
      return content(code);
    }
    effects.consume(code);
    return value;
  }

  function close(code: Code): State | undefined {
    effects.exit("texMathFlow");
    return ok(code);
  }
};

export const texMathSyntax: MicromarkExtension = {
  text: { [BACKSLASH]: texMathText },
  flow: { [BACKSLASH]: { name: "texMathFlow", tokenize: tokenizeTexMathFlow, concrete: true } },
};

// The mdast nodes carry the hast shape react-markdown renders, the same one
// `remark-math` produces: `<code class="language-math-inline">` inline and
// `<pre><code class="language-math-display">` for display. `language-*` is
// already allowed by the sanitizer, so no schema change is needed.
export const texMathFromMarkdown: FromMarkdownExtension = {
  enter: {
    texMathText(token) {
      this.enter({ type: "inlineMath", value: "", data: { hName: "code" } } as never, token);
      this.buffer();
    },
    texMathFlow(token) {
      this.enter({ type: "math", value: "", data: { hName: "pre" } } as never, token);
      this.buffer();
    },
  },
  exit: {
    texMathTextData(token) {
      this.config.enter.data!.call(this, token);
      this.config.exit.data!.call(this, token);
    },
    texMathFlowValue(token) {
      this.config.enter.data!.call(this, token);
      this.config.exit.data!.call(this, token);
    },
    texMathText(token) {
      const value = this.resume().replace(/\r\n?/g, "\n");
      const node = this.stack.at(-1) as unknown as {
        value: string;
        data: Record<string, unknown>;
      };
      node.value = value;
      node.data.hProperties = { className: ["language-math-inline"] };
      node.data.hChildren = [{ type: "text", value }];
      this.exit(token);
    },
    texMathFlow(token) {
      const value = this.resume()
        .replace(/\r\n?/g, "\n")
        .replace(/^\n|\n$/g, "");
      const node = this.stack.at(-1) as unknown as {
        value: string;
        data: Record<string, unknown>;
      };
      node.value = value;
      node.data.hChildren = [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-math-display"] },
          children: [{ type: "text", value }],
        },
      ];
      this.exit(token);
    },
  },
};

/** unified plugin: registers both extensions on the remark-parse processor. */
export const remarkTexMath = function (this: Processor) {
  const data = this.data() as {
    micromarkExtensions?: MicromarkExtension[];
    fromMarkdownExtensions?: FromMarkdownExtension[];
  };
  (data.micromarkExtensions ??= []).push(texMathSyntax);
  (data.fromMarkdownExtensions ??= []).push(texMathFromMarkdown);
};

/** The TeX source of a formula as Markdown, which is what copying it should give. */
export function texMathCopyText(tex: string, display: boolean): string {
  return display ? `\\[\n${tex}\n\\]\n\n` : `\\(${tex}\\)`;
}
