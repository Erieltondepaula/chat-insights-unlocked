
CREATE POLICY "admin_operador_update_agendamentos" ON public.agendamentos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE POLICY "admin_operador_delete_agendamentos" ON public.agendamentos
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE POLICY "admin_delete_demandas_auditoria" ON public.demandas_auditoria
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
