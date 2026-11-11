const LEGACY_STORE_PATH = /^\/tienda\/legacy(?:\/|$)/i;

/**
 * A factory reset invalidates every non-legacy route: old tenant storefronts,
 * shorthand storefront routes, panel pages and unmatched paths all return to
 * the canonical seeded storefront. Existing legacy subroutes remain usable.
 */
export function needsLegacyFactoryNavigation(pathname) {
  return !LEGACY_STORE_PATH.test(String(pathname || '/'));
}
