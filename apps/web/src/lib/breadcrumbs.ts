export interface Crumb {
  label: string;
  href: string | null; // null = current page (not a link)
}

/** cuid/cuid2-style ids: long lowercase alphanumeric starting with a letter. */
function isIdSegment(seg: string): boolean {
  return /^[a-z][a-z0-9]{15,}$/.test(seg);
}

function humanize(seg: string): string {
  const words = seg.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Builds a breadcrumb trail from a workspace-scoped pathname
 * (e.g. /acme/instances/cmr6…/pair → Instances / Pair).
 * Id segments are folded into their parent's link so crumbs stay readable.
 */
export function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return [];
  const slug = segments[0]!;
  const rest = segments.slice(1);

  const crumbs: Crumb[] = [];
  let path = `/${slug}`;
  rest.forEach((seg, i) => {
    path += `/${seg}`;
    if (isIdSegment(seg)) return; // fold ids: the following segment links through them
    const isLast = i === rest.length - 1;
    // /settings has no index page; its sidebar entry points at members.
    const href = seg === "settings" ? `/${slug}/settings/members` : path;
    crumbs.push({ label: humanize(seg), href: isLast ? null : href });
  });
  return crumbs;
}
