import type { EmployeeFormOptions } from '@/application/ports/employee-repository';
import type {
  RecordSalaryChangeResult,
  SalaryChangeInput,
  SalaryFieldRejection,
} from '@/application/use-cases/record-salary-change';
import {
  formatMoney,
  isSupportedExponent,
  parseMajorAmount,
  type CurrencyFormat,
  type MajorAmountParseFailure,
} from '@/domain/money';
import {
  comparePlainDate,
  formatPlainDate,
  parsePlainDate,
  plainDateToIso,
  type PlainDate,
} from '@/domain/plain-date';
import type { SalaryChangeField } from '@/domain/salary-change';

/**
 * Everything the record-a-salary-change form DECIDES, with no React in it.
 *
 * The same split as `employee-form.ts`, member for member, and for the same reasons: no jsdom, no
 * @testing-library, and `src/ui/*.tsx` sits outside the coverage gate. `salary-change-panel.tsx` is
 * left with markup, focus, and one call to a Server Action handed in as a prop.
 *
 * ## It consumes the fixed 4-1 contract and adds nothing to it (Law 7 / AD-24)
 *
 * `recordSalaryChangeAction(employeeId, input)` and `SalaryChangeInput` — three required strings —
 * are used exactly as story 4-1 finalized them. `RecordSalaryChangeResult`'s three arms are
 * rendered as they arrive. Nothing here re-validates: positivity, the amount ceiling, the currency
 * match and both date bounds are the server's rules, judged by the same code a CSV import is judged
 * by.
 *
 * ## The one calculation, and why it is NOT here
 *
 * Screen-09 asks for the amount in MAJOR units (`₹`, `21,50,000`) and the payload carries MINOR
 * units as a decimal string. The conversion is `parseMajorAmount`, in `src/domain/money.ts`, beside
 * the formatter it inverts — because a 100x error is the most consequential mistake this story could
 * make and `src/ui/**` is measured by neither the coverage gate nor the mutation gate. This module
 * calls it and turns its failure into copy; it does not do arithmetic.
 *
 * ## The copy projection (closes deferred #5)
 *
 * `composeRejectionSentence` also serves the CSV rejection table, where "the effective_from cell" is
 * the correct and necessary identification of a cell. Beside a form field already labelled *Effective
 * date* the same string is spreadsheet vocabulary and a raw column token. So this module projects
 * the shapes that composer produces into form vocabulary — and falls through to `sentence` VERBATIM
 * for everything else, which is the half that keeps a reason kind a later story adds correct BY
 * DEFAULT rather than silently mistranslated.
 *
 * ## Currency is confirmed, never chosen (AD-6, closes deferred #8)
 *
 * There is no currency control on this form, editable or disabled, and therefore no way for the
 * currency to fail to submit. It is derived from the employee's country and travels in the payload
 * as a derived string.
 *
 * The imports are `import type` except `parseMajorAmount`, `comparePlainDate`, `formatPlainDate` and
 * `plainDateToIso` — pure, total, clock-free domain functions, the calling rule `src/ui/README.md`
 * ratified at story 1-6.
 */

/** One field, as the form presents it. */
export type SalaryChangeFormFieldSpec = {
  readonly field: SalaryChangeField;
  /**
   * What the field is CALLED on screen. Both of the first two labels differ from their own keys,
   * and that difference is the point: the key is a payload identifier, the label is copy.
   */
  readonly label: string;
};

/**
 * The three CAP-3 fields, DECLARED IN FORM ORDER — the same order `SALARY_CHANGE_FIELDS` collects
 * rejections in, so the first reason blaming a field is also the topmost one on screen.
 *
 * There is no fourth. No reason, no note, no event type, no approval — the form absorbs the fact and
 * gets out of the way.
 */
export const SALARY_CHANGE_FORM_FIELDS: Readonly<
  Record<SalaryChangeField, SalaryChangeFormFieldSpec>
