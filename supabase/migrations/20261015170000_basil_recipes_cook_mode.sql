-- Basil recipes + cook mode (Oct 14 2026). Jared: "add a button to redo the suggested items. Also I need to be able to
-- open the recipe and when I can use my Tokit Omni Cook, having the recipe with the ingredients bolded as you go and
-- with the oz. or tsp for each next to the bold ingredient."
--
-- pantry_recipes gets full recipes: serves, minutes, ingredients (k, name, amt, omni_amt, m = pantry regex, opt),
-- steps [{t, timer}] and, where the Omni Cook genuinely helps, omni_steps [{t, timer, omni:{mode, f, c, min, speed, rev}}].
-- Step text marks ingredients as {k} (full amount) or {k|amount} (part of it); the page bolds them with the amount.
-- Omni Cook settings are a starting guide typed for the Tokit (not connected to Home Assistant yet); safety
-- temperatures are in the steps (chicken 165°F, salmon 145°F, shrimp pink and opaque, chili reheated to a boil).
-- New: pantry_dinner_ideas_ex (minutes, serves, omni), basil_kitchen_ideas (the "New ideas" button), basil_kitchen_recipe.

alter table public.pantry_recipes
  add column if not exists serves int,
  add column if not exists minutes int,
  add column if not exists ingredients jsonb not null default '[]'::jsonb,
  add column if not exists steps jsonb not null default '[]'::jsonb,
  add column if not exists omni_steps jsonb,
  add column if not exists omni_note text;

-- 1 Avocado toast with a fried egg
update pantry_recipes set serves = 1, minutes = 10, ingredients = $j$[
 {"k":"bread","name":"Dave's Killer Bread","amt":"2 slices","m":"killer bread"},
 {"k":"avocado","name":"avocado","amt":"1","m":"avocado"},
 {"k":"lemon","name":"lemon juice","amt":"1 tsp","m":"lemon"},
 {"k":"salt","name":"salt","amt":"1/4 tsp"},
 {"k":"butter","name":"butter","amt":"1 tsp","m":"butter"},
 {"k":"egg","name":"egg","amt":"1","m":"^eggs$"},
 {"k":"sriracha","name":"sriracha","amt":"1 tsp","m":"sriracha"}]$j$, steps = $j$[
 {"t":"Toast the {bread}."},
 {"t":"Mash the {avocado} with {lemon} and {salt}."},
 {"t":"Melt {butter} in a nonstick pan over medium heat. Crack in the {egg} and cook until the white is set, about 3 minutes.","timer":3},
 {"t":"Spread the avocado on the toast, top with the egg and a drizzle of {sriracha}."}]$j$
where name = 'Avocado toast with a fried egg';

-- 2 Bean and cheese rice bowl
update pantry_recipes set serves = 2, minutes = 25, ingredients = $j$[
 {"k":"rice","name":"jasmine rice","amt":"1 cup","m":"(^| )rice($| \\()"},
 {"k":"water","name":"water","amt":"1 1/4 cups","omni_amt":"4 cups"},
 {"k":"salt","name":"salt","amt":"1/2 tsp"},
 {"k":"beans","name":"refried beans","amt":"1 can (16 oz)","m":"refried beans"},
 {"k":"cheese","name":"Mexican cheese","amt":"1/2 cup","m":"mexican.*cheese"},
 {"k":"sauce","name":"Taco Bell mild sauce","amt":"2 tbsp","m":"taco bell"}]$j$, steps = $j$[
 {"t":"Rinse the {rice}, then add it to a pot with {water} and {salt}. Bring to a boil, cover, and cook on low for 15 minutes.","timer":15},
 {"t":"Take the rice off the heat and let it rest, covered, for 5 minutes.","timer":5},
 {"t":"Warm the {beans} in a small pot over medium-low, stirring, about 5 minutes.","timer":5},
 {"t":"Fill bowls with rice and beans, top with {cheese} and {sauce}."}]$j$, omni_steps = $j$[
 {"t":"Pour {water} into the bowl. Rinse the {rice}, put it in the steaming basket and set it in the bowl.","omni":{"mode":"Steam","f":212,"c":100,"min":20,"speed":"4"},"timer":20},
 {"t":"Lift out the basket and pour out the water. Add the {beans} and {salt} to the empty bowl.","omni":{"mode":"Cook","f":194,"c":90,"min":5,"speed":"2"},"timer":5},
 {"t":"Fill bowls with rice and beans, top with {cheese} and {sauce}."}]$j$
