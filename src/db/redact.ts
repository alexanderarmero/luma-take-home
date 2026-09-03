/**
 * Describes a database connection target without its credentials.
 *
 * Startup logs are the first place anyone looks when a service cannot reach
 * its database, and "which host am I even dialling" is the question they need
 * answered. Printing the connection string would answer it and leak the
 * password into every log aggregator that ever sees the line, so this returns
 * only the parts that are safe and useful.
 */
export function describeDatabaseUrl(raw: string): string {
  if (!raw?.trim()) return "(not set)";

  try {
    const url = new URL(raw);

    // A connection string with no host is not one we understand. `new URL`
    // happily parses "postgres:secret@host" as scheme + path, which would put
    // the password in the database slot and print it — so require a host
    // before trusting any of the parts.
    if (!url.hostname) return "(unparseable connection string)";

    const host = url.hostname;
    const port = url.port ? `:${url.port}` : "";
    const database = url.pathname.replace(/^\//, "") || "(no database)";
    const user = url.username ? `${url.username}@` : "";
    return `${user}${host}${port}/${database}`;
  } catch {
    // Never fall back to echoing the input: an unparseable string is exactly
    // the kind that might be a password with an odd character in it.
    return "(unparseable connection string)";
  }
}