> = {
  effective_from: { field: 'effective_from', label: 'Effective date' },
  amount_minor: { field: 'amount_minor', label: 'Amount' },
  currency: { field: 'currency', label: 'Currency' },
};

/**
 * The same three as a list, in the same order — DERIVED, so the order has exactly one declaration.
 * `Object.keys` preserves declaration order for non-numeric string keys (ECMA-262
 * OrdinaryOwnPropertyKeys).
 */
export const SALARY_CHANGE_FORM_FIELD_ORDER = Object.keys(
  SALARY_CHANGE_FORM_FIELDS,
) as readonly SalaryChangeField[];

/**
 * Which of the three fields the form gives a CONTROL to.
 *
 * Two of them, and the third is the whole reason this table exists. Currency follows from the
 * employee's country (AD-6) and is rendered as a statement, so a reason blaming `currency` has no
 * input to sit under and no input to send focus to — `salaryFieldInputId('currency')` names an
 * element that is never rendered. That is not hypothetical: `checkSalaryCurrency` re-resolves the
 * currency from the country inside its own transaction, so reference data changing between the page
 * render and the submit answers exactly this rejection.
 *
 * A RECORD rather than a list, so that a fourth `SalaryChangeField` added by a later story is a
 * compile error here rather than a reason that silently renders nowhere again.
 */
const SALARY_FIELD_HAS_CONTROL: Readonly<Record<SalaryChangeField, boolean>> = {
  effective_from: true,
  amount_minor: true,
  currency: false,
};

/**
 * Whether this field has a control of its own on the form, and therefore a place for a message.
 *
 * A field this table does not know answers `false`, so its reason renders form-level rather than
 * under an input that does not exist. The union is compile-checked, but a rejection is DESERIALIZED
 * from a Server Action — across a rolling deploy an older page can be handed a field a newer server
 * added, and a type is not a runtime guarantee. Same defensive stance the sentence matching below
 * already takes for a reason kind it does not recognise.
 */
export function salaryFieldHasControl(field: SalaryChangeField): boolean {
  return SALARY_FIELD_HAS_CONTROL[field] ?? false;
}

/** The DOM id of a field's control, so its `<label htmlFor>` can reach it. */
export function salaryFieldInputId(field: SalaryChangeField): string {
  return `salary-field-${field}`;
}

/** The DOM id of a field's rejection message, for `aria-describedby` (WCAG 2.2 AA SC 3.3.1). */
export function salaryFieldDescribedById(field: SalaryChangeField): string {
  return `salary-reason-${field}`;
}

/**
 * The shapes `composeRejectionSentence` produces for a CAP-3 field, matched STRUCTURALLY and
 * anchored on both ends — a sentence that merely CONTAINS one of these phrasings is not one, and a
 * loose match is exactly how an unrecognized shape would stop falling through.
 */
const BLANK_CELL = /^The \S+ cell is blank\.$/;
const MALFORMED_DATE = /^The \S+ cell reads "[\s\S]*", which is not a date in YYYY-MM-DD form\.$/;
const FUTURE_EFFECTIVE_FROM = /^effective_from (\S+) is later than today, (\S+)\.$/;
const EFFECTIVE_BEFORE_HIRE = /^effective_from (\S+) is earlier than the hire date, (\S+)\.$/;
const MALFORMED_AMOUNT = /^amount_minor "[\s\S]*" is not a whole number of minor units\.$/;
const AMOUNT_NOT_POSITIVE = /^amount_minor "[\s\S]*" is not greater than zero\.$/;
const AMOUNT_OUT_OF_RANGE =
  /^amount_minor "[\s\S]*" is larger than \d+, the largest amount this system stores\.$/;

/** Typographic quotes, used by every sentence this module authors. The composer uses straight ones. */
function quoted(value: string): string {
  return `“${value}”`;
}