where name = 'Bean and cheese rice bowl';

-- 3 Buffalo chicken melt
update pantry_recipes set serves = 1, minutes = 15, ingredients = $j$[
 {"k":"chicken","name":"rotisserie chicken, shredded","amt":"1 cup","m":"rotisserie"},
 {"k":"buffalo","name":"buffalo wing sauce","amt":"2 tbsp","m":"buffalo"},
 {"k":"butter","name":"butter","amt":"1 tbsp","m":"butter"},
 {"k":"bread","name":"Dave's Killer Bread","amt":"2 slices","m":"killer bread"},
 {"k":"mozzarella","name":"mozzarella","amt":"1/3 cup","m":"mozzarella"},
 {"k":"ranch","name":"ranch","amt":"2 tbsp","m":"ranch"}]$j$, steps = $j$[
 {"t":"Toss the {chicken} with {buffalo}."},
 {"t":"Spread {butter} on one side of each slice of {bread}."},
 {"t":"Build it butter side out: bread, chicken, {mozzarella}, bread."},
 {"t":"Cook in a pan over medium until golden and melty, 3 to 4 minutes per side.","timer":4},
 {"t":"Cut in half and dip in {ranch}."}]$j$
where name = 'Buffalo chicken melt';

-- 4 Chicken Caesar sandwich
update pantry_recipes set serves = 1, minutes = 10, ingredients = $j$[
 {"k":"bread","name":"Dave's Killer Bread","amt":"2 slices","m":"killer bread"},
 {"k":"chicken","name":"rotisserie chicken, shredded","amt":"1 cup","m":"rotisserie"},
 {"k":"caesar","name":"Caesar dressing","amt":"2 tbsp","m":"caesar"},
 {"k":"parmesan","name":"parmesan","amt":"2 tbsp","m":"parmesan"}]$j$, steps = $j$[
 {"t":"Toast the {bread}."},
 {"t":"Toss the {chicken} with {caesar} and {parmesan}."},
 {"t":"Pile the chicken on the toast and close it up."}]$j$
where name = 'Chicken Caesar sandwich';

-- 5 Chili cheese rice bowl
update pantry_recipes set serves = 2, minutes = 25, ingredients = $j$[
 {"k":"rice","name":"jasmine rice","amt":"1 cup","m":"(^| )rice($| \\()"},
 {"k":"water","name":"water","amt":"1 1/4 cups","omni_amt":"4 cups"},
 {"k":"chili","name":"Kirkland beef chili","amt":"2 cups","m":"beef chili"},
 {"k":"cheese","name":"Mexican cheese","amt":"1/2 cup","m":"mexican.*cheese"},
 {"k":"avocado","name":"avocado, sliced","amt":"1/2","m":"avocado","opt":true}]$j$, steps = $j$[
 {"t":"Rinse the {rice}, then add it to a pot with {water}. Bring to a boil, cover, and cook on low for 15 minutes.","timer":15},
 {"t":"Heat the {chili} in a pot over medium, stirring, until it bubbles all over, about 6 minutes.","timer":6},
 {"t":"Spoon chili over the rice, top with {cheese} and the {avocado} if you have one."}]$j$, omni_steps = $j$[
 {"t":"Pour {water} into the bowl. Rinse the {rice}, put it in the steaming basket and set it in the bowl.","omni":{"mode":"Steam","f":212,"c":100,"min":20,"speed":"4"},"timer":20},
 {"t":"Lift out the basket and pour out the water. Add the {chili} to the empty bowl.","omni":{"mode":"Cook","f":212,"c":100,"min":6,"speed":"1","rev":true},"timer":6},
 {"t":"Spoon chili over the rice, top with {cheese} and the {avocado} if you have one."}]$j$
