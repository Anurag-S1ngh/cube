import { createDb } from "@cube/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