/**
 * One rejection, as the form says it.
 *
 * Total, and deterministic: same rejection in, same string out. Every branch is a RECOGNIZED shape;
 * the last line is the contract with the future.
 */
export function salaryRejectionText(rejection: SalaryFieldRejection): string {
  // No field is to blame, so no label applies — `salaryWriteFailureRejection` and
  // `unknownSalaryCountryRejection`. The form states it rather than pinning it on an innocent input.
  if (rejection.field === null) {
    return rejection.sentence;
  }

  // Same reasoning as `salaryFieldHasControl`: an unrecognised field would otherwise read `.label`
  // off `undefined` and take the whole panel down with it. The server's own sentence is already a
  // complete, correct statement — falling back to it degrades the copy, not the form.
  const spec = SALARY_CHANGE_FORM_FIELDS[rejection.field] as
    | (typeof SALARY_CHANGE_FORM_FIELDS)[SalaryChangeField]
    | undefined;
  if (spec === undefined) {
    return rejection.sentence;
  }

  const label = spec.label;
  const value = rejection.offendingValue;

  if (BLANK_CELL.test(rejection.sentence)) {
    return `${label} is required.`;
  }

  if (MALFORMED_DATE.test(rejection.sentence)) {
    return value === null
      ? `${label} is not a date in YYYY-MM-DD form.`
      : `${label} reads ${quoted(value)}, which is not a date in YYYY-MM-DD form.`;
  }

  // The two date bounds keep BOTH of their dates: which day was refused and which day it was
  // refused against is the whole of what makes either sentence actionable. Only the leading column
  // token is replaced.
  const future = FUTURE_EFFECTIVE_FROM.exec(rejection.sentence);
  if (future !== null) {
    return `${label} ${String(future[1])} is later than today, ${String(future[2])}.`;
  }

  const beforeHire = EFFECTIVE_BEFORE_HIRE.exec(rejection.sentence);
  if (beforeHire !== null) {
    return `${label} ${String(beforeHire[1])} is earlier than the hire date, ${String(beforeHire[2])}.`;
  }

  // The amount sentences quote `amount_minor` — a MINOR-unit string the person never typed, because
  // this form takes major units. Quoting it back would show them a number 100x the one on their
  // screen, so the two RULE sentences below name the rule and drop the value entirely.
  //
  // `MALFORMED_AMOUNT` is the exception and does still quote `offendingValue` when it has one. That
  // branch is unreachable from this form — the parser hands the action a canonical decimal string,
  // so the server has nothing malformed to report — and for a direct caller of the projection the
  // quoted value is the honest thing to show. Reachable-and-quoting or unreachable-and-quoting, it
  // is never the 100x misstatement the rule sentences avoid.
  if (AMOUNT_NOT_POSITIVE.test(rejection.sentence)) {
    return `${label} must be greater than zero.`;
  }

  if (AMOUNT_OUT_OF_RANGE.test(rejection.sentence)) {
    return `${label} is larger than the largest amount this system stores.`;
  }

  if (MALFORMED_AMOUNT.test(rejection.sentence)) {
    return value === null
      ? `${label} could not be read as an amount.`
      : `${label} ${quoted(value)} could not be read as an amount.`;
  }

  // Unrecognized — rendered as the backend worded it, never guessed at. The currency-mismatch
  // sentence lands here deliberately: it names no column token and already reads as form copy.
  return rejection.sentence;
}

/** Every reason blaming one field, in payload order. */
export function salaryRejectionsFor(
  reasons: readonly SalaryFieldRejection[],
  field: SalaryChangeField,
): readonly SalaryFieldRejection[] {
  return reasons.filter((reason) => reason.field === field);
}

