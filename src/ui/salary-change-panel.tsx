'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type {
  RecordSalaryChangeResult,
  SalaryFieldRejection,
} from '@/application/use-cases/record-salary-change';
import { MAX_MAJOR_AMOUNT_LENGTH, type CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryChangeField } from '@/domain/salary-change';
import { useAnnounce } from '@/ui/announcer';
import {
  composeSalaryAnnouncement,
  firstRejectedSalaryField,
  initialSalaryFormValues,
  SALARY_CHANGE_FORM_FIELDS,
  SALARY_EMPLOYEE_VANISHED_STATEMENT,
  SALARY_SUBMISSION_FAILED_STATEMENT,
  salaryAmountPlaceholder,
  salaryCurrencyNote,
  salaryFieldDescribedById,
  salaryFieldInputId,
  salaryFormLevelRejections,
  salaryRejectionsFor,
  salaryRejectionText,
  toSalaryChangeInput,
  type SalaryChangeFormValues,
} from '@/ui/salary-change-form';

/**
 * The record-a-salary-change side panel — CAP-3's one interactive surface.
 *
 * ## A copy of `employee-form-panel.tsx`, deliberately
 *
 * Same portal, same `role="dialog" aria-modal="true"`, same live-queried Tab containment, same Esc,
 * same background `inert` with the live region spared, same scroll lock, same focus return in the
 * effect CLEANUP, same open focus on the first field, same `isPending` submit guard. Story 3-2 was
 * the designated re-decision point for shadcn/ui and Radix and re-rejected both; nothing about this
 * form changes that, and a second dialog mechanic would be a second set of these bugs to fix.
 *
 * ## What it does NOT decide
 *
 * Every sentence, label, id and payload comes from `src/ui/salary-change-form.ts`, which is
 * framework-free and unit-tested — `src/ui/*.tsx` is outside the coverage gate, so a judgement left
 * here is a judgement nothing measures. What remains is markup, focus, and one call to a Server
 * Action handed in as a prop: `src/ui` may not import `@/app/*`.
 *
 * ## Three fields, one of which is not a control
 *
 * Effective date and amount are inputs. Currency is a STATEMENT (AD-6): it follows from the
 * employee's country, and a disabled control would still say "this is a choice". So there is no
 * currency control here, which is also why the currency can never fail to submit.
 *
 * The amount is typed in MAJOR units, as screen-09 specifies — `₹`, `21,50,000`. The conversion into
 * the payload's minor-unit decimal string is `parseMajorAmount` in the domain, reached through
 * `toSalaryChangeInput`. Nothing in this file multiplies anything.
 *
 * ## Register
 *
 * No colour literal, no `dark:` variant, no red/green semantics, no `role="alert"`, no second live
 * region, no spinner, no toast, no celebration. A rejection is data: each reason sits under its own
 * field as plain ink, a reason blaming no field sits in a `refusal-fill` region with a heading, and
 * the pending state is a disabled submit whose label states the action is under way.
 *
 * After a successful save nothing on the page visibly changes — there is no surface that displays a
 * salary until Epic 5 renders the timeline. The announcement is the receipt.
 */

export type RecordSalaryChangeAction = (
  employeeId: unknown,
  input: unknown,
) => Promise<RecordSalaryChangeResult>;

/** Everything inside the dialog that can hold focus, in DOM order. Queried LIVE on every Tab. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Body children that must keep working while the dialog is open. `#app-announcer` is the ONE
 * app-level polite live region (AD-20); inerting it would silence the announcement at exactly the
 * moment the person needs it, and the announcement is this flow's entire receipt.
 */
const NEVER_INERT = new Set(['app-announcer', '__next-route-announcer__']);

const FIELD_CONTROL =
  'mt-1 block w-full rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink focus:border-primary';
const FIELD_LABEL = 'block text-label-caps text-ink-muted uppercase';

const TRIGGER_LABEL = 'Record a salary change';
const SUBMIT_LABEL = 'Record change';

