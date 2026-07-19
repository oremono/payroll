'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import type { EmployeeDetail, EmployeeFormOptions } from '@/application/ports/employee-repository';
import type {
  CreateEmployeeResult,
  FieldRejection,
  UpdateEmployeeResult,
} from '@/application/use-cases/employees';
import type { EmployeeField } from '@/domain/employee';
import { useAnnounce } from '@/ui/announcer';
import {
  composeFormAnnouncement,
  currencyLineFor,
  EMPLOYEE_FORM_FIELDS,
  EMPLOYEE_VANISHED_STATEMENT,
  fieldDescribedById,
  fieldInputId,
  firstRejectedField,
  formLevelRejections,
  formRejectionText,
  initialFormValues,
  rejectionsFor,
  SUBMISSION_FAILED_STATEMENT,
  toCreateInput,
  toUpdateInput,
  type EmployeeFormValues,
} from '@/ui/employee-form';

/**
 * The employee create/edit side panel — this capability's one interactive surface.
 *
 * ## It is the as-of popover plus the four things a MODAL needs
 *
 * `as-of-control.tsx` already hand-rolls the hard parts: the live-queried Tab containment, Esc on
 * the root wrapper, focus return through a trigger ref, and outside-pointerdown dismissal. What it
 * lacks — because it is a popover and not a modal — is `aria-modal="true"`, a backdrop, background
 * `inert`, and a scroll lock. This component adds exactly those four, and no dependency.
 *
 * ## No shadcn, and this is where that ruling was due
 *
 * `deferred-work.md` parked the shadcn/ui copy-in at "the first capability form that needs a
 * primitive the shell does not build — realistically CAP-2's employee form (story 3-2)". This is
 * that form, and the answer is still no. Every control it needs is native: `<input type="text">`,
 * four `<select>`s, `<input type="date">`. shadcn's dialog is `@radix-ui/react-dialog` plus its
 * Tailwind v4 template, which ships `oklch` literals, a second set of variable names with
 * hard-coded values, and a `.dark` class block — three simultaneous AD-15 violations, two of which
 * are now lint errors. The ruling is recorded in `src/ui/README.md`, not merely re-parked.
 *
 * ## What this component does NOT decide
 *
 * Every sentence, every label, every id, and the whole payload shape come from
 * `src/ui/employee-form.ts`, which is framework-free and unit-tested. What is left here is markup,
 * focus, and one call to a Server Action handed in as a prop — `src/ui` may not import
 * `@/app/*`, so the action arrives from the composition root.
 *
 * ## Register
 *
 * No error color (none exists in this token system), no red/green semantics, no `role="alert"`, no
 * spinner, no toast, no celebration. A rejection is data: each reason sits under its own field as
 * plain ink, a reason blaming no field sits in a `refusal-fill` region, and the pending state is a
 * disabled submit whose label states the action is under way.
 */

export type CreateEmployeeAction = (input: unknown) => Promise<CreateEmployeeResult>;
export type UpdateEmployeeAction = (
  employeeId: unknown,
  input: unknown,
) => Promise<UpdateEmployeeResult>;

/**
 * Create and edit are genuinely different, so the difference is in the TYPES rather than in a pair
 * of optional props: an edit has an employee and an update action, a create has neither.
 */
export type EmployeeFormPanelMode =
  | { readonly kind: 'create'; readonly action: CreateEmployeeAction }
  | {
      readonly kind: 'edit';
      readonly employee: EmployeeDetail;
      readonly action: UpdateEmployeeAction;
    };

/**
 * Everything inside the dialog that can hold focus, in DOM order.
 *
 * Queried LIVE on every Tab rather than captured at open time — the dialog's contents are
 * conditional (a field's message appears only once that field is rejected), so a captured list
 * would go stale the moment a submission came back. Copied from `as-of-control.tsx`; `[tabindex="-1"]`
 * is excluded because it marks something programmatically focusable but deliberately out of the Tab
 * sequence.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Body children that must keep working while the dialog is open.
 *
 * `#app-announcer` is the ONE app-level polite live region (AD-20). Inerting it would silence the
 * announcement a rejection makes at exactly the moment the person needs it. Next's own route
 * announcer is left alone for the same reason and because it is not ours to touch.
 */
const NEVER_INERT = new Set(['app-announcer', '__next-route-announcer__']);