/**
 * Every reason that has no control of its own to sit under — rendered in a form-level region.
 *
 * TWO kinds land here, and the second is the one this used to drop. A reason blaming NO field is an
 * adapter or transport failure: pinning it on whichever input happened to be first would be a false
 * statement about the person's typing, and dropping it would leave a form that refused to save and
 * said nothing about why. A reason blaming CURRENCY is the same problem for the opposite reason —
 * currency has no control (AD-6), so there is no field block for it and no input to describe. It was
 * excluded here (its field is not `null`) and rendered nowhere at all, which is a refusal announced
 * as "1 reason" with no reason on the screen.
 *
 * Payload order is preserved, so the region reads in the order the server collected.
 */
export function salaryFormLevelRejections(
  reasons: readonly SalaryFieldRejection[],
): readonly SalaryFieldRejection[] {
  return reasons.filter((reason) => reason.field === null || !salaryFieldHasControl(reason.field));
}

/**
 * The field focus moves to after a rejection (WCAG 2.2 AA SC 3.3.1). `null` when no reason blames a
 * field that HAS a control — the panel then focuses the form-level region, which is where those
 * reasons render. `validateSalaryChange` collects in FORM order, so the first entry is the topmost.
 */
export function firstRejectedSalaryField(
  reasons: readonly SalaryFieldRejection[],
): SalaryChangeField | null {
  return (
    reasons.find((reason) => reason.field !== null && salaryFieldHasControl(reason.field))?.field ??
    null
  );
}

/**
 * The two controls' values, as strings.
 *
 * TWO, not three: currency has no control (AD-6). It is derived from the employee's country and
 * added to the payload by `toSalaryChangeInput`, so there is no state in which a person could have
 * left it wrong.
 */
export type SalaryChangeFormValues = {
  readonly effectiveFrom: string;
  readonly amount: string;
};

/**
 * The form's opening values: today's date, and an empty amount.
 *
 * `today` is read once at the delivery boundary through the clock port and passed inward (Law 6 /
 * AD-11). The date goes through `plainDateToIso` because `<input type="date">` reads and writes
 * exactly that canonical machine form.
 */
export function initialSalaryFormValues(today: PlainDate): SalaryChangeFormValues {
  return { effectiveFrom: plainDateToIso(today), amount: '' };
}

/** A payload ready to submit, or the reasons it could not be built. */
export type SalaryChangeInputResult =
  | { readonly ok: true; readonly input: SalaryChangeInput }
  | { readonly ok: false; readonly reasons: readonly SalaryFieldRejection[] };

/**
 * What the form says about an amount `parseMajorAmount` could not convert.
 *
 * These are the only sentences in the CAP-3 flow the UI authors, and it authors them for the reason
 * `import-report.ts` authors `UPLOAD_FAILED`: no backend reason can exist for them. The server never
 * sees a major-unit amount at all — it is specified in minor units — so there is no
 * `SalaryFieldRejection` for "more decimal places than this currency has".
 */
function amountParseRejection(
  typed: string,
  reason: MajorAmountParseFailure,
  currency: CurrencyFormat,
): SalaryFieldRejection {
  const label = SALARY_CHANGE_FORM_FIELDS.amount_minor.label;

  if (reason === 'unsupported-exponent') {
    // The currency row itself is unusable. Nobody's typing caused that, so no field is blamed — and
    // the page withholds the whole form in this state anyway, which is why this is the totality
    // guard rather than a sentence anyone should ever read.
    return {
      field: null,
      offendingValue: null,
      sentence: `The currency ${currency.code} could not be read, so nothing was recorded.`,
    };
  }

  if (reason === 'too-precise') {
    return {
      field: 'amount_minor',
      offendingValue: typed,
      sentence:
        currency.minorUnitExponent === 0
          ? // A currency with no minor unit at all — JPY. "0 decimal places" would be a stranger
            // way to say it than simply saying the currency has none.
            `${label} ${quoted(typed)} has decimal places, and ${currency.code} is recorded in whole units.`
          : `${label} ${quoted(typed)} is more precise than ${currency.code} records, which is ${String(currency.minorUnitExponent)} decimal places.`,
    };
  }

  // An EMPTY amount is the absence of a value, not a wrong one, so it reads as the "required" every
  // blank field reports rather than quoting nothing back at someone who typed nothing.
  if (typed === '') {
    return { field: 'amount_minor', offendingValue: null, sentence: `${label} is required.` };
  }

  return {
    field: 'amount_minor',
    offendingValue: typed,
    sentence: `${label} ${quoted(typed)} could not be read as an amount.`,
  };
}