where name = 'Chili cheese rice bowl';

-- 6 Coconut garlic shrimp
update pantry_recipes set serves = 2, minutes = 30, ingredients = $j$[
 {"k":"shrimp","name":"shrimp","amt":"12 oz","m":"shrimp"},
 {"k":"rice","name":"jasmine rice","amt":"1 cup","m":"(^| )rice($| \\()"},
 {"k":"water","name":"water","amt":"1 1/4 cups"},
 {"k":"garlic","name":"minced garlic","amt":"1 tbsp","m":"minced garlic"},
 {"k":"coconut","name":"coconut milk","amt":"1 can (13.5 oz)","m":"coconut milk"},
 {"k":"fish","name":"fish sauce","amt":"1 tbsp","m":"fish sauce"}]$j$, steps = $j$[
 {"t":"Thaw the {shrimp} in a bowl of cold water for 10 minutes, then drain.","timer":10},
 {"t":"Rinse the {rice}, add it to a pot with {water}. Bring to a boil, cover, and cook on low for 15 minutes.","timer":15},
 {"t":"In a skillet over medium, warm {garlic} in {coconut|2 tbsp} of the coconut milk for 1 minute.","timer":1},
 {"t":"Add the rest of the {coconut} and the {fish}. Simmer 5 minutes.","timer":5},
 {"t":"Add the shrimp and simmer until pink and opaque all the way through, 3 to 4 minutes.","timer":4},
 {"t":"Serve the shrimp and sauce over the rice."}]$j$, omni_steps = $j$[
 {"t":"Thaw the {shrimp} in a bowl of cold water for 10 minutes, then drain. Start the {rice} on the stove with {water}: boil, cover, low for 15 minutes.","timer":10},
 {"t":"Add {garlic} and {coconut|2 tbsp} of the coconut milk to the bowl.","omni":{"mode":"Saute","f":248,"c":120,"min":2,"speed":"1"},"timer":2},
 {"t":"Add the rest of the {coconut} and the {fish}.","omni":{"mode":"Cook","f":212,"c":100,"min":5,"speed":"1"},"timer":5},
 {"t":"Add the shrimp. Reverse keeps them whole. Check they are pink and opaque all the way through.","omni":{"mode":"Cook","f":203,"c":95,"min":4,"speed":"1","rev":true},"timer":4},
 {"t":"Serve the shrimp and sauce over the rice."}]$j$
where name = 'Coconut garlic shrimp';

-- 7 Crispy chicken sandwich
update pantry_recipes set serves = 1, minutes = 15, ingredients = $j$[
 {"k":"chicken","name":"breaded chicken","amt":"1 piece","m":"breaded"},
 {"k":"bread","name":"Dave's Killer Bread","amt":"2 slices","m":"killer bread"},
 {"k":"ranch","name":"ranch","amt":"1 tbsp","m":"ranch"}]$j$, steps = $j$[
 {"t":"Air-fry the {chicken} at 400°F, flipping halfway, until hot all the way through (165°F inside), 10 to 12 minutes.","timer":11},
 {"t":"Toast the {bread}."},
 {"t":"Spread {ranch} on the toast and add the chicken."}]$j$
where name = 'Crispy chicken sandwich';

