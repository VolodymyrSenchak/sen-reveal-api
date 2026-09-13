"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCorsOptions = exports.corsOrigin = exports.CORS_ERROR_MESSAGE = void 0;
const defaultAllowedOrigins = [
    "http://localhost:4200",
    "https://sencha-sen-reveal.vercel.app"
];
exports.CORS_ERROR_MESSAGE = "Not allowed by CORS";
/** `CORS_ORIGINS` env (comma-separated) overrides the default list. */
function getAllowedOrigins() {
    const fromEnv = (process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    return fromEnv.length ? fromEnv : defaultAllowedOrigins;
}
const corsOrigin = (origin, callback) => {
    if (!origin || getAllowedOrigins().includes(origin)) {
        callback(null, true); // Allow the request
    }
    else {
        callback(new Error(exports.CORS_ERROR_MESSAGE)); // Block the request
    }
};
exports.corsOrigin = corsOrigin;
const getCorsOptions = () => ({
    origin: exports.corsOrigin,
    // the polling fallback reads the ETag to send If-None-Match
    exposedHeaders: ["ETag"],
});
exports.getCorsOptions = getCorsOptions;
//# sourceMappingURL=corsUtils.js.map