const currencySymbols: Record<string, string> = {
	usd: "$",
	eur: "€",
	gbp: "£",
	inr: "₹",
	jpy: "¥",
};

export function formatMoney(cents: number, currency: string): string {
	const code = currency.toLowerCase();
	const symbol = currencySymbols[code] ?? "";
	const amount = (cents / 100).toFixed(2);
	return symbol ? `${symbol}${amount}` : `${amount} ${currency.toUpperCase()}`;
}
