-- Bestly Agent demo page (/agent): the recorder behind the five sample calls is a tool of Maya.
-- agent-demo-tts (service role only) turns the scripted lines in src/components/agentDemo/scenarios.ts into voice clips;
-- tools/agent-demo-audio/build.mjs stitches them into public/agent-demo/<id>.mp3 + .json. It runs only when someone
-- re-records the calls, so it has no schedule of its own. Line Check (maya-watch) is what watches the result: about
-- hourly it checks bestly.tech/agent, every sample call's sound and timeline file, and visitor-side audio failures,
-- and alerts under the existing maya.site key. Additive: a new tool card under Maya, nothing existing is changed
-- (team_onboard inserts the new slug; Maya's own card and her other tools are untouched).
select public.team_onboard('[{"slug":"agent-demo-tts","name":"Demo Voice","role":"Records the sample calls on the Bestly Agent page","tool_of":"maya","reports_to":"maya","runs_on":"cloud","schedule":"on demand, when the sample calls are re-recorded","what_it_does":"Maya and five made-up callers read the sample calls on bestly.tech/agent. This tool records each line in the right voice and keeps the word timing so the page can show the words as they are spoken. It only runs when the scripts change. Line Check tests the finished sound files about once an hour and tells Jared if any call is missing its sound.","pulse":{"gap":25,"job":"maya-watch","src":"cron"},"icon":"mic"}]'::jsonb);
