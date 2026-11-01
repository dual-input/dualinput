/**
 * Joins class names, dropping what's empty. It merges nothing: a component's look comes from its
 * props, and a caller's class only adds what the component leaves open, such as a width or a margin,
 * since two classes setting one property win by their order in the stylesheet, not here.
 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ")
}
