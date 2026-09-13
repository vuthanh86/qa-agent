import { describe, it, expect } from "vitest";
import {
  flattenWorkItemFields,
  htmlToText,
  parseTestSteps,
  normalizeOutcome,
} from "../../src/ado/work-item-fields.js";

/** Build a Steps XML document from [action, expected] pairs, as ADO encodes it. */
function stepsXml(pairs: Array<[string, string]>): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const steps = pairs
    .map(
      ([action, expected], i) =>
        `<step id="${i + 1}" type="ActionStep">` +
        `<parameterizedString isformatted="true">${escape(`<div>${action}</div>`)}</parameterizedString>` +
        `<parameterizedString isformatted="true">${escape(`<div>${expected}</div>`)}</parameterizedString>` +
        `<description /></step>`,
    )
    .join("");
  return `<steps id="0" last="${pairs.length}">${steps}</steps>`;
}

describe("flattenWorkItemFields", () => {
  it("flattens ADO's array of single-key objects into a lookup", () => {
    const flat = flattenWorkItemFields([
      { "System.State": "Design" },
      { "Microsoft.VSTS.Common.Priority": 2 },
      { "System.WorkItemType": "Test Case" },
    ]);

    expect(flat).toEqual({
      "System.State": "Design",
      "Microsoft.VSTS.Common.Priority": "2",
      "System.WorkItemType": "Test Case",
    });
  });

  it("coerces values to strings", () => {
    expect(flattenWorkItemFields([{ "Microsoft.VSTS.Common.Priority": 1 }])).toEqual({
      "Microsoft.VSTS.Common.Priority": "1",
    });
  });

  it("handles an object carrying several keys", () => {
    expect(flattenWorkItemFields([{ a: "1", b: "2" }])).toEqual({ a: "1", b: "2" });
  });

  it("skips null and undefined values", () => {
    expect(flattenWorkItemFields([{ a: null }, { b: undefined }, { c: "keep" }])).toEqual({
      c: "keep",
    });
  });

  it("lets a later entry win when a key repeats", () => {
    expect(flattenWorkItemFields([{ a: "first" }, { a: "second" }])).toEqual({ a: "second" });
  });

  it.each([undefined, null, "not an array", 42, {}])(
    "returns an empty lookup for non-array input %o",
    (input) => {
      expect(flattenWorkItemFields(input)).toEqual({});
    },
  );

  it("ignores non-object entries inside the array", () => {
    expect(flattenWorkItemFields([null, "junk", { a: "1" }])).toEqual({ a: "1" });
  });
});

describe("htmlToText", () => {
  it("decodes escaped HTML and strips the tags", () => {
    expect(htmlToText("&lt;div&gt;Open the home page&lt;/div&gt;")).toBe("Open the home page");
  });

  it("separates block elements with a space rather than joining words", () => {
    expect(htmlToText("&lt;div&gt;first&lt;/div&gt;&lt;div&gt;second&lt;/div&gt;")).toBe(
      "first second",
    );
  });

  it("turns line breaks into spaces", () => {
    expect(htmlToText("one&lt;br /&gt;two")).toBe("one two");
  });

  it("collapses runs of whitespace", () => {
    expect(htmlToText("a   \n\t  b")).toBe("a b");
  });

  it("decodes named and numeric entities", () => {
    expect(htmlToText("&quot;quoted&quot; &apos;single&apos; &#39;num&#39;")).toBe(
      "\"quoted\" 'single' 'num'",
    );
  });

  it("decodes a non-breaking space to a regular space", () => {
    expect(htmlToText("a&nbsp;b")).toBe("a b");
  });

  it("resolves &amp; last so an escaped entity stays literal", () => {
    expect(htmlToText("Tom &amp;amp; Jerry")).toBe("Tom &amp; Jerry");
  });

  it("preserves template placeholders used in test data", () => {
    expect(htmlToText("&lt;div&gt;sign in as `${USER_EMAIL}`&lt;/div&gt;")).toBe(
      "sign in as `${USER_EMAIL}`",
    );
  });

  it.each(["", undefined, null])("returns an empty string for %o", (input) => {
    expect(htmlToText(input as string)).toBe("");
  });
});

