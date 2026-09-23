import { createHandlers } from "./app.js";
import { redisFromEnv } from "./redis.js";
import { createService } from "./service.js";

let service = null;
export const handlers = createHandlers({ getService: () => (service ??= createService({ redis: redisFromEnv() })) });
