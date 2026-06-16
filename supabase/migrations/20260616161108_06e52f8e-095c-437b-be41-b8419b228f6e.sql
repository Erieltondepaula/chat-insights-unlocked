
-- ============ ENUMS ============
CREATE TYPE public.status_demanda AS ENUM ('pendente','em_atendimento','resolvido','cancelado');
CREATE TYPE public.canal_origem  AS ENUM ('whatsapp','web','telefone');
CREATE TYPE public.app_role      AS ENUM ('admin','auditor','operador');
CREATE TYPE public.resolvedor_tipo AS ENUM ('agente_flow','atendente_humano');

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_le_seus_papeis" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ PROFISSIONAIS REGRAS ============
CREATE TABLE public.profissionais_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  conselho text,
  convenios jsonb NOT NULL DEFAULT '[]'::jsonb,
  idade_min smallint NOT NULL DEFAULT 0,
  idade_max smallint NOT NULL DEFAULT 120,
  unidades_ativas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (idade_min <= idade_max)
);
GRANT SELECT, INSERT, UPDATE ON public.profissionais_regras TO authenticated;
GRANT ALL ON public.profissionais_regras TO service_role;
ALTER TABLE public.profissionais_regras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operador_le_profissionais" ON public.profissionais_regras FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin_gere_profissionais" ON public.profissionais_regras FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_prof_ativo ON public.profissionais_regras(ativo);
CREATE INDEX idx_prof_convenios_gin ON public.profissionais_regras USING gin(convenios);
CREATE INDEX idx_prof_unidades_gin  ON public.profissionais_regras USING gin(unidades_ativas);

-- ============ PROCEDIMENTOS ============
CREATE TABLE public.procedimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text UNIQUE NOT NULL,
  nome text NOT NULL,
  sinonimos jsonb NOT NULL DEFAULT '[]'::jsonb,
  duracao_minutos smallint NOT NULL DEFAULT 30,
  exige_guia boolean NOT NULL DEFAULT false,
  preparo text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.procedimentos TO authenticated;
GRANT ALL ON public.procedimentos TO service_role;
ALTER TABLE public.procedimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "autenticado_le_procedimentos" ON public.procedimentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_gere_procedimentos" ON public.procedimentos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_proc_sinonimos_gin ON public.procedimentos USING gin(sinonimos);

-- ============ AGENDAMENTOS ============
CREATE TABLE public.agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES public.profissionais_regras(id),
  procedimento_id uuid NOT NULL REFERENCES public.procedimentos(id),
  paciente_telefone text NOT NULL,
  paciente_nome text,
  convenio text NOT NULL,
  unidade text NOT NULL,
  data_hora timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmado',
  demanda_id uuid,
  criado_por uuid,
  origem public.resolvedor_tipo NOT NULL DEFAULT 'agente_flow',
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.agendamentos TO authenticated;
GRANT ALL ON public.agendamentos TO service_role;
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operador_le_agendamentos" ON public.agendamentos FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operador_cria_agendamentos" ON public.agendamentos FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_agend_data ON public.agendamentos(data_hora);
CREATE INDEX idx_agend_demanda ON public.agendamentos(demanda_id);

-- ============ DEMANDAS AUDITORIA ============
CREATE TABLE public.demandas_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante_id text NOT NULL,
  solicitante_nome text,
  canal public.canal_origem NOT NULL DEFAULT 'whatsapp',
  mensagem_original text NOT NULL,
  intencao_detectada text,
  payload_intencao jsonb,
  status public.status_demanda NOT NULL DEFAULT 'pendente',
  resolvido_por_id uuid,
  resolvido_por_tipo public.resolvedor_tipo,
  resolvido_por_nome text,
  agendamento_id uuid REFERENCES public.agendamentos(id),
  data_abertura timestamptz NOT NULL DEFAULT now(),
  data_fechamento timestamptz,
  log_solucao text,
  motivo_bloqueio text,
  CHECK ((status IN ('resolvido','cancelado')) = (data_fechamento IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE ON public.demandas_auditoria TO authenticated;
GRANT ALL ON public.demandas_auditoria TO service_role;
ALTER TABLE public.demandas_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auditor_le_demandas" ON public.demandas_auditoria FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operador_cria_demandas" ON public.demandas_auditoria FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operador_atualiza_demandas" ON public.demandas_auditoria FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_dem_status ON public.demandas_auditoria(status);
CREATE INDEX idx_dem_solicitante ON public.demandas_auditoria(solicitante_id);
CREATE INDEX idx_dem_abertura ON public.demandas_auditoria(data_abertura DESC);

-- ============ TRIGGER: fechar demanda ao confirmar agendamento ============
CREATE OR REPLACE FUNCTION public.fechar_demanda_apos_agendamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmado' AND NEW.demanda_id IS NOT NULL THEN
    UPDATE public.demandas_auditoria
       SET status = 'resolvido',
           resolvido_por_id = NEW.criado_por,
           resolvido_por_tipo = COALESCE(NEW.origem,'agente_flow'),
           agendamento_id = NEW.id,
           data_fechamento = now(),
           log_solucao = format('Agendamento %s confirmado em %s', NEW.id, NEW.data_hora)
     WHERE id = NEW.demanda_id AND status <> 'resolvido';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_fecha_demanda
AFTER INSERT OR UPDATE OF status ON public.agendamentos
FOR EACH ROW EXECUTE FUNCTION public.fechar_demanda_apos_agendamento();