/**
 * The form's two values plus the employee's currency, as the fixed `SalaryChangeInput`.
 *
 * TRIMS ALL THREE FIELDS, closing deferred #7. `checkSalaryAmount` and `checkSalaryCurrency` judge
 * exactly the text they are handed and reject `'  12'` outright, while `checkDateCell` trims for
 * CAP-1's sake — one payload, two whitespace policies. Story 4-1 recorded that question as this
 * story's to answer, and the answer is that the FORM normalizes before it submits: a stray space is
 * a form artifact, and the boundary is specified in canonical values.
 */
export function toSalaryChangeInput(
  values: SalaryChangeFormValues,
  currency: CurrencyFormat,
): SalaryChangeInputResult {
  const typedAmount = values.amount.trim();
  const amount = parseMajorAmount(typedAmount, currency.minorUnitExponent);

  if (!amount.ok) {
    return { ok: false, reasons: [amountParseRejection(typedAmount, amount.reason, currency)] };
  }

  return {
    ok: true,
    input: {
      effectiveFrom: values.effectiveFrom.trim(),
      amountMinor: amount.amountMinor,
      // Derived, never chosen (AD-6). The server re-resolves it from the employee's country and
      // validates the two agree; this is the confirmation, not the choice.
      currency: currency.code.trim(),
    },
  };
}

/**
 * The example amount shown in the empty control, grouped the way THIS currency groups.
 *
 * `21,50,000` was hard-coded, which is screen-09's example and correct for the INR employee it was
 * drawn from — and wrong for everyone else: under western grouping the same string reads as
 * 2,150,000, so a USD employee was shown an example a hundred times the amount it means to suggest.
 *
 * The one money formatter does the grouping, rather than this module restating its rules (Law 4 —
 * there is exactly one money formatter). The exponent is forced to 0 for the call because the
 * example is a MAJOR-unit amount and the control takes major units: scaling it would make the
 * placeholder disagree with the field it sits in. The symbol and ISO code the formatter appends are
 * sliced back off — the symbol is already an adornment beside the control, and the code is stated
 * under it.
 */
const PLACEHOLDER_MAJOR_UNITS = 2150000n;

export function salaryAmountPlaceholder(currency: CurrencyFormat): string {
  const format = { ...currency, minorUnitExponent: 0 };
  const formatted = formatMoney(
    { amountMinor: PLACEHOLDER_MAJOR_UNITS, currency: currency.code },
    format,
  );

  // `formatMoney` answers `null` only on a code mismatch or an unusable exponent, and both are
  // constructed away above. The fallback is the ungrouped digits rather than an empty placeholder.
  if (formatted === null) {
    return PLACEHOLDER_MAJOR_UNITS.toString();
  }

  // The slice below assumes `formatMoney` lays the parts out as `{symbol}{amount} {code}`. That is
  // an INTERNAL detail of another module, so it is checked rather than trusted: if the layout ever
  // drifts, a blind slice would silently truncate the example amount — a placeholder quietly
  // disagreeing with the field it sits in is exactly the bug this form cannot afford.
  const prefix = currency.symbol;
  const suffix = ` ${currency.code}`;
  if (!formatted.startsWith(prefix) || !formatted.endsWith(suffix)) {
    return PLACEHOLDER_MAJOR_UNITS.toString();
  }

  return formatted.slice(prefix.length, formatted.length - suffix.length);
}

/** The whole of the currency's presence on this form: a statement, and no control. */
export function salaryCurrencyNote(currency: CurrencyFormat): string {
  return `Currency ${currency.code} (${currency.symbol}) — it follows from the employee’s country and is never chosen separately.`;
}

