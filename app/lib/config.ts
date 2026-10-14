const strip = (s: string | undefined) => (s ?? "").trim().replace(/\/+$/, "");

export const config = {
  /** API Gateway base URL (custom domain or execute-api), no trailing slash. */
  apiUrl: strip(import.meta.env.VITE_API_URL),
  /** Cognito hosted-UI domain, e.g. https://training-api-prod-123.auth.ap-northeast-1.amazoncognito.com */
  cognitoDomain: strip(import.meta.env.VITE_COGNITO_DOMAIN),
  /** Cognito user-pool app client id (the `web` client). */
  cognitoClientId: (import.meta.env.VITE_COGNITO_CLIENT_ID ?? "").trim(),
  /** Optional: jump straight to one federated provider ("SignInWithApple") instead of the hosted UI. */
  cognitoIdp: (import.meta.env.VITE_COGNITO_IDP ?? "").trim(),
} as const;

/** No API URL configured → run on the bundled mock data (training-api seed/plans.json). */
export const useMock = config.apiUrl === "";
