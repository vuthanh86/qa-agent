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
export declare function flattenWorkItemFields(fields: unknown): Record<string, string>;
/**
 * Reduce an escaped HTML fragment to readable plain text.
 * Block-level tags become spaces so adjacent lines do not run together.
 */
export declare function htmlToText(html: string): string;
/**
 * Parse the `Microsoft.VSTS.TCM.Steps` XML into ordered steps.
 *
 * Returns an empty array for absent or unparseable XML rather than throwing —
 * a malformed step field should not abort a whole test plan audit.
 */
export declare function parseTestSteps(stepsXml: string | undefined | null): AdoTestCaseStep[];
/** Map an ADO test point outcome to a last-result string, or null if never run. */
export declare function normalizeOutcome(outcome: string | undefined | null): string | null;
//# sourceMappingURL=work-item-fields.d.ts.map