-- 8 Easy lasagna
update pantry_recipes set serves = 4, minutes = 75, ingredients = $j$[
 {"k":"noodles","name":"lasagna noodles","amt":"9 sheets","m":"lasagna"},
 {"k":"sauce","name":"tomato sauce","amt":"3 cans (15 oz each)","m":"tomato sauce"},
 {"k":"garlic","name":"minced garlic","amt":"1 tsp","m":"minced garlic","opt":true},
 {"k":"cream","name":"cream cheese","amt":"8 oz","m":"cream cheese"},
 {"k":"mozzarella","name":"mozzarella","amt":"2 cups","m":"mozzarella"},
 {"k":"parmesan","name":"parmesan","amt":"1/2 cup","m":"parmesan"}]$j$, steps = $j$[
 {"t":"Heat the oven to 375°F."},
 {"t":"Cook the {noodles} as the box says, until just bendable. Drain."},
 {"t":"Stir the {garlic} into the {sauce}."},
 {"t":"In a 9 by 13 dish: a thin layer of sauce, 3 noodles, small spoonfuls of {cream|a third}, a handful of {mozzarella|a third}. Repeat twice."},
 {"t":"Finish with sauce and the {parmesan}. Cover with foil and bake 30 minutes.","timer":30},
 {"t":"Uncover and bake until bubbly, about 15 minutes more.","timer":15},
 {"t":"Let it rest 10 minutes before cutting.","timer":10}]$j$
where name = 'Easy lasagna';

-- 9 Falafel bowl
update pantry_recipes set serves = 2, minutes = 25, ingredients = $j$[
 {"k":"falafel","name":"falafel","amt":"8 pieces","m":"falafel"},
 {"k":"rice","name":"jasmine rice","amt":"1 cup","m":"(^| )rice($| \\()"},
 {"k":"water","name":"water","amt":"1 1/4 cups","omni_amt":"4 cups"},
 {"k":"yogurt","name":"Greek yogurt","amt":"1/2 cup","m":"greek yogurt"},
 {"k":"lemon","name":"lemon juice","amt":"1 tbsp","m":"lemon"},
 {"k":"garlic","name":"minced garlic","amt":"1/2 tsp","m":"minced garlic"},
 {"k":"salt","name":"salt","amt":"1/4 tsp"}]$j$, steps = $j$[
 {"t":"Bake or air-fry the {falafel} at 400°F until crisp and hot, 12 to 15 minutes.","timer":13},
 {"t":"Rinse the {rice}, add it to a pot with {water}. Bring to a boil, cover, and cook on low for 15 minutes.","timer":15},
 {"t":"Stir {yogurt}, {lemon}, {garlic} and {salt} together for the sauce."},
 {"t":"Fill bowls with rice and falafel, spoon the sauce over."}]$j$, omni_steps = $j$[
 {"t":"Bake or air-fry the {falafel} at 400°F until crisp and hot, 12 to 15 minutes.","timer":13},
 {"t":"Pour {water} into the bowl. Rinse the {rice}, put it in the steaming basket and set it in the bowl.","omni":{"mode":"Steam","f":212,"c":100,"min":20,"speed":"4"},"timer":20},
 {"t":"Stir {yogurt}, {lemon}, {garlic} and {salt} together for the sauce."},
 {"t":"Fill bowls with rice and falafel, spoon the sauce over."}]$j$
where name = 'Falafel bowl';