/**
 * Why the trigger is not offered, when it is not.
 *
 * Mirrors the detail page's existing arm word for word in intent: an absent control with a statement
 * beside it, rather than a control that cannot work.
 *
 * It names the OUTCOME and no cause, because three different situations reach it and a sentence
 * naming one of them would be false about the other two: the reference tables really could not be
 * read; the employee sits on a country no longer among the ACTIVE options (the seed has one); or the
 * currency row itself is missing or carries an exponent the formatter cannot use. In the second and
 * third the tables were read perfectly — `options.kind === 'options'` — and the `Edit employee`
 * button renders directly beside this paragraph, so the earlier wording ("The currency reference
 * tables could not be read") contradicted the control next to it.
 *
 * Telling the causes apart is deferred #6 and deliberately not attempted here. Saying only what is
 * true of all of them is not the same thing as saying nothing.
 */
export const CURRENCY_UNREADABLE_STATEMENT =
  'The currency this employee is paid in could not be determined, so a salary change cannot be recorded right now.';

/**
 * The statement for an employee whose hire date is still ahead of us — closing deferred #3.
 *
 * Every effective date this form could submit is refused for such an employee: today is future-dated
 * relative to nothing useful, and every date at or after the hire date is later than today. Rather
 * than offering a form that cannot be satisfied, the page names the date pay can be recorded from.
 * No backend arm is widened to say this; the form is simply not offered.
 */
export function futureHireStatement(hireDate: PlainDate): string {
  // `formatPlainDate` is total and answers `null` for a month outside 1..12; the ISO form is the
  // honest fallback, exactly as the detail page's `<time>` does.
  const rendered = formatPlainDate(hireDate) ?? plainDateToIso(hireDate);
  return `This employee’s hire date is ${rendered}, so pay can be recorded from that date onwards.`;
}

/** Whether the record-change form can be offered, and the currency it would record in. */
export type SalaryChangeAvailability =
  | { readonly kind: 'available'; readonly currency: CurrencyFormat }
  | { readonly kind: 'withheld'; readonly statement: string };

/**
 * Whether the detail page may offer the trigger at all.
 *
 * `options` is `null` when the reference tables could not be read — the `options.kind !== 'options'`
 * arm the page already has. The currency is resolved country → currency code → currency format, and
 * ANY break in that chain withholds the form: an employee on a deactivated country has no entry
 * among the active options, and a currency row whose grouping style the adapter could not read is
 * absent from `currencies`. Both mean the same thing to a reader — the amount cannot be converted or
 * shown — so both get the same statement.
 *
 * The currency is checked BEFORE the hire date because it is the more fundamental failure: without
 * a currency there is no form to talk about at all.
 */
export function salaryChangeAvailability(
  options: EmployeeFormOptions | null,
  countryCode: string,
  hireDate: PlainDate,
  today: PlainDate,
): SalaryChangeAvailability {
  const withheld = { kind: 'withheld', statement: CURRENCY_UNREADABLE_STATEMENT } as const;

  if (options === null) {
    return withheld;
  }

  const country = options.countries.find((candidate) => candidate.code === countryCode);
  if (country === undefined) {
    return withheld;
  }

  const currency = options.currencies.find((candidate) => candidate.code === country.currencyCode);
  if (currency === undefined) {
    return withheld;
  }

  // PRESENCE is not usability. A currency row whose `minorUnitExponent` is outside the range the
  // formatter and the parser share cannot convert an amount at all: `parseMajorAmount` answers
  // `'unsupported-exponent'` to every submission, and `formatMoney` answers `null` to every render.
  // Offering the form here would be offering one that cannot be satisfied — the very thing this
  // function exists to prevent, and the state `amountParseRejection`'s totality guard describes as
  // one "the page withholds the whole form in this state anyway". It does now.
  if (!isSupportedExponent(currency.minorUnitExponent)) {
    return withheld;
  }

  // Strictly later: a salary dated the hire date itself is legitimate and is the day-one record.
  if (comparePlainDate(hireDate, today) > 0) {
    return { kind: 'withheld', statement: futureHireStatement(hireDate) };
  }

  return { kind: 'available', currency };
}

