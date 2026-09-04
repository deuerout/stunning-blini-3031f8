/**
 * Adapts Node's global fetch (available unmodified since Node 18) to the
 * minimal FetchLike interface used by emailProvider.ts / customerLookup.ts,
 * so those modules can be unit-tested against a hand-written fake instead
 * of hitting the network.
 */
import { FetchLike } from "./emailProvider";

export const nodeFetchAdapter: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json(),
  };
};