-- 10 Garlic parmesan spaghetti
update pantry_recipes set serves = 2, minutes = 20, ingredients = $j$[
 {"k":"spaghetti","name":"spaghetti","amt":"8 oz","m":"spaghetti"},
 {"k":"salt","name":"salt","amt":"1 tbsp"},
 {"k":"oil","name":"olive oil","amt":"2 tbsp","m":"olive oil"},
 {"k":"garlic","name":"minced garlic","amt":"1 tbsp","m":"minced garlic"},
 {"k":"sauce","name":"tomato sauce","amt":"1 can (15 oz)","m":"tomato sauce"},
 {"k":"parmesan","name":"parmesan","amt":"1/2 cup","m":"parmesan"}]$j$, steps = $j$[
 {"t":"Boil a big pot of water with {salt}. Cook the {spaghetti} as the box says, about 10 minutes. Save 1/2 cup of the pasta water, then drain.","timer":10},
 {"t":"Meanwhile, warm {oil} in a pan over medium. Add {garlic} and stir until it smells good, about 1 minute.","timer":1},
 {"t":"Add the {sauce} and simmer 5 minutes.","timer":5},
 {"t":"Toss in the pasta with a splash of pasta water and the {parmesan}."}]$j$, omni_steps = $j$[
 {"t":"Boil a big pot of water with {salt} on the stove. Cook the {spaghetti} as the box says, about 10 minutes. Save 1/2 cup of the pasta water.","timer":10},
 {"t":"Meanwhile, add {oil} and {garlic} to the bowl.","omni":{"mode":"Saute","f":248,"c":120,"min":2,"speed":"1"},"timer":2},
 {"t":"Add the {sauce}.","omni":{"mode":"Cook","f":212,"c":100,"min":5,"speed":"1"},"timer":5},
 {"t":"Toss the drained pasta with the sauce, a splash of pasta water and the {parmesan}."}]$j$
where name = 'Garlic parmesan spaghetti';

-- 11 Kimchi rice with a fried egg
update pantry_recipes set serves = 1, minutes = 8, ingredients = $j$[
 {"k":"rice","name":"kimchi rice packet","amt":"1","m":"kimchi rice"},
 {"k":"butter","name":"butter","amt":"1 tsp","m":"butter"},
 {"k":"egg","name":"egg","amt":"1","m":"^eggs$"},
 {"k":"seaweed","name":"roasted seaweed","amt":"1 pack","m":"seaweed"}]$j$, steps = $j$[
 {"t":"Microwave the {rice} as the packet says, about 90 seconds."},
 {"t":"Melt {butter} in a pan over medium and fry the {egg} until the white is set, about 3 minutes.","timer":3},
 {"t":"Slide the egg onto the rice and crumble the {seaweed} on top."}]$j$
where name = 'Kimchi rice with a fried egg';

-- 12 Pizza pasta
update pantry_recipes set serves = 2, minutes = 25, ingredients = $j$[
 {"k":"spaghetti","name":"spaghetti","amt":"8 oz","m":"spaghetti"},
 {"k":"salt","name":"salt","amt":"1 tbsp"},
 {"k":"sauce","name":"tomato sauce","amt":"1 can (15 oz)","m":"tomato sauce"},
 {"k":"mozzarella","name":"mozzarella","amt":"1 cup","m":"mozzarella"},
 {"k":"pepperoni","name":"pepperoni","amt":"1/2 cup","m":"pepperoni"}]$j$, steps = $j$[
 {"t":"Boil a big pot of water with {salt}. Cook the {spaghetti} as the box says, about 10 minutes, then drain.","timer":10},
 {"t":"Warm the {sauce} in the pot for 3 minutes and toss the pasta back in.","timer":3},
 {"t":"Pour into an oven-safe dish and cover with {mozzarella} and {pepperoni}."},
 {"t":"Broil on high until the cheese bubbles, about 3 minutes. Watch it closely.","timer":3}]$j$
where name = 'Pizza pasta';

