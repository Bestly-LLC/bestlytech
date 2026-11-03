// Pure helpers for LinkedIn Page connect (no I/O) — unit tested in lib.test.mjs
export const LIP_REDIRECT = "https://www.bestly.tech/connect/linkedin-page.html";
export const LIP_SCOPES = "openid profile w_organization_social r_organization_social rw_organization_admin";
export const LIP_REQUIRED = ["w_organization_social"];

export type PageChoice = { id: string; name: string };

// "urn:li:organization:12345" -> "12345" (null if it is not an organization urn)
export function orgIdFromUrn(urn: unknown): string | null {
  const m = String(urn ?? "").match(/^urn:li:organization:(\d+)$/);
  return m ? m[1] : null;
}
export const orgUrn = (id: string) => "urn:li:organization:" + id;

// organizationAcls response -> unique ADMINISTRATOR + APPROVED organization ids (max 25)
export function adminOrgIds(acls: { elements?: any[] } | null | undefined): string[] {
  const out: string[] = [];
  for (const e of acls?.elements ?? []) {
    if (e?.role !== "ADMINISTRATOR" || e?.state !== "APPROVED") continue;
    const id = orgIdFromUrn(e.organization);
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 25);
}

// plain-words picker list (names only, never tokens)
export function pickerList(orgs: { id: string; name: string }[]): PageChoice[] {
  return orgs.map((o) => ({ id: o.id, name: o.name }));
}

// scopes LinkedIn actually granted -> do we have what posting needs?
export function grantedAllowsPosting(scope: unknown, fallback: string): boolean {
  const have = new Set(String(scope ?? fallback).split(/[,\s]+/).filter(Boolean));
  return LIP_REQUIRED.every((s) => have.has(s));
}

export function pageName(o: { localizedName?: unknown; vanityName?: unknown } | null | undefined, id: string): string {
  return String(o?.localizedName ?? o?.vanityName ?? "").trim() || "LinkedIn Page " + id;
}
