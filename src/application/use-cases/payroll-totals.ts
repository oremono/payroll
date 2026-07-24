/**
 * The CAP-9 payroll-totals read use-case, and the FINALIZED boundary payload story 10-2 consumes
 * unmodified (Law 7 / AD-24).
 *
 * Orchestration only: load the ORG-WIDE population, every `fx_rate` row, and the reporting currency
 * (three reads, in parallel), hand them to the ONE pure domain (`computePayrollTotals`), encode
 * every `Money` to `BoundaryMoney` (Law 4 / AD-4), and attach the `asOf` receipt. Every judgement is
 * the domain's and every effect goes through a port, so the fast suite covering this touches no
 * database and no clock.
 *
 * ## `asOf` is a parameter, and that is the whole of Law 6 here
 *
 * The clock is read ONCE, at the delivery boundary (story 10-2's page), and the date is passed
 * inward. Nothing here asks what day it is. Same data + same `asOf` ⇒ byte-identical payload (Law 6
 * / AD-11). Computed fresh per request — no totals table, no cache (AD-12).
 *
 * ## The refusal is the DOMAIN's, nested inside an answer (Law 8 / AD-20)
 *
 * A missing rate set or pair is not a repository failure — it is a computed org-wide `refusal` the
 * domain returns, carried inside an overall `answer` (the per-country totals are always present). The
 * use-case's ONE outer failure arm is `unavailable`: ANY of the three reads throwing is caught, so no
 * exception crosses the boundary. There is deliberately NO not-found (org-wide, no subject employee).
 *
 * ## Read-only, fresh per request (Law 5 / AD-18 / AD-2 / AD-12)
 *
 * No write path, no mutation, no route handler. The database SELECTs the candidate set, the fx rows,
 * and the settings row; the domain computes every per-country total, headcount, and the org-wide
 * converted total (Law 2 / AD-2 / AD-13).
 */

import type { EmployeeRepository } from '@/application/ports/employee-repository';
import type { FxRateRepository } from '@/application/ports/fx-rate-repository';
import type { SettingsRepository } from '@/application/ports/settings-repository';
import type { CurrencyPair } from '@/domain/fx';
import { toBoundaryMoney, type BoundaryMoney } from '@/domain/money';
import {
  computePayrollTotals,
  type OrgWideTotal,
  type RateReceipt,
} from '@/domain/payroll-totals';
import type { PlainDate } from '@/domain/plain-date';

/**
 * One per-country total as a receipt (Law 8 / AD-20 / AD-4): the country's codes, its SINGLE
 * currency, the in-population headcount, and the sum in LOCAL currency as `BoundaryMoney`
 * (`amountMinor` a decimal string, never converted).
 */
export type PayrollCountryTotal = {
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: string;
  readonly n: number;
  readonly total: BoundaryMoney;
};

/**
 * The org-wide figure at the boundary: the domain's answer/refusal with the one `Money` (`total`)
 * encoded to `BoundaryMoney`. `ratesUsed` and `missingPairs` carry no money — plain strings and
 * `PlainDate`s — so they cross unchanged.
 */
export type PayrollOrgWideTotal =
  | {
      readonly kind: 'answer';
      readonly reportingCurrency: string;
      readonly total: BoundaryMoney;
      readonly ratesUsed: readonly RateReceipt[];
      readonly pinnedOn: PlainDate | null;
    }
  | {
      readonly kind: 'refusal';
      readonly reason: 'no-rate-set' | 'missing-rate';
      readonly reportingCurrency: string;
      readonly asOf: PlainDate;
      readonly pinnedOn: PlainDate | null;
      readonly missingPairs: readonly CurrencyPair[];
    };

/**
 * The totals, carrying their receipts (Law 8 / AD-20): the `asOf` the figures were computed at, the
 * per-country totals (ordered by `countryCode`, in local currency), and the org-wide answer-or-refusal.
 */
export type PayrollTotals = {
  readonly asOf: PlainDate;
  readonly perCountry: readonly PayrollCountryTotal[];
  readonly orgWide: PayrollOrgWideTotal;
};

/**
 * The read payload (Law 8 / AD-20). `answer` carries the totals (whose `orgWide` may itself be a
 * refusal); `unavailable` means "we could not find out" (a repository outage). Story 10-2 renders
 * every arm and adds nothing to this contract.
 */
export type GetPayrollTotalsResult =
  | { readonly kind: 'answer'; readonly totals: PayrollTotals }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: no clock, no Prisma, no id generator. Three READ ports — the org-wide
 * population, the fx rows, and the reporting currency — each a narrow `Pick`/interface reaching
 * exactly the method this read needs. `asOf` arrives per call as an argument (Law 6 / AD-11).
 */
export type PayrollTotalsDeps = {
  readonly repository: Pick<EmployeeRepository, 'findPayrollTotalsPopulation'>;
  readonly fxRateRepository: FxRateRepository;
  readonly settingsRepository: Pick<SettingsRepository, 'readSettings'>;
};

/** Encode the domain org-wide result for the boundary: only its one `Money` (`total`) is encoded. */
function toBoundaryOrgWide(orgWide: OrgWideTotal): PayrollOrgWideTotal {
  if (orgWide.kind === 'refusal') {
    return orgWide;
  }
  return {
    kind: 'answer',
    reportingCurrency: orgWide.reportingCurrency,
    total: toBoundaryMoney(orgWide.total),
    ratesUsed: orgWide.ratesUsed,
    pinnedOn: orgWide.pinnedOn,
  };
}

/**
 * The payroll totals over the as-of population, at `asOf`.
 *
 * The order is the rule: Promise.all the three reads (AD-13); run the ONE `computePayrollTotals`
 * (per-country sums, needed-pair resolution, convert-once org-wide answer or refusal); encode every
 * `Money` to `BoundaryMoney`; attach `asOf`.
 *
 * TOTAL: any repository throw is `unavailable`, never an exception across the boundary.
 */
export async function getPayrollTotals(
  deps: PayrollTotalsDeps,
  asOf: PlainDate,
): Promise<GetPayrollTotalsResult> {
  try {
    const [population, fxRates, settings] = await Promise.all([
      deps.repository.findPayrollTotalsPopulation(),
      deps.fxRateRepository.findAllFxRates(),
      deps.settingsRepository.readSettings(),
    ]);

    const { perCountry, orgWide } = computePayrollTotals({
      candidates: population.candidates,
      countries: population.countries,
      currencies: population.currencies,
      reportingCurrency: settings.reportingCurrency,
      fxRates,
      asOf,
    });

    return {
      kind: 'answer',
      totals: {
        asOf,
        perCountry: perCountry.map((country) => ({
          countryCode: country.countryCode,
          countryName: country.countryName,
          currency: country.currency,
          n: country.n,
          total: toBoundaryMoney(country.total),
        })),
        orgWide: toBoundaryOrgWide(orgWide),
      },
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
