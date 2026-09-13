const defaultAllowedOrigins = [
  "http://localhost:4200",
  "https://sencha-sen-reveal.vercel.app"
];

export const CORS_ERROR_MESSAGE = "Not allowed by CORS";

/** `CORS_ORIGINS` env (comma-separated) overrides the default list. */
function getAllowedOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : defaultAllowedOrigins;
}

export const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin || getAllowedOrigins().includes(origin)) {
    callback(null, true); // Allow the request
  } else {
    callback(new Error(CORS_ERROR_MESSAGE)); // Block the request
  }
};

export const getCorsOptions = () => ({
  origin: corsOrigin,
  // the polling fallback reads the ETag to send If-None-Match
  exposedHeaders: ["ETag"],
});
