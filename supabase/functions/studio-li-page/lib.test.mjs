import assert from "node:assert/strict";
import * as L from "./lib.ts";
assert.equal(L.orgIdFromUrn("urn:li:organization:123"), "123");
assert.equal(L.orgIdFromUrn("urn:li:person:abc"), null);
assert.equal(L.orgIdFromUrn(undefined), null);
assert.equal(L.orgUrn("42"), "urn:li:organization:42");
const acls = { elements: [
  { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:1" },
  { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:1" },
  { role: "ADMINISTRATOR", state: "REQUESTED", organization: "urn:li:organization:2" },
  { role: "CONTENT_ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:3" },
  { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organizationBrand:4" },
  { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:5" } ] };
assert.deepEqual(L.adminOrgIds(acls), ["1", "5"]);
assert.deepEqual(L.adminOrgIds(null), []);
assert.deepEqual(L.pickerList([{ id: "1", name: "A", access_token: "SECRET" }]), [{ id: "1", name: "A" }]);
assert.equal(L.grantedAllowsPosting("openid profile w_organization_social", ""), true);
assert.equal(L.grantedAllowsPosting("openid profile w_member_social", ""), false);
assert.equal(L.grantedAllowsPosting(undefined, L.LIP_SCOPES), true);
assert.equal(L.pageName({ localizedName: " Centering YOU " }, "9"), "Centering YOU");
assert.equal(L.pageName({}, "9"), "LinkedIn Page 9");
console.log("lib ok");
