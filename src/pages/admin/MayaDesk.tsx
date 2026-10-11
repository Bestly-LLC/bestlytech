/**
 * /admin/maya: Maya, Bestly's Sales & Service phone agent, (213) 641-0074 (support for every Bestly product, privacy requests, Bestly Agent demos).
 * She now runs on the agent template: this route renders AgentDesk with slug "maya". Her Sales and Service columns, TicketCard and
 * PrivacyCasePanel live in components/admin/maya/MayaTicketColumns.tsx and are shown by the template's "tickets" module.
 * Plans: docs/maya-desk-opusplan.md, docs/maya-desk-columns-opusplan.md, docs/agent-template-opusplan.md.
 */
import AgentDesk from "./AgentDesk";

export default function MayaDesk() {
  return <AgentDesk slug="maya" />;
}
