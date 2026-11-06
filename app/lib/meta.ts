// The browser title of a page inside the app: 「頁名 · 比賽名」, the race being the one of my own plan (the `_app` layout's loader),
// or just the page's name when there is no plan. Group pages follow the same rule: the suffix is my plan's race, not the group's.

type Match = { id: string; loaderData?: unknown } | undefined;

export function raceNameOf(matches: readonly Match[]): string | null {
  const layout = matches.find((m) => m?.id === "routes/_app")?.loaderData as { data?: { plan?: { race_name?: unknown } } | null } | undefined;
  const name = layout?.data?.plan?.race_name;
  return typeof name === "string" && name ? name : null;
}

export function pageTitle(page: string, matches: readonly Match[]): { title: string }[] {
  const race = raceNameOf(matches);
  return [{ title: race ? `${page} · ${race}` : page }];
}
