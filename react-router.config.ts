import type { Config } from "@react-router/dev/config";

// SPA mode: the API lives on Lambda and every call carries the user's Bearer
// token, so there is nothing to render on a server. `react-router build`
// emits static files under build/client for Cloudflare Pages.
export default {
  ssr: false,
} satisfies Config;
