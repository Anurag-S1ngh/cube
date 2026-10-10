/** Error returned by the Cube API or transport, carrying the HTTP status. */
export class CubeError extends Error {
	readonly status: number;
	readonly body: unknown;
	readonly cause?: unknown;

	constructor(
		message: string,
		status: number,
		body?: unknown,
		cause?: unknown,
	) {
		super(message);
		this.name = "CubeError";
		this.status = status;
		this.body = body;
		this.cause = cause;
	}
}