-- 13 Protein pancakes and sausage
update pantry_recipes set serves = 2, minutes = 20, ingredients = $j$[
 {"k":"sausage","name":"sausage patties","amt":"4","m":"sausage"},
 {"k":"mix","name":"Kodiak pancake mix","amt":"1 cup","m":"kodiak"},
 {"k":"water","name":"water","amt":"1 cup"},
 {"k":"butter","name":"butter","amt":"1 tbsp","m":"butter"},
 {"k":"maple","name":"maple syrup","amt":"1/4 cup","m":"maple"}]$j$, steps = $j$[
 {"t":"Cook the {sausage} in a skillet over medium until 160°F inside, 4 to 5 minutes per side.","timer":5},
 {"t":"Whisk the {mix} with {water} until just combined. A few lumps are fine."},
 {"t":"Melt {butter} on a griddle over medium. Pour 1/4 cup of batter per pancake. Flip when bubbles form, about 2 minutes per side.","timer":2},
 {"t":"Serve with {maple}."}]$j$, omni_steps = $j$[
 {"t":"Cook the {sausage} in a skillet over medium until 160°F inside, 4 to 5 minutes per side.","timer":5},
 {"t":"Add the {mix} and {water} to the bowl. No heat.","omni":{"mode":"Mix","min":0.25,"speed":"4"}},
 {"t":"Melt {butter} on a griddle over medium. Pour 1/4 cup of batter per pancake. Flip when bubbles form, about 2 minutes per side.","timer":2},
 {"t":"Serve with {maple}."}]$j$
where name = 'Protein pancakes and sausage';

-- 14 Rotisserie chicken avocado bowl
update pantry_recipes set serves = 2, minutes = 20, ingredients = $j$[
 {"k":"rice","name":"jasmine rice","amt":"1 cup","m":"(^| )rice($| \\()"},
 {"k":"water","name":"water","amt":"1 1/4 cups","omni_amt":"4 cups"},
 {"k":"chicken","name":"rotisserie chicken","amt":"2 cups","m":"rotisserie"},
 {"k":"avocado","name":"avocado","amt":"1","m":"avocado"},
 {"k":"dressing","name":"sesame dressing","amt":"3 tbsp","m":"sesame dressing"},
 {"k":"seaweed","name":"roasted seaweed","amt":"1 pack","m":"seaweed","opt":true}]$j$, steps = $j$[
 {"t":"Rinse the {rice}, add it to a pot with {water}. Bring to a boil, cover, and cook on low for 15 minutes.","timer":15},
 {"t":"Pull the {chicken} into bite-size pieces and warm it in the microwave for 1 minute."},
 {"t":"Slice the {avocado}."},
 {"t":"Fill bowls with rice, chicken and avocado. Drizzle {dressing} and crumble the {seaweed} on top."}]$j$, omni_steps = $j$[
 {"t":"Pour {water} into the bowl. Rinse the {rice}, put it in the steaming basket and set it in the bowl.","omni":{"mode":"Steam","f":212,"c":100,"min":20,"speed":"4"},"timer":20},
 {"t":"Pull the {chicken} into bite-size pieces and warm it in the microwave for 1 minute."},
 {"t":"Slice the {avocado}."},
 {"t":"Fill bowls with rice, chicken and avocado. Drizzle {dressing} and crumble the {seaweed} on top."}]$j$
where name = 'Rotisserie chicken avocado bowl';

-- 15 Shrimp fried rice
update pantry_recipes set serves = 2, minutes = 25, ingredients = $j$[
 {"k":"shrimp","name":"shrimp","amt":"8 oz","m":"shrimp"},
 {"k":"oil","name":"olive oil","amt":"1 tbsp","m":"olive oil"},
 {"k":"eggs","name":"eggs","amt":"2","m":"^eggs$"},
 {"k":"garlic","name":"minced garlic","amt":"1 tsp","m":"minced garlic"},
 {"k":"rice","name":"cooked rice, cold is best","amt":"2 cups","m":"(^| )rice($| \\()"},
 {"k":"soy","name":"soy sauce","amt":"2 tbsp","m":"soy sauce"},
 {"k":"sesame","name":"toasted sesame oil","amt":"1 tsp","m":"sesame oil"}]$j$, steps = $j$[
 {"t":"Thaw the {shrimp} in cold water for 10 minutes, then pat dry.","timer":10},
 {"t":"Heat {oil} in a big skillet over medium-high. Cook the shrimp until pink, 2 to 3 minutes, then set aside.","timer":3},
 {"t":"Scramble the {eggs} in the same pan, about 1 minute, then set aside.","timer":1},
 {"t":"Add {garlic} for 30 seconds, then the {rice}. Press it flat and let it crisp for 3 minutes.","timer":3},
 {"t":"Stir in {soy}, the shrimp and eggs. Finish with {sesame}."}]$j$
