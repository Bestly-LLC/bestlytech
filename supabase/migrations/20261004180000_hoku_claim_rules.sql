-- HOKU claim rules (2026-10-04). HOKU posts are now written fresh each day by the Pi (hoku_maker) and go straight to
-- Instagram with no review, so its claim gate needs real rules. Source: hoku-clean/social/README.md claim rules
-- ("No kill / disinfect / treat / first / only / dermatologist-tested; nothing about surfaces; 'Air never gets back in',
-- not 'Nothing gets in'") and bestly_memory hoku/product-and-label (keep claims conservative; HOCl is not chlorine;
-- strength must come from the filler, never guessed). hoku_maker treats soft hits as blocks too.
insert into public.claim_rules (client_slug, severity, pattern, label, active, notes) values
 ('hoku','hard','(kills?|killing|disinfect\w*|sanitiz\w*|steriliz\w*)','kill or disinfect claim',true,'A face mist post must not claim to kill or disinfect anything.'),
 ('hoku','hard','(treats?|treating|treatment|cures?|curing|heals?|healing|remed(y|ies)|soothes? (acne|eczema|rash\w*))','treatment claim',true,null),
 ('hoku','hard','(acne|eczema|rosacea|psoriasis|dermatitis|infections?|wounds?|rash(es)?|breakouts?|blemish\w*)','skin condition claim',true,null),
 ('hoku','hard','(bacteri\w*|germs?|microb\w*|virus\w*|pathogens?|antibacterial|antimicrobial|antiviral)','germ claim',true,null),
 ('hoku','hard','(dermatologists?|doctors?|clinically|clinical)[- ]?(tested|approved|recommended|proven|grade)?','endorsement claim',true,null),
 ('hoku','hard','(the )?(first|only) (face|facial|mist|spray|hocl|product|brand)','first or only claim',true,null),
 ('hoku','hard','(surfaces?|countertops?|cutting boards?|cleaning products?)','surface use',true,'HOKU is a face mist; nothing about surfaces.'),
 ('hoku','hard','nothing (ever )?(gets|can get|goes) (back )?in','seal overclaim',true,'Say "Air never gets back in", not "Nothing gets in".'),
 ('hoku','hard','(chemical[- ]free|non[- ]?toxic|organic|all[- ]natural|100 ?%)','purity claim',true,null),
 ('hoku','hard','((safe for (everyone|all|babies|kids|children|pets|eyes))|completely safe|totally safe|perfectly safe)','safety overclaim',true,null),
 ('hoku','hard','(anti[- ]?aging|wrinkles?|collagen|clears? (up )?(your )?skin)','beauty result claim',true,null),
 ('hoku','hard','(chlorine|bleach)','chlorine comparison',true,'HOCl is not chlorine; do not invite the comparison.'),
 ('hoku','hard','[0-9]+ ?ppm','strength number',true,'The real strength must come from the filler, never guessed.'),
 ('hoku','hard','(fda|epa)[- ]?(approved|registered|cleared)','regulatory claim',true,null),
 ('hoku','soft','(hydrat\w*|moisturiz\w*|glow\w*|pure)','skin benefit wording',true,'Blocked by hoku_maker (no review step).');
