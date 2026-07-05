-- Troque o e-mail abaixo pelo e-mail do administrador já cadastrado no Supabase Auth.
update public.profiles
set role = 'admin', updated_at = now()
where id = (select id from auth.users where email = 'admin@seudominio.com' limit 1);
