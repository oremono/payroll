// One-off: seed a USD-reporting FX rate set into the fx_rate table so the org-wide payroll total
// can be computed. Direction (AD-13): fx_rate(from = C, to = R, rate) means "1 unit of C = rate
// units of R". Reporting currency is USD (settings.reporting_currency). Pinned on an early date so
// the set is in force for any as-of the app resolves.
//
// Usage: DATABASE_URL=... node scripts/seed-fx-rates.mjs
import { Pool } from 'pg';

function poolConfig(raw) {
  const m = raw.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^/?]+)\/([^?]+)/);
  if (!m) throw new Error('Could not parse DATABASE_URL');
  const [, user, password, host, database] = m;
  return { host, user, password, database, port: 5432, ssl: { rejectUnauthorized: false } };
}

// 1 unit of FROM = <rate> USD. Approximate mid-2026 rates; exact values are not load-bearing.
const RATES = [
  ['BRL', '0.18000000'],
  ['CAD', '0.73000000'],
  ['EUR', '1.08000000'],
  ['GBP', '1.27000000'],
  ['INR', '0.01200000'],
  ['JPY', '0.00640000'],
  ['NOK', '0.09400000'],
  ['USD', '1.00000000'],
];
const PINNED_ON = '2012-01-01';

const pool = new Pool(poolConfig(process.env.DATABASE_URL));
try {
  for (const [from, rate] of RATES) {
    await pool.query(
      `insert into fx_rate (from_currency, to_currency, rate, pinned_on)
       values ($1, $2, $3, $4)
       on conflict (from_currency, to_currency, pinned_on) do update set rate = excluded.rate`,
      [from, 'USD', rate, PINNED_ON],
    );
  }
  const n = (await pool.query('select count(*)::int n from fx_rate')).rows[0].n;
  const rows = (
    await pool.query(
      'select from_currency, to_currency, rate::text, pinned_on::text from fx_rate order by from_currency',
    )
  ).rows;
  console.log('fx_rate rows now:', n);
  console.table(rows);
} finally {
  await pool.end();
}
