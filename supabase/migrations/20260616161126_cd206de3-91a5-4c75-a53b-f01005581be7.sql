
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fechar_demanda_apos_agendamento() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fechar_demanda_apos_agendamento() TO service_role;
