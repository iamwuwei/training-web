const strip = (s: string | undefined) => (s ?? "").trim().replace(/\/+$/, "");

export const config = {
  apiUrl: strip(import.meta.env.VITE_API_URL),
  authUrl: strip(import.meta.env.VITE_AUTH_URL),
  appleClientId: (import.meta.env.VITE_APPLE_CLIENT_ID ?? "").trim(),
  devToken: (import.meta.env.VITE_DEV_TOKEN ?? "").trim(),
} as const;

/** No API URL configured → run on the bundled mock data (training-api seed/plans.json). */
export const useMock = config.apiUrl === "";
