#!/usr/bin/env python3
"""Build the agent 1.6.2 release (Automation Fixer) from the live 1.6.1 release row, entirely in SQL, with no SSH.

  python3 build_fixer_release.py            -> writes fixer_1_6_2_block.min.py (the block with comments stripped, same behaviour)
                                               and prints the SQL to run (Supabase MCP execute_sql / SQL editor).
The SQL: take home_hub_agent_releases.source for 1.6.1, insert the block before `def do_homeassistant`, add the FIXER dispatch line
after the Automation Maker's, bump VERSION to 1.6.2, store it as a new release row (sha256 computed in the database), and refuses
to run if any anchor is not found exactly once. Then queue `agent.update` {version, sha256}: the agent downloads it, checks the hash,
compile()s it, keeps agent.py.prev, restarts, and launch.sh rolls back by itself if the new version will not start.
"""
import ast, hashlib, os, sys
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "fixer_1_6_2_block.py"), encoding="utf-8").read()
tree = ast.parse(src)
# drop the module docstring-ish comments by unparsing (comments are not part of the AST)
body = ast.unparse(tree)
header = "# Automation Fixer (agent 1.6.2): see docs/ha-fixer-opusplan.md\n"
block = header + body + "\n\n\n"
open(os.path.join(here, "fixer_1_6_2_block.min.py"), "w", encoding="utf-8").write(block)
if "$blk$" in block:
    sys.exit("block contains the SQL quote tag")
print("-- block md5", hashlib.md5(block.encode()).hexdigest(), "chars", len(block), file=sys.stderr)
sql = f"""do $$
declare
  v_src text; v_new text; v_def text := E'def do_homeassistant(cfg, action, payload):\\n';
  v_disp text := E'    if action in AUTOMATOR_ACTIONS:\\n        return do_ha_automator(ha, action, payload)\\n';
  v_block text := $blk${block}$blk$;
begin
  select source into v_src from public.home_hub_agent_releases where version = '1.6.1';
  if v_src is null then raise exception 'release 1.6.1 not found'; end if;
  if (length(v_src) - length(replace(v_src, v_def, ''))) / length(v_def) <> 1 then raise exception 'def anchor count is not 1'; end if;
  if (length(v_src) - length(replace(v_src, v_disp, ''))) / length(v_disp) <> 1 then raise exception 'dispatch anchor count is not 1'; end if;
  if (length(v_src) - length(replace(v_src, 'VERSION = "1.6.1"', ''))) / length('VERSION = "1.6.1"') <> 1 then raise exception 'version anchor count is not 1'; end if;
  v_new := replace(v_src, v_def, v_block || v_def);
  v_new := replace(v_new, v_disp, v_disp || E'    if action in FIXER_ACTIONS:\\n        return do_ha_fixer(ha, action, payload)\\n');
  v_new := replace(v_new, 'VERSION = "1.6.1"', 'VERSION = "1.6.2"');
  insert into public.home_hub_agent_releases (version, sha256, source, notes)
  values ('1.6.2', encode(sha256(convert_to(v_new, 'UTF8')), 'hex'), v_new,
          'Automation Fixer (Tinker): homeassistant.inventory, evidence (logbook, history, run traces, who mentions a device), item_edit, package_patch, package_restore. Every write backs up first and checks a fingerprint. Built over 1.6.1.');
end $$;
select version, sha256, length(source) len, md5(substring(source from position('# Automation Fixer (agent 1.6.2)' in source) for {len(block)})) block_md5 from public.home_hub_agent_releases where version = '1.6.2';
"""
open(os.path.join(here, "fixer_1_6_2_release.sql"), "w", encoding="utf-8").write(sql)
print(f"wrote fixer_1_6_2_block.min.py ({len(block)} chars) and fixer_1_6_2_release.sql ({len(sql)} chars)")
