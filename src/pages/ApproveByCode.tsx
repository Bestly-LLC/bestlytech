/**
 * /y/:code - two kinds of approval share one short link. Ava's codes are made from an alphabet with no "i" (so they can't be misread),
 * and Insurance Filer's codes always start with "i": that first letter picks the page. Same door, same admin sign-in.
 */
import { useParams } from "react-router-dom";
import { lazyPage } from "@/lib/lazyPage";

const AvaApprove = lazyPage(() => import("./AvaApprove"));
const InsuranceApprove = lazyPage(() => import("./InsuranceApprove"));

export default function ApproveByCode() {
  const { code = "" } = useParams();
  return code.toLowerCase().startsWith("i") ? <InsuranceApprove /> : <AvaApprove />;
}
