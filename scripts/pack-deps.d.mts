export function declaredDependencyNames(pkg: {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}): string[];
export function linkDeclaredDependencies(
  sourceRoot: string,
  destination: string,
  pkg: {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  },
): string[];
