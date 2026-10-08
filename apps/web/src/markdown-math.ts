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

// \(…\) inline, and \[ / \] or $$ on their own lines for display. These run before
// CommonMark's escape construct, which would otherwise consume \( and \[. A
// one-line \[x\] stays prose so \[1\] citations do.
const DOLLAR = 36;
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
 * `\(…\)` in text. Gives up at a backtick (code spans outrank math) or a second
 * `\(`, so unmatched openers are scanned once.
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

type Marker = readonly [first: number, second: number];

/**
 * A line holding only the `open` marker, up to one holding only the `close`
 * marker. Like a code fence, it must close; an unfinished formula (a reply still
 * streaming) stays prose.
 */
const tokenizeTexMathFlow = (open: Marker, close: Marker): Tokenizer =>
  function (effects, ok, nok) {
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
    const fenceLine = (marker: Marker): Construct => ({
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
          if (code !== marker[0]) return nok(code);
          effects.consume(code);
          return function second(code) {
            if (code !== marker[1]) return nok(code);
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
    const closingFence = fenceLine(close);
    const openingFence = fenceLine(open);

    return function start(code) {
      effects.enter("texMathFlow");
      effects.enter("texMathFlowFence");
      effects.consume(code);
      return function second(code) {
        if (code !== open[1]) return nok(code);
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
      return effects.attempt(closingFence, finish, notOpening)(code);
    }

    // Another opener cannot be inside a formula. Giving up at it keeps a run of
    // unclosed openers linear.
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

    function finish(code: Code): State | undefined {
      effects.exit("texMathFlow");
      return ok(code);
    }
  };

const texMathFlow = (open: Marker, close: Marker): Construct => ({
  name: "texMathFlow",
  tokenize: tokenizeTexMathFlow(open, close),
  concrete: true,
});

export const texMathSyntax: MicromarkExtension = {
  text: { [BACKSLASH]: texMathText },
  flow: {
    [BACKSLASH]: texMathFlow([BACKSLASH, LEFT_BRACKET], [BACKSLASH, RIGHT_BRACKET]),
    [DOLLAR]: texMathFlow([DOLLAR, DOLLAR], [DOLLAR, DOLLAR]),
  },
};

// Inline math renders as `<code class="language-math-inline">`, display math as
// `<pre><code class="language-math-display">`. The sanitizer already allows `language-*`.
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
      let value = this.resume().replace(/\r\n?/g, "\n");
      // Like a code span, a formula in a table cell reads `\|` as a pipe.
      if (this.data.inTable) {
        value = value.replace(/\\([\\|])/g, (whole, escaped) => (escaped === "|" ? "|" : whole));
      }
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

/**
 * Marks a formula for copying and citing (see `mathWrapperOf`), with its
 * canonical TeX as the copy text. Set on the typeset formula and on the source
 * shown in its place.
 */
export function texMathAttributes(tex: string, display: boolean) {
  return {
    "data-markdown-math": display ? "display" : "inline",
    "data-markdown-copy": display ? `\\[\n${tex}\n\\]\n\n` : `\\(${tex}\\)`,
  };
}