/**
 * What the form says when the employee it was recording against is gone.
 *
 * Carries no id: a non-string id yields `{ kind: 'not-found', employeeId: '' }`, and an empty string
 * where an identifier should be reads as a rendering bug. It says "recorded" rather than "changed"
 * because `salary_record` is append-only — there is no prior state that could have been disturbed.
 */
export const SALARY_EMPLOYEE_VANISHED_STATEMENT =
  'This employee no longer exists, so nothing was recorded.';

/**
 * The one outcome the form words itself: the request never reached the Server Action.
 *
 * The action is TOTAL — story 4-1 made every one of its answers a payload. The TRANSPORT is not: a
 * dropped connection, a deploy swapping under the submission, a proxy timing out. There is no
 * `SalaryFieldRejection` for "nothing was ever judged".
 *
 * The wording claims MORE than the client can know, and it is pinned by this story's intent contract
 * (the I/O matrix's "Transport failed" row quotes it), so it is left exactly as specified. A thrown
 * transport error cannot tell "the request never arrived" from "the request arrived, COMMITTED, and
 * the response was lost coming back" — and `salary_record` is append-only with no idempotency key
 * (Law 5 / AD-18), so a reader who believes "nothing was recorded" and retries appends a SECOND
 * permanent row, correctable only by appending a third. Changing this is a product-copy decision
 * against a frozen contract, not a patch; recorded in `deferred-work.md` instead.
 */
export const SALARY_SUBMISSION_FAILED_STATEMENT =
  'The submission did not reach the server, so nothing was recorded. Try again when the connection is back.';

/** `1 reason` / `2 reasons` — the singular is exact. */
function reasonsPhrase(count: number): string {
  return `${String(count)} ${count === 1 ? 'reason' : 'reasons'}`;
}

/**
 * The one statement that rides the app-level polite live region when a submission settles (AD-20).
 *
 * The announcement is the whole receipt. Nothing on the page visibly changes after a successful
 * save, deliberately: the salary timeline is CAP-4 (Epic 5) and there is no surface yet that
 * displays a salary. So the recorded sentence names the date the change takes effect — the one fact
 * that distinguishes this save from the last one — while the AMOUNT is not read back, because
 * rendering a stored salary is a capability this story does not have.
 *
 * A COUNT rather than the reasons themselves on a rejection: each reason is already rendered under
 * its own field and reachable by the focus move. Calm register, statements only — no celebration on
 * success, no alarm on a rejection.
 */
export function composeSalaryAnnouncement(
  result: RecordSalaryChangeResult,
  effectiveFrom: string,
): string {
  switch (result.kind) {
    case 'recorded': {
      // Spelled, not the raw ISO string. This is the one sentence that carries the save, and it is
      // read aloud by the same live region that speaks every other date on the surface — `2026-07-20`
      // is machine form, rendered as digits and separators, and it disagrees with the spelling the
      // detail page and the withheld statements in this module already use. `parsePlainDate` is
      // partial (the argument comes from a date input), so an unparseable string falls back to
      // itself — the same total-fallback shape `futureHireStatement` uses.
      const date = parsePlainDate(effectiveFrom);
      const rendered = date === null ? effectiveFrom : (formatPlainDate(date) ?? effectiveFrom);
      return `Salary change recorded, effective ${rendered}.`;
    }
    case 'not-found':
      return SALARY_EMPLOYEE_VANISHED_STATEMENT;
    case 'rejected':
      return `The salary change was not recorded. ${reasonsPhrase(result.reasons.length)}.`;
  }
}