export function SalaryChangePanel({
  employeeId,
  currency,
  today,
  action,
}: {
  readonly employeeId: string;
  /** Resolved from the employee's country at the page boundary — never chosen here (AD-6). */
  readonly currency: CurrencyFormat;
  /** UTC today, read once through the clock port at the delivery boundary (Law 6 / AD-11). */
  readonly today: PlainDate;
  readonly action: RecordSalaryChangeAction;
}) {
  const announce = useAnnounce();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<SalaryChangeFormValues>(() =>
    initialSalaryFormValues(today),
  );
  const [reasons, setReasons] = useState<readonly SalaryFieldRejection[]>([]);
  const [isPending, setIsPending] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Whether the NEXT close should return focus to the trigger. Read from the effect cleanup. */
  const returnFocusRef = useRef(false);
  /**
   * The in-flight guard, held in a ref rather than read from `isPending`.
   *
   * `isPending` is state: two submit events dispatched before React commits the re-render both read
   * `false` and both send. The row they would append is UNDELETABLE (Law 5 — no update, no delete
   * path) and the server has no idempotency key, so a duplicate is permanent and correctable only by
   * appending a third record. A ref is written synchronously, which is the property this needs.
   */
  const pendingRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const formLevelRef = useRef<HTMLDivElement>(null);

  const headingId = 'salary-change-heading';

  function open() {
    // Re-seeded on every open, so a panel cancelled half-filled does not reopen holding the
    // abandoned amount. It re-seeds from the SAME `today` prop, which was resolved once at RSC
    // render — reopening after midnight has passed under a tab still seeds yesterday's date. That
    // is the open deferred entry, not something this re-seed fixes.
    setValues(initialSalaryFormValues(today));
    setReasons([]);
    // The PENDING FLAGS are re-seeded too, and for a sharper reason than the values are. Dismissing
    // the panel does not cancel the submission in flight — there is no abort, and the row it may
    // append is undeletable (Law 5 / AD-18). But the interrupted submission's flags belong to the
    // dialog that is gone: left standing, they reopen the panel showing a disabled "Recording…"
    // button over a freshly seeded form, with `pendingRef` swallowing every subsequent submit. If
    // that promise never settles — a held socket, a proxy sitting on the response — nothing ever
    // clears them and the only way back is a full page reload.
    pendingRef.current = false;
    setIsPending(false);
    setIsOpen(true);
  }

  /**
   * Close, and ask for focus to be returned to the trigger.
   *
   * The focus move is REQUESTED here and performed in the effect cleanup. Calling `focus()` here
   * would run while the trigger is still inside an `inert` subtree, and an inert element cannot
   * take focus — the call silently does nothing and Esc leaves focus on `body`. (The CAP-2 panel
   * shipped that bug once; this is the fix, copied.)
   */
  function close() {
    returnFocusRef.current = true;
    setIsOpen(false);
  }

  /**
   * The two modal mechanics that are not markup: `inert` on the background and a scroll lock.
   *
   * The dialog is PORTALLED to `document.body`, so it is not a descendant of the page it covers —
   * `inert` is inherited, so inerting an ancestor of the dialog would inert the dialog too. A child
   * that was ALREADY inert is left inert on cleanup, so a nested surface cannot have its inertness
   * cleared by this dialog closing.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const wrapper = wrapperRef.current;
    // Captured inside the effect rather than read from the ref in the cleanup: the ref may point
    // somewhere else by then, and this is the node that must get focus back.
    const trigger = triggerRef.current;
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      if (wrapper !== null && child.contains(wrapper)) {
        continue;
      }
      if (NEVER_INERT.has(child.id) || child.hasAttribute('inert')) {
        continue;
      }
      child.setAttribute('inert', '');
      inerted.push(child);
    }

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    // Focus lands on the FIRST FIELD. Done here rather than with `autoFocus` so it is re-applied on
    // every open, including the second one.
    document.getElementById(salaryFieldInputId('effective_from'))?.focus();

    return () => {
      for (const child of inerted) {
        child.removeAttribute('inert');
      }
      document.documentElement.style.overflow = previousOverflow;

      // AFTER the background is released, never before.
      if (returnFocusRef.current) {
        returnFocusRef.current = false;
        trigger?.focus();
      }
    };
  }, [isOpen]);

  /**
   * After a rejection, focus MOVES TO THE PROBLEM (WCAG 2.2 AA SC 3.3.1). A rejection with no
   * control of its own — one blaming no field, or one blaming CURRENCY, which is a statement rather
   * than an input (AD-6) — sends focus to the form-level region instead, which is where those
   * reasons render and why it carries `tabIndex={-1}`. `firstRejectedSalaryField` answers `null`
   * for both, so this never asks the document for an id that is never rendered.
   */
  useEffect(() => {
    if (reasons.length === 0) {
      return;
    }
    const field = firstRejectedSalaryField(reasons);
    if (field === null) {
      formLevelRef.current?.focus();
      return;
    }
    document.getElementById(salaryFieldInputId(field))?.focus();
  }, [reasons]);

  /** Contain Tab inside the dialog, both directions, from the LIVE focusable list. */
  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }

    const active = document.activeElement;
    // A focus somehow already outside the dialog is pulled back IN on the next Tab.
    if (event.shiftKey) {
      if (active === first || active === null || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || active === null || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function set(key: keyof SalaryChangeFormValues, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Closes deferred #4 at the UI level: a second press while the first is in flight is a no-op.
    // The underlying row remains undeletable and the server has no idempotency key, so the ledger
    // entry stays open with its scope narrowed.
    if (pendingRef.current) {
      return;
    }

    // The amount is converted BEFORE anything is sent. A major-unit amount this currency cannot
    // hold has no minor-unit representation, so there is nothing to submit — and the server, which
    // is specified in minor units, has no reason kind that could say so.
    const built = toSalaryChangeInput(values, currency);
    if (!built.ok) {
      setReasons(built.reasons);
      announce(
        composeSalaryAnnouncement(
          { kind: 'rejected', reasons: built.reasons },
          values.effectiveFrom,
        ),
      );
      return;
    }

    pendingRef.current = true;
    setIsPending(true);

    let result: RecordSalaryChangeResult;
    try {
      result = await action(employeeId, built.input);
    } catch {
      // The ACTION is total — story 4-1 made sure of that. The TRANSPORT is not. Caught locally so
      // it is never an unhandled rejection and never leaves the panel stuck pending.
      result = {
        kind: 'rejected',
        reasons: [
          { field: null, offendingValue: null, sentence: SALARY_SUBMISSION_FAILED_STATEMENT },
        ],
      };
    }

    pendingRef.current = false;
    setIsPending(false);
    // One voice (AD-20): the app-level polite region, never a second live region mounted here.
    announce(composeSalaryAnnouncement(result, built.input.effectiveFrom));

    if (result.kind === 'recorded') {
      close();
      // Ask the router for the current route again. NOT a second cache invalidation and nothing
      // added to the contract (Law 7): the Server Action owns both `revalidatePath` calls. This
      // makes the CLIENT re-request the route it is already on, for the reason the CAP-2 panel
      // documents at length.
      router.refresh();
      return;
    }

    if (result.kind === 'not-found') {
      // Rendered as a form-level statement carrying NO id — a non-string id yields `employeeId: ''`,
      // and an empty string where an identifier should be reads as a rendering bug.
      setReasons([
        { field: null, offendingValue: null, sentence: SALARY_EMPLOYEE_VANISHED_STATEMENT },
      ]);
      return;
    }

    // Every entered value is retained: `values` is untouched, so nothing typed is lost to a refusal.
    setReasons(result.reasons);
  }

  const formLevel = salaryFormLevelRejections(reasons);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={open}
        className="rounded bg-primary px-3 py-2 text-body-md text-primary-foreground"
      >
        {TRIGGER_LABEL}
      </button>

      {isOpen
        ? createPortal(
            <div ref={wrapperRef} className="fixed inset-0 z-40" onKeyDown={onDialogKeyDown}>
              {/* The backdrop. Dismisses on POINTERDOWN. `aria-hidden` because it is decoration:
                  `aria-modal` hides the background from assistive technology and `inert` hides it
                  from the keyboard.

                  `close()` rather than `setIsOpen(false)`, so the dismissal asks for focus to be
                  returned to the trigger like every other way out of this dialog. On its own that
                  is not enough, which is why the two lines travel together: this handler runs on
                  POINTERDOWN, and the rest of the press still lands after the dialog is gone. The
                  default action of that press moves focus to whatever now sits under the cursor —
                  the page background, which is not focusable, so focus falls to `body` and the
                  return performed by the effect cleanup is immediately undone. `preventDefault`
                  suppresses the compatibility mouse events that would move it, leaving the cleanup's
                  focus the last word (WCAG 2.2 AA SC 2.4.3). */}
              <div
                aria-hidden="true"
                onPointerDown={(event) => {
                  // PRIMARY button only. `pointerdown` fires for every button, so a right-click
                  // aimed at the backdrop — reaching for the context menu, or simply landing wide
                  // of the dialog — tore the panel down and discarded everything typed into it,
                  // with no warning and nothing recoverable.
                  if (event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  close();
                }}
                className="absolute inset-0 bg-surface-base/70"
              />

              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={headingId}
                className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-border-strong bg-surface-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* `<h2>` — the header owns the document's one `<h1>`. */}
                  <h2 id={headingId} className="text-headline-md text-ink">
                    {TRIGGER_LABEL}
                  </h2>
                  {/* NAMED, not an icon-only glyph (WCAG 2.2 AA). */}
                  <button
                    type="button"
                    onClick={close}
                    className="rounded border border-input-border bg-surface-card px-3 py-2 text-body-sm text-ink"
                  >
                    Close
                  </button>
                </div>

                {/* Law 5 / AD-18, stated before it is enforced: this appends, and appending is the
                    only correction mechanism. No edit, no delete, no future-dating. */}
                <p className="mt-2 text-body-sm text-ink-muted">
                  A salary change is recorded as a new record. Nothing that came before is changed,
                  and a change cannot be dated later than today.
                </p>

                <form onSubmit={submit} className="mt-3">
                  {formLevel.length === 0 ? null : (
                    // A REGION with a heading, never `role="alert"`. `tabIndex={-1}` so focus can be
                    // moved here when no field is to blame.
                    <div
                      ref={formLevelRef}
                      tabIndex={-1}
                      role="group"
                      aria-labelledby="salary-form-level-heading"
                      className="mb-3 rounded border border-border-hairline bg-refusal-fill p-3"
                    >
                      <h3
                        id="salary-form-level-heading"
                        className="text-body-md font-medium text-ink-muted"
                      >
                        The salary change was not recorded
                      </h3>
                      {/* Keyed by POSITION, not by sentence: two reasons can word identically and
                          a duplicate key drops one of them off the screen. Nothing reorders this
                          list — it is rebuilt whole from each result — so the index is stable. */}
                      {formLevel.map((reason, index) => (
                        <p key={index} className="mt-1 text-body-sm text-ink">
                          {salaryRejectionText(reason)}
                        </p>
                      ))}
                    </div>
                  )}

                  <Field field="effective_from" reasons={reasons}>
                    <input
                      id={salaryFieldInputId('effective_from')}
                      type="date"
                      value={values.effectiveFrom}
                      onChange={(event) => set('effectiveFrom', event.target.value)}
                      {...invalidProps('effective_from', reasons)}
                      className={FIELD_CONTROL}
                    />
                  </Field>

                  <Field field="amount_minor" reasons={reasons}>
                    {/* The symbol is an ADORNMENT beside the control, not inside its value: the
                        payload carries an ISO-4217 code, and a symbol typed into the amount would
                        be text the parser refuses. `type="text"`, not `number` — a number input
                        drops grouping separators, offers a spinner this design does not want, and
                        reports its value through a float. */}
                    <div className="mt-1 flex items-center gap-2">
                      <span aria-hidden="true" className="font-mono text-number-sm text-ink-muted">
                        {currency.symbol}
                      </span>
                      <input
                        id={salaryFieldInputId('amount_minor')}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        // The SAME ceiling the parser applies, stated at the control so a paste is
                        // refused where it happens rather than after the work has been done twice.
                        // The parser still enforces it — this attribute is a courtesy, not a guard.
                        maxLength={MAX_MAJOR_AMOUNT_LENGTH}
                        // Grouped the way THIS currency groups — `21,50,000` reads as 2,150,000
                        // under western grouping, so the hard-coded example was a hundredfold
                        // misstatement for every non-Indian employee.
                        placeholder={salaryAmountPlaceholder(currency)}
                        value={values.amount}
                        onChange={(event) => set('amount', event.target.value)}
                        {...invalidProps('amount_minor', reasons)}
                        className={FIELD_CONTROL}
                      />
                    </div>
                  </Field>

                  {/* Currency FOLLOWS from the country and is never chosen (AD-6). There is no
                      currency control anywhere on this form — not even a disabled one — and this
                      statement is the whole of its presence. */}
                  <div className="mt-3">
                    <p className={FIELD_LABEL}>{SALARY_CHANGE_FORM_FIELDS.currency.label}</p>
                    <p className="mt-1 text-body-sm text-ink-muted">{salaryCurrencyNote(currency)}</p>
                  </div>

                  {/* Enter submits, because this is a real submit button in a real form. */}
                  {/* `aria-disabled` rather than the `disabled` ATTRIBUTE, which is the difference
                      between a button that is refused and a button that is GONE. A disabled button
                      leaves the focus order, so the very press that starts the submission strands
                      focus on `body`: Esc stops dismissing the dialog and Tab restarts from the top
                      of the document, for as long as the request is in flight (WCAG 2.2 AA SC
                      2.4.3). The state is still announced and the label still says the action is
                      under way — what changes is that `pendingRef` in `submit` is now what refuses
                      the second press, which is the guard doing the job it was written for instead
                      of the attribute doing it silently underneath. */}
                  <button
                    type="submit"
                    aria-disabled={isPending}
                    className="mt-4 w-full rounded bg-primary px-3 py-2 text-body-md text-primary-foreground aria-disabled:bg-secondary"
                  >
                    {/* The whole pending treatment: the label states the action is under way. No
                        spinner, no bar, no percentage. */}
                    {isPending ? 'Recording…' : SUBMIT_LABEL}
                  </button>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * `aria-invalid` and `aria-describedby` for one field — the two attributes WCAG 2.2 AA SC 3.3.1
 * needs. `aria-describedby` is emitted only when a message actually exists: one pointing at an
 * absent id resolves to nothing and is worse than none at all.
 */
function invalidProps(field: SalaryChangeField, reasons: readonly SalaryFieldRejection[]) {
  const rejected = salaryRejectionsFor(reasons, field).length > 0;
  return rejected
    ? { 'aria-invalid': true as const, 'aria-describedby': salaryFieldDescribedById(field) }
    : {};
}

/** One labelled control, with any reasons for it rendered underneath as plain ink. */
function Field({
  field,
  reasons,
  children,
}: {
  readonly field: SalaryChangeField;
  readonly reasons: readonly SalaryFieldRejection[];
  readonly children: React.ReactNode;
}) {
  const own = salaryRejectionsFor(reasons, field);
  return (
    <div className="mt-3">
      <label htmlFor={salaryFieldInputId(field)} className={FIELD_LABEL}>
        {SALARY_CHANGE_FORM_FIELDS[field].label}
      </label>
      {children}
      {own.length === 0 ? null : (
        // No error color, no icon, no red — none exists in this token system and none is invented
        // here. The MESSAGE identifies the problem, which is what keeps colour from being the sole
        // carrier of meaning (WCAG 2.2 AA SC 1.4.1).
        <div id={salaryFieldDescribedById(field)} className="mt-1 text-body-sm text-ink">
          {/* Keyed by position, for the reason the form-level list above states. */}
          {own.map((reason, index) => (
            <p key={index}>{salaryRejectionText(reason)}</p>
          ))}
        </div>
      )}
    </div>
  );
}
