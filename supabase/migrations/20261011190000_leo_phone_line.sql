-- Leo got his own line (Telnyx, imported to ElevenLabs as "Leo (Turo guest line)", assigned to Leo).
-- The admin reads line_e164 from the registry, so his page showed "Web only, no phone number".
update public.voice_agents
   set line_e164 = '+13106227052',
       phone_number_id = 'phnum_6901m4mwnrfxfpasv68erkzh97af',
       updated_at = now()
 where slug = 'leo';
