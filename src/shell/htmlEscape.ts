/**
 * HTML escaping for the console's own documents (failure pages, the gateway dialog).
 *
 * Every one of these pages interpolates user-typed text - gateway names, URLs, log tails -
 * into an attribute or a text node, and the whole document is *also* percent-encoded for
 * its `data:` URL. That is why only HTML escaping happens here: a second URL-encode on a
 * value would make the address field read back as `http%3A%2F%2F…` and fail validation.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
