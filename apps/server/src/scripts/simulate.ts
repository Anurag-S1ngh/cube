import { simulateFailures } from "../mock/simulator";

const count = Number(process.argv[2] ?? 8);
const results = await simulateFailures(Number.isFinite(count) ? count : 8);

console.log(`Ingested ${results.length} failed payment events:`);
for (const r of results) {
	console.log(
		`  ${r.payload.data.customer?.name ?? r.payload.data.customerId} — ${r.payload.data.declineCode} — ${r.investigationId}`,
	);
}
process.exit(0);