where name = 'Shrimp fried rice';

-- 16 Sweet chili salmon and rice
update pantry_recipes set serves = 2, minutes = 30, ingredients = $j$[
 {"k":"salmon","name":"salmon fillets, thawed","amt":"2 (about 12 oz)","m":"salmon"},
 {"k":"rice","name":"jasmine rice","amt":"1 cup","m":"(^| )rice($| \\()"},
 {"k":"water","name":"water","amt":"1 1/4 cups","omni_amt":"4 cups"},
 {"k":"salt","name":"salt","amt":"1/4 tsp"},
 {"k":"chili","name":"sweet chili sauce","amt":"3 tbsp","m":"sweet chili"}]$j$, steps = $j$[
 {"t":"Heat the oven to 400°F. If the {salmon} is frozen, thaw it in the fridge overnight or sealed in cold water for 30 minutes."},
 {"t":"Rinse the {rice}, add it to a pot with {water}. Bring to a boil, cover, and cook on low for 15 minutes.","timer":15},
 {"t":"Put the salmon on a lined sheet, sprinkle with {salt} and brush with {chili|half}. Roast until it flakes and reads 145°F, about 12 minutes.","timer":12},
 {"t":"Brush on the rest of the {chili} and serve over the rice."}]$j$, omni_steps = $j$[
 {"t":"Pour {water} into the bowl. Rinse the {rice}, put it in the steaming basket and set it in the bowl."},
 {"t":"Season the thawed {salmon} with {salt}, lay it in the steaming tray and set the tray on top. Check it flakes and reads 145°F.","omni":{"mode":"Steam","f":212,"c":100,"min":20,"speed":"4"},"timer":20},
 {"t":"Brush the salmon with {chili} and serve over the rice."}]$j$
where name = 'Sweet chili salmon and rice';

update pantry_recipes set omni_note = 'Omni Cook settings are a starting guide. Pick the closest mode on your Omni Cook and check doneness.'
where omni_steps is not null;

-- Dinner ideas with the extra detail the page shows; p_skip hides what is already on screen.
create or replace function public.pantry_dinner_ideas_ex(p_limit int default 3, p_skip text[] default '{}')
returns table(name text, how text, uses_soon int, minutes int, serves int, omni boolean)
language sql stable security definer set search_path = public as $$
  select r.name, r.how,
    (select count(*)::int from pantry_items p where p.status in ('have','low') and (p.use_soon or p.use_by <= current_date + 1)
       and exists (select 1 from unnest(r.needs) n where p.name ~* n)) as uses_soon,
    r.minutes, r.serves, r.omni_steps is not null
  from pantry_recipes r
  where r.active and not (r.name = any(coalesce(p_skip, '{}')))
    and not exists (select 1 from unnest(r.needs) n
                    where not exists (select 1 from pantry_items p where p.status in ('have','low') and p.name ~* n))
  order by 3 desc, random()
  limit p_limit;
$$;
revoke all on function public.pantry_dinner_ideas_ex(int, text[]) from public, anon, authenticated;

