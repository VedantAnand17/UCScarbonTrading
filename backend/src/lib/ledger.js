async function balances(client, organisationId) {
  // PostgreSQL sums BIGINT as NUMERIC. Read it as text so projection can exceed a single entry's range.
  const sums = await client.$queryRaw`
    SELECT bucket::text, SUM("amountG")::text AS total
    FROM "LedgerEntry" WHERE "organisationId" = ${organisationId} GROUP BY bucket`;
  const totals = Object.fromEntries(sums.map(({ bucket, total }) => [bucket, BigInt(total)]));
  return { availableG: totals.AVAILABLE ?? 0n, reservedG: totals.RESERVED ?? 0n };
}

function factorAt(client, timestamp) {
  return client.emissionFactor.findFirst({
    where: { validFrom: { lte: timestamp }, OR: [{ validTo: null }, { validTo: { gt: timestamp } }] },
    orderBy: [{ validFrom: "desc" }, { version: "desc" }],
  });
}

module.exports = { balances, factorAt };
