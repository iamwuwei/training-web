// An invite token is 43 characters of base64url (the api's `INVITE_TOKEN_RE`). People paste either the whole link
// (`https://<web>/join/<token>`) or just the code; both lead to the same `/join/<token>` page. The token travels only
// through the address, exactly like clicking the link, so no new route and no new api call is needed.

const IN_LINK = /\/join\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
const BARE = /^[A-Za-z0-9_-]{43}$/;

/** The 43-character token in what was pasted, or null when it is neither an invite link nor a bare code. */
export function parseInviteToken(text: string): string | null {
  const t = text.trim();
  if (BARE.test(t)) return t;
  return IN_LINK.exec(t)?.[1] ?? null;
}