const FIELD_CONTROL =
  'mt-1 block w-full rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink focus:border-primary';
const FIELD_LABEL = 'block text-label-caps text-ink-muted uppercase';

export function EmployeeFormPanel({
  mode,
  options,
}: {
  readonly mode: EmployeeFormPanelMode;
  /** Active reference rows only — an inactive role must not be choosable for a NEW write. */
  readonly options: EmployeeFormOptions;
}) {
  const announce = useAnnounce();

  const isEdit = mode.kind === 'edit';
  const employee = mode.kind === 'edit' ? mode.employee : null;

  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<EmployeeFormValues>(() => initialFormValues(employee));
  const [reasons, setReasons] = useState<readonly FieldRejection[]>([]);
  const [isPending, setIsPending] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const formLevelRef = useRef<HTMLDivElement>(null);

  const triggerLabel = isEdit ? 'Edit employee' : 'Add employee';
  const submitLabel = isEdit ? 'Save changes' : 'Create employee';
  const headingId = 'employee-form-heading';

  function open() {
    // Re-seeded from the employee on every open, so a dialog cancelled half-edited does not reopen
    // holding the abandoned text.
    setValues(initialFormValues(employee));
    setReasons([]);
    setIsOpen(true);
  }

  /** Close and RETURN FOCUS to the trigger — Esc must never strand focus on a removed element. */
  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  /**
   * Two of the four things that make this a modal rather than a popover: `inert` on the background,
   * and a scroll lock on the document. (The other two — a backdrop and `aria-modal` — are markup,
   * below.)
   *
   * The dialog is PORTALLED to `document.body`, so it is not a descendant of the page it covers.
   * That matters for exactly this effect: `inert` is inherited, so inerting an ancestor of the
   * dialog would inert the dialog too. Everything in `document.body` except the subtree holding
   * this dialog is inerted, and `wrapperRef` is how that subtree is identified — the effect runs
   * after the portal has been committed, so the ref is live by the time it is read.
   *
   * Two children are deliberately spared. `#app-announcer` is the ONE app-level polite live region
   * (AD-20); inerting it would silence the announcement a rejection makes at exactly the moment it
   * is needed. Next's own route announcer is left alone for the same reason and because it is not
   * ours to touch. A child that was ALREADY inert is left inert on cleanup, so a nested surface
   * cannot have its inertness cleared by this dialog closing.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const wrapper = wrapperRef.current;
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

    // Focus lands on the FIRST FIELD — not on the dialog, and not on the close button. Done here
    // rather than with `autoFocus` so it is re-applied on every open, including the second one.
    document.getElementById(fieldInputId('name'))?.focus();

    return () => {
      for (const child of inerted) {
        child.removeAttribute('inert');
      }
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  /**
   * After a rejection, focus MOVES TO THE PROBLEM (WCAG 2.2 AA SC 3.3.1) — telling someone a form
   * was refused and leaving them to hunt for which field is the failure this exists to avoid. A
   * rejection blaming no field sends focus to the form-level region instead, which is why that
   * region carries `tabIndex={-1}`.
   */
  useEffect(() => {
    if (reasons.length === 0) {
      return;
    }
    const field = firstRejectedField(reasons);
    if (field === null) {
      formLevelRef.current?.focus();
      return;
    }
    document.getElementById(fieldInputId(field))?.focus();
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
    // A focus somehow already outside the dialog is pulled back IN on the next Tab rather than left
    // where it is — containment, not merely edge-wrapping.
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

  function set(key: keyof EmployeeFormValues, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      return;
    }
    setIsPending(true);

    let result: CreateEmployeeResult | UpdateEmployeeResult;
    try {
      result =
        mode.kind === 'create'
          ? await mode.action(toCreateInput(values))
          : await mode.action(mode.employee.id, toUpdateInput(values));
    } catch {
      // The ACTION is total — story 3-1 made sure of that. What is not total is the TRANSPORT: the
      // request can fail before it ever reaches the action. Caught locally so it is never an
      // unhandled rejection and never leaves the dialog stuck in its pending state.
      result = {
        kind: 'rejected',
        reasons: [{ field: null, offendingValue: null, sentence: SUBMISSION_FAILED_STATEMENT }],
      };
    }

    setIsPending(false);
    // One voice (AD-20): the app-level polite region, never a second live region mounted here.
    announce(composeFormAnnouncement(result));

    if (result.kind === 'created' || result.kind === 'updated') {
      // No `revalidatePath` here and no `router.refresh()`: the Server Actions already invalidate
      // `/employees` and `/employees/{id}`, and Next applies that revalidation to the router as
      // part of this very response. The frontend adds nothing to the contract (Law 7).
      close();
      return;
    }

    if (result.kind === 'not-found') {
      // The row being edited is gone. Rendered as a form-level statement carrying NO id — a
      // non-string id yields `employeeId: ''`, and an empty string where an identifier should be
      // reads as a rendering bug.
      setReasons([
        { field: null, offendingValue: null, sentence: EMPLOYEE_VANISHED_STATEMENT },
      ]);
      return;
    }

    // Every entered value is retained: `values` is untouched, so nothing the person typed is lost
    // to a refusal.
    setReasons(result.reasons);
  }

  const formLevel = formLevelRejections(reasons);
  const currencyLine = currencyLineFor(options, values.countryCode);

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
        {triggerLabel}
      </button>

      {isOpen
        ? createPortal(
            // Portalled to `document.body`, not rendered in place. A modal that lives inside the
            // page it covers cannot have that page inerted around it (`inert` is inherited), and a
            // `fixed` element inside any ancestor with a transform or a filter is positioned
            // against that ancestor rather than the viewport.
            <div ref={wrapperRef} className="fixed inset-0 z-40" onKeyDown={onDialogKeyDown}>
              {/* The backdrop. Dismisses on POINTERDOWN — dismissal follows the press, the way it
                  does in every other modal, and a click listener would also fire after a drag that
                  merely ended outside. `aria-hidden` because it is decoration: the dialog's own
                  `aria-modal` is what hides the background from assistive technology, and `inert`
                  is what hides it from the keyboard. */}
              <div
                aria-hidden="true"
                onPointerDown={() => setIsOpen(false)}
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
                    {triggerLabel}
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

                <form onSubmit={submit} className="mt-3">
                  {formLevel.length === 0 ? null : (
                    // A REGION with a heading, never `role="alert"` — the same treatment the import
                    // refusal gets, and for the same reason. `tabIndex={-1}` so focus can be moved
                    // here when no field is to blame.
                    <div
                      ref={formLevelRef}
                      tabIndex={-1}
                      role="group"
                      aria-labelledby="employee-form-level-heading"
                      className="mb-3 rounded border border-border-hairline bg-refusal-fill p-3"
                    >
                      <h3
                        id="employee-form-level-heading"
                        className="text-body-md font-medium text-ink-muted"
                      >
                        The employee was not saved
                      </h3>
                      {formLevel.map((reason) => (
                        <p key={reason.sentence} className="mt-1 text-body-sm text-ink">
                          {formRejectionText(reason)}
                        </p>
                      ))}
                    </div>
                  )}

                  <Field field="name" reasons={reasons}>
                    <input
                      id={fieldInputId('name')}
                      type="text"
                      value={values.name}
                      onChange={(event) => set('name', event.target.value)}
                      {...invalidProps('name', reasons)}
                      className={FIELD_CONTROL}
                    />
                  </Field>

                  <Field field="role" reasons={reasons}>
                    <select
                      id={fieldInputId('role')}
                      value={values.roleCode}
                      onChange={(event) => set('roleCode', event.target.value)}
                      {...invalidProps('role', reasons)}
                      className={FIELD_CONTROL}
                    >
                      {/* Free text is banned for every reference-table field (epic-3-context): the
                          taxonomy is chosen, never typed. The empty option is the unchosen state,
                          not a value — picking it is what produces the "is required" rejection. */}
                      <option value="">Choose a role</option>
                      {options.roles.map((role) => (
                        <option key={role.code} value={role.code}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field field="level" reasons={reasons}>
                    <select
                      id={fieldInputId('level')}
                      value={values.levelCode}
                      onChange={(event) => set('levelCode', event.target.value)}
                      {...invalidProps('level', reasons)}
                      className={FIELD_CONTROL}
                    >
                      <option value="">Choose a level</option>
                      {/* Already ordered by `rank`, which is UNIQUE — so the order is total and
                          cannot reshuffle on a tie. Not re-sorted here. */}
                      {options.levels.map((level) => (
                        <option key={level.code} value={level.code}>
                          {level.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {isEdit ? (
                    // AD-6: country is set at create and IMMUTABLE. Not a disabled select — a
                    // disabled control still says "this is a control", and offering one that can
                    // never be used is the country-edit affordance the Laws forbid. It is text,
                    // with the reason beside it, and nothing named `countryCode` is submitted:
                    // `toUpdateInput` does not have the key at all.
                    <div className="mt-3">
                      <p className={FIELD_LABEL}>{EMPLOYEE_FORM_FIELDS.country.label}</p>
                      <p className="mt-1 font-mono text-number-sm text-ink">{values.countryCode}</p>
                      <p className="mt-1 text-body-sm text-ink-muted">
                        Country is set when the employee is created and cannot be changed — it is
                        what the currency on their salary records was written from.
                      </p>
                    </div>
                  ) : (
                    <Field field="country" reasons={reasons}>
                      <select
                        id={fieldInputId('country')}
                        value={values.countryCode}
                        onChange={(event) => set('countryCode', event.target.value)}
                        {...invalidProps('country', reasons)}
                        className={FIELD_CONTROL}
                      >
                        <option value="">Choose a country</option>
                        {options.countries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}

                  {/* Currency FOLLOWS from country and is never chosen (AD-6). There is no currency
                      control anywhere on this form; this line is the whole of its presence. */}
                  {currencyLine === null ? null : (
                    <p className="mt-1 text-body-sm text-ink-muted">{currencyLine}</p>
                  )}

                  <Field field="gender" reasons={reasons}>
                    <select
                      id={fieldInputId('gender')}
                      value={values.gender}
                      onChange={(event) => set('gender', event.target.value)}
                      {...invalidProps('gender', reasons)}
                      className={FIELD_CONTROL}
                    >
                      <option value="">Choose a gender</option>
                      {/* Verbatim (Law 3) — the option text IS the value, no title-casing. */}
                      <option value="MALE">MALE</option>
                      <option value="FEMALE">FEMALE</option>
                    </select>
                  </Field>

                  <Field field="hire_date" reasons={reasons}>
                    <input
                      id={fieldInputId('hire_date')}
                      type="date"
                      value={values.hireDate}
                      onChange={(event) => set('hireDate', event.target.value)}
                      {...invalidProps('hire_date', reasons)}
                      className={FIELD_CONTROL}
                    />
                  </Field>

                  {/* Enter submits, because this is a real submit button in a real form. */}
                  <button
                    type="submit"
                    disabled={isPending}
                    className="mt-4 w-full rounded bg-primary px-3 py-2 text-body-md text-primary-foreground disabled:bg-secondary"
                  >
                    {/* The whole pending treatment: the label states the action is under way. No
                        spinner, no bar, no percentage. */}
                    {isPending ? 'Saving…' : submitLabel}
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
 * needs, and the reason the message ids are generated rather than written by hand.
 *
 * `aria-describedby` is emitted only when a message actually exists: a describedby pointing at an
 * absent id resolves to nothing and is a worse state than no describedby at all.
 */
function invalidProps(field: EmployeeField, reasons: readonly FieldRejection[]) {
  const rejected = rejectionsFor(reasons, field).length > 0;
  return rejected
    ? { 'aria-invalid': true as const, 'aria-describedby': fieldDescribedById(field) }
    : {};
}

/** One labelled control, with any reasons for it rendered underneath as plain ink. */
function Field({
  field,
  reasons,
  children,
}: {
  readonly field: EmployeeField;
  readonly reasons: readonly FieldRejection[];
  readonly children: React.ReactNode;
}) {
  const own = rejectionsFor(reasons, field);
  return (
    <div className="mt-3">
      <label htmlFor={fieldInputId(field)} className={FIELD_LABEL}>
        {EMPLOYEE_FORM_FIELDS[field].label}
      </label>
      {children}
      {own.length === 0 ? null : (
        // No error color, no icon, no red — none exists in this token system and none is invented
        // here. The MESSAGE is what identifies the problem, which is also what keeps colour from
        // being the sole carrier of meaning (WCAG 2.2 AA SC 1.4.1).
        <div id={fieldDescribedById(field)} className="mt-1 text-body-sm text-ink">
          {own.map((reason) => (
            <p key={reason.sentence}>{formRejectionText(reason)}</p>
          ))}
        </div>
      )}
    </div>
  );
}
