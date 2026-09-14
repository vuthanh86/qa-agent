/**
 * Decoding helpers for Azure DevOps work item payloads.
 *
 * The Test Plan API does not return test case attributes as plain properties.
 * It returns `workItem.workItemFields`: an array of single-key objects keyed by
 * the ADO reference name, e.g. `[{ "System.State": "Design" }, ...]`.
 *
 * Test steps are worse — they arrive as an XML document stored in the
 * `Microsoft.VSTS.TCM.Steps` field, whose text nodes are themselves
 * HTML-escaped HTML:
 *
 *   <steps id="0" last="2">
 *     <step id="1" type="ActionStep">
 *       <parameterizedString isformatted="true">&lt;div&gt;Do a thing&lt;/div&gt;</parameterizedString>
 *       <parameterizedString isformatted="true">&lt;div&gt;It works&lt;/div&gt;</parameterizedString>
 *       <description/>
 *     </step>
 *   </steps>
 *
 * Within a step the first `parameterizedString` is the action and the second is
 * the expected result.
 */

import type { AdoTestCaseStep } from "./client.js";

/** Flatten ADO's array of single-key field objects into a plain lookup. */
export function flattenWorkItemFields(fields: unknown): Record<string, string> {
  if (!Array.isArray(fields)) return {};

  const flat: Record<string, string> = {};
  for (const entry of fields) {
    if (!entry || typeof entry !== "object") continue;
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (value !== null && value !== undefined) flat[key] = String(value);
    }
  }
  return flat;
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Decode XML/HTML entities. `&amp;` is resolved last so `&amp;lt;` stays literal. */
function decodeEntities(text: string): string {
  return text
    .replace(/&(lt|gt|quot|apos|#39|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * Reduce an escaped HTML fragment to readable plain text.
 * Block-level tags become spaces so adjacent lines do not run together.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STEP_PATTERN = /<step\b[^>]*>([\s\S]*?)<\/step>/gi;
const PARAMETERIZED_STRING_PATTERN =
  /<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/gi;

/**
 * Parse the `Microsoft.VSTS.TCM.Steps` XML into ordered steps.
 *
 * Returns an empty array for absent or unparseable XML rather than throwing —
 * a malformed step field should not abort a whole test plan audit.
 */
export function parseTestSteps(stepsXml: string | undefined | null): AdoTestCaseStep[] {
  if (!stepsXml) return [];

  const steps: AdoTestCaseStep[] = [];
  for (const stepMatch of stepsXml.matchAll(STEP_PATTERN)) {
    const body = stepMatch[1];
    const parts = [...body.matchAll(PARAMETERIZED_STRING_PATTERN)].map(m => htmlToText(m[1]));

    const action = parts[0] ?? "";
    const expected = parts[1] ?? "";

    // A step carrying neither an action nor an expectation is noise.
    if (!action && !expected) continue;

    steps.push({ stepNumber: steps.length + 1, action, expected });
  }

  return steps;
}

/** Map an ADO test point outcome to a last-result string, or null if never run. */
export function normalizeOutcome(outcome: string | undefined | null): string | null {
  if (!outcome) return null;
  const normalized = outcome.toLowerCase();
  if (normalized === "unspecified" || normalized === "none") return null;
  return outcome;
}