-- "New ideas": three you can make that are not on screen; tops up from the rest when fewer than three are left.
create or replace function public.basil_kitchen_ideas(p_skip text[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare fresh jsonb; topup jsonb; total int;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select count(*) into total from pantry_dinner_ideas_ex(1000);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into fresh from pantry_dinner_ideas_ex(3, p_skip) x;
  if jsonb_array_length(fresh) < 3 then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into topup
      from pantry_dinner_ideas_ex(3 - jsonb_array_length(fresh),
             array(select f->>'name' from jsonb_array_elements(fresh) f)) x;
    fresh := fresh || topup;
  end if;
  return jsonb_build_object('ideas', fresh, 'total', total);
end $$;
revoke all on function public.basil_kitchen_ideas(text[]) from public, anon;
grant execute on function public.basil_kitchen_ideas(text[]) to authenticated;

-- One recipe with every ingredient checked against the pantry.
create or replace function public.basil_kitchen_recipe(p_name text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r pantry_recipes;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into r from pantry_recipes where name = p_name;
  if not found then raise exception 'recipe not found'; end if;
  return jsonb_build_object(
    'name', r.name, 'how', r.how, 'serves', r.serves, 'minutes', r.minutes, 'omni_note', r.omni_note,
    'steps', r.steps, 'omni_steps', r.omni_steps,
    'ingredients', coalesce((
      select jsonb_agg(e.i || jsonb_build_object('item', p.name, 'item_id', p.id, 'status', p.status) order by e.o)
      from jsonb_array_elements(r.ingredients) with ordinality e(i, o)
      left join lateral (
        select x.id, x.name, x.status from pantry_items x
        where e.i ? 'm' and x.name ~* (e.i->>'m')
        order by (x.status in ('have', 'low')) desc, x.use_soon desc, length(x.name)
        limit 1) p on true), '[]'::jsonb));
end $$;
revoke all on function public.basil_kitchen_recipe(text) from public, anon;
grant execute on function public.basil_kitchen_recipe(text) to authenticated;

-- The page's first load carries the richer ideas too.
do $$
declare d text := pg_get_functiondef('public.basil_kitchen()'::regprocedure);
begin
  if d ~ 'pantry_dinner_ideas_ex' then return; end if;
  d := replace(d, $o$'ideas', coalesce((select jsonb_agg(to_jsonb(x)) from pantry_dinner_ideas(3) x), '[]'::jsonb),$o$,
                  $n$'ideas', coalesce((select jsonb_agg(to_jsonb(x)) from pantry_dinner_ideas_ex(3) x), '[]'::jsonb),
    'ideas_total', (select count(*) from pantry_dinner_ideas_ex(1000)),$n$);
  if d !~ 'pantry_dinner_ideas_ex' then raise exception 'basil_kitchen patch incomplete'; end if;
  execute d;
end $$;

-- Copy fixes after the first preview: a bolded ingredient is followed by its amount, so "of the coconut milk" /
-- "the rest of the" after a token read twice. The token's amount says it instead.
update pantry_recipes set
  steps = replace(replace(replace(replace(replace(steps::text,
            'warm {garlic} in {coconut|2 tbsp} of the coconut milk for 1 minute', 'warm {garlic} in {coconut|2 tbsp} for 1 minute'),
            'Add the rest of the {coconut} and the {fish}', 'Add the {coconut|rest of the can} and the {fish}'),
            'Add the rest of the {coconut|the rest} and the {fish}', 'Add the {coconut|rest of the can} and the {fish}'),
            'Brush on the rest of the {chili}', 'Brush on the {chili|the rest}'),
            'Brush on the rest of the {chili|the rest}', 'Brush on the {chili|the rest}')::jsonb,
  omni_steps = case when omni_steps is null then null else replace(replace(replace(omni_steps::text,
            'Add {garlic} and {coconut|2 tbsp} of the coconut milk to the bowl.', 'Add {garlic} and {coconut|2 tbsp} to the bowl.'),
            'Add the rest of the {coconut} and the {fish}', 'Add the {coconut|rest of the can} and the {fish}'),
            'Add the rest of the {coconut|the rest} and the {fish}', 'Add the {coconut|rest of the can} and the {fish}')::jsonb end
where name in ('Coconut garlic shrimp', 'Sweet chili salmon and rice');