describe("parseTestSteps", () => {
  it("parses action and expected from each step", () => {
    const steps = parseTestSteps(
      stepsXml([
        ["Open the home page", "The dashboard renders"],
        ["Click Save", "A success toast appears"],
      ]),
    );

    expect(steps).toEqual([
      { stepNumber: 1, action: "Open the home page", expected: "The dashboard renders" },
      { stepNumber: 2, action: "Click Save", expected: "A success toast appears" },
    ]);
  });

  it("numbers steps sequentially from 1, ignoring the XML step ids", () => {
    const xml =
      '<steps id="0" last="9">' +
      '<step id="7" type="ActionStep"><parameterizedString>a</parameterizedString>' +
      "<parameterizedString>b</parameterizedString></step>" +
      '<step id="9" type="ActionStep"><parameterizedString>c</parameterizedString>' +
      "<parameterizedString>d</parameterizedString></step></steps>";

    expect(parseTestSteps(xml).map(s => s.stepNumber)).toEqual([1, 2]);
  });

  it("treats a step with only an action as having no expected result", () => {
    const xml =
      '<steps><step id="1" type="ActionStep">' +
      "<parameterizedString>just an action</parameterizedString></step></steps>";

    expect(parseTestSteps(xml)).toEqual([
      { stepNumber: 1, action: "just an action", expected: "" },
    ]);
  });

  it("skips steps that carry neither an action nor an expectation", () => {
    const xml =
      '<steps><step id="1" type="ActionStep">' +
      "<parameterizedString>&lt;div&gt;&lt;/div&gt;</parameterizedString>" +
      "<parameterizedString></parameterizedString></step>" +
      '<step id="2" type="ActionStep"><parameterizedString>real</parameterizedString>' +
      "<parameterizedString>result</parameterizedString></step></steps>";

    expect(parseTestSteps(xml)).toEqual([
      { stepNumber: 1, action: "real", expected: "result" },
    ]);
  });

  it("parses ValidateStep the same way as ActionStep", () => {
    const xml =
      '<steps><step id="1" type="ValidateStep">' +
      "<parameterizedString>verify the total</parameterizedString>" +
      "<parameterizedString>it equals 100</parameterizedString></step></steps>";

    expect(parseTestSteps(xml)).toEqual([
      { stepNumber: 1, action: "verify the total", expected: "it equals 100" },
    ]);
  });

  it.each(["", undefined, null])("returns an empty array for %o", (input) => {
    expect(parseTestSteps(input)).toEqual([]);
  });

  it("returns an empty array for XML containing no steps", () => {
    expect(parseTestSteps('<steps id="0" last="0"></steps>')).toEqual([]);
  });

  it("returns an empty array rather than throwing on malformed XML", () => {
    expect(parseTestSteps("<steps><step id=1 unclosed")).toEqual([]);
  });

  it("parses a real ADO steps payload", () => {
    // Captured verbatim from plan 43944, suite 43964.
    const real =
      '<steps id="0" last="5"><step id="1" type="ActionStep">' +
      '<parameterizedString isformatted="true">&lt;div&gt;Observe the starting state in ' +
      "Browser B by loading the PMI home page as `${USER_EMAIL}`.&lt;/div&gt;</parameterizedString>" +
      '<parameterizedString isformatted="true">&lt;div&gt;No Learning tile is displayed, ' +
      "confirming the user begins the test without access.&lt;/div&gt;</parameterizedString>" +
      "<description /></step></steps>";

    expect(parseTestSteps(real)).toEqual([
      {
        stepNumber: 1,
        action: "Observe the starting state in Browser B by loading the PMI home page as `${USER_EMAIL}`.",
        expected:
          "No Learning tile is displayed, confirming the user begins the test without access.",
      },
    ]);
  });
});

describe("normalizeOutcome", () => {
  it.each(["Passed", "Failed", "Blocked", "NotApplicable"])(
    "passes through the real outcome %s",
    (outcome) => {
      expect(normalizeOutcome(outcome)).toBe(outcome);
    },
  );

  it.each(["unspecified", "Unspecified", "none", "None"])(
    "maps %o to null, meaning never executed",
    (outcome) => {
      expect(normalizeOutcome(outcome)).toBeNull();
    },
  );

  it.each(["", undefined, null])("maps %o to null", (outcome) => {
    expect(normalizeOutcome(outcome)).toBeNull();
  });
});